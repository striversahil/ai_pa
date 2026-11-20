package com.miniautodialer.app.data

import androidx.compose.ui.graphics.Color
import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

object MemberStatus {
    const val PENDING = "PENDING"
    const val DONE = "DONE"
}

object FuStatus {
    const val PENDING = "PENDING"
    const val DONE = "DONE"
}

/** All call outcomes the business tracks. `connected` = the customer was actually reached. */
enum class Outcome(val label: String, val connected: Boolean, val color: Color) {
    CONNECTED("Connected", true, Color(0xFF16A34A)),
    BUSY("Busy", false, Color(0xFFEA580C)),
    NOT_ANSWERED("Not Answered", false, Color(0xFF64748B)),
    REJECTED("Rejected", false, Color(0xFFDC2626)),
    FAILED("Call Failed", false, Color(0xFF7F1D1D)),
    INTERESTED("Interested", true, Color(0xFF0D9488)),
    NOT_INTERESTED("Not Interested", true, Color(0xFF92400E)),
    CALLBACK("Callback Required", true, Color(0xFF2563EB)),
    WRONG_NUMBER("Wrong Number", false, Color(0xFF7C3AED)),
    FOLLOW_UP("Follow-up Required", true, Color(0xFF4F46E5));

    companion object {
        fun of(name: String?): Outcome? = entries.firstOrNull { it.name == name }
        /**
         * Best guess from the call-log talk time. Operators often "connect" a declined or unanswered call
         * to a network announcement, so a short talk time does not prove the customer answered:
         * below [askBelowSec] we return null and the user must choose.
         */
        fun suggest(durationSec: Int, askBelowSec: Int): Outcome? = when {
            durationSec <= 0 -> NOT_ANSWERED
            durationSec < askBelowSec -> null
            else -> CONNECTED
        }

        /** Outcomes that are typically worth re-dialling. */
        val RETRY = listOf(BUSY, NOT_ANSWERED, REJECTED, FAILED)
    }
}

@Entity(
    tableName = "customers",
    indices = [Index(value = ["phoneKey"], unique = true), Index("name")]
)
data class Customer(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val phone: String,
    /** Last 10 digits of the number; used for de-duplication and matching. */
    val phoneKey: String,
    val company: String = "",
    val email: String = "",
    val location: String = "",
    val category: String = "",
    val remarks: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "campaigns")
data class Campaign(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val description: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    /** Where calling stopped last time, so the list can be resumed. */
    val lastCustomerId: Long? = null,
)

@Entity(
    tableName = "campaign_members",
    primaryKeys = ["campaignId", "customerId"],
    foreignKeys = [
        ForeignKey(entity = Campaign::class, parentColumns = ["id"], childColumns = ["campaignId"], onDelete = ForeignKey.CASCADE),
        ForeignKey(entity = Customer::class, parentColumns = ["id"], childColumns = ["customerId"], onDelete = ForeignKey.CASCADE),
    ],
    indices = [Index("customerId")]
)
data class CampaignMember(
    val campaignId: Long,
    val customerId: Long,
    val position: Int,
    val status: String = MemberStatus.PENDING,
    val lastOutcome: String? = null,
    val attempts: Int = 0,
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(
    tableName = "calls",
    foreignKeys = [
        ForeignKey(entity = Customer::class, parentColumns = ["id"], childColumns = ["customerId"], onDelete = ForeignKey.CASCADE),
        ForeignKey(entity = Campaign::class, parentColumns = ["id"], childColumns = ["campaignId"], onDelete = ForeignKey.SET_NULL),
    ],
    indices = [Index("customerId"), Index("campaignId"), Index("startedAt")]
)
data class CallRecord(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val customerId: Long,
    val campaignId: Long?,
    val phone: String,
    val startedAt: Long,
    val durationSec: Int,
    val outcome: String,
    val connected: Boolean,
    val remarks: String = "",
    /** True when duration came from the Android call log rather than manual entry. */
    val fromCallLog: Boolean = false,
) {
    /** Reached the customer: decided by the outcome only (talk time can be a network announcement). */
    val reached: Boolean get() = Outcome.of(outcome)?.connected == true
}

@Entity(
    tableName = "followups",
    foreignKeys = [
        ForeignKey(entity = Customer::class, parentColumns = ["id"], childColumns = ["customerId"], onDelete = ForeignKey.CASCADE),
        ForeignKey(entity = CallRecord::class, parentColumns = ["id"], childColumns = ["callId"], onDelete = ForeignKey.SET_NULL),
    ],
    indices = [Index("customerId"), Index("callId"), Index("dueAt")]
)
data class FollowUp(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val customerId: Long,
    val callId: Long? = null,
    val campaignId: Long? = null,
    val dueAt: Long,
    val note: String = "",
    val status: String = FuStatus.PENDING,
    val completedAt: Long? = null,
    val createdAt: Long = System.currentTimeMillis(),
)

@Entity(
    tableName = "recordings",
    foreignKeys = [
        ForeignKey(entity = Customer::class, parentColumns = ["id"], childColumns = ["customerId"], onDelete = ForeignKey.SET_NULL),
        ForeignKey(entity = CallRecord::class, parentColumns = ["id"], childColumns = ["callId"], onDelete = ForeignKey.SET_NULL),
    ],
    indices = [Index("customerId"), Index("callId"), Index(value = ["sourceKey"], unique = true)]
)
data class Recording(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val customerId: Long?,
    val callId: Long?,
    val displayName: String,
    /** File name inside the app's private recordings folder. */
    val fileName: String,
    /** Original file name + size, prevents importing the same file twice. */
    val sourceKey: String,
    val sizeBytes: Long,
    val durationMs: Long,
    val recordedAt: Long,
    val importedAt: Long = System.currentTimeMillis(),
    /** Digits found in the original file name, if any. */
    val phoneHint: String = "",
)

// ---- Query result rows ----

data class CustomerRow(
    @Embedded val customer: Customer,
    val lastOutcome: String?,
    val lastCallAt: Long?,
)

data class MemberRow(
    @Embedded val customer: Customer,
    val mStatus: String,
    val mLastOutcome: String?,
    val mPosition: Int,
    val mAttempts: Int,
)

data class CampaignStats(
    @Embedded val campaign: Campaign,
    val total: Int,
    val done: Int,
)

data class CallRow(
    @Embedded val call: CallRecord,
    val customerName: String?,
    val company: String?,
    val campaignName: String?,
)

data class FollowUpRow(
    @Embedded val fu: FollowUp,
    val customerName: String,
    val customerPhone: String,
    val company: String,
)

data class RecordingRow(
    @Embedded val rec: Recording,
    val customerName: String?,
    val customerPhone: String?,
)
