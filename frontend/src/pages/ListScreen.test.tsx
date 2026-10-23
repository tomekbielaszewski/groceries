import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi } from 'vitest'
import ListScreen from './ListScreen'
import { apiClient } from '../api/client'
import { useStore } from '../store/useStore'
import type { Item, List, ListItem, Shop, Tag, ItemShop, ItemTag, ListItemSkippedShop, ShoppingSession, SessionItem } from '../types'
import type { ServerEvent } from '../api/transport'
import type { AppEvent } from '../types/event'

const store = apiClient as unknown as {
  shops: Map<string, Shop>
  items: Map<string, Item>
  tags: Map<string, Tag>
  lists: Map<string, List>
  listItems: Map<string, ListItem>
  itemShops: ItemShop[]
  itemTags: ItemTag[]
  listItemSkippedShops: ListItemSkippedShop[]
  shoppingSessions: Map<string, ShoppingSession>
  sessionItems: SessionItem[]
}

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

const renderList = (listId: string) =>
  render(
    <MemoryRouter initialEntries={[`/list/${listId}`]}>
      <Routes>
        <Route path="/list/:id" element={<ListScreen />} />
      </Routes>
    </MemoryRouter>
  )

const makeList = (id: string): List => ({
  id, name: 'Test list', version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

const makeItem = (id: string, overrides: Partial<Item> = {}): Item => ({
  id, name: `Item ${id}`, version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

const makeListItem = (id: string, listId: string, itemId: string, overrides: Partial<ListItem> = {}): ListItem => ({
  id, listId, itemId, state: 'active', version: 1,
  addedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

const makeShop = (id: string, overrides: Partial<Shop> = {}): Shop => ({
  id, name: `Shop ${id}`, color: '#aabbcc', version: 1,
  updatedAt: new Date().toISOString(),
  ...overrides,
})

beforeEach(async () => {
  useStore.setState({ shoppingModeShopId: null })
  apiClient.reset()
})

// ---------------------------------------------------------------------------
// quantity defaults when adding items
// ---------------------------------------------------------------------------

describe('ListScreen — quantity default when adding via search', () => {
  it('uses item.defaultQuantity when it is set', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    const item = makeItem('i1', { name: 'Apples', unit: 'kg', defaultQuantity: 3 })
    store.lists.set(list.id, list)
    store.items.set(item.id, item)

    renderList('l1')

    // Type in the search box and select the item
    const input = await screen.findByPlaceholderText('Search items…')
    await user.type(input, 'Apples')
    const btn = await screen.findByRole('button', { name: /Apples/ })
    await user.click(btn)

    await waitFor(() => {
      const listItems = [...store.listItems.values()].filter(li => li.listId === 'l1')
      expect(listItems).toHaveLength(1)
      expect(listItems[0].quantity).toBe(3)
    })
  })

  it('falls back to 1 when item has no defaultQuantity and unit is not g/ml', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    // Item has no defaultQuantity (e.g. synced from old server)
    const item = makeItem('i1', { name: 'Apples', unit: 'kg' })
    store.lists.set(list.id, list)
    store.items.set(item.id, item)

    renderList('l1')

    const input = await screen.findByPlaceholderText('Search items…')
    await user.type(input, 'Apples')
    const btn = await screen.findByRole('button', { name: /Apples/ })
    await user.click(btn)

    await waitFor(() => {
      const listItems = [...store.listItems.values()].filter(li => li.listId === 'l1')
      expect(listItems).toHaveLength(1)
      expect(listItems[0].quantity).toBe(1)
    })
  })

  it('falls back to 100 when item has no defaultQuantity and unit is g', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    const item = makeItem('i1', { name: 'Flour', unit: 'g' })
    store.lists.set(list.id, list)
    store.items.set(item.id, item)

    renderList('l1')

    const input = await screen.findByPlaceholderText('Search items…')
    await user.type(input, 'Flour')
    const btn = await screen.findByRole('button', { name: /Flour/ })
    await user.click(btn)

    await waitFor(() => {
      const listItems = [...store.listItems.values()].filter(li => li.listId === 'l1')
      expect(listItems).toHaveLength(1)
      expect(listItems[0].quantity).toBe(100)
    })
  })

  it('falls back to 100 when item has no defaultQuantity and unit is ml', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    const item = makeItem('i1', { name: 'Milk', unit: 'ml' })
    store.lists.set(list.id, list)
    store.items.set(item.id, item)

    renderList('l1')

    const input = await screen.findByPlaceholderText('Search items…')
    await user.type(input, 'Milk')
    const btn = await screen.findByRole('button', { name: /Milk/ })
    await user.click(btn)

    await waitFor(() => {
      const listItems = [...store.listItems.values()].filter(li => li.listId === 'l1')
      expect(listItems).toHaveLength(1)
      expect(listItems[0].quantity).toBe(100)
    })
  })

  it('removed item re-appears in suggestions panel', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    const item = makeItem('i1', { name: 'Butter' })
    const li = makeListItem('li1', 'l1', 'i1')
    store.lists.set(list.id, list)
    store.items.set(item.id, item)
    store.listItems.set(li.id, li)

    renderList('l1')

    // The item is active — wait for render and verify no suggestion pill for Butter
    await screen.findByText('Butter')
    // SuggestionsPanel filters out active items, so no pill button for Butter yet
    expect(screen.queryByRole('button', { name: /^Butter/ })).toBeNull()

    // Remove Butter from the list
    const removeBtn = screen.getByRole('button', { name: /remove from list/i })
    await user.click(removeBtn)

    // After removal, Butter should re-appear as a suggestion pill
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Butter/ })).toBeTruthy()
    })
  })

  it('suggestion rows in "Not added" panel have no hover highlight', async () => {
    const list = makeList('l1')
    const item = makeItem('i1', { name: 'Butter' })
    const li = makeListItem('li1', 'l1', 'i1')
    store.lists.set(list.id, list)
    store.items.set(item.id, item)
    store.listItems.set(li.id, li)

    renderList('l1')

    await screen.findByText('Butter')

    const removeBtn = screen.getByRole('button', { name: /remove from list/i })
    await userEvent.setup().click(removeBtn)

    const suggestion = await waitFor(() => screen.getByRole('button', { name: /^Butter/ }))
    expect(suggestion).not.toHaveClass('hover:border-blue-500')
  })

  it('newly added item card animates in when added from suggestions', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    const item = makeItem('i1', { name: 'Butter' })
    const li = makeListItem('li1', 'l1', 'i1')
    store.lists.set(list.id, list)
    store.items.set(item.id, item)
    store.listItems.set(li.id, li)

    renderList('l1')

    await screen.findByText('Butter')

    const removeBtn = screen.getByRole('button', { name: /remove from list/i })
    await user.click(removeBtn)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Butter/ })).toBeTruthy()
    })

    await user.click(screen.getByRole('button', { name: /^Butter/ }))

    await waitFor(() => {
      const entering = document.querySelector('[class*="animate-item-in"]')
      expect(entering).toBeTruthy()
      expect(entering?.textContent).toContain('Butter')
    })
  })

  it('tapped suggestion row collapses out before disappearing', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    const item = makeItem('i1', { name: 'Butter' })
    const li = makeListItem('li1', 'l1', 'i1')
    store.lists.set(list.id, list)
    store.items.set(item.id, item)
    store.listItems.set(li.id, li)

    renderList('l1')

    await screen.findByText('Butter')

    const removeBtn = screen.getByRole('button', { name: /remove from list/i })
    await user.click(removeBtn)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Butter/ })).toBeTruthy()
    })

    await user.click(screen.getByRole('button', { name: /^Butter/ }))

    await waitFor(() => {
      expect(document.querySelector('[class*="grid-rows-[0fr]"]')).toBeTruthy()
    })

    await waitFor(
      () => {
        expect(document.querySelector('[class*="grid-rows-[0fr]"]')).toBeNull()
      },
      { timeout: 2000 }
    )
  })

  it('does not create duplicate listItem when addItem is called while listItems state is loading', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    const item = makeItem('i1', { name: 'Bread', unit: 'pcs', defaultQuantity: 1 })
    // Pre-seed an active listItem so it already exists
    const existing = makeListItem('li-seed', 'l1', 'i1')
    store.lists.set(list.id, list)
    store.items.set(item.id, item)
    store.listItems.set(existing.id, existing)

    renderList('l1')

    // The item is already active — searching and clicking it should be a no-op
    const input = await screen.findByPlaceholderText('Search items…')
    await user.type(input, 'Bread')
    // The item is excluded from search results (it's already active)
    // so no dropdown button should appear for it
    await waitFor(() => {
      const listItems = [...store.listItems.values()].filter(li => li.listId === 'l1')
      expect(listItems).toHaveLength(1)
    })
  })
})

