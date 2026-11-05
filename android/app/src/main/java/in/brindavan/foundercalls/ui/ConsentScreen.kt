package in.brindavan.foundercalls.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun ConsentScreen(onAccept: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Founder Calls", fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
        Text("Call recording & logging for company phones", color = MaterialTheme.colorScheme.onSurfaceVariant)
        SectionCard(title = "What this app records") {
            Text("• Every call attempt: number, contact name, direction, time, ring and talk duration.")
            Text("• Call audio where Android and the phone allow it. Audio is best-effort on Android 10+.")
            Text("• The app also reads the system call log to verify durations and missed/rejected outcomes.")
        }
        SectionCard(title = "Where it goes") {
            Text("Logs and audio sync to Brindavan Udyog's Founder OS. Audio is kept for 90 days, then purged. Managers and MIS can listen; each agent can listen to their own calls.")
        }
        SectionCard(title = "Consent") {
            Text("By continuing you accept that business calls on this device are recorded for QA and manager review. The native dialer may announce recording. You can switch to logging-only at any time.")
        }
        Spacer(Modifier.height(8.dp))
        Button(onClick = onAccept, modifier = Modifier.fillMaxWidth()) { Text("Accept and continue") }
    }
}
