package com.miniautodialer.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.data.Outcome
import com.miniautodialer.app.ui.*
import com.miniautodialer.app.util.Fmt
import com.miniautodialer.app.util.PhoneLogStats
import com.miniautodialer.app.util.PhoneStats
import com.miniautodialer.app.util.Summary

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DashboardScreen(nav: NavHostController) {
    val db = MiniDialerApp.db
    var range by rememberSaveable { mutableIntStateOf(0) } // 0 today, 1 week, 2 month, 3 all
    val from = remember(range) {
        when (range) {
            0 -> Fmt.startOfToday()
            1 -> Fmt.startOfDay(Fmt.weekStart(Fmt.today()))
            2 -> Fmt.startOfDay(Fmt.today().withDayOfMonth(1))
            else -> 0L
        }
    }
    val calls by remember(from) { db.calls().observeRange(from, Long.MAX_VALUE) }.collectAsState(emptyList())
    val totalContacts by db.customers().count().collectAsState(0)
    val pendingFu by db.followUps().pendingCount().collectAsState(0)
    val dueToday by remember { db.followUps().pendingDueBefore(Fmt.startOfTomorrow()) }.collectAsState(0)
    val recCount by db.recordings().count().collectAsState(0)
    val campaigns by db.campaigns().withStats().collectAsState(emptyList())
    val s = remember(calls) { Summary.of(calls) }
    val ctx = androidx.compose.ui.platform.LocalContext.current
    // Re-read when the range changes or a new app call is saved.
    val ps by produceState(PhoneStats(), from, calls.size) { value = PhoneLogStats.since(ctx, from) }
    val lastCampaign = campaigns.firstOrNull { it.campaign.id == MiniDialerApp.prefs.lastCampaignId && it.total > it.done }
        ?: campaigns.firstOrNull { it.total > it.done }

    AppScaffold(title = "Mini Auto Dialer", topLevel = true, fab = {
        FloatingActionButton(onClick = { nav.navigate("dialpad") }, containerColor = CallGreen, contentColor = Color.White) {
            Icon(Icons.Filled.Dialpad, "Dial pad")
        }
    }, actions = {
        IconButton(onClick = { nav.navigate("reports") }) { Icon(Icons.Filled.Assessment, "Reports") }
        IconButton(onClick = { nav.navigate("settings") }) { Icon(Icons.Filled.Settings, "Settings") }
    }) { p ->
        Column(Modifier.padding(p).fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp)) {
            if (lastCampaign != null) {
                Card(colors = CardDefaults.cardColors(containerColor = Brand), modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Continue calling", color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.bodySmall)
                            Text(lastCampaign.campaign.name, color = Color.White, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Text("${lastCampaign.total - lastCampaign.done} pending of ${lastCampaign.total}", color = Color.White)
                        }
                        Button(onClick = { nav.navigate("session/${lastCampaign.campaign.id}") }, colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Brand)) {
                            Icon(Icons.Filled.Call, null); Spacer(Modifier.width(6.dp)); Text("Resume")
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
            if (dueToday > 0) {
                InfoCard("$dueToday callback(s) due today or overdue", Icons.Filled.Alarm, Color(0xFFDC2626)) {
                    TextButton(onClick = { nav.goTop("followups") }) { Text("Open follow-ups") }
                }
                Spacer(Modifier.height(8.dp))
            }
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                listOf("Today", "Week", "Month", "All").forEachIndexed { i, l ->
                    SegmentedButton(range == i, { range = i }, SegmentedButtonDefaults.itemShape(i, 4)) { Text(l) }
                }
            }
            Spacer(Modifier.height(8.dp))
            val cards = listOf(
                Triple("Total contacts", "$totalContacts", Icons.Filled.People to Brand),
                Triple("Total calls", "${s.calls}", Icons.Filled.Call to Color(0xFF2563EB)),
                Triple("Connected", "${s.connected}", Icons.Filled.PhoneInTalk to Outcome.CONNECTED.color),
                Triple("Busy", "${s.byOutcome[Outcome.BUSY] ?: 0}", Icons.Filled.PhoneLocked to Outcome.BUSY.color),
                Triple("Not answered", "${s.byOutcome[Outcome.NOT_ANSWERED] ?: 0}", Icons.Filled.PhoneMissed to Outcome.NOT_ANSWERED.color),
                Triple("Interested", "${s.byOutcome[Outcome.INTERESTED] ?: 0}", Icons.Filled.ThumbUp to Outcome.INTERESTED.color),
                Triple("Callback required", "${s.byOutcome[Outcome.CALLBACK] ?: 0}", Icons.Filled.PhoneCallback to Outcome.CALLBACK.color),
                Triple("Pending follow-ups", "$pendingFu", Icons.Filled.Event to Color(0xFF4F46E5)),
                Triple("Connected time", Fmt.duration(s.durationSec), Icons.Filled.Timer to Color(0xFF0D9488)),
                Triple("Recordings", "$recCount", Icons.Filled.Mic to Color(0xFF7C3AED)),
            )
            cards.chunked(2).forEach { pair ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 4.dp)) {
                    pair.forEach { (label, value, ic) ->
                        StatCard(label, value, ic.first, ic.second, Modifier.weight(1f), onClick = when (label) {
                            "Total contacts" -> { { nav.goTop("customers") } }
                            "Pending follow-ups" -> { { nav.goTop("followups") } }
                            "Recordings" -> { { nav.goTop("recordings") } }
                            else -> { { nav.navigate("reports") } }
                        })
                    }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
            // Every call on the phone, including the normal dialer (Android call log).
            SectionTitle("All phone calls (including normal dialer)")
            if (!ps.readable) {
                Text("Allow call log access to see these.", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
            } else {
                listOf(
                    Triple("All calls", "${ps.total}", Icons.Filled.Call to Color(0xFF2563EB)),
                    Triple("Connected", "${ps.connected}", Icons.Filled.PhoneInTalk to Outcome.CONNECTED.color),
                    Triple("Outgoing", "${ps.outgoing}", Icons.Filled.CallMade to Brand),
                    Triple("Incoming answered", "${ps.incoming}", Icons.Filled.CallReceived to Color(0xFF0D9488)),
                    Triple("Missed / rejected", "${ps.missed}", Icons.Filled.PhoneMissed to Outcome.NOT_ANSWERED.color),
                    Triple("Talk time", Fmt.duration(ps.talkSec.toInt()), Icons.Filled.Timer to Color(0xFF0D9488)),
                ).chunked(2).forEach { pair ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 4.dp)) {
                        pair.forEach { (label, value, ic) -> StatCard(label, value, ic.first, ic.second, Modifier.weight(1f)) }
                    }
                }
            }
            if (s.calls > 0) {
                SectionTitle("Outcome breakdown")
                val max = s.byOutcome.values.maxOrNull()?.coerceAtLeast(1) ?: 1
                Outcome.entries.filter { (s.byOutcome[it] ?: 0) > 0 }.forEach { o ->
                    val n = s.byOutcome[o] ?: 0
                    Row(Modifier.padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(o.label, Modifier.width(130.dp), style = MaterialTheme.typography.bodySmall)
                        Box(Modifier.weight(1f).height(14.dp)) {
                            Box(Modifier.fillMaxHeight().fillMaxWidth(n.toFloat() / max).background(o.color, RoundedCornerShape(4.dp)))
                        }
                        Text(" $n", style = MaterialTheme.typography.bodySmall, modifier = Modifier.width(40.dp))
                    }
                }
                Text("Connect rate ${s.connectRate}% · average connected call ${Fmt.duration(s.avgDuration)}", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
            }
            SectionTitle("Quick actions")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AssistChip(onClick = { nav.navigate("dialpad") }, label = { Text("Dial a number") }, leadingIcon = { Icon(Icons.Filled.Dialpad, null) })
                AssistChip(onClick = { nav.navigate("import") }, label = { Text("Import Excel/CSV") }, leadingIcon = { Icon(Icons.Filled.UploadFile, null) })
                AssistChip(onClick = { nav.navigate("contacts") }, label = { Text("Phone contacts") }, leadingIcon = { Icon(Icons.Filled.Contacts, null) })
                AssistChip(onClick = { nav.navigate("edit/0") }, label = { Text("Add customer") }, leadingIcon = { Icon(Icons.Filled.PersonAdd, null) })
                AssistChip(onClick = { nav.navigate("reports") }, label = { Text("Reports") }, leadingIcon = { Icon(Icons.Filled.Assessment, null) })
                AssistChip(onClick = { nav.navigate("settings") }, label = { Text("Backup") }, leadingIcon = { Icon(Icons.Filled.Backup, null) })
            }
            Spacer(Modifier.height(88.dp))
        }
    }
}
