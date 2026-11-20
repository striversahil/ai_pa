package com.miniautodialer.app.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.data.*
import com.miniautodialer.app.ui.*
import com.miniautodialer.app.util.Fmt
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun FollowUpsScreen(nav: NavHostController) {
    val db = MiniDialerApp.db
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val caller = LocalCaller.current
    var tab by rememberSaveable { mutableIntStateOf(0) }
    // refresh day boundaries every minute so lists stay correct past midnight
    var tick by remember { mutableLongStateOf(Fmt.startOfToday()) }
    LaunchedEffect(Unit) { while (true) { delay(60_000); tick = Fmt.startOfToday() } }
    val startToday = tick
    val startTomorrow = remember(tick) { Fmt.startOfTomorrow() }

    val today by remember(startToday) { db.followUps().pendingBetween(startToday, startTomorrow) }.collectAsState(emptyList())
    val upcoming by remember(startToday) { db.followUps().pendingBetween(startTomorrow, Long.MAX_VALUE) }.collectAsState(emptyList())
    val overdue by remember(startToday) { db.followUps().pendingBetween(0, startToday) }.collectAsState(emptyList())
    val completed by db.followUps().completed().collectAsState(emptyList())
    var reschedule by remember { mutableStateOf<FollowUp?>(null) }

    val list = when (tab) { 0 -> today; 1 -> upcoming; 2 -> overdue; else -> completed }
    AppScaffold(title = "Follow-ups & callbacks", topLevel = true) { p ->
        Column(Modifier.padding(p).fillMaxSize()) {
            ScrollableTabRow(tab, edgePadding = 8.dp) {
                Tab(tab == 0, { tab = 0 }, text = { Text("Today (${today.size})") })
                Tab(tab == 1, { tab = 1 }, text = { Text("Upcoming (${upcoming.size})") })
                Tab(tab == 2, { tab = 2 }, text = { Text("Overdue (${overdue.size})", color = if (overdue.isNotEmpty()) Color(0xFFDC2626) else Color.Unspecified) })
                Tab(tab == 3, { tab = 3 }, text = { Text("Completed") })
            }
            if (list.isEmpty()) {
                EmptyState(Icons.Filled.EventAvailable, when (tab) { 0 -> "No callbacks today"; 1 -> "Nothing upcoming"; 2 -> "No overdue follow-ups"; else -> "Nothing completed yet" },
                    "Schedule callbacks after a call or from a customer's profile.")
            }
            LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                items(list, key = { it.fu.id }) { r ->
                    val f = r.fu
                    val late = f.status == FuStatus.PENDING && f.dueAt < System.currentTimeMillis()
                    Card(
                        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp).clickable { nav.navigate("customer/${f.customerId}") },
                        colors = CardDefaults.cardColors(containerColor = Color.White)
                    ) {
                        Column(Modifier.padding(12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(r.customerName, fontWeight = FontWeight.Bold)
                                    Text(listOf(r.customerPhone, r.company).filter { it.isNotBlank() }.joinToString(" · "), style = MaterialTheme.typography.bodySmall)
                                }
                                if (f.status == FuStatus.PENDING) {
                                    FilledIconButton(onClick = {
                                        scope.launch { db.customers().get(f.customerId)?.let { caller(it, f.campaignId) } }
                                    }, colors = IconButtonDefaults.filledIconButtonColors(containerColor = CallGreen)) { Icon(Icons.Filled.Call, "Call") }
                                }
                            }
                            Text(
                                (if (f.status == FuStatus.DONE) "Was due " else "Due ") + Fmt.friendly(f.dueAt),
                                color = if (late) Color(0xFFDC2626) else Brand, fontWeight = FontWeight.SemiBold,
                                style = MaterialTheme.typography.bodyMedium
                            )
                            if (f.note.isNotBlank()) Text(f.note, style = MaterialTheme.typography.bodyMedium)
                            f.completedAt?.let { Text("Completed ${Fmt.friendly(it)}", style = MaterialTheme.typography.bodySmall, color = Color.Gray) }
                            Row {
                                if (f.status == FuStatus.PENDING) {
                                    TextButton(onClick = { scope.launch { Repo.completeFollowUp(ctx, f) } }) { Text("Mark done") }
                                    TextButton(onClick = { reschedule = f }) { Text("Reschedule") }
                                } else {
                                    TextButton(onClick = { scope.launch { Repo.reopenFollowUp(ctx, f) } }) { Text("Reopen") }
                                }
                                TextButton(onClick = { scope.launch { Repo.deleteFollowUp(ctx, f) } }) { Text("Delete", color = Color.Gray) }
                            }
                        }
                    }
                }
            }
        }
    }
    reschedule?.let { f ->
        AddFollowUpDialog(initial = maxOf(f.dueAt, System.currentTimeMillis() + 3600_000), initialNote = f.note, title = "Reschedule", onDismiss = { reschedule = null }) { t, note ->
            scope.launch { Repo.rescheduleFollowUp(ctx, f, t, note) }
        }
    }
}
