---
paths:
  - "src/hooks/use-settings.ts"
  - "server/routes/settings.ts"
---

# Settings Preferences: Frontend ↔ Server Sync

When adding or modifying a preference key, **both sides must be updated together**:

| Frontend (`src/hooks/use-settings.ts`)         | Server (`server/routes/settings.ts`)          |
|------------------------------------------------|-----------------------------------------------|
| `hydrationMap` array (key, setter, validator)   | `PREF_KEYS` array                             |
| backfillRef (if applicable)                     | `PREF_ALLOWED` record (allowed values or null) |

- Adding a key to `hydrationMap` without adding it to `PREF_KEYS` causes **400 errors** on every page load (backfill PATCH fails with "No valid fields to update").
- Adding a key to `PREF_KEYS` without a frontend counterpart is harmless but dead code.
- Allowed values in `PREF_ALLOWED` must match the `validate` function in `hydrationMap`.
