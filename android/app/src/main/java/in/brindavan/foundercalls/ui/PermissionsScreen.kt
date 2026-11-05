package in.brindavan.foundercalls.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import in.brindavan.foundercalls.data.Permissions

private val LABELS = mapOf(
    Manifest.permission.READ_PHONE_STATE to "Phone state — detect calls",
    Manifest.permission.READ_CALL_LOG to "Call log — verify duration/outcome",
    Manifest.permission.READ_CONTACTS to "Contacts — show client name",
    Manifest.permission.RECORD_AUDIO to "Microphone — record audio",
    Manifest.permission.POST_NOTIFICATIONS to "Notifications — foreground service",
)

@Composable
fun PermissionsScreen(onDone: () -> Unit) {
    val context = LocalContext.current
    var tick by remember { mutableIntStateOf(0) }
    val missing = remember(tick) { Permissions.missing(context) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        tick++
    }
    val batteryIgnored = remember(tick) {
        (context.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isIgnoringBatteryOptimizations(context.packageName) == true
    }

    fun requestBattery() {
        try {
            context.startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        } catch (_: Exception) {
            context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Permissions", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
        Text("Android needs all of these to log reliably. Nothing leaves the phone until a call ends.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        SectionCard {
            for ((permission, label) in LABELS) {
                val granted = ContextCompat.checkSelfPermission(context, permission) == android.content.pm.PackageManager.PERMISSION_GRANTED
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(label, fontSize = 13.sp)
                    Text(if (granted) "granted" else "missing", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
            }
            Button(onClick = { launcher.launch(Permissions.required.toTypedArray()) }, enabled = missing.isNotEmpty(), modifier = Modifier.fillMaxWidth()) {
                Text(if (missing.isEmpty()) "All permissions granted" else "Grant permissions")
            }
        }
        SectionCard(title = "Battery") {
            Text("Samsung kills background services unless the app is exempt. Disable battery optimization for Founder Calls.", fontSize = 13.sp)
            OutlinedButton(onClick = ::requestBattery, modifier = Modifier.fillMaxWidth()) {
                Text(if (batteryIgnored) "Battery optimization disabled" else "Disable battery optimization")
            }
        }
        if (Build.VERSION.SDK_INT >= 33) Hint("If no notification appears, allow notifications in system settings.")
        Button(onClick = onDone, enabled = Permissions.hasCore(context), modifier = Modifier.fillMaxWidth()) { Text("Continue") }
    }
}
