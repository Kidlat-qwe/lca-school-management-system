# First enrollment template variables (Settings UI)

Labels and hints for **Stay Connected** template variables when editing a **branch override** in Settings → Templates.

- `{groupChatUrl}`, `{groupChatLine}`, `{groupChatLabel}` show the selected branch name on the variable chip.
- Branch override shows a **Designated group chat link** panel (clickable URL + preview of `{groupChatLine}`).
- Branch override palette only offers `{facebookUrl}` and `{groupChatLine}`.

At send time, the backend still resolves group chat from the enrolling student's branch.
