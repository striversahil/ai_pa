package com.miniautodialer.app.util

import android.content.Context
import android.content.Intent
import android.net.Uri
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.data.AppDatabase
import com.miniautodialer.app.data.Repo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream
import kotlin.system.exitProcess

/**
 * Full local backup (database + recordings) into one .zip file at a location the user chooses.
 * Saving it to Google Drive etc. is optional and entirely user-controlled via the system file picker.
 */
object Backup {
    private const val DB_ENTRY = "database/${AppDatabase.NAME}"

    suspend fun backup(ctx: Context, out: Uri): String = withContext(Dispatchers.IO) {
        val db = MiniDialerApp.db
        db.openHelper.writableDatabase.query("PRAGMA wal_checkpoint(FULL)").use { it.moveToFirst() }
        var files = 0
        ctx.contentResolver.openOutputStream(out)?.use { os ->
            ZipOutputStream(os.buffered()).use { z ->
                z.putNextEntry(ZipEntry("meta.txt"))
                z.write("MiniAutoDialer backup\ncreated=${Fmt.isoDateTime(System.currentTimeMillis())}\nversion=1\n".toByteArray())
                z.closeEntry()
                z.putNextEntry(ZipEntry(DB_ENTRY))
                ctx.getDatabasePath(AppDatabase.NAME).inputStream().use { it.copyTo(z) }
                z.closeEntry()
                Repo.recordingsDir(ctx).listFiles()?.forEach { f ->
                    z.putNextEntry(ZipEntry("recordings/${f.name}"))
                    f.inputStream().use { it.copyTo(z) }
                    z.closeEntry()
                    files++
                }
            }
        } ?: throw IllegalStateException("Cannot write backup file")
        "Backup saved (database + $files recordings)"
    }

    /** Validates and restores a backup, then restarts the app. */
    suspend fun restore(ctx: Context, src: Uri) = withContext(Dispatchers.IO) {
        val tmp = File(ctx.cacheDir, "restore").apply { deleteRecursively(); mkdirs() }
        var hasDb = false
        ctx.contentResolver.openInputStream(src)?.use { ins ->
            ZipInputStream(ins.buffered()).use { z ->
                var e = z.nextEntry
                while (e != null) {
                    val name = e.name
                    if (!e.isDirectory && !name.contains("..") && (name == DB_ENTRY || name.startsWith("recordings/"))) {
                        val f = File(tmp, name)
                        f.parentFile?.mkdirs()
                        f.outputStream().use { z.copyTo(it) }
                        if (name == DB_ENTRY) hasDb = true
                    }
                    e = z.nextEntry
                }
            }
        } ?: throw IllegalStateException("Cannot open backup file")
        val dbFile = File(tmp, DB_ENTRY)
        val header = if (hasDb) dbFile.inputStream().use { val b = ByteArray(16); it.read(b); String(b, Charsets.US_ASCII) } else ""
        if (!hasDb || !header.startsWith("SQLite format 3")) {
            tmp.deleteRecursively()
            throw IllegalArgumentException("This is not a Mini Auto Dialer backup file")
        }
        AppDatabase.closeInstance()
        val target = ctx.getDatabasePath(AppDatabase.NAME)
        listOf(target, File(target.path + "-wal"), File(target.path + "-shm"), File(target.path + "-journal")).forEach { it.delete() }
        dbFile.copyTo(target, overwrite = true)
        val recDir = Repo.recordingsDir(ctx)
        recDir.deleteRecursively(); recDir.mkdirs()
        File(tmp, "recordings").listFiles()?.forEach { it.copyTo(File(recDir, it.name), overwrite = true) }
        tmp.deleteRecursively()
    }

    fun restartApp(ctx: Context) {
        val intent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return
        ctx.startActivity(Intent.makeRestartActivityTask(intent.component))
        exitProcess(0)
    }
}
