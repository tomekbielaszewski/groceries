import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import { apiClient } from './client'
import type { ServerEvent } from './transport'

// ─────────────────────────────────────────────────────────────────────────────
// Sync architecture flaw reproductions.
//
// These tests are INTENTIONALLY RED. Each one pins the *correct* behaviour of
// the event-based sync flow; today the implementation fails them, proving the
// flaw. See SYNC-ARCHITECTURE-REVIEW.md for the full write-up.
//
// Fixing these means changing the implementation (and then these turn green).
// They are committed on their own branch/PR for review, NOT merged to master.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  apiClient.reset()
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── helpers (mirrors client.test.ts / client.transport.test.ts) ─────────────

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

function sseResponse(): { response: Response; feed: (ev: ServerEvent) => void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
  const encoder = new TextEncoder()
  return {
    response: new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
    feed: (ev: ServerEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n`)),
  }
}

function getUrls(fetchMock: Mock): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url))
}

function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

// ── FLAW 1: sync() advances lastSeq past events it never applied ────────────

describe('sync cursor (lastSeq) integrity', () => {
  it('FLAW: sync() advances lastSeq past remote events it never applied', async () => {
    // Server log before this client syncs:
    //   seq 1 = "Home" shop, published by the other user while this client was
    //   offline (shopper at low-connectivity). This client's outbox event
    //   becomes seq 2.
    const homeShop = remoteEvent('ShopCreated', 'shop-home', { name: 'Home', color: '#00ff00' }, 1, 1)

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const u = String(url)
      if (init?.method === 'POST') {
        // Publishing our outbox succeeds; the server reports it is now at seq 2.
        return jsonResponse({ accepted: 1, duplicates: 0, lastSeq: 2 })
      }
      if (u.includes('/api/events?since=')) {
        const since = Number(u.split('since=')[1])
        // If the client pulled from 0 (as it should to catch up on seq 1),
        // it would receive the home shop.
        return since === 0
          ? jsonResponse({ events: [homeShop], lastSeq: 2 })
          : jsonResponse({ events: [], lastSeq: 2 })
      }
      throw new Error(`Unexpected fetch: ${u}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await apiClient.createShop({ name: 'Shopper', color: '#000000' })
    await tick()
    await tick() // flush the auto-sync POST

    // The home user's shop (seq 1) must be applied. Today sync() jumps lastSeq
    // straight to 2 without pulling, so shop-home is never applied and is
    // unrecoverable (any later pull starts at since=2).
    const shops = await apiClient.getShops()
    expect(shops.map(s => s.id)).toContain('shop-home')
  })

  it('FLAW: live SSE events carry no seq, corrupting the stream cursor to NaN', async () => {
    const { response, feed } = sseResponse()
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const u = String(url)
      if (u.includes('/api/events/stream')) return response
      if (u.includes('/api/events?since=')) return jsonResponse({ events: [], lastSeq: 0 })
      if (init?.method === 'POST') return jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 0 })
      throw new Error(`Unexpected fetch: ${u}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const unsubscribe = apiClient.connectStream()

    // The Go server omits `seq` on live hub events (`json:"seq,omitempty"`).
    // applyRemoteEvent does `lastSeq = Math.max(lastSeq, e.seq)`, so a missing
    // seq turns lastSeq into NaN.
    const liveNoSeq = {
      id: 'evt-live',
      clientId: 'remote-client',
      lamport: 1,
      timestamp: '2026-08-09T10:00:00.000Z',
      entityId: 'shop-live',
      type: 'ShopCreated',
      payload: { name: 'Live', color: '#000000' },
    }
    feed(liveNoSeq as unknown as ServerEvent)
    await tick()

    // A subsequent pull must use a numeric cursor. Today it is `since=NaN`.
    await apiClient.loadData()
    const pull = getUrls(fetchMock).find(u => u.includes('/api/events?since='))
    expect(pull).toMatch(/since=\d+$/)
    unsubscribe()
  })

  it('FLAW: a gap in server seq is silently accepted (no gap detection)', async () => {
    const { response, feed } = sseResponse()
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const u = String(url)
      if (u.includes('/api/events/stream')) return response
      if (u.includes('/api/events?since=')) return jsonResponse({ events: [], lastSeq: 3 })
      if (init?.method === 'POST') return jsonResponse({ accepted: 0, duplicates: 0, lastSeq: 3 })
      throw new Error(`Unexpected fetch: ${u}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const unsubscribe = apiClient.connectStream()
    feed(remoteEvent('ShopCreated', 'shop-1', { name: 'One', color: '#000000' }, 1, 1))
    feed(remoteEvent('ShopCreated', 'shop-3', { name: 'Three', color: '#000000' }, 3, 3)) // seq 2 missing
    await tick()

    // The client must not skip the missing seq 2: the next pull must resume from
    // the last *contiguous* seq (1). Today lastSeq jumps to 3, so seq 2 is lost.
    await apiClient.loadData()
    const pull = getUrls(fetchMock).find(u => u.includes('/api/events?since='))
    expect(pull).toContain('since=1')
    unsubscribe()
  })
})
