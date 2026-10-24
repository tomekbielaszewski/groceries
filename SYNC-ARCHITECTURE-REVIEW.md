# Sync Architecture Review — Event-based Synchronization

**Scope:** end-to-end review of the offline-first, event-sourced sync flow in this
repository. Focus: architecture flaws in the event pipeline, with emphasis on the
out-of-sync scenarios that arise when two clients (a shopper on flaky mobile
connectivity and a home user on a solid connection) edit the same list
concurrently.

**Branch / PR:** `docs/sync-architecture-review` (this document + red proof tests).

**Status of the proof tests:** `INTENTIONALLY RED`. Each test pins the *correct*
behaviour and fails against today's implementation, proving the flaw. They are
NOT meant to be merged as-is; a follow-up agent should fix the implementation
until they turn green.

- Frontend: `frontend/src/api/sync.flaws.test.ts` (3 tests)
- Backend:  `backend/handlers/sync_flaws_test.go` (3 tests)

---

## 0. TL;DR — what to fix, in priority order

| # | Flaw | Symptom in the 2-user scenario | Proof test |
|---|------|--------------------------------|------------|
| 1 | `sync()` advances `lastSeq` past events it never applied | Shopper never sees items the home user added while the shopper was offline — **silent, permanent data loss** | frontend `sync() advances lastSeq past remote events it never applied` |
| 2 | Live SSE events carry no `seq` (`omitempty`) → `lastSeq` becomes `NaN` | Any live event corrupts the cursor; every subsequent pull re-fetches from 0; cursor never advances | frontend `live SSE events carry no seq` |
| 3 | No sequence-gap detection on the client | A dropped event (e.g. full hub buffer) is silently skipped; cursor jumps past it | frontend `a gap in server seq is silently accepted` |
| 4 | Backend `PublishEvents` commits the log **before** projecting; a projection failure leaves a committed-but-unprojected event that retry never re-projects | Server log and relational projections diverge; clients and server permanently disagree | backend `ProjectionFailureMustBeAtomic`, `RetryAfterProjectionFailureMustProject` |
| 5 | `Hub.Publish` drops events for slow subscribers (non-blocking send, 16-slot buffer) | A burst (home user adding many items) drops live events on an open connection | backend `Hub_MustNotDropEventsWhenBufferIsFull` |

Flaws 1–3 are client-side and are the direct cause of the described out-of-sync
situation. Flaws 4–5 are server-side and make the situation unrecoverable.

---

## 1. How sync works today (mental model)

The system is an **append-only event log with client-side projections**.

- **Client** (`frontend/src/api/client.ts`) keeps, in memory and in a
  `localStorage` snapshot:
  - the projected state (maps/arrays of shops, items, tags, lists, list items,
    sessions…),
  - an `outbox` of locally-committed but not-yet-published events,
  - a cursor `lastSeq` (highest server `seq` applied),
  - a Lamport counter `lamport`, a `clientId`, and `lastTs`.
- **`commit(input)`** stamps an event (`id` UUID, `clientId`, `lamport`,
  `timestamp`), applies it locally (`applyEvent`), appends it to `outbox`,
  notifies listeners, schedules a sync, and persists.
- **`sync()`** POSTs the `outbox` to `/api/events`, then clears the outbox and
  sets `lastSeq = max(lastSeq, resp.lastSeq)`.
- **`loadData()`** restores the snapshot, pulls `GET /api/events?since=lastSeq`,
  applies each returned event (`applyRemoteEvent`), then `sync()`.
- **`connectStream()`** opens `GET /api/events/stream?since=lastSeq` (SSE) and
  falls back to a 3s poll + capped exponential-backoff reconnect on error.
- **Server** (`backend/handlers/`, `backend/db/`):
  - `POST /api/events` validates, then `InsertEvents` (appends to log,
    dedupes by `id`), then `ApplyEvent` per new event (projects onto relational
    tables), then broadcasts via the `Hub` to SSE subscribers.
  - `GET /api/events?since=N` returns log rows `seq > N`.
  - `GET /api/events/stream?since=N` replays catch-up frames from the log, then
    forwards live hub events.

---

## 2. Critical flaws (deep dive)

### Flaw 1 — `sync()` advances `lastSeq` past events it never applied (data loss)

`frontend/src/api/client.ts`, `sync()`:

```ts
async sync(): Promise<void> {
  const resp = await publishPendingEvents(this.outbox)
  this.outbox = []
  this.lastSeq = Math.max(this.lastSeq, resp.lastSeq)   // ← unsound
  this.persist()
}
```

