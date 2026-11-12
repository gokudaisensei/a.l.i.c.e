package com.alice.home.ui.settings

import com.alice.home.data.HouseholdState

/** Something that needs the person's passkey first: what it will do, in words, and the event that runs once they confirm. */
data class Confirm(val title: String, val body: String, val then: SettingsEvent)

data class SettingsUiState(
    val household: HouseholdState = HouseholdState(),
    val confirm: Confirm? = null,
    val supportHours: Int = 4,
    val supportScope: Set<String> = setOf("health"),
    val focus: String? = null,
    val toast: String? = null,
)
