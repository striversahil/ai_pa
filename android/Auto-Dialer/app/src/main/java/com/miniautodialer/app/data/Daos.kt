package com.miniautodialer.app.data

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

const val CUSTOMER_ROWS = """
SELECT c.*,
  (SELECT k.outcome FROM calls k WHERE k.customerId = c.id ORDER BY k.startedAt DESC LIMIT 1) AS lastOutcome,
  (SELECT MAX(k.startedAt) FROM calls k WHERE k.customerId = c.id) AS lastCallAt
FROM customers c
WHERE (:q = '' OR c.name LIKE '%' || :q || '%' OR c.phone LIKE '%' || :q || '%'
       OR c.company LIKE '%' || :q || '%' OR c.location LIKE '%' || :q || '%')
  AND (:cat = '' OR c.category = :cat)
ORDER BY c.name COLLATE NOCASE
"""

@Dao
interface CustomerDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(c: Customer): Long

    @Update
    suspend fun update(c: Customer)

    @Delete
    suspend fun delete(c: Customer)

    @Query("SELECT * FROM customers WHERE id = :id")
    fun observe(id: Long): Flow<Customer?>

    @Query("SELECT * FROM customers WHERE id = :id")
    suspend fun get(id: Long): Customer?

    @Query("SELECT * FROM customers WHERE phoneKey = :key LIMIT 1")
    suspend fun byPhoneKey(key: String): Customer?

    @Query("SELECT * FROM customers ORDER BY name COLLATE NOCASE")
    suspend fun all(): List<Customer>

    /** Dial-pad suggestions: customers whose number contains the typed digits. */
    @Query("SELECT * FROM customers WHERE phone LIKE '%' || :digits || '%' ORDER BY name COLLATE NOCASE LIMIT 5")
    suspend fun byDigits(digits: String): List<Customer>

    @Query(CUSTOMER_ROWS)
    fun rows(q: String, cat: String): Flow<List<CustomerRow>>

    @Query("SELECT DISTINCT category FROM customers WHERE category <> '' ORDER BY category")
    fun categories(): Flow<List<String>>

    @Query("SELECT COUNT(*) FROM customers")
    fun count(): Flow<Int>
}

const val MEMBER_ROWS = """
SELECT c.*, m.status AS mStatus, m.lastOutcome AS mLastOutcome, m.position AS mPosition, m.attempts AS mAttempts
FROM campaign_members m JOIN customers c ON c.id = m.customerId
WHERE m.campaignId = :cid ORDER BY m.position
"""

@Dao
interface CampaignDao {
    @Insert
    suspend fun insert(c: Campaign): Long

    @Update
    suspend fun update(c: Campaign)

    @Delete
    suspend fun delete(c: Campaign)

    @Query("SELECT * FROM campaigns WHERE id = :id")
    fun observe(id: Long): Flow<Campaign?>

    @Query("SELECT * FROM campaigns WHERE id = :id")
    suspend fun get(id: Long): Campaign?

    @Query("SELECT * FROM campaigns ORDER BY name COLLATE NOCASE")
    fun all(): Flow<List<Campaign>>

    @Query("SELECT * FROM campaigns ORDER BY name COLLATE NOCASE")
    suspend fun allOnce(): List<Campaign>

    @Query("SELECT COUNT(*) FROM campaigns")
    suspend fun count(): Int

    @Query(
        """SELECT cp.*,
        (SELECT COUNT(*) FROM campaign_members m WHERE m.campaignId = cp.id) AS total,
        (SELECT COUNT(*) FROM campaign_members m WHERE m.campaignId = cp.id AND m.status = 'DONE') AS done
        FROM campaigns cp ORDER BY cp.createdAt"""
    )
    fun withStats(): Flow<List<CampaignStats>>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertMember(m: CampaignMember): Long

    @Query("SELECT COALESCE(MAX(position), 0) FROM campaign_members WHERE campaignId = :cid")
    suspend fun maxPosition(cid: Long): Int

    @Query(MEMBER_ROWS)
    fun members(cid: Long): Flow<List<MemberRow>>

    @Query(MEMBER_ROWS)
    suspend fun membersOnce(cid: Long): List<MemberRow>

    @Query(
        """UPDATE campaign_members SET status = :status, lastOutcome = :outcome, attempts = attempts + 1, updatedAt = :ts
        WHERE campaignId = :cid AND customerId = :customerId"""
    )
    suspend fun markCalled(cid: Long, customerId: Long, status: String, outcome: String, ts: Long)

    @Query("UPDATE campaign_members SET lastOutcome = :outcome WHERE campaignId = :cid AND customerId = :customerId")
    suspend fun setLastOutcome(cid: Long, customerId: Long, outcome: String)

    @Query("SELECT campaignId FROM campaign_members WHERE customerId = :customerId AND status = 'PENDING'")
    suspend fun pendingCampaignsFor(customerId: Long): List<Long>

    @Query("UPDATE campaign_members SET status = :status WHERE campaignId = :cid AND customerId = :customerId")
    suspend fun setStatus(cid: Long, customerId: Long, status: String)

    @Query("UPDATE campaign_members SET status = 'PENDING' WHERE campaignId = :cid AND lastOutcome IN (:outcomes)")
    suspend fun resetOutcomes(cid: Long, outcomes: List<String>)

    @Query("UPDATE campaign_members SET status = 'PENDING' WHERE campaignId = :cid")
    suspend fun resetAll(cid: Long)

    @Query("DELETE FROM campaign_members WHERE campaignId = :cid AND customerId = :customerId")
    suspend fun removeMember(cid: Long, customerId: Long)

