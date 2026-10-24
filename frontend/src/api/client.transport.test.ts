import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import { apiClient } from './client'
import type { AppEvent } from '../types/event'
import type { ServerEvent } from './transport'
import type {
  Shop, Item, Tag, List, ListItem, ShoppingSession, SessionItem,
  ItemShop, ItemTag, ListItemSkippedShop,
} from '../types'

// Pinned transport behavior exercised here:
// - loadData() = pull (GET /api/events?since=<lastSeq>) + sync() (POST outbox).
//   It does NOT open the SSE stream and it never touches fetch on its own
//   beyond those two calls.
// - sync() always POSTs (even an empty batch), clears the outbox on success,
//   and keeps the outbox untouched on failure.
// - connectStream(): () => void wires subscribeEventStream(lastSeq, handler);
//   stream events are applied, notify listeners, and advance lastSeq.
// - Mutations auto-publish: commit() itself triggers a sync, so events reach
//   the backend without waiting for loadData() to call sync().

// ── Helpers ────────────────────────────────────────────────────────────────────

type Route = {
  method?: 'GET' | 'POST'
  url: string
  response: Response
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function remoteEvent(
  type: string,
  entityId: string,
  payload: Record<string, unknown>,
  seq: number,
  lamport: number,
): ServerEvent {
  return {
    id: `evt-${seq}`,
    clientId: 'remote-client',
    lamport,
    timestamp: '2026-08-09T10:00:00.000Z',
    entityId,
    type,
    payload,
    seq,
  } as ServerEvent
}

function sseResponse(): {
  response: Response
  feed: (ev: ServerEvent) => void
  error: (err: unknown) => void
} {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
  const encoder = new TextEncoder()
  return {
    response: new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
    feed: (ev: ServerEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n`)),
    error: (err) => controller.error(err),
  }
}

function mockFetch(routes: Route[]): Mock {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    const route = routes.find(r => u.includes(r.url) && (!r.method || r.method === method))
    if (!route) throw new Error(`Unexpected fetch: ${method} ${u}`)
    return route.response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function postBodies(fetchMock: Mock): Array<{ events: ServerEvent[] }> {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([, init]) => JSON.parse(init!.body as string))
}

function getUrls(fetchMock: Mock): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url))
}

// ── Resilient-stream helpers (polling fallback + reconnect) ──────────────────
// Pinned fallback schedule (dev-proxy resilience):
// - poll interval: 3000ms (repeated GET /api/events?since=<lastSeq>)
// - SSE retry backoff: 2000ms doubling, capped at 30000ms (failure-driven)
// Tests below advance fake timers by these amounts to pin the behavior.

const POLL_INTERVAL = 3000
const RETRY_BASE_DELAY = 2000

// A stream that opens but can later be failed with controller.error().
function errorStream(): { response: Response; fail: (err: unknown) => void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
  return {
    response: new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
    fail: (err) => controller.error(err),
  }
}

// A stream that closes immediately (clean end, no error) — mimics a proxy that
// accepts the stream fetch but never relays anything.
function closedStreamResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({ start(c) { c.close() } }),
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

// Poll GETs are /api/events?since=N; stream GETs are /api/events/stream?since=N.
function pollUrls(fetchMock: Mock): string[] {
  return getUrls(fetchMock).filter(u => u.includes('/api/events?since='))
}

// Records process-level unhandled rejections so tests can assert that a failing
// SSE stream is reported through a callback instead of becoming an
// "Uncaught (in promise)" error.
function captureRejections(): { rejections: unknown[]; stop: () => void } {
  const rejections: unknown[] = []
  const handler = (err: unknown) => rejections.push(err)
  process.on('unhandledRejection', handler)
  return { rejections, stop: () => process.removeListener('unhandledRejection', handler) }
}

// ── Offline-first snapshot contract ─────────────────────────────────────────────
// The client persists its state to localStorage as a single JSON blob under
// SNAPSHOT_KEY so a page refresh restores everything without re-downloading the
// whole event log. Documented shape (used by seedSnapshot below AND written by
// the implementation on every mutation/sync):
// {
//   shops, items, tags, lists, listItems, itemShops, itemTags,
//   listItemSkippedShops, shoppingSessions, sessionItems,  // entity data
//   outbox: AppEvent[],                                    // unpublished events
//   lastSeq, lamport, clientId, lastTs                     // stream position etc.
// }

const SNAPSHOT_KEY = 'grocery-snapshot'

type Snapshot = {
  shops: Shop[]
  items: Item[]
  tags: Tag[]
  lists: List[]
  listItems: ListItem[]
  itemShops: ItemShop[]
  itemTags: ItemTag[]
  listItemSkippedShops: ListItemSkippedShop[]
  shoppingSessions: ShoppingSession[]
  sessionItems: SessionItem[]
  outbox: AppEvent[]
  lastSeq: number
  lamport: number
  clientId: string
  lastTs: number
}

function seedSnapshot(partial: Partial<Snapshot> = {}): Snapshot {
  const snap: Snapshot = {
    shops: [],
    items: [],
    tags: [],
    lists: [],
    listItems: [],
    itemShops: [],
    itemTags: [],
    listItemSkippedShops: [],
    shoppingSessions: [],
    sessionItems: [],
    outbox: [],
    lastSeq: 0,
    lamport: 0,
    clientId: 'snapshot-client',
    lastTs: 0,
    ...partial,
  }
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap))
  return snap
}

beforeEach(() => {
  apiClient.reset()
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── loadData ───────────────────────────────────────────────────────────────────

describe('loadData', () => {
  it('pulls the full log, applies remote events, and advances lastSeq', async () => {
    const shopEvt = remoteEvent('ShopCreated', 'shop-r1', { name: 'Remote Shop', color: '#00ff00' }, 1, 4)
    const listEvt = remoteEvent('ListCreated', 'list-r1', { name: 'Remote List' }, 2, 5)
    const fetchMock = mockFetch([
      { method: 'GET', url: '/api/events?since=0', response: jsonResponse({ events: [shopEvt, listEvt], lastSeq: 2 }) },
      { method: 'GET', url: '/api/events?since=2', response: jsonResponse({ events: [], lastSeq: 2 }) },
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 2 }) },
    ])

    await apiClient.loadData()

    const shops = await apiClient.getShops()
    expect(shops).toHaveLength(1)
    expect(shops[0]!.name).toBe('Remote Shop')
    const lists = await apiClient.getLists()
    expect(lists).toHaveLength(1)
    expect(lists[0]!.name).toBe('Remote List')

    // Remote events must not land in the outbox: loadData's sync POST is empty.
    for (const body of postBodies(fetchMock)) {
      expect(body.events).toEqual([])
    }

    // lastSeq advanced to 2: the next loadData pulls since=2.
    await apiClient.loadData()
    expect(getUrls(fetchMock).filter(u => u.includes('/api/events?since=2'))).toHaveLength(1)
  })

  it('is idempotent: replaying the same events does not duplicate entities', async () => {
    const shopEvt = remoteEvent('ShopCreated', 'shop-r1', { name: 'Remote Shop', color: '#00ff00' }, 1, 4)
    const listEvt = remoteEvent('ListCreated', 'list-r1', { name: 'Remote List' }, 2, 5)
    mockFetch([
      { method: 'GET', url: '/api/events?since=0', response: jsonResponse({ events: [shopEvt, listEvt], lastSeq: 2 }) },
      { method: 'GET', url: '/api/events?since=2', response: jsonResponse({ events: [], lastSeq: 2 }) },
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 2 }) },
    ])

    await apiClient.loadData()
    await apiClient.loadData()

    expect(await apiClient.getShops()).toHaveLength(1)
    expect(await apiClient.getLists()).toHaveLength(1)
  })

  it('notifies subscribe() listeners for each remote event', async () => {
    const shopEvt = remoteEvent('ShopCreated', 'shop-r1', { name: 'Remote Shop', color: '#00ff00' }, 1, 4)
    const listEvt = remoteEvent('ListCreated', 'list-r1', { name: 'Remote List' }, 2, 5)
    mockFetch([
      { method: 'GET', url: '/api/events?since=0', response: jsonResponse({ events: [shopEvt, listEvt], lastSeq: 2 }) },
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 2 }) },
    ])
    const received: AppEvent[] = []
    apiClient.subscribe(e => received.push(e))

    await apiClient.loadData()

    expect(received.map(e => e.type)).toEqual(['ShopCreated', 'ListCreated'])
    expect(received[0]!.entityId).toBe('shop-r1')
    expect(received[1]!.entityId).toBe('list-r1')
  })

  it('merges remote lamport: a later local mutation stamps a higher lamport', async () => {
    const shopEvt = remoteEvent('ShopCreated', 'shop-r1', { name: 'Remote Shop', color: '#00ff00' }, 1, 50)
    mockFetch([
      { method: 'GET', url: '/api/events?since=0', response: jsonResponse({ events: [shopEvt], lastSeq: 1 }) },
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 1 }) },
    ])
    const received: AppEvent[] = []
    apiClient.subscribe(e => received.push(e))

    await apiClient.loadData()
    expect(received[0]!.lamport).toBe(50)

    await apiClient.createShop({ name: 'Local', color: '#000000' })
    expect(received[1]!.lamport).toBeGreaterThanOrEqual(51)
  })

  it('reset() clears lastSeq so the next loadData pulls since=0 again', async () => {
    const shopEvt = remoteEvent('ShopCreated', 'shop-r1', { name: 'Remote Shop', color: '#00ff00' }, 1, 4)
    const fetchMock = mockFetch([
      { method: 'GET', url: '/api/events?since=0', response: jsonResponse({ events: [shopEvt], lastSeq: 2 }) },
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 2 }) },
    ])

    await apiClient.loadData()
    apiClient.reset()
    await apiClient.loadData()

    const since2 = getUrls(fetchMock).filter(u => u.includes('?since=2'))
    expect(since2).toHaveLength(0)
    expect(getUrls(fetchMock).filter(u => u.includes('?since=0'))).toHaveLength(2)
  })
})

// ── sync ───────────────────────────────────────────────────────────────────────

describe('sync', () => {
  it('drains the outbox: POSTs stamped events, then an empty batch on the next sync', async () => {
    const shop = await apiClient.createShop({ name: 'S', color: '#000000' })
    const fetchMock = mockFetch([
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 1, duplicates: 0, lastSeq: 5 }) },
    ])

    await apiClient.sync()

    const bodies = postBodies(fetchMock)
    expect(bodies).toHaveLength(1)
    const [ev] = bodies[0]!.events
    expect(ev).toMatchObject({
      type: 'ShopCreated',
      entityId: shop.id,
      payload: { name: 'S', color: '#000000' },
    })
    expect(typeof ev.id).toBe('string')
    expect(ev.id.length).toBeGreaterThan(0)
    expect(typeof ev.clientId).toBe('string')
    expect(Number.isInteger(ev.lamport)).toBe(true)
    expect(ev.lamport).toBeGreaterThan(0)
    expect(typeof ev.timestamp).toBe('string')

    await apiClient.sync()
    const bodies2 = postBodies(fetchMock)
    expect(bodies2).toHaveLength(2)
    expect(bodies2[1]!.events).toEqual([])
  })

  it('keeps events in the outbox on failure; the next sync retries the same event', async () => {
    const shop = await apiClient.createShop({ name: 'S', color: '#000000' })
    let attempts = 0
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'POST') {
        attempts++
        if (attempts === 1) throw new Error('network down')
        return jsonResponse({ accepted: 1, duplicates: 0, lastSeq: 9 })
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiClient.sync()).rejects.toThrow('network down')
    await apiClient.sync()

    const bodies = postBodies(fetchMock)
    expect(bodies).toHaveLength(2)
    const firstId = bodies[0]!.events[0]!.id
    const secondId = bodies[1]!.events[0]!.id
    expect(secondId).toBe(firstId)
    expect(secondId).not.toBe(shop.id)
  })
})

// ── auto-sync after mutation ──────────────────────────────────────────────────

describe('auto-sync after mutation', () => {
  it('publishes the outbox automatically after a single mutation (no manual sync)', async () => {
    const fetchMock = mockFetch([
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 1, duplicates: 0, lastSeq: 5 }) },
    ])

    await apiClient.createShop({ name: 'S', color: '#000000' })
    await tick()
    await tick()

    const bodies = postBodies(fetchMock)
    expect(bodies).toHaveLength(1)
    const [ev] = bodies[0]!.events
    expect(ev).toMatchObject({ type: 'ShopCreated', payload: { name: 'S', color: '#000000' } })
  })

  it('batches events committed before the sync completes into a single POST', async () => {
    const fetchMock = mockFetch([
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 2, duplicates: 0, lastSeq: 7 }) },
    ])

    await Promise.all([
      apiClient.createShop({ name: 'S', color: '#000000' }),
      apiClient.createList('Groceries'),
    ])
    await tick()
    await tick()

    const bodies = postBodies(fetchMock)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]!.events.map(e => e.type)).toEqual(['ShopCreated', 'ListCreated'])
  })

  it('persists across a page reload: the auto-published event is replayed by loadData', async () => {
    const server: ServerEvent[] = []
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const u = String(url)
      const method = init?.method ?? 'GET'
      if (method === 'POST' && u.includes('/api/events')) {
        const body = JSON.parse(init!.body as string) as { events: AppEvent[] }
        for (const e of body.events) server.push({ ...e, seq: server.length + 1 })
        return jsonResponse({ accepted: body.events.length, duplicates: 0, lastSeq: server.length })
      }
      if (method === 'GET' && u.includes('/api/events?since=')) {
        const since = Number(u.split('since=')[1])
        return jsonResponse({ events: server.filter(e => e.seq > since), lastSeq: server.length })
      }
      throw new Error(`Unexpected fetch: ${method} ${u}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const shop = await apiClient.createShop({ name: 'S', color: '#000000' })
    await tick()
    await tick()

    apiClient.reset() // simulate a page refresh: local state is gone
    await apiClient.loadData()

    const shops = await apiClient.getShops()
    expect(shops).toHaveLength(1)
    expect(shops[0]!.id).toBe(shop.id)
    expect(shops[0]!.name).toBe('S')
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
  })

  it('leaves the outbox empty after auto-publish: a later sync POSTs no events', async () => {
    const fetchMock = mockFetch([
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 1, duplicates: 0, lastSeq: 5 }) },
    ])

    await apiClient.createShop({ name: 'S', color: '#000000' })
    await tick()
    await tick()
    await apiClient.sync()

    const bodies = postBodies(fetchMock)
    expect(bodies).toHaveLength(2)
    expect(bodies[0]!.events).toHaveLength(1)
    expect(bodies[1]!.events).toEqual([])
  })

  it('keeps the outbox when the automatic publish fails; a later sync retries the same event id', async () => {
    let attempts = 0
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'POST') {
        attempts++
        if (attempts === 1) throw new Error('network down')
        return jsonResponse({ accepted: 1, duplicates: 0, lastSeq: 9 })
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const shop = await apiClient.createShop({ name: 'S', color: '#000000' })
    await tick()
    expect(fetchMock.mock.calls.length).toBe(1)

    await apiClient.sync()

    const bodies = postBodies(fetchMock)
    expect(bodies).toHaveLength(2)
    const firstId = bodies[0]!.events[0]!.id
    const secondId = bodies[1]!.events[0]!.id
    expect(secondId).toBe(firstId)
    expect(secondId).not.toBe(shop.id)
  })
})

