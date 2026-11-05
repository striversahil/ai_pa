package in.brindavan.foundercalls.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import in.brindavan.foundercalls.data.CallStatus

@Composable
fun SectionCard(
    title: String? = null,
    trailing: @Composable (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(18.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (title != null || trailing != null) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(title.orEmpty(), fontWeight = FontWeight.Bold, fontSize = 15.sp)
                trailing?.invoke()
            }
        }
        content()
    }
}

@Composable
fun StatusPill(status: CallStatus) {
    val (label, color) = when (status) {
        CallStatus.CONNECTED -> "connected" to Color(0xFF16A34A)
        CallStatus.MISSED -> "missed" to Color(0xFFDC2626)
        CallStatus.REJECTED -> "rejected" to Color(0xFFEA580C)
        CallStatus.BLOCKED -> "blocked" to Color(0xFF7C3AED)
        CallStatus.RINGING -> "ringing" to Color(0xFF0891B2)
        CallStatus.DIALING -> "dialing" to Color(0xFF0891B2)
        CallStatus.FAILED -> "failed" to Color(0xFF64748B)
    }
    Text(
        label,
        color = Color.White,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .background(color, RoundedCornerShape(999.dp))
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

@Composable
fun Hint(text: String) {
    Text(text, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
