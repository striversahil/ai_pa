package in.brindavan.foundercalls.ui

import android.media.MediaPlayer
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
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
import in.brindavan.foundercalls.data.AudioSources
import in.brindavan.foundercalls.data.CallEventEntity
import in.brindavan.foundercalls.data.Clock
import kotlinx.coroutines.launch
import java.io.File

private data class SourceStat(val name: String, val calls: Int, val average: Double?)

@Composable
fun MatrixScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val app = context.applicationContext as FounderCallsApp
    val db = app.container.db
    val prefs = app.container.prefs
    val scope = rememberCoroutineScope()
    val selected by prefs.testSource.collectAsState(initial = AudioSources.AUTO)
    var stats by remember { mutableStateOf<List<SourceStat>>(emptyList()) }
    var latest by remember { mutableStateOf<CallEventEntity?>(null) }
    var score by remember { mutableStateOf<Int?>(null) }

    suspend fun reload() {
        val names = listOf(AudioSources.AUTO) + AudioSources.ORDER
        stats = names.map { SourceStat(it, db.calls().scoredCount(it), db.calls().averageScore(it)) }
        latest = db.calls().connected().firstOrNull { it.recordingPath != null }
        score = latest?.userFarSideScore
    }

    LaunchedEffect(Unit) { reload() }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Audio source matrix", fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
            TextButton(onClick = onBack) { Text("Back") }
        }
        Hint("One source per test call. Speakers are forced on while recording. Make 5 outgoing and 5 incoming connected calls per source, then score each recording. GO if ≥3/5 on ≥60% of connected calls.")

        SectionCard(title = "Source for the next call") {
            for (name in listOf(AudioSources.AUTO) + AudioSources.ORDER) {
                Row(
                    Modifier.fillMaxWidth().selectable(selected == name) { scope.launch { prefs.setTestSource(name) } },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected == selected, onClick = { scope.launch { prefs.setTestSource(name) } })
                    Column(Modifier.weight(1f)) {
                        Text(if (name == AudioSources.AUTO) "AUTO — try the chain in order" else name, fontSize = 13.sp)
                        val stat = stats.firstOrNull { it.name == name }
                        Hint("${stat?.calls ?: 0} scored" + (stat?.average?.let { " · avg %.1f/5".format(it) } ?: ""))
                    }
                }
            }
        }

        SectionCard(title = "Score the latest recording") {
            val call = latest
            if (call == null || call.recordingPath == null) {
                Hint("No recording yet. Turn tracking on and make a test call.")
            } else {
                Text("${call.audioSource} · ${Clock.istTime(call.attemptAt)} · ${call.recordingBytes / 1024} KB · amp ${call.maxAmplitude}", fontSize = 12.sp)
                MatrixPlayer(call.recordingPath)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (n in 1..5) {
                        OutlinedButton(onClick = { score = n }, modifier = Modifier.weight(1f)) { Text(if (score == n) "★$n" else "$n") }
                    }
                }
                Button(
                    onClick = {
                        scope.launch {
                            db.calls().update(call.copy(userFarSideScore = score))
                            reload()
                        }
                    },
                    enabled = score != null,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Save score for this recording") }
            }
        }

        SectionCard(title = "Run") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = {
                    scope.launch {
                        val file = exportCsv(context, db)
                        shareCsv(context, file)
                    }
                }) { Text("Export results CSV") }
                OutlinedButton(onClick = { scope.launch { reload() } }) { Text("Refresh") }
            }
            Hint("Gate check: look for a source with ≥60% of calls at ≥3/5.")
        }
    }
}

@Composable
private fun MatrixPlayer(path: String?) {
    var playing by remember { mutableStateOf(false) }
    var player by remember { mutableStateOf<MediaPlayer?>(null) }
    DisposableEffect(path) { onDispose { player?.release(); player = null } }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = {
            if (playing) { player?.pause(); playing = false }
            else {
                if (player == null && path != null && File(path).exists()) {
                    player = MediaPlayer().apply { setDataSource(path); prepare(); setOnCompletionListener { playing = false } }
                }
                player?.start(); playing = true
            }
        }) { Text(if (playing) "Pause" else "Play") }
        Text(if (path == null) "no file" else "", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
