package com.alice.home.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.alice.home.ui.Haptic
import com.alice.home.ui.Motion
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType

/**
 * A read-only capsule with an icon and a label. It takes its own ink and fill because the hero tints its chips from the
 * time-of-day gradient rather than from the page palette.
 */
@Composable
fun IconChip(icon: ImageVector, text: String, ink: Color, bg: Color, modifier: Modifier = Modifier) {
    Row(
        modifier.clip(CircleShape).background(bg).padding(start = 9.dp, end = 12.dp, top = 7.dp, bottom = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(icon, null, tint = ink, modifier = Modifier.size(15.dp))
        Text(text, style = AliceType.label, color = ink)
    }
}

/** A selectable filter chip with an optional count badge: "All (12)", "Living room (4)". Sage when selected. */
@Composable
fun FilterChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    count: Int? = null,
    icon: ImageVector? = null,
    haptic: Haptic? = Haptic.Select,
) {
    val c = Alice.c
    val bg by animateColorAsState(if (selected) c.sage else c.tile2, Motion.ui(), label = "fchip")
    val ink by animateColorAsState(if (selected) c.onSage else c.ink2, Motion.ui(), label = "fchipink")
    Pressable(modifier, CircleShape, bg, depth = 0.94f, haptic = haptic, onClick = onClick) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (icon != null) Icon(icon, null, tint = ink, modifier = Modifier.size(15.dp))
            Text(label, style = AliceType.label, color = ink)
            if (count != null) Text("$count", style = AliceType.mono, color = ink.copy(alpha = 0.85f))
        }
    }
}
@Composable
fun PresetChip(label: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = Alice.c
    val bg by animateColorAsState(if (selected) c.sage else c.tile2, Motion.ui(), label = "chip")
    val ink by animateColorAsState(if (selected) c.onSage else c.ink2, Motion.ui(), label = "chipink")
    Pressable(modifier, CircleShape, bg, depth = 0.94f, haptic = Haptic.Select, onClick = onClick) {
        Text(label, Modifier.fillMaxWidth().padding(vertical = 11.dp), style = AliceType.label, color = ink, textAlign = TextAlign.Center)
    }
}
