package com.alice.home.ui.components

import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType

/**
 * The Alice wordmark from the web app's `.brand`: "alice" in Bricolage at 78% width with the golden full stop.
 * It is the same mark used in the desktop rail and the phone top bar, so the app and the web feel like one product.
 */
/** Opens Settings; provided by MainActivity around the tabs, null elsewhere (so [SettingsButton] draws nothing there). */
val LocalOpenSettings = androidx.compose.runtime.compositionLocalOf<(() -> Unit)?> { null }

@Composable
fun AliceWordmark(
    modifier: Modifier = Modifier,
    size: TextUnit = 30.sp,
    color: Color = Alice.c.ink,
) {
    val c = Alice.c
    val style = AliceType.brand.copy(fontSize = size, lineHeight = size)
    Row(modifier.clearAndSetSemantics { contentDescription = "Alice" }, verticalAlignment = Alignment.CenterVertically) {
        Text("alice", style = style, color = color)
        Text(".", style = style, color = c.glow)
    }
}

/** The gear at the top right of a hero. It draws nothing where there is no way to open Settings. */
@Composable
fun SettingsButton(ink: Color, bg: Color) {
    val open = LocalOpenSettings.current ?: return
    IconButtonCircle(androidx.compose.material.icons.Icons.Rounded.Settings, open, size = 44.dp, haptic = com.alice.home.ui.Haptic.Light, contentDescription = "Settings", bg = bg, tint = ink)
}
