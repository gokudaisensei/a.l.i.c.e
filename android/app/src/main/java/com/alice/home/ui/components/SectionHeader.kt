package com.alice.home.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.alice.home.ui.Haptic
import com.alice.home.ui.Motion
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType

/**
 * A section title with an optional hint on the right, sitting just above its cards. It carries the 16dp page padding plus a 4dp
 * optical inset, so its text lines up with a card's content; callers must not add padding of their own.
 *
 * Pass [onToggle] (with [expanded]) to make the whole header a collapse control: a chevron on the right turns from down (open) to
 * right (closed) on the release spring, the press and the `Select` haptic are the usual ones, and the header is at least 48dp tall.
 * The hint stays visible while collapsed, and so does the optional [peek] (a [PeekStack]), so a closed group still says what is inside it.
 */
@Composable
fun SectionHeader(
    title: String, hint: String? = null, expanded: Boolean = true, onToggle: (() -> Unit)? = null, peek: (@Composable () -> Unit)? = null,
    /** When set, the header follows this 0 (closed) to 1 (open) value continuously instead of [expanded]: the chevron turns and the peek fades with it. */
    openness: (() -> Float)? = null,
    minHeight: androidx.compose.ui.unit.Dp = 48.dp,
) {
    val turn by animateFloatAsState(if (expanded) 0f else -90f, Motion.release(), label = "sectionChevron")
    val row: @Composable () -> Unit = {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = if (onToggle == null) 20.dp else 20.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(title, Modifier.weight(1f), style = AliceType.section, color = Alice.c.ink)
            // a folded group previews what is inside it (fading as it opens, when the openness is continuous)
            if (peek != null) Box(Modifier.graphicsLayer { alpha = if (openness != null) 1f - openness() else if (expanded) 0f else 1f }) { peek() }
            if (hint != null) Text(hint, style = AliceType.small, color = Alice.c.ink3)
            if (onToggle != null) Icon(Icons.Rounded.ExpandMore, null, tint = Alice.c.ink3, modifier = Modifier.size(22.dp).graphicsLayer { rotationZ = if (openness != null) -90f * (1f - openness()) else turn })
        }
    }
    if (onToggle == null) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(title, style = AliceType.section, color = Alice.c.ink)
            if (hint != null) Text(hint, style = AliceType.small, color = Alice.c.ink3)
        }
    } else {
        Pressable(
            Modifier.fillMaxWidth().heightIn(min = minHeight).semantics { role = Role.Button; stateDescription = if (expanded) "Expanded" else "Collapsed" },
            color = Color.Transparent, depth = 0.985f, haptic = Haptic.Select, onClick = onToggle,
        ) { Row(Modifier.fillMaxWidth().heightIn(min = minHeight), verticalAlignment = Alignment.CenterVertically) { row() } }
    }
}
