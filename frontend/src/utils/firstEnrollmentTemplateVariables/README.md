# First enrollment template variables (Settings UI)

Labels and hints for **group chat** variables when editing a **branch override** of the combined new-enrollee welcome template (`template_first_enrollment_onboarding`).

- `{groupChatUrl}`, `{groupChatLine}`, `{groupChatLabel}` show the selected branch name on the variable chip.
- Branch override shows a **Designated group chat link** panel (clickable URL + preview of `{groupChatLine}`).
- Branch override palette offers `{facebookUrl}` and `{groupChatLine}` (plus other combined variables from the template def).

At send time, the backend still resolves group chat from the enrolling student's branch.
