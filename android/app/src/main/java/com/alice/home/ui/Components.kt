package com.alice.home.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.ui.composed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.changedToUp
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Air
import androidx.compose.material.icons.rounded.Blinds
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.Lightbulb
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.LockOpen
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alice.home.Device
import com.alice.home.Kind
import com.alice.home.Lock
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sign

val TileShape = RoundedCornerShape(22.dp)

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

/**
 * Turns horizontal finger movement into a level (right raises it), with the haptics: a tick every 5, a stronger tap at each quarter,
 * a bump at either end. It only ever uses how far the finger has MOVED, never where it is, and [travelPx] (the bar's width) is the
 * distance for the full 0 to 100, so the fill follows the finger one to one. One scrub is shared by the tile's hold-and-slide and
 * the popup's own bar, so both feel the same. With [begin]'s `settle`, the first [slopPx] of movement is ignored: a finger that
 * has just held a tile always drifts a little, and that must not change the level.
 */
class LevelScrub(private val haptics: Haptics, var travelPx: Float, private val slopPx: Float) {
    private var value = 0f
    private var last = 0
    private var dead = 0f
    private var acc = 0f
    fun begin(level: Int, settle: Boolean = false) { value = level.toFloat(); last = level; acc = 0f; dead = if (settle) slopPx else 0f }
    fun move(dx: Float, onLevel: (Int) -> Unit) {
        var d = dx
        if (dead > 0f) {
            acc += d
            if (abs(acc) <= dead) return
            d = acc - sign(acc) * dead; dead = 0f; acc = 0f // only the movement beyond the settle zone counts
        }
        value = (value + d / travelPx * 100f).coerceIn(1f, 100f)
        val n = value.roundToInt()
        if (n == last) return
        when {
            n == 100 || n == 1 -> haptics.play(Haptic.Boundary)
            n / 25 != last / 25 -> haptics.play(Haptic.Detent)
            n / 5 != last / 5 -> haptics.play(Haptic.Tick)
        }
        last = n; onLevel(n)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun Pressable(
    modifier: Modifier = Modifier, shape: Shape = TileShape, color: Color, depth: Float = 0.97f,
    haptic: Haptic? = Haptic.Light, onLong: (() -> Unit)? = null, onClick: () -> Unit,
    content: @Composable BoxScope.() -> Unit,
) {
    val (src, s) = rememberPress(depth, onLong != null)
    val h = LocalHaptics.current
    val down by src.collectIsPressedAsState()
    // Holding a holdable surface: it presses in, then breathes (a very small swell and settle) while soft ticks ramp up,
    // so the popup that follows feels earned rather than sudden.
    val breath = remember { Animatable(1f) }
    if (onLong != null) LaunchedEffect(down) {
        if (down) {
            launch { delay(90); h.play(Haptic.Tick); delay(120); h.play(Haptic.Tick); delay(110); h.play(Haptic.Detent) }
            breath.animateTo(0.955f, Motion.press(Motion.HOLD_HINT_MS))
            while (true) { breath.animateTo(0.968f, tween(430, easing = FastOutSlowInEasing)); breath.animateTo(0.952f, tween(430, easing = FastOutSlowInEasing)) }
        } else breath.animateTo(1f, Motion.release())
    }
    Box(
        modifier.graphicsLayer { val k = if (onLong != null) breath.value else s; scaleX = k; scaleY = k }.clip(shape).background(color)
            .combinedClickable(
                interactionSource = src, indication = null,
                onClick = { haptic?.let(h::play); onClick() },
                onLongClick = onLong?.let { f -> { h.play(Haptic.Hold); f() } },
            ),
    ) { content() }
}

@Composable
fun Tile(modifier: Modifier = Modifier, color: Color = Alice.c.tile, padding: Dp = 16.dp, content: @Composable () -> Unit) {
    Box(modifier.fillMaxWidth().clip(TileShape).background(color).padding(padding)) { content() }
}

/** An icon in a disc. With [spin] (seconds per turn) it turns, like a running fan. */
@Composable
fun IconDisc(icon: ImageVector, bg: Color, fg: Color, size: Dp = 36.dp, spin: Float? = null) {
    Box(Modifier.size(size).clip(CircleShape).background(bg), contentAlignment = Alignment.Center) {
        val m = Modifier.size(size * 0.55f)
        if (spin == null) Icon(icon, null, tint = fg, modifier = m) else {
            val turn by rememberInfiniteTransition(label = "spin").animateFloat(0f, 360f, infiniteRepeatable(tween((spin * 1000).toInt(), easing = LinearEasing), RepeatMode.Restart), label = "turn")
            Icon(icon, null, tint = fg, modifier = m.rotate(turn))
        }
    }
}

@Composable
fun SectionHeader(title: String, hint: String? = null) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.SpaceBetween) {
        Text(title, style = AliceType.section, color = Alice.c.ink)
        if (hint != null) Text(hint, style = AliceType.small, color = Alice.c.ink3)
    }
}

