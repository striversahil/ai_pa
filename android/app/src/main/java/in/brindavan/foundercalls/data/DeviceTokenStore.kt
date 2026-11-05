package in.brindavan.foundercalls.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class DeviceTokenStore(context: Context) {
    private val prefs: SharedPreferences = run {
        val key = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "device_token_store",
            key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    var token: String?
        get() = prefs.getString("token", null)
        set(value) { prefs.edit().putString("token", value).apply() }

    var agentName: String
        get() = prefs.getString("agent_name", "") ?: ""
        set(value) { prefs.edit().putString("agent_name", value).apply() }

    var deviceLabel: String
        get() = prefs.getString("device_label", "") ?: ""
        set(value) { prefs.edit().putString("device_label", value).apply() }

    var loggingOnly: Boolean
        get() = prefs.getBoolean("logging_only", false)
        set(value) { prefs.edit().putBoolean("logging_only", value).apply() }

    fun clear() = prefs.edit().clear().apply()
}
