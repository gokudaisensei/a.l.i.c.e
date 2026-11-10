package com.alice.home.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Lightbulb
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.util.lerp
import com.alice.home.Device
import com.alice.home.Kind
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * The device popup: a card in the middle of the screen that grows out of the tile you held (the tile "breathes" while you hold,
 * see [Pressable]), with the page behind it blurred and dimmed. [progress] runs 0..1 and drives the morph, so closing plays it
 * backwards into the tile. Drag the card down, tap outside, or press back to close.
 */
@Composable
fun DevicePopup(d: Device, origin: Rect, morph: () -> Float, presence: () -> Float, scrub: LevelScrub, onCommit: (Int) -> Unit, onClose: () -> Unit) {
    val c = Alice.c
    val scope = rememberCoroutineScope()
    var final by remember { mutableStateOf<Rect?>(null) }
    val dragY = remember { Animatable(0f) }
    BackHandler { onClose() }
    Box(Modifier.fillMaxSize().clickable(remember { MutableInteractionSource() }, null) { onClose() }, contentAlignment = Alignment.Center) {
        Column(
            Modifier.padding(horizontal = 24.dp).fillMaxWidth()
                .onGloballyPositioned { final = it.boundsInRoot() }
                .graphicsLayer {
                    // opening: it grows out of the tile. closing: it simply fades where it is (a shrink back into a tile on the
                    // side of the screen would look lopsided), settling down a hair as it goes.
                    val m = morph(); val pr = presence().coerceIn(0f, 1f); val f = final
                    if (f == null) alpha = 0f else {
                        val settle = if (m >= 0.999f) lerp(0.96f, 1f, pr) else 1f
                        scaleX = lerp(origin.width / f.width, 1f, m) * settle; scaleY = lerp(origin.height / f.height, 1f, m) * settle
                        translationX = lerp(origin.center.x - f.center.x, 0f, m)
                        translationY = lerp(origin.center.y - f.center.y, 0f, m) + dragY.value
                        alpha = (m * 5f).coerceIn(0f, 1f) * pr
                    }
                }
                .clip(RoundedCornerShape(32.dp)).background(c.tile)
                .draggable(rememberDraggableState { dy -> scope.launch { dragY.snapTo((dragY.value + dy).coerceAtLeast(0f)) } }, Orientation.Vertical,
                    onDragStopped = { if (dragY.value > 220f) onClose() else dragY.animateTo(0f, Motion.release()) })
                .clickable(remember { MutableInteractionSource() }, null) { } // taps on the card must not close it
                .padding(22.dp),
        ) {
            // the contents arrive after the card has mostly grown, so they are never squashed
            Column(Modifier.graphicsLayer { alpha = ((morph() - 0.35f) / 0.65f).coerceIn(0f, 1f) }, verticalArrangement = Arrangement.spacedBy(18.dp)) {
                Header(d, onClose)
                if (d.kind == Kind.Plug) PowerButton(d) { onCommit(if (d.on) 0 else 100) } else LevelControl(d, scrub, onCommit)
                Presets(d, onCommit)
            }
        }
    }
}

private fun Device.glyph() = when (kind) { Kind.Light -> Icons.Rounded.Lightbulb; Kind.Fan -> Icons.Rounded.Air; Kind.Cover -> Icons.Rounded.Blinds; Kind.Plug -> Icons.Rounded.Bolt }

@Composable
private fun Header(d: Device, onClose: () -> Unit) {
    val c = Alice.c
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        IconDisc(d.glyph(), if (d.on) c.glow else c.tile2, if (d.on) Color(0xFF3A2A00) else c.ink2, size = 56.dp, spin = if (d.kind == Kind.Fan && d.on) maxOf(0.35f, 2.4f - d.level / 50f) else null)
        Column(Modifier.weight(1f)) {
            Text(d.name, style = AliceType.section.copy(fontSize = 24.sp), color = c.ink, maxLines = 1)
            Text("${d.room} · ${d.state()}", style = AliceType.small, color = c.ink3, maxLines = 1)
        }
        Pressable(Modifier.size(40.dp), CircleShape, c.tile2, depth = 0.9f, onClick = onClose) { Icon(Icons.Rounded.Close, "Close", tint = c.ink2, modifier = Modifier.align(Alignment.Center).size(20.dp)) }
    }
}