private fun Device.icon() = when (kind) { Kind.Light -> Icons.Rounded.Lightbulb; Kind.Fan -> Icons.Rounded.Air; Kind.Cover -> Icons.Rounded.Blinds; Kind.Plug -> Icons.Rounded.Bolt }
fun Device.state(): String = when {
    kind == Kind.Cover -> if (on) "$level% open" else "Closed"
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
@Composable
fun DeviceTile(
    d: Device, modifier: Modifier = Modifier, onTap: () -> Unit, onHold: (Rect) -> Unit, onCommit: (Int) -> Unit,
    onHoldDragStart: () -> Unit = {}, onHoldDrag: (Float) -> Unit = {},
) {
    var bounds by remember { mutableStateOf(Rect.Zero) }
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
    val dimmable = d.kind != Kind.Plug

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
        modifier.height(116.dp).onGloballyPositioned { bounds = it.boundsInRoot() }
            .graphicsLayer { translationY = shift }.breatheOnHold(src).clip(TileShape).background(bg)
            .pointerInput(dimmable) {
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
                                haptics.play(Haptic.Hold); haptics.play(Haptic.Medium); onHold(bounds); onHoldDragStart()
                                // read how far it moved before consuming: a consumed change reports no movement
                                drag(down.id) { ch -> val dx = ch.positionChange().x; ch.consume(); onHoldDrag(dx) }
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
        Column(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.SpaceBetween) {
            val spin = if (d.kind == Kind.Fan && d.on) maxOf(0.35f, 2.4f - d.level / 50f) else null
            IconDisc(d.icon(), if (lit) c.over else c.tile2, if (lit) c.glowInk else c.ink2, spin = spin)
            Column {
                Text(d.name, style = AliceType.bodyStrong.copy(fontSize = 14.sp), color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(if (live != null) "${live}%" else d.state(), style = AliceType.small, color = if (lit) c.ink else c.ink3, maxLines = 1)
            }
        }
    }
}

@Composable
fun LockTile(l: Lock, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val c = Alice.c
    val bg by animateColorAsState(if (l.locked) c.deepInk.copy(alpha = 0.08f) else c.warn.copy(alpha = 0.28f), tween(250), label = "lk")
    Pressable(modifier, shape = RoundedCornerShape(18.dp), color = bg, depth = 0.98f, haptic = Haptic.Medium, onClick = onClick) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            IconDisc(if (l.locked) Icons.Rounded.Lock else Icons.Rounded.LockOpen, if (l.locked) c.deepInk.copy(alpha = 0.12f) else c.glow, if (l.locked) c.deepInk else Color(0xFF3A2A00))
            Column {
                Text(l.name, style = AliceType.bodyStrong.copy(fontSize = 14.sp), color = c.deepInk, maxLines = 1)
                Text(if (l.locked) "Locked" else "Open · tap to lock", style = AliceType.small, color = c.deepInk2, maxLines = 1)
            }
        }
    }
}
