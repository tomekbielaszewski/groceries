import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SearchInput from './SearchInput'
import type { ItemWithDetails } from '../types'

vi.mock('../api/client', () => ({
  apiClient: {
    getItemsWithDetails: vi.fn(),
  },
}))

import { apiClient } from '../api/client'

const makeItem = (overrides?: Partial<ItemWithDetails>): ItemWithDetails => ({
  id: 'item-1',
  name: 'Jabłka',
  version: 1,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  shops: [],
  tags: [],
  frequency: 3,
  ...overrides,
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SearchInput — Enter key behaviour', () => {
  beforeEach(() => {
    vi.mocked(apiClient.getItemsWithDetails).mockResolvedValue([makeItem()])
  })

  it('selects the top result on Enter when results exist (does NOT call onCreateNew)', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onCreateNew = vi.fn()

    render(
      <SearchInput onSelect={onSelect} onCreateNew={onCreateNew} />
    )

    const input = screen.getByPlaceholderText('Search items…')
    await user.type(input, 'jabl')

    // Wait for the suggestions dropdown to appear
    await waitFor(() => expect(screen.getByText('Jabłka')).toBeInTheDocument())

    await user.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith(makeItem())
    expect(onCreateNew).not.toHaveBeenCalled()
  })

  it('calls onCreateNew on Enter only when there are no results', async () => {
    vi.mocked(apiClient.getItemsWithDetails).mockResolvedValue([])
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onCreateNew = vi.fn()

    render(
      <SearchInput onSelect={onSelect} onCreateNew={onCreateNew} />
    )

    const input = screen.getByPlaceholderText('Search items…')
    await user.type(input, 'brandnewitem')

    await waitFor(() => expect(screen.getByText('+ Add "brandnewitem"')).toBeInTheDocument())

    await user.keyboard('{Enter}')

    expect(onCreateNew).toHaveBeenCalledOnce()
    expect(onCreateNew).toHaveBeenCalledWith('brandnewitem')
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('SearchInput — focus retention and clearing after selection', () => {
  beforeEach(() => {
    vi.mocked(apiClient.getItemsWithDetails).mockResolvedValue([makeItem()])
  })

  it('clears the search box and retains focus on the input after selecting a result', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <SearchInput onSelect={onSelect} onCreateNew={vi.fn()} />
    )

    const input = screen.getByPlaceholderText('Search items…') as HTMLInputElement
    await user.type(input, 'jabl')

    await waitFor(() => expect(screen.getByText('Jabłka')).toBeInTheDocument())

    await user.click(screen.getByText('Jabłka'))

    expect(onSelect).toHaveBeenCalledOnce()
    expect(input.value).toBe('')
    expect(input).toHaveFocus()
  })

  it('clears the search box and retains focus on the input after selecting via Enter', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <SearchInput onSelect={onSelect} onCreateNew={vi.fn()} />
    )

    const input = screen.getByPlaceholderText('Search items…') as HTMLInputElement
    await user.type(input, 'jabl')

    await waitFor(() => expect(screen.getByText('Jabłka')).toBeInTheDocument())

    await user.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledOnce()
    expect(input.value).toBe('')
    expect(input).toHaveFocus()
  })
})

describe('SearchInput — duplicate prevention when item is excluded (already on list)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.getItemsWithDetails).mockResolvedValue([makeItem({ id: 'ketchup-id', name: 'Ketchup' })])
  })

  it('does not show "+ Add" when an item with that exact name exists but is excluded', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onCreateNew = vi.fn()

    render(
      <SearchInput
        onSelect={onSelect}
        onCreateNew={onCreateNew}
        excludeIds={new Set(['ketchup-id'])}
      />
    )

    const input = screen.getByPlaceholderText('Search items…')
    await user.type(input, 'Ketchup')

    // Wait for the debounce to fire, then verify no duplicate button appears
    await waitFor(() => expect(vi.mocked(apiClient.getItemsWithDetails)).toHaveBeenCalled())
    expect(screen.queryByText('+ Add "Ketchup"')).not.toBeInTheDocument()
    expect(onCreateNew).not.toHaveBeenCalled()
  })

  it('does not trigger onCreateNew on Enter when excluded item has exact name match', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onCreateNew = vi.fn()

    render(
      <SearchInput
        onSelect={onSelect}
        onCreateNew={onCreateNew}
        excludeIds={new Set(['ketchup-id'])}
      />
    )

    const input = screen.getByPlaceholderText('Search items…')
    await user.type(input, 'Ketchup')
    // Wait for the debounce to fire and React to re-render with allResults populated
    await waitFor(() => expect(vi.mocked(apiClient.getItemsWithDetails)).toHaveBeenCalled())
    await user.keyboard('{Enter}')

    expect(onCreateNew).not.toHaveBeenCalled()
  })
})

