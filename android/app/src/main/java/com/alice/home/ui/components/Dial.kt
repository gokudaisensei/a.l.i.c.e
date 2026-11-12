package com.alice.home.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.alice.home.ui.Haptic
import com.alice.home.ui.LocalHaptics
import com.alice.home.ui.Motion
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType
import kotlin.math.atan2
import kotlin.math.cos
import androidx.compose.runtime.LaunchedEffect
import kotlin.math.max
import kotlin.math.PI
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * A radial dial: drag around a 270° arc (gap at the bottom). Preview while dragging, commit on release.
 * Mirrors the web's `Dial` (ui/dial.tsx): haptics tick at quarters and bump at ends.
 */
@Composable
fun Dial(
    value: Float,
    min: Float,
    max: Float,
    step: Float = 1f,
    onCommit: (Float) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    size: Dp = 220.dp,
    unit: String = "",
    marker: Float? = null,
    color: Color = Alice.c.glow,
    resetValue: Float? = null,
    content: @Composable (Float) -> Unit = { v -> Text("${v.roundToInt()}$unit", style = AliceType.big, color = Alice.c.ink, textAlign = TextAlign.Center) },
) {
    val haptics = LocalHaptics.current
    val density = LocalDensity.current
    val c = Alice.c
    val px = with(density) { size.toPx() }
    val cx = px / 2f
    val r = px * 0.41f
    val startDeg = 135f
    val sweep = 270f

    var live by remember { mutableFloatStateOf(value) }
    var dragging by remember { mutableStateOf(false) }
    val prev = remember { mutableFloatStateOf(value) }
    val curValue by rememberUpdatedState(value)
    LaunchedEffect(value) { if (!dragging) { live = value; prev.floatValue = value } }

    fun at(x: Float, y: Float): Float {
        var deg = Math.toDegrees(atan2((y - cx).toDouble(), (x - cx).toDouble())).toFloat()
        if (deg < 0) deg += 360f
        var rel = deg - startDeg
        if (rel < 0) rel += 360f
        if (rel > sweep) rel = if (rel - sweep < (360f - sweep) / 2f) sweep else 0f
        val raw = min + (rel / sweep) * (max - min)
        return (kotlin.math.min(max, kotlin.math.max(min, (raw / step).roundToInt() * step)))
    }

    val knobAngle = startDeg + sweep * ((live - min) / (max - min)).coerceIn(0f, 1f)
    val knobX = cx + r * cos(Math.toRadians(knobAngle.toDouble())).toFloat()
    val knobY = cx + r * sin(Math.toRadians(knobAngle.toDouble())).toFloat()

    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(
            Modifier
                .size(size)
                .pointerInput(min, max, step) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        val press = down
                        var outcome = 0
                        // double-tap reset
                        if (resetValue != null && down.previousUptimeMillis == 0L) { /* noop */ }
                        dragging = true
                        prev.floatValue = live
                        drag(down.id) { ch ->
                            val pos = ch.position
                            val n = at(pos.x, pos.y)
                            if (Math.abs(n - prev.floatValue) > (max - min) * 0.6f) return@drag
                            if (n != prev.floatValue) {
                                val q = { x: Float -> ((x - min) / (max - min) * 4f).toInt() }
                                if ((n <= min || n >= max) && prev.floatValue > min && prev.floatValue < max) haptics.play(Haptic.Boundary)
                                else if (q(n) != q(prev.floatValue)) haptics.play(Haptic.Detent)
                                else haptics.play(Haptic.Tick)
                                prev.floatValue = n
                                live = n
                            }
                            ch.consume()
                        }
                        dragging = false
                        onCommit(prev.floatValue)
                    }
                },
        ) {
            // track
            drawArc(
                color = c.tile2,
                startAngle = startDeg,
                sweepAngle = sweep,
                useCenter = false,
                style = Stroke(width = 12.dp.toPx(), cap = StrokeCap.Round),
                topLeft = Offset(cx - r, cx - r),
                size = Size(r * 2, r * 2),
            )
            // fill
            val fillSweep = sweep * ((live - min) / (max - min)).coerceIn(0f, 1f)
            if (fillSweep > 0f) drawArc(
                color = color,
                startAngle = startDeg,
                sweepAngle = fillSweep,
                useCenter = false,
                style = Stroke(width = 12.dp.toPx(), cap = StrokeCap.Round),
                topLeft = Offset(cx - r, cx - r),
                size = Size(r * 2, r * 2),
            )
            // marker
            if (marker != null && marker in min..max) {
                val ma = startDeg + sweep * ((marker - min) / (max - min))
                val mx = cx + (r + 14.dp.toPx()) * cos(Math.toRadians(ma.toDouble())).toFloat()
                val my = cx + (r + 14.dp.toPx()) * sin(Math.toRadians(ma.toDouble())).toFloat()
                drawCircle(color = c.ink3, radius = 3.5.dp.toPx(), center = Offset(mx, my))
            }
            // knob
            drawCircle(color = color, radius = 14.dp.toPx(), center = Offset(knobX, knobY))
            drawCircle(color = c.tile, radius = 6.dp.toPx(), center = Offset(knobX, knobY))
        }
        Box(Modifier.align(Alignment.Center)) { content(live) }
    }
}
