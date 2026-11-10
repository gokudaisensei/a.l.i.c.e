@file:OptIn(ExperimentalTextApi::class)

package com.alice.home.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.alice.home.R

// The web app's three variable fonts, same files. Bricolage is driven on three axes: weight, width and optical size.
private fun bricolage(w: Int, width: Float, opsz: Float) = FontFamily(
    Font(
        R.font.bricolage_grotesque, FontWeight(w),
        variationSettings = FontVariation.Settings(
            FontVariation.weight(w), FontVariation.width(width), FontVariation.Setting("opsz", opsz),
        ),
    ),
)

private fun instrument(w: Int) = FontFamily(
    Font(R.font.instrument_sans, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w))),
)

private fun mono(w: Int) = FontFamily(
    Font(R.font.jetbrains_mono, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w))),
)

object AliceType {
    /** Hero greeting: ".hl-a". */
    val hero = TextStyle(fontFamily = bricolage(760, 86f, 48f), fontWeight = FontWeight(760), fontSize = 40.sp, lineHeight = 42.sp, letterSpacing = (-0.015).em)
    /** Hero second line: ".hl-b". */
    val heroSub = TextStyle(fontFamily = bricolage(340, 100f, 24f), fontWeight = FontWeight(340), fontSize = 20.sp, lineHeight = 24.sp, letterSpacing = (-0.015).em)
    /** Section heading: ".sh2 h2". */
    val section = TextStyle(fontFamily = bricolage(650, 90f, 30f), fontWeight = FontWeight(650), fontSize = 20.sp, letterSpacing = (-0.015).em)
    /** Big numbers: ".mini-big". */
    val big = TextStyle(fontFamily = bricolage(720, 85f, 72f), fontWeight = FontWeight(720), fontSize = 38.sp, lineHeight = 38.sp, letterSpacing = (-0.03).em)
    val body = TextStyle(fontFamily = instrument(400), fontSize = 15.sp, lineHeight = 21.sp)
    val bodyStrong = TextStyle(fontFamily = instrument(600), fontWeight = FontWeight(600), fontSize = 15.sp, lineHeight = 20.sp)
    val small = TextStyle(fontFamily = instrument(400), fontSize = 12.5.sp, lineHeight = 16.sp)
    val label = TextStyle(fontFamily = instrument(600), fontWeight = FontWeight(600), fontSize = 12.sp, lineHeight = 14.sp)
    val mono = TextStyle(fontFamily = mono(500), fontWeight = FontWeight(500), fontSize = 12.sp, letterSpacing = 0.02.em)
}

val AliceTypography = Typography(
    displayLarge = AliceType.hero, headlineMedium = AliceType.section, titleLarge = AliceType.section,
    titleMedium = AliceType.bodyStrong, bodyLarge = AliceType.body, bodyMedium = AliceType.body,
    bodySmall = AliceType.small, labelLarge = AliceType.bodyStrong, labelMedium = AliceType.label, labelSmall = AliceType.label,
)
