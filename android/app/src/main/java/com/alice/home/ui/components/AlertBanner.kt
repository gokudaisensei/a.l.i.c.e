package com.alice.home.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.alice.home.ui.Haptic
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType

/** A warm warning strip with a single acknowledgement. */
@Composable
fun AlertBanner(text: String, onAck: () -> Unit, modifier: Modifier = Modifier) {
    val c = Alice.c
    val ink = Color(0xFF3A2A00)
    Tile(modifier.padding(horizontal = 16.dp), c.glowSoft, 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            IconDisc(Icons.Rounded.Warning, c.glow, ink)
            Text(text, Modifier.weight(1f), style = AliceType.bodyStrong, color = c.glowInk, maxLines = 2, overflow = TextOverflow.Ellipsis)
            PillButton(
                label = "Got it", onClick = onAck,
                color = c.glow, ink = ink, icon = Icons.Rounded.Check,
                haptic = Haptic.Success, depth = 0.97f,
                padding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            )
        }
    }
}
