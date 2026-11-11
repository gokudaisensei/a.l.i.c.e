package com.alice.home.ui

import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType

/**
 * The Alice wordmark from the web app's `.brand`: "alice" in Bricolage at 78% width with the golden full stop.
 * It is the same mark used in the desktop rail and the phone top bar, so the app and the web feel like one product.
 */
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
