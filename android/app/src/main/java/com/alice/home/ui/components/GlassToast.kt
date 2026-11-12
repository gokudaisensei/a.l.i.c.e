package com.alice.home.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.alice.home.ui.Motion
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType
import kotlinx.coroutines.delay

/**
 * A dark glass pill that springs in above the tab bar and dismisses itself after [durationMs] (toast.css). The last message is
 * kept on screen while it animates out, so it never blanks mid-exit.
 */
@Composable
fun GlassToast(text: String?, onDone: () -> Unit, modifier: Modifier = Modifier, durationMs: Long = 2600) {
    val c = Alice.c
    var shown by remember { mutableStateOf("") }
    if (text != null) shown = text
    LaunchedEffect(text) { if (text != null) { delay(durationMs); onDone() } }
    AnimatedVisibility(
        text != null, modifier,
        enter = fadeIn(tween(180)) + scaleIn(Motion.release(), initialScale = 0.9f) + slideInVertically(Motion.release()) { it / 2 },
        exit = fadeOut(tween(160, easing = Motion.easeIn)) + slideOutVertically(tween(200, easing = Motion.easeIn)) { it / 3 },
    ) {
        Box(Modifier.clip(CircleShape).background(c.ink.copy(alpha = 0.9f))) {
            Text(shown, Modifier.padding(horizontal = 22.dp, vertical = 14.dp), style = AliceType.bodyStrong, color = c.tile)
        }
    }
}
