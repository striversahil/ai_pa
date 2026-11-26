package com.miniautodialer.app.remote

import android.content.Context
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.data.Outcome
import com.miniautodialer.app.data.Repo
import com.miniautodialer.app.util.CallLogEntry
import com.miniautodialer.app.util.CallManager
import com.miniautodialer.app.util.PendingCall
import com.miniautodialer.app.util.PhoneCallState
import java.util.concurrent.atomic.AtomicBoolean
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
 * Only a break stops it; a scheduled break (set in the Controller) locks it until the window ends. Manual dialing pauses it for one call (saving any open
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
        /** [live] = the phone is off-hook for this call (false while the SIM picker / dial is still opening). */
        data class Calling(val name: String, val phone: String, val manual: Boolean, val live: Boolean = false) : State
        /** [heldByCall] = the phone is on a call, so the timer waits instead of dialing over it. */
        data class Disposing(val call: CallInfo, val secsLeft: Int, val paused: Boolean, val heldByCall: Boolean = false) : State
        /** The dial never reached the network (SIM picker dismissed, dial cancelled): nothing is recorded. */
        data class NotPlaced(val name: String, val phone: String, val manual: Boolean, val queueId: String?) : State
        data class OnBreak(val reasonKey: String, val label: String, val note: String, val startAt: Long, val maxMin: Int) : State
        /** Sales-head scheduled break: dialing locked until [until] (IST HH:MM). */
        data class Scheduled(val label: String, val until: String) : State
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
            is State.Calling -> (if (s.manual) "manual" else if (s.live) "on_call" else "dialing") to s.name
            is State.Disposing -> "disposition" to s.call.name
            is State.NotPlaced -> "idle" to "Call not placed: ${s.name}"
            is State.OnBreak -> "break" to s.label
            is State.Scheduled -> "break" to "${s.label} (scheduled, until ${s.until})"
        }
        val changed = before::class != s::class || session.liveState != live
        session.liveState = live
        session.liveDetail = detail
        // Report state changes (not every countdown tick) to the Controller board.
        if (changed) SyncScheduler.syncSoon(MiniDialerApp.instance)
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
            session.dialActive && CallManager.pending.value != null -> onResume(ctx)
            session.running -> next(ctx)
        }
    }

    private val checking = AtomicBoolean(false)
    private val ending = AtomicBoolean(false)

    /**
     * The app came to the front (or restarted) while a dial is open. Coming back
     * is NOT "the call ended": the phone decides. Live call → stay on Calling;
     * hung up → disposition; never went off-hook and nothing in the call log →
     * the dial was cancelled (dual-SIM picker dismissed) and nothing is recorded.
     */
    fun onResume(ctx: Context) {
        if (!session.dialActive || CallManager.pending.value == null) return
        if (!checking.compareAndSet(false, true)) return
        scope.launch { try { checkCall(ctx) } finally { checking.set(false) } }
    }

    private suspend fun checkCall(ctx: Context) {
        val pc = CallManager.pending.value ?: return
        val s = _state.value
        if (s is State.Disposing || s is State.NotPlaced) return
        repeat(5) { attempt ->
            if (PhoneCallState.inCall(ctx)) { markLive(ctx, pc); return }
            if (session.dialSawCall || CallManager.findInCallLog(ctx, pc) != null) { callEnded(ctx); return }
            if (attempt < 4) delay(1_000) // the call can still be opening right after the picker
        }
        notPlaced(ctx, pc)
    }

    private suspend fun markLive(ctx: Context, pc: PendingCall) {
        session.dialSawCall = true
        val cur = _state.value as? State.Calling
        val name = cur?.name ?: session.dialQueueId?.let { dao.queueItem(it)?.name }
            ?: MiniDialerApp.db.customers().get(pc.customerId)?.name ?: pc.phone
        set(State.Calling(name, pc.phone, session.dialManual, live = true))
        if (loop?.isActive != true) watch(ctx)
    }

    /** Poll the phone while a dial is open: off-hook = live call, back on-hook after that = call ended. */
    private fun watch(ctx: Context) {
        loop?.cancel()
        loop = scope.launch {
            while (true) {
                delay(700)
                if (!session.dialActive) return@launch
                if (PhoneCallState.inCall(ctx)) {
                    if (!session.dialSawCall) {
                        session.dialSawCall = true
                        (_state.value as? State.Calling)?.let { set(it.copy(live = true)) }
                    }
                } else if (session.dialSawCall) {
                    scope.launch { callEnded(ctx) }
                    return@launch
                }
            }
        }
    }

    private suspend fun notPlaced(ctx: Context, pc: PendingCall) {
        loop?.cancel()
        val queueId = session.dialQueueId
        val name = queueId?.let { dao.queueItem(it)?.name } ?: MiniDialerApp.db.customers().get(pc.customerId)?.name ?: pc.phone
        val manual = session.dialManual
        CallManager.clear(ctx)
        session.dialActive = false
        session.dialSawCall = false
        set(State.NotPlaced(name, pc.phone, manual, queueId))
    }

    /** "Call again" after a cancelled dial: same lead (or the same manual number), no record of the cancel. */
    fun redial(ctx: Context) {
        val s = _state.value as? State.NotPlaced ?: return
        scope.launch {
            if (s.manual || s.queueId == null) { manualDial(ctx, s.phone, null, "") ; return@launch }
            val item = dao.queueItem(s.queueId)
            if (item == null) next(ctx) else dial(ctx, item)
        }
    }

    /** Leave the cancelled-dial screen: a lead stays first in the queue; Start resumes it. */
    fun dismissNotPlaced(ctx: Context) {
        val s = _state.value as? State.NotPlaced ?: return
        if (!s.manual) session.running = false
        if (session.running) next(ctx) else set(State.Stopped)
    }

    fun start(ctx: Context) {
        session.running = true
        next(ctx)
    }

    /** Pick the next due lead and count down to it, or wait for leads / the shift. */
    fun next(ctx: Context) {
        loop?.cancel()
        loop = scope.launch {
            while (true) {
                val cfg = session.config // re-read: the Controller can change it between rounds
                if (session.breakId != null) return@launch
                val scheduled = cfg.activeScheduledBreak()
                if (scheduled != null) { set(State.Scheduled(scheduled.label, scheduled.end)); delay(20_000); continue }
                if (!cfg.inShift()) { set(State.OffShift); delay(60_000); continue }
                // Never dial over a live call (an incoming call, or one the agent placed themselves).
                if (PhoneCallState.inCall(ctx)) { set(State.NoLeads("Phone is on a call — the next dial waits for it to end")); delay(2_000); continue }
                val item = dao.nextDue(System.currentTimeMillis())
                if (item == null) {
                    set(State.NoLeads("Waiting for leads"))
                    SyncScheduler.syncSoon(ctx)
                    delay(20_000)
                    continue
                }
                var interrupted = false
                for (s in cfg.nextCallSec downTo 1) {
                    if (PhoneCallState.inCall(ctx)) { interrupted = true; break }
                    set(State.Countdown(item, s)); delay(1_000)
                }
                if (interrupted || PhoneCallState.inCall(ctx)) continue
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
        beginDial()
        set(State.Calling(item.name, item.mobile, manual = false))
        val err = CallManager.dial(ctx, customer.id, null, item.mobile)
        if (err != null) { session.dialActive = false; set(State.NoLeads(err)) } else watch(ctx)
    }

    private fun beginDial() {
        session.dialActive = true
        session.dialSawCall = false
        ending.set(false)
    }

    /**
     * Manual dial from inside the dialer. An open disposition is saved first
     * (with what was picked, else the timer's best guess); the number is logged
     * locally, never created as a Founder OS customer.
     */
    suspend fun manualDial(ctx: Context, number: String, pickedKey: String?, remarks: String): String? {
        (state.value as? State.Disposing)?.let { save(ctx, it.call, pickedKey, remarks, null, auto = pickedKey == null, continueAfter = false) }
        session.config.activeScheduledBreak()?.let { b ->
            if (session.running) next(ctx)
            return "Dialer locked: ${b.label} until ${b.end}"
        }
        loop?.cancel()
        val customer = Repo.customerForNumber(number, "") ?: return "Enter a valid mobile number"
        session.dialQueueId = null
        session.dialManual = true
        beginDial()
        set(State.Calling(customer.name, customer.phone, manual = true))
        val err = CallManager.dial(ctx, customer.id, null, customer.phone)
        if (err == null) { watch(ctx); return null }
        session.dialActive = false
        if (session.running) next(ctx) else set(State.Stopped)
        return err
    }

    /** The phone hung up (seen by [watch] / [checkCall]): open the disposition window and start its timer. */
    suspend fun callEnded(ctx: Context) {
        val pc = CallManager.pending.value ?: return
        if (_state.value is State.Disposing) return
        if (!ending.compareAndSet(false, true)) return
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
                // A call on the phone (incoming, or the agent called back) holds the timer:
                // auto-saving now would dial the next lead over that live call.
                val held = PhoneCallState.inCall(ctx)
                if (held != s.heldByCall) set(s.copy(heldByCall = held))
                if (!s.paused && !held) { left--; set((_state.value as? State.Disposing ?: return@launch).copy(secsLeft = left)) }
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
        session.dialSawCall = false
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