/** A horizontal level bar: slide left or right anywhere on it. It uses only how far the finger moves (never where it touched), one to one with the bar's width. */
@Composable
private fun LevelControl(d: Device, scrub: LevelScrub, onCommit: (Int) -> Unit) {
    val c = Alice.c
    val cur by rememberUpdatedState(d)
    var dragging by remember { mutableStateOf(false) }
    val shown = if (d.on) d.level else 0
    val fill by animateFloatAsState(shown / 100f, tween(if (dragging) 0 else 160), label = "lv")
    val state = rememberDraggableState { dx -> scrub.move(dx) { onCommit(it) } }
    Box(
        Modifier.fillMaxWidth().height(120.dp).clip(RoundedCornerShape(28.dp)).background(c.tile2).onSizeChanged { scrub.travelPx = it.width.toFloat().coerceAtLeast(1f) }
            .draggable(state, Orientation.Horizontal, onDragStarted = { scrub.begin(if (cur.on) cur.level else 0); dragging = true }, onDragStopped = { dragging = false }),
    ) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(fill).background(c.glow.copy(alpha = 0.55f)))
        Row(Modifier.fillMaxSize().padding(horizontal = 22.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("$shown", style = AliceType.big.copy(fontSize = 56.sp, lineHeight = 56.sp), color = c.ink)
            Text("%", Modifier.padding(start = 3.dp, top = 18.dp), style = AliceType.section, color = c.ink2)
            Spacer(Modifier.weight(1f))
            Text(when (d.kind) { Kind.Cover -> "open"; Kind.Light -> "brightness"; else -> "speed" }, style = AliceType.mono, color = c.ink2)
        }
    }
}

@Composable
private fun PowerButton(d: Device, onClick: () -> Unit) {
    val c = Alice.c
    val bg by animateColorAsState(if (d.on) c.glow else c.tile2, tween(250), label = "pwr")
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Pressable(Modifier.size(116.dp), CircleShape, bg, depth = 0.94f, haptic = if (d.on) Haptic.ToggleOff else Haptic.ToggleOn, onClick = onClick) {
            Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Rounded.Bolt, null, tint = if (d.on) Color(0xFF3A2A00) else c.ink2, modifier = Modifier.size(40.dp))
                Text(if (d.on) "${d.watts} W" else "Off", style = AliceType.mono, color = if (d.on) Color(0xFF3A2A00) else c.ink3, textAlign = TextAlign.Center)
            }
        }
    }
}

@Composable
private fun Presets(d: Device, onCommit: (Int) -> Unit) {
    val c = Alice.c
    val plug = d.kind == Kind.Plug
    val options = if (plug) listOf("Off" to 0, "On" to 100) else listOf("Off" to 0, "25" to 25, "50" to 50, "75" to 75, "Max" to 100)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (label, v) ->
            val sel = if (v == 0) !d.on else d.on && (if (plug) true else d.level == v)
            val bg by animateColorAsState(if (sel) c.sage else c.tile2, Motion.ui(), label = "chip")
            val ink by animateColorAsState(if (sel) c.onSage else c.ink2, Motion.ui(), label = "chipink")
            Pressable(Modifier.weight(1f), CircleShape, bg, depth = 0.94f, haptic = Haptic.Select, onClick = { onCommit(v) }) {
                Text(label, Modifier.fillMaxWidth().padding(vertical = 11.dp), style = AliceType.label, color = ink, textAlign = TextAlign.Center)
            }
        }
    }
}
