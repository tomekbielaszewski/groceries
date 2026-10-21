import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ListsScreen from './ListsScreen'
import { apiClient } from '../api/client'
import { formatISODate } from '../utils/dateUtils'
import type { List } from '../types'
import type { ServerEvent } from '../api/transport'

// Pinned behavior exercised here: lists created in ANOTHER tab arrive as
// events on the SSE stream and are applied to apiClient's maps. The mounted
// ListsScreen must re-read (and thus re-render) WITHOUT any navigation or
// remount. (ListsScreen itself never fetches; the stream is the only fetch.)

const store = apiClient as unknown as {
  lists: Map<string, List>
}

const makeList = (id: string, name: string): List => ({
  id, name, version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

beforeEach(() => {
  apiClient.reset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const renderLists = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <ListsScreen />
    </MemoryRouter>
  )

// Mirrors sseResponse from src/api/client.transport.test.ts: an open SSE
// response whose events are pushed with feed().
function sseResponse(): { response: Response; feed: (ev: ServerEvent) => void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
  const encoder = new TextEncoder()
  return {
    response: new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
    feed: (ev: ServerEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n`)),
  }
}

// Stubs fetch for the stream route only (ListsScreen never fetches on its own)
// and opens the client's SSE stream, returning feed() to deliver events.
function openStream(): { unsubscribe: () => void; feed: (ev: ServerEvent) => void } {
  const { response, feed } = sseResponse()
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
    if (String(url).includes('/api/events/stream')) return response
    throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${url}`)
  }))
  const unsubscribe = apiClient.connectStream()
  return { unsubscribe, feed }
}

describe('ListsScreen — live updates from remote events', () => {
  it('shows a list created remotely without navigation', async () => {
    store.lists.set('l1', makeList('l1', 'First'))

    renderLists()

    // Initial render shows the seeded list.
    await screen.findByText('First')
    expect(screen.queryByText('Second')).toBeNull()

    // Another tab creates a second list; the event arrives via the stream.
    const { unsubscribe, feed } = openStream()
    feed({
      id: 'evt-3',
      clientId: 'remote-client',
      lamport: 5,
      timestamp: '2026-08-09T10:00:00.000Z',
      entityId: 'l2',
      type: 'ListCreated',
      payload: { name: 'Second' },
      seq: 3,
    })

    // The mounted screen must render the NEW list WITHOUT navigation.
    await waitFor(() => {
      expect(screen.getByText('Second')).toBeInTheDocument()
    })
    unsubscribe()
  })
})

describe('ListsScreen — new list default name', () => {
  it('pre-fills the new list name with today\'s date in yyyy-mm-dd', () => {
    renderLists()

    fireEvent.click(screen.getByRole('button', { name: '+ New list' }))

    const input = screen.getByPlaceholderText('List name…') as HTMLInputElement
    expect(input.value).toBe(formatISODate(new Date()))
  })
})
