package com.miniautodialer.app.data

import android.content.Context
import android.database.sqlite.SQLiteConstraintException
import androidx.room.withTransaction
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.notify.FollowUpScheduler
import com.miniautodialer.app.remote.CallSync
import com.miniautodialer.app.remote.Outbox
import com.miniautodialer.app.util.PhoneUtil
import java.io.File

data class ImportRow(
    val name: String,
    val phone: String,
    val company: String = "",
    val email: String = "",
    val location: String = "",
    val category: String = "",
    val remarks: String = "",
)

data class ImportResult(val added: Int, val updated: Int, val skipped: Int, val linked: Int)

/** Business operations that touch more than one table. */
object Repo {
    private val db get() = MiniDialerApp.db

    val DEFAULT_CAMPAIGNS = listOf(
        "New Customer Leads",
        "Existing Customer Follow-ups",
        "Payment Reminders",
        "Product Promotions",
        "Interested Customers",
        "Old Customer Reactivation",
    )

    suspend fun seedIfNeeded(ctx: Context) {
        val prefs = MiniDialerApp.prefs
        if (prefs.seeded) return
        if (db.campaigns().count() == 0) {
            DEFAULT_CAMPAIGNS.forEachIndexed { i, n ->
                db.campaigns().insert(Campaign(name = n, createdAt = System.currentTimeMillis() + i))
            }
        }
        prefs.seeded = true
    }

    suspend fun importCustomers(rows: List<ImportRow>, campaignId: Long?, overwrite: Boolean): ImportResult {
        var added = 0; var updated = 0; var skipped = 0; var linked = 0
        db.withTransaction {
            var pos = campaignId?.let { db.campaigns().maxPosition(it) } ?: 0
            for (r in rows) {
                val phone = PhoneUtil.clean(PhoneUtil.fromCell(r.phone))
                if (!PhoneUtil.isValid(phone)) { skipped++; continue }
                val key = PhoneUtil.key(phone)
                val existing = db.customers().byPhoneKey(key)
                val id: Long
                if (existing == null) {
                    id = db.customers().insert(
                        Customer(
                            name = r.name.trim().ifBlank { phone }, phone = phone, phoneKey = key,
                            company = r.company.trim(), email = r.email.trim(), location = r.location.trim(),
                            category = r.category.trim(), remarks = r.remarks.trim(),
                        )
                    )
                    added++
                } else {
                    fun pick(old: String, new: String) = if (new.isNotBlank() && (overwrite || old.isBlank())) new.trim() else old
                    val merged = existing.copy(
                        name = if (r.name.isNotBlank() && (overwrite || existing.name.isBlank() || existing.name == existing.phone)) r.name.trim() else existing.name,
                        company = pick(existing.company, r.company), email = pick(existing.email, r.email),
                        location = pick(existing.location, r.location), category = pick(existing.category, r.category),
                        remarks = pick(existing.remarks, r.remarks),
                    )
                    if (merged != existing) { db.customers().update(merged.copy(updatedAt = System.currentTimeMillis())); updated++ } else skipped++
                    id = existing.id
                }
                if (campaignId != null) {
                    if (db.campaigns().insertMember(CampaignMember(campaignId, id, ++pos)) != -1L) linked++ else pos--
                }
            }
        }
        return ImportResult(added, updated, skipped, linked)
    }

    suspend fun addToCampaign(campaignId: Long, customerIds: List<Long>): Int {
        var n = 0
        db.withTransaction {
            var pos = db.campaigns().maxPosition(campaignId)
            customerIds.forEach { if (db.campaigns().insertMember(CampaignMember(campaignId, it, ++pos)) != -1L) n++ else pos-- }
        }
        return n
    }

    /** @return null on success, otherwise an error message. */
    suspend fun saveCustomer(c: Customer): Pair<Long?, String?> {
        val phone = PhoneUtil.clean(c.phone)
        if (c.name.isBlank()) return null to "Name is required"
        if (!PhoneUtil.isValid(phone)) return null to "Enter a valid mobile number"
        val fixed = c.copy(phone = phone, phoneKey = PhoneUtil.key(phone), updatedAt = System.currentTimeMillis())
        val dup = db.customers().byPhoneKey(fixed.phoneKey)
        if (dup != null && dup.id != c.id) return null to "This number already belongs to ${dup.name}"
        return try {
            if (c.id == 0L) db.customers().insert(fixed) to null
            else { db.customers().update(fixed); c.id to null }
        } catch (e: SQLiteConstraintException) {
            null to "This number already exists"
        }
    }

    /** The calling list this customer is still pending in (prefers the list used last), if any. */
    suspend fun pendingCampaignFor(customerId: Long): Long? {
        val ids = db.campaigns().pendingCampaignsFor(customerId)
        val last = MiniDialerApp.prefs.lastCampaignId
        return if (last in ids) last else ids.firstOrNull()
    }

