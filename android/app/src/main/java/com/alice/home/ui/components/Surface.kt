package com.alice.home.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.alice.home.ui.Haptic
import com.alice.home.ui.LocalHaptics
import com.alice.home.ui.Motion
import com.alice.home.ui.theme.Alice
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The one radius every card shares. */
val TileRadius = 22.dp
val TileShape = RoundedCornerShape(TileRadius)

/**
 * A press you can feel: it sinks quickly while a finger is down and springs back on release (the web's `--press` and `--spring`).
 * A holdable surface sinks slower and deeper while the hold is on its way, so the long press is never a surprise.
 */
@Composable
fun rememberPress(depth: Float, holdable: Boolean = false): Pair<MutableInteractionSource, Float> {
    val src = remember { MutableInteractionSource() }
    val down by src.collectIsPressedAsState()
    val target = if (down) (if (holdable) 0.955f else depth) else 1f
    val s by animateFloatAsState(target, if (down) Motion.press(if (holdable) Motion.HOLD_HINT_MS else Motion.PRESS_MS) else Motion.release(), label = "press")
    return src to s
}

/** While held, a surface presses in then breathes (a small swell and settle) as soft haptic ticks ramp up; pass its own [InteractionSource]. */
fun Modifier.breatheOnHold(source: InteractionSource): Modifier = composed {
    val down by source.collectIsPressedAsState()
    val h = LocalHaptics.current
    val breath = remember { Animatable(1f) }
    LaunchedEffect(down) {
        if (down) {
            launch { delay(90); h.play(Haptic.Tick); delay(120); h.play(Haptic.Tick); delay(110); h.play(Haptic.Detent) }
            breath.animateTo(0.955f, Motion.press(Motion.HOLD_HINT_MS))
            while (true) { breath.animateTo(0.968f, tween(430, easing = FastOutSlowInEasing)); breath.animateTo(0.952f, tween(430, easing = FastOutSlowInEasing)) }
        } else breath.animateTo(1f, Motion.release())
    }
    graphicsLayer { scaleX = breath.value; scaleY = breath.value }
}

/** A surface that presses in under the finger, plays a haptic and (optionally) breathes into a hold. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun Pressable(
    modifier: Modifier = Modifier, shape: Shape = TileShape, color: Color, depth: Float = 0.97f,
    haptic: Haptic? = Haptic.Light, onLong: (() -> Unit)? = null, onClick: () -> Unit,
    content: @Composable BoxScope.() -> Unit,
) {
    val (src, s) = rememberPress(depth, onLong != null)
    val h = LocalHaptics.current
    // A holdable surface breathes while the hold is on its way; a plain one only presses in.
    val scale = if (onLong != null) Modifier.breatheOnHold(src) else Modifier.graphicsLayer { scaleX = s; scaleY = s }
    Box(
        modifier.then(scale).clip(shape).background(color)
            .combinedClickable(
                interactionSource = src, indication = null,
                onClick = { haptic?.let(h::play); onClick() },
                onLongClick = onLong?.let { f -> { h.play(Haptic.Hold); f() } },
            ),
    ) { content() }
}

/** A plain rounded card. */
@Composable
fun Tile(modifier: Modifier = Modifier, color: Color = Alice.c.tile, padding: Dp = 16.dp, content: @Composable () -> Unit) {
    Box(modifier.fillMaxWidth().clip(TileShape).background(color).padding(padding)) { content() }
}
