package com.alice.home.ui.components

import androidx.compose.ui.graphics.Color
import com.alice.home.domain.model.Tod

/**
 * The hero's time-of-day colours as (gradient top, gradient bottom, ink, chip fill). Every screen's hero draws from this, so moving
 * between tabs never changes the sky: Home and Rooms are the same colour, only the amount of content differs.
 */
fun hero(t: Tod, dark: Boolean): List<Color> = when {
    t == Tod.Morning && !dark -> listOf(0xFFF4DEA6, 0xFFE3A67C, 0xFF2A1C10, 0x80FFFFFF)
    t == Tod.Morning -> listOf(0xFF8B6B34, 0xFF5B3A24, 0xFFFBF0DC, 0x52140A00)
    t == Tod.Day && !dark -> listOf(0xFFD4E3D2, 0xFF9CC0A4, 0xFF15241A, 0x8CFFFFFF)
    t == Tod.Day -> listOf(0xFF3F5F48, 0xFF243A2E, 0xFFEAF1E6, 0x1AFFFFFF)
    t == Tod.Evening -> listOf(0xFFD07548, 0xFF7E3B2A, 0xFFFBEFE3, 0x521E0C06)
    else -> listOf(0xFF2E4442, 0xFF141F1F, 0xFFEFEADD, 0x1AFFFFFF)
}.map { Color(it) }
