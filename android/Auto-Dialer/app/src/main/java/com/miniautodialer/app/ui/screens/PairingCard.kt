package com.miniautodialer.app.ui.screens

import android.os.Build
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Link
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.miniautodialer.app.BuildConfig
import com.miniautodialer.app.MiniDialerApp
import com.miniautodialer.app.remote.Api
import com.miniautodialer.app.remote.SyncRunner
import com.miniautodialer.app.remote.SyncScheduler
import com.miniautodialer.app.ui.Brand
import com.miniautodialer.app.ui.InfoCard
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Not paired yet: the agent enters their name, the phone shows a 6-digit code
 * and waits until the sales head assigns it in Founder OS → Sales → Controller.
 */
@Composable
fun PairingCard() {
    val session = MiniDialerApp.session
    val ctx = MiniDialerApp.instance
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var code by remember { mutableStateOf(session.pairCode) }
    var busy by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf<String?>(null) }

    // Poll while a request is open; the token arrives exactly once.
    LaunchedEffect(code) {
        val id = session.pairRequestId ?: return@LaunchedEffect
        val secret = session.pairSecret ?: return@LaunchedEffect
        while (true) {
            val res = runCatching { Api(session).pairStatus(id, secret) }.getOrNull()
            when (res?.optString("status")) {
                "paired" -> {
                    session.savePaired(res.getString("token"), res.optString("agent"), res.optString("telecallerId"))
                    SyncScheduler.schedulePeriodic(ctx)
                    SyncRunner.run(ctx)
                    return@LaunchedEffect
                }
                "rejected", "expired", "claimed" -> {
                    session.clearPairRequest(); code = null
                    msg = "The request was ${res.optString("status")}. Ask your sales head and try again."
                    return@LaunchedEffect
                }
            }
            delay(3_000)
        }
    }

    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Connect to Founder OS", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        if (code == null) {
            Text("Your sales head links this phone to you. Enter your name and tap Connect; a code appears that they confirm in the Controller.")
            OutlinedTextField(name, { name = it }, label = { Text("Your name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Button(
                enabled = !busy && name.isNotBlank(),
                onClick = {
                    busy = true; msg = null
                    scope.launch {
                        runCatching {
                            Api(session).pairRequest(name.trim(), "${Build.MANUFACTURER} ${Build.MODEL}", BuildConfig.VERSION_NAME)
                        }.onSuccess {
                            session.savePairRequest(it.getString("requestId"), it.getString("secret"), it.getString("code"))
                            code = it.getString("code")
                        }.onFailure { msg = "Could not reach Founder OS: ${it.message}. Check the internet connection." }
                        busy = false
                    }
                },
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Icon(Icons.Filled.Link, null); Spacer(Modifier.width(8.dp)); Text(if (busy) "Connecting…" else "Connect") }
        } else {
            Text("Tell your sales head this code:", style = MaterialTheme.typography.bodyLarge)
            Text(code!!.chunked(3).joinToString(" "), fontSize = 44.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold,
                color = Brand, modifier = Modifier.align(Alignment.CenterHorizontally))
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
                Text("Waiting for approval in Founder OS → Sales → Controller → Auto Dialer")
            }
            TextButton(onClick = { session.clearPairRequest(); code = null }) { Text("Cancel and start again") }
        }
        msg?.let { InfoCard(it, color = Color(0xFFDC2626)) }
    }
}
