package com.alice.home.ui.components

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.alice.home.ui.Haptic
import com.alice.home.ui.Haptics
import kotlin.math.roundToInt

/**
 * Turns horizontal finger movement into a level (right raises it), with the haptics: a tick every 5, a stronger tap at each quarter,
 * a bump at either end. It only ever uses how far the finger has MOVED, never where it is, and [travelPx] (the bar's width) is the
 * distance for the full 0 to 100, so the fill follows the finger one to one. One scrub is shared by the tile's hold-and-slide and
 * the popup's own bar (see [active]), so both feel the same.
 */
class LevelScrub(private val haptics: Haptics, var travelPx: Float) {
    /** True while a finger is moving the level, whether on the popup's bar or on the hold that opened it. */
    var active by mutableStateOf(false)
        private set
    /** The level the scrub is currently at, for callers (e.g. flick-to-snap) that need it after the drag. */
    val currentLevel: Int get() = last
    private var value = 0f
    private var last = 0

    fun begin(level: Int) { value = level.toFloat(); last = level; active = true }
    fun end() { active = false }

    fun move(dx: Float, onLevel: (Int) -> Unit) {
        value = (value + dx / travelPx * 100f).coerceIn(1f, 100f)
        val n = value.roundToInt()
        if (n == last) return
        when {
            n == 100 || n == 1 -> haptics.play(Haptic.Boundary)
            n / 25 != last / 25 -> haptics.play(Haptic.Detent)
            n / 5 != last / 5 -> haptics.play(Haptic.Tick)
        }
        last = n; onLevel(n)
    }
}

/** The levels a flick can land on. */
private val Detents = listOf(0, 25, 50, 75, 100)

/**
 * Where a flick that ended at [level] lands, or null if it was not a flick. It takes [flickPxPerSec] (a fast, deliberate swipe; the caller
 * scales it by screen density) to count, so a slide that sets an exact level stays exactly where the finger left it. A flick always goes to
 * the nearest of 0, 25, 50, 75, 100 beyond the current level in the direction flicked, however hard or fast it was: the speed only decides
 * whether it is a flick, never how far it goes. From a quarter, it goes to the next one.
 */
internal fun flickTarget(level: Int, velocityPxPerSec: Float, flickPxPerSec: Float): Int? {
    if (kotlin.math.abs(velocityPxPerSec) < flickPxPerSec) return null
    return if (velocityPxPerSec > 0f) Detents.firstOrNull { it > level } else Detents.lastOrNull { it < level }
}