    /** Finds the customer with this number, or creates one. */
    suspend fun customerForNumber(number: String, name: String, remarks: String = ""): Customer? {
        val phone = PhoneUtil.clean(number)
        if (!PhoneUtil.isValid(phone)) return null
        db.customers().byPhoneKey(PhoneUtil.key(phone))?.let { return it }
        val (id, _) = saveCustomer(Customer(name = name.trim().ifBlank { phone }, phone = phone, phoneKey = "", remarks = remarks))
        return id?.let { db.customers().get(it) }
    }

    suspend fun deleteCustomer(ctx: Context, c: Customer) {
        db.followUps().pendingForCustomer(c.id).forEach { FollowUpScheduler.cancel(ctx, it.id) }
        db.customers().delete(c)
    }

    data class CallInput(
        val customerId: Long,
        val campaignId: Long?,
        val phone: String,
        val startedAt: Long,
        val durationSec: Int,
        val outcome: Outcome,
        val remarks: String,
        val fromCallLog: Boolean,
        val callbackAt: Long?,
        val callbackNote: String,
        val completeFollowUpIds: List<Long>,
        /** Founder OS disposition key when it is not one of the built-in outcomes. */
        val outcomeKey: String? = null,
        val connectedOverride: Boolean? = null,
        /** Set for calls placed by the auto dialer (queue item, manual dial, auto-save). */
        val dialer: DialerMeta? = null,
    )

    data class DialerMeta(val queueId: String?, val serverCustomerId: String?, val manual: Boolean, val autoSaved: Boolean)

    suspend fun saveCall(ctx: Context, input: CallInput): Long {
        var newFuId: Long? = null
        val now = System.currentTimeMillis()
        val key = input.outcomeKey ?: input.outcome.name
        val callId = db.withTransaction {
            val id = db.calls().insert(
                CallRecord(
                    customerId = input.customerId, campaignId = input.campaignId, phone = input.phone,
                    startedAt = input.startedAt, durationSec = input.durationSec, outcome = key,
                    connected = input.connectedOverride ?: input.outcome.connected, remarks = input.remarks.trim(),
                    fromCallLog = input.fromCallLog,
                )
            )
            input.dialer?.let { m ->
                db.sync().putCallSync(CallSync(id, m.queueId, m.serverCustomerId, m.manual, m.autoSaved, input.callbackAt))
            }
            input.campaignId?.let {
                db.campaigns().markCalled(it, input.customerId, MemberStatus.DONE, key, now)
            }
            if (input.completeFollowUpIds.isNotEmpty()) db.followUps().complete(input.completeFollowUpIds, now)
            if (input.callbackAt != null) {
                newFuId = db.followUps().insert(
                    FollowUp(
                        customerId = input.customerId, callId = id, campaignId = input.campaignId,
                        dueAt = input.callbackAt, note = input.callbackNote.trim().ifBlank { input.outcome.label },
                    )
                )
            }
            id
        }
        input.completeFollowUpIds.forEach { FollowUpScheduler.cancel(ctx, it) }
        newFuId?.let { id -> db.followUps().get(id)?.let { FollowUpScheduler.schedule(ctx, it) } }
        Outbox.enqueueCall(callId)
        return callId
    }

    suspend fun addFollowUp(ctx: Context, fu: FollowUp): Long {
        val id = db.followUps().insert(fu)
        FollowUpScheduler.schedule(ctx, fu.copy(id = id))
        return id
    }

    suspend fun completeFollowUp(ctx: Context, fu: FollowUp) {
        db.followUps().update(fu.copy(status = FuStatus.DONE, completedAt = System.currentTimeMillis()))
        FollowUpScheduler.cancel(ctx, fu.id)
    }

    suspend fun reopenFollowUp(ctx: Context, fu: FollowUp) {
        val updated = fu.copy(status = FuStatus.PENDING, completedAt = null)
        db.followUps().update(updated)
        FollowUpScheduler.schedule(ctx, updated)
    }

    suspend fun rescheduleFollowUp(ctx: Context, fu: FollowUp, dueAt: Long, note: String = fu.note) {
        val updated = fu.copy(dueAt = dueAt, note = note, status = FuStatus.PENDING, completedAt = null)
        db.followUps().update(updated)
        FollowUpScheduler.schedule(ctx, updated)
    }

    suspend fun deleteFollowUp(ctx: Context, fu: FollowUp) {
        FollowUpScheduler.cancel(ctx, fu.id)
        db.followUps().delete(fu)
    }

    fun recordingsDir(ctx: Context): File = File(ctx.filesDir, "recordings").apply { mkdirs() }

    fun recordingFile(ctx: Context, r: Recording): File = File(recordingsDir(ctx), r.fileName)

    suspend fun deleteRecording(ctx: Context, r: Recording) {
        recordingFile(ctx, r).delete()
        db.recordings().delete(r)
    }
}
