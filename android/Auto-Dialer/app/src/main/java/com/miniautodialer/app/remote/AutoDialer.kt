package com.miniautodialer.app.remote

import android.content.Context
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.data.Outcome
import com.miniautodialer.app.data.Repo
import com.miniautodialer.app.util.CallLogEntry
import com.miniautodialer.app.util.CallManager
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * The auto-dial loop.
 *
 *   Start → countdown → dial → (call) → disposition window (timer, auto-save)
 *         → countdown → dial → …
 *
 * Only a break stops it. Manual dialing pauses it for one call (saving any open
 * disposition first) and the loop continues after that call is disposed.
 * Everything that must survive a restart lives in [Session].
 */
object AutoDialer {
    data class CallInfo(
        val localCustomerId: Long,
        val name: String,
        val phone: String,
        val queueItem: QueueItem?,
        val manual: Boolean,
        val startedAt: Long,
        val log: CallLogEntry? = null,
        val searching: Boolean = true,
    )

    sealed interface State {
        data object Stopped : State
        data object OffShift : State
        data class NoLeads(val note: String) : State
        data class Countdown(val item: QueueItem, val secs: Int) : State
        data class Calling(val name: String, val phone: String, val manual: Boolean) : State
        data class Disposing(val call: CallInfo, val secsLeft: Int, val paused: Boolean) : State
        data class OnBreak(val reasonKey: String, val label: String, val note: String, val startAt: Long, val maxMin: Int) : State
    }

    private val _state = MutableStateFlow<State>(State.Stopped)
    val state: StateFlow<State> = _state
    private var loop: Job? = null
    private val scope get() = MiniDialerApp.instance.appScope
    private val session get() = MiniDialerApp.session
    private val dao get() = MiniDialerApp.db.sync()

    private fun set(s: State) {
        val before = _state.value
        _state.value = s
        val (live, detail) = when (s) {
            State.Stopped -> "idle" to ""
            State.OffShift -> "off_shift" to ""
            is State.NoLeads -> "idle" to s.note
            is State.Countdown -> "dialing" to s.item.name
            is State.Calling -> (if (s.manual) "manual" else "on_call") to s.name
            is State.Disposing -> "disposition" to s.call.name
            is State.OnBreak -> "break" to s.label
        }
        session.liveState = live
        session.liveDetail = detail
        // Report state changes (not every countdown tick) to the Controller board.
        if (before::class != s::class) SyncScheduler.syncSoon(MiniDialerApp.instance)
    }

    /** Re-enter the right state after the app (or the phone) restarts. */
    fun restore(ctx: Context) {
        if (_state.value !is State.Stopped) return
        CallManager.load(ctx)
        when {
            session.breakId != null -> {
                val r = session.config.breakReasons.firstOrNull { it.key == session.breakReason }
                set(State.OnBreak(session.breakReason, r?.label ?: session.breakReason, session.breakNote, session.breakStart, r?.maxMin ?: 0))
            }
            session.dialActive && CallManager.pending.value != null -> scope.launch { callEnded(ctx) }
            session.running -> next(ctx)
        }
    }

    fun start(ctx: Context) {
        session.running = true
        next(ctx)
    }

    /** Pick the next due lead and count down to it, or wait for leads / the shift. */
    fun next(ctx: Context) {
        loop?.cancel()
        loop = scope.launch {
            val cfg = session.config
            while (true) {
                if (session.breakId != null) return@launch
                if (!cfg.inShift()) { set(State.OffShift); delay(60_000); continue }
                val item = dao.nextDue(System.currentTimeMillis())
                if (item == null) {
                    set(State.NoLeads("Waiting for leads"))
                    SyncScheduler.syncSoon(ctx)
                    delay(20_000)
                    continue
                }
                for (s in cfg.nextCallSec downTo 1) { set(State.Countdown(item, s)); delay(1_000) }
                dial(ctx, item)
                return@launch
            }
        }
    }

    private suspend fun dial(ctx: Context, item: QueueItem) {
        val customer = Repo.customerForNumber(item.mobile, item.name) ?: run {
            dao.markQueueDone(item.id); next(ctx); return
        }
        session.dialQueueId = item.id
        session.dialManual = false
        session.dialActive = true
        set(State.Calling(item.name, item.mobile, manual = false))
        CallManager.dial(ctx, customer.id, null, item.mobile)?.let {
            session.dialActive = false
            set(State.NoLeads(it))
        }
    }

    /**
     * Manual dial from inside the dialer. An open disposition is saved first
     * (with what was picked, else the timer's best guess); the number is logged
     * locally, never created as a Founder OS customer.
     */
    suspend fun manualDial(ctx: Context, number: String, pickedKey: String?, remarks: String): String? {
        (state.value as? State.Disposing)?.let { save(ctx, it.call, pickedKey, remarks, null, auto = pickedKey == null, continueAfter = false) }
        loop?.cancel()
        val customer = Repo.customerForNumber(number, "") ?: return "Enter a valid mobile number"
        session.dialQueueId = null
        session.dialManual = true
        session.dialActive = true
        set(State.Calling(customer.name, customer.phone, manual = true))
        return CallManager.dial(ctx, customer.id, null, customer.phone)?.also {
            session.dialActive = false
            if (session.running) next(ctx) else set(State.Stopped)
        }
    }

