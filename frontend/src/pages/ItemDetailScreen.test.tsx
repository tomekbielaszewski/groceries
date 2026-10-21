import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ItemDetailScreen from './ItemDetailScreen'
import { apiClient } from '../api/client'
import type { Shop, Item, Tag, ListItem, ShoppingSession, SessionItem } from '../types'
import type { AppEvent } from '../types/event'

const store = apiClient as unknown as {
  shops: Map<string, Shop>
  items: Map<string, Item>
  tags: Map<string, Tag>
  listItems: Map<string, ListItem>
  shoppingSessions: Map<string, ShoppingSession>
  sessionItems: SessionItem[]
}

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

const renderNewItem = () =>
  render(
    <MemoryRouter initialEntries={['/item/new']}>
      <Routes>
        <Route path="/item/:id" element={<ItemDetailScreen />} />
      </Routes>
    </MemoryRouter>
  )

const renderItem = (id: string) =>
  render(
    <MemoryRouter initialEntries={[`/item/${id}`]}>
      <Routes>
        <Route path="/item/:id" element={<ItemDetailScreen />} />
      </Routes>
    </MemoryRouter>
  )

beforeEach(async () => {
  apiClient.reset()
})

describe('ItemDetailScreen — tag filtering', () => {
  it('shows all existing tags when the input is empty', async () => {
    const now = new Date().toISOString()
    store.tags.set('t1', { id: 't1', name: 'dairy' })
    store.tags.set('t2', { id: 't2', name: 'frozen' })
    store.tags.set('t3', { id: 't3', name: 'drinks' })

    renderNewItem()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ dairy' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '+ frozen' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '+ drinks' })).toBeInTheDocument()
    })
  })

  it('filters the tag list as the user types', async () => {
    store.tags.set('t1', { id: 't1', name: 'dairy' })
    store.tags.set('t2', { id: 't2', name: 'frozen' })
    store.tags.set('t3', { id: 't3', name: 'drinks' })

    const user = userEvent.setup()
    renderNewItem()

    const input = await screen.findByPlaceholderText('Add tag…')
    await user.type(input, 'dr')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ drinks' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '+ dairy' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '+ frozen' })).not.toBeInTheDocument()
    })
  })

  it('hides the list entirely when nothing matches', async () => {
    store.tags.set('t1', { id: 't1', name: 'dairy' })
    store.tags.set('t2', { id: 't2', name: 'frozen' })

    const user = userEvent.setup()
    renderNewItem()

    const input = await screen.findByPlaceholderText('Add tag…')
    await user.type(input, 'xyz')

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^\+ / })).not.toBeInTheDocument()
    })
  })

  it('clicking a tag from the list adds it to selected tags', async () => {
    store.tags.set('t1', { id: 't1', name: 'dairy' })
    store.tags.set('t2', { id: 't2', name: 'frozen' })

    const user = userEvent.setup()
    renderNewItem()

    const dairyBtn = await screen.findByRole('button', { name: '+ dairy' })
    await user.click(dairyBtn)

    await waitFor(() => {
      // Tag badge appears (selected state — rendered via TagBadge, no + prefix)
      expect(screen.getByText('dairy')).toBeInTheDocument()
      // The suggestion button is gone since the tag is now selected
      expect(screen.queryByRole('button', { name: '+ dairy' })).not.toBeInTheDocument()
    })
  })

  it('shows remaining unselected tags after one is selected', async () => {
    store.tags.set('t1', { id: 't1', name: 'dairy' })
    store.tags.set('t2', { id: 't2', name: 'frozen' })

    const user = userEvent.setup()
    renderNewItem()

    const dairyBtn = await screen.findByRole('button', { name: '+ dairy' })
    await user.click(dairyBtn)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ frozen' })).toBeInTheDocument()
    })
  })

  it('clears the search input when a matching tag suggestion is clicked', async () => {
    store.tags.set('t1', { id: 't1', name: 'dairy' })
    store.tags.set('t2', { id: 't2', name: 'drinks' })
    store.tags.set('t3', { id: 't3', name: 'frozen' })

    const user = userEvent.setup()
    renderNewItem()

    const input = await screen.findByPlaceholderText('Add tag…')
    await user.type(input, 'dr')

    const drinksBtn = await screen.findByRole('button', { name: '+ drinks' })
    await user.click(drinksBtn)

    await waitFor(() => {
      expect(input).toHaveValue('')
    })
  })

  it('refreshes the suggestion list to show all remaining tags after one is chosen', async () => {
    store.tags.set('t1', { id: 't1', name: 'dairy' })
    store.tags.set('t2', { id: 't2', name: 'drinks' })
    store.tags.set('t3', { id: 't3', name: 'frozen' })

    const user = userEvent.setup()
    renderNewItem()

    const input = await screen.findByPlaceholderText('Add tag…')
    await user.type(input, 'dr')

    const drinksBtn = await screen.findByRole('button', { name: '+ drinks' })
    await user.click(drinksBtn)

    await waitFor(() => {
      // The chosen tag is gone, but the remaining tags now show unfiltered
      expect(screen.queryByRole('button', { name: '+ drinks' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '+ dairy' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '+ frozen' })).toBeInTheDocument()
    })
  })

  it('pressing Enter adds a new tag and clears the input', async () => {
    const user = userEvent.setup()
    renderNewItem()

    const input = await screen.findByPlaceholderText('Add tag…')
    await user.type(input, 'spicy')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByText('spicy')).toBeInTheDocument()
      expect(input).toHaveValue('')
    })
  })

  it('pressing Enter on a typed value that matches an existing tag selects it', async () => {
    store.tags.set('t1', { id: 't1', name: 'dairy' })

    const user = userEvent.setup()
    renderNewItem()

    const input = await screen.findByPlaceholderText('Add tag…')
    await user.type(input, 'dairy')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      // dairy badge rendered, not in suggestion list anymore
      expect(screen.queryByRole('button', { name: '+ dairy' })).not.toBeInTheDocument()
      expect(screen.getByText('dairy')).toBeInTheDocument()
      expect(input).toHaveValue('')
    })
  })

  it('renders the tag suggestions in alphabetical order regardless of insertion order', async () => {
    // Deliberately inserted in non-alphabetical order
    store.tags.set('t1', { id: 't1', name: 'drinks' })
    store.tags.set('t2', { id: 't2', name: 'frozen' })
    store.tags.set('t3', { id: 't3', name: 'dairy' })

    renderNewItem()

    await waitFor(() => {
      const suggestionButtons = screen
        .getAllByRole('button', { name: /^\+ / })
        .map(b => b.textContent)
      expect(suggestionButtons).toEqual(['+ dairy', '+ drinks', '+ frozen'])
    })
  })
})

