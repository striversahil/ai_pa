package com.miniautodialer.app.util

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.data.Customer
import com.miniautodialer.app.data.Recording
import com.miniautodialer.app.data.Repo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.time.LocalDateTime
import java.util.UUID
import kotlin.math.abs

data class ScanResult(val imported: Int, val matched: Int, val ignored: Int, val error: String? = null) {
    fun message(): String = error ?: when {
        imported == 0 -> "No new customer recordings found"
        else -> "Imported $imported recording(s), $matched linked to customers"
    }
}

/**
 * Imports call recordings made by the phone's own (built-in) call recorder or another recorder app.
 * Android does not allow ordinary apps to capture call audio, so this app works with the files
 * the device's legitimate recorder produces, and links them to customers automatically.
 *
 * Known file name styles:
 *  - Realme / Oppo / OnePlus (ColorOS): "Name-2605291221.awb", "+919810202603-2606291659-1.awb" (yyMMddHHmm)
 *  - Samsung: "Call recording Name_241118_143005.m4a" (yyMMdd_HHmmss)
 *  - Xiaomi: "Name(+919876543210)_20241118143005.mp3"
 *  - Generic: 2024-11-18 14-30-05, 20241118_143005
 */
object RecordingImporter {
    private val AUDIO_EXT = setOf("mp3", "m4a", "amr", "aac", "wav", "ogg", "3gp", "3gpp", "opus", "awb", "mp4", "flac", "webm", "3ga")
    private val mutex = Mutex()

    private data class Doc(val uri: Uri, val name: String, val size: Long, val modified: Long)
    private data class Match(val customerId: Long?, val callId: Long?)

    /** Data loaded once per scan (thousands of files must not each hit the DB for customers). */
    private class ScanCtx(customers: List<Customer>, val existing: MutableSet<String>) {
        val byKey: Map<String, Customer> = customers.associateBy { it.phoneKey }
        val byName: List<Pair<String, Customer>> = customers
            .map { normalize(it.name) to it }
            .filter { it.first.length >= 4 && !it.first.all(Char::isDigit) }
    }

    fun isAudio(name: String) = name.substringAfterLast('.', "").lowercase() in AUDIO_EXT

    private suspend fun newCtx(): ScanCtx {
        val db = MiniDialerApp.db
        return ScanCtx(db.customers().all(), db.recordings().all().map { it.sourceKey }.toHashSet())
    }

    /** Permission that lets the app see every audio file in shared storage (any folder, any brand). */
    val audioPermission: String
        get() = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO else Manifest.permission.READ_EXTERNAL_STORAGE

    fun hasAudioAccess(ctx: Context) =
        ContextCompat.checkSelfPermission(ctx, audioPermission) == PackageManager.PERMISSION_GRANTED

    /** True when recordings can be found without the user doing anything. */
    fun canAutoFind(ctx: Context) = hasAudioAccess(ctx) || MiniDialerApp.prefs.recordingFolder != null

