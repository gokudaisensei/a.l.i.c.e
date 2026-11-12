package com.alice.home.ui.home

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Bedtime
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Layers
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.LockOpen
import androidx.compose.material.icons.rounded.Luggage
import androidx.compose.material.icons.rounded.MeetingRoom
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.NightsStay
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.WbSunny
import androidx.compose.material.icons.rounded.Work
import androidx.compose.ui.graphics.vector.ImageVector
import com.alice.home.domain.model.Mode

/**
 * The domain carries icon *keys* (the backend's vocabulary), the UI maps them to glyphs. Keep this
 * in sync with the server's allowed icon set — see `android/docs/architecture.md` §11.
 */
internal fun modeIcon(mode: Mode): ImageVector = when (mode) {
    Mode.Home -> Icons.Rounded.Home
    Mode.Away -> Icons.Rounded.MeetingRoom
    Mode.Night -> Icons.Rounded.NightsStay
    Mode.Vacation -> Icons.Rounded.Luggage
}

internal fun sceneIcon(key: String): ImageVector = when (key) {
    "sun" -> Icons.Rounded.WbSunny
    "moon" -> Icons.Rounded.Bedtime
    "play" -> Icons.Rounded.Movie
    "exit" -> Icons.Rounded.AutoAwesome
    "home" -> Icons.Rounded.Home
    "bolt" -> Icons.Rounded.Bolt
    "lock" -> Icons.Rounded.Lock
    "unlock" -> Icons.Rounded.LockOpen
    "layers" -> Icons.Rounded.Layers
    "bag" -> Icons.Rounded.Work
    "user" -> Icons.Rounded.Person
    else -> Icons.Rounded.PlayArrow
}
