package com.miniautodialer.app.util

import android.content.Context
import android.provider.CallLog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Every call on the phone (app + normal dialer) since a time, from the Android call log. */
data class PhoneStats(
    val total: Int = 0,
    val outgoing: Int = 0,
    val incoming: Int = 0,
    val missed: Int = 0,
    val connected: Int = 0,
    val talkSec: Long = 0,
    val readable: Boolean = true,
)

object PhoneLogStats {
    suspend fun since(ctx: Context, from: Long): PhoneStats = withContext(Dispatchers.IO) {
        if (!CallManager.canReadLog(ctx)) return@withContext PhoneStats(readable = false)
        var s = PhoneStats()
        try {
            ctx.contentResolver.query(
                CallLog.Calls.CONTENT_URI, arrayOf(CallLog.Calls.DURATION, CallLog.Calls.TYPE),
                "${CallLog.Calls.DATE} >= ?", arrayOf(from.toString()), null,
            )?.use { c ->
                while (c.moveToNext()) {
                    val dur = c.getInt(0)
                    val type = c.getInt(1)
                    val incoming = type in CallManager.INCOMING_TYPES
                    s = s.copy(
                        total = s.total + 1,
                        outgoing = s.outgoing + if (incoming) 0 else 1,
                        incoming = s.incoming + if (incoming && dur > 0) 1 else 0,
                        missed = s.missed + if (incoming && dur <= 0) 1 else 0,
                        connected = s.connected + if (dur > 0) 1 else 0,
                        talkSec = s.talkSec + dur,
                    )
                }
            }
        } catch (_: SecurityException) {
            return@withContext PhoneStats(readable = false)
        }
        s
    }
}
