package com.miniautodialer.app.remote

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.flow.Flow

/**
 * Durable outbox: every call, break and recording waits here until the server
 * confirms it. `status` = pending | done | rejected. Nothing is ever dropped
 * because the phone was offline.
 */
@Entity(tableName = "outbox")
data class OutboxItem(
    /** "call:<localCallId>" · "pcall:<callLogDate>" (phone dialer) · "break:<breakId>" · "rec:<recordingId>" */
    @PrimaryKey val id: String,
    val kind: String,
    val payload: String,
    val status: String = "pending",
    val error: String? = null,
    val attempts: Int = 0,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)

/** A lead from the Founder OS queue, cached so calling continues offline. */
@Entity(tableName = "dialer_queue")
data class QueueItem(
    @PrimaryKey val id: String,
    val customerId: String,
    val mobile: String,
    val name: String,
    val company: String,
    val place: String,
    val clientType: String,
    val source: String,
    val attempts: Int,
    val dueAt: Long,
    /** pending | done (done = disposed here, waiting for the server to settle it). */
    val localStatus: String = "pending",
    /** Order the server returned (callbacks, then retries, then pushes). */
    val position: Int = 0,
)

/** Dialer facts about a locally saved call that the plain call record does not hold. */
@Entity(tableName = "call_sync")
data class CallSync(
    @PrimaryKey val callId: Long,
    val queueId: String?,
    val serverCustomerId: String?,
    val manual: Boolean,
    val autoSaved: Boolean,
    val callbackAt: Long?,
)

@Dao
interface SyncDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putOutbox(item: OutboxItem)

    @Query("SELECT * FROM outbox WHERE id = :id")
    suspend fun outbox(id: String): OutboxItem?

    @Query("SELECT * FROM outbox WHERE status = 'pending' AND kind = :kind ORDER BY createdAt LIMIT :limit")
    suspend fun pending(kind: String, limit: Int): List<OutboxItem>

    @Query("SELECT * FROM outbox WHERE kind = :kind AND createdAt >= :since")
    suspend fun recent(kind: String, since: Long): List<OutboxItem>

    @Query("UPDATE outbox SET status = :status, error = :error, attempts = attempts + 1, updatedAt = :ts WHERE id IN (:ids)")
    suspend fun mark(ids: List<String>, status: String, error: String?, ts: Long = System.currentTimeMillis())

    @Query("SELECT COUNT(*) FROM outbox WHERE status = 'pending'")
    fun pendingCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM outbox WHERE status = 'pending'")
    suspend fun pendingCountOnce(): Int

    @Query("SELECT MIN(createdAt) FROM outbox WHERE status = 'pending'")
    suspend fun oldestPending(): Long?

    @Query("SELECT id FROM outbox WHERE status = 'done' AND kind = 'call'")
    fun syncedCallIds(): Flow<List<String>>

    @Query("DELETE FROM outbox WHERE status != 'pending' AND updatedAt < :before")
    suspend fun prune(before: Long)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putCallSync(s: CallSync)

    @Query("SELECT * FROM call_sync WHERE callId = :callId")
    suspend fun callSync(callId: Long): CallSync?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putQueue(items: List<QueueItem>)

    @Query("SELECT * FROM dialer_queue WHERE id = :id")
    suspend fun queueItem(id: String): QueueItem?

    @Query("SELECT * FROM dialer_queue WHERE localStatus = 'pending' AND dueAt <= :now ORDER BY position LIMIT 1")
    suspend fun nextDue(now: Long): QueueItem?

    @Query("SELECT * FROM dialer_queue WHERE localStatus = 'pending' ORDER BY position")
    fun waiting(): Flow<List<QueueItem>>

    @Query("UPDATE dialer_queue SET localStatus = 'done' WHERE id = :id")
    suspend fun markQueueDone(id: String)

    @Query("DELETE FROM dialer_queue WHERE id NOT IN (:keep)")
    suspend fun dropQueueExcept(keep: List<String>)

    @Query("DELETE FROM dialer_queue")
    suspend fun clearQueue()
}

/** v1 → v2: the Founder OS sync tables. Existing data is untouched. */
val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `outbox` (`id` TEXT NOT NULL, `kind` TEXT NOT NULL, `payload` TEXT NOT NULL, " +
                "`status` TEXT NOT NULL, `error` TEXT, `attempts` INTEGER NOT NULL, `createdAt` INTEGER NOT NULL, " +
                "`updatedAt` INTEGER NOT NULL, PRIMARY KEY(`id`))"
        )
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `dialer_queue` (`id` TEXT NOT NULL, `customerId` TEXT NOT NULL, `mobile` TEXT NOT NULL, " +
                "`name` TEXT NOT NULL, `company` TEXT NOT NULL, `place` TEXT NOT NULL, `clientType` TEXT NOT NULL, " +
                "`source` TEXT NOT NULL, `attempts` INTEGER NOT NULL, `dueAt` INTEGER NOT NULL, `localStatus` TEXT NOT NULL, " +
                "`position` INTEGER NOT NULL, PRIMARY KEY(`id`))"
        )
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `call_sync` (`callId` INTEGER NOT NULL, `queueId` TEXT, `serverCustomerId` TEXT, " +
                "`manual` INTEGER NOT NULL, `autoSaved` INTEGER NOT NULL, `callbackAt` INTEGER, PRIMARY KEY(`callId`))"
        )
    }
}
