package com.alice.home.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.alice.home.ui.Haptic
import com.alice.home.ui.Motion
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType

/**
 * Mood buttons for a lamp: Candle / Reading / Focus / Movie. Each sets a colour temperature and brightness.
 * Mirrors the web's mood buttons in device-controls.tsx (LampColour).
 */
@Composable
fun MoodButtons(
    onMood: (kelvin: Int?, rgb: List<Int>?, brightness: Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Alice.c
    val moods = listOf(
        "Candle" to Triple(2200, null, 35),
        "Reading" to Triple(3000, null, 80),
        "Focus" to Triple(5000, null, 100),
        "Movie" to Triple(null, listOf(255, 90, 40), 25),
    )
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        moods.forEach { (name, triple) ->
            val (k, rgb, b) = triple
            PillButton(name, { onMood(k, rgb, b) }, color = c.tile2, ink = c.ink, modifier = Modifier.weight(1f))
        }
    }
}