    /** The agent is back from the call: open the disposition window and start its timer. */
    suspend fun callEnded(ctx: Context) {
        val pc = CallManager.pending.value ?: return
        if (_state.value is State.Disposing) return
        val customer = MiniDialerApp.db.customers().get(pc.customerId)
        val item = session.dialQueueId?.let { dao.queueItem(it) }
        val info = CallInfo(pc.customerId, item?.name ?: customer?.name ?: pc.phone, pc.phone, item, session.dialManual, pc.startedAt)
        val total = session.config.dispositionSec
        set(State.Disposing(info, total, paused = false))
        loop?.cancel()
        loop = scope.launch {
            // Talk time from the call log (it can take a few seconds to appear).
            launch {
                repeat(10) {
                    val e = CallManager.findInCallLog(ctx, pc)
                    if (e != null) { updateCall { it.copy(log = e, searching = false) }; return@launch }
                    delay(1_500)
                }
                updateCall { it.copy(searching = false) }
            }
            var left = total
            while (left > 0) {
                delay(1_000)
                val s = _state.value as? State.Disposing ?: return@launch
                if (!s.paused) { left--; set(s.copy(secsLeft = left)) }
            }
            val s = _state.value as? State.Disposing ?: return@launch
            // save() cancels the timer job, so it must not run inside it.
            scope.launch { save(ctx, s.call, null, "", null, auto = true, continueAfter = true) }
        }
    }

    private fun updateCall(f: (CallInfo) -> CallInfo) {
        val s = _state.value as? State.Disposing ?: return
        _state.value = s.copy(call = f(s.call))
    }

    fun pauseTimer(paused: Boolean) {
        val s = _state.value as? State.Disposing ?: return
        _state.value = s.copy(paused = paused)
    }

    /**
     * Save the disposition. `auto` = the timer ran out: 0 s talk time → Not
     * Answered, otherwise Not Disposed (flagged for review in the report).
     */
    suspend fun save(ctx: Context, call: CallInfo, key: String?, remarks: String, callbackAt: Long?, auto: Boolean, continueAfter: Boolean = true) {
        if (_state.value !is State.Disposing) return
        val cfg = session.config
        val dur = call.log?.durationSec ?: 0
        val finalKey = key ?: if (dur <= 0) DialerConfig.NOT_ANSWERED else DialerConfig.NOT_DISPOSED
        val d = cfg.disposition(finalKey)
        loop?.cancel()
        Repo.saveCall(
            ctx, Repo.CallInput(
                customerId = call.localCustomerId, campaignId = null, phone = call.phone,
                startedAt = call.log?.date ?: call.startedAt, durationSec = dur,
                outcome = Outcome.of(finalKey) ?: Outcome.CONNECTED, outcomeKey = finalKey,
                connectedOverride = d?.connected ?: false, remarks = remarks, fromCallLog = call.log != null,
                callbackAt = callbackAt?.takeIf { d?.callback == true }, callbackNote = d?.label ?: "",
                completeFollowUpIds = emptyList(),
                dialer = Repo.DialerMeta(call.queueItem?.id, call.queueItem?.customerId, call.manual, auto),
            )
        )
        call.queueItem?.let { dao.markQueueDone(it.id) }
        CallManager.clear(ctx)
        session.dialActive = false
        session.dialQueueId = null
        if (continueAfter) { if (session.running) next(ctx) else set(State.Stopped) }
    }

    fun startBreak(reasonKey: String, note: String) {
        loop?.cancel()
        val r = session.config.breakReasons.firstOrNull { it.key == reasonKey }
        val id = UUID.randomUUID().toString()
        val now = System.currentTimeMillis()
        session.breakId = id; session.breakReason = reasonKey; session.breakNote = note; session.breakStart = now
        set(State.OnBreak(reasonKey, r?.label ?: reasonKey, note, now, r?.maxMin ?: 0))
        scope.launch { Outbox.enqueueBreak(id, reasonKey, note, now, null) }
    }

    fun endBreak(ctx: Context) {
        val id = session.breakId ?: return
        val reason = session.breakReason; val note = session.breakNote; val start = session.breakStart
        session.breakId = null
        scope.launch { Outbox.enqueueBreak(id, reason, note, start, System.currentTimeMillis()) }
        session.running = true
        next(ctx)
    }

    /** Signed out of Founder OS: stop the loop (local data stays). */
    fun reset() {
        loop?.cancel()
        session.running = false
        _state.value = State.Stopped
    }
}
