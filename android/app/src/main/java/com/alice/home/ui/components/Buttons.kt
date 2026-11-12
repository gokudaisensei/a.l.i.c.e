package com.alice.home.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.alice.home.ui.Haptic
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType

/**
 * A round icon button: the close on a sheet, a dismiss on a suggestion, a stepper. The icon is always half the disc,
 * so the two common sizes (32 dp with a 16 dp icon, 40 dp with a 20 dp icon) stay in proportion.
 */
@Composable
fun IconButtonCircle(
    icon: ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
    bg: Color = Alice.c.tile2,
    tint: Color = Alice.c.ink2,
    depth: Float = 0.9f,
    haptic: Haptic? = Haptic.Light,
    contentDescription: String? = null,
) {
    Pressable(modifier.size(size), CircleShape, bg, depth = depth, haptic = haptic, onClick = onClick) {
        Icon(icon, contentDescription, tint = tint, modifier = Modifier.align(Alignment.Center).size(size * 0.5f))
    }
}

/** A small capsule action ("Switch", "Got it"): a label, an optional leading icon, and its own fill and ink. */
@Composable
fun PillButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    color: Color = Alice.c.sage,
    ink: Color = Alice.c.onSage,
    icon: ImageVector? = null,
    depth: Float = 0.96f,
    haptic: Haptic? = Haptic.Select,
    padding: PaddingValues = PaddingValues(horizontal = 14.dp, vertical = 7.dp),
) {
    Pressable(modifier, CircleShape, color, depth = depth, haptic = haptic, onClick = onClick) {
        Row(Modifier.padding(padding), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (icon != null) Icon(icon, null, tint = ink, modifier = Modifier.size(16.dp))
            Text(label, style = AliceType.label, color = ink)
        }
    }
}
