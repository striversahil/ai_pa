package com.miniautodialer.app.util

import android.content.Context
import android.provider.CallLog
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.data.Customer
import com.miniautodialer.app.data.Outcome
import com.miniautodialer.app.data.Repo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Tracks calls made from the phone's own dialer (outside this app) by reading the Android call log.
 * - A call that ended in the last few minutes is handed back so the user can enter outcome/remarks.
 * - Older calls are logged automatically (Connected / Not Answered from the talk time); they can be edited later.
 */
object DialerSync {
    private const val REVIEW_WINDOW_MS = 10 * 60_000L
    private const val SAME_CALL_BEFORE_MS = 20_000L
    private const val SAME_CALL_AFTER_MS = 3_000L
    private val lock = Mutex()

    private data class Entry(val number: String, val date: Long, val durationSec: Int, val name: String?)

    /** @return a call the user should review now, or null. */
    suspend fun sync(ctx: Context): PendingCall? = lock.withLock {
        withContext(Dispatchers.IO) { runSync(ctx) }
    }

    private suspend fun runSync(ctx: Context): PendingCall? {
        val prefs = MiniDialerApp.prefs
        if (!prefs.trackDialer || !CallManager.canReadLog(ctx)) return null
        // a call started from the app is waiting for its outcome; it will be saved by that screen
        if (CallManager.pending.value != null) return null
        val since = prefs.dialerSyncedTo.takeIf { it > 0 } ?: Fmt.startOfToday()

        val entries = mutableListOf<Entry>()
        try {
            ctx.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.DATE, CallLog.Calls.DURATION, CallLog.Calls.TYPE, CallLog.Calls.CACHED_NAME),
                "${CallLog.Calls.DATE} > ?", arrayOf(since.toString()),
                "${CallLog.Calls.DATE} ASC"
            )?.use { c ->
                while (c.moveToNext()) {
                    val num = c.getString(0) ?: continue
                    if (c.getInt(3) in CallManager.INCOMING_TYPES) continue
                    entries += Entry(num, c.getLong(1), c.getInt(2), c.getString(4))
                }
            }
        } catch (_: SecurityException) {
            return null
        }
        if (entries.isEmpty()) return null

        val db = MiniDialerApp.db
        val found = mutableListOf<Pair<Entry, Customer>>()
        for (e in entries) {
            if (!PhoneUtil.isValid(e.number)) continue
            var customer: Customer? = db.customers().byPhoneKey(PhoneUtil.key(e.number))
            if (customer == null && prefs.trackUnknown) {
                customer = Repo.customerForNumber(e.number, e.name.orEmpty(), "Added from phone dialer")
            }
            if (customer == null) continue
            // already logged through the app (or by an earlier sync)?
            // (app calls are saved with the call-log time, or the moment Call was tapped, a few seconds earlier)
            if (db.calls().countNear(customer.id, e.date - SAME_CALL_BEFORE_MS, e.date + SAME_CALL_AFTER_MS) > 0) continue
            found += e to customer
        }

        val now = System.currentTimeMillis()
        val last = found.lastOrNull()
        val review = last?.takeIf { (e, _) -> now - (e.date + e.durationSec * 1000L) < REVIEW_WINDOW_MS }
        for ((e, c) in found) {
            if (e === review?.first) continue
            Repo.saveCall(
                ctx, Repo.CallInput(
                    customerId = c.id, campaignId = Repo.pendingCampaignFor(c.id), phone = PhoneUtil.clean(e.number),
                    startedAt = e.date, durationSec = e.durationSec,
                    outcome = Outcome.suggest(e.durationSec, prefs.askBelowSec) ?: Outcome.NOT_ANSWERED,
                    remarks = if (e.durationSec > 0 && e.durationSec < prefs.askBelowSec) "Dialed from phone, short call: please check the outcome" else "Dialed from phone",
                    fromCallLog = true,
                    callbackAt = null, callbackNote = "", completeFollowUpIds = emptyList(),
                )
            )
        }
        prefs.dialerSyncedTo = entries.maxOf { it.date }

        return review?.let { (e, c) ->
            PendingCall(
                customerId = c.id, campaignId = Repo.pendingCampaignFor(c.id), phone = PhoneUtil.clean(e.number),
                startedAt = e.date, dialed = true, external = true,
            ).also { CallManager.review(ctx, it) }
        }
    }
}
