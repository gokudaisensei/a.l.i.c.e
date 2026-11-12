package com.alice.home.ui.components

import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.alice.home.ui.Haptic
import com.alice.home.ui.theme.Alice

/** A round −/+ control. At the end of its range it bumps instead of ticking, and the press does nothing. */
@Composable
fun Stepper(icon: ImageVector, onClick: () -> Unit, modifier: Modifier = Modifier, atLimit: Boolean = false) {
    val c = Alice.c
    Pressable(
        modifier.size(40.dp), CircleShape, c.over, depth = 0.9f,
        haptic = if (atLimit) Haptic.Boundary else Haptic.Tick,
        onClick = { if (!atLimit) onClick() },
    ) {
        Icon(icon, null, tint = c.ink, modifier = Modifier.align(Alignment.Center).size(20.dp))
    }
}
