package com.alice.home.ui.home

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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material.icons.rounded.LockOpen
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import com.alice.home.domain.model.Device
import com.alice.home.domain.model.Kind
import com.alice.home.ui.Haptic
import com.alice.home.ui.Motion
import com.alice.home.ui.components.CoverShade
import com.alice.home.ui.components.FilterChip
import com.alice.home.ui.components.Dial
import com.alice.home.ui.components.IconButtonCircle
import com.alice.home.ui.components.IconDisc
import com.alice.home.ui.components.LevelScrub
import com.alice.home.ui.components.MoodButtons
import com.alice.home.ui.components.PillButton
import com.alice.home.ui.components.PresetChip
import com.alice.home.ui.components.Pressable
import com.alice.home.ui.components.Segmented
import com.alice.home.ui.components.icon
import com.alice.home.ui.components.state
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

@Composable
fun DevicePopup(
    d: Device,
    origin: Rect,
    morph: () -> Float,
    presence: () -> Float,
    scrub: LevelScrub,
    onCommit: (Int) -> Unit,
    onClose: () -> Unit,
    onHvacMode: (String) -> Unit = {},
    onOscillation: (Boolean) -> Unit = {},
    onColorTemp: (Int) -> Unit = {},
    onColor: (List<Int>) -> Unit = {},
    onFanPreset: (String) -> Unit = {},
    // Management footer (design-bible §4.5): shown only for what the caller passes. voiceEnabled null = not offered (locks, non-admins).
    isFavourite: Boolean? = null,
    onFavourite: () -> Unit = {},
    voiceEnabled: Boolean? = null,
    onVoice: () -> Unit = {},
    onHide: (() -> Unit)? = null,
) {
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
                .clickable(remember { MutableInteractionSource() }, null) { }
                .padding(22.dp),
        ) {
            Column(Modifier.graphicsLayer { alpha = ((morph() - 0.35f) / 0.65f).coerceIn(0f, 1f) }, verticalArrangement = Arrangement.spacedBy(18.dp)) {
                Header(d, onClose)
                Box(Modifier.fillMaxWidth().heightIn(min = 200.dp), contentAlignment = Alignment.Center) {
                    // Capability-driven dispatch: controls render based on what the device supports.
                    when {
                        d.capabilities.contains("lock") -> {
                            val locked = d.on
                            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                Pressable(Modifier.size(116.dp), CircleShape, if (locked) c.deepInk else c.sage, depth = 0.94f, haptic = if (locked) Haptic.ToggleOff else Haptic.ToggleOn, onClick = { onCommit(if (locked) 0 else 100) }) {
                                    Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                                        Icon(if (locked) Icons.Rounded.Lock else Icons.Rounded.LockOpen, null, tint = if (locked) c.deepInk2 else c.onSage, modifier = Modifier.size(40.dp))
                                        Text(if (locked) "Unlock" else "Lock", style = AliceType.label, color = if (locked) c.deepInk2 else c.onSage, textAlign = TextAlign.Center)
                                    }
                                }
                                Text(if (locked) "Locked · tap to unlock" else "Unlocked · tap to lock", style = AliceType.small, color = c.ink3, textAlign = TextAlign.Center)
                            }
                        }
                        d.capabilities.contains("position") -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text(if (d.on) "${d.level}% open" else "Closed", style = AliceType.big, color = c.ink)
                            CoverShade(pos = d.level, onCommit = onCommit, label = "${d.name} position")
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                PillButton("Open", { onCommit(100) }, color = c.sage, ink = c.onSage)
                                PillButton("Stop", { onCommit(d.level) }, color = c.tile2, ink = c.ink)
                                PillButton("Close", { onCommit(0) }, color = c.tile2, ink = c.ink)
                            }
                        }
                        d.capabilities.contains("target_temperature") -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Dial(
                                value = d.level.toFloat().coerceIn(16f, 30f).let { if (it < 16f) 24f else it },
                                min = 16f, max = 30f, step = 0.5f,
                                onCommit = { onCommit(it.roundToInt()) },
                                label = "${d.name} target temperature", unit = "°",
                                marker = 26.4f,
                                content = { v -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    Text("${v.toInt()}°", style = AliceType.big, color = c.ink)
                                    Text("target", style = AliceType.small, color = c.ink3)
                                } },
                            )
                            Text("26.4° now", style = AliceType.small, color = c.ink3)
                            if (d.capabilities.contains("hvac_mode")) {
                                Segmented(
                                    items = listOf("cool" to "Cool", "heat" to "Heat", "auto" to "Auto", "dry" to "Dry", "fan_only" to "Fan"),
                                    selected = d.hvacMode,
                                    onSelect = { onHvacMode(it) },
                                )
                            }
                        }
                        d.capabilities.contains("fan_speed") -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            LevelControl(d, scrub, onCommit)
                            if (d.capabilities.contains("oscillation")) {
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    PillButton(if (d.fanOscillating) "Oscillating" else "Oscillate", { onOscillation(!d.fanOscillating) }, color = if (d.fanOscillating) c.sage else c.tile2, ink = if (d.fanOscillating) c.onSage else c.ink)
                                }
                            }
                            if (d.capabilities.contains("fan_preset")) {
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    listOf("Low", "Medium", "High").forEach { p ->
                                        PillButton(p, { onFanPreset(p) }, color = if (d.fanPreset == p) c.sage else c.tile2, ink = if (d.fanPreset == p) c.onSage else c.ink)
                                    }
                                }
                            }
                        }
                        d.capabilities.contains("brightness") -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            LevelControl(d, scrub, onCommit)
                            if (d.capabilities.contains("color")) {
                                MoodButtons(onMood = { kelvin, rgb, brightness ->
                                    if (rgb != null) onColor(rgb) else if (kelvin != null) onColorTemp(kelvin)
                                    onCommit(brightness)
                                })
                            }
                            if (d.capabilities.contains("color_temperature")) {
                                Text("Colour temperature: ${d.colorTempKelvin ?: 3000} K", style = AliceType.small, color = c.ink3)
                            }
                        }
                        d.capabilities.contains("power") -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            PowerButton(d) { onCommit(if (d.on) 0 else 100) }
                            Text("${d.watts} W now", style = AliceType.small, color = c.ink3)
                        }
                        else -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Pressable(Modifier.size(64.dp), CircleShape, Color.Transparent, depth = 0.94f, haptic = if (d.on) Haptic.ToggleOff else Haptic.ToggleOn, onClick = { onCommit(if (d.on) 0 else 100) }) {
                                IconDisc(d.icon(), if (d.on) c.glow else c.tile2, if (d.on) Color(0xFF3A2A00) else c.ink2, size = 64.dp)
                            }
                            Text(d.state(), style = AliceType.section, color = c.ink)
                            Text(d.kind.name, style = AliceType.small, color = c.ink3)
                        }
                    }
                }
                if (isFavourite != null || voiceEnabled != null || onHide != null) ManageRow(isFavourite, onFavourite, voiceEnabled, onVoice, onHide)
            }
        }
    }
}

