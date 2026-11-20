package com.miniautodialer.app.ui.screens

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.navigation.NavHostController
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.data.*
import com.miniautodialer.app.ui.*
import com.miniautodialer.app.util.Fmt
import com.miniautodialer.app.util.RecordingImporter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

private fun exportName(r: Recording) = r.displayName.replace(Regex("[\\\\/:*?\"<>|]"), "_") + "." + r.fileName.substringAfterLast('.')

private fun shareRecording(ctx: Context, r: Recording) {
    val dir = File(ctx.cacheDir, "exports").apply { mkdirs() }
    val out = File(dir, exportName(r))
    Repo.recordingFile(ctx, r).copyTo(out, overwrite = true)
    val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".files", out)
    val i = Intent(Intent.ACTION_SEND).setType("audio/*").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    ctx.startActivity(Intent.createChooser(i, "Share recording"))
}

@Composable
fun RecordingsScreen(nav: NavHostController) {
    val db = MiniDialerApp.db
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val prefs = MiniDialerApp.prefs
    var q by rememberSaveableString()
    var unassigned by remember { mutableStateOf(false) }
    val rows by remember(q, unassigned) { db.recordings().search(q.trim(), if (unassigned) 1 else 0) }.collectAsState(null)
    var expanded by remember { mutableLongStateOf(0L) }
    var scanning by remember { mutableStateOf(false) }
    var folderSet by remember { mutableStateOf(prefs.recordingFolder != null) }
    var autoFind by remember { mutableStateOf(RecordingImporter.hasAudioAccess(ctx)) }
    val audioPermLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        autoFind = ok
        if (ok) {
            scanning = true
            scope.launch { val r = RecordingImporter.scan(ctx); scanning = false; Toast.makeText(ctx, r.message(), Toast.LENGTH_LONG).show() }
        }
    }
    var renameRec by remember { mutableStateOf<Recording?>(null) }
    var assignRec by remember { mutableStateOf<Recording?>(null) }
    var deleteRec by remember { mutableStateOf<Recording?>(null) }
    var saveRec by remember { mutableStateOf<Recording?>(null) }
    var customers by remember { mutableStateOf(emptyList<Customer>()) }

    val folderPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) {
            setRecordingFolder(ctx, uri)
            folderSet = true
            scanning = true
            scope.launch { val r = RecordingImporter.scan(ctx); scanning = false; Toast.makeText(ctx, r.message(), Toast.LENGTH_LONG).show() }
        }
    }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) {
            scanning = true
            scope.launch { val r = RecordingImporter.importUris(ctx, uris, null); scanning = false; Toast.makeText(ctx, r.message(), Toast.LENGTH_LONG).show() }
        }
    }
    val saveLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val r = saveRec ?: return@rememberLauncherForActivityResult
        saveRec = null
        if (uri != null) scope.launch {
            val ok = withContext(Dispatchers.IO) {
                runCatching { ctx.contentResolver.openOutputStream(uri)!!.use { o -> Repo.recordingFile(ctx, r).inputStream().use { it.copyTo(o) } } }.isSuccess
            }
            Toast.makeText(ctx, if (ok) "Recording saved" else "Save failed", Toast.LENGTH_SHORT).show()
        }
    }

    AppScaffold(
        title = "Recordings", topLevel = true,
        subtitle = rows?.let { "${it.size} recordings" },
        actions = {
            IconButton(onClick = {
                if (!autoFind && !folderSet) audioPermLauncher.launch(RecordingImporter.audioPermission) else {
                    scanning = true
                    scope.launch { val r = RecordingImporter.scan(ctx); scanning = false; Toast.makeText(ctx, r.message(), Toast.LENGTH_LONG).show() }
                }
            }) { Icon(Icons.Filled.Sync, "Find new recordings") }
            IconButton(onClick = { filePicker.launch(arrayOf("audio/*", "video/mp4", "application/octet-stream")) }) { Icon(Icons.Filled.LibraryAdd, "Import files") }
        }
    ) { p ->
        Column(Modifier.padding(p).fillMaxSize()) {
            if (scanning) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (!autoFind) Box(Modifier.padding(12.dp)) {
                InfoCard(
                    "Android does not let apps record calls directly. Turn on call recording in your phone's own Phone/Dialer app, " +
                        "then allow this app to read audio files: it finds the recordings by itself, wherever the phone saves them, " +
                        "and links them to customers automatically. " +
                        "If your dialer is Google Phone, it keeps recordings inside its own app: open the call in Phone > Recents, tap the recording's Share button and choose Mini Auto Dialer. " +
                        "Inform customers that calls may be recorded where required by law."
                ) { TextButton(onClick = { audioPermLauncher.launch(RecordingImporter.audioPermission) }) { Text("Allow & find recordings") } }
            }
            SearchField(q, { q = it }, "Search by customer name or number", Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
            Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                FilterChip(!unassigned, { unassigned = false }, { Text("All") })
                FilterChip(unassigned, { unassigned = true }, { Text("Not linked to a customer") })
            }
            val list = rows
            if (list != null && list.isEmpty()) EmptyState(Icons.Filled.Mic, "No recordings yet", "Recordings made by the phone's call recorder appear here automatically. Google Phone users: share the recording from Phone > Recents to this app.")
            LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                items(list.orEmpty(), key = { it.rec.id }) { row ->
                    val r = row.rec
                    val open = expanded == r.id
                    Column(Modifier.fillMaxWidth().clickable { expanded = if (open) 0 else r.id }.padding(horizontal = 16.dp, vertical = 10.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.GraphicEq, null, tint = if (r.customerId != null) Brand else Color.Gray)
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(row.customerName ?: "Unassigned", fontWeight = FontWeight.SemiBold, color = if (row.customerName == null) Color(0xFFEA580C) else Color.Unspecified)
                                Text(r.displayName, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text("${Fmt.dateTime(r.recordedAt)} · ${Fmt.clock(r.durationMs)} · ${Fmt.size(r.sizeBytes)}", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
                            }
                            Icon(if (open) Icons.Filled.ExpandLess else Icons.Filled.PlayArrow, null)
                        }
                        if (open) {
                            AudioPlayer(Repo.recordingFile(ctx, r), Modifier.padding(top = 6.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(0.dp)) {
                                if (r.customerId != null) TextButton(onClick = { nav.navigate("customer/${r.customerId}") }) { Text("Customer") }
                                TextButton(onClick = { scope.launch { customers = db.customers().all(); assignRec = r } }) { Text(if (r.customerId == null) "Assign" else "Change") }
                                TextButton(onClick = { renameRec = r }) { Text("Rename") }
                                IconButton(onClick = { runCatching { shareRecording(ctx, r) } }) { Icon(Icons.Filled.Share, "Share / export") }
                                IconButton(onClick = { saveRec = r; saveLauncher.launch(exportName(r)) }) { Icon(Icons.Filled.SaveAlt, "Save to device") }
                                IconButton(onClick = { deleteRec = r }) { Icon(Icons.Filled.Delete, "Delete", tint = Color(0xFFDC2626)) }
                            }
                        }
                    }
                    HorizontalDivider()
                }
            }
        }
    }
    renameRec?.let { r ->
        TextInputDialog("Rename recording", r.displayName, "Name", onDismiss = { renameRec = null }) { n ->
            scope.launch { db.recordings().update(r.copy(displayName = n)) }
        }
    }
    assignRec?.let { r ->
        CustomerPickerDialog(customers, { assignRec = null }) { c ->
            scope.launch { db.recordings().update(r.copy(customerId = c.id, callId = null)) }
        }
    }
    deleteRec?.let { r ->
        ConfirmDialog("Delete recording?", "The audio file will be permanently removed from this app. (The original in the phone recorder folder is not touched.)",
            onDismiss = { deleteRec = null }) { scope.launch { Repo.deleteRecording(ctx, r) } }
    }
}