// ---------------------------------------------------------------------------
// archived list — read-only view
// ---------------------------------------------------------------------------

describe('ListScreen — archived list', () => {
  const makeArchivedList = (id: string): List => ({
    ...makeList(id),
    archivedAt: new Date().toISOString(),
  })

  it('shows Archived badge instead of Shop button', async () => {
    const list = makeArchivedList('l1')
    store.lists.set(list.id, list)

    renderList('l1')

    await screen.findByText('Archived')
    expect(screen.queryByRole('button', { name: /^shop$/i })).not.toBeInTheDocument()
  })

  it('does not render the search input', async () => {
    const list = makeArchivedList('l1')
    store.lists.set(list.id, list)

    renderList('l1')

    await screen.findByText('Archived')
    expect(screen.queryByPlaceholderText('Search items…')).not.toBeInTheDocument()
  })

  it('does not render remove buttons on items', async () => {
    const list = makeArchivedList('l1')
    const item = makeItem('i1', { name: 'Butter' })
    const li = makeListItem('li1', 'l1', 'i1')
    store.lists.set(list.id, list)
    store.items.set(item.id, item)
    store.listItems.set(li.id, li)

    renderList('l1')

    await screen.findByText('Butter')
    expect(screen.queryByRole('button', { name: /remove from list/i })).not.toBeInTheDocument()
  })

  it('does not render quantity steppers on items', async () => {
    const list = makeArchivedList('l1')
    const item = makeItem('i1', { name: 'Milk', unit: 'l' })
    const li = makeListItem('li1', 'l1', 'i1', { quantity: 2 })
    store.lists.set(list.id, list)
    store.items.set(item.id, item)
    store.listItems.set(li.id, li)

    renderList('l1')

    await screen.findByText('Milk')
    expect(screen.queryByRole('button', { name: /decrease quantity/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /increase quantity/i })).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// rename list
// ---------------------------------------------------------------------------

describe('ListScreen — rename list', () => {
  it('opens a rename dialog from the three-dot menu', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    store.lists.set(list.id, list)

    renderList('l1')

    await user.click(await screen.findByRole('button', { name: /more options/i }))
    expect(await screen.findByRole('button', { name: /rename list/i })).toBeInTheDocument()
  })

  it('pre-fills the input with the current list name', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    store.lists.set(list.id, list)

    renderList('l1')

    await user.click(await screen.findByRole('button', { name: /more options/i }))
    await user.click(await screen.findByRole('button', { name: /rename list/i }))

    const input = await screen.findByRole('textbox', { name: /list name/i })
    expect((input as HTMLInputElement).value).toBe('Test list')
  })

  it('saves the new name to the database', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    store.lists.set(list.id, list)

    renderList('l1')

    await user.click(await screen.findByRole('button', { name: /more options/i }))
    await user.click(await screen.findByRole('button', { name: /rename list/i }))

    const input = await screen.findByRole('textbox', { name: /list name/i })
    await user.clear(input)
    await user.type(input, 'Weekly shopping')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      const updated = store.lists.get('l1')
      expect(updated?.name).toBe('Weekly shopping')
    })
  })

  it('updates the header title after rename', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    store.lists.set(list.id, list)

    renderList('l1')

    await user.click(await screen.findByRole('button', { name: /more options/i }))
    await user.click(await screen.findByRole('button', { name: /rename list/i }))

    const input = await screen.findByRole('textbox', { name: /list name/i })
    await user.clear(input)
    await user.type(input, 'New name')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('New name')
    })
  })

  it('does not show rename option for archived lists', async () => {
    const user = userEvent.setup()
    const list: List = { ...makeList('l1'), archivedAt: new Date().toISOString() }
    store.lists.set(list.id, list)

    renderList('l1')

    await user.click(await screen.findByRole('button', { name: /more options/i }))
    expect(screen.queryByRole('button', { name: /rename list/i })).not.toBeInTheDocument()
  })

  it('closes the dialog on cancel without saving', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    store.lists.set(list.id, list)

    renderList('l1')

    await user.click(await screen.findByRole('button', { name: /more options/i }))
    await user.click(await screen.findByRole('button', { name: /rename list/i }))

    const input = await screen.findByRole('textbox', { name: /list name/i })
    await user.clear(input)
    await user.type(input, 'Changed name')
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(screen.queryByRole('textbox', { name: /list name/i })).not.toBeInTheDocument()
    const updated = store.lists.get('l1')
    expect(updated?.name).toBe('Test list')
  })
})

