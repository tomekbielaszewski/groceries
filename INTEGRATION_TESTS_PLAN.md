# Integration Test Plan: Blackbox End-to-End Suite

## Overview

Full blackbox test suite that spins up the Docker container and exercises the app
through its public surface: the HTTP API and the browser UI.

**Test runner:** Playwright (TypeScript)
**Why Playwright:** already in the Node/TS ecosystem, handles both API requests and
browser automation in one tool, first-class Docker lifecycle support via `globalSetup`.

---

## Directory layout

```
e2e/
├── playwright.config.ts       # global setup/teardown, base URL, timeouts
├── global-setup.ts            # docker compose up --build; wait for /api/bootstrap
├── global-teardown.ts         # docker compose down; remove test DB volume
├── fixtures/
│   └── grocery.ts             # extended Page fixture with helper methods
├── api/
│   ├── bootstrap.spec.ts      # GET /api/bootstrap
│   └── sync.spec.ts           # POST /api/sync
└── ui/
    ├── shops.spec.ts           # shop management
    ├── items.spec.ts           # item catalog (create, tag, assign shops)
    ├── lists.spec.ts           # list lifecycle (create, add items, complete)
    ├── shopping.spec.ts        # shopping mode (swipe, skip, buy, session)
    ├── conflicts.spec.ts       # conflict surface (multi-client writes)
    └── offline.spec.ts         # service-worker / offline behaviour
```

---

## Infrastructure

### Container lifecycle (`global-setup.ts`)

1. Generate a temp DB path: `/tmp/grocery-e2e-<timestamp>.db`
2. `docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d --build`
    - The e2e override mounts the temp DB path instead of `./`
3. Poll `GET http://localhost:8080/api/bootstrap` every 500 ms, up to 30 s
4. On timeout → tear down and throw (fail fast)

### `docker-compose.e2e.yml` (override)

```yaml
services:
  grocery:
    volumes:
      - /tmp/grocery-e2e:/data   # fresh DB, not the dev one
    ports:
      - "8080:8080"
```

### `global-teardown.ts`

1. `docker compose down --volumes`
2. Remove temp DB file

### Isolation between test files

Each `*.spec.ts` file runs in its own Playwright worker.
API tests call `POST /api/sync` to seed then clean state.
UI tests use the page fixture's `seedViaApi()` / `resetViaApi()` helpers to put the
app in a known state before each `test()`.

---

## API test scenarios

### `bootstrap.spec.ts`

| # | Scenario               | What is asserted                                                       |
|---|------------------------|------------------------------------------------------------------------|
| 1 | Empty database         | HTTP 200; body has all 10 array keys; all arrays are `[]` (not `null`) |
| 2 | After seeding one shop | `shops` array has length 1; object has expected fields                 |
| 3 | `serverTime` field     | Parses as valid ISO-8601 date; close to `Date.now()`                   |
| 4 | Content-Type header    | `application/json`                                                     |

### `sync.spec.ts`

| #  | Scenario                                    | What is asserted                                                             |
|----|---------------------------------------------|------------------------------------------------------------------------------|
| 1  | Empty payload (no changes)                  | HTTP 200; `applied = []`; `conflicts = []`; `serverChanges` has empty arrays |
| 2  | Create a shop                               | `applied` contains the shop UUID; subsequent bootstrap returns the shop      |
| 3  | Create an item                              | `applied` contains item UUID; item appears in bootstrap                      |
| 4  | Create a list + list item                   | Both UUIDs in `applied`; bootstrap reflects them                             |
| 5  | Update an existing entity                   | `applied` contains UUID; updated field visible in bootstrap                  |
| 6  | Conflict: same entity changed on both sides | `conflicts` array has one entry with `entity`, `id`, `client`, `server` keys |
| 7  | Soft delete (deleted_at set)                | Entity absent from bootstrap `items`; still present in DB (not hard-deleted) |
| 8  | `lastSyncedAt` in the future                | Server changes array is empty (nothing newer than future date)               |
| 9  | Malformed JSON body                         | HTTP 400                                                                     |
| 10 | Missing required fields                     | HTTP 400                                                                     |

---

## UI test scenarios

### `shops.spec.ts`

| # | Scenario         | Steps                                                      | Assertions                                             |
|---|------------------|------------------------------------------------------------|--------------------------------------------------------|
| 1 | Create a shop    | Navigate to Settings → Shops; fill name + pick color; save | Shop row visible; color dot matches                    |
| 2 | Edit a shop name | Click edit on existing shop; change name; save             | New name displayed                                     |
| 3 | Delete a shop    | Click delete; confirm                                      | Row removed; associated shop dots gone from item cards |

### `items.spec.ts`

| # | Scenario                     | Steps                                        | Assertions                                         |
|---|------------------------------|----------------------------------------------|----------------------------------------------------|
| 1 | Create an item               | Items tab → Add; enter name; save            | Card appears in repository                         |
| 2 | Add a tag                    | Open item detail; add tag "dairy"; save      | TagBadge "dairy" visible on card                   |
| 3 | Assign shops to item         | Open item detail; toggle two shops; save     | Two ShopDots visible on card                       |
| 4 | Edit default quantity + unit | Open detail; set qty 2, unit "kg"; save      | Detail screen shows updated values                 |
| 5 | View purchase stats          | Seed some session_items via API; open detail | History table has rows; "last bought" is populated |
| 6 | Search items                 | Type in search box                           | Only matching items shown                          |

