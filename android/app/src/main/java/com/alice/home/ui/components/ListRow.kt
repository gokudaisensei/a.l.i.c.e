package com.alice.home.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.alice.home.ui.Haptic
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType

/**
 * The row shape shared by locks, activity and sheet headers: a disc, a title over a subtitle, and an optional trailing slot.
 * Pass [onClick] to make the whole row pressable; leave it null when an enclosing surface already handles the press.
 */
@Composable
fun ListRow(
    icon: ImageVector,
    title: String,
    subtitle: String? = null,
    modifier: Modifier = Modifier,
    iconBg: Color = Alice.c.tile2,
    iconFg: Color = Alice.c.ink2,
    iconSize: Dp = 36.dp,
    titleColor: Color = Alice.c.ink,
    subtitleColor: Color = Alice.c.ink3,
    titleStyle: TextStyle = AliceType.bodyStrong,
    titleMaxLines: Int = 1,
    subtitleStyle: TextStyle = AliceType.small,
    spin: Float? = null,
    spacing: Dp = 10.dp,
    contentPadding: Dp = 0.dp,
    haptic: Haptic? = Haptic.Light,
    depth: Float = 0.97f,
    onClick: (() -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val content: @Composable RowScope.() -> Unit = {
        IconDisc(icon, iconBg, iconFg, iconSize, spin = spin)
        Column(Modifier.weight(1f)) {
            Text(title, style = titleStyle, color = titleColor, maxLines = titleMaxLines, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, style = subtitleStyle, color = subtitleColor, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        trailing?.invoke()
    }
    if (onClick == null) {
        Row(
            modifier.fillMaxWidth().padding(contentPadding),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(spacing),
            content = content,
        )
    } else {
        Pressable(modifier, color = Color.Transparent, depth = depth, haptic = haptic, onClick = onClick) {
            Row(
                Modifier.fillMaxWidth().padding(contentPadding),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(spacing),
                content = content,
            )
        }
    }
}
