package com.alice.home.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp

/** A bare line chart, min-to-max scaled with a little headroom at the top and bottom. */
@Composable
fun Sparkline(values: List<Float>, color: Color, modifier: Modifier) {
    Canvas(modifier) {
        val mx = values.max(); val mn = values.min(); val span = (mx - mn).coerceAtLeast(0.01f)
        val pts = values.mapIndexed { i, v -> Offset(size.width * i / (values.size - 1), size.height - (v - mn) / span * size.height * 0.9f - size.height * 0.05f) }
        val p = Path().apply { moveTo(pts[0].x, pts[0].y); pts.drop(1).forEach { lineTo(it.x, it.y) } }
        drawPath(p, color, style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round))
    }
}
