package com.miniautodialer.app.ui.screens

import android.Manifest
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
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
import com.miniautodialer.app.data.*
import com.miniautodialer.app.ui.*
import com.miniautodialer.app.util.CallLogEntry
import com.miniautodialer.app.util.CallManager
import com.miniautodialer.app.util.Fmt
import com.miniautodialer.app.util.RecordingImporter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private fun nextId(members: List<MemberRow>, current: Long, pendingOnly: Boolean, dir: Int): Long? {
    if (members.isEmpty()) return null
    val idx = members.indexOfFirst { it.customer.id == current }
    if (!pendingOnly) {
        return members.getOrNull(idx + dir)?.customer?.id
    }
    val n = members.size
    for (step in 1..n) {
        val i = ((idx + dir * step) % n + n) % n
        val m = members[i]
        if (m.mStatus == MemberStatus.PENDING && m.customer.id != current) return m.customer.id
    }
    return null
}

/** Calling session: shows customers of a calling list one by one with a big Call button. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SessionScreen(nav: NavHostController, campaignId: Long, startId: Long) {
    val db = MiniDialerApp.db
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val caller = LocalCaller.current
    val campaign by db.campaigns().observe(campaignId).collectAsState(null)
    val members by db.campaigns().members(campaignId).collectAsState(null)
    var pendingOnly by remember { mutableStateOf(MiniDialerApp.prefs.pendingOnly) }
    var currentId by rememberSaveable { mutableLongStateOf(startId) }
    var allDone by remember { mutableStateOf(false) }

    LaunchedEffect(members, campaign) {
        val m = members ?: return@LaunchedEffect
        val cp = campaign ?: return@LaunchedEffect
        if (currentId == 0L || m.none { it.customer.id == currentId }) {
            currentId = cp.lastCustomerId?.takeIf { id -> m.any { it.customer.id == id && it.mStatus == MemberStatus.PENDING } }
                ?: m.firstOrNull { it.mStatus == MemberStatus.PENDING }?.customer?.id
                    ?: m.firstOrNull()?.customer?.id ?: 0L
        }
    }
    LaunchedEffect(currentId) {
        if (currentId > 0) {
            db.campaigns().get(campaignId)?.let { if (it.lastCustomerId != currentId) db.campaigns().update(it.copy(lastCustomerId = currentId)) }
            MiniDialerApp.prefs.lastCampaignId = campaignId
        }
    }
    val adv by CallManager.advance.collectAsState()
    LaunchedEffect(adv, members) {
        val m = members ?: return@LaunchedEffect
        if (adv == campaignId) {
            CallManager.advance.value = null
            val n = nextId(m, currentId, pendingOnly, 1)
            if (n != null) currentId = n else allDone = true
        }
    }

    val m = members
    val current = m?.firstOrNull { it.customer.id == currentId }
    val total = m?.size ?: 0
    val done = m?.count { it.mStatus == MemberStatus.DONE } ?: 0

    AppScaffold(
        title = campaign?.name ?: "Calling",
        subtitle = "$done of $total called · ${total - done} pending",
        onBack = { nav.popBackStack() },
        actions = {
            if (current != null) IconButton(onClick = { nav.navigate("customer/${current.customer.id}") }) { Icon(Icons.Filled.Person, "Customer profile") }
        }
    ) { p ->
        Column(Modifier.padding(p).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            LinearProgressIndicator(progress = { if (total == 0) 0f else done.toFloat() / total }, modifier = Modifier.fillMaxWidth())
            Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(pendingOnly, { pendingOnly = it; MiniDialerApp.prefs.pendingOnly = it })
                Spacer(Modifier.width(8.dp))
                Text("Show pending customers only", style = MaterialTheme.typography.bodyMedium)
            }
            when {
                m == null -> CircularProgressIndicator()
                m.isEmpty() -> EmptyState(Icons.Filled.PersonAdd, "No customers in this list", "Add customers from Excel/CSV, phone contacts or your customer list.") {
                    Button(onClick = { nav.navigate("campaign/$campaignId") }) { Text("Add customers") }
                }
                current == null -> CircularProgressIndicator()
                else -> {
                    if (allDone) {
                        InfoCard("All pending customers in this list have been called.", Icons.Filled.CheckCircle, CallGreen) {
                            Row {
                                TextButton(onClick = {
                                    scope.launch { db.campaigns().resetOutcomes(campaignId, Outcome.RETRY.map { it.name }); allDone = false }
                                }) { Text("Re-queue busy / not answered") }
                            }
                        }
                        Spacer(Modifier.height(8.dp))
                    }
                    CurrentCustomerCard(current, m.indexOf(current) + 1, total)
                    Spacer(Modifier.height(16.dp))
                    Button(
                        onClick = { caller(current.customer, campaignId) },
                        modifier = Modifier.fillMaxWidth().height(64.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = CallGreen)
                    ) {
                        Icon(Icons.Filled.Call, null)
                        Spacer(Modifier.width(10.dp))
                        Text("CALL  ${current.customer.phone}", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = {
                            nextId(m, currentId, pendingOnly, -1)?.let { currentId = it; allDone = false }
                                ?: Toast.makeText(ctx, "No previous customer", Toast.LENGTH_SHORT).show()
                        }, modifier = Modifier.weight(1f)) { Icon(Icons.Filled.SkipPrevious, null); Text("Previous") }
                        OutlinedButton(onClick = {
                            nextId(m, currentId, pendingOnly, 1)?.let { currentId = it }
                                ?: run { allDone = true; Toast.makeText(ctx, "No more customers", Toast.LENGTH_SHORT).show() }
                        }, modifier = Modifier.weight(1f)) { Text("Next / Skip"); Icon(Icons.Filled.SkipNext, null) }
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = {
                            CallManager.manualLog(ctx, current.customer.id, campaignId, current.customer.phone)
                            nav.navigate("logcall")
                        }, modifier = Modifier.weight(1f)) { Icon(Icons.Filled.EditNote, null); Text(" Log without calling") }
                        TextButton(onClick = {
                            scope.launch {
                                val newStatus = if (current.mStatus == MemberStatus.DONE) MemberStatus.PENDING else MemberStatus.DONE
                                db.campaigns().setStatus(campaignId, current.customer.id, newStatus)
                            }
                        }, modifier = Modifier.weight(1f)) {
                            Text(if (current.mStatus == MemberStatus.DONE) "Mark pending" else "Mark done")
                        }
                    }
                    CustomerHistory(current.customer.id)
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CurrentCustomerCard(m: MemberRow, index: Int, total: Int) {
    val c = m.customer
    Card(Modifier.fillMaxWidth().padding(top = 8.dp), colors = CardDefaults.cardColors(containerColor = Color.White), elevation = CardDefaults.cardElevation(2.dp)) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("#$index of $total", style = MaterialTheme.typography.labelMedium, color = Color.Gray, modifier = Modifier.weight(1f))
                if (m.mStatus == MemberStatus.DONE) SmallBadge("Called ×${m.mAttempts}", Color.Gray) else SmallBadge("Pending", Brand)
                Spacer(Modifier.width(4.dp))
                OutcomeBadge(m.mLastOutcome)
            }
            Text(c.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(c.phone, style = MaterialTheme.typography.titleMedium, color = Brand)
            Spacer(Modifier.height(6.dp))
            LabeledValue("Company", c.company)
            LabeledValue("Location", c.location)
            LabeledValue("Category", c.category)
            LabeledValue("Email", c.email)
            if (c.remarks.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text("Remarks", style = MaterialTheme.typography.labelMedium, color = Color.Gray)
                Text(c.remarks, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

/** Follow-ups + last calls of a customer (compact). */
@Composable
fun CustomerHistory(customerId: Long, maxCalls: Int = 5) {
    val db = MiniDialerApp.db
    val calls by remember(customerId) { db.calls().forCustomer(customerId) }.collectAsState(emptyList())
    val fus by remember(customerId) { db.followUps().forCustomer(customerId) }.collectAsState(emptyList())
    val pending = fus.filter { it.status == FuStatus.PENDING }
    if (pending.isNotEmpty()) {
        SectionTitle("Pending follow-ups")
        pending.forEach { f ->
            val overdue = f.dueAt < System.currentTimeMillis()
            Text(
                "• ${Fmt.friendly(f.dueAt)}${if (f.note.isNotBlank()) " — ${f.note}" else ""}",
                color = if (overdue) Color(0xFFDC2626) else Color.Unspecified,
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
    SectionTitle("Call history (${calls.size})")
    if (calls.isEmpty()) Text("Not called yet", color = Color.Gray, style = MaterialTheme.typography.bodyMedium)
    calls.take(maxCalls).forEach { k -> CallHistoryItem(k) }
}

@Composable
fun CallHistoryItem(k: CallRecord) {
    var editing by remember { mutableStateOf(false) }
    if (editing) EditCallDialog(k) { editing = false }
    Column(Modifier.fillMaxWidth().clickable { editing = true }.padding(vertical = 6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(Fmt.dateTime(k.startedAt), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Text(Fmt.duration(k.durationSec), style = MaterialTheme.typography.bodySmall, color = Color.Gray)
            Spacer(Modifier.width(6.dp))
            OutcomeBadge(k.outcome)
        }
        if (k.remarks.isNotBlank()) Text(k.remarks, style = MaterialTheme.typography.bodySmall, color = Color.DarkGray)
        HorizontalDivider(Modifier.padding(top = 6.dp))
    }
}

/** Change the outcome / remarks of a saved call, or delete it. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EditCallDialog(k: CallRecord, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val db = MiniDialerApp.db
    var outcome by remember { mutableStateOf(k.outcome) }
    var remarks by remember { mutableStateOf(k.remarks) }
    var confirmDelete by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Call on ${Fmt.dateTime(k.startedAt)}") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text("Talk time ${Fmt.duration(k.durationSec)}", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Outcome.entries.forEach { o ->
                        FilterChip(
                            selected = outcome == o.name, onClick = { outcome = o.name }, label = { Text(o.label) },
                            colors = FilterChipDefaults.filterChipColors(selectedContainerColor = o.color, selectedLabelColor = Color.White)
                        )
                    }
                }
                OutlinedTextField(remarks, { remarks = it }, label = { Text("Remarks") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                TextButton(onClick = { confirmDelete = true }) { Text("Delete this call", color = Color(0xFFDC2626)) }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val o = Outcome.of(outcome) ?: Outcome.CONNECTED
                scope.launch {
                    db.calls().update(k.copy(outcome = o.name, remarks = remarks.trim(), connected = o.connected))
                    k.campaignId?.let { db.campaigns().setLastOutcome(it, k.customerId, o.name) }
                    com.miniautodialer.app.remote.Outbox.enqueueCall(k.id) // resend the corrected outcome
                    onDismiss()
                }
            }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
    if (confirmDelete) ConfirmDialog("Delete this call?", "It will be removed from the call history and reports.", onDismiss = { confirmDelete = false }) {
        scope.launch { db.calls().delete(k); onDismiss() }
    }
}

/** Shown after a call: auto-reads duration from the call log, captures outcome, remarks and callback. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LogCallScreen(nav: NavHostController) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val db = MiniDialerApp.db
    val pc = remember { CallManager.pending.value }
    if (pc == null) {
        LaunchedEffect(Unit) { nav.popBackStack() }
        return
    }
    val customer by db.customers().observe(pc.customerId).collectAsState(null)
    var pendingFus by remember { mutableStateOf(emptyList<FollowUp>()) }
    LaunchedEffect(pc) { pendingFus = db.followUps().pendingForCustomer(pc.customerId) }

    var logEntry by remember { mutableStateOf<CallLogEntry?>(null) }
    var searching by remember { mutableStateOf(pc.dialed) }
    var outcome by rememberSaveable { mutableStateOf<String?>(null) }
    var userPicked by rememberSaveable { mutableStateOf(false) }
    var minText by rememberSaveable { mutableStateOf("") }
    var secText by rememberSaveable { mutableStateOf("") }
    var remarks by rememberSaveable { mutableStateOf("") }
    var cbOn by rememberSaveable { mutableStateOf(false) }
    var cbAt by rememberSaveable { mutableLongStateOf(callbackPresets()[2].second) }
    var cbNote by rememberSaveable { mutableStateOf("") }
    var completeFu by rememberSaveable { mutableStateOf(true) }
    var showPicker by remember { mutableStateOf(false) }
    var confirmDiscard by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var resumeTick by remember { mutableIntStateOf(0) }
    var hasLogPerm by remember { mutableStateOf(CallManager.canReadLog(ctx)) }
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        hasLogPerm = it; resumeTick++
    }

    BackHandler { confirmDiscard = true }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { resumeTick++ }
    LaunchedEffect(resumeTick) {
        if (!pc.dialed || logEntry != null) return@LaunchedEffect
        searching = true
        repeat(30) {
            val e = withContext(Dispatchers.IO) { CallManager.findInCallLog(ctx, pc) }
            if (e != null) {
                logEntry = e
                minText = (e.durationSec / 60).toString(); secText = (e.durationSec % 60).toString()
                if (!userPicked) outcome = Outcome.suggest(e.durationSec, MiniDialerApp.prefs.askBelowSec)?.name
                searching = false
                return@LaunchedEffect
            }
            delay(2000)
        }
        searching = false
        if (!userPicked && outcome == null && CallManager.canReadLog(ctx)) outcome = Outcome.FAILED.name
    }

    fun save(next: Boolean) {
        val o = Outcome.of(outcome) ?: run { Toast.makeText(ctx, "Select the call outcome", Toast.LENGTH_SHORT).show(); return }
        saving = true
        val dur = (minText.toIntOrNull() ?: 0) * 60 + (secText.toIntOrNull() ?: 0)
        scope.launch {
            Repo.saveCall(
                ctx, Repo.CallInput(
                    customerId = pc.customerId, campaignId = pc.campaignId, phone = pc.phone,
                    startedAt = logEntry?.date ?: pc.startedAt, durationSec = dur, outcome = o, remarks = remarks,
                    fromCallLog = logEntry != null, callbackAt = if (cbOn) cbAt else null, callbackNote = cbNote,
                    completeFollowUpIds = if (completeFu) pendingFus.filter { it.dueAt < Fmt.startOfTomorrow() }.map { it.id } else emptyList(),
                )
            )
            CallManager.clear(ctx)
            if (next && pc.campaignId != null) CallManager.advance.value = pc.campaignId
            if (pc.dialed && RecordingImporter.canAutoFind(ctx)) {
                MiniDialerApp.instance.appScope.launch {
                    delay(4000); RecordingImporter.scan(ctx)
                    delay(25000); RecordingImporter.scan(ctx)
                }
            }
            Toast.makeText(ctx, "Call saved", Toast.LENGTH_SHORT).show()
            nav.popBackStack()
        }
    }

    AppScaffold(title = "Call outcome", subtitle = customer?.let { "${it.name} · ${it.phone}" }, onBack = null, actions = {
        IconButton(onClick = { confirmDiscard = true }) { Icon(Icons.Filled.Close, "Discard") }
    }) { p ->
        Column(Modifier.padding(p).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            customer?.let { c ->
                Text(c.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text(listOf(c.phone, c.company).filter { it.isNotBlank() }.joinToString(" · "), color = Color.Gray)
                if (c.remarks.isNotBlank()) Text("Remarks: ${c.remarks}", style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(8.dp))
            when {
                !pc.dialed -> InfoCard("Logging a call made outside the app. Enter the duration manually.")
                logEntry != null -> {
                    val d = logEntry!!.durationSec
                    val unsure = d > 0 && d < MiniDialerApp.prefs.askBelowSec
                    InfoCard(
                        (if (pc.external) "Call made from the phone dialer. " else "") + "Call log: ${Fmt.time(logEntry!!.date)}, talk time ${Fmt.duration(d)}" +
                            when {
                                d == 0 -> " (not answered / busy / rejected)"
                                unsure -> ". Short call: if the customer declined or didn't pick up, the network may have played a message, which also counts as talk time. Choose what really happened."
                                else -> ""
                            },
                        if (unsure) Icons.Filled.Warning else Icons.Filled.CheckCircle,
                        if (unsure) Color(0xFFEA580C) else CallGreen
                    )
                }
                !hasLogPerm -> InfoCard("Allow call-log access so the app can fill in call duration automatically.", Icons.Filled.Warning, Color(0xFFEA580C)) {
                    TextButton(onClick = { permLauncher.launch(Manifest.permission.READ_CALL_LOG) }) { Text("Allow") }
                }
                searching -> Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                    Text("Waiting for the call to finish…", style = MaterialTheme.typography.bodyMedium)
                }
                else -> InfoCard("No outgoing call found in the call log. If the call did not go through choose “Call Failed”.", Icons.Filled.Warning, Color(0xFFEA580C)) {
                    TextButton(onClick = { resumeTick++ }) { Text("Check again") }
                }
            }

            SectionTitle("Outcome *")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Outcome.entries.forEach { o ->
                    FilterChip(
                        selected = outcome == o.name,
                        onClick = {
                            outcome = o.name; userPicked = true
                            if ((o == Outcome.CALLBACK || o == Outcome.FOLLOW_UP) && !cbOn) cbOn = true
                        },
                        label = { Text(o.label) },
                        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = o.color, selectedLabelColor = Color.White)
                    )
                }
            }

            SectionTitle("Talk time")
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(minText, { minText = it.filter(Char::isDigit).take(3) }, label = { Text("Min") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.width(90.dp))
                Spacer(Modifier.width(8.dp))
                OutlinedTextField(secText, { secText = it.filter(Char::isDigit).take(2) }, label = { Text("Sec") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.width(90.dp))
            }

            SectionTitle("Remarks")
            OutlinedTextField(remarks, { remarks = it }, modifier = Modifier.fillMaxWidth(), minLines = 3, placeholder = { Text("What did the customer say?") })

            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Schedule callback / follow-up", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                Switch(cbOn, { cbOn = it })
            }
            if (cbOn) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    callbackPresets().forEach { (label, t) ->
                        AssistChip(onClick = { cbAt = t }, label = { Text(label) })
                    }
                }
                OutlinedButton(onClick = { showPicker = true }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Filled.Event, null); Spacer(Modifier.width(8.dp)); Text(Fmt.friendly(cbAt))
                }
                OutlinedTextField(cbNote, { cbNote = it }, label = { Text("Callback note") }, modifier = Modifier.fillMaxWidth())
            }
            val dueFus = pendingFus.filter { it.dueAt < Fmt.startOfTomorrow() }
            if (dueFus.isNotEmpty()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(completeFu, { completeFu = it })
                    Text("Mark ${dueFus.size} due follow-up(s) for this customer as completed", style = MaterialTheme.typography.bodyMedium)
                }
            }
            Spacer(Modifier.height(16.dp))
            if (pc.campaignId != null) {
                Button(onClick = { save(true) }, enabled = !saving, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                    Text("Save & next customer"); Icon(Icons.Filled.SkipNext, null)
                }
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { save(false) }, enabled = !saving, modifier = Modifier.fillMaxWidth()) { Text("Save") }
            } else {
                Button(onClick = { save(false) }, enabled = !saving, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("Save") }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
    if (showPicker) DateTimePickerDialog(cbAt, { showPicker = false }) { cbAt = it }
    if (confirmDiscard) ConfirmDialog("Discard this call?", "The call will not be added to the history.", "Discard", { confirmDiscard = false }) {
        CallManager.clear(ctx); nav.popBackStack()
    }
}
