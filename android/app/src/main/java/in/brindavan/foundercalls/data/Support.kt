package in.brindavan.foundercalls.data

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.ContactsContract
import android.provider.CallLog
import androidx.core.content.ContextCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object Permissions {
    val required = buildList {
        add(Manifest.permission.READ_PHONE_STATE)
        add(Manifest.permission.READ_CALL_LOG)
        add(Manifest.permission.READ_CONTACTS)
        add(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
    }

    fun missing(context: Context): List<String> =
        required.filter { ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED }

    fun hasCore(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
}

object Numbers {
    fun e164(raw: String?, defaultCountry: String = "91"): String {
        val digits = raw.orEmpty().filter { it.isDigit() }
        if (digits.isEmpty()) return ""
        return when {
            digits.length == 10 -> defaultCountry + digits
            digits.startsWith("0") && digits.length == 11 -> defaultCountry + digits.drop(1)
            digits.length > 10 -> digits
            else -> digits
        }
    }

    fun localLabel(e164: String): String = e164.takeLast(10)
}

object Clock {
    fun istDay(ms: Long = System.currentTimeMillis()): String {
        val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        fmt.timeZone = TimeZone.getTimeZone("Asia/Kolkata")
        return fmt.format(Date(ms))
    }

    fun istTime(ms: Long): String {
        val fmt = SimpleDateFormat("dd MMM HH:mm:ss", Locale.US)
        fmt.timeZone = TimeZone.getTimeZone("Asia/Kolkata")
        return fmt.format(Date(ms))
    }
}

object Contacts {
    fun nameFor(context: Context, numberE164: String): String {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return ""
        val number = numberE164.takeLast(10)
        val uri = android.net.Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, android.net.Uri.encode(number))
        return try {
            context.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0).orEmpty() else ""
            } ?: ""
        } catch (_: Exception) {
            ""
        }
    }
}

data class ReconciledCall(
    val type: Int?,
    val durationSec: Int,
    val status: CallStatus,
    val matched: Boolean,
)

object CallLogReconciler {
    fun reconcile(context: Context, numberE164: String, attemptAt: Long): ReconciledCall {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) {
            return ReconciledCall(null, 0, CallStatus.FAILED, false)
        }
        val local = numberE164.takeLast(10)
        val projection = arrayOf(CallLog.Calls.TYPE, CallLog.Calls.DURATION, CallLog.Calls.DATE, CallLog.Calls.NUMBER)
        val selection = "${CallLog.Calls.DATE} >= ?"
        val args = arrayOf((attemptAt - 60_000).toString())
        return try {
            context.contentResolver.query(CallLog.Calls.CONTENT_URI, projection, selection, args, "${CallLog.Calls.DATE} DESC")?.use { c ->
                var checked = 0
                while (c.moveToNext() && checked < 5) {
                    checked++
                    val num = c.getString(c.getColumnIndexOrThrow(CallLog.Calls.NUMBER)).orEmpty()
                    if (Numbers.e164(num).takeLast(10) != local) continue
                    val type = c.getInt(c.getColumnIndexOrThrow(CallLog.Calls.TYPE))
                    val duration = c.getInt(c.getColumnIndexOrThrow(CallLog.Calls.DURATION)).coerceAtLeast(0)
                    val status = when (type) {
                        CallLog.Calls.MISSED_TYPE -> CallStatus.MISSED
                        CallLog.Calls.REJECTED_TYPE -> CallStatus.REJECTED
                        CallLog.Calls.BLOCKED_TYPE -> CallStatus.BLOCKED
                        CallLog.Calls.INCOMING_TYPE, CallLog.Calls.OUTGOING_TYPE ->
                            if (duration > 0) CallStatus.CONNECTED else CallStatus.FAILED
                        else -> CallStatus.FAILED
                    }
                    return ReconciledCall(type, duration, status, true)
                }
                ReconciledCall(null, 0, CallStatus.FAILED, false)
            } ?: ReconciledCall(null, 0, CallStatus.FAILED, false)
        } catch (_: Exception) {
            ReconciledCall(null, 0, CallStatus.FAILED, false)
        }
    }
}
