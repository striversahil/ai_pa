package com.miniautodialer.app.util

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.CallLog
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** A call that was started from the app and still needs its outcome logged. */
data class PendingCall(
    val customerId: Long,
    val campaignId: Long?,
    val phone: String,
    val startedAt: Long,
    val dialed: Boolean,
    /** True when the call was made from the phone's own dialer and detected afterwards. */
    val external: Boolean = false,
)

data class CallLogEntry(val date: Long, val durationSec: Int, val type: Int)

object CallManager {
    private val _pending = MutableStateFlow<PendingCall?>(null)
    val pending: StateFlow<PendingCall?> = _pending

    /** Holds a campaignId after the user pressed "Save & Next"; the calling screen consumes it. */
    val advance = MutableStateFlow<Long?>(null)

    private fun sp(ctx: Context) = ctx.getSharedPreferences("pending_call", Context.MODE_PRIVATE)

    fun load(ctx: Context) {
        if (_pending.value != null) return
        val sp = sp(ctx)
        val cid = sp.getLong("customer", 0)
        if (cid > 0) {
            _pending.value = PendingCall(
                customerId = cid,
                campaignId = sp.getLong("campaign", 0).takeIf { it > 0 },
                phone = sp.getString("phone", "") ?: "",
                startedAt = sp.getLong("started", 0),
                dialed = sp.getBoolean("dialed", true),
                external = sp.getBoolean("external", false),
            )
        }
    }

    private fun set(ctx: Context, pc: PendingCall?) {
        _pending.value = pc
        sp(ctx).edit().apply {
            if (pc == null) clear() else {
                putLong("customer", pc.customerId)
                putLong("campaign", pc.campaignId ?: 0)
                putString("phone", pc.phone)
                putLong("started", pc.startedAt)
                putBoolean("dialed", pc.dialed)
                putBoolean("external", pc.external)
            }
        }.apply()
    }

    fun clear(ctx: Context) = set(ctx, null)

    /** Ask the user for the outcome of a call that was detected in the call log. */
    fun review(ctx: Context, pc: PendingCall) = set(ctx, pc)

    val INCOMING_TYPES = setOf(
        CallLog.Calls.INCOMING_TYPE, CallLog.Calls.MISSED_TYPE, CallLog.Calls.VOICEMAIL_TYPE,
        CallLog.Calls.REJECTED_TYPE, CallLog.Calls.BLOCKED_TYPE, CallLog.Calls.ANSWERED_EXTERNALLY_TYPE,
    )

    fun canCall(ctx: Context) =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED

    fun canReadLog(ctx: Context) =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED

    /** Places the call through the phone's dialer. Returns an error message or null. */
    fun dial(ctx: Context, customerId: Long, campaignId: Long?, phone: String): String? {
        val number = PhoneUtil.clean(phone)
        if (!PhoneUtil.isValid(number)) return "Invalid phone number"
        val pc = PendingCall(customerId, campaignId, number, System.currentTimeMillis(), true)
        set(ctx, pc)
        return try {
            val action = if (canCall(ctx)) Intent.ACTION_CALL else Intent.ACTION_DIAL
            ctx.startActivity(Intent(action, Uri.fromParts("tel", number, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            null
        } catch (e: Exception) {
            set(ctx, null)
            "Could not start the call: ${e.message}"
        }
    }

    /** Log a call that was made outside the app (no dialing). */
    fun manualLog(ctx: Context, customerId: Long, campaignId: Long?, phone: String) {
        set(ctx, PendingCall(customerId, campaignId, PhoneUtil.clean(phone), System.currentTimeMillis(), false))
    }

    /** Looks up the outgoing call in the Android call log (needs READ_CALL_LOG). */
    fun findInCallLog(ctx: Context, pc: PendingCall): CallLogEntry? {
        if (!canReadLog(ctx)) return null
        return try {
            ctx.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.DATE, CallLog.Calls.DURATION, CallLog.Calls.TYPE),
                "${CallLog.Calls.DATE} >= ?",
                arrayOf((pc.startedAt - 15_000).toString()),
                // oldest first: the call placed by us is the first matching entry after startedAt,
                // later calls to the same number must not replace it
                "${CallLog.Calls.DATE} ASC"
            )?.use { c ->
                while (c.moveToNext()) {
                    val num = c.getString(0) ?: continue
                    val type = c.getInt(3)
                    // Some manufacturers use their own codes for outgoing calls (Realme/ColorOS: 100, 101),
                    // so accept anything that is not clearly an incoming-side call.
                    if (PhoneUtil.sameNumber(num, pc.phone) && type !in INCOMING_TYPES) {
                        return CallLogEntry(c.getLong(1), c.getInt(2), type)
                    }
                }
                null
            }
        } catch (_: SecurityException) {
            null
        }
    }
}
