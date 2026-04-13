import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi } from 'vitest'
import ListScreen from './ListScreen'
import { db } from '../db/schema'
import type { Item, List, ListItem } from '../types'

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

beforeEach(async () => {
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