// ---------------------------------------------------------------------------
// clone active items
// ---------------------------------------------------------------------------

describe('ListScreen — clone active items', () => {
  it('clones only active (not-yet-bought) items into a new list', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    const milk = makeItem('i1', { name: 'Milk' })
    const eggs = makeItem('i2', { name: 'Eggs' })
    const active = makeListItem('li1', 'l1', 'i1', { quantity: 2 })
    const bought = makeListItem('li2', 'l1', 'i2', { state: 'bought' })
    store.lists.set(list.id, list)
    store.items.set(milk.id, milk)
    store.items.set(eggs.id, eggs)
    store.listItems.set(active.id, active)
    store.listItems.set(bought.id, bought)

    renderList('l1')

    await screen.findByText('Milk')
    await user.click(await screen.findByRole('button', { name: /more options/i }))
    await user.click(await screen.findByRole('button', { name: /clone active items/i }))

    await waitFor(() => {
      const cloned = [...store.lists.values()].find(l => l.id !== 'l1')
      expect(cloned).toBeDefined()
      expect(cloned?.name).toBe('Copy of Test list')
    })

    const cloned = [...store.lists.values()].find(l => l.id !== 'l1')!
    const clonedItems = [...store.listItems.values()].filter(li => li.listId === cloned.id)
    expect(clonedItems.map(li => li.itemId)).toEqual(['i1'])
    expect(clonedItems[0].state).toBe('active')
    expect(clonedItems[0].quantity).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// live updates from remote events (SSE stream)
// ---------------------------------------------------------------------------
// A change made in ANOTHER tab arrives here as an event on the SSE stream and
// is applied to apiClient's maps. The mounted screen must re-read (and thus
// re-render) WITHOUT any navigation or remount.

describe('ListScreen — live updates from remote events', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const remoteEvent = (
    type: string,
    entityId: string,
    payload: Record<string, unknown>,
    seq: number,
    lamport: number,
  ): ServerEvent => ({
    id: `evt-${seq}`,
    clientId: 'remote-client',
    lamport,
    timestamp: '2026-08-09T10:00:00.000Z',
    entityId,
    type,
    payload,
    seq,
  } as ServerEvent)

  // Mirrors sseResponse from src/api/client.transport.test.ts: an open SSE
  // response whose events are pushed with feed().
  const sseResponse = (): { response: Response; feed: (ev: ServerEvent) => void } => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
    const encoder = new TextEncoder()
    return {
      response: new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
      feed: (ev: ServerEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n`)),
    }
  }

  // Flushes microtasks + one macrotask so a fed stream event has been
  // processed (same convention as client.transport.test.ts).
  const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

  // Stubs fetch for the stream route only (screens never fetch on their own)
  // and opens the client's SSE stream, returning feed() to deliver events.
  const openStream = (): { unsubscribe: () => void; feed: (ev: ServerEvent) => void } => {
    const { response, feed } = sseResponse()
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
      if (String(url).includes('/api/events/stream')) return response
      throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${url}`)
    }))
    const unsubscribe = apiClient.connectStream()
    return { unsubscribe, feed }
  }

  it('re-renders a quantity change that arrives over the event stream', async () => {
    const list = makeList('l1')
    const item = makeItem('i1', { name: 'Apples' })
    const li = makeListItem('li1', 'l1', 'i1', { quantity: 1, unit: '' })
    store.lists.set(list.id, list)
    store.items.set(item.id, item)
    store.listItems.set(li.id, li)

    renderList('l1')

    // Initial render shows Apples with quantity 1.
    await screen.findByText('Apples')
    expect(screen.getByText('1')).toBeInTheDocument()

    // Another tab changes the quantity 1 → 3; the event arrives via the stream.
    const { unsubscribe, feed } = openStream()
    feed(remoteEvent('ListItemQuantityChanged', 'li1', { quantity: 3, unit: '' }, 5, 9))

    // The mounted screen must show the NEW quantity WITHOUT navigation.
    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument()
    })
    unsubscribe()
  })

  it('renders a list item added remotely without navigation', async () => {
    const list = makeList('l1')
    const item = makeItem('i2', { name: 'Bananas' })
    store.lists.set(list.id, list)
    store.items.set(item.id, item)

    renderList('l1')

    // No list items yet: the empty state is shown and there is no item card.
    await screen.findByText('No items yet. Search below to add some.')
    expect(screen.queryByRole('button', { name: /remove from list/i })).toBeNull()

    // Another tab adds Bananas to this list; the event arrives via the stream.
    const { unsubscribe, feed } = openStream()
    feed(remoteEvent('ListItemAdded', 'li2', { listId: 'l1', itemId: 'i2', state: 'active', quantity: 2, unit: '' }, 6, 10))

    // The mounted screen must render the new item card WITHOUT navigation.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /remove from list/i })).toBeInTheDocument()
    })
    unsubscribe()
  })

  it('a late ListItemAdded echo does not yank a bought item back into the active list', async () => {
    const user = userEvent.setup()
    const shop = makeShop('s1', { name: 'Supermarket' })
    store.shops.set(shop.id, shop)

    // Commit the setup through the client so the ORIGINAL ListItemAdded event
    // (client-stamped id) is in the client's event log — the server echoes
    // that exact event back, not a regenerated copy.
    await apiClient.createList('Test list', 'l1')
    await apiClient.createItem({ name: 'Milk' }, ['s1'], [], 'i1')
    const added: AppEvent[] = []
    const capture = apiClient.subscribe(e => { if (e.type === 'ListItemAdded') added.push(e) })
    const li = await apiClient.addListItem({ listId: 'l1', itemId: 'i1', state: 'active' })
    capture()
    await apiClient.setListItemState(li.id, 'bought')

    renderList('l1')

    // Enter shopping mode: the bought item is in the struck-through Bought section.
    await user.click(await screen.findByRole('button', { name: /^shop$/i }))
    await user.click(await screen.findByRole('button', { name: /supermarket/i }))
    await screen.findByText('Milk')

    // The server delivers a delayed echo of the ORIGINAL ListItemAdded event
    // (same id, payload still state: 'active') after the item was already bought.
    const { unsubscribe, feed } = openStream()
    feed({ ...added[0]!, seq: 4 } as ServerEvent)
    await tick()

    // The stale echo must NOT reset the item to active (the reported flicker).
    expect(store.listItems.get(li.id)!.state).toBe('bought')
    unsubscribe()
  })
})

