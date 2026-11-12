package com.alice.home.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Air
import androidx.compose.material.icons.rounded.AspectRatio
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Blinds
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Sensors
import androidx.compose.material.icons.rounded.Thermostat
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material.icons.rounded.Lightbulb
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.ImageVector.Builder as VectorBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.input.pointer.changedToUp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alice.home.domain.model.Device
import com.alice.home.domain.model.Kind
import com.alice.home.ui.Haptic
import com.alice.home.ui.LocalHaptics
import com.alice.home.ui.Motion
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sign

/** The glyph for a device kind. */
internal fun Device.icon(): ImageVector = when (kind) {
    Kind.Light -> Icons.Rounded.Lightbulb
    Kind.Fan -> FanIcon
    Kind.Cover -> Icons.Rounded.Blinds
    Kind.Plug -> Icons.Rounded.Bolt
    Kind.Climate -> Icons.Rounded.Thermostat
    Kind.Lock -> Icons.Rounded.Lock
    Kind.Camera -> Icons.Rounded.Videocam
    Kind.Contact -> Icons.Rounded.Sensors
}

/** The one-line state under a device's name. */
fun Device.state(): String = when {
    kind == Kind.Cover -> if (on) "$level% open" else "Closed"
    kind == Kind.Climate -> if (on) "Aiming for $level°" else "Off"
    kind == Kind.Lock -> if (on) "Locked" else "Unlocked"
    kind == Kind.Camera -> if (on) "Live" else "Off"
    kind == Kind.Contact -> if (on) "Open" else "Closed"
    !on -> "Off"
    kind == Kind.Plug -> "On · $watts W"
    else -> "$level%"
}

/**
 * One touch does it all. Tap toggles. Drag up or down to set the main value: the tile fills from the bottom live, ticks at each
 * quarter, bumps at either end, stretches if you pull past an end, and a flick carries on after you let go. Hold for more: the tile
 * breathes, then [onHold] gets its bounds so a popup can grow out of it, and the same finger keeps going: sliding it left or right now
 * calls [onHoldDrag] with each step (so it can drive the popup's level) until you let go.
 */
/** Size classes a device card can take on the home grid. */
enum class DeviceCardSize(val colSpan: Int, val rowSpan: Int, val label: String) {
    Small(1, 1, "1×1"),
    /** One column wide, two rows tall. */
    Tall(1, 2, "1×2"),
    Large(2, 2, "2×2"),
}

/** A simple three-blade fan glyph, used for [Kind.Fan] (Material has no fan icon). */
val FanIcon: ImageVector = VectorBuilder(
    name = "Fan",
    defaultWidth = 24.dp,
    defaultHeight = 24.dp,
    viewportWidth = 24f,
    viewportHeight = 24f,
).apply {
    val blade = SolidColor(Color.Black)
    path(fill = blade) {
        moveTo(12f, 12f)
        lineTo(10f, 3f)
        lineTo(14f, 3f)
        close()
    }
    path(fill = blade) {
        moveTo(12f, 12f)
        lineTo(20.794f, 14.768f)
        lineTo(18.794f, 18.232f)
        close()
    }
    path(fill = blade) {
        moveTo(12f, 12f)
        lineTo(5.206f, 18.232f)
        lineTo(3.206f, 14.768f)
        close()
    }
    // hub
    path(fill = blade) {
        moveTo(10f, 10f)
        lineTo(14f, 10f)
        lineTo(14f, 14f)
        lineTo(10f, 14f)
        close()
    }
}.build()