    /**
     * Finds new call recordings automatically:
     *  1. Android's media index, which lists audio saved by any recorder in any folder (no folder setup needed);
     *  2. the optional folder chosen by the user (for recorders whose files are not in the media index).
     * @param fullHistory true = look at all files (not only recent ones) and import only those matching a customer.
     */
    suspend fun scan(ctx: Context, fullHistory: Boolean = false): ScanResult = withContext(Dispatchers.IO) {
        mutex.withLock {
            val prefs = MiniDialerApp.prefs
            if (!canAutoFind(ctx)) return@withLock ScanResult(0, 0, 0, "Allow access to audio files so the app can find call recordings")
            // first scan: pick up the last 7 days; later scans only see newer files
            if (prefs.scanSince == 0L) prefs.scanSince = System.currentTimeMillis() - 7 * 86_400_000L
            val since = if (fullHistory) 0L else prefs.scanSince
            val sc = newCtx()
            var imported = 0; var matched = 0; var ignored = 0
            var error: String? = null
            fun count(r: Int) { when (r) { 1 -> { imported++; matched++ }; 0 -> imported++; -2 -> ignored++ } }

            if (hasAudioAccess(ctx)) {
                for ((d, callish) in mediaStoreAudio(ctx, since)) {
                    if (!callish && !mentionsCustomer(sc, d.name)) continue   // music, voice notes, ringtones...
                    count(importOne(ctx, sc, d, null, requireMatch = fullHistory || !callish || !prefs.scanImportAll, allowTimeMatch = callish))
                }
            }
            prefs.recordingFolder?.let { folder ->
                val tree = Uri.parse(folder)
                val docs = ArrayList<Doc>()
                try {
                    listTree(ctx, tree, DocumentsContract.getTreeDocumentId(tree), 0, docs)
                } catch (e: Exception) {
                    if (!hasAudioAccess(ctx)) error = "Cannot read the recordings folder (permission lost?). Choose it again in Settings."
                }
                for (d in docs.sortedBy { it.modified }) {
                    if (d.modified in 1 until since) continue
                    count(importOne(ctx, sc, d, null, requireMatch = fullHistory || !prefs.scanImportAll))
                }
            }
            prefs.lastScanAt = System.currentTimeMillis()
            ScanResult(imported, matched, ignored, error.takeIf { imported == 0 })
        }
    }

    /** Folder or file name that says "call" (Call Recordings, call_rec, CallRecord, "Call recording ..."). */
    private val CALLISH = Regex("call|phonerecord|通话|anruf|appel|llamada", RegexOption.IGNORE_CASE)

    private fun mentionsCustomer(sc: ScanCtx, name: String): Boolean {
        val base = name.substringBeforeLast('.')
        phoneFromName(base)?.let { if (sc.byKey.containsKey(PhoneUtil.key(it))) return true }
        val norm = normalize(stripTime(base))
        return sc.byName.any { (n, _) -> norm == n || (n.length >= 6 && norm.contains(n)) }
    }

    /** Audio files from Android's media index, oldest first, flagged when they look like call recordings. */
    private fun mediaStoreAudio(ctx: Context, since: Long): List<Pair<Doc, Boolean>> {
        val out = ArrayList<Pair<Doc, Boolean>>()
        val uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        val pathCol = if (Build.VERSION.SDK_INT >= 29) MediaStore.MediaColumns.RELATIVE_PATH else MediaStore.MediaColumns.DATA
        val sel = "${MediaStore.MediaColumns.DATE_MODIFIED} >= ? AND ${MediaStore.Audio.AudioColumns.IS_RINGTONE} = 0 " +
            "AND ${MediaStore.Audio.AudioColumns.IS_NOTIFICATION} = 0 AND ${MediaStore.Audio.AudioColumns.IS_ALARM} = 0"
        try {
            ctx.contentResolver.query(
                uri,
                arrayOf(MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE,
                    MediaStore.MediaColumns.DATE_MODIFIED, pathCol),
                sel, arrayOf((since / 1000).toString()), "${MediaStore.MediaColumns.DATE_MODIFIED} ASC"
            )?.use { c ->
                while (c.moveToNext()) {
                    val name = c.getString(1) ?: continue
                    val path = c.getString(4).orEmpty()
                    val doc = Doc(ContentUris.withAppendedId(uri, c.getLong(0)), name, c.getLong(2), c.getLong(3) * 1000)
                    out += doc to (CALLISH.containsMatchIn(path) || CALLISH.containsMatchIn(name))
                }
            }
        } catch (_: Exception) { /* permission revoked or provider error: folder scan still runs */ }
        return out
    }

    /** Import files the user picked manually. */
    suspend fun importUris(ctx: Context, uris: List<Uri>, customerId: Long?): ScanResult = withContext(Dispatchers.IO) {
        mutex.withLock {
            val sc = newCtx()
            var imported = 0; var matched = 0; var dup = 0
            for (u in uris) {
                val d = queryDoc(ctx, u) ?: continue
                when (importOne(ctx, sc, d, customerId, requireMatch = false)) {
                    1 -> { imported++; matched++ }
                    0 -> imported++
                    -1 -> dup++
                }
            }
            ScanResult(imported, matched, dup, if (imported == 0 && dup > 0) "Already imported" else null)
        }
    }

