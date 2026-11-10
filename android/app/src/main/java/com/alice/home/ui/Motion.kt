package com.alice.home.ui

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween

/**
 * The web app's motion language (globals.css): presses are quick and ease out, releases are a springy settle that overshoots
 * about 3% and rests in about half a second (`--spring`), sheets use a softer ease (`--ease-ios`).
 */
object Motion {
    val easeOut = CubicBezierEasing(.22f, 1f, .36f, 1f)   // --ease-out
    val easeIos = CubicBezierEasing(.32f, .72f, 0f, 1f)   // --ease-ios
    val easeIn = CubicBezierEasing(.4f, 0f, 1f, 1f)       // --ease-in
    const val PRESS_MS = 100                               // --t-press
    const val HOLD_HINT_MS = 310                           // a tile presses in while a hold is on its way
    const val HOLD_MS = 430L
    fun <T> release(): FiniteAnimationSpec<T> = spring(dampingRatio = 0.72f, stiffness = 200f)  // --spring
    fun <T> press(ms: Int = PRESS_MS): FiniteAnimationSpec<T> = tween(ms, easing = easeOut)
    fun <T> ui(ms: Int = 220): FiniteAnimationSpec<T> = tween(ms, easing = easeOut)
}
