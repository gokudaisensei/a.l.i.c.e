package com.alice.home.ui.components

import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.RenderEffect as AndroidRenderEffect
import android.graphics.RuntimeShader
import android.graphics.Shader
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.asComposeRenderEffect
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.alice.home.ui.theme.Alice

/**
 * Floating glass, as in the web app (ui/glass.css + components/lens.tsx): what is behind the surface is blurred and
 * saturated, bent a little near its edges like a convex lens (Android 13+; the web does the same in Chromium), then tinted,
 * given a light edge and a soft shadow. Android 12 gets the blur only; older phones get a plain translucent surface.
 *
 * The screen records everything behind into [backdrop] (see [recordBackdrop]); the glass redraws that copy under itself.
 */
fun Modifier.recordBackdrop(layer: GraphicsLayer): Modifier = drawWithContent {
    layer.record { this@drawWithContent.drawContent() }
    drawLayer(layer)
}

// The edge map from lens.tsx as math: the sides pull from the inside across 7% of the width, top and bottom across 34% of the height.
private const val LENS = """
uniform shader content;
uniform float2 size;
uniform float amount;
half4 main(float2 p) {
    float2 uv = p / size;
    float l = 1.0 - clamp(uv.x / 0.07, 0.0, 1.0);
    float r = 1.0 - clamp((1.0 - uv.x) / 0.07, 0.0, 1.0);
    float t = 1.0 - clamp(uv.y / 0.34, 0.0, 1.0);
    float b = 1.0 - clamp((1.0 - uv.y) / 0.34, 0.0, 1.0);
    return content.eval(p + float2(l - r, t - b) * amount);
}
"""

@RequiresApi(31)
private fun glassEffect(w: Float, h: Float, amount: Float, blur: Float): androidx.compose.ui.graphics.RenderEffect {
    var e = AndroidRenderEffect.createBlurEffect(blur, blur, Shader.TileMode.CLAMP)
    e = AndroidRenderEffect.createColorFilterEffect(ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(1.5f) }), e) // --glass-sat
    if (Build.VERSION.SDK_INT >= 33) {
        val s = RuntimeShader(LENS).apply { setFloatUniform("size", w, h); setFloatUniform("amount", amount) }
        e = AndroidRenderEffect.createChainEffect(AndroidRenderEffect.createRuntimeShaderEffect(s, "content"), e)
    }
    return e.asComposeRenderEffect()
}

@Composable
fun GlassSurface(backdrop: GraphicsLayer, modifier: Modifier = Modifier, shape: Shape, tint: Color = Alice.c.tile.copy(alpha = 0.55f), content: @Composable BoxScope.() -> Unit) {
    val c = Alice.c
    val density = LocalDensity.current
    var pos by remember { mutableStateOf(Offset.Zero) }
    var size by remember { mutableStateOf(IntSize.Zero) }
    val canBlur = Build.VERSION.SDK_INT >= 31
    val effect = remember(size) {
        if (size == IntSize.Zero || !canBlur) null
        else with(density) { glassEffect(size.width.toFloat(), size.height.toFloat(), 12.dp.toPx(), 14.dp.toPx()) }
    }
    val edge = if (c.dark) Brush.verticalGradient(listOf(Color.White.copy(0.16f), Color.White.copy(0.05f)))
               else Brush.verticalGradient(listOf(Color.White.copy(0.85f), Color.White.copy(0.35f)))
    Box(
        modifier.shadow(18.dp, shape, ambientColor = Color.Black.copy(0.25f), spotColor = Color.Black.copy(0.35f))
            .clip(shape).onGloballyPositioned { pos = it.positionInRoot() }.onSizeChanged { size = it },
    ) {
        if (canBlur) Box(Modifier.matchParentSize().graphicsLayer { renderEffect = effect }.drawBehind { translate(-pos.x, -pos.y) { drawLayer(backdrop) } })
        // no blur available: the tint turns almost solid so text still holds contrast
        Box(Modifier.matchParentSize().background(if (canBlur) tint else c.tile.copy(alpha = 0.94f)))
        Box(Modifier.matchParentSize().border(1.dp, edge, shape))
        content()
    }
}
