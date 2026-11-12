package com.alice.home.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.alice.home.ui.Haptic
import com.alice.home.ui.Motion
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType

/**
 * A two-or-more way segmented control with a sliding pill behind the selected item, mirroring the
 * mode switch. Used for "By room / By hardware" and similar binary/ternary choices.
 */
@Composable
fun Segmented(
    items: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Alice.c
    var w by remember { mutableFloatStateOf(1f) }
    val idx = items.indexOfFirst { it.first == selected }.coerceAtLeast(0)
    val x by animateFloatAsState(w / items.size * idx, Motion.release(), label = "seg")
    val shape = CircleShape
    Row(
        modifier.fillMaxWidth().clip(shape).background(c.tile2)
            .onSizeChanged { w = it.width.toFloat() }
            .padding(4.dp)
            .slidingPill(items.size, x, 12.dp, c.tile, border = c.line),
        horizontalArrangement = Arrangement.spacedBy(0.dp),
    ) {
        // measure width via onSizeChanged on the row above would be ideal; instead rely on fillMaxWidth + weight
        items.forEach { (value, label) ->
            val sel = value == selected
            val ink by animateColorAsState(if (sel) c.ink else c.ink2, Motion.ui(), label = "segink")
            Pressable(Modifier.weight(1f), shape, Color.Transparent, depth = 0.96f, haptic = Haptic.Select, onClick = { onSelect(value) }) {
                Text(label, Modifier.fillMaxWidth().padding(vertical = 8.dp), style = AliceType.label, color = ink, textAlign = TextAlign.Center)
            }
        }
    }
}
