package com.miniautodialer.app.remote

import com.miniautodialer.app.MiniDialerApp
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * "Lead time": after a call the agent pauses auto-dialing for the Controller's
 * `leadTimeMin` to work the lead (once per call). It is logged as a
 * LEAD_TIME break so the live board and the report show it; [AutoDialer] holds
 * the disposition timer while it is open and resumes it when it ends.
 */
object LeadTime {
    private val session get() = MiniDialerApp.session

    val isOpen: Boolean get() = session.leadBreakId != null

    /** When the open pause ends (0 = none). */
    val until: Long get() = if (isOpen) session.leadUntil else 0L

    /** Open a pause for [leadName]; returns its end time, or null when off / already open. */
    fun begin(leadName: String): Long? {
        val min = session.config.leadTimeMin
        if (min <= 0 || isOpen) return null
        val now = System.currentTimeMillis()
        val id = UUID.randomUUID().toString()
        session.leadBreakId = id
        session.leadStart = now
        session.leadUntil = now + min * 60_000L
        session.leadNote = leadName.take(120)
        MiniDialerApp.instance.appScope.launch { Outbox.enqueueBreak(id, DialerConfig.LEAD_TIME, leadName.take(120), now, null) }
        return session.leadUntil
    }

    /** Agent tapped Lead time: no dialing (disposition timer held) until it ends; once per call. */
    fun start() = AutoDialer.updateDisposing { s ->
        if (s.leadUsed) null else begin(s.call.name)?.let { s.copy(leadUntil = it, leadUsed = true) }
    }

    /** Agent is done early: the disposition window restarts in full. */
    fun end() = AutoDialer.updateDisposing { s ->
        if (s.leadUntil == 0L) null else { close(); s.copy(leadUntil = 0L, secsLeft = session.config.dispositionSec) }
    }

    /** Close the open pause (ended early, ran out, or the disposition was saved). */
    fun close() {
        val id = session.leadBreakId ?: return
        val start = session.leadStart
        val note = session.leadNote
        val end = minOf(System.currentTimeMillis(), session.leadUntil.takeIf { it > 0 } ?: Long.MAX_VALUE)
        session.leadBreakId = null
        session.leadUntil = 0L
        MiniDialerApp.instance.appScope.launch { Outbox.enqueueBreak(id, DialerConfig.LEAD_TIME, note, start, end) }
    }
}
