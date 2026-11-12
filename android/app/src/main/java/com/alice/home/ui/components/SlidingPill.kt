package com.alice.home.ui.components

import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The sliding pill behind a segmented control: one cell of `1 / count`, moved by [offsetPx] (an animated value at the call
 * site, so the motion stays with the screen). Shared by the mode switch and the tab bar, which otherwise repeat this math.
 */
fun Modifier.slidingPill(
    count: Int,
    offsetPx: Float,
    radius: Dp,
    fill: Color,
    border: Color? = null,
    borderWidth: Dp = 1.dp,
): Modifier = drawBehind {
    if (count <= 0) return@drawBehind
    val r = CornerRadius(radius.toPx())
    val cell = Size(size.width / count, size.height)
    val at = Offset(offsetPx, 0f)
    drawRoundRect(fill, at, cell, r)
    if (border != null) drawRoundRect(border, at, cell, r, style = Stroke(borderWidth.toPx()))
}
