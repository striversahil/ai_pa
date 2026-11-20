package com.miniautodialer.app.ui.screens

import android.Manifest
import android.app.AlarmManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.navigation.NavHostController
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.data.Outcome
import com.miniautodialer.app.ui.*
import com.miniautodialer.app.util.*
import kotlinx.coroutines.launch

@Composable
fun ReportsScreen(nav: NavHostController) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val db = MiniDialerApp.db
    var period by remember { mutableStateOf(Period.current(PeriodType.DAILY)) }
    var summary by remember { mutableStateOf<Summary?>(null) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(period) {
        val rows = db.calls().rowsInRange(period.fromMs, period.toMs)
        val names = db.campaigns().allOnce().associate { it.id to it.name }
        summary = Summary.of(rows.map { it.call }, names)
    }
    var pendingExport by remember { mutableStateOf<(suspend (Uri) -> String)?>(null) }
    fun onUri(uri: Uri?) {
        val job = pendingExport ?: return
        pendingExport = null
        if (uri == null) return
        busy = true
        scope.launch {
            val msg = runCatching { job(uri) }.getOrElse { "Export failed: ${it.message}" }
            busy = false
            Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show()
        }
    }
    val xlsx = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(ExportFormat.XLSX.mime)) { onUri(it) }
    val csv = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(ExportFormat.CSV.mime)) { onUri(it) }
    val pdf = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(ExportFormat.PDF.mime)) { onUri(it) }
    fun launch(fmt: ExportFormat, name: String, job: suspend (Uri) -> String) {
        pendingExport = job
        val n = "$name.${fmt.ext}"
        when (fmt) { ExportFormat.XLSX -> xlsx.launch(n); ExportFormat.CSV -> csv.launch(n); ExportFormat.PDF -> pdf.launch(n) }
    }

    AppScaffold(title = "Reports", onBack = { nav.popBackStack() }) { p ->
        Column(Modifier.padding(p).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                PeriodType.entries.forEachIndexed { i, t ->
                    SegmentedButton(period.type == t, { period = Period.current(t) }, SegmentedButtonDefaults.itemShape(i, 3)) { Text(t.label) }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { period = period.shift(-1) }) { Icon(Icons.Filled.ChevronLeft, "Previous") }
                Text(period.label(), Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                IconButton(onClick = { period = period.shift(1) }) { Icon(Icons.Filled.ChevronRight, "Next") }
            }
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            summary?.let { s ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StatCard("Calls", "${s.calls}", Icons.Filled.Call, Color(0xFF2563EB), Modifier.weight(1f))
                    StatCard("Connected", "${s.connected} (${s.connectRate}%)", Icons.Filled.PhoneInTalk, CallGreen, Modifier.weight(1f))
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StatCard("Talk time", Fmt.duration(s.durationSec), Icons.Filled.Timer, Brand, Modifier.weight(1f))
                    StatCard("Customers", "${s.uniqueCustomers}", Icons.Filled.People, Color(0xFF7C3AED), Modifier.weight(1f))
                }
                SectionTitle("Outcomes")
                Outcome.entries.forEach { o ->
                    Row(Modifier.padding(vertical = 2.dp)) {
                        Text(o.label, Modifier.weight(1f)); Text("${s.byOutcome[o] ?: 0}", fontWeight = FontWeight.Bold, color = o.color)
                    }
                }
                if (s.byCampaign.isNotEmpty()) {
                    SectionTitle("By calling list")
                    s.byCampaign.forEach { (n, c) -> Row(Modifier.padding(vertical = 2.dp)) { Text(n, Modifier.weight(1f)); Text("$c", fontWeight = FontWeight.Bold) } }
                }
                if (s.byDay.size > 1) {
                    SectionTitle("By day")
                    s.byDay.forEach { d ->
                        Row(Modifier.padding(vertical = 2.dp)) {
                            Text(Fmt.date(Fmt.startOfDay(d.date)), Modifier.weight(1f))
                            Text("${d.calls} calls · ${d.connected} conn. · ${Fmt.duration(d.durationSec)}", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
            SectionTitle("Export this report")
            val base = "Calling_Report_${period.type.label}_${period.start}"
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ExportFormat.entries.forEach { f ->
                    OutlinedButton(onClick = { launch(f, base) { Exporter.exportReport(ctx, it, period, f) } }, modifier = Modifier.weight(1f)) { Text(f.ext.uppercase()) }
                }
            }
            SectionTitle("Export customer calling history (all customers)")
            val base2 = "Customer_History_${Fmt.isoDate(System.currentTimeMillis())}"
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ExportFormat.entries.forEach { f ->
                    OutlinedButton(onClick = { launch(f, base2) { Exporter.exportCustomers(ctx, it, f) } }, modifier = Modifier.weight(1f)) { Text(f.ext.uppercase()) }
                }
            }
            Text("Files are saved where you choose (phone storage, Downloads, or a cloud drive you select). Nothing is uploaded automatically.",
                style = MaterialTheme.typography.bodySmall, color = Color.Gray, modifier = Modifier.padding(top = 8.dp))
        }
    }
}

@Composable
fun SettingsScreen(nav: NavHostController) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val prefs = MiniDialerApp.prefs
    var folder by remember { mutableStateOf(prefs.recordingFolder) }
    var autoScan by remember { mutableStateOf(prefs.autoScan) }
    var scanAll by remember { mutableStateOf(prefs.scanImportAll) }
    var trackDialer by remember { mutableStateOf(prefs.trackDialer) }
    var trackUnknown by remember { mutableStateOf(prefs.trackUnknown) }
    var askBelow by remember { mutableIntStateOf(prefs.askBelowSec) }
    fun enableDialerTracking() {
        if (prefs.dialerSyncedTo == 0L) prefs.dialerSyncedTo = Fmt.startOfToday()
        prefs.trackDialer = true; trackDialer = true
        scope.launch { if (DialerSync.sync(ctx) != null) nav.navigate("logcall") }
    }
    val logPermLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) enableDialerTracking() else Toast.makeText(ctx, "Call-log access is needed to track calls from the phone dialer", Toast.LENGTH_LONG).show()
    }
    var busy by remember { mutableStateOf<String?>(null) }
    var confirmRestore by remember { mutableStateOf<Uri?>(null) }
    var permTick by remember { mutableIntStateOf(0) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { permTick++ }

    val folderPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) { setRecordingFolder(ctx, uri); folder = uri.toString() }
    }
    val backupLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri ->
        if (uri != null) {
            busy = "Creating backup…"
            scope.launch {
                val msg = runCatching { Backup.backup(ctx, uri) }.getOrElse { "Backup failed: ${it.message}" }
                busy = null
                Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show()
            }
        }
    }
    val restoreLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) confirmRestore = uri }
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { permTick++ }

    AppScaffold(title = "Settings", onBack = { nav.popBackStack() }) { p ->
        Column(Modifier.padding(p).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            busy?.let { Text(it); LinearProgressIndicator(Modifier.fillMaxWidth()) }

            SectionTitle("Permissions")
            key(permTick) {
                val perms = buildList {
                    add(Triple("Make phone calls", Manifest.permission.CALL_PHONE, "Required for one-tap calling"))
                    add(Triple("Read call log", Manifest.permission.READ_CALL_LOG, "Fills in call duration and status automatically"))
                    add(Triple("Read contacts", Manifest.permission.READ_CONTACTS, "Import customers from phone contacts"))
                    add(Triple("Audio files", RecordingImporter.audioPermission, "Finds call recordings automatically, in any folder"))
                    if (Build.VERSION.SDK_INT >= 33) add(Triple("Notifications", Manifest.permission.POST_NOTIFICATIONS, "Callback reminders"))
                }
                perms.forEach { (label, perm, why) ->
                    val ok = ContextCompat.checkSelfPermission(ctx, perm) == PackageManager.PERMISSION_GRANTED
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (ok) Icons.Filled.CheckCircle else Icons.Filled.Cancel, null, tint = if (ok) CallGreen else Color(0xFFDC2626))
                        Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f)) { Text(label); Text(why, style = MaterialTheme.typography.bodySmall, color = Color.Gray) }
                        if (!ok) TextButton(onClick = { permLauncher.launch(arrayOf(perm)) }) { Text("Allow") }
                    }
                }
                if (Build.VERSION.SDK_INT >= 31 && !ctx.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()) {
                    InfoCard("Exact alarms are off, so reminders may be a few minutes late.") {
                        TextButton(onClick = { runCatching { ctx.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${ctx.packageName}"))) } }) { Text("Allow exact alarms") }
                    }
                }
                TextButton(onClick = {
                    ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}")))
                }) { Text("Open app settings (battery: set to “Unrestricted” for reliable reminders)") }
            }

            SectionTitle("Manual dialing")
            Text("Use the dial pad (green button on Home) to call any number from the app: the call is tracked like list calls, and new numbers are saved as customers.",
                style = MaterialTheme.typography.bodySmall)
            OutlinedButton(onClick = { nav.navigate("dialpad") }, modifier = Modifier.padding(vertical = 4.dp)) {
                Icon(Icons.Filled.Dialpad, null); Spacer(Modifier.width(6.dp)); Text("Open dial pad")
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Track calls made from the phone's dialer")
                    Text("Outgoing calls to your customers made outside this app are added to their history when you open the app. A call you just finished asks for its outcome.",
                        style = MaterialTheme.typography.bodySmall, color = Color.Gray)
                }
                Switch(trackDialer, { on ->
                    if (!on) { prefs.trackDialer = false; trackDialer = false }
                    else if (CallManager.canReadLog(ctx)) enableDialerTracking()
                    else logPermLauncher.launch(Manifest.permission.READ_CALL_LOG)
                })
            }
            if (trackDialer) Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Also track numbers that aren't customers")
                    Text("Adds every number you call as a new customer. Off = personal calls stay out of the app.",
                        style = MaterialTheme.typography.bodySmall, color = Color.Gray)
                }
                Switch(trackUnknown, { trackUnknown = it; prefs.trackUnknown = it })
            }

            SectionTitle("Call outcome")
            Text("When a customer declines or doesn't answer, many networks play a message (\u201cthe number you are calling is not answering\u201d) and the phone counts it as talk time. " +
                "Calls shorter than this are not assumed to be connected; you choose the outcome.", style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(0, 15, 30, 45, 60).forEach { v ->
                    FilterChip(askBelow == v, { askBelow = v; prefs.askBelowSec = v }, { Text(if (v == 0) "Off" else "${v}s") })
                }
            }

            SectionTitle("Call recordings")
            Text(
                "Android blocks third-party apps from recording call audio. Enable recording in your phone's built-in Phone app " +
                    "(where your manufacturer and country allow it). This app imports those files, links them to customers by number, name or call time, " +
                    "and plays them. Make sure customers are informed that calls may be recorded where the law requires it.",
                style = MaterialTheme.typography.bodySmall
            )
            Spacer(Modifier.height(6.dp))
            key(permTick) {
                val auto = RecordingImporter.hasAudioAccess(ctx)
                if (auto) Text("Automatic: recordings are found wherever the phone saves them. No folder setup needed.", fontWeight = FontWeight.SemiBold, color = CallGreen)
                else InfoCard("Allow access to audio files so the app finds call recordings by itself, on any phone.", Icons.Filled.Warning, Color(0xFFEA580C)) {
                    TextButton(onClick = { permLauncher.launch(arrayOf(RecordingImporter.audioPermission)) }) { Text("Allow") }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (RecordingImporter.canAutoFind(ctx)) TextButton(onClick = {
                        scope.launch { val r = RecordingImporter.scan(ctx); Toast.makeText(ctx, r.message(), Toast.LENGTH_LONG).show() }
                    }) { Text("Scan now") }
                    if (RecordingImporter.canAutoFind(ctx)) OutlinedButton(onClick = {
                        busy = "Searching all recordings for your customers…"
                        scope.launch {
                            val r = RecordingImporter.scan(ctx, fullHistory = true)
                            busy = null
                            Toast.makeText(ctx, r.message(), Toast.LENGTH_LONG).show()
                        }
                    }, enabled = busy == null) { Text("Find older recordings") }
                }
            }
            Text("Extra folder (optional, only if a recorder's files are not found automatically): " +
                (folder?.let { Uri.decode(it).substringAfterLast(':').ifBlank { "selected" } } ?: "none"),
                style = MaterialTheme.typography.bodySmall, color = Color.Gray)
            TextButton(onClick = { folderPicker.launch(recorderFolderHint()) }) { Text(if (folder == null) "Add a folder" else "Change folder") }
            if (prefs.lastScanAt > 0) Text("Last scan: ${Fmt.friendly(prefs.lastScanAt)}", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Scan automatically when the app opens and after calls", Modifier.weight(1f))
                Switch(autoScan, { autoScan = it; prefs.autoScan = it })
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Also import recordings that don't match a customer")
                    Text("Off = personal call recordings stay out of the app", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
                }
                Switch(scanAll, { scanAll = it; prefs.scanImportAll = it })
            }

            SectionTitle("Backup & restore")
            Text("All data stays on this phone. A backup is one .zip file (customers, call history, follow-ups and recordings) saved wherever you choose — e.g. phone storage, a USB drive, or Google Drive if you pick it.",
                style = MaterialTheme.typography.bodySmall)
            Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { backupLauncher.launch("MiniDialer_Backup_${Fmt.isoDate(System.currentTimeMillis())}.zip") }, enabled = busy == null) {
                    Icon(Icons.Filled.Backup, null); Spacer(Modifier.width(6.dp)); Text("Back up")
                }
                OutlinedButton(onClick = { restoreLauncher.launch(arrayOf("application/zip", "application/octet-stream", "application/x-zip-compressed")) }, enabled = busy == null) {
                    Icon(Icons.Filled.Restore, null); Spacer(Modifier.width(6.dp)); Text("Restore")
                }
            }

            SectionTitle("Reports")
            OutlinedButton(onClick = { nav.navigate("reports") }) { Text("Daily / weekly / monthly reports & export") }

            SectionTitle("Privacy")
            Text("No login, no internet permission, no ads, no analytics. Android's automatic cloud backup is disabled for this app, so customer data and recordings leave the phone only when you export or back them up yourself.",
                style = MaterialTheme.typography.bodySmall)
            Text("Version 1.0.0", style = MaterialTheme.typography.bodySmall, color = Color.Gray, modifier = Modifier.padding(top = 12.dp))
        }
    }
    confirmRestore?.let { uri ->
        ConfirmDialog("Restore backup?", "ALL current data in the app will be replaced by the backup. The app will restart.", "Restore", { confirmRestore = null }) {
            busy = "Restoring…"
            scope.launch {
                runCatching { Backup.restore(ctx, uri) }
                    .onSuccess { Backup.restartApp(ctx) }
                    .onFailure { busy = null; Toast.makeText(ctx, "Restore failed: ${it.message}", Toast.LENGTH_LONG).show() }
            }
        }
    }
}
