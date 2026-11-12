package com.alice.home.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color

/**
 * A thin iOS-style progress line: a quiet track with a fill that reaches the end. [progress] is read inside the draw block, so
 * the bar animates without recomposing the screen around it.
 */
@Composable
fun LoadingLine(progress: () -> Float, track: Color, fill: Color, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val r = CornerRadius(size.height / 2f, size.height / 2f)
        drawRoundRect(track, cornerRadius = r)
        val w = size.width * progress().coerceIn(0f, 1f)
        if (w > 0f) drawRoundRect(fill, size = Size(w, size.height), cornerRadius = r)
    }
}