    @Query("SELECT cp.* FROM campaigns cp JOIN campaign_members m ON m.campaignId = cp.id WHERE m.customerId = :customerId ORDER BY cp.name")
    fun campaignsOf(customerId: Long): Flow<List<Campaign>>
}

const val CALL_ROWS = """
SELECT k.*, c.name AS customerName, c.company AS company, cp.name AS campaignName
FROM calls k LEFT JOIN customers c ON c.id = k.customerId LEFT JOIN campaigns cp ON cp.id = k.campaignId
"""

@Dao
interface CallDao {
    @Insert
    suspend fun insert(c: CallRecord): Long

    @Update
    suspend fun update(c: CallRecord)

    @Delete
    suspend fun delete(c: CallRecord)

    @Query("SELECT * FROM calls WHERE customerId = :customerId ORDER BY startedAt DESC")
    fun forCustomer(customerId: Long): Flow<List<CallRecord>>

    @Query("SELECT * FROM calls WHERE customerId = :customerId ORDER BY startedAt DESC LIMIT :limit")
    suspend fun recentForCustomer(customerId: Long, limit: Int): List<CallRecord>

    @Query("SELECT * FROM calls WHERE startedAt BETWEEN :from AND :to")
    fun observeRange(from: Long, to: Long): Flow<List<CallRecord>>

    @Query(CALL_ROWS + " WHERE k.startedAt BETWEEN :from AND :to ORDER BY k.startedAt")
    suspend fun rowsInRange(from: Long, to: Long): List<CallRow>

    @Query(CALL_ROWS + " WHERE k.campaignId = :cid ORDER BY k.startedAt")
    suspend fun rowsForCampaign(cid: Long): List<CallRow>

    @Query("SELECT * FROM calls WHERE startedAt BETWEEN :from AND :to ORDER BY startedAt DESC")
    suspend fun between(from: Long, to: Long): List<CallRecord>

    @Query("SELECT * FROM calls WHERE id = :id")
    suspend fun get(id: Long): CallRecord?

    @Query("SELECT COUNT(*) FROM calls WHERE customerId = :customerId AND startedAt BETWEEN :from AND :to")
    suspend fun countNear(customerId: Long, from: Long, to: Long): Int
}

const val FU_ROWS = """
SELECT f.*, c.name AS customerName, c.phone AS customerPhone, c.company AS company
FROM followups f JOIN customers c ON c.id = f.customerId
"""

@Dao
interface FollowUpDao {
    @Insert
    suspend fun insert(f: FollowUp): Long

    @Update
    suspend fun update(f: FollowUp)

    @Delete
    suspend fun delete(f: FollowUp)

    @Query("SELECT * FROM followups WHERE id = :id")
    suspend fun get(id: Long): FollowUp?

    @Query(FU_ROWS + " WHERE f.status = 'PENDING' AND f.dueAt >= :from AND f.dueAt < :to ORDER BY f.dueAt")
    fun pendingBetween(from: Long, to: Long): Flow<List<FollowUpRow>>

    @Query(FU_ROWS + " WHERE f.status = 'DONE' ORDER BY f.completedAt DESC LIMIT 500")
    fun completed(): Flow<List<FollowUpRow>>

    @Query("SELECT * FROM followups WHERE status = 'PENDING'")
    suspend fun allPending(): List<FollowUp>

    @Query("SELECT * FROM followups WHERE customerId = :customerId ORDER BY dueAt DESC")
    fun forCustomer(customerId: Long): Flow<List<FollowUp>>

    @Query("SELECT * FROM followups WHERE customerId = :customerId AND status = 'PENDING' ORDER BY dueAt")
    suspend fun pendingForCustomer(customerId: Long): List<FollowUp>

    @Query("SELECT COUNT(*) FROM followups WHERE status = 'PENDING'")
    fun pendingCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM followups WHERE status = 'PENDING' AND dueAt < :to")
    fun pendingDueBefore(to: Long): Flow<Int>

    @Query("UPDATE followups SET status = 'DONE', completedAt = :ts WHERE id IN (:ids)")
    suspend fun complete(ids: List<Long>, ts: Long)
}

const val REC_ROWS = """
SELECT r.*, c.name AS customerName, c.phone AS customerPhone
FROM recordings r LEFT JOIN customers c ON c.id = r.customerId
WHERE (:unassigned = 0 OR r.customerId IS NULL)
  AND (:q = '' OR r.displayName LIKE '%' || :q || '%' OR r.phoneHint LIKE '%' || :q || '%'
       OR c.name LIKE '%' || :q || '%' OR c.phone LIKE '%' || :q || '%' OR c.phoneKey LIKE '%' || :q || '%')
ORDER BY r.recordedAt DESC
"""

@Dao
interface RecordingDao {
    @Insert
    suspend fun insert(r: Recording): Long

    @Update
    suspend fun update(r: Recording)

    @Delete
    suspend fun delete(r: Recording)

    @Query("SELECT * FROM recordings WHERE id = :id")
    suspend fun get(id: Long): Recording?

    @Query("SELECT COUNT(*) FROM recordings WHERE sourceKey = :key")
    suspend fun countBySource(key: String): Int

    @Query(REC_ROWS)
    fun search(q: String, unassigned: Int): Flow<List<RecordingRow>>

    @Query("SELECT * FROM recordings WHERE customerId = :customerId ORDER BY recordedAt DESC")
    fun forCustomer(customerId: Long): Flow<List<Recording>>

    @Query("SELECT COUNT(*) FROM recordings")
    fun count(): Flow<Int>

    @Query("SELECT * FROM recordings")
    suspend fun all(): List<Recording>
}
