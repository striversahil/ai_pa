package com.miniautodialer.app.ui.screens

import android.Manifest
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.navigation.NavHostController
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.remote.AutoDialer
import com.miniautodialer.app.remote.AutoDialer.State
import com.miniautodialer.app.remote.SyncRunner
import com.miniautodialer.app.ui.*
import com.miniautodialer.app.util.CallManager
import com.miniautodialer.app.util.Fmt
import com.miniautodialer.app.util.RecordingHealth
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Founder OS auto dialer: pairing, the calling loop, dispositions, breaks and manual dial. */
@Composable
fun DialerScreen(nav: NavHostController) {
    val session = MiniDialerApp.session
    val paired by session.paired.collectAsState()
    AppScaffold(title = "Auto Dialer", subtitle = if (paired) session.agentName else null, topLevel = true) { p ->
        Column(Modifier.padding(p).fillMaxSize().verticalScroll(rememberScrollState())) {
            if (paired) DialerPanel() else PairingCard()
        }
    }
}

@Composable
private fun DialerPanel() {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val session = MiniDialerApp.session
    val state by AutoDialer.state.collectAsState()
    val unsynced by remember { MiniDialerApp.db.sync().pendingCount() }.collectAsState(0)
    val waiting by remember { MiniDialerApp.db.sync().waiting() }.collectAsState(emptyList())
    var showBreak by remember { mutableStateOf(false) }
    var showManual by remember { mutableStateOf(false) }
    // Disposition being picked (kept here so a break / manual dial can save it first).
    var picked by remember { mutableStateOf<String?>(null) }
    var remarks by remember { mutableStateOf("") }
    var callbackAt by remember { mutableStateOf<Long?>(null) }
    var showPicker by remember { mutableStateOf(false) }

    val perms = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if (CallManager.canCall(ctx)) AutoDialer.start(ctx) else Toast.makeText(ctx, "Allow phone calls to start the dialer", Toast.LENGTH_LONG).show()
    }
    LaunchedEffect(Unit) { AutoDialer.restore(ctx) }
    // Heartbeat: keeps the Controller's live board current and pulls new leads.
    LaunchedEffect(Unit) { while (true) { SyncRunner.run(ctx); delay(60_000) } }
    // Returning from a call is handled in AppRoot's resume effect (opens this tab + AutoDialer.callEnded).
    LaunchedEffect(state is State.Disposing) { picked = null; remarks = ""; callbackAt = null }
    // Recordings only reach Founder OS when the phone's own recorder saves them.
    val recHint by produceState<String?>(null, state is State.Disposing) { value = RecordingHealth.problem(ctx) }

    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SyncLine(unsynced, session.lastSyncAt, session.lastSyncError)
        recHint?.let { InfoCard(it, Icons.Filled.MicOff, Color(0xFFEA580C)) }
        when (val s = state) {
            State.Stopped -> {
                InfoCard("${waiting.size} lead(s) in your queue. Once you start, calls dial one after another; use Break to stop.")
                Button(onClick = { perms.launch(arrayOf(Manifest.permission.CALL_PHONE, Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_PHONE_STATE)) },
                    modifier = Modifier.fillMaxWidth().height(64.dp), colors = ButtonDefaults.buttonColors(containerColor = CallGreen)) {
                    Icon(Icons.Filled.PlayArrow, null); Spacer(Modifier.width(8.dp)); Text("Start calling", fontSize = 18.sp)
                }
            }
            State.OffShift -> InfoCard("Outside shift hours (${session.config.shiftStart}–${session.config.shiftEnd}). Auto-dialing resumes when the shift starts; manual dialing still works.", Icons.Filled.Schedule)
            is State.NoLeads -> InfoCard("${s.note}. New leads from Founder OS appear here automatically.", Icons.Filled.HourglassEmpty)
            is State.Countdown -> NextCard(s.item.name, s.item.mobile, listOf(s.item.company, s.item.place, s.item.clientType), "Calling in ${s.secs}…", s.item.source)
            is State.Calling -> NextCard(s.name, s.phone, emptyList(),
                when { !s.live -> "Placing the call…"; s.manual -> "Manual call in progress"; else -> "On call" }, null)
            is State.NotPlaced -> {
                InfoCard("The call to ${s.name} (${s.phone}) was not placed — the SIM picker was closed or the dial was cancelled. Nothing was recorded.",
                    Icons.Filled.PhoneDisabled, Color(0xFFEA580C))
                Button(onClick = { AutoDialer.redial(ctx) }, modifier = Modifier.fillMaxWidth().height(56.dp), colors = ButtonDefaults.buttonColors(containerColor = CallGreen)) {
                    Icon(Icons.Filled.Call, null); Spacer(Modifier.width(8.dp)); Text("Call again")
                }
                OutlinedButton(onClick = { AutoDialer.dismissNotPlaced(ctx) }, modifier = Modifier.fillMaxWidth()) {
                    Text(if (s.manual) "Back to dialer" else "Stop dialer (lead stays first in queue)")
                }
            }
            is State.Disposing -> DispositionPanel(s, picked, remarks, callbackAt,
                onPick = { k -> picked = k; val d = session.config.disposition(k); if (d?.callback == true && callbackAt == null) { AutoDialer.pauseTimer(true); showPicker = true } },
                onRemarks = { remarks = it },
                onSave = { scope.launch { AutoDialer.save(ctx, s.call, picked, remarks, callbackAt, auto = false) } })
            is State.OnBreak -> BreakPanel(s) { AutoDialer.endBreak(ctx) }
            is State.Scheduled -> InfoCard("Scheduled break: ${s.label} until ${s.until} (set by your sales head). The dialer starts again by itself when it ends.", Icons.Filled.Coffee, Color(0xFFEA580C))
        }
        val busy = state is State.Calling || state is State.OnBreak || state is State.Scheduled
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { showBreak = true }, enabled = !busy, modifier = Modifier.weight(1f).height(52.dp)) {
                Icon(Icons.Filled.Coffee, null); Spacer(Modifier.width(6.dp)); Text("Break")
            }
            OutlinedButton(onClick = { showManual = true }, enabled = !busy, modifier = Modifier.weight(1f).height(52.dp)) {
                Icon(Icons.Filled.Dialpad, null); Spacer(Modifier.width(6.dp)); Text("Dial manually")
            }
        }
        if (waiting.isNotEmpty()) {
            SectionTitle("Up next (${waiting.size})")
            waiting.take(5).forEach { q -> Text("• ${q.name} · ${q.mobile}${if (q.source == "callback") " · callback" else ""}", style = MaterialTheme.typography.bodyMedium) }
        }
    }

    if (showPicker) DateTimePickerDialog(callbackAt ?: callbackPresets()[2].second, { showPicker = false; AutoDialer.pauseTimer(false) }) {
        callbackAt = it; showPicker = false; AutoDialer.pauseTimer(false)
    }
    if (showBreak) BreakDialog(onDismiss = { showBreak = false }) { reason, note ->
        showBreak = false
        scope.launch {
            (AutoDialer.state.value as? State.Disposing)?.let { AutoDialer.save(ctx, it.call, picked, remarks, callbackAt, auto = picked == null, continueAfter = false) }
            AutoDialer.startBreak(reason, note)
        }
    }
    if (showManual) ManualDialDialog(onDismiss = { showManual = false }) { number ->
        showManual = false
        scope.launch { AutoDialer.manualDial(ctx, number, picked, remarks)?.let { Toast.makeText(ctx, it, Toast.LENGTH_LONG).show() } }
    }
}