### `lists.spec.ts`

| # | Scenario                       | Steps                                            | Assertions                       |
|---|--------------------------------|--------------------------------------------------|----------------------------------|
| 1 | Create a list                  | Lists tab → New list; name it                    | List card visible                |
| 2 | Add item to list via search    | Open list; type item name in search; tap result  | Item card appears in browse mode |
| 3 | Add item via suggestions panel | Open list; open suggestions; tap a frequent item | Item added to list               |
| 4 | Remove item from list          | Long-press or tap remove on item card            | Item no longer in list           |
| 5 | Delete a list                  | Lists tab → delete; confirm                      | List card removed                |

### `shopping.spec.ts`

| # | Scenario                    | Steps                                      | Assertions                                                      |
|---|-----------------------------|--------------------------------------------|-----------------------------------------------------------------|
| 1 | Enter shopping mode         | Open list; tap "Start shopping" for a shop | Shop dot for that shop highlighted; other items dimmed          |
| 2 | Mark item as bought (swipe) | Swipe item card right                      | Item moves to "bought" section; crossed out                     |
| 3 | Skip shop for item          | Swipe item card left                       | ShopDot for current shop shows strikethrough; item stays active |
| 4 | Undo bought                 | Tap bought item                            | Returns to active state                                         |
| 5 | End session                 | Tap "Done shopping"                        | Session saved; navigate back to browse mode                     |
| 6 | Session persists on reload  | End session; reload page                   | Bought items remain bought; session_items seeded                |

### `conflicts.spec.ts`

| # | Scenario                       | Steps                                                                                | Assertions                             |
|---|--------------------------------|--------------------------------------------------------------------------------------|----------------------------------------|
| 1 | Conflict badge visible         | Seed a conflict via API (two writes to same entity after lastSyncedAt); trigger sync | SyncStatusBar shows conflict indicator |
| 2 | Conflicts screen               | Navigate to conflicts screen                                                         | List of conflicted entities shown      |
| 3 | Resolve conflict — keep server | Click "Keep server"                                                                  | Conflict cleared; server value shown   |
| 4 | Resolve conflict — keep client | Click "Keep mine"                                                                    | Conflict cleared; client value shown   |

### `offline.spec.ts`

| # | Scenario                  | Steps                                  | Assertions                                            |
|---|---------------------------|----------------------------------------|-------------------------------------------------------|
| 1 | Create item while offline | DevTools → offline; add item           | Item appears immediately in UI (Dexie write)          |
| 2 | Sync on reconnect         | Go back online                         | Item syncs; `pendingSyncIds` cleared (no error badge) |
| 3 | Browse list offline       | Load list; go offline; navigate around | All data still accessible                             |

---

## Fixtures (`fixtures/grocery.ts`)

Shared helpers available in every test via Playwright's `test.extend`:

```ts
interface GroceryFixtures {
    // Seed entities directly via API (bypass UI for speed)
    seedViaApi(data: Partial<SyncChanges>): Promise<void>

    // Reset the DB to empty by calling sync with deleted_at on everything
    resetViaApi(): Promise<void>

    // Navigate to a page and wait for Dexie hydration (bootstrap complete)
    gotoList(listId: string): Promise<void>

    // Swipe an item card (simulates touch gesture)
    swipeCard(locator: Locator, direction: 'left' | 'right'): Promise<void>
}
```

---

## Playwright configuration (`playwright.config.ts`)

```ts
{
    globalSetup:    './global-setup.ts',
        globalTeardown
:
    './global-teardown.ts',
        use
:
    {
        baseURL:    'http://localhost:8080',
            headless
    :
        true,          // explicit; also the default
            trace
    :
        'on-first-retry',
            screenshot
    :
        'only-on-failure',
    }
,
    projects: [
        {name: 'api', testDir: './api', use: {browserName: 'chromium'}},
        {name: 'chrome', testDir: './ui', use: {browserName: 'chromium'}},
        {
            name: 'mobile',
            testDir: './ui',
            // Device emulation: viewport (412×915), touch events, mobile UA.
            // No real device needed — runs fully headless.
            use: devices['Pixel 7'],
        },
    ],
        retries
:
    1,
        workers
:
    4,
}
```

Both projects run headless. The `mobile` project is pure emulation — Playwright sets
the viewport to 412×915, enables touch event APIs, and sends the Pixel 7 user-agent.
No physical device or display server (Xvfb) required.

---

## Running the suite

```bash
# From project root
npm --prefix e2e install
npx playwright test --config e2e/playwright.config.ts

# API tests only (fast, no browser)
npx playwright test --project=api

# Mobile emulation only
npx playwright test --project=mobile

# Headed mode for local debugging (opens a real browser window)
npx playwright test --project=chrome --headed

# Generate trace viewer report on failure
npx playwright show-report e2e/playwright-report
```

---

## What this does NOT cover

- **Performance / load testing** — out of scope; the app is a single-user home server.
- **PWA / installability** — intentionally deferred per design decisions.
- **Cross-browser (Safari, Firefox)** — can be added as Playwright projects later; not
  in initial scope.
- **Auth** — no auth by design.
