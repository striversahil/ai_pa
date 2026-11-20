package com.miniautodialer.app.ui.screens

import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
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
import androidx.navigation.NavHostController
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.data.*
import com.miniautodialer.app.ui.*
import com.miniautodialer.app.util.CallManager
import com.miniautodialer.app.util.Fmt
import com.miniautodialer.app.util.PhoneUtil
import kotlinx.coroutines.launch

@Composable
fun CustomersScreen(nav: NavHostController) {
    val db = MiniDialerApp.db
    var q by rememberSaveableString()
    var cat by rememberSaveableString()
    var outcomeFilter by rememberSaveableString()
    val rows by remember(q, cat) { db.customers().rows(q.trim(), cat) }.collectAsState(null)
    val cats by db.customers().categories().collectAsState(emptyList())
    val caller = LocalCaller.current
    var menu by remember { mutableStateOf(false) }
    val shown = rows?.let { r -> if (outcomeFilter.isEmpty()) r else r.filter { (it.lastOutcome ?: "NONE") == outcomeFilter } }

    AppScaffold(
        title = "Customers",
        subtitle = shown?.let { "${it.size} customers" },
        topLevel = true,
        actions = {
            IconButton(onClick = { nav.navigate("dialpad") }) { Icon(Icons.Filled.Dialpad, "Dial pad") }
            IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "More") }
            DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem(text = { Text("Import Excel / CSV") }, leadingIcon = { Icon(Icons.Filled.UploadFile, null) }, onClick = { menu = false; nav.navigate("import") })
                DropdownMenuItem(text = { Text("Import phone contacts") }, leadingIcon = { Icon(Icons.Filled.Contacts, null) }, onClick = { menu = false; nav.navigate("contacts") })
                DropdownMenuItem(text = { Text("Reports & export") }, leadingIcon = { Icon(Icons.Filled.Assessment, null) }, onClick = { menu = false; nav.navigate("reports") })
            }
        },
        fab = { FloatingActionButton(onClick = { nav.navigate("edit/0") }) { Icon(Icons.Filled.PersonAdd, "Add customer") } }
    ) { p ->
        Column(Modifier.padding(p).fillMaxSize()) {
            SearchField(q, { q = it }, "Search name, number, company, location", Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
            LazyRow(contentPadding = PaddingValues(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                item { FilterChip(cat.isEmpty() && outcomeFilter.isEmpty(), { cat = ""; outcomeFilter = "" }, { Text("All") }) }
                items(cats) { c -> FilterChip(cat == c, { cat = if (cat == c) "" else c }, { Text(c) }) }
                item { FilterChip(outcomeFilter == "NONE", { outcomeFilter = if (outcomeFilter == "NONE") "" else "NONE" }, { Text("Never called") }) }
                items(Outcome.entries) { o -> FilterChip(outcomeFilter == o.name, { outcomeFilter = if (outcomeFilter == o.name) "" else o.name }, { Text(o.label) }) }
            }
            when {
                shown == null -> {}
                shown.isEmpty() && q.isEmpty() && cat.isEmpty() && outcomeFilter.isEmpty() ->
                    EmptyState(Icons.Filled.People, "No customers yet", "Import from Excel/CSV or your phone contacts, or add one manually.") {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { nav.navigate("import") }) { Text("Import file") }
                            OutlinedButton(onClick = { nav.navigate("contacts") }) { Text("Phone contacts") }
                        }
                    }
                shown.isEmpty() -> EmptyState(Icons.Filled.SearchOff, "No match", "Try another search or filter.")
                else -> LazyColumn(contentPadding = PaddingValues(bottom = 88.dp)) {
                    items(shown, key = { it.customer.id }) { r ->
                        CustomerListItem(r.customer, r.lastOutcome, r.lastCallAt, onClick = { nav.navigate("customer/${r.customer.id}") }) {
                            IconButton(onClick = { caller(r.customer, null) }) { Icon(Icons.Filled.Call, "Call", tint = CallGreen) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun rememberSaveableString() = androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf("") }

@Composable
fun CustomerListItem(c: Customer, lastOutcome: String?, lastCallAt: Long?, onClick: () -> Unit, trailing: @Composable () -> Unit = {}) {
    ListItem(
        modifier = Modifier.clickable(onClick = onClick),
        headlineContent = { Text(c.name, fontWeight = FontWeight.SemiBold) },
        supportingContent = {
            Column {
                Text(listOf(c.phone, c.company).filter { it.isNotBlank() }.joinToString(" · "))
                if (lastCallAt != null) Row(verticalAlignment = Alignment.CenterVertically) {
                    OutcomeBadge(lastOutcome)
                    Spacer(Modifier.width(6.dp))
                    Text(Fmt.friendly(lastCallAt), style = MaterialTheme.typography.bodySmall, color = Color.Gray)
                }
            }
        },
        trailingContent = trailing
    )
    HorizontalDivider()
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CustomerDetailScreen(nav: NavHostController, id: Long) {
    val db = MiniDialerApp.db
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val caller = LocalCaller.current
    val customer by db.customers().observe(id).collectAsState(null)
    val calls by db.calls().forCustomer(id).collectAsState(emptyList())
    val fus by db.followUps().forCustomer(id).collectAsState(emptyList())
    val recs by db.recordings().forCustomer(id).collectAsState(emptyList())
    val campaigns by db.campaigns().campaignsOf(id).collectAsState(emptyList())
    val allCampaigns by db.campaigns().all().collectAsState(emptyList())
    var confirmDelete by remember { mutableStateOf(false) }
    var addFu by remember { mutableStateOf(false) }
    var addToList by remember { mutableStateOf(false) }
    var playing by remember { mutableLongStateOf(0L) }
    var loaded by remember { mutableStateOf(false) }
    LaunchedEffect(customer) { if (customer != null) loaded = true else if (loaded) nav.popBackStack() }

    val c = customer
    AppScaffold(
        title = c?.name ?: "",
        subtitle = c?.phone,
        onBack = { nav.popBackStack() },
        actions = {
            IconButton(onClick = { nav.navigate("edit/$id") }) { Icon(Icons.Filled.Edit, "Edit") }
            IconButton(onClick = { confirmDelete = true }) { Icon(Icons.Filled.Delete, "Delete") }
        }
    ) { p ->
        if (c == null) return@AppScaffold
        Column(Modifier.padding(p).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(c.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text(c.phone, style = MaterialTheme.typography.titleMedium, color = Brand)
                    Spacer(Modifier.height(6.dp))
                    LabeledValue("Company", c.company)
                    LabeledValue("Email", c.email)
                    LabeledValue("Location", c.location)
                    LabeledValue("Category", c.category)
                    LabeledValue("Remarks", c.remarks)
                    LabeledValue("Added", Fmt.date(c.createdAt))
                    if (campaigns.isNotEmpty()) LabeledValue("Calling lists", campaigns.joinToString { it.name })
                }
            }
            Spacer(Modifier.height(12.dp))
            Button(onClick = { caller(c, null) }, modifier = Modifier.fillMaxWidth().height(56.dp), colors = ButtonDefaults.buttonColors(containerColor = CallGreen)) {
                Icon(Icons.Filled.Call, null); Spacer(Modifier.width(8.dp)); Text("Call ${c.phone}")
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { CallManager.manualLog(ctx, c.id, null, c.phone); nav.navigate("logcall") }) { Text("Log a call") }
                OutlinedButton(onClick = { addFu = true }) { Text("Add follow-up") }
                OutlinedButton(onClick = { addToList = true }) { Text("Add to list") }
            }

            val pending = fus.filter { it.status == FuStatus.PENDING }
            SectionTitle("Follow-ups (${pending.size} pending)")
            if (fus.isEmpty()) Text("No follow-ups", color = Color.Gray)
            fus.take(10).forEach { f ->
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        val overdue = f.status == FuStatus.PENDING && f.dueAt < System.currentTimeMillis()
                        Text(Fmt.friendly(f.dueAt), color = if (overdue) Color(0xFFDC2626) else Color.Unspecified, fontWeight = FontWeight.SemiBold)
                        if (f.note.isNotBlank()) Text(f.note, style = MaterialTheme.typography.bodySmall)
                    }
                    if (f.status == FuStatus.PENDING) {
                        TextButton(onClick = { scope.launch { Repo.completeFollowUp(ctx, f) } }) { Text("Done") }
                    } else SmallBadge("Completed", Color.Gray)
                }
            }

            SectionTitle("Recordings (${recs.size})")
            if (recs.isEmpty()) Text("No recordings linked", color = Color.Gray)
            recs.forEach { r ->
                Column(Modifier.fillMaxWidth().clickable { playing = if (playing == r.id) 0 else r.id }.padding(vertical = 6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.GraphicEq, null, tint = Brand)
                        Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f)) {
                            Text(r.displayName, maxLines = 1)
                            Text("${Fmt.dateTime(r.recordedAt)} · ${Fmt.clock(r.durationMs)}", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
                        }
                        Icon(if (playing == r.id) Icons.Filled.ExpandLess else Icons.Filled.PlayArrow, null)
                    }
                    if (playing == r.id) AudioPlayer(Repo.recordingFile(ctx, r))
                }
            }

            SectionTitle("Call history (${calls.size})")
            if (calls.isEmpty()) Text("Not called yet", color = Color.Gray)
            calls.forEach { CallHistoryItem(it) }
            Spacer(Modifier.height(24.dp))
        }
    }
    if (confirmDelete && c != null) ConfirmDialog("Delete ${c.name}?", "Call history and follow-ups of this customer will be deleted. Recordings are kept as unassigned.", onDismiss = { confirmDelete = false }) {
        scope.launch { Repo.deleteCustomer(ctx, c) }
    }
    if (addFu && c != null) AddFollowUpDialog(onDismiss = { addFu = false }) { t, note ->
        scope.launch { Repo.addFollowUp(ctx, FollowUp(customerId = c.id, dueAt = t, note = note)); Toast.makeText(ctx, "Follow-up scheduled", Toast.LENGTH_SHORT).show() }
    }
    if (addToList) AlertDialog(
        onDismissRequest = { addToList = false },
        title = { Text("Add to calling list") },
        text = {
            LazyColumn {
                items(allCampaigns) { cp ->
                    ListItem(headlineContent = { Text(cp.name) }, modifier = Modifier.clickable {
                        addToList = false
                        scope.launch {
                            val n = Repo.addToCampaign(cp.id, listOf(id))
                            Toast.makeText(ctx, if (n > 0) "Added to ${cp.name}" else "Already in ${cp.name}", Toast.LENGTH_SHORT).show()
                        }
                    })
                }
            }
        },
        confirmButton = {}, dismissButton = { TextButton(onClick = { addToList = false }) { Text("Cancel") } }
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AddFollowUpDialog(initial: Long = callbackPresets()[2].second, initialNote: String = "", title: String = "Schedule follow-up", onDismiss: () -> Unit, onSave: (Long, String) -> Unit) {
    var t by remember { mutableLongStateOf(initial) }
    var note by remember { mutableStateOf(initialNote) }
    var picker by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    callbackPresets().forEach { (l, v) -> AssistChip(onClick = { t = v }, label = { Text(l) }) }
                }
                OutlinedButton(onClick = { picker = true }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Filled.Event, null); Spacer(Modifier.width(8.dp)); Text(Fmt.friendly(t)) }
                OutlinedTextField(note, { note = it }, label = { Text("Note") }, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = { TextButton(onClick = { onSave(t, note); onDismiss() }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
    if (picker) DateTimePickerDialog(t, { picker = false }) { t = it }
}

@Composable
fun CustomerEditScreen(nav: NavHostController, id: Long, campaignId: Long) {
    val db = MiniDialerApp.db
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var loaded by remember { mutableStateOf(id == 0L) }
    var original by remember { mutableStateOf<Customer?>(null) }
    var name by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var company by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var location by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("") }
    var remarks by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val cats by db.customers().categories().collectAsState(emptyList())
    LaunchedEffect(id) {
        if (id > 0) db.customers().get(id)?.let {
            original = it; name = it.name; phone = it.phone; company = it.company; email = it.email
            location = it.location; category = it.category; remarks = it.remarks
        }
        loaded = true
    }
    AppScaffold(title = if (id == 0L) "New customer" else "Edit customer", onBack = { nav.popBackStack() }, actions = {
        TextButton(onClick = {
            scope.launch {
                val base = original ?: Customer(name = "", phone = "", phoneKey = "")
                val (newId, err) = Repo.saveCustomer(
                    base.copy(name = name.trim(), phone = phone, company = company.trim(), email = email.trim(),
                        location = location.trim(), category = category.trim(), remarks = remarks.trim())
                )
                error = err
                if (newId != null) {
                    if (id == 0L && campaignId > 0) Repo.addToCampaign(campaignId, listOf(newId))
                    Toast.makeText(ctx, "Saved", Toast.LENGTH_SHORT).show()
                    nav.popBackStack()
                }
            }
        }) { Text("SAVE", color = Color.White) }
    }) { p ->
        if (!loaded) return@AppScaffold
        Column(Modifier.padding(p).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            error?.let { Text(it, color = Color(0xFFDC2626)) }
            OutlinedTextField(name, { name = it }, label = { Text("Customer name *") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(phone, { phone = it }, label = { Text("Mobile number *") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), modifier = Modifier.fillMaxWidth(),
                supportingText = { if (phone.isNotBlank() && !PhoneUtil.isValid(phone)) Text("Number looks too short") })
            OutlinedTextField(company, { company = it }, label = { Text("Company name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(email, { email = it }, label = { Text("Email address") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(location, { location = it }, label = { Text("Location") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(category, { category = it }, label = { Text("Customer category") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            if (cats.isNotEmpty()) LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items(cats) { cc -> AssistChip(onClick = { category = cc }, label = { Text(cc) }) }
            }
            OutlinedTextField(remarks, { remarks = it }, label = { Text("Remarks") }, minLines = 3, modifier = Modifier.fillMaxWidth())
        }
    }
}

/** Multi-select existing customers to add to a calling list. */
@Composable
fun PickCustomersScreen(nav: NavHostController, campaignId: Long) {
    val db = MiniDialerApp.db
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var q by remember { mutableStateOf("") }
    var cat by remember { mutableStateOf("") }
    var outcomeFilter by remember { mutableStateOf("") }
    val rows by remember(q, cat) { db.customers().rows(q.trim(), cat) }.collectAsState(emptyList())
    val existing by db.campaigns().members(campaignId).collectAsState(emptyList())
    val cats by db.customers().categories().collectAsState(emptyList())
    val existingIds = remember(existing) { existing.map { it.customer.id }.toSet() }
    val shown = rows.filter { it.customer.id !in existingIds && (outcomeFilter.isEmpty() || it.lastOutcome == outcomeFilter) }
    val selected = remember { mutableStateListOf<Long>() }
    AppScaffold(title = "Add customers", subtitle = "${selected.size} selected", onBack = { nav.popBackStack() }, actions = {
        TextButton(onClick = {
            scope.launch {
                val n = Repo.addToCampaign(campaignId, selected.toList())
                Toast.makeText(ctx, "Added $n customers", Toast.LENGTH_SHORT).show()
                nav.popBackStack()
            }
        }, enabled = selected.isNotEmpty()) { Text("ADD", color = Color.White) }
    }) { p ->
        Column(Modifier.padding(p).fillMaxSize()) {
            SearchField(q, { q = it }, "Search", Modifier.padding(12.dp))
            LazyRow(contentPadding = PaddingValues(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items(cats) { c -> FilterChip(cat == c, { cat = if (cat == c) "" else c }, { Text(c) }) }
                items(Outcome.entries) { o -> FilterChip(outcomeFilter == o.name, { outcomeFilter = if (outcomeFilter == o.name) "" else o.name }, { Text("Last: ${o.label}") }) }
            }
            Row(Modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("${shown.size} customers not in this list", modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { selected.clear(); selected.addAll(shown.map { it.customer.id }) }) { Text("Select all") }
                TextButton(onClick = { selected.clear() }) { Text("Clear") }
            }
            LazyColumn {
                items(shown, key = { it.customer.id }) { r ->
                    val sel = r.customer.id in selected
                    ListItem(
                        modifier = Modifier.clickable { if (sel) selected.remove(r.customer.id) else selected.add(r.customer.id) },
                        leadingContent = { Checkbox(sel, null) },
                        headlineContent = { Text(r.customer.name) },
                        supportingContent = { Text(listOf(r.customer.phone, r.customer.company).filter { it.isNotBlank() }.joinToString(" · ")) },
                        trailingContent = { OutcomeBadge(r.lastOutcome) }
                    )
                }
            }
        }
    }
}