// ── connectStream ──────────────────────────────────────────────────────────────

describe('connectStream', () => {
  it('wires the SSE stream, applies remote events, and notifies listeners', async () => {
    const { response, feed } = sseResponse()
    const fetchMock = mockFetch([
      { method: 'GET', url: '/api/events/stream?since=0', response },
    ])
    const received: AppEvent[] = []
    apiClient.subscribe(e => received.push(e))

    const unsubscribe = apiClient.connectStream()
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/events/stream?since=0')

    feed(remoteEvent('ListCreated', 'list-live', { name: 'Live List' }, 7, 12))
    await tick()

    expect(received).toHaveLength(1)
    expect(received[0]!).toMatchObject({ type: 'ListCreated', entityId: 'list-live', lamport: 12 })
    const lists = await apiClient.getLists()
    expect(lists).toHaveLength(1)
    expect(lists[0]!.name).toBe('Live List')
    unsubscribe()
  })

  it('stream events advance lastSeq and merge lamport', async () => {
    const { response, feed } = sseResponse()
    const fetchMock = mockFetch([
      { method: 'GET', url: '/api/events/stream?since=0', response },
      { method: 'GET', url: '/api/events?since=1', response: jsonResponse({ events: [], lastSeq: 1 }) },
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 1 }) },
    ])
    const received: AppEvent[] = []
    apiClient.subscribe(e => received.push(e))

    const unsubscribe = apiClient.connectStream()
    feed(remoteEvent('ShopCreated', 'shop-live', { name: 'Live', color: '#123456' }, 1, 50))
    await tick()
    expect(received[0]!.lamport).toBe(50)
    expect(await apiClient.getShops()).toHaveLength(1)

    // lastSeq advanced to 1: the next pull skips everything before seq 1.
    await apiClient.loadData()
    expect(getUrls(fetchMock).filter(u => u.includes('/api/events?since=1'))).toHaveLength(1)

    // Merged lamport: the next local mutation stamps > 50.
    await apiClient.createShop({ name: 'Local', color: '#000000' })
    expect(received.at(-1)!.lamport).toBeGreaterThan(50)
    unsubscribe()
  })
})

