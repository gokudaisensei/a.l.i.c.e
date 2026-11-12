package com.alice.home.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.alice.home.ui.Haptic
import com.alice.home.ui.Motion
import com.alice.home.ui.theme.Alice

/**
 * An on/off switch: a 52×32dp glow track with a thumb that slides on the release spring. Its touch target is 56×48dp, so the
 * small visual is still easy to hit. On is a firmer haptic than off.
 */
@Composable
fun Toggle(checked: Boolean, onCheckedChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    val c = Alice.c
    val track by animateColorAsState(if (checked) c.glow else c.tile2, Motion.ui(280), label = "toggleTrack")
    val thumb by animateColorAsState(if (checked) c.tile else c.ink3, Motion.ui(200), label = "toggleThumb")
    val x by animateDpAsState(if (checked) 22.dp else 4.dp, Motion.release(), label = "toggleX")
    Pressable(modifier.size(56.dp, 48.dp), CircleShape, Color.Transparent, depth = 0.96f, haptic = if (checked) Haptic.ToggleOff else Haptic.ToggleOn, onClick = { onCheckedChange(!checked) }) {
        Box(Modifier.align(Alignment.Center).size(52.dp, 32.dp).clip(CircleShape).background(track).then(if (checked) Modifier else Modifier.border(1.5.dp, c.line, CircleShape))) {
            Box(Modifier.align(Alignment.CenterStart).offset(x = x).size(24.dp).shadow(1.5.dp, CircleShape).clip(CircleShape).background(thumb))
        }
    }
}