    private fun listTree(ctx: Context, tree: Uri, docId: String, depth: Int, out: MutableList<Doc>) {
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId)
        ctx.contentResolver.query(
            children,
            arrayOf(
                DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED
            ), null, null, null
        )?.use { c ->
            while (c.moveToNext()) {
                val id = c.getString(0) ?: continue
                val name = c.getString(1) ?: continue
                val mime = c.getString(2) ?: ""
                if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                    if (depth < 3) listTree(ctx, tree, id, depth + 1, out)
                } else if (isAudio(name) || mime.startsWith("audio/")) {
                    out.add(Doc(DocumentsContract.buildDocumentUriUsingTree(tree, id), name, c.getLong(3), c.getLong(4)))
                }
            }
        }
    }

    private fun queryDoc(ctx: Context, uri: Uri): Doc? = try {
        ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
            if (!c.moveToFirst()) return null
            val ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val si = c.getColumnIndex(OpenableColumns.SIZE)
            val mi = c.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
            Doc(
                uri,
                if (ni >= 0) c.getString(ni) ?: "recording" else "recording",
                if (si >= 0 && !c.isNull(si)) c.getLong(si) else 0L,
                if (mi >= 0 && !c.isNull(mi)) c.getLong(mi) else 0L,
            )
        }
    } catch (_: Exception) { null }

    /** @return 1 imported+matched, 0 imported unmatched, -1 duplicate, -2 skipped (no match), -3 error */
    private suspend fun importOne(ctx: Context, sc: ScanCtx, d: Doc, forcedCustomer: Long?, requireMatch: Boolean, allowTimeMatch: Boolean = true): Int {
        val db = MiniDialerApp.db
        val sourceKey = "${d.name}|${d.size}"
        if (sourceKey in sc.existing) return -1
        val base = d.name.substringBeforeLast('.')
        val nameTime = timeFromName(base)
        val time = nameTime ?: d.modified.takeIf { it > 0 } ?: System.currentTimeMillis()
        val digits = phoneFromName(base)
        val match = if (forcedCustomer != null) Match(forcedCustomer, findCall(forcedCustomer, time)) else match(sc, base, digits, time, allowTimeMatch)
        if (requireMatch && match.customerId == null) return -2

        val ext = d.name.substringAfterLast('.', "m4a").lowercase().take(5)
        val fileName = "${UUID.randomUUID()}.$ext"
        val dest = File(Repo.recordingsDir(ctx), fileName)
        try {
            ctx.contentResolver.openInputStream(d.uri)?.use { input -> dest.outputStream().use { input.copyTo(it) } }
                ?: return -3
        } catch (e: Exception) {
            dest.delete(); return -3
        }
        val durationMs = try {
            MediaMetadataRetriever().run {
                setDataSource(dest.absolutePath)
                val v = extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
                release(); v
            }
        } catch (_: Exception) { 0L }
        // If the time came from "last modified", that is the END of the call; shift back to the start.
        val recordedAt = if (nameTime == null && durationMs > 0) time - durationMs else time
        val recId = db.recordings().insert(
            Recording(
                customerId = match.customerId, callId = match.callId, displayName = base, fileName = fileName,
                sourceKey = sourceKey, sizeBytes = dest.length(), durationMs = durationMs, recordedAt = recordedAt,
                phoneHint = digits ?: "",
            )
        )
        // Founder OS: upload once the call itself has synced (SyncRunner checks that order).
        match.callId?.let { com.miniautodialer.app.remote.Outbox.enqueueRecording(recId, it) }
        sc.existing += sourceKey
        return if (match.customerId != null) 1 else 0
    }

    private suspend fun match(sc: ScanCtx, base: String, digits: String?, time: Long, allowTimeMatch: Boolean): Match {
        // 1. phone number in the file name
        if (digits != null) {
            val c = sc.byKey[PhoneUtil.key(digits)]
            if (c != null) return Match(c.id, findCall(c.id, time))
        }
        // 2. contact name in the file name (built-in recorders use the phone-book name)
        val norm = normalize(stripTime(base))
        val byName = sc.byName.filter { (n, _) -> norm == n || (n.length >= 6 && norm.contains(n)) }
        if (byName.size == 1) return Match(byName[0].second.id, findCall(byName[0].second.id, time))
        // 3. a call we logged at the same time (only when the file name has no other number)
        if (digits == null && allowTimeMatch) {
            val calls = MiniDialerApp.db.calls().between(time - 3 * 3600_000L, time + 10 * 60_000L)
            val best = calls.filter { k -> inWindow(time, k.startedAt, k.durationSec) }.minByOrNull { abs(it.startedAt - time) }
            if (best != null) return Match(best.customerId, best.id)
        }
        return Match(null, null)
    }

    private fun inWindow(time: Long, startedAt: Long, durationSec: Int) =
        time >= startedAt - 120_000 && time <= startedAt + durationSec * 1000L + 300_000

    private suspend fun findCall(customerId: Long, time: Long): Long? =
        MiniDialerApp.db.calls().between(time - 3 * 3600_000L, time + 10 * 60_000L)
            .filter { it.customerId == customerId && inWindow(time, it.startedAt, it.durationSec) }
            .minByOrNull { abs(it.startedAt - time) }?.id

    private fun normalize(s: String) = s.lowercase().filter { it.isLetterOrDigit() }

    private enum class Style { FULL, SAMSUNG, COLOR_OS }

    private val TIME_PATTERNS = listOf(
        // Realme/Oppo/OnePlus: "-2605291221" or "-2605291221-1" at the end (yyMMddHHmm)
        Regex("-(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(?:-\\d{1,3})?$") to Style.COLOR_OS,
        // 20241118_143005 / 20241118143005 / 2024-11-18 14-30-05 / 2024-11-18_14.30.05
        Regex("(20\\d{2})[-_.]?(\\d{2})[-_.]?(\\d{2})[ _.-]?(\\d{2})[-_.:]?(\\d{2})[-_.:]?(\\d{2})") to Style.FULL,
        // 241118_143005 (Samsung: yyMMdd_HHmmss)
        Regex("(?<!\\d)(\\d{2})(\\d{2})(\\d{2})_(\\d{2})(\\d{2})(\\d{2})(?!\\d)") to Style.SAMSUNG,
    )

    // Google Phone: "record-1795149343731" = Unix time in milliseconds, not a phone number
    private val EPOCH_MS = Regex("(?<!\\d)1\\d{12}(?!\\d)")

    private fun timeMatch(base: String): Pair<Long, IntRange>? {
        for (m in EPOCH_MS.findAll(base)) {
            val t = m.value.toLong()
            if (t >= 1_400_000_000_000L && t <= System.currentTimeMillis() + 86_400_000L) return t to m.range
        }
        for ((re, style) in TIME_PATTERNS) {
            for (m in re.findAll(base)) {
                val g = m.groupValues
                val y = if (style == Style.FULL) g[1].toInt() else 2000 + g[1].toInt()
                val sec = if (style == Style.COLOR_OS) 0 else g[6].toInt()
                val t = runCatching {
                    Fmt.toMillis(LocalDateTime.of(y, g[2].toInt(), g[3].toInt(), g[4].toInt(), g[5].toInt(), sec))
                }.getOrNull()
                if (t != null && t <= System.currentTimeMillis() + 86_400_000L) return t to m.range
            }
        }
        return null
    }

    private fun stripTime(base: String): String = timeMatch(base)?.second?.let { base.removeRange(it) } ?: base

    fun timeFromName(base: String): Long? = timeMatch(base)?.first

    fun phoneFromName(base: String): String? =
        // digits glued to letters ("sim2-98...") are not part of a phone number
        Regex("(?<![A-Za-z\\d])\\+?\\d[\\d ()-]{5,16}\\d").findAll(stripTime(base))
            .map { it.value.filter { ch -> ch.isDigit() } }
            .filter { it.length in 7..13 }
            .maxByOrNull { it.length }
}