/** Favourite, voice and hide, as toggle chips under a hairline. Only the ones that were passed are shown. */
@Composable
private fun ManageRow(favourite: Boolean?, onFavourite: () -> Unit, voice: Boolean?, onVoice: () -> Unit, onHide: (() -> Unit)?) {
    val c = Alice.c
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (favourite != null) FilterChip("Favourite", favourite, onFavourite, icon = Icons.Rounded.Star)
            if (voice != null) FilterChip("Voice", voice, onVoice, icon = Icons.Rounded.Mic)
            if (onHide != null) FilterChip("Hide", false, onHide, icon = Icons.Rounded.VisibilityOff)
        }
    }
}

@Composable
private fun Header(d: Device, onClose: () -> Unit) {
    val c = Alice.c
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        IconDisc(d.icon(), if (d.on) c.glow else c.tile2, if (d.on) Color(0xFF3A2A00) else c.ink2, size = 56.dp, spin = if (d.kind == Kind.Fan && d.on) maxOf(0.35f, 2.4f - d.level / 50f) else null)
        Column(Modifier.weight(1f)) {
            Text(d.name, style = AliceType.section.copy(fontSize = 24.sp), color = c.ink, maxLines = 1)
            Text("${d.room} · ${d.state()}", style = AliceType.small, color = c.ink3, maxLines = 1)
        }
        IconButtonCircle(Icons.Rounded.Close, onClose, size = 40.dp, bg = c.tile2, tint = c.ink2, contentDescription = "Close")
    }
}

@Composable
private fun LevelControl(d: Device, scrub: LevelScrub, onCommit: (Int) -> Unit) {
    val c = Alice.c
    val cur by rememberUpdatedState(d)
    val shown = if (d.on) d.level else 0
    val fill by animateFloatAsState(shown / 100f, tween(if (scrub.active) 0 else 240, easing = androidx.compose.animation.core.FastOutSlowInEasing), label = "lv")
    val haptics = com.alice.home.ui.LocalHaptics.current
    val state = rememberDraggableState { dx -> scrub.move(dx) { onCommit(it) } }
    val flickPx = with(androidx.compose.ui.platform.LocalDensity.current) { 1000.dp.toPx() } // a clearly deliberate flick: about 2600 px/s on a phone; slides that merely lift while moving are far below it
    Box(
        Modifier.fillMaxWidth().height(120.dp).clip(RoundedCornerShape(28.dp)).background(c.tile2).onSizeChanged { scrub.travelPx = it.width.toFloat().coerceAtLeast(1f) }
            .draggable(state, Orientation.Horizontal,
                onDragStarted = { scrub.begin(if (cur.on) cur.level else 0) },
                onDragStopped = { velocity ->
                    // a flick snaps to a quarter; a slide that merely lifts while still moving keeps the exact level it set
                    val target = com.alice.home.ui.components.flickTarget(scrub.currentLevel, velocity, flickPx)
                    if (target != null) {
                        haptics.play(if (target == 0 || target == 100) Haptic.Boundary else Haptic.Detent)
                        onCommit(target)
                    }
                    scrub.end()
                }),
    ) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(fill).background(c.glow.copy(alpha = 0.55f)))
        Row(Modifier.fillMaxSize().padding(horizontal = 22.dp), verticalAlignment = Alignment.CenterVertically) {
            // the number counts with the bar, so a flick reads as a glide to its quarter rather than a jump
            Text("${kotlin.math.round(fill * 100f).toInt()}", style = AliceType.big.copy(fontSize = 56.sp, lineHeight = 56.sp), color = c.ink)
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
    val plug = d.kind == Kind.Plug
    val options = if (plug) listOf("Off" to 0, "On" to 100) else listOf("Off" to 0, "25" to 25, "50" to 50, "75" to 75, "Max" to 100)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (label, v) ->
            val sel = if (v == 0) !d.on else d.on && (if (plug) true else d.level == v)
            PresetChip(label, sel, { onCommit(v) }, Modifier.weight(1f))
        }
    }
}