package com.alice.home.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Remove
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType

/**
 * A number with a round − and + either side: a brightness, a temperature, a number of seconds. [step] gives the size of a tap from the
 * current value (so a long wait can move in bigger steps); at either end of [range] the button bumps instead of ticking.
 */
@Composable
fun ValueStepper(value: Int, onValueChange: (Int) -> Unit, range: IntRange, unit: String, modifier: Modifier = Modifier, step: (Int) -> Int = { 1 }) {
    val c = Alice.c
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Stepper(Icons.Rounded.Remove, { onValueChange((value - step(value - 1)).coerceAtLeast(range.first)) }, atLimit = value <= range.first)
        Row(Modifier.widthIn(min = 88.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.Center) {
            Text("$value", style = AliceType.big.copy(fontSize = 30.sp, lineHeight = 30.sp), color = c.ink, textAlign = TextAlign.Center)
            if (unit.isNotEmpty()) Text(" $unit", Modifier.padding(bottom = 4.dp), style = AliceType.small, color = c.ink3)
        }
        Stepper(Icons.Rounded.Add, { onValueChange((value + step(value)).coerceAtMost(range.last)) }, atLimit = value >= range.last)
    }
}
