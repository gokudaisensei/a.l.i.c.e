package com.alice.home.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.unit.dp
import com.alice.home.domain.model.Device
import com.alice.home.domain.model.Kind
import com.alice.home.ui.theme.Alice

/**
 * A device as a full-width row, for catalogue screens (design-bible §12): disc, name (two lines before it truncates), state, and a
 * trailing control. Tapping the row opens the device's popup, which grows out of the row ([onOpen] gets its bounds). Lights, fans,
 * plugs, covers and climate end in a [Toggle]; locks, cameras and sensors end in a chevron, because a tap on those must never
 * switch them (a lock never unlocks from a tap).
 */
@Composable
fun DeviceRow(d: Device, subtitle: String, onOpen: (Rect) -> Unit, onToggle: () -> Unit, modifier: Modifier = Modifier) {
    val c = Alice.c
    // a plain holder, not state: it is only read on a tap, and writing state on every layout would recompose every row on every scroll frame
    val bounds = remember { RectHolder() }
    val switchable = d.available && d.kind in setOf(Kind.Light, Kind.Fan, Kind.Plug, Kind.Cover, Kind.Climate)
    val lit = d.on && d.available && d.kind != Kind.Lock && d.kind != Kind.Camera && d.kind != Kind.Contact
    Box(modifier.onGloballyPositioned { bounds.rect = it.boundsInRoot() }.graphicsLayer { alpha = if (d.available) 1f else 0.5f }) {
        ListRow(
            icon = d.icon(), title = d.name, subtitle = if (d.available) subtitle else "Unavailable",
            iconBg = if (lit) c.glowSoft else c.tile2, iconFg = if (lit) c.glowInk else c.ink2, iconSize = 40.dp,
            titleMaxLines = 2, contentPadding = 12.dp, depth = 0.985f,
            onClick = { onOpen(bounds.rect) },
            trailing = {
                if (switchable) Toggle(d.on, { onToggle() })
                else Icon(Icons.Rounded.ChevronRight, null, tint = c.ink3, modifier = Modifier.size(22.dp))
            },
            spin = if (d.kind == Kind.Fan && d.on) maxOf(0.35f, 2.4f - d.level / 50f) else null,
        )
    }
}

/** A mutable rectangle that is deliberately not observable. */
class RectHolder { var rect: Rect = Rect.Zero }
