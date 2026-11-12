package com.alice.home.ui.automate

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ExitToApp
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.DirectionsRun
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Lightbulb
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.MeetingRoom
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.PlaylistPlay
import androidx.compose.material.icons.rounded.PowerSettingsNew
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.Thermostat
import androidx.compose.material.icons.rounded.WbSunny
import androidx.compose.material.icons.rounded.WbTwilight
import androidx.compose.ui.graphics.vector.ImageVector
import com.alice.home.domain.model.Recipe
import com.alice.home.domain.model.RecipeKind
import com.alice.home.domain.model.TriggerKind
import com.alice.home.domain.model.Verb

/** The glyph for each trigger, step verb and kind of recipe. The domain carries the enums; the UI picks the pictures. */
fun TriggerKind.icon(): ImageVector = when (this) {
    TriggerKind.Arrive -> Icons.Rounded.Home
    TriggerKind.Leave -> Icons.AutoMirrored.Rounded.ExitToApp
    TriggerKind.Time -> Icons.Rounded.Schedule
    TriggerKind.Sunset -> Icons.Rounded.WbTwilight
    TriggerKind.DoorOpens -> Icons.Rounded.MeetingRoom
    TriggerKind.Motion -> Icons.Rounded.DirectionsRun
    TriggerKind.PowerOver -> Icons.Rounded.Bolt
}

fun Verb.icon(): ImageVector = when (this) {
    Verb.TurnOn -> Icons.Rounded.Lightbulb
    Verb.TurnOff -> Icons.Rounded.PowerSettingsNew
    Verb.Dim -> Icons.Rounded.WbSunny
    Verb.SetTemp -> Icons.Rounded.Thermostat
    Verb.Lock -> Icons.Rounded.Lock
    Verb.Notify -> Icons.Rounded.Notifications
    Verb.RunScene -> Icons.Rounded.PlayArrow
    Verb.Wait -> Icons.Rounded.Schedule
    Verb.SetMode -> Icons.Rounded.Home
}

/** An automation is pictured by what starts it; a scene and a routine by their kind. */
fun Recipe.icon(): ImageVector = when (kind) {
    RecipeKind.Automation -> trigger.kind.icon()
    RecipeKind.Scene -> Icons.Rounded.AutoAwesome
    RecipeKind.Routine -> Icons.Rounded.PlaylistPlay
}