@Composable
private fun SyncLine(unsynced: Int, lastSync: Long, error: String?) {
    val text = when {
        unsynced > 0 && error != null -> "$unsynced item(s) waiting to sync · $error"
        unsynced > 0 -> "$unsynced item(s) waiting to sync"
        lastSync > 0 -> "✓ All synced · ${Fmt.time(lastSync)}"
        else -> "Not synced yet"
    }
    val stale = unsynced > 0 && System.currentTimeMillis() - lastSync > 24 * 3600_000L && lastSync > 0
    Text(if (stale) "$text · offline for over a day, connect to the internet" else text,
        style = MaterialTheme.typography.bodySmall, color = if (unsynced > 0) Color(0xFFEA580C) else Color.Gray)
}

@Composable
private fun NextCard(name: String, phone: String, details: List<String>, status: String, source: String?) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Brand)) {
        Column(Modifier.padding(16.dp)) {
            Text(status + if (source == "callback") " · callback" else if (source == "retry") " · retry" else "", color = Color.White.copy(alpha = 0.85f))
            Text(name, color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(phone, color = Color.White, style = MaterialTheme.typography.titleMedium)
            details.filter { it.isNotBlank() }.takeIf { it.isNotEmpty() }?.let { Text(it.joinToString(" · "), color = Color.White.copy(alpha = 0.85f)) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DispositionPanel(
    s: State.Disposing, picked: String?, remarks: String, callbackAt: Long?,
    onPick: (String) -> Unit, onRemarks: (String) -> Unit, onSave: () -> Unit,
) {
    val cfg = MiniDialerApp.session.config
    Text("${s.call.name} · ${s.call.phone}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
    val talk = s.call.log?.durationSec ?: 0
    val connected = cfg.connectedMinSec > 0 && talk >= cfg.connectedMinSec
    Text(
        when {
            connected -> "Connected · talk time ${Fmt.duration(talk)}"
            s.call.log != null -> "Talk time ${Fmt.duration(talk)}"
            s.call.searching -> "Reading talk time from the call log…"
            else -> "No talk time found yet"
        }, color = if (connected) CallGreen else Color.Gray, fontWeight = if (connected) FontWeight.Bold else null
    )
    // A retry disposition on a call that clearly connected: say what will happen (it is not re-dialed).
    if (connected && cfg.disposition(picked)?.retry == true) {
        Text("This call connected (${Fmt.duration(talk)} talk time), so it will not be dialed again. Pick what the customer said if you spoke to them.",
            color = Color(0xFFEA580C), style = MaterialTheme.typography.bodySmall)
    }
    LinearProgressIndicator(progress = { s.secsLeft / cfg.dispositionSec.toFloat().coerceAtLeast(1f) }, modifier = Modifier.fillMaxWidth())
    Text(when {
            s.heldByCall -> "Timer held: the phone is on a call. The next dial waits until it ends."
            s.paused -> "Timer paused while you pick the callback time"
            else -> "Saves automatically in ${s.secsLeft}s"
        },
        color = if (s.secsLeft <= 5) Color(0xFFDC2626) else Color.Gray, style = MaterialTheme.typography.bodySmall)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        cfg.dispositions.forEach { d -> FilterChip(selected = picked == d.key, onClick = { onPick(d.key) }, label = { Text(d.label) }) }
    }
    callbackAt?.let { Text("Callback: ${Fmt.friendly(it)}", color = Brand) }
    OutlinedTextField(remarks, onRemarks, label = { Text("Remarks (optional)") }, modifier = Modifier.fillMaxWidth(), maxLines = 3)
    Button(onClick = onSave, enabled = picked != null, modifier = Modifier.fillMaxWidth().height(52.dp)) {
        Text("Save & next"); Icon(Icons.Filled.SkipNext, null)
    }
}

@Composable
private fun BreakPanel(s: State.OnBreak, onResume: () -> Unit) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(1_000); now = System.currentTimeMillis() } }
    val sec = ((now - s.startAt) / 1000).toInt()
    val over = s.maxMin > 0 && sec > s.maxMin * 60
    InfoCard("On break: ${s.label}${if (s.note.isNotBlank()) " · ${s.note}" else ""}\n${Fmt.duration(sec)}" +
        if (over) " — over the ${s.maxMin}-minute limit" else if (s.maxMin > 0) " of ${s.maxMin} min" else "",
        Icons.Filled.Coffee, if (over) Color(0xFFDC2626) else Color(0xFFEA580C))
    Button(onClick = onResume, modifier = Modifier.fillMaxWidth().height(64.dp), colors = ButtonDefaults.buttonColors(containerColor = CallGreen)) {
        Icon(Icons.Filled.PlayArrow, null); Spacer(Modifier.width(8.dp)); Text("Resume calling", fontSize = 18.sp)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BreakDialog(onDismiss: () -> Unit, onStart: (String, String) -> Unit) {
    val reasons = MiniDialerApp.session.config.breakReasons
    var key by remember { mutableStateOf<String?>(null) }
    var note by remember { mutableStateOf("") }
    var open by remember { mutableStateOf(false) }
    val r = reasons.firstOrNull { it.key == key }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Take a break") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("The dialer stops until you resume. Why are you taking a break?")
                ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }) {
                    OutlinedTextField(r?.label ?: "", {}, readOnly = true, label = { Text("Reason") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) }, modifier = Modifier.menuAnchor().fillMaxWidth())
                    ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                        reasons.forEach { b ->
                            DropdownMenuItem(text = { Text(b.label + if (b.maxMin > 0) " (${b.maxMin} min)" else "") }, onClick = { key = b.key; open = false })
                        }
                    }
                }
                if (r?.needsNote == true) OutlinedTextField(note, { note = it }, label = { Text("Note") }, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = {
            TextButton(enabled = r != null && (!r.needsNote || note.isNotBlank()), onClick = { onStart(r!!.key, note.trim()) }) { Text("Start break") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun ManualDialDialog(onDismiss: () -> Unit, onDial: (String) -> Unit) {
    var number by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Dial a number") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Auto-dialing pauses for this call and continues after you save its disposition.")
                OutlinedTextField(number, { number = it.filter { c -> c.isDigit() || c == '+' }.take(15) }, label = { Text("Mobile number") },
                    singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = { TextButton(enabled = number.length >= 10, onClick = { onDial(number) }) { Icon(Icons.Filled.Call, null); Text(" Call") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