`resp.lastSeq` is the server's **global** log position *after* accepting the
outbox. Between the client's previous `lastSeq` and `resp.lastSeq` there may be
events published by **other clients** that this client has never pulled or
received. Setting `lastSeq` to `resp.lastSeq` skips them — the next pull and the
next stream both resume at the new cursor, so those events are never applied and
never recovered.

Contrast with `loadData()`, which is correct because it applies every event it
fetches before advancing the cursor:

```ts
const { events, lastSeq } = await fetchRemoteEvents(this.lastSeq)
for (const e of events) this.applyRemoteEvent(e)
this.lastSeq = Math.max(this.lastSeq, lastSeq)
```

`sync()` has the same `lastSeq = max(...)` but *without* the apply step.

**Concrete failure (the described scenario):**

1. Both clients start synced at `lastSeq = 100`.
2. Home user (good connection) adds missing items → events land at `seq 101..105`.
3. Shopper (poor connection) is offline: SSE is down, polls fail. Shopper marks
   many items bought → `outbox` grows (POSTs fail, outbox retained — correct).
4. Connectivity flickers and a POST finally succeeds. The server assigns the
   shopper's buy events `seq 106..120` and returns `lastSeq = 120`.
5. Shopper sets `lastSeq = 120` — but it never applied `101..105`. The home
   user's additions are **permanently skipped** on the shopper's device. The
   shopper physically cannot see the items the home user added.

Note this is distinct from the SSE/poll paths, which advance the cursor only via
`applyRemoteEvent` (correct). The bug is unique to `sync()` being the *first*
thing to succeed after a reconnection, which is exactly the flaky-mobile case.

**Fix direction:** `sync()` must not touch `lastSeq` from `resp.lastSeq`.
Either (a) after a successful POST, pull from the pre-sync cursor and apply
(deduped by `id`), or (b) leave `lastSeq` alone and let the stream/poll advance
it exclusively through `applyRemoteEvent`. Re-publishing one's own events is
harmless (they are deduped by `appliedIds`).

---

### Flaw 2 — Live SSE events carry no `seq`, corrupting the cursor to `NaN`

`backend/models/event.go`:

```go
Seq int64 `json:"seq,omitempty"`
```

`backend/handlers/publish.go` broadcasts the *pre-insert* client events, which
have `Seq == 0`:

```go
for _, e := range newEvents {   // client events, no seq
    hub.Publish(e)
}
```

`backend/handlers/stream.go` forwards those same hub events to live subscribers
(the catch-up path reads from the DB and *does* include `seq`; the live path
does not).

`frontend/src/api/client.ts`, `applyRemoteEvent()`:

```ts
this.lastSeq = Math.max(this.lastSeq, e.seq)   // e.seq is undefined on live events
```

`Math.max(number, undefined) === NaN`. So the **first live event** turns
`lastSeq` into `NaN`, and from then on `Math.max(NaN, x)` stays `NaN`. Every
subsequent `fetchRemoteEvents(NaN)` requests `/api/events?since=NaN`; the Go
handler's `strconv.ParseInt` fails and silently treats it as `since=0`, so the
client re-pulls the entire log on every poll/reconnect/`loadData`. The cursor
never advances: unbounded re-fetching, and (combined with Flaw 1) no recovery.

The existing frontend tests never catch this because their `remoteEvent()`
helper always fabricates a `seq`; the real server omits it. This is the same
"tests diverge from reality" pattern already flagged in `PR-REVIEW.md`.

**Fix direction:** the server must publish events **with their DB-assigned
`seq`** (re-select the inserted rows and broadcast those), so live events carry
the cursor position. Alternatively the client must not derive `lastSeq` from live
event payloads and instead advance it via a periodic lightweight poll / `Last-Event-ID`.

---

### Flaw 3 — No sequence-gap detection (a dropped event is permanent)

`applyRemoteEvent()` advances `lastSeq = max(lastSeq, e.seq)` and never checks
that `e.seq === lastSeq + 1`. Combined with the hub dropping events (Flaw 5), a
single dropped event on a live connection is silently skipped: the client applies
`seq 11`, misses `seq 12` (buffer full), then applies `seq 13` and sets
`lastSeq = 13`. `seq 12` is never re-fetched because the next pull resumes at
`since=13`. Event-sourced correctness requires *every* event; there is no gap
detection or backfill anywhere.

