# AI — Ask Alice

Cards for plan §4.12 (`E2E_PARITY_PLAN.md`). Written before `scenarios/ai.ts` (RUNBOOK §6.1).

## Coverage

| Catalogue bullet (plan §4.12) | Cards |
|---|---|
| Rules-first sentences (on/off, unlock, brightness, mode, scene names) | AI-01, AI-02 |
| Nothing runs until a proposal is picked | AI-02 |
| Unlock is always marked sensitive | AI-01 |
| Ids outside what the caller may see are never proposed | AI-01 |
| Model path against a fake provider (T7.1) | **BLOCKED** — the TS interpreter has no provider base-URL override (only `AI_API_KEY`/`AI_MODEL`) and there is no TS oracle for a fake provider; F-040 |
| Per-user rate cap and per-household daily cap | **BLOCKED** — caps are real-time/slow tier and the rules path does not consume the model budget |
| AI settings route | **Kotlin-only in the inventory**; TS has no `/ai/settings`, so no oracle (F-040) |

---

### E2E-AI-01  A sentence becomes a proposal, not an action
- Capability: `POST /ai/interpret`     Oracle: TS, SEC
- Needs: HA-connected household world
- Steps:
  1. `POST /ai/interpret {text:"turn off the floor lamp"}` → `items[0]` kind `commands`, label mentions the lamp, `sensitive:false`
  2. the plan's first command is `turn_off` for the lamp's entity
  3. `POST {text:"unlock the front door"}` → the proposal is marked `sensitive:true`
  4. a guest asking for the same sentence gets `[]` (they cannot see the device)
  5. nothing changed in Home Assistant
- Error twin: step 4
- Normalize: ids
- Both stacks: yes     Timing: normal     Pass when: proposals are offered, sensitive ones are marked, and nothing runs

### E2E-AI-02  Scene names become proposals and nothing runs until picked
- Capability: rules-first proposals     Oracle: TS
- Needs: HA-connected household world
- Steps:
  1. create a scene named "Movie night"
  2. `POST /ai/interpret {text:"movie night"}` → an item of kind `scene`
  3. record HA state, send the sentence, wait, and confirm HA did not change
  4. an unrecognised sentence yields `[]`
- Error twin: none
- Normalize: ids
- Both stacks: yes     Timing: normal     Pass when: the proposal names the scene and running it is still a separate choice
