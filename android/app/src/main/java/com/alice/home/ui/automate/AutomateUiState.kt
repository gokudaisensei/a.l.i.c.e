package com.alice.home.ui.automate

import com.alice.home.data.HouseholdState
import com.alice.home.domain.model.Recipe
import com.alice.home.domain.model.Slot

/** A recipe being built or edited: the draft, and the part of its sentence that is open for editing. */
data class Builder(val draft: Recipe, val slot: Slot)

data class AutomateUiState(
    val household: HouseholdState = HouseholdState(),
    /** Null while the person is looking at the list; set while they build or edit. */
    val builder: Builder? = null,
    /** The category the list settled on (open), by pane key; null means the first. */
    val focus: String? = null,
    val toast: String? = null,
)
