package com.alice.home.ui.launch

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.alice.home.R
import com.alice.home.ui.Motion
import com.alice.home.ui.components.LoadingLine
import com.alice.home.ui.components.rememberReduceMotion
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType
import kotlinx.coroutines.launch

/**
 * The platform draws a splash icon without an icon background at 288dp (192dp × 1.5), and the
 * compat loader uses the same box. The in-app mark uses it too, so the handover has no jump.
 */
private val markBox: Dp = 288.dp

/** Height of the wordmark ink inside the 192dp drawable; the rest of the square is transparent. */
private val inkHeightAt192 = 45.36.dp

/**
 * The launch screen: the same wordmark as the system splash, now with one quiet line filling beneath it.
 * There is no spinner and no colour show; the only motion is progress, in the same grammar as Alice.
 */
@Composable
fun AliceLoadingScreen(reveal: Boolean = true, dismissing: Boolean = false, modifier: Modifier = Modifier) {
    val c = Alice.c
    val calm = rememberReduceMotion()
    val progress = remember { Animatable(if (calm) 1f else 0f) }
    var started by remember { mutableStateOf(false) }

    LaunchedEffect(reveal) {
        if (!reveal) return@LaunchedEffect
        started = true
        if (!calm) progress.animateTo(1f, tween(600, easing = Motion.easeOut))
    }

    // The line and caption only appear once the system splash starts leaving. Both read their animated
    // state inside a draw/layer block, so the screen is not recomposed while they settle.
    val detail by animateFloatAsState(
        targetValue = if (started) 1f else 0f,
        animationSpec = tween(if (calm) 120 else 240, easing = Motion.easeOut),
        label = "detail",
    )

    // On exit the mark and line leave first, so the home's own wordmark is never on screen with a ghost of this one.
    val content by animateFloatAsState(
        targetValue = if (dismissing) 0f else 1f,
        animationSpec = tween(if (calm) 80 else 160, easing = Motion.easeOut),
        label = "content",
    )

    val inkHalf = inkHeightAt192 * (markBox.value / 192f) / 2f

    BoxWithConstraints(
        modifier.fillMaxSize().background(c.bg).pointerInput(Unit) {
            // Keep a touch during the hand-off from landing on the screen underneath.
            awaitPointerEventScope { while (true) awaitPointerEvent().changes.forEach { it.consume() } }
        },
    ) {
        Image(
            painter = painterResource(R.drawable.ic_splash_wordmark),
            contentDescription = "Alice",
            modifier = Modifier.size(markBox).align(Alignment.Center).graphicsLayer { alpha = content },
        )
        Column(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .offset(y = maxHeight * 0.5f + inkHalf + 24.dp)
                .graphicsLayer { alpha = detail * content },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (!calm) {
                LoadingLine(
                    progress = { progress.value },
                    track = c.ink.copy(alpha = 0.10f),
                    fill = c.sage,
                    modifier = Modifier.width(76.dp).height(3.dp),
                )
                Spacer(Modifier.height(12.dp))
            }
            Text("Loading your home…", style = AliceType.small, color = c.ink3)
        }
    }
}