describe('SearchInput — dropdown elevation styling', () => {
  beforeEach(() => {
    vi.mocked(apiClient.getItemsWithDetails).mockResolvedValue([makeItem()])
  })

  it('renders the dropdown container with role listbox after a query', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onCreateNew = vi.fn()

    render(
      <SearchInput onSelect={onSelect} onCreateNew={onCreateNew} />
    )

    const input = screen.getByPlaceholderText('Search items…')
    await user.type(input, 'jabl')

    const listbox = await screen.findByRole('listbox')
    expect(listbox).toBeInTheDocument()
  })

  it('gives the listbox a bg-elevated surface so it stands out from the page cards', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onCreateNew = vi.fn()

    render(
      <SearchInput onSelect={onSelect} onCreateNew={onCreateNew} />
    )

    const input = screen.getByPlaceholderText('Search items…')
    await user.type(input, 'jabl')

    const listbox = await screen.findByRole('listbox')
    expect(listbox).toHaveClass('bg-elevated')
  })

  it('gives the listbox a shadow-2xl drop shadow so it stands out from the page cards', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onCreateNew = vi.fn()

    render(
      <SearchInput onSelect={onSelect} onCreateNew={onCreateNew} />
    )

    const input = screen.getByPlaceholderText('Search items…')
    await user.type(input, 'jabl')

    const listbox = await screen.findByRole('listbox')
    expect(listbox).toHaveClass('shadow-2xl')
  })
})

describe('SearchInput — "+ One-time" action', () => {
  it('shows both "+ Add" and "+ One-time" for a non-matching name and clicking "+ One-time" calls onAddOneTime', async () => {
    vi.mocked(apiClient.getItemsWithDetails).mockResolvedValue([])
    const user = userEvent.setup()
    const onCreateNew = vi.fn()
    const onAddOneTime = vi.fn()

    render(
      <SearchInput onSelect={vi.fn()} onCreateNew={onCreateNew} onAddOneTime={onAddOneTime} />
    )

    const input = screen.getByPlaceholderText('Search items…')
    await user.type(input, 'brandnewitem')

    await waitFor(() => expect(screen.getByText('+ Add "brandnewitem"')).toBeInTheDocument())
    const oneTimeBtn = screen.getByText('+ One-time: "brandnewitem"')

    await user.click(oneTimeBtn)

    expect(onAddOneTime).toHaveBeenCalledOnce()
    expect(onAddOneTime).toHaveBeenCalledWith('brandnewitem')
    expect(onCreateNew).not.toHaveBeenCalled()
  })

  it('hides "+ One-time" when the typed name is in excludeOneTimeNames (but keeps "+ Add")', async () => {
    vi.mocked(apiClient.getItemsWithDetails).mockResolvedValue([])
    const user = userEvent.setup()
    const onAddOneTime = vi.fn()

    render(
      <SearchInput
        onSelect={vi.fn()}
        onCreateNew={vi.fn()}
        onAddOneTime={onAddOneTime}
        excludeOneTimeNames={new Set(['brandnewitem'])}
      />
    )

    const input = screen.getByPlaceholderText('Search items…')
    await user.type(input, 'brandnewitem')

    await waitFor(() => expect(screen.getByText('+ Add "brandnewitem"')).toBeInTheDocument())
    expect(screen.queryByText('+ One-time: "brandnewitem"')).not.toBeInTheDocument()
  })

  it('does not suppress "+ One-time" for other lists: only the passed excludeOneTimeNames set applies', async () => {
    vi.mocked(apiClient.getItemsWithDetails).mockResolvedValue([])
    const user = userEvent.setup()
    const onAddOneTime = vi.fn()

    // a different list has its own one-time names; this list's set does not
    // contain the typed name, so the action must remain available
    render(
      <SearchInput
        onSelect={vi.fn()}
        onCreateNew={vi.fn()}
        onAddOneTime={onAddOneTime}
        excludeOneTimeNames={new Set(['something-else'])}
      />
    )

    const input = screen.getByPlaceholderText('Search items…')
    await user.type(input, 'brandnewitem')

    await waitFor(() => expect(screen.getByText('+ Add "brandnewitem"')).toBeInTheDocument())
    expect(screen.getByText('+ One-time: "brandnewitem"')).toBeInTheDocument()
  })

  it('shows neither "+ Add" nor "+ One-time" when the typed name exactly matches a catalogue item', async () => {
    vi.mocked(apiClient.getItemsWithDetails).mockResolvedValue([makeItem()])
    const user = userEvent.setup()

    render(
      <SearchInput onSelect={vi.fn()} onCreateNew={vi.fn()} onAddOneTime={vi.fn()} />
    )

    const input = screen.getByPlaceholderText('Search items…')
    await user.type(input, 'Jabłka')

    await waitFor(() => expect(vi.mocked(apiClient.getItemsWithDetails)).toHaveBeenCalled())
    expect(screen.queryByText('+ Add "Jabłka"')).not.toBeInTheDocument()
    expect(screen.queryByText('+ One-time: "Jabłka"')).not.toBeInTheDocument()
  })
})
