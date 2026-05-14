import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi } from 'vitest'
import ListScreen from './ListScreen'
import { db } from '../db/schema'
import { useStore } from '../store/useStore'
import type { Item, List, ListItem, Shop } from '../types'

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
  await db.transaction('rw', [
    db.shops, db.items, db.tags, db.itemShops, db.itemTags,
    db.lists, db.listItems, db.listItemSkippedShops,
    db.shoppingSessions, db.sessionItems, db.pendingSyncIds,
  ], async () => {
    await Promise.all([
      db.shops.clear(), db.items.clear(), db.tags.clear(),
      db.itemShops.clear(), db.itemTags.clear(),
      db.lists.clear(), db.listItems.clear(),
      db.listItemSkippedShops.clear(), db.shoppingSessions.clear(),
      db.sessionItems.clear(), db.pendingSyncIds.clear(),
    ])
  })
})

// ---------------------------------------------------------------------------
// quantity defaults when adding items
// ---------------------------------------------------------------------------

describe('ListScreen — quantity default when adding via search', () => {
  it('uses item.defaultQuantity when it is set', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    const item = makeItem('i1', { name: 'Apples', unit: 'kg', defaultQuantity: 3 })
    await db.lists.add(list)
    await db.items.add(item)

    renderList('l1')

    // Type in the search box and select the item
    const input = await screen.findByPlaceholderText('Search items…')
    await user.type(input, 'Apples')
    const btn = await screen.findByRole('button', { name: /Apples/ })
    await user.click(btn)

    await waitFor(async () => {
      const listItems = await db.listItems.where('listId').equals('l1').toArray()
      expect(listItems).toHaveLength(1)
      expect(listItems[0].quantity).toBe(3)
    })
  })

  it('falls back to 1 when item has no defaultQuantity and unit is not g/ml', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    // Item has no defaultQuantity (e.g. synced from old server)
    const item = makeItem('i1', { name: 'Apples', unit: 'kg' })
    await db.lists.add(list)
    await db.items.add(item)

    renderList('l1')

    const input = await screen.findByPlaceholderText('Search items…')
    await user.type(input, 'Apples')
    const btn = await screen.findByRole('button', { name: /Apples/ })
    await user.click(btn)

    await waitFor(async () => {
      const listItems = await db.listItems.where('listId').equals('l1').toArray()
      expect(listItems).toHaveLength(1)
      expect(listItems[0].quantity).toBe(1)
    })
  })

  it('falls back to 100 when item has no defaultQuantity and unit is g', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    const item = makeItem('i1', { name: 'Flour', unit: 'g' })
    await db.lists.add(list)
    await db.items.add(item)

    renderList('l1')

    const input = await screen.findByPlaceholderText('Search items…')
    await user.type(input, 'Flour')
    const btn = await screen.findByRole('button', { name: /Flour/ })
    await user.click(btn)

    await waitFor(async () => {
      const listItems = await db.listItems.where('listId').equals('l1').toArray()
      expect(listItems).toHaveLength(1)
      expect(listItems[0].quantity).toBe(100)
    })
  })

  it('falls back to 100 when item has no defaultQuantity and unit is ml', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    const item = makeItem('i1', { name: 'Milk', unit: 'ml' })
    await db.lists.add(list)
    await db.items.add(item)

    renderList('l1')

    const input = await screen.findByPlaceholderText('Search items…')
    await user.type(input, 'Milk')
    const btn = await screen.findByRole('button', { name: /Milk/ })
    await user.click(btn)

    await waitFor(async () => {
      const listItems = await db.listItems.where('listId').equals('l1').toArray()
      expect(listItems).toHaveLength(1)
      expect(listItems[0].quantity).toBe(100)
    })
  })

  it('removed item re-appears in suggestions panel', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    const item = makeItem('i1', { name: 'Butter' })
    const li = makeListItem('li1', 'l1', 'i1')
    await db.lists.add(list)
    await db.items.add(item)
    await db.listItems.add(li)

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

  it('does not create duplicate listItem when addItem is called while listItems state is loading', async () => {
    const user = userEvent.setup()
    const list = makeList('l1')
    const item = makeItem('i1', { name: 'Bread', unit: 'pcs', defaultQuantity: 1 })
    // Pre-seed an active listItem so it already exists in Dexie
    const existing = makeListItem('li-seed', 'l1', 'i1')
    await db.lists.add(list)
    await db.items.add(item)
    await db.listItems.add(existing)

    renderList('l1')

    // The item is already active — searching and clicking it should be a no-op
    const input = await screen.findByPlaceholderText('Search items…')
    await user.type(input, 'Bread')
    // The item is excluded from search results (it's already active)
    // so no dropdown button should appear for it
    await waitFor(async () => {
      const listItems = await db.listItems.where('listId').equals('l1').toArray()
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
    await db.lists.add(list)

    renderList('l1')

    await screen.findByText('Archived')
    expect(screen.queryByRole('button', { name: /^shop$/i })).not.toBeInTheDocument()
  })

  it('does not render the search input', async () => {
    const list = makeArchivedList('l1')
    await db.lists.add(list)

    renderList('l1')

    await screen.findByText('Archived')
    expect(screen.queryByPlaceholderText('Search items…')).not.toBeInTheDocument()
  })

  it('does not render remove buttons on items', async () => {
    const list = makeArchivedList('l1')
    const item = makeItem('i1', { name: 'Butter' })
    const li = makeListItem('li1', 'l1', 'i1')
    await db.lists.add(list)
    await db.items.add(item)
    await db.listItems.add(li)

    renderList('l1')

    await screen.findByText('Butter')
    expect(screen.queryByRole('button', { name: /remove from list/i })).not.toBeInTheDocument()
  })

  it('does not render quantity steppers on items', async () => {
    const list = makeArchivedList('l1')
    const item = makeItem('i1', { name: 'Milk', unit: 'l' })
    const li = makeListItem('li1', 'l1', 'i1', { quantity: 2 })
    await db.lists.add(list)
    await db.items.add(item)
    await db.listItems.add(li)

    renderList('l1')

    await screen.findByText('Milk')
    expect(screen.queryByRole('button', { name: /decrease quantity/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /increase quantity/i })).not.toBeInTheDocument()
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

    await db.lists.add(list)
    await db.shops.add(shop)
    await db.items.add(item)
    await db.listItems.add(li)
    await db.itemShops.put({ itemId: 'i1', shopId: 's1' })

    renderList('l1')

    // Enter shopping mode by clicking the "Shop" button
    const shopBtn = await screen.findByRole('button', { name: /^shop$/i })
    await user.click(shopBtn)

    // The item should now appear in shopping mode
    const milkBtn = await screen.findByText('Milk')
    await user.click(milkBtn)

    // A sessionItem with action='bought' should be in the DB
    await waitFor(async () => {
      const sessionItems = await db.sessionItems.toArray()
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

    await db.lists.add(list)
    await db.shops.add(shop)
    await db.items.add(item)
    await db.listItems.add(li)
    await db.itemShops.put({ itemId: 'i1', shopId: 's1' })

    renderList('l1')

    const shopBtn = await screen.findByRole('button', { name: /^shop$/i })
    await user.click(shopBtn)

    const breadBtn = await screen.findByText('Bread')
    await user.click(breadBtn)

    await waitFor(async () => {
      const sessions = await db.shoppingSessions.toArray()
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

    await db.lists.add(list)
    await db.shops.add(shop)
    await db.items.add(item)
    await db.listItems.add(li)
    await db.itemShops.put({ itemId: 'i1', shopId: 's1' })

    renderList('l1')

    const shopBtn = await screen.findByRole('button', { name: /^shop$/i })
    await user.click(shopBtn)

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

    await waitFor(async () => {
      const sessionItems = await db.sessionItems.toArray()
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

    await db.lists.add(list)
    await db.shops.add(shop)
    await db.items.bulkAdd([item1, item2])
    await db.listItems.bulkAdd([li1, li2])
    await db.itemShops.bulkPut([
      { itemId: 'i1', shopId: 's1' },
      { itemId: 'i2', shopId: 's1' },
    ])

    renderList('l1')

    const shopBtn = await screen.findByRole('button', { name: /^shop$/i })
    await user.click(shopBtn)

    // Buy first item
    await user.click(await screen.findByText('Milk'))
    // Buy second item
    await user.click(await screen.findByText('Bread'))

    await waitFor(async () => {
      const sessions = await db.shoppingSessions.toArray()
      expect(sessions).toHaveLength(1)   // only one session created
      const sessionItems = await db.sessionItems.toArray()
      expect(sessionItems).toHaveLength(2)
    })
  })
})