/** Known folders where built-in call recorders save files (relative to internal storage). */
private val RECORDER_DIRS = listOf(
    "Music/Recordings/Call Recordings",   // Realme / Oppo / OnePlus (ColorOS)
    "Recordings/Call Recordings",
    "Recordings/Call",                    // Samsung (One UI)
    "Call",                               // Samsung (older)
    "MIUI/sound_recorder/call_rec",       // Xiaomi / Redmi / Poco
    "Recordings/Call recordings",
    "Record/Call",                        // Huawei / Honor
    "Sounds/CallRecord",
    "PhoneRecord",
    "Recordings",
)

/** Initial location for the folder picker: the phone's call-recorder folder if it exists. */
fun recorderFolderHint(): Uri? {
    @Suppress("DEPRECATION")
    val root = android.os.Environment.getExternalStorageDirectory()
    val dir = RECORDER_DIRS.firstOrNull { File(root, it).isDirectory } ?: return null
    return android.provider.DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:$dir")
}

/** Persist access to the recordings folder chosen via the system picker. */
fun setRecordingFolder(ctx: Context, uri: Uri) {
    val prefs = MiniDialerApp.prefs
    prefs.recordingFolder?.let { old ->
        runCatching { ctx.contentResolver.releasePersistableUriPermission(Uri.parse(old), Intent.FLAG_GRANT_READ_URI_PERMISSION) }
    }
    ctx.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    prefs.recordingFolder = uri.toString()
    // pick up recordings of the last 7 days on first setup; later scans only see newer files
    if (prefs.scanSince == 0L) prefs.scanSince = System.currentTimeMillis() - 7 * 86_400_000L
}