// ---------------------------------------------------------------------------
// shop selection — names must be visible
// ---------------------------------------------------------------------------

describe('ItemDetailScreen — shop selection', () => {
  it('shows the shop name as visible text next to the color dot', async () => {
    const now = new Date().toISOString()
    store.shops.set('s1', { id: 's1', name: 'Lidl', color: '#ff0000', version: 1, updatedAt: now })
    store.shops.set('s2', { id: 's2', name: 'Aldi', color: '#0000ff', version: 1, updatedAt: now })

    renderNewItem()

    await waitFor(() => {
      // The name must be rendered as real text — not just a hover tooltip (title attribute)
      expect(screen.getByText('Lidl')).toBeInTheDocument()
      expect(screen.getByText('Aldi')).toBeInTheDocument()
    })
  })

  it('shows the dot as a colored ring when the shop is not selected', async () => {
    const now = new Date().toISOString()
    store.shops.set('s1', { id: 's1', name: 'Lidl', color: '#ff0000', version: 1, updatedAt: now })

    renderNewItem()

    await waitFor(() => {
      const lidlBtn = screen.getByRole('button', { name: /lidl/i })
      const dot = lidlBtn.querySelector('span') as HTMLElement
      expect(dot.style.backgroundColor).toBe('')
      expect(dot.style.border).toContain('#ff0000')
      // the pill itself must not be filled with the shop color
      expect(lidlBtn.style.backgroundColor).toBe('')
    })
  })

  it('fills the dot with the shop color when the shop is selected', async () => {
    const now = new Date().toISOString()
    store.shops.set('s1', { id: 's1', name: 'Lidl', color: '#ff0000', version: 1, updatedAt: now })

    const user = userEvent.setup()
    renderNewItem()

    const lidlBtn = await screen.findByRole('button', { name: /lidl/i })
    const dot = lidlBtn.querySelector('span') as HTMLElement
    await user.click(lidlBtn)

    await waitFor(() => {
      expect(dot.style.backgroundColor).toBe('#ff0000')
      // the pill keeps a neutral background so the filled dot stays visible
      expect(lidlBtn.style.backgroundColor).toBe('')
      expect(lidlBtn.style.borderColor).toBe('#ff0000')
    })
  })
})

// ---------------------------------------------------------------------------
// default amount field — free editing
// ---------------------------------------------------------------------------

