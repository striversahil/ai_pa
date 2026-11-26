package com.miniautodialer.app.util

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat

/**
 * Is the phone on a call right now (dialing, ringing out or talking)?
 *
 * The dialer used to guess "the call ended" from the app coming back to the
 * front. That is wrong while a call is live (the agent opens the app, the SIM
 * picker closes, the in-call screen hands focus back), so the disposition
 * opened mid-call and its timer then dialed the next lead over the live call.
 * Every call-ended / dial decision now asks the phone instead.
 *
 * TelephonyManager needs READ_PHONE_STATE on Android 12+; the audio mode is
 * the permission-free fallback (MODE_IN_CALL for the whole cellular call).
 */
object PhoneCallState {
    fun canRead(ctx: Context) =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED

    @Suppress("DEPRECATION")
    fun inCall(ctx: Context): Boolean {
        val telephony = try {
            val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
            tm?.callState?.let { it != TelephonyManager.CALL_STATE_IDLE }
        } catch (_: SecurityException) {
            null
        }
        if (telephony != null) return telephony
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        return am?.mode == AudioManager.MODE_IN_CALL
    }
}
