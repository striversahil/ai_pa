package com.miniautodialer.app.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import com.miniautodialer.app.remote.CallSync
import com.miniautodialer.app.remote.MIGRATION_1_2
import com.miniautodialer.app.remote.OutboxItem
import com.miniautodialer.app.remote.QueueItem
import com.miniautodialer.app.remote.SyncDao

@Database(
    entities = [
        Customer::class, Campaign::class, CampaignMember::class, CallRecord::class, FollowUp::class, Recording::class,
        OutboxItem::class, QueueItem::class, CallSync::class,
    ],
    version = 2,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun customers(): CustomerDao
    abstract fun campaigns(): CampaignDao
    abstract fun calls(): CallDao
    abstract fun followUps(): FollowUpDao
    abstract fun recordings(): RecordingDao
    abstract fun sync(): SyncDao

    companion object {
        const val NAME = "minidialer.db"

        @Volatile
        private var instance: AppDatabase? = null

        fun get(ctx: Context): AppDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(ctx.applicationContext, AppDatabase::class.java, NAME)
                .addMigrations(MIGRATION_1_2)
                .build().also { instance = it }
        }

        /** Used by restore: closes the DB so its files can be replaced. */
        fun closeInstance() = synchronized(this) {
            instance?.close()
            instance = null
        }
    }
}
