package com.miniautodialer.app.remote

import com.miniautodialer.app.MiniDialerApp
import org.json.JSONObject
import java.time.Instant

/**
 * What goes to Founder OS. Items are queued the moment something happens and
 * the payload is rebuilt from the live record at send time, so a later edit of
 * a call (new disposition, remarks) is what the server receives.
 */
object Outbox {
    private val dao get() = MiniDialerApp.db.sync()
    private val session get() = MiniDialerApp.session

    /** Server id of a local call: unique per phone, stable across resends. */
    fun serverCallId(localCallId: Long) = "${session.deviceId.take(16)}-c$localCallId"

    private fun iso(ms: Long) = Instant.ofEpochMilli(ms).toString()

    suspend fun enqueueCall(localCallId: Long) {
        if (session.token == null && session.pairRequestId == null) return // standalone use: nothing to sync
        // With phone-dialer tracking on, calls not placed by the auto dialer reach
        // Founder OS once, from the call log (PhoneCallSync) — never twice.
        if (session.config.trackPhoneCalls && dao.callSync(localCallId) == null) return
        dao.putOutbox(OutboxItem(id = "call:$localCallId", kind = "call", payload = JSONObject().put("callId", localCallId).toString()))
        SyncScheduler.syncSoon(MiniDialerApp.instance)
    }

    suspend fun enqueueBreak(id: String, reason: String, note: String, startAt: Long, endAt: Long?) {
        val p = JSONObject().put("id", id).put("reason", reason).put("note", note).put("startAt", iso(startAt))
        if (endAt != null) p.put("endAt", iso(endAt))
        dao.putOutbox(OutboxItem(id = "break:$id", kind = "break", payload = p.toString()))
        SyncScheduler.syncSoon(MiniDialerApp.instance)
    }

    suspend fun enqueueRecording(recordingId: Long, localCallId: Long) {
        if (session.token == null) return
        dao.putOutbox(OutboxItem(id = "rec:$recordingId", kind = "rec",
            payload = JSONObject().put("recordingId", recordingId).put("callId", localCallId).toString()))
        SyncScheduler.syncSoon(MiniDialerApp.instance)
    }

    /** Recording of a phone-dialer call (PhoneCallSync): uploaded once that call has synced. */
    suspend fun enqueuePhoneRecording(recordingId: Long, callOutboxId: String, serverCallId: String) {
        if (session.token == null) return
        dao.putOutbox(OutboxItem(id = "rec:$recordingId", kind = "rec",
            payload = JSONObject().put("recordingId", recordingId).put("outboxId", callOutboxId).put("serverId", serverCallId).toString()))
        SyncScheduler.syncSoon(MiniDialerApp.instance)
    }

    /** Server payload for a queued call, or null when the call no longer exists locally. */
    suspend fun callPayload(item: OutboxItem): JSONObject? {
        val db = MiniDialerApp.db
        val callId = JSONObject(item.payload).optLong("callId")
        val call = db.calls().get(callId) ?: return null
        val extra = dao.callSync(callId)
        val customer = db.customers().get(call.customerId)
        val dur = call.durationSec
        return JSONObject()
            .put("id", serverCallId(callId))
            .put("number", call.phone)
            .put("attemptAt", iso(call.startedAt))
            .put("connectAt", if (dur > 0) iso(call.startedAt) else JSONObject.NULL)
            .put("endAt", iso(call.startedAt + dur * 1000L))
            .put("durationSec", dur)
            .put("status", if (dur > 0) "CONNECTED" else "MISSED")
            .put("direction", "OUT")
            .put("contactName", customer?.name ?: "")
            .put("disposition", call.outcome)
            .put("remarks", call.remarks)
            .put("callbackAt", extra?.callbackAt?.let { iso(it) } ?: JSONObject.NULL)
            .put("queueId", extra?.queueId ?: JSONObject.NULL)
            .put("customerId", extra?.serverCustomerId ?: "")
            .put("manual", extra?.manual ?: false)
            .put("autoSaved", extra?.autoSaved ?: false)
            // Not placed by the dialer: the server keeps it only for a customer's number.
            .put("external", extra == null)
            .put("recordingState", "none")
    }
}