// ── stale-echo guards (bought-state flicker) ──────────────────────────────────
// The server echoes every event back to the origin client. On a flaky network
// an echo can arrive in a separate delivery from the rest (poller racing a
// newer cursor, SSE dropping mid-burst). An echo carries the ORIGINAL
// client-stamped id and its original seq — the tests replay the actual
// committed event, not a regenerated copy. Re-applying a ListItemAdded event
// must not overwrite the item's CURRENT state — the add payload permanently
// says state: 'active'. And re-applying an already-applied event id must be a
// complete no-op.

describe('stale-echo guards (bought-state flicker fix)', () => {
  it('a stale ListItemAdded echo does not reset a bought list item back to active', async () => {
    // The server assigns seqs in log order as events arrive; the setup
    // commits below happen before the echo is built, so staleEcho can only
    // be referenced by the pull branch once it is assigned.
    let staleEcho: ServerEvent
    let serverSeq = 0
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const u = String(url)
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body as string) as { events: ServerEvent[] }
        serverSeq += body.events.length
        return jsonResponse({ accepted: body.events.length, duplicates: 0, lastSeq: serverSeq })
      }
      if (u.includes('/api/events?since=')) {
        // A pull issued with an older cursor returns late, so it can carry an
        // event whose seq is <= the client's current cursor: the echo of the
        // ORIGINAL ListItemAdded event (same id, payload still state: 'active').
        return jsonResponse({ events: [staleEcho], lastSeq: serverSeq })
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${u}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    // The item was added earlier and is already bought locally.
    const list = await apiClient.createList('Weekly')
    const item = await apiClient.createItem({ name: 'Milk' }, [], [])
    const li = await apiClient.addListItem({ listId: list.id, itemId: item.id, state: 'active' })
    await apiClient.setListItemState(li.id, 'bought')
    await tick() // flush the auto-sync POSTs from the setup commits

    // The delayed echo is the ORIGINAL ListItemAdded event — same event id
    // (the server stores and echoes the client-stamped id), same seq (it was
    // the third event in the log).
    const added = postBodies(fetchMock).at(-1)!.events.find(e => e.type === 'ListItemAdded')!
    staleEcho = { ...added, seq: 3 } as ServerEvent

    await apiClient.loadData()

    const stored = (await apiClient.getListItemsWithItems(list.id))[0]!
    expect(stored.state).toBe('bought')
  })

  it('an echoed copy of a locally committed event is a no-op: no duplicate listener, no state or version change', async () => {
    const { response, feed } = sseResponse()
    // The server assigns seqs in log order as events arrive; the stream is
    // opened with the client's current cursor (lastSeq at connect time).
    let serverSeq = 0
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const u = String(url)
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body as string) as { events: ServerEvent[] }
        serverSeq += body.events.length
        return jsonResponse({ accepted: body.events.length, duplicates: 0, lastSeq: serverSeq })
      }
      if (u.includes('/api/events/stream?')) {
        return response
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${u}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const received: AppEvent[] = []
    apiClient.subscribe(e => received.push(e))

    const list = await apiClient.createList('Weekly')
    const item = await apiClient.createItem({ name: 'Milk' }, [], [])
    const li = await apiClient.addListItem({ listId: list.id, itemId: item.id, state: 'active' })
    await tick() // flush the auto-sync POSTs from the setup commits

    // The stream was opened with the pre-buy cursor, so the server's echo of
    // the buy event (seq > cursor) is a legitimate delivery that races the
    // client's own local apply of the same event id.
    const unsubscribe = apiClient.connectStream()
    await apiClient.setListItemState(li.id, 'bought')
    await tick() // flush the auto-sync POST that carried the buy event

    const echoed = postBodies(fetchMock).at(-1)!.events.find(e => e.type === 'ListItemStateChanged')!
    expect(echoed).toBeDefined()
    const versionAfterBuy = (await apiClient.getListItemsWithItems(list.id))[0]!.version

    // The server echoes OUR OWN event back over the stream — same event id,
    // same seq as in the log.
    feed({ ...echoed, seq: serverSeq } as ServerEvent)
    await tick()

    const after = (await apiClient.getListItemsWithItems(list.id))[0]!
    expect(after.state).toBe('bought')
    expect(after.version).toBe(versionAfterBuy)
    expect(received.filter(e => e.id === echoed.id)).toHaveLength(1)
    unsubscribe()
  })
})

