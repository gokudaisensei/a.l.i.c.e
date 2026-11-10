package com.alice.home.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import com.alice.home.ui.LocalHaptics
import com.alice.home.ui.rememberHaptics

/** The web app's palette (globals.css), light and dark. */
@Immutable
class AliceColors(
    val bg: Color, val tile: Color, val tile2: Color,
    val ink: Color, val ink2: Color, val ink3: Color, val line: Color,
    val sage: Color, val sageSoft: Color, val onSage: Color,
    val clay: Color, val claySoft: Color,
    val glow: Color, val glowSoft: Color, val glowInk: Color,
    val ok: Color, val warn: Color, val warnSoft: Color, val crit: Color,
    val deep: Color, val deepInk: Color, val deepInk2: Color,
    val over: Color, val dark: Boolean,
)

private val LightColors = AliceColors(
    bg = Color(0xFFE8E3D6), tile = Color(0xFFF8F5EE), tile2 = Color(0xFFEEE9DD),
    ink = Color(0xFF1E241F), ink2 = Color(0xFF4B534C), ink3 = Color(0xFF585F57), line = Color(0x1C1E241F),
    sage = Color(0xFF4E7258), sageSoft = Color(0xFFD9E4D3), onSage = Color.White,
    clay = Color(0xFFB25A37), claySoft = Color(0xFFF0DBCC),
    glow = Color(0xFFE9B949), glowSoft = Color(0xFFF6E6B6), glowInk = Color(0xFF7C5300),
    ok = Color(0xFF35704B), warn = Color(0xFF855900), warnSoft = Color(0xFFF5E4B8), crit = Color(0xFFA93D2A),
    deep = Color(0xFF1E2A24), deepInk = Color(0xFFF1ECDF), deepInk2 = Color(0xFFB3BDAF),
    over = Color(0x99FFFFFF), dark = false,
)

private val DarkColors = AliceColors(
    bg = Color(0xFF111512), tile = Color(0xFF1B211C), tile2 = Color(0xFF242B25),
    ink = Color(0xFFEEE8DB), ink2 = Color(0xFFB7BBAE), ink3 = Color(0xFFA0A599), line = Color(0x1CEEE8DB),
    sage = Color(0xFF8EB698), sageSoft = Color(0xFF222F26), onSage = Color(0xFF0F1710),
    clay = Color(0xFFE58E69), claySoft = Color(0xFF3A2A21),
    glow = Color(0xFFF0C65A), glowSoft = Color(0xFF3A3320), glowInk = Color(0xFFF0C65A),
    ok = Color(0xFF7DC596), warn = Color(0xFFE3B24F), warnSoft = Color(0xFF3A3120), crit = Color(0xFFF08C78),
    deep = Color(0xFF0C110E), deepInk = Color(0xFFF1ECDF), deepInk2 = Color(0xFFB3BDAF),
    over = Color(0x12FFFFFF), dark = true,
)

private val Local = staticCompositionLocalOf { LightColors }

object Alice {
    val c: AliceColors @Composable get() = Local.current
}

@Composable
fun AliceTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val c = if (dark) DarkColors else LightColors
    val scheme = (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = c.sage, onPrimary = c.onSage, background = c.bg, onBackground = c.ink,
        surface = c.tile, onSurface = c.ink, onSurfaceVariant = c.ink2, outline = c.line,
        surfaceContainer = c.tile, surfaceContainerHigh = c.tile, surfaceContainerLow = c.tile,
        secondaryContainer = c.sageSoft, onSecondaryContainer = c.sage,
    )
    CompositionLocalProvider(Local provides c, LocalHaptics provides rememberHaptics()) {
        MaterialTheme(colorScheme = scheme, typography = AliceTypography, content = content)
    }
}
