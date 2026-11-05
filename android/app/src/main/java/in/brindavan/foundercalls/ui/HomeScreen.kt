package in.brindavan.foundercalls.ui

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import in.brindavan.foundercalls.FounderCallsApp
import in.brindavan.foundercalls.call.CallTrackingService
import in.brindavan.foundercalls.data.Clock
import in.brindavan.foundercalls.sync.ApiClient
import in.brindavan.foundercalls.sync.SyncScheduler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun HomeScreen(
    onOpenLog: () -> Unit,
    onOpenMatrix: () -> Unit,
    onOpenPermissions: () -> Unit,
) {
    val context = LocalContext.current
    val app = context.applicationContext as FounderCallsApp
    val scope = rememberCoroutineScope()
    val db = app.container.db
    val prefs = app.container.prefs
    val tokens = app.container.tokens

    val tracking by prefs.trackingEnabled.collectAsState(initial = false)
    val source by prefs.testSource.collectAsState(initial = "AUTO")
    val calls by db.calls().observeAll().collectAsState(initial = emptyList())
    var paired by remember { mutableStateOf(tokens.token != null) }
    var agent by remember { mutableStateOf(tokens.agentName) }
    var showPair by remember { mutableStateOf(false) }

    val today = Clock.istDay()
    val todayCalls = calls.filter { it.istDay == today }

    fun setTracking(on: Boolean) {
        scope.launch {
            prefs.setTracking(on)
            if (on) CallTrackingService.ensureRunning(context) else CallTrackingService.stop(context)
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Founder Calls", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
        Text("POC build · Samsung matrix testing", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)

        SectionCard(title = "Tracking") {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column {
                    Text(if (tracking) "On — every call is logged" else "Off — calls are not logged", fontWeight = FontWeight.Bold)
                    Hint(if (tracking) "Recorder source: $source" else "Turn on before making test calls.")
                }
                Switch(checked = tracking, onCheckedChange = ::setTracking)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onOpenPermissions) { Text("Permissions") }
                OutlinedButton(onClick = onOpenMatrix) { Text("Test matrix") }
            }
        }

        SectionCard(title = "Today") {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                Column { Text("${todayCalls.size}", fontSize = 30.sp, fontWeight = FontWeight.ExtraBold); Hint("attempts") }
                Column { Text("${todayCalls.count { it.status.name == "CONNECTED" }}", fontSize = 30.sp, fontWeight = FontWeight.ExtraBold); Hint("connected") }
                Column { Text("${todayCalls.count { it.recordingPath != null }}", fontSize = 30.sp, fontWeight = FontWeight.ExtraBold); Hint("with audio") }
            }
            Button(onClick = onOpenLog, modifier = Modifier.fillMaxWidth()) { Text("Open call log") }
        }

        SectionCard(title = "Server") {
            if (paired) {
                Text("Paired as ${agent.ifBlank { "agent" }}", fontWeight = FontWeight.Bold)
                Hint("Calls sync automatically once online.")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { SyncScheduler.runNow(context) }) { Text("Sync now") }
                    OutlinedButton(onClick = {
                        tokens.clear()
                        paired = false
                        agent = ""
                    }) { Text("Unpair") }
                }
            } else {
                Hint("Not paired. Enter the one-time code from Sales → Calls → Devices.")
                Button(onClick = { showPair = true }, modifier = Modifier.fillMaxWidth()) { Text("Pair this device") }
            }
        }

        SectionCard(title = "Data") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = {
                    scope.launch {
                        val file = exportCsv(context, db)
                        withContext(Dispatchers.Main) { shareCsv(context, file) }
                    }
                }) { Text("Export CSV") }
            }
            Hint("Export includes the far-side score column for the POC gate.")
        }
    }

    if (showPair) {
        PairDialog(
            onDismiss = { showPair = false },
            onPaired = { token, name ->
                tokens.token = token
                tokens.agentName = name
                paired = true
                agent = name
                showPair = false
                SyncScheduler.schedule(context)
            },
        )
    }
}

@Composable
private fun PairDialog(onDismiss: () -> Unit, onPaired: (String, String) -> Unit) {
    val context = LocalContext.current
    val app = context.applicationContext as FounderCallsApp
    val scope = rememberCoroutineScope()
    var code by remember { mutableStateOf("") }
    var label by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Pair device") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Enter the one-time code a manager generated for you.", fontSize = 13.sp)
                OutlinedTextField(code.trim(), { code = it.uppercase() }, label = { Text("Pairing code") }, singleLine = true)
                OutlinedTextField(label, { label = it }, label = { Text("Device label (e.g. Ravi Samsung)") }, singleLine = true)
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
            }
        },
        confirmButton = {
            TextButton(
                enabled = code.isNotBlank() && !busy,
                onClick = {
                    busy = true
                    error = ""
                    scope.launch {
                        try {
                            val deviceId = app.container.prefs.deviceId()
                            val res = withContext(Dispatchers.IO) { ApiClient.pair(code.trim(), deviceId, label.ifBlank { "Android device" }) }
                            app.container.tokens.deviceLabel = label
                            app.container.tokens.loggingOnly = res.loggingOnly
                            onPaired(res.token, res.agent)
                        } catch (e: Exception) {
                            error = e.message ?: "pairing failed"
                        } finally {
                            busy = false
                        }
                    }
                },
            ) { Text(if (busy) "Pairing…" else "Pair") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

fun batteryOptimizationDisabled(context: Context): Boolean {
    val pm = context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager ?: return false
    return pm.isIgnoringBatteryOptimizations(context.packageName)
}
