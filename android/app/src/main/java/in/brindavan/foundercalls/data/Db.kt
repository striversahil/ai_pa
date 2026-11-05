package in.brindavan.foundercalls.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Update
import kotlinx.coroutines.flow.Flow
import java.util.UUID

enum class Direction { IN, OUT, UNKNOWN }

enum class CallStatus { CONNECTED, MISSED, REJECTED, BLOCKED, FAILED, RINGING, DIALING }

enum class RecordingVerdict { OK, SILENT, EMPTY, ERROR }

@Entity(tableName = "call_events")
data class CallEventEntity(
    @PrimaryKey val id: String = UUID.randomUUID().toString(),
    val deviceId: String,
    val direction: Direction,
    val numberE164: String,
    val contactName: String = "",
    val attemptAt: Long,
    val ringStartAt: Long? = null,
    val connectAt: Long? = null,
    val endAt: Long? = null,
    val status: CallStatus = CallStatus.FAILED,
    val callLogType: Int? = null,
    val durationSec: Int = 0,
    val ringSec: Int = 0,
    val simSlot: Int? = null,
    val istDay: String,
    val recordingPath: String? = null,
    val recordingBytes: Long = 0,
    val maxAmplitude: Int = 0,
    val audioSource: String? = null,
    val userFarSideScore: Int? = null,
    val note: String = "",
    val synced: Boolean = false,
    val serverId: String? = null,
    val recordingUploaded: Boolean = false,
    val recordingParts: Int = 0,
    val createdAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "recording_attempts")
data class RecordingAttemptEntity(
    @PrimaryKey val id: String = UUID.randomUUID().toString(),
    val callId: String,
    val audioSource: String,
    val startedAt: Long,
    val endedAt: Long? = null,
    val bytes: Long = 0,
    val maxAmplitude: Int = 0,
    val verdict: RecordingVerdict? = null,
    val errorText: String = "",
)

@Dao
interface CallDao {
    @Insert suspend fun insert(call: CallEventEntity): Long
    @Update suspend fun update(call: CallEventEntity)
    @Query("SELECT * FROM call_events WHERE id = :id") suspend fun get(id: String): CallEventEntity?
    @Query("SELECT * FROM call_events ORDER BY attemptAt DESC") fun observeAll(): Flow<List<CallEventEntity>>
    @Query("SELECT * FROM call_events ORDER BY attemptAt DESC LIMIT 1") suspend fun latest(): CallEventEntity?
    @Query("SELECT * FROM call_events WHERE synced = 0 ORDER BY attemptAt ASC LIMIT :limit") suspend fun unsynced(limit: Int): List<CallEventEntity>
    @Query("SELECT COUNT(*) FROM call_events WHERE audioSource = :source AND userFarSideScore IS NOT NULL") suspend fun scoredCount(source: String): Int
    @Query("SELECT AVG(userFarSideScore) FROM call_events WHERE audioSource = :source AND userFarSideScore IS NOT NULL") suspend fun averageScore(source: String): Double?
    @Query("SELECT * FROM call_events WHERE status = 'CONNECTED' ORDER BY attemptAt DESC") suspend fun connected(): List<CallEventEntity>
    @Query("SELECT * FROM call_events ORDER BY attemptAt DESC") suspend fun allOnce(): List<CallEventEntity>
    @Query("SELECT * FROM call_events WHERE recordingPath IS NOT NULL AND recordingUploaded = 0 ORDER BY attemptAt ASC LIMIT :limit") suspend fun pendingRecordings(limit: Int): List<CallEventEntity>

    // 7-day offline queue: drop fully-synced rows past the window and delete their audio.
    @Query("SELECT * FROM call_events WHERE synced = 1 AND recordingUploaded = 1 AND attemptAt < :cutoff") suspend fun purgeable(cutoff: Long): List<CallEventEntity>
    @Query("DELETE FROM call_events WHERE synced = 1 AND recordingUploaded = 1 AND attemptAt < :cutoff") suspend fun purgeSyncedOlderThan(cutoff: Long)
    @Query("DELETE FROM recording_attempts WHERE callId NOT IN (SELECT id FROM call_events)") suspend fun purgeOrphanAttempts()

    @Insert suspend fun insertAttempt(attempt: RecordingAttemptEntity): Long
    @Query("SELECT * FROM recording_attempts WHERE callId = :callId") suspend fun attemptsFor(callId: String): List<RecordingAttemptEntity>

    @Query("SELECT * FROM call_events WHERE istDay = :day ORDER BY attemptAt DESC") fun observeDay(day: String): Flow<List<CallEventEntity>>
}

@Database(entities = [CallEventEntity::class, RecordingAttemptEntity::class], version = 1, exportSchema = true)
abstract class AppDatabase : RoomDatabase() {
    abstract fun calls(): CallDao

    companion object {
        fun build(context: Context): AppDatabase =
            Room.databaseBuilder(context, AppDatabase::class.java, "founder-calls.db")
                .fallbackToDestructiveMigration()
                .build()
    }
}
