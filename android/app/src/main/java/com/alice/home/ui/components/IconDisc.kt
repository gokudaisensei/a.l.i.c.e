package com.alice.home.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** An icon in a disc. With [spin] (seconds per turn) it turns, like a running fan. */
@Composable
fun IconDisc(icon: ImageVector, bg: Color, fg: Color, size: Dp = 36.dp, spin: Float? = null) {
    Box(Modifier.size(size).clip(CircleShape).background(bg), contentAlignment = Alignment.Center) {
        val m = Modifier.size(size * 0.55f)
        if (spin == null) Icon(icon, null, tint = fg, modifier = m) else {
            val turn by rememberInfiniteTransition(label = "spin").animateFloat(0f, 360f, infiniteRepeatable(tween((spin * 1000).toInt(), easing = LinearEasing), RepeatMode.Restart), label = "turn")
            Icon(icon, null, tint = fg, modifier = m.rotate(turn))
        }
    }
}