**Fix direction:** in `applyRemoteEvent`, detect `e.seq > lastSeq + 1` and trigger
a re-pull from `lastSeq + 1` (or set `lastSeq` only to the last *contiguous* seq
and let the poller backfill). The server-side hub must also stop dropping (Flaw 5).

---

### Flaw 4 — Backend record/project split is not atomic; retry never re-projects

`backend/handlers/publish.go`, `PublishEvents()`:

```go
accepted, err := appdb.InsertEvents(db, events...)   // (1) commit log FIRST
...
for _, e := range newEvents {
    if err := appdb.ApplyEvent(db, e); err != nil {  // (2) project, separate tx
        jsonError(w, "failed to apply event", 500); return
    }
}
```

`InsertEvents` commits its own transaction (the events are now in the log).
`ApplyEvent` runs a *second* transaction that re-inserts (`INSERT OR IGNORE`,
no-op) and projects. If the projection fails — a payload whose field types don't
match the projection struct, or a foreign-key violation (e.g. a `ListItemAdded`
whose `listId`/`itemId` don't exist yet) — the handler returns 500, **but the
event is already committed to the log**.

On the client retry, `eventExists()` reports the id as already present, so the
event is classified as a duplicate and `ApplyEvent` is skipped. The projection is
never produced. The log and the relational tables diverge permanently, and no
automatic `ReplayAll()` repairs it (`db.ReplayAll` exists but is never called at
runtime).

**Fix direction:** make record+project a single transaction (insert the log row
and project in the same `tx`, deriving the `accepted` count from
`RowsAffected` in that same transaction). Drop the separate `InsertEvents`
pre-commit from the publish path. Add a startup projection-repair/`ReplayAll`
for already-diverged databases.

---

### Flaw 5 — `Hub` silently drops events for slow subscribers

`backend/handlers/hub.go`, `Publish()`:

```go
for ch := range h.subs {
    select {
    case ch <- e:
    default:            // ← event silently dropped when buffer (16) is full
    }
}
```

The buffer is 16. Any burst of >16 events (the home user adding many items, or
the shopper syncing a large outbox) drops live events on an already-open
connection. There is no acknowledgement, no `Last-Event-ID`, and no gap
detection on the client (Flaw 3), so dropped events are never recovered until the
connection drops and re-catches-up — and only then because `lastSeq` happens to
lag; if later events arrive after the drop, `lastSeq` jumps past the gap and the
drop becomes permanent.

**Fix direction:** don't drop silently. Options: per-subscriber outbound queue
with backpressure + `Last-Event-ID` resume, or a larger/bounded queue that
signals the client to re-sync on overflow. At minimum, broadcast the DB-assigned
`seq` (Flaw 2) and add client gap detection (Flaw 3) so drops are *detected* and
backfilled.

---

## 3. The two-user scenario, end to end

Setup: shopper (mobile, flaky) and home user (desktop, stable) share one list.
Both start at `lastSeq = 100`.

```
home user (stable)                     server                          shopper (flaky)
─────────────────────                  ──────                          ────────────────
adds "milk" (101)
adds "eggs" (102)                      log: …100,101,102
                                        ─ stream is down for shopper ──
                                       (shopper offline, outbox grows)
marks "bread" bought  → outbox [b1]
marks "apples" bought → outbox [b1,b2]
… more buys …
                                        connectivity flickers: shopper's POST succeeds
                                        log: …100..102, b1..bN  → lastSeq = 120
                                        shopper: lastSeq = 120   ← FLAW 1
                                        shopper never applied 101,102
shopper reconnects stream since=120    (skips 101,102 permanently)
```

The shopper's device now permanently lacks "milk" and "eggs". Additional
compounding failures:

- The shopper's **first live event** (if any other client publishes while it is
  connected) turns `lastSeq` into `NaN` (Flaw 2), re-pulling the whole log and
  never advancing.
- A **burst** of the home user's edits can overflow the hub buffer and be dropped
  (Flaw 5); with no gap detection (Flaw 3) those edits are silently skipped.
- If the server ever fails to project an event (bad payload / FK race), the log
  and projections diverge and a retry can't heal it (Flaw 4).

Net effect: the two clients converge on **different states with no error, no
conflict notification, and no automatic repair**.

---

## 4. Additional architecture issues (lower severity)

