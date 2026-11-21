package com.miniautodialer.app.remote

import android.content.Context
import android.provider.CallLog
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.util.CallManager
import com.miniautodialer.app.util.Fmt
import com.miniautodialer.app.util.PhoneUtil
import org.json.JSONObject
import java.time.Instant
import kotlin.math.abs

/**
 * Calls made or received in the phone's own dialer (not the auto dialer) go to
 * Founder OS too, read from the Android call log. Each call-log entry becomes
 * one outbox item "pcall:<date>" with its full payload; the server id is
 * derived from the entry time, so a resend never double-counts.
 *
 * Calls the auto dialer placed are skipped (they sync with their disposition),
 * and nothing newer than a call still being dialed is read until it is saved.
 * Controller switch: DialerConfig.trackPhoneCalls.
 */
object PhoneCallSync {
    private const val SAME_CALL_BEFORE_MS = 20_000L
    private const val SAME_CALL_AFTER_MS = 5_000L

    private val session get() = MiniDialerApp.session
    private val dao get() = MiniDialerApp.db.sync()

    fun enabled(): Boolean = session.token != null && session.config.trackPhoneCalls

    suspend fun collect(ctx: Context) {
        if (!enabled() || !CallManager.canReadLog(ctx)) return
        if (session.phoneLogSince == 0L) session.phoneLogSince = Fmt.startOfToday()
        // A call being dialed has no disposition yet: wait until it is saved.
        val pendingStart = CallManager.pending.value?.startedAt
        val cutoff = if (pendingStart != null || session.dialActive) (pendingStart ?: System.currentTimeMillis()) - SAME_CALL_BEFORE_MS
        else System.currentTimeMillis()
        var watermark = session.phoneLogSince
        try {
            ctx.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.DATE, CallLog.Calls.DURATION, CallLog.Calls.TYPE, CallLog.Calls.CACHED_NAME),
                "${CallLog.Calls.DATE} > ?", arrayOf(session.phoneLogSince.toString()), "${CallLog.Calls.DATE} ASC",
            )?.use { c ->
                while (c.moveToNext()) {
                    val date = c.getLong(1)
                    if (date >= cutoff) break
                    watermark = date
                    val number = c.getString(0) ?: continue
                    if (!PhoneUtil.isValid(number) || placedByDialer(number, date)) continue
                    val id = "pcall:$date"
                    if (dao.outbox(id) != null) continue
                    dao.putOutbox(OutboxItem(id = id, kind = "pcall", payload = payload(number, date, c.getInt(2), c.getInt(3), c.getString(4)).toString()))
                }
            }
        } catch (_: SecurityException) {
            return
        }
        session.phoneLogSince = watermark
    }

    /** A local call with dialer facts (queue/manual) at the same time and number. */
    private suspend fun placedByDialer(number: String, date: Long): Boolean =
        MiniDialerApp.db.calls().between(date - SAME_CALL_BEFORE_MS, date + SAME_CALL_AFTER_MS)
            .any { PhoneUtil.sameNumber(it.phone, number) && dao.callSync(it.id) != null }

    private fun iso(ms: Long) = Instant.ofEpochMilli(ms).toString()

    private fun payload(number: String, date: Long, durationSec: Int, type: Int, name: String?): JSONObject {
        val incoming = type in CallManager.INCOMING_TYPES
        val status = when {
            durationSec > 0 -> "CONNECTED"
            type == CallLog.Calls.REJECTED_TYPE -> "REJECTED"
            type == CallLog.Calls.BLOCKED_TYPE -> "BLOCKED"
            else -> "MISSED"
        }
        return JSONObject()
            .put("id", "${session.deviceId.take(16)}-L$date")
            .put("number", PhoneUtil.clean(number))
            .put("attemptAt", iso(date))
            .put("connectAt", if (durationSec > 0) iso(date) else JSONObject.NULL)
            .put("endAt", iso(date + durationSec * 1000L))
            .put("durationSec", durationSec)
            .put("status", status)
            .put("direction", if (incoming) "IN" else "OUT")
            .put("callLogType", type)
            .put("contactName", name ?: "")
            .put("disposition", "")
            .put("origin", "phone")
            .put("external", true)
            .put("recordingState", "none")
    }

    /**
     * The phone-dialer call a recording belongs to (by time, number when the
     * file name has one). @return outbox id + server call id, or null.
     */
    suspend fun matchRecording(time: Long, digits: String?): Pair<String, String>? {
        if (!enabled()) return null
        val best = dao.recent("pcall", time - 2 * 86_400_000L).mapNotNull { item ->
            val p = runCatching { JSONObject(item.payload) }.getOrNull() ?: return@mapNotNull null
            val start = runCatching { Instant.parse(p.getString("attemptAt")).toEpochMilli() }.getOrNull() ?: return@mapNotNull null
            val dur = p.optInt("durationSec")
            if (dur <= 0 || time < start - 120_000 || time > start + dur * 1000L + 300_000) return@mapNotNull null
            if (digits != null && !PhoneUtil.sameNumber(p.optString("number"), digits)) return@mapNotNull null
            Triple(item.id, p.getString("id"), abs(start - time))
        }.minByOrNull { it.third } ?: return null
        return best.first to best.second
    }
}
