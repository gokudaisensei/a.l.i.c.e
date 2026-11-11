package com.alice.home

import android.os.Bundle
import android.util.Log
import android.view.animation.PathInterpolator
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.alice.home.ui.AliceLoadingScreen
import com.alice.home.ui.HomeScreen
import com.alice.home.ui.Motion
import com.alice.home.ui.rememberReduceMotion
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceTheme
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {
    // The system launch screen stays up until Compose has drawn its first frame, so the app splash is already
    // in place when it fades. This avoids the blank frame the platform leaves between its icon and the app.
    private val contentReady = mutableStateOf(false)
    private val revealed = mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        Log.d("AliceLaunch", "onCreate")
        // A recreated activity (rotation, theme change) is not a fresh launch: continue straight to the app.
        if (savedInstanceState != null) {
            contentReady.value = true
            revealed.value = true
        }

        installSplashScreen().apply {
            setKeepOnScreenCondition { !contentReady.value }
            setOnExitAnimationListener { provider ->
                Log.d("AliceLaunch", "exit listener")
                revealed.value = true
                provider.view.animate()
                    .alpha(0f)
                    .setDuration(180L)
                    .setInterpolator(PathInterpolator(0.32f, 0.72f, 0f, 1f))
                    .withEndAction { provider.remove() }
                    .start()
            }
        }

        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { AliceTheme { AliceApp(reveal = revealed.value) { contentReady.value = true } } }
    }
}

/**
 * The wordmark holds the screen just long enough to read, then dissolves on the same soft exit curve as a sheet.
 * The home is already composed underneath, so the reveal is ready and the app never shows a blank page.
 */
@Composable
private fun AliceApp(reveal: Boolean, onReady: () -> Unit) {
    androidx.compose.runtime.SideEffect { Log.d("AliceLaunch", "composed") }
    val calm = rememberReduceMotion()
    var splash by rememberSaveable { mutableStateOf(true) }
    // Home is built after the splash's first frame: the launch screen then draws immediately and
    // the heavier home composition happens while the wordmark is already on screen.
    var home by rememberSaveable { mutableStateOf(false) }
    // The home's own wordmark only fades in once the launch mark has left the screen, so the two never overlap.
    var brandIn by rememberSaveable { mutableStateOf(!splash) }
    val exitMs = if (calm) 160 else 300
    val brandAlpha by animateFloatAsState(
        targetValue = if (brandIn) 1f else 0f,
        animationSpec = tween(if (calm) 120 else 240, easing = Motion.easeOut),
        label = "brand",
    )
    Box(Modifier.fillMaxSize().background(Alice.c.bg)) {
        if (home) HomeScreen(brandAlpha = brandAlpha)
        AnimatedVisibility(
            visible = splash,
            enter = EnterTransition.None,
            exit = fadeOut(if (calm) tween(160, easing = Motion.easeOut) else tween(300, easing = Motion.easeIn)),
        ) { AliceLoadingScreen(reveal = reveal, dismissing = !splash) }
    }
    LaunchedEffect(Unit) {
        Log.d("AliceLaunch", "wait first frame")
        withFrameNanos { Log.d("AliceLaunch", "frame") }
        Log.d("AliceLaunch", "ready")
        onReady()
        Log.d("AliceLaunch", "home=true")
        home = true
    }
    LaunchedEffect(reveal) {
        if (!reveal) { Log.d("AliceLaunch", "reveal false"); return@LaunchedEffect }
        Log.d("AliceLaunch", "reveal true")
        // The system splash already covered the cold start; keep only a short brand beat before home.
        delay(if (calm) 220 else 650)
        Log.d("AliceLaunch", "splash false")
        splash = false
    }
    LaunchedEffect(splash) {
        if (splash) return@LaunchedEffect
        // The mark and line leave first; the home's wordmark arrives as the background clears.
        delay((exitMs * 0.45f).toLong())
        Log.d("AliceLaunch", "brand in")
        brandIn = true
    }
}