@Composable
fun DeviceTile(
    d: Device, modifier: Modifier = Modifier, onTap: () -> Unit, onHold: (Rect) -> Unit, onCommit: (Int) -> Unit,
    onHoldDragStart: () -> Unit = {}, onHoldDrag: (Float) -> Unit = {}, onHoldDragEnd: () -> Unit = {},
    cardSize: DeviceCardSize = DeviceCardSize.Small,
    onDelete: () -> Unit = {},
    showDelete: Boolean = false,
    /** While arranging, the tile only draws: touches belong to the resize frame laid over it. */
    editMode: Boolean = false,
) {
    val bounds = remember { RectHolder() } // not state: written on every layout, read only when the hold fires
    val c = Alice.c
    val cur by rememberUpdatedState(d)
    val haptics = LocalHaptics.current
    val src = remember { MutableInteractionSource() }
    val travel = with(LocalDensity.current) { 220.dp.toPx() } // finger travel for the full 0 to 100: gentle, so a small slip is a small change
    var base by remember { mutableFloatStateOf(0f) }       // value when the drag began
    var travelled by remember { mutableFloatStateOf(0f) }  // px dragged since (down is positive)
    var live by remember { mutableStateOf<Int?>(null) }    // the value shown while dragging
    var stretch by remember { mutableFloatStateOf(0f) }    // px stretched past an end
    var crossed by remember { mutableStateOf(false) }
    val dimmable = d.capabilities.contains("brightness") || d.capabilities.contains("position") || d.capabilities.contains("fan_speed") || d.kind == Kind.Light || d.kind == Kind.Fan || d.kind == Kind.Cover

    // vertical: drag up to raise the level (the fill rises from the bottom), down to lower it
    val drag = rememberDraggableState { dy ->
        travelled += dy
        val free = base - travelled / travel * 100f
        val raw = free.coerceIn(0f, 100f)
        val over = if (free < 0) free else if (free > 100) free - 100 else 0f
        stretch = if (over == 0f) 0f else -sign(over) * (1 - 1 / (abs(over) / 40 + 1)) * 22f * 3f
        if (over != 0f && !crossed) haptics.play(Haptic.Boundary)
        crossed = over != 0f
        val v = (raw / 5).roundToInt() * 5
        if (v != live) { if (over == 0f && (v % 25 == 0)) haptics.play(Haptic.Detent); live = v }
    }
    val fillTarget = (live ?: if (d.on) d.level else 0) / 100f
    val fill by animateFloatAsState(fillTarget, if (live != null) snap() else tween(120), label = "fill")
    val shift by animateFloatAsState(stretch, if (live != null) snap() else Motion.release(), label = "rubber")
    val lit = d.on || (live ?: 0) > 0
    val bg by animateColorAsState(if (lit) c.glowSoft else c.tile, tween(250), label = "bg")

    Box(
        modifier.fillMaxSize().onGloballyPositioned { bounds.rect = it.boundsInRoot() }
            .graphicsLayer { translationY = shift }.breatheOnHold(src).clip(TileShape).background(bg)
            .pointerInput(dimmable, editMode) {
                if (editMode) return@pointerInput
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    val press = PressInteraction.Press(down.position); src.tryEmit(press)
                    try {
                        // Compose's own long-press detector swallows the rest of the touch once it fires, so the hold is timed here:
                        // the finger stays ours, and after the hold it can keep sliding to set the popup's level.
                        // 0: held long enough, 1: moved first (a drag), 2: let go or cancelled. The move threshold is twice the usual slop,
                        // so a finger that wobbles while holding is still a hold, not a drag that changes the level.
                        var outcome = 0
                        val dragSlop = viewConfiguration.touchSlop * 2f
                        withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
                            var total = Offset.Zero
                            while (true) {
                                val ch = awaitPointerEvent().changes.firstOrNull { it.id == down.id }
                                if (ch == null || ch.isConsumed || ch.changedToUp()) { outcome = 2; break }
                                total += ch.positionChange()
                                if (total.getDistance() > dragSlop) { if (dimmable) ch.consume(); outcome = 1; break }
                            }
                        }
                        when (outcome) {
                            0 -> { // a hold: open the popup, and keep following the same finger so it can set the level
                                haptics.play(Haptic.Hold); haptics.play(Haptic.Medium); onHold(bounds.rect); onHoldDragStart()
                                // read how far it moved before consuming: a consumed change reports no movement
                                drag(down.id) { ch -> val dx = ch.positionChange().x; ch.consume(); onHoldDrag(dx) }
                                onHoldDragEnd()
                            }
                            1 -> if (dimmable) { // moved before the hold: a drag on the tile itself, relative to where it started
                                base = if (cur.on) cur.level.toFloat() else 0f; travelled = 0f; live = base.roundToInt(); crossed = false
                                drag(down.id) { m -> val dy = m.positionChange().y; m.consume(); drag.dispatchRawDelta(dy) }
                                // it lands exactly where the finger left it (no flick carry-on: that overshot)
                                val pos = (base - travelled / travel * 100f).coerceIn(0f, 100f)
                                onCommit((pos / 5f).roundToInt() * 5); live = null; stretch = 0f; crossed = false
                            }
                            else -> { // let go before the hold and without moving: a tap (unless something else, like a scroll, took the touch)
                                val last = currentEvent.changes.firstOrNull { it.id == down.id }
                                if (last != null && last.changedToUp()) { haptics.play(if (cur.on) Haptic.ToggleOff else Haptic.ToggleOn); onTap() }
                            }
                        }
                    } finally { src.tryEmit(PressInteraction.Release(press)) }
                }
            },
    ) {
        if (dimmable && fill > 0f) Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().fillMaxHeight(fill).background(c.glow.copy(alpha = 0.30f)))
        val big = cardSize == DeviceCardSize.Large
        Column(Modifier.fillMaxSize().padding(if (big) 16.dp else 12.dp), verticalArrangement = Arrangement.SpaceBetween) {
            val spin = if (d.kind == Kind.Fan && d.on) maxOf(0.35f, 2.4f - d.level / 50f) else null
            IconDisc(d.icon(), if (lit) c.over else c.tile2, if (lit) c.glowInk else c.ink2, size = if (big) 48.dp else if (cardSize == DeviceCardSize.Tall) 40.dp else 36.dp, spin = spin)
            Column {
                Text(d.name, style = AliceType.bodyStrong.copy(fontSize = if (big) 18.sp else 14.sp), color = c.ink, maxLines = if (cardSize == DeviceCardSize.Small) 1 else 2, overflow = TextOverflow.Ellipsis)
                Text(if (live != null) "${live}%" else d.state(), style = if (big) AliceType.body else AliceType.small, color = if (lit) c.ink else c.ink3, maxLines = 1)
            }
        }
    }
}
