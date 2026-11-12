package com.alice.home.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alice.home.ui.Haptic
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType

/**
 * A scene card: icon, name, two lines. Every card has the same parts, so a row of them is always one height; "suggested" is a
 * corner tag, not an extra line.
 */
@Composable
fun SceneCard(
    name: String,
    desc: String,
    icon: ImageVector,
    suggested: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tag: String = "SUGGESTED",
) {
    val c = Alice.c
    Pressable(modifier, color = if (suggested) c.sageSoft else c.tile, depth = 0.98f, haptic = Haptic.Medium, onClick = onClick) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            IconDisc(icon, if (suggested) c.sage else c.tile2, if (suggested) c.onSage else c.ink2)
            Column {
                Text(name, style = AliceType.bodyStrong, color = c.ink, maxLines = 1)
                Text(desc, style = AliceType.small, color = c.ink3, maxLines = 2, minLines = 2)
            }
        }
        if (suggested) Text(tag, Modifier.align(Alignment.TopEnd).padding(14.dp), style = AliceType.mono.copy(fontSize = 9.5.sp), color = c.sage)
    }
}