// ── connectStream — resilient fallback (polling + reconnect) ──────────────────
// Dev-proxy limitation: the Vite proxy can relay only ONE SSE stream; the next
// stream attempt fails (and the failure is currently an unhandled rejection).
// These tests pin the resilient behavior: no unhandled rejection, polling
// fallback, capped-backoff stream retries, and full teardown on unsubscribe
// and reset().

describe('connectStream — resilient fallback (polling + reconnect)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('a stream that errors never rejects; the client falls back to polling', async () => {
    const { response, fail } = errorStream()
    const fetchMock = mockFetch([
      { method: 'GET', url: '/api/events/stream?since=0', response },
      { method: 'GET', url: '/api/events?since=0', response: jsonResponse({ events: [], lastSeq: 0 }) },
    ])
    const { rejections, stop } = captureRejections()
    try {
      const unsubscribe = apiClient.connectStream()
      await vi.advanceTimersByTimeAsync(1)
      fail(new Error('proxy dropped the stream'))
      await vi.advanceTimersByTimeAsync(1)

      // the transport reports the failure instead of rethrowing it
      expect(rejections).toEqual([])

      // observable proxy for "no throw": a poll GET fires within the interval
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL)
      expect(pollUrls(fetchMock)).toHaveLength(1)
      expect(pollUrls(fetchMock)[0]).toContain('since=0')
      unsubscribe()
    } finally {
      stop()
    }
  })

  it('a stream that ends immediately falls back to polling: polled events apply and advance the poll cursor', async () => {
    const listEvt = remoteEvent('ListCreated', 'list-polled', { name: 'Polled List' }, 1, 4)
    let pollCount = 0
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const u = String(url)
      if (u.includes('/api/events/stream')) return closedStreamResponse()
      if (u.includes('/api/events?since=')) {
        pollCount++
        const since = Number(u.split('since=')[1])
        if (since === 0) return jsonResponse({ events: [listEvt], lastSeq: 1 })
        return jsonResponse({ events: [], lastSeq: 1 })
      }
      throw new Error(`Unexpected fetch: ${u}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const received: AppEvent[] = []
    apiClient.subscribe(e => received.push(e))

    const unsubscribe = apiClient.connectStream()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL)

    // first poll: since=0, and the polled event is applied through the same
    // applyRemoteEvent path (state + listeners + lastSeq)
    expect(pollCount).toBe(1)
    expect(pollUrls(fetchMock)[0]).toContain('since=0')
    expect(received.map(e => e.type)).toEqual(['ListCreated'])
    expect(received[0]!.entityId).toBe('list-polled')
    const lists = await apiClient.getLists()
    expect(lists).toHaveLength(1)
    expect(lists[0]!.name).toBe('Polled List')

    // second poll: cursor advanced to since=1
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL)
    expect(pollCount).toBe(2)
    expect(pollUrls(fetchMock)[1]).toContain('since=1')
    expect(received).toHaveLength(1) // the polled event is not re-applied
    unsubscribe()
  })

  it('retries the stream with capped exponential backoff while polling; a successful retry stops polling', async () => {
    // attempts: t=0 fail → t=2000 fail → t=6000 fail → t=14000 fail →
    // next delay 16000 capped to 30000 → t=44000 SUCCEEDS (polls at 3000n).
    let streamAttempts = 0
    let feed: (ev: ServerEvent) => void = () => {}
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const u = String(url)
      if (u.includes('/api/events/stream')) {
        streamAttempts++
        if (streamAttempts <= 4) throw new Error('stream down')
        const live = sseResponse()
        feed = live.feed
        return live.response
      }
      if (u.includes('/api/events?since=')) return jsonResponse({ events: [], lastSeq: 0 })
      throw new Error(`Unexpected fetch: ${u}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const unsubscribe = apiClient.connectStream()

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL) // t=3000
    expect(pollUrls(fetchMock)).toHaveLength(1)
    expect(pollUrls(fetchMock)[0]).toContain('since=0')
    expect(streamAttempts).toBe(2) // initial + retry at t=2000

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL) // t=6000
    expect(pollUrls(fetchMock)).toHaveLength(2)
    expect(streamAttempts).toBe(3) // retry at t=6000 failed too

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL * 2) // t=12000
    expect(pollUrls(fetchMock)).toHaveLength(4)
    expect(streamAttempts).toBe(3)

    await vi.advanceTimersByTimeAsync(2000) // t=14000
    expect(streamAttempts).toBe(4) // retry at t=14000 failed

    await vi.advanceTimersByTimeAsync(16000) // t=30000
    expect(streamAttempts).toBe(4) // backoff capped at 30000: next retry at t=44000, NOT t=30000
    expect(pollUrls(fetchMock)).toHaveLength(10) // polls at 3000..30000

    await vi.advanceTimersByTimeAsync(14000) // t=44000
    expect(streamAttempts).toBe(5) // capped retry succeeded
    expect(pollUrls(fetchMock)).toHaveLength(14) // polling stopped at t=44000

    // the reconnected stream applies events again
    feed(remoteEvent('ListCreated', 'list-reconnected', { name: 'Reconnected' }, 5, 9))
    await vi.advanceTimersByTimeAsync(1)
    const lists = await apiClient.getLists()
    expect(lists).toHaveLength(1)
    expect(lists[0]!.name).toBe('Reconnected')

    // still no polling while the stream is open
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL * 2) // t=50000
    expect(pollUrls(fetchMock)).toHaveLength(14)
    unsubscribe()
  })

  it('unsubscribe stops polling and retrying', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const u = String(url)
      if (u.includes('/api/events/stream')) throw new Error('stream down')
      if (u.includes('/api/events?since=')) return jsonResponse({ events: [], lastSeq: 0 })
      throw new Error(`Unexpected fetch: ${u}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const unsubscribe = apiClient.connectStream()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL * 2) // t=6000: polls at 3000,6000; retries at 2000,6000
    expect(pollUrls(fetchMock)).toHaveLength(2) // polling is engaged

    const callsBefore = fetchMock.mock.calls.length
    unsubscribe()
    await vi.advanceTimersByTimeAsync(120000) // way past poll interval, retry cap, and backoff

    expect(fetchMock.mock.calls.length).toBe(callsBefore)
  })

  it('reset() tears down the active poller and retry schedule', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const u = String(url)
      if (u.includes('/api/events/stream')) throw new Error('stream down')
      if (u.includes('/api/events?since=')) return jsonResponse({ events: [], lastSeq: 0 })
      throw new Error(`Unexpected fetch: ${u}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    apiClient.connectStream()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL) // t=3000: polling is engaged
    expect(pollUrls(fetchMock)).toHaveLength(1)

    const callsBefore = fetchMock.mock.calls.length
    apiClient.reset()
    await vi.advanceTimersByTimeAsync(120000)

    expect(fetchMock.mock.calls.length).toBe(callsBefore)
  })

  it('a mid-stream error after events flowed triggers polling from the advanced position', async () => {
    const { response, feed, error } = sseResponse()
    const fetchMock = mockFetch([
      { method: 'GET', url: '/api/events/stream?since=0', response },
      { method: 'GET', url: '/api/events?since=1', response: jsonResponse({ events: [], lastSeq: 1 }) },
    ])
    const received: AppEvent[] = []
    apiClient.subscribe(e => received.push(e))

    const unsubscribe = apiClient.connectStream()
    await vi.advanceTimersByTimeAsync(1)
    feed(remoteEvent('ListCreated', 'list-live-err', { name: 'Live Then Broken' }, 1, 12))
    await vi.advanceTimersByTimeAsync(1)
    expect(received).toHaveLength(1) // event applied while live

    error(new Error('proxy dropped the stream'))
    await vi.advanceTimersByTimeAsync(1)

    // polling resumes from the lastSeq the stream reached
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL)
    expect(pollUrls(fetchMock)).toHaveLength(1)
    expect(pollUrls(fetchMock)[0]).toContain('since=1')
    unsubscribe()
  })

  it('a manual unsubscribe abort does not trigger polling', async () => {
    const { response } = sseResponse()
    const fetchMock = mockFetch([
      { method: 'GET', url: '/api/events/stream?since=0', response },
    ])

    const unsubscribe = apiClient.connectStream()
    await vi.advanceTimersByTimeAsync(1)
    unsubscribe()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL * 4)

    expect(pollUrls(fetchMock)).toHaveLength(0) // abort must not start polling
    const streamCalls = getUrls(fetchMock).filter(u => u.includes('/api/events/stream'))
    expect(streamCalls).toHaveLength(1) // no retry after abort either
  })
})