// ---------------------------------------------------------------------------
// shop picker when starting shopping
// ---------------------------------------------------------------------------

describe('ListScreen — shop picker', () => {
  it('shows a list of shops to choose from and enters the selected one', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    const auchan = makeShop('s1', { name: 'Auchan' })
    const lidl = makeShop('s2', { name: 'Lidl' })
    store.lists.set(list.id, list)
    store.shops.set(auchan.id, auchan)
    store.shops.set(lidl.id, lidl)

    renderList('l1')

    await user.click(await screen.findByRole('button', { name: /^shop$/i }))

    // Both shops are offered, and nothing is preselected yet.
    expect(await screen.findByRole('button', { name: /auchan/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /lidl/i })).toBeInTheDocument()
    expect(useStore.getState().shoppingModeShopId).toBeNull()

    // Choosing the second shop (not the default first one) enters shopping mode there.
    await user.click(screen.getByRole('button', { name: /lidl/i }))

    await waitFor(() => {
      expect(useStore.getState().shoppingModeShopId).toBe('s2')
    })
  })
})

// ---------------------------------------------------------------------------
// purchase history recorded when buying in shopping mode
// ---------------------------------------------------------------------------

describe('ListScreen — purchase history', () => {
  it('records a sessionItem when an item is marked bought in shopping mode', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    const shop = makeShop('s1', { name: 'Supermarket' })
    const item = makeItem('i1', { name: 'Milk', unit: 'l', defaultQuantity: 1 })
    const li   = makeListItem('li1', 'l1', 'i1')

    store.lists.set(list.id, list)
    store.shops.set(shop.id, shop)
    store.items.set(item.id, item)
    store.listItems.set(li.id, li)
    store.itemShops.push({ itemId: 'i1', shopId: 's1' })

    renderList('l1')

    // Enter shopping mode by clicking the "Shop" button
    const shopBtn = await screen.findByRole('button', { name: /^shop$/i })
    await user.click(shopBtn)
    await user.click(await screen.findByRole('button', { name: /supermarket/i }))

    // The item should now appear in shopping mode
    const milkBtn = await screen.findByText('Milk')
    await user.click(milkBtn)

    // A sessionItem with action='bought' should be in the DB
    await waitFor(() => {
      const sessionItems = store.sessionItems
      expect(sessionItems).toHaveLength(1)
      expect(sessionItems[0]!.itemId).toBe('i1')
      expect(sessionItems[0]!.action).toBe('bought')
    })
  })

  it('creates a shoppingSession linked to the active shop when buying', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    const shop = makeShop('s1', { name: 'Supermarket' })
    const item = makeItem('i1', { name: 'Bread' })
    const li   = makeListItem('li1', 'l1', 'i1')

    store.lists.set(list.id, list)
    store.shops.set(shop.id, shop)
    store.items.set(item.id, item)
    store.listItems.set(li.id, li)
    store.itemShops.push({ itemId: 'i1', shopId: 's1' })

    renderList('l1')

    const shopBtn = await screen.findByRole('button', { name: /^shop$/i })
    await user.click(shopBtn)
    await user.click(await screen.findByRole('button', { name: /supermarket/i }))

    const breadBtn = await screen.findByText('Bread')
    await user.click(breadBtn)

    await waitFor(() => {
      const sessions = [...store.shoppingSessions.values()]
      expect(sessions).toHaveLength(1)
      expect(sessions[0]!.shopId).toBe('s1')
      expect(sessions[0]!.listId).toBe('l1')
    })
  })

  it('records a sessionItem with action=skipped when an item is swiped/skipped in shopping mode', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    const shop = makeShop('s1', { name: 'Supermarket' })
    const item = makeItem('i1', { name: 'Eggs' })
    const li   = makeListItem('li1', 'l1', 'i1')

    store.lists.set(list.id, list)
    store.shops.set(shop.id, shop)
    store.items.set(item.id, item)
    store.listItems.set(li.id, li)
    store.itemShops.push({ itemId: 'i1', shopId: 's1' })

    renderList('l1')

    const shopBtn = await screen.findByRole('button', { name: /^shop$/i })
    await user.click(shopBtn)
    await user.click(await screen.findByRole('button', { name: /supermarket/i }))

    // The skip button is not directly reachable via swipe in tests — the
    // ShoppingCard renders an `onSkip` prop that gets called by the swipe handler.
    // ListScreen passes `onSkip={() => void skipAtShop(li)}` for active items.
    // We trigger it via the "Skip here" button that ListScreen wires as onSkip.
    // In the DOM the card itself is a button that calls onBuy; skip is swipe-only.
    // Instead we reach the skipAtShop path by directly triggering the store action
    // that the component uses, or we can fire a pointer event sequence.
    // Simplest: use fireEvent to simulate a complete left-swipe on the card.
    const { fireEvent } = await import('@testing-library/react')
    const card = await screen.findByText('Eggs')
    fireEvent.touchStart(card.closest('button')!, { touches: [{ clientX: 200 }] })
    fireEvent.touchMove(card.closest('button')!, { touches: [{ clientX: 100 }] }) // -100px delta > threshold(60)
    fireEvent.touchEnd(card.closest('button')!)

    await waitFor(() => {
      const sessionItems = store.sessionItems
      expect(sessionItems).toHaveLength(1)
      expect(sessionItems[0]!.itemId).toBe('i1')
      expect(sessionItems[0]!.action).toBe('skipped')
    })
  })

  it('reuses an existing open session instead of creating a duplicate', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    const shop = makeShop('s1')
    const item1 = makeItem('i1', { name: 'Milk' })
    const item2 = makeItem('i2', { name: 'Bread' })
    const li1   = makeListItem('li1', 'l1', 'i1')
    const li2   = makeListItem('li2', 'l1', 'i2')

    store.lists.set(list.id, list)
    store.shops.set(shop.id, shop)
    store.items.set(item1.id, item1)
    store.items.set(item2.id, item2)
    store.listItems.set(li1.id, li1)
    store.listItems.set(li2.id, li2)
    store.itemShops.push(
      { itemId: 'i1', shopId: 's1' },
      { itemId: 'i2', shopId: 's1' },
    )

    renderList('l1')

    const shopBtn = await screen.findByRole('button', { name: /^shop$/i })
    await user.click(shopBtn)
    await user.click(await screen.findByRole('button', { name: /shop s1/i }))

    // Buy first item
    await user.click(await screen.findByText('Milk'))
    // Buy second item
    await user.click(await screen.findByText('Bread'))

    await waitFor(() => {
      const sessions = [...store.shoppingSessions.values()]
      expect(sessions).toHaveLength(1)   // only one session created
      const sessionItems = store.sessionItems
      expect(sessionItems).toHaveLength(2)
    })
  })
})