describe('ItemDetailScreen — default amount field', () => {
  it('allows the field to be fully cleared while typing', async () => {
    const user = userEvent.setup()
    renderNewItem()

    const amountInput = await screen.findByDisplayValue('1')
    await user.tripleClick(amountInput)
    await user.keyboard('{Backspace}')

    // After clearing, the field should be empty (not snapped back to 1)
    expect(amountInput).toHaveValue('')
  })

  it('shows no error when the field is empty', async () => {
    const user = userEvent.setup()
    renderNewItem()

    const amountInput = await screen.findByDisplayValue('1')
    await user.tripleClick(amountInput)
    await user.keyboard('{Backspace}')

    expect(screen.queryByText(/must be greater than/i)).not.toBeInTheDocument()
  })

  it('shows an error when the value is zero', async () => {
    const user = userEvent.setup()
    renderNewItem()

    const amountInput = await screen.findByDisplayValue('1')
    await user.clear(amountInput)
    await user.type(amountInput, '0')

    expect(await screen.findByText(/must be greater than/i)).toBeInTheDocument()
  })

  it('shows an error when the value is negative', async () => {
    const user = userEvent.setup()
    renderNewItem()

    const amountInput = await screen.findByDisplayValue('1')
    await user.clear(amountInput)
    await user.type(amountInput, '-3')

    expect(await screen.findByText(/must be greater than/i)).toBeInTheDocument()
  })

  it('disables the save button when the amount is invalid', async () => {
    const user = userEvent.setup()
    renderNewItem()

    // Fill in name and unit so the button would otherwise be enabled
    await user.type(await screen.findByPlaceholderText('e.g. Whole milk'), 'Milk')
    // unit defaults to 'pcs' for new items, so button should now be enabled
    const saveButton = screen.getByRole('button', { name: /add item/i })
    expect(saveButton).not.toBeDisabled()

    // Now set an invalid amount
    const amountInput = screen.getByDisplayValue('1')
    await user.clear(amountInput)
    await user.type(amountInput, '0')

    expect(saveButton).toBeDisabled()
  })

  it('shows a "not a valid number" error when non-numeric characters are typed', async () => {
    const user = userEvent.setup()
    renderNewItem()

    const amountInput = await screen.findByDisplayValue('1')
    await user.clear(amountInput)
    await user.type(amountInput, 'abc')

    expect(await screen.findByText(/not a valid number/i)).toBeInTheDocument()
    expect(screen.queryByText(/must be greater than/i)).not.toBeInTheDocument()
  })

  it('clears the error when a valid value is typed', async () => {
    const user = userEvent.setup()
    renderNewItem()

    const amountInput = await screen.findByDisplayValue('1')
    await user.clear(amountInput)
    await user.type(amountInput, '0')
    await screen.findByText(/must be greater than/i)

    await user.clear(amountInput)
    await user.type(amountInput, '5')

    expect(screen.queryByText(/must be greater than/i)).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// unit change cascades to list items
// ---------------------------------------------------------------------------

describe('ItemDetailScreen — unit change cascades to list items', () => {
  it('updates listItem unit when the item default unit is changed', async () => {
    const now = new Date().toISOString()
    const user = userEvent.setup()

    store.items.set('i1', { id: 'i1', name: 'Flour', unit: 'kg', defaultQuantity: 1, version: 1, createdAt: now, updatedAt: now })
    store.listItems.set('li1', { id: 'li1', listId: 'list1', itemId: 'i1', state: 'active', quantity: 1, unit: 'kg', version: 1, addedAt: now, updatedAt: now })

    renderItem('i1')

    // Wait for the item to load and the unit input to show 'kg'
    await waitFor(() => {
      expect((screen.getByPlaceholderText('or type custom…') as HTMLInputElement).value).toBe('kg')
    })

    // Change unit from 'kg' to 'g' by clicking the 'g' chip
    await user.click(screen.getByRole('button', { name: 'g' }))

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    // The listItem that snapshotted the old unit should be updated
    await waitFor(() => {
      const updated = store.listItems.get('li1')
      expect(updated?.unit).toBe('g')
    })
  })

  it('does not touch listItems whose unit was explicitly overridden', async () => {
    const now = new Date().toISOString()
    const user = userEvent.setup()

    store.items.set('i2', { id: 'i2', name: 'Sugar', unit: 'kg', defaultQuantity: 1, version: 1, createdAt: now, updatedAt: now })
    // This list item has a user-chosen unit 'bag' — different from item default 'kg'
    store.listItems.set('li2', { id: 'li2', listId: 'list1', itemId: 'i2', state: 'active', quantity: 1, unit: 'bag', version: 1, addedAt: now, updatedAt: now })

    renderItem('i2')

    await waitFor(() => {
      expect((screen.getByPlaceholderText('or type custom…') as HTMLInputElement).value).toBe('kg')
    })

    await user.click(screen.getByRole('button', { name: 'g' }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    // Unit 'bag' was not the old default, so it must not be changed
    await waitFor(() => {
      const untouched = store.listItems.get('li2')
      expect(untouched?.unit).toBe('bag')
    })
  })
})

// ---------------------------------------------------------------------------
// purchase history table
// ---------------------------------------------------------------------------

describe('ItemDetailScreen — purchase history table', () => {
  it('shows the shop name in the history table for each session item', async () => {
    const now = new Date().toISOString()

    store.shops.set('s1', { id: 's1', name: 'Lidl', color: '#ff0000', version: 1, updatedAt: now })
    store.items.set('i1', { id: 'i1', name: 'Milk', version: 1, createdAt: now, updatedAt: now })
    store.shoppingSessions.set('sess1', { id: 'sess1', listId: 'l1', shopId: 's1', startedAt: now, version: 1 })
    store.sessionItems.push({ id: 'si1', sessionId: 'sess1', itemId: 'i1', action: 'skipped', at: now })

    renderItem('i1')

    await waitFor(() => {
      expect(within(screen.getByRole('table')).getByText('Lidl')).toBeInTheDocument()
    })
  })

  it('shows the shop column header in the history table', async () => {
    const now = new Date().toISOString()

    store.shops.set('s1', { id: 's1', name: 'Aldi', color: '#0000ff', version: 1, updatedAt: now })
    store.items.set('i1', { id: 'i1', name: 'Bread', version: 1, createdAt: now, updatedAt: now })
    store.shoppingSessions.set('sess1', { id: 'sess1', listId: 'l1', shopId: 's1', startedAt: now, version: 1 })
    store.sessionItems.push({ id: 'si1', sessionId: 'sess1', itemId: 'i1', action: 'bought', at: now })

    renderItem('i1')

    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: 'Shop' })).toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------
// one-time item toggle (new item form only)
// ---------------------------------------------------------------------------

describe('ItemDetailScreen — one-time item toggle', () => {
  const now = new Date().toISOString()

  const renderOneTimeNewItem = (search = '') =>
    render(
      <MemoryRouter initialEntries={[`/item/new?oneTime=1${search}`]}>
        <Routes>
          <Route path="/item/:id" element={<ItemDetailScreen />} />
        </Routes>
      </MemoryRouter>
    )

  it('pre-checks the toggle when the URL has oneTime=1 and saves via OneTimeItemCreated with the selected shop', async () => {
    store.shops.set('s1', { id: 's1', name: 'Lidl', color: '#ff0000', version: 1, updatedAt: now })

    const user = userEvent.setup()
    renderOneTimeNewItem()

    const toggle = await screen.findByRole('checkbox', { name: /one-time item/i })
    expect(toggle).toBeChecked()

    await user.type(await screen.findByPlaceholderText('e.g. Whole milk'), 'Special Cheese')
    await user.click(await screen.findByRole('button', { name: /lidl/i }))

    const events: AppEvent[] = []
    const unsubscribe = apiClient.subscribe(e => events.push(e))
    await user.click(screen.getByRole('button', { name: /add item/i }))
    unsubscribe()

    const types = events.map(e => e.type)
    expect(types[0]).toBe('OneTimeItemCreated')
    expect(types).toContain('ShopAssignedToItem')
    expect(types).not.toContain('ItemCreated')
  })

  it('adds the one-time item to the list via addListItem when listId is present', async () => {
    store.shops.set('s1', { id: 's1', name: 'Lidl', color: '#ff0000', version: 1, updatedAt: now })

    const user = userEvent.setup()
    renderOneTimeNewItem('&listId=list-1')

    await user.type(await screen.findByPlaceholderText('e.g. Whole milk'), 'Special Cheese')

    const events: AppEvent[] = []
    const unsubscribe = apiClient.subscribe(e => events.push(e))
    await user.click(screen.getByRole('button', { name: /add item/i }))
    unsubscribe()

    const types = events.map(e => e.type)
    expect(types[0]).toBe('OneTimeItemCreated')
    const liEvent = events.find(e => e.type === 'ListItemAdded')
    expect(liEvent).toBeDefined()
    expect(liEvent!.payload.listId).toBe('list-1')
  })

  it('uses the normal createItem path when the toggle is off (default)', async () => {
    store.shops.set('s1', { id: 's1', name: 'Lidl', color: '#ff0000', version: 1, updatedAt: now })

    const user = userEvent.setup()
    renderNewItem()

    const toggle = await screen.findByRole('checkbox', { name: /one-time item/i })
    expect(toggle).not.toBeChecked()

    await user.type(await screen.findByPlaceholderText('e.g. Whole milk'), 'Milk')

    const events: AppEvent[] = []
    const unsubscribe = apiClient.subscribe(e => events.push(e))
    await user.click(screen.getByRole('button', { name: /add item/i }))
    unsubscribe()

    expect(events.map(e => e.type)[0]).toBe('ItemCreated')
    expect(events.some(e => e.type === 'OneTimeItemCreated')).toBe(false)
  })
})