// ── offline-first localStorage persistence ─────────────────────────────────────

describe('localStorage persistence (offline-first)', () => {
  it('persists entities, lastSeq, and an empty outbox after a mutation auto-syncs', async () => {
    mockFetch([
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 1, duplicates: 0, lastSeq: 1 }) },
      { method: 'GET', url: '/api/events?since=0', response: jsonResponse({ events: [], lastSeq: 1 }) },
    ])

    const shop = await apiClient.createShop({ name: 'S', color: '#00ff00' })
    await tick()
    await tick()

    const raw = localStorage.getItem(SNAPSHOT_KEY)
    expect(raw).not.toBeNull()
    const snap = JSON.parse(raw!) as Snapshot
    expect(snap.shops).toEqual([
      expect.objectContaining({ id: shop.id, name: 'S', color: '#00ff00', version: 1 }),
    ])
    expect(snap.lastSeq).toBe(1)
    expect(snap.outbox).toEqual([])
    expect(typeof snap.clientId).toBe('string')
    expect(snap.clientId.length).toBeGreaterThan(0)
    expect(snap.lamport).toBeGreaterThanOrEqual(1)
    expect(typeof snap.lastTs).toBe('number')
  })

  it('restores the snapshot and pulls only events after the persisted lastSeq', async () => {
    const outboxEvt: AppEvent = {
      id: 'evt-outbox-1',
      clientId: 'snapshot-client',
      lamport: 4,
      timestamp: '2026-08-09T11:00:00.000Z',
      entityId: 'shop-pending',
      type: 'ShopCreated',
      payload: { name: 'Pending Shop', color: '#123456' },
    }
    seedSnapshot({
      shops: [
        { id: 'shop-restored', name: 'Restored Shop', color: '#ff0000', version: 1, updatedAt: '2026-08-09T10:00:00.000Z' },
        { id: 'shop-pending', name: 'Pending Shop', color: '#123456', version: 1, updatedAt: '2026-08-09T11:00:00.000Z' },
      ],
      lists: [
        { id: 'list-restored', name: 'Restored List', version: 1, createdAt: '2026-08-09T10:00:00.000Z', updatedAt: '2026-08-09T10:00:00.000Z' },
      ],
      outbox: [outboxEvt],
      lastSeq: 24,
      lamport: 4,
    })
    const fetchMock = mockFetch([
      {
        method: 'GET',
        url: '/api/events?since=24',
        response: jsonResponse({
          events: [remoteEvent('ListCreated', 'list-new', { name: 'New List' }, 25, 10)],
          lastSeq: 25,
        }),
      },
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 1, duplicates: 0, lastSeq: 25 }) },
    ])

    await apiClient.loadData()

    // (1) incremental pull from the persisted position — never a full replay
    expect(getUrls(fetchMock).filter(u => u.includes('/api/events?since=0'))).toHaveLength(0)
    expect(getUrls(fetchMock).filter(u => u.includes('/api/events?since=24'))).toHaveLength(1)

    // (2) the restored entities are readable
    const shops = await apiClient.getShops()
    expect(shops.map(s => s.name)).toEqual(expect.arrayContaining(['Restored Shop', 'Pending Shop']))
    const lists = await apiClient.getLists()
    expect(lists.map(l => l.name)).toEqual(expect.arrayContaining(['Restored List']))

    // (3) the new event from the incremental pull is applied
    expect(lists.map(l => l.name)).toContain('New List')

    // (4) the restored outbox is POSTed with its ORIGINAL id (server dedupes)
    const sent = postBodies(fetchMock).flatMap(b => b.events)
    expect(sent).toHaveLength(1)
    expect(sent[0]!).toEqual(outboxEvt)

    // the snapshot advanced past the pull
    const after = JSON.parse(localStorage.getItem(SNAPSHOT_KEY)!) as Snapshot
    expect(after.lastSeq).toBe(25)
    expect(after.outbox).toEqual([])
  })

  it('boots offline: restores state without throwing and keeps the outbox for a later retry', async () => {
    const outboxEvt: AppEvent = {
      id: 'evt-outbox-1',
      clientId: 'snapshot-client',
      lamport: 4,
      timestamp: '2026-08-09T11:00:00.000Z',
      entityId: 'shop-pending',
      type: 'ShopCreated',
      payload: { name: 'Pending Shop', color: '#123456' },
    }
    seedSnapshot({
      shops: [
        { id: 'shop-restored', name: 'Restored Shop', color: '#ff0000', version: 1, updatedAt: '2026-08-09T10:00:00.000Z' },
        { id: 'shop-pending', name: 'Pending Shop', color: '#123456', version: 1, updatedAt: '2026-08-09T11:00:00.000Z' },
      ],
      lists: [
        { id: 'list-restored', name: 'Restored List', version: 1, createdAt: '2026-08-09T10:00:00.000Z', updatedAt: '2026-08-09T10:00:00.000Z' },
      ],
      outbox: [outboxEvt],
      lastSeq: 24,
    })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))

    // the pull (and the POST attempt) fail, but the boot must not throw
    await expect(apiClient.loadData()).resolves.toBeUndefined()

    // the restored entities are still readable
    expect(await apiClient.getShops()).toHaveLength(2)
    expect(await apiClient.getLists()).toHaveLength(1)

    // the outbox survived the failed boot: a later sync() POSTs it with the same id
    const fetchMock = mockFetch([
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 1, duplicates: 0, lastSeq: 25 }) },
      { method: 'GET', url: '/api/events?since=24', response: jsonResponse({ events: [{ ...outboxEvt, seq: 25 }], lastSeq: 25 }) },
    ])
    await apiClient.sync()

    const sent = postBodies(fetchMock).flatMap(b => b.events)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.id).toBe('evt-outbox-1')
    expect(sent[0]!.clientId).toBe('snapshot-client')
    expect(sent[0]!.type).toBe('ShopCreated')

    const after = JSON.parse(localStorage.getItem(SNAPSHOT_KEY)!) as Snapshot
    expect(after.lastSeq).toBe(25)
    expect(after.outbox).toEqual([])
  })

  it('opens the stream at the persisted lastSeq after a restore boot', async () => {
    seedSnapshot({
      lists: [
        { id: 'list-restored', name: 'Restored List', version: 1, createdAt: '2026-08-09T10:00:00.000Z', updatedAt: '2026-08-09T10:00:00.000Z' },
      ],
      lastSeq: 24,
    })
    const { response, feed } = sseResponse()
    const fetchMock = mockFetch([
      { method: 'GET', url: '/api/events?since=24', response: jsonResponse({ events: [], lastSeq: 24 }) },
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 24 }) },
      { method: 'GET', url: '/api/events/stream?since=24', response },
    ])

    await apiClient.loadData()
    const unsubscribe = apiClient.connectStream()

    const urls = getUrls(fetchMock)
    expect(urls.at(-1)!).toContain('/api/events/stream?since=24')
    expect(urls.filter(u => u.includes('/api/events/stream?since=0'))).toHaveLength(0)

    // the stream is live from the restored position
    feed(remoteEvent('ShopCreated', 'shop-live', { name: 'Live', color: '#abcdef' }, 26, 11))
    await tick()
    expect(await apiClient.getShops()).toHaveLength(1)
    unsubscribe()
  })

  it('reset() clears the persisted snapshot from localStorage', async () => {
    seedSnapshot({
      shops: [{ id: 'shop-r', name: 'R', color: '#000000', version: 1, updatedAt: '2026-08-09T10:00:00.000Z' }],
      lastSeq: 9,
    })
    expect(localStorage.getItem(SNAPSHOT_KEY)).not.toBeNull()

    apiClient.reset()

    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull()
  })
})