### 4.1 The Lamport clock is decorative
Events are stamped with `lamport` and the client merges it
(`this.lamport = Math.max(this.lamport, e.lamport)`), but **nothing uses it**:
the server orders by arrival `seq`, and projections apply in `seq` order. There
is no causal ordering, no conflict detection, and no "happens-before" checks.
Concurrent edits to the same entity resolve by *network arrival order*
(last-write-wins with no version guard). The `version` column is bumped on the
server projection but is never checked against a base version on write, so there
is no optimistic-concurrency control. Either drop the Lamport clock or actually
use it (e.g. causal barriers / conflict resolution).

### 4.2 No conflict detection or merge
Two clients editing the same list item concurrently (shopper marks "bought"
while home user edits quantity/state) produce two granular events applied in
arrival order; the loser is silently overwritten with no user-visible
notification. For an offline-first app this is a correctness gap, not just UX.

### 4.3 `changeListItemQuantity` with `undefined` diverges client/server
`frontend/src/api/client.ts`:

```ts
this.commit({ entityId: id, type: 'ListItemQuantityChanged', payload: { quantity: quantity as number, unit } })
```

A cleared quantity (`undefined`) is cast to `number`; `JSON.stringify` drops the
key, so the server sees no `quantity` field and leaves it unchanged, while the
client's `mutate` sets `quantity: undefined`. Client and server diverge silently.

### 4.4 `recordSessionItem` ignores `input.at`
The `at` argument is accepted but never used; the event is stamped with
`nowIso()`. The `quantity`/`unit` are also dropped on the "skipped" branch.
Callers passing a real `at` get a different stored time.

### 4.5 `applyRemoteEvent` does not persist
Remote events update memory (projection + `lastSeq`) and notify listeners but do
not call `persist()`. The snapshot only updates on the next `commit`/`sync`/
`loadData`. Not a correctness bug (the snapshot's `lastSeq` also lags, so a
reload re-pulls correctly), but it means a crash between a remote apply and the
next local commit loses the cursor progress and re-fetches.

### 4.6 `getListItemsWithItems` non-null assertion can yield `undefined`
`frontend/src/api/client.ts`:

```ts
item: itemMap.get(li.itemId)!,
```

If a `ListItemAdded` arrives before its `ItemCreated` (cross-client arrival
ordering at the server), `itemMap.get(...)` returns `undefined` and downstream
`li.item.name` throws at render time. The server's FK guard would reject the
insert, but that then triggers Flaw 4 (log/projection divergence) instead of a
clean failure.

### 4.7 No authentication / authorization / multi-user scoping
`corsMiddleware` sets `Access-Control-Allow-Origin: *`; `clientId` is
client-generated and unvalidated. All clients read/write one shared log. This is
acceptable for a single household, but there is no notion of lists scoped to
users, no auth, and nothing prevents a rogue client from corrupting the shared
state.

---

## 5. Duplicated code (generalization opportunities)

### Frontend

- **`ItemCreated` vs `OneTimeItemCreated`** (`client.ts` `applyEvent` ~lines
  236–262, and `createItem` vs `createOneTimeItem` ~631–661) are near-identical;
  the one-time branch only adds `oneTimeItemIds.add(...)`. Extract a single
  `createItem`/`applyItemCreated` with a `oneTime` flag.

- **`applyEvent` create branches** (`ShopCreated`, `ListCreated`, `ListItemAdded`,
  `ItemCreated`, `OneTimeItemCreated`) all follow the same `map.set(entityId, {
  …, version: 1, … timestamp … })` shape and the update branches all delegate to
  `mutate`. The `SessionItemBought`/`SessionItemSkipped` branches are also
  duplicated except for `action`/`quantity`.

- **`enrichItems`** builds `itemShopMap` and `itemTagMap` with the same
  accumulate-into-Map pattern twice; extract a `groupBy`-style helper.

- **`normalize()`** (`client.ts` ~45–50) duplicates the Polish-diacritics
  normalization that also exists server-side as `strutil.NormalizeTag`
  (`backend/strutil/strutil.go`). They are *not equivalent*: the frontend uses
  Unicode NFD + a generic diacritics strip; the backend uses an explicit
  Polish-only replacer. `ł` is handled, but other edge cases can diverge. One
  source of truth (and matching implementations) is needed.

### Backend

- **`projectEvent`** (`backend/db/project.go`) is a ~30-case switch where nearly
  every case is `unmarshal payload struct → INSERT/UPDATE`. The `ShopRenamed`/
  `ShopColorChanged`/`ShopSoftDeleted` (and `ListRenamed`/`ListArchived`/
  `ListDeleted`, and `ItemUpdated`/`ListItemQuantityChanged`) cases are
  structurally identical. This is a textbook table-driven refactor: a
  `map[eventType]projector{fields []fieldMapping, kind insert|update|delete}`.

