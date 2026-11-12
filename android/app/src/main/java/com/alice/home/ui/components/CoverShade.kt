package com.alice.home.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp
import com.alice.home.ui.Haptic
import com.alice.home.ui.LocalHaptics
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType
import kotlin.math.roundToInt

/**
 * A horizontal cover-position shade: drag left/right to set 0–100%. Preview while dragging, commit on release.
 * Mirrors the web's `CoverShade`.
 */
@Composable
fun CoverShade(
    pos: Int,
    onCommit: (Int) -> Unit,
    modifier: Modifier = Modifier,
    label: String = "Position",
) {
    val haptics = LocalHaptics.current
    val density = LocalDensity.current
    val c = Alice.c
    var live by remember { mutableFloatStateOf(pos.toFloat()) }
    val prev = remember { mutableFloatStateOf(pos.toFloat()) }
    val cur by rememberUpdatedState(pos)
    androidx.compose.runtime.LaunchedEffect(pos) { if (live.roundToInt() == prev.floatValue.roundToInt()) { live = pos.toFloat(); prev.floatValue = pos.toFloat() } }

    Box(modifier.fillMaxWidth().height(56.dp), contentAlignment = Alignment.CenterStart) {
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(56.dp)
                .pointerInput(Unit) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        prev.floatValue = live
                        drag(down.id) { ch ->
                            val w = size.width.toFloat()
                            val n = ((ch.position.x / w) * 100f).coerceIn(0f, 100f)
                            val snapped = (n / 5f).roundToInt() * 5f
                            if (snapped != prev.floatValue) {
                                if (snapped == 0f || snapped == 100f) haptics.play(Haptic.Boundary) else if ((snapped / 25f).toInt() != (prev.floatValue / 25f).toInt()) haptics.play(Haptic.Detent) else haptics.play(Haptic.Tick)
                                prev.floatValue = snapped
                                live = snapped
                            }
                            ch.consume()
                        }
                        onCommit(live.roundToInt())
                    }
                },
        ) {
            val trackH = 12.dp.toPx()
            val y = (size.height - trackH) / 2f
            drawRoundRect(color = c.tile2, topLeft = Offset(0f, y), size = Size(size.width, trackH), cornerRadius = androidx.compose.ui.geometry.CornerRadius(trackH / 2f))
            val fillW = size.width * (live / 100f)
            if (fillW > 0f) drawRoundRect(color = c.glow.copy(alpha = 0.55f), topLeft = Offset(0f, y), size = Size(fillW, trackH), cornerRadius = androidx.compose.ui.geometry.CornerRadius(trackH / 2f))
            // knob
            val kx = size.width * (live / 100f)
            drawCircle(color = c.glow, radius = 14.dp.toPx(), center = Offset(kx, size.height / 2f))
            drawCircle(color = c.tile, radius = 6.dp.toPx(), center = Offset(kx, size.height / 2f))
        }
        Text("${live.roundToInt()}%", style = AliceType.bodyStrong, color = c.ink, modifier = Modifier.padding(start = 8.dp))
    }
}