// ── resync ────────────────────────────────────────────────────────────────────
// A "Resync" action drops ALL local client state — entity maps/arrays, the
// in-memory events list, the outbox (pending local mutations are discarded),
// lamport, lastSeq, and the localStorage snapshot — WITHOUT clearing
// subscribers. It then re-syncs from the initial event (GET /api/events?since=0,
// even when a later lastSeq was known) and reconnects the SSE stream from the
// new lastSeq. A failed pull leaves the client empty and must not throw.

describe('resync', () => {
  it('drops the local copy: seeded state is discarded and the pull rebuilds state, snapshot, and lastSeq', async () => {
    const shopEvt = remoteEvent('ShopCreated', 'shop-r', { name: 'Remote Shop', color: '#00ff00' }, 1, 4)
    const sessionEvt = remoteEvent('ShoppingSessionStarted', 'sess-r', { listId: 'list-r', shopId: 'shop-r' }, 2, 5)
    const boughtEvt = remoteEvent('SessionItemBought', 'sess-r', { itemId: 'item-r', quantity: 2, unit: 'kg' }, 3, 6)
    const { response } = sseResponse()
    const fetchMock = mockFetch([
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 1 }) },
      { method: 'GET', url: '/api/events?since=0', response: jsonResponse({ events: [shopEvt, sessionEvt, boughtEvt], lastSeq: 3 }) },
      { method: 'GET', url: '/api/events/stream?since=3', response },
    ])

    const seededShop = await apiClient.createShop({ name: 'Seeded Shop', color: '#123456' })
    await apiClient.createItem({ name: 'Seeded Item' }, [], [])
    await tick()
    await tick()

    await apiClient.resync()

    // the seeded entities are gone; only the pulled events remain
    const shops = await apiClient.getShops()
    expect(shops).toHaveLength(1)
    expect(shops[0]!.id).toBe('shop-r')
    expect(shops[0]!.name).toBe('Remote Shop')
    expect(shops[0]!.id).not.toBe(seededShop.id)
    expect(await apiClient.getItemsWithDetails()).toHaveLength(0)
    const sessionItems = await apiClient.getSessionItems('sess-r')
    expect(sessionItems).toHaveLength(1)
    expect(sessionItems[0]!).toMatchObject({ itemId: 'item-r', action: 'bought', quantity: 2, unit: 'kg' })

    // the snapshot reflects the rebuilt state, not the seeded one
    const snap = JSON.parse(localStorage.getItem(SNAPSHOT_KEY)!) as Snapshot
    expect(snap.shops).toEqual([expect.objectContaining({ id: 'shop-r', name: 'Remote Shop' })])
    expect(snap.shops.some(s => s.id === seededShop.id)).toBe(false)
    expect(snap.items).toEqual([])
    expect(snap.sessionItems).toEqual([expect.objectContaining({ itemId: 'item-r' })])
    expect(snap.outbox).toEqual([])
    expect(snap.lastSeq).toBe(3)

    // lastSeq advanced to the pull's lastSeq: the stream reconnects from there
    expect(getUrls(fetchMock).filter(u => u.includes('/api/events/stream?since=3'))).toHaveLength(1)
  })

  it('re-pulls from the initial event even when a later lastSeq was already known', async () => {
    const firstShop = remoteEvent('ShopCreated', 'shop-first', { name: 'First Pull', color: '#111111' }, 1, 1)
    const secondShop = remoteEvent('ShopCreated', 'shop-second', { name: 'Second Pull', color: '#222222' }, 1, 1)
    let pulls = 0
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const u = String(url)
      const method = init?.method ?? 'GET'
      if (method === 'POST' && u === '/api/events') return jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 5 })
      if (method === 'GET' && u === '/api/events?since=0') {
        pulls++
        if (pulls === 1) return jsonResponse({ events: [firstShop], lastSeq: 5 })
        return jsonResponse({ events: [secondShop], lastSeq: 1 })
      }
      if (method === 'GET' && u === '/api/events/stream?since=1') return sseResponse().response
      throw new Error(`Unexpected fetch: ${method} ${u}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await apiClient.loadData() // lastSeq is now 5 and state holds First Pull
    expect(await apiClient.getShops()).toHaveLength(1)

    await apiClient.resync()

    // the state matches the since=0 pull, not the previously known state
    const shops = await apiClient.getShops()
    expect(shops).toHaveLength(1)
    expect(shops[0]!.name).toBe('Second Pull')
    expect(shops[0]!.id).toBe('shop-second')

    // the resync pull went back to since=0 — nothing skipped ahead to since=5
    const pullUrls = getUrls(fetchMock).filter(u => u.includes('/api/events?since='))
    expect(pulls).toBe(2)
    expect(pullUrls).toEqual(['/api/events?since=0', '/api/events?since=0'])
    expect(pullUrls.some(u => u.includes('since=5'))).toBe(false)
  })

  it('keeps existing subscribers: listeners keep receiving applied events during the pull and afterwards', async () => {
    const shopEvt = remoteEvent('ShopCreated', 'shop-r', { name: 'Remote Shop', color: '#00ff00' }, 1, 4)
    const { response } = sseResponse()
    let pulls = 0
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const u = String(url)
      const method = init?.method ?? 'GET'
      if (method === 'POST') return jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 1 })
      if (u === '/api/events?since=0') {
        pulls++
        // The auto-sync pull right after the local commit must not yet see the
        // remote event; only the resync's full replay returns it.
        return pulls === 1
          ? jsonResponse({ events: [], lastSeq: 0 })
          : jsonResponse({ events: [shopEvt], lastSeq: 1 })
      }
      if (u === '/api/events?since=1') return jsonResponse({ events: [], lastSeq: 1 })
      if (u.includes('/api/events/stream')) return response
      throw new Error(`Unexpected fetch: ${method} ${u}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const received: AppEvent[] = []
    apiClient.subscribe(e => received.push(e))

    await apiClient.createShop({ name: 'Seeded', color: '#123456' })
    await tick()
    await tick()
    expect(received).toHaveLength(1) // the local commit reached the listener

    await apiClient.resync()

    // the pulled remote event reached the pre-existing listener
    expect(received.map(e => e.type)).toContain('ShopCreated')
    expect(received.map(e => e.entityId)).toContain('shop-r')

    // the listener still works after the resync (reset() would have dropped it)
    const after = await apiClient.createShop({ name: 'After', color: '#654321' })
    await tick()
    await tick()
    expect(received.map(e => e.entityId)).toContain(after.id)
  })

  it('drops the outbox: pending local mutations are discarded, not published', async () => {
    // the first mutation cannot publish: the event stays in the outbox
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    await apiClient.createShop({ name: 'Seeded', color: '#123456' })
    await tick()
    await tick()

    const { response } = sseResponse()
    const fetchMock = mockFetch([
      { method: 'GET', url: '/api/events?since=0', response: jsonResponse({ events: [], lastSeq: 0 }) },
      { method: 'GET', url: '/api/events/stream?since=0', response },
      { method: 'POST', url: '/api/events', response: jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 0 }) },
    ])

    await apiClient.resync()

    // the outbox is empty: the next sync publishes nothing
    await apiClient.sync()
    const bodies = postBodies(fetchMock)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]!.events).toEqual([])

    // and the never-published mutation did not survive into the local state
    expect(await apiClient.getShops()).toHaveLength(0)
  })

  it('reconnects the event stream after the pull (old stream torn down, no duplicates)', async () => {
    const shopEvt = remoteEvent('ShopCreated', 'shop-r', { name: 'Remote Shop', color: '#00ff00' }, 1, 4)
    const streamA = sseResponse()
    const streamB = sseResponse()
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const u = String(url)
      const method = init?.method ?? 'GET'
      if (method === 'POST' && u === '/api/events') return jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 1 })
      if (method === 'GET' && u === '/api/events?since=0') return jsonResponse({ events: [shopEvt], lastSeq: 1 })
      if (method === 'GET' && u === '/api/events/stream?since=0') return streamA.response
      if (method === 'GET' && u === '/api/events/stream?since=1') return streamB.response
      throw new Error(`Unexpected fetch: ${method} ${u}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    // a stream is already open (as a mounted screen would leave it)
    apiClient.connectStream()
    await tick()
    expect(getUrls(fetchMock).filter(u => u.includes('/api/events/stream'))).toHaveLength(1)

    await apiClient.resync()

    // exactly one NEW stream opened, at the pulled lastSeq (no duplicates)
    const streamUrls = getUrls(fetchMock).filter(u => u.includes('/api/events/stream'))
    expect(streamUrls).toHaveLength(2)
    expect(streamUrls.at(-1)).toContain('/api/events/stream?since=1')

    // live events on the NEW stream are applied
    streamB.feed(remoteEvent('ListCreated', 'list-live', { name: 'Live List' }, 2, 9))
    await tick()
    const lists = await apiClient.getLists()
    expect(lists).toHaveLength(1)
    expect(lists[0]!.name).toBe('Live List')
  })

  it('does not throw when the pull fails: the local copy stays dropped and empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    await apiClient.createShop({ name: 'Seeded', color: '#123456' })
    await tick()
    await tick()

    const { response } = sseResponse()
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const u = String(url)
      if (u.includes('/api/events/stream')) return response
      throw new Error('network down')
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiClient.resync()).resolves.toBeUndefined()

    // the local copy stayed dropped: nothing was restored or re-applied
    expect(await apiClient.getShops()).toHaveLength(0)
    expect(await apiClient.getItemsWithDetails()).toHaveLength(0)
    expect(await apiClient.getLists()).toHaveLength(0)
  })
})