- **`eventExists`** (`publish.go` ~117) uses `SELECT COUNT(*)` where
  `SELECT EXISTS(...)` suffices (minor).

- **Payload-struct definitions** are duplicated between the create/update cases
  (e.g. `ItemCreated` and `OneTimeItemCreated` define the same anonymous struct;
  `EventItemCreated`/`EventOneTimeItemCreated` share it).

### Test helpers (large duplication)

- `remoteEvent`, `jsonResponse`, `mockFetch`, `sseResponse`, `tick`, `getUrls`,
  `postBodies`, and the `Snapshot` type are duplicated across
  `client.test.ts`, `client.transport.test.ts`, `transport.test.ts`, and the new
  `sync.flaws.test.ts`. Extract a shared `src/api/testUtils.ts`.
  (I duplicated them deliberately in `sync.flaws.test.ts` to keep the proof tests
  self-contained, but the fix here is to factor them into one place.)

- Backend `makeEvent`/`openTestDB`/`query*` helpers exist in both `db` and
  `handlers_test` packages (necessarily separate packages, but the `db` test
  helpers could be shared via an internal `testutil`).

---

## 6. Proof tests

### Frontend — `frontend/src/api/sync.flaws.test.ts`

```bash
cd frontend
npx vitest run src/api/sync.flaws.test.ts
```

| Test | Proves | Today fails with |
|------|--------|------------------|
| `sync() advances lastSeq past remote events it never applied` | Flaw 1 | `expected [Array(1)] to include 'shop-home'` |
| `live SSE events carry no seq, corrupting the stream cursor to NaN` | Flaw 2 | `expected '/api/events?since=NaN' to match /since=\d+$/` |
| `a gap in server seq is silently accepted (no gap detection)` | Flaw 3 | `expected '/api/events?since=3' to contain 'since=1'` |

### Backend — `backend/handlers/sync_flaws_test.go`

```bash
cd backend
go test ./handlers/ -run 'TestPublish_ProjectionFailureMustBeAtomic|TestPublish_RetryAfterProjectionFailureMustProject|TestHub_MustNotDropEventsWhenBufferIsFull' -v
```

| Test | Proves | Today fails with |
|------|--------|------------------|
| `TestPublish_ProjectionFailureMustBeAtomic` | Flaw 4 | event committed to log while projection failed |
| `TestPublish_RetryAfterProjectionFailureMustProject` | Flaw 4 | `expected: 1, actual: 0` (never re-projected) |
| `TestHub_MustNotDropEventsWhenBufferIsFull` | Flaw 5 | `expected: 32, actual: 16` |

All six tests currently fail for the reasons above (verified locally).

---

## 7. Suggested work plan for the follow-up agent

1. **Flaw 1 (highest impact).** Change `sync()` to not advance `lastSeq` from the
   POST response. After publishing, either pull-and-apply from the pre-sync cursor
   or leave cursor advancement solely to `applyRemoteEvent`. Turn test #1 green.
2. **Flaw 2.** Publish DB-assigned `seq` on live hub events (re-select inserted
   rows and broadcast them), or otherwise give the client a valid cursor for live
   events. Turn test #2 green.
3. **Flaw 3.** Add seq-continuity detection in `applyRemoteEvent` (backfill on gap).
   Turn test #3 green.
4. **Flaw 4.** Make `PublishEvents` record+project atomic and derive `accepted`
   from the same transaction; add startup `ReplayAll`/repair. Turn the two backend
   tests green.
5. **Flaw 5.** Stop silent drops in `Hub.Publish` (queue/backpressure or
   overflow-signal + client re-sync). Turn the hub test green.
6. Address §4 and §5 (duplication) opportunistically, and add a regression test
   for the full two-user scenario (two `ApiClient` instances, one flaky, asserting
   eventual convergence).

**Definition of done:** all six proof tests green + the existing frontend (365)
and backend suites still green + `npx tsc -b` clean.

---

## 8. Verification commands (baseline)

```bash
# Backend — currently green (before the proof tests)
cd backend && go test ./...

# Frontend (365 tests) — currently green
cd frontend && npx vitest run

# Typecheck
cd frontend && npx tsc -b
```

*(Minor hygiene: `frontend/coverage/` is untracked and not in `.gitignore`.)*
