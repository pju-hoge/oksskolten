# ADR-001: Dual-layer storage for settings (localStorage + DB)

## Status

Accepted

## Context

The initial implementation managed all UI settings (theme, date display, auto-mark-read, etc.) exclusively in localStorage. Each setting had its own custom hook using a simple `useState` + `localStorage.getItem/setItem` pattern.

However, localStorage is scoped to a single browser on a single device, so settings could not be shared across devices or browsers.

## Decision

Adopted a dual-layer architecture where localStorage serves as a synchronous cache and the DB (SQLite) serves as the source of truth.

### Design

1. **Individual setting hooks** (`useArticleOpenMode`, `useDateMode`, etc.) use `createLocalStorageHook` to read/write localStorage
2. **`useSettings`** composes these hooks and adds a DB sync layer via `/api/settings/preferences`
3. **Hydration**: When the DB fetch completes, DB values are applied to localStorage (skipping dirty keys)
4. **Backfill**: If the DB has no value for a key, the current localStorage value is PATCHed back to the DB
5. **Dirty tracking**: Keys changed by the user before the DB fetch completes are tracked, preventing stale DB values from overwriting user intent
6. **Flush**: Changes are saved to the DB with a 500ms debounce. On `beforeunload`, `fetch` with `keepalive` ensures immediate flush

### Why localStorage was kept

- The DB fetch is async. Without localStorage, default values would flash briefly on initial render (FOUC)
- Settings work offline
- The DB sync layer could be added on top of existing hooks without breaking them

## History

Implementation timeline from the predecessor repository (commit hashes refer to that repo, not this one):

| Date | Commit | Description |
|------|--------|-------------|
| 2026-02-27 | `cfa0b4b` | Add theme switcher. localStorage only |
| 2026-02-28 | `79ef0f6` | Create `useSettings.ts` to compose hooks. Still localStorage only |
| 2026-03-01 | `c897c22` | First DB-persisted setting (language). "for cross-device sync" |
| 2026-03-02 | `cb3130f` | Migrate all UI settings to DB persistence (PR #15) |
| 2026-03-04 | `3b52a81` | Refactor hydration/synced setters into factory pattern |
| 2026-03-08 | `94f53bf` | Extract `createLocalStorageHook` to DRY 7 hooks |

## Consequences

- Adding a new setting requires registration in both a localStorage hook and the `useSettings` hydrationMap/synced setter
- If the DB is down, localStorage keeps settings functional (graceful degradation)
- On upgrade, backfill automatically migrates existing localStorage values to the DB for existing users
