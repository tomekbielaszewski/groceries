import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ItemDetailScreen from './ItemDetailScreen'
import { db } from '../db/schema'

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

beforeEach(async () => {
  await db.transaction('rw', [db.tags, db.items, db.itemTags, db.shops, db.itemShops, db.lists, db.listItems, db.listItemSkippedShops, db.shoppingSessions, db.sessionItems, db.pendingSyncIds], async () => {
    await Promise.all([
      db.tags.clear(),
      db.items.clear(),
      db.itemTags.clear(),
      db.shops.clear(),
      db.itemShops.clear(),
      db.lists.clear(),
      db.listItems.clear(),
      db.listItemSkippedShops.clear(),
      db.shoppingSessions.clear(),
      db.sessionItems.clear(),
      db.pendingSyncIds.clear(),
    ])
  })
})

describe('ItemDetailScreen — tag filtering', () => {
  it('shows all existing tags when the input is empty', async () => {
    await db.tags.bulkAdd([
      { id: 't1', name: 'dairy' },
      { id: 't2', name: 'frozen' },
      { id: 't3', name: 'drinks' },
    ])

    renderNewItem()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ dairy' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '+ frozen' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '+ drinks' })).toBeInTheDocument()
    })
  })

  it('filters the tag list as the user types', async () => {
    await db.tags.bulkAdd([
      { id: 't1', name: 'dairy' },
      { id: 't2', name: 'frozen' },
      { id: 't3', name: 'drinks' },
    ])

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
    await db.tags.bulkAdd([
      { id: 't1', name: 'dairy' },
      { id: 't2', name: 'frozen' },
    ])

    const user = userEvent.setup()
    renderNewItem()

    const input = await screen.findByPlaceholderText('Add tag…')
    await user.type(input, 'xyz')

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^\+ / })).not.toBeInTheDocument()
    })
  })

  it('clicking a tag from the list adds it to selected tags', async () => {
    await db.tags.bulkAdd([
      { id: 't1', name: 'dairy' },
      { id: 't2', name: 'frozen' },
    ])

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
    await db.tags.bulkAdd([
      { id: 't1', name: 'dairy' },
      { id: 't2', name: 'frozen' },
    ])

    const user = userEvent.setup()
    renderNewItem()

    const dairyBtn = await screen.findByRole('button', { name: '+ dairy' })
    await user.click(dairyBtn)

    await waitFor(() => {
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
    await db.tags.add({ id: 't1', name: 'dairy' })

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
// purchase history table
// ---------------------------------------------------------------------------

const renderItem = (id: string) =>
  render(
    <MemoryRouter initialEntries={[`/item/${id}`]}>
      <Routes>
        <Route path="/item/:id" element={<ItemDetailScreen />} />
      </Routes>
    </MemoryRouter>
  )

describe('ItemDetailScreen — purchase history table', () => {
  it('shows the shop name in the history table for each session item', async () => {
    const now = new Date().toISOString()

    await db.shops.add({ id: 's1', name: 'Lidl', color: '#ff0000', version: 1, updatedAt: now })
    await db.items.add({ id: 'i1', name: 'Milk', version: 1, createdAt: now, updatedAt: now })
    await db.shoppingSessions.add({ id: 'sess1', listId: 'l1', shopId: 's1', startedAt: now, version: 1 })
    await db.sessionItems.add({ id: 'si1', sessionId: 'sess1', itemId: 'i1', action: 'skipped', at: now })

    renderItem('i1')

    await waitFor(() => {
      expect(screen.getByText('Lidl')).toBeInTheDocument()
    })
  })

  it('shows the shop column header in the history table', async () => {
    const now = new Date().toISOString()

    await db.shops.add({ id: 's1', name: 'Aldi', color: '#0000ff', version: 1, updatedAt: now })
    await db.items.add({ id: 'i1', name: 'Bread', version: 1, createdAt: now, updatedAt: now })
    await db.shoppingSessions.add({ id: 'sess1', listId: 'l1', shopId: 's1', startedAt: now, version: 1 })
    await db.sessionItems.add({ id: 'si1', sessionId: 'sess1', itemId: 'i1', action: 'bought', at: now })

    renderItem('i1')

    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: 'Shop' })).toBeInTheDocument()
    })
  })
})
