package com.alice.home.ui

import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView

/**
 * Haptics with meanings, ported from the web app (ui/haptics.ts). Screens say what happened; this file decides what it feels like.
 *
 *   Tick       passing through steps while scrubbing (the lightest, rate limited)
 *   Detent     passing a notable value on the way: a quarter, the centre
 *   Select     a choice changed: a segment, a tab, a chip
 *   ToggleOn / ToggleOff   something switched (on is a touch firmer)
 *   Light      a tap was understood
 *   Medium     a bigger step: a command went out, a sheet opened
 *   Heavy      the one thing that must be felt
 *   Boundary   you hit the end of a range: a small bump
 *   Hold       a long press was recognised
 *   Success / Warning / Error
 */
enum class Haptic { Tick, Detent, Select, ToggleOn, ToggleOff, Light, Medium, Heavy, Boundary, Hold, Success, Warning, Error }

class Haptics(private val view: View, private val vibrator: Vibrator?) {
    var enabled = true
    private var last = 0L
    private val api = Build.VERSION.SDK_INT

    private fun feel(c: Int) = view.performHapticFeedback(c)

    /** Hardware click effects where the phone has them; the nearest view haptic otherwise. */
    private fun effect(predefined: Int, fallback: Int) {
        if (api >= 29 && vibrator?.hasVibrator() == true) vibrator.vibrate(VibrationEffect.createPredefined(predefined)) else feel(fallback)
    }

    /** The web's multi-pulse shapes (off, on, off, on …), in milliseconds. */
    private fun pattern(vararg ms: Long, fallback: Int) {
        if (vibrator?.hasVibrator() == true) vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, *ms), -1)) else feel(fallback)
    }

    fun play(k: Haptic) {
        if (!enabled) return
        val now = SystemClock.uptimeMillis()
        if ((k == Haptic.Tick || k == Haptic.Detent) && now - last < 28) return // a fast drag must not become a buzz
        last = now
        when (k) {
            Haptic.Tick -> feel(if (api >= 34) HapticFeedbackConstants.SEGMENT_FREQUENT_TICK else HapticFeedbackConstants.CLOCK_TICK)
            Haptic.Detent -> feel(if (api >= 34) HapticFeedbackConstants.SEGMENT_TICK else HapticFeedbackConstants.CLOCK_TICK)
            Haptic.Select -> feel(HapticFeedbackConstants.CONTEXT_CLICK)
            Haptic.ToggleOn -> feel(if (api >= 34) HapticFeedbackConstants.TOGGLE_ON else if (api >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY)
            Haptic.ToggleOff -> feel(if (api >= 34) HapticFeedbackConstants.TOGGLE_OFF else HapticFeedbackConstants.VIRTUAL_KEY)
            Haptic.Light -> feel(HapticFeedbackConstants.VIRTUAL_KEY)
            Haptic.Medium -> if (api >= 29) effect(VibrationEffect.EFFECT_CLICK, HapticFeedbackConstants.KEYBOARD_TAP) else feel(HapticFeedbackConstants.KEYBOARD_TAP)
            Haptic.Heavy -> if (api >= 29) effect(VibrationEffect.EFFECT_HEAVY_CLICK, HapticFeedbackConstants.LONG_PRESS) else feel(HapticFeedbackConstants.LONG_PRESS)
            Haptic.Hold -> feel(HapticFeedbackConstants.LONG_PRESS)
            Haptic.Boundary -> pattern(8, 24, 18, fallback = HapticFeedbackConstants.KEYBOARD_TAP)
            Haptic.Success -> if (api >= 30) feel(HapticFeedbackConstants.CONFIRM) else pattern(10, 40, 18, fallback = HapticFeedbackConstants.VIRTUAL_KEY)
            Haptic.Warning -> pattern(24, 60, 24, fallback = HapticFeedbackConstants.LONG_PRESS)
            Haptic.Error -> if (api >= 30) feel(HapticFeedbackConstants.REJECT) else pattern(28, 45, 28, 45, 46, fallback = HapticFeedbackConstants.LONG_PRESS)
        }
    }
}

val LocalHaptics = staticCompositionLocalOf<Haptics> { error("Haptics not provided") }

@Composable
fun rememberHaptics(): Haptics {
    val view = LocalView.current
    val ctx = LocalContext.current
    return remember(view) { Haptics(view, ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator) }
}
