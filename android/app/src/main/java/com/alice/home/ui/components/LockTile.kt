package com.alice.home.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.LockOpen
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alice.home.domain.model.Lock
import com.alice.home.ui.Haptic
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType

/** A door or lock: deep ink while locked, a warm warn tint while open. */
@Composable
fun LockTile(l: Lock, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val c = Alice.c
    val bg by animateColorAsState(if (l.locked) c.deepInk.copy(alpha = 0.08f) else c.warn.copy(alpha = 0.28f), tween(250), label = "lk")
    Pressable(modifier, shape = RoundedCornerShape(18.dp), color = bg, depth = 0.98f, haptic = Haptic.Medium, onClick = onClick) {
        ListRow(
            icon = if (l.locked) Icons.Rounded.Lock else Icons.Rounded.LockOpen,
            title = l.name,
            subtitle = if (l.locked) "Locked" else "Open · tap to lock",
            contentPadding = 12.dp,
            iconBg = if (l.locked) c.deepInk.copy(alpha = 0.12f) else c.glow,
            iconFg = if (l.locked) c.deepInk else Color(0xFF3A2A00),
            titleColor = c.deepInk,
            subtitleColor = c.deepInk2,
            titleStyle = AliceType.bodyStrong.copy(fontSize = 14.sp),
        )
    }
}
