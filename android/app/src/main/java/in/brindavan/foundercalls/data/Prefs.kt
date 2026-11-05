package in.brindavan.foundercalls.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.util.UUID

private val Context.settingsStore by preferencesDataStore("founder_calls_settings")

class Prefs(private val context: Context) {
    private object Keys {
        val consent = booleanPreferencesKey("consent_accepted")
        val tracking = booleanPreferencesKey("tracking_enabled")
        val forceSpeaker = booleanPreferencesKey("force_speaker")
        val wifiOnly = booleanPreferencesKey("upload_wifi_only")
        val testSource = stringPreferencesKey("test_source")
        val deviceId = stringPreferencesKey("device_id")
        val installDay = stringPreferencesKey("install_day")
    }

    val consentAccepted: Flow<Boolean> = context.settingsStore.data.map { it[Keys.consent] ?: false }
    val trackingEnabled: Flow<Boolean> = context.settingsStore.data.map { it[Keys.tracking] ?: false }
    val forceSpeaker: Flow<Boolean> = context.settingsStore.data.map { it[Keys.forceSpeaker] ?: true }
    val wifiOnly: Flow<Boolean> = context.settingsStore.data.map { it[Keys.wifiOnly] ?: false }
    val testSource: Flow<String> = context.settingsStore.data.map { it[Keys.testSource] ?: AudioSources.AUTO }

    suspend fun setConsent(value: Boolean) = context.settingsStore.edit { it[Keys.consent] = value }
    suspend fun setTracking(value: Boolean) = context.settingsStore.edit { it[Keys.tracking] = value }
    suspend fun setForceSpeaker(value: Boolean) = context.settingsStore.edit { it[Keys.forceSpeaker] = value }
    suspend fun setWifiOnly(value: Boolean) = context.settingsStore.edit { it[Keys.wifiOnly] = value }
    suspend fun setTestSource(value: String) = context.settingsStore.edit { it[Keys.testSource] = value }

    suspend fun deviceId(): String {
        val existing = context.settingsStore.data.first()[Keys.deviceId]
        if (existing != null) return existing
        val created = UUID.randomUUID().toString()
        context.settingsStore.edit { it[Keys.deviceId] = created }
        return created
    }
}

object AudioSources {
    const val AUTO = "AUTO"
    const val VOICE_RECOGNITION = "VOICE_RECOGNITION"
    const val MIC = "MIC"
    const val VOICE_COMMUNICATION = "VOICE_COMMUNICATION"
    const val VOICE_CALL = "VOICE_CALL"

    val ORDER = listOf(VOICE_RECOGNITION, MIC, VOICE_COMMUNICATION, VOICE_CALL)

    fun androidConstant(name: String): Int = when (name) {
        VOICE_RECOGNITION -> android.media.MediaRecorder.AudioSource.VOICE_RECOGNITION
        MIC -> android.media.MediaRecorder.AudioSource.MIC
        VOICE_COMMUNICATION -> android.media.MediaRecorder.AudioSource.VOICE_COMMUNICATION
        VOICE_CALL -> android.media.MediaRecorder.AudioSource.VOICE_CALL
        else -> android.media.MediaRecorder.AudioSource.MIC
    }
}
