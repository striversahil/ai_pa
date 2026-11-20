package com.miniautodialer.app.ui.screens

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
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.data.*
import com.miniautodialer.app.ui.*
import com.miniautodialer.app.util.ExportFormat
import com.miniautodialer.app.util.Exporter
import com.miniautodialer.app.util.Fmt
import kotlinx.coroutines.launch

@Composable
fun CampaignsScreen(nav: NavHostController) {
    val db = MiniDialerApp.db
    val scope = rememberCoroutineScope()
    val stats by db.campaigns().withStats().collectAsState(null)
    var create by remember { mutableStateOf(false) }
    AppScaffold(
        title = "Calling lists", topLevel = true,
        fab = { ExtendedFloatingActionButton(onClick = { create = true }, icon = { Icon(Icons.Filled.Add, null) }, text = { Text("New list") }) }
    ) { p ->
        val s = stats
        if (s != null && s.isEmpty()) {
            Box(Modifier.padding(p)) { EmptyState(Icons.Filled.Checklist, "No calling lists", "Create a list such as “New Customer Leads”.") }
        } else LazyColumn(Modifier.padding(p), contentPadding = PaddingValues(12.dp, 12.dp, 12.dp, 88.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(s.orEmpty(), key = { it.campaign.id }) { st ->
                Card(Modifier.fillMaxWidth().clickable { nav.navigate("campaign/${st.campaign.id}") }, colors = CardDefaults.cardColors(containerColor = Color.White)) {
                    Column(Modifier.padding(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(st.campaign.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                                Text("${st.total} customers · ${st.done} called · ${st.total - st.done} pending", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
                            }
                            if (st.total - st.done > 0) FilledTonalButton(onClick = { nav.navigate("session/${st.campaign.id}") }) {
                                Icon(Icons.Filled.Call, null, Modifier.size(18.dp)); Spacer(Modifier.width(4.dp))
                                Text(if (st.done > 0) "Resume" else "Start")
                            }
                        }
                        Spacer(Modifier.height(8.dp))
                        LinearProgressIndicator(progress = { if (st.total == 0) 0f else st.done.toFloat() / st.total }, modifier = Modifier.fillMaxWidth())
                    }
                }
            }
        }
    }
    if (create) TextInputDialog("New calling list", label = "List name", confirm = "Create", onDismiss = { create = false }) { name ->
        scope.launch { val id = db.campaigns().insert(Campaign(name = name)); nav.navigate("campaign/$id") }
    }
}

@Composable
fun CampaignDetailScreen(nav: NavHostController, id: Long) {
    val db = MiniDialerApp.db
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val campaign by db.campaigns().observe(id).collectAsState(null)
    val members by db.campaigns().members(id).collectAsState(null)
    var tab by remember { mutableIntStateOf(0) }
    var menu by remember { mutableStateOf(false) }
    var addMenu by remember { mutableStateOf(false) }
    var rename by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var removeMember by remember { mutableStateOf<MemberRow?>(null) }
    var loaded by remember { mutableStateOf(false) }
    LaunchedEffect(campaign) { if (campaign != null) loaded = true else if (loaded) nav.popBackStack() }

    val exportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(ExportFormat.XLSX.mime)) { uri ->
        if (uri != null) scope.launch {
            val msg = runCatching { Exporter.exportCustomers(ctx, uri, ExportFormat.XLSX, id) }.getOrElse { "Export failed: ${it.message}" }
            Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show()
        }
    }

    val m = members.orEmpty()
    val done = m.count { it.mStatus == MemberStatus.DONE }
    val connected = m.count { Outcome.of(it.mLastOutcome)?.connected == true }
    val interested = m.count { it.mLastOutcome == Outcome.INTERESTED.name }
    val shown = when (tab) { 1 -> m.filter { it.mStatus == MemberStatus.PENDING }; 2 -> m.filter { it.mStatus == MemberStatus.DONE }; else -> m }

    AppScaffold(
        title = campaign?.name ?: "", onBack = { nav.popBackStack() },
        actions = {
            IconButton(onClick = { addMenu = true }) { Icon(Icons.Filled.PersonAdd, "Add customers") }
            DropdownMenu(addMenu, { addMenu = false }) {
                DropdownMenuItem(text = { Text("Import Excel / CSV file") }, leadingIcon = { Icon(Icons.Filled.UploadFile, null) }, onClick = { addMenu = false; nav.navigate("import?campaign=$id") })
                DropdownMenuItem(text = { Text("From phone contacts") }, leadingIcon = { Icon(Icons.Filled.Contacts, null) }, onClick = { addMenu = false; nav.navigate("contacts?campaign=$id") })
                DropdownMenuItem(text = { Text("From existing customers") }, leadingIcon = { Icon(Icons.Filled.People, null) }, onClick = { addMenu = false; nav.navigate("pick/$id") })
                DropdownMenuItem(text = { Text("New customer") }, leadingIcon = { Icon(Icons.Filled.Add, null) }, onClick = { addMenu = false; nav.navigate("edit/0?campaign=$id") })
            }
            IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "More") }
            DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem(text = { Text("Rename") }, onClick = { menu = false; rename = true })
                DropdownMenuItem(text = { Text("Re-queue busy / not answered") }, onClick = {
                    menu = false; scope.launch { db.campaigns().resetOutcomes(id, Outcome.RETRY.map { it.name }); Toast.makeText(ctx, "Moved back to pending", Toast.LENGTH_SHORT).show() }
                })
                DropdownMenuItem(text = { Text("Reset all to pending") }, onClick = { menu = false; scope.launch { db.campaigns().resetAll(id) } })
                DropdownMenuItem(text = { Text("Export results (Excel)") }, onClick = {
                    menu = false; exportLauncher.launch("${campaign?.name ?: "List"}_${Fmt.isoDate(System.currentTimeMillis())}.xlsx")
                })
                DropdownMenuItem(text = { Text("Delete list") }, onClick = { menu = false; confirmDelete = true })
            }
        }
    ) { p ->
        Column(Modifier.padding(p).fillMaxSize()) {
            Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatCard("Total", "${m.size}", Icons.Filled.People, Brand, Modifier.weight(1f))
                StatCard("Pending", "${m.size - done}", Icons.Filled.HourglassTop, Color(0xFFEA580C), Modifier.weight(1f))
            }
            Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatCard("Connected", "$connected", Icons.Filled.PhoneInTalk, CallGreen, Modifier.weight(1f))
                StatCard("Interested", "$interested", Icons.Filled.ThumbUp, Color(0xFF0D9488), Modifier.weight(1f))
            }
            Button(
                onClick = { nav.navigate("session/$id") }, enabled = m.isNotEmpty(),
                modifier = Modifier.fillMaxWidth().padding(12.dp).height(52.dp), colors = ButtonDefaults.buttonColors(containerColor = CallGreen)
            ) {
                Icon(Icons.Filled.Call, null); Spacer(Modifier.width(8.dp))
                Text(if (done > 0 && done < m.size) "Resume calling" else "Start calling")
            }
            TabRow(tab) {
                Tab(tab == 0, { tab = 0 }, text = { Text("All (${m.size})") })
                Tab(tab == 1, { tab = 1 }, text = { Text("Pending (${m.size - done})") })
                Tab(tab == 2, { tab = 2 }, text = { Text("Called ($done)") })
            }
            if (members != null && m.isEmpty()) {
                EmptyState(Icons.Filled.PersonAdd, "List is empty", "Tap the add-person icon to import customers.") {
                    Button(onClick = { nav.navigate("import?campaign=$id") }) { Text("Import Excel / CSV") }
                }
            }
            LazyColumn {
                items(shown, key = { it.customer.id }) { r ->
                    ListItem(
                        modifier = Modifier.clickable { nav.navigate("session/$id?start=${r.customer.id}") },
                        leadingContent = { Text("${r.mPosition}", color = Color.Gray, style = MaterialTheme.typography.bodySmall) },
                        headlineContent = { Text(r.customer.name, fontWeight = FontWeight.SemiBold) },
                        supportingContent = { Text(listOf(r.customer.phone, r.customer.company).filter { it.isNotBlank() }.joinToString(" · ")) },
                        trailingContent = {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                if (r.mStatus == MemberStatus.DONE) OutcomeBadge(r.mLastOutcome) else SmallBadge("Pending", Brand)
                                IconButton(onClick = { removeMember = r }) { Icon(Icons.Filled.RemoveCircleOutline, "Remove from list", tint = Color.Gray) }
                            }
                        }
                    )
                    HorizontalDivider()
                }
            }
        }
    }
    if (rename) TextInputDialog("Rename list", campaign?.name ?: "", "List name", onDismiss = { rename = false }) { n ->
        scope.launch { campaign?.let { db.campaigns().update(it.copy(name = n)) } }
    }
    if (confirmDelete) ConfirmDialog("Delete this list?", "Customers and their call history are kept; only the list is removed.", onDismiss = { confirmDelete = false }) {
        scope.launch { campaign?.let { db.campaigns().delete(it) } }
    }
    removeMember?.let { r ->
        ConfirmDialog("Remove ${r.customer.name}?", "The customer is removed from this list only.", "Remove", { removeMember = null }) {
            scope.launch { db.campaigns().removeMember(id, r.customer.id) }
        }
    }
}
