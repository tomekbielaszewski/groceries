import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ItemCard from './ItemCard'
import type { ItemWithDetails, ListItemWithItem } from '../types'

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeItem = (overrides?: Partial<ItemWithDetails>): ItemWithDetails => ({
  id: 'item-1',
  name: 'Whole Milk',
  version: 1,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  shops: [],
  tags: [],
  frequency: 0,
  ...overrides,
})

const makeListItem = (overrides?: Partial<ListItemWithItem>): ListItemWithItem => ({
  id: 'li-1',
  listId: 'list-1',
  itemId: 'item-1',
  state: 'active',
  version: 1,
  addedAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  item: makeItem(),
  skippedShopIds: [],
  ...overrides,
})

const shops = [
  { id: 'shop-1', name: 'Lidl', color: '#ff0000' },
  { id: 'shop-2', name: 'Aldi', color: '#00ff00' },
]

// ── Repository mode ───────────────────────────────────────────────────────────

describe('ItemCard — repository mode', () => {
  it('renders item name', () => {
    render(<ItemCard mode="repository" item={makeItem()} />)
    expect(screen.getByText('Whole Milk')).toBeInTheDocument()
  })

  it('renders shop dots for each shop', () => {
    const item = makeItem({
      shops: [
        { id: 'shop-1', name: 'Lidl', color: '#ff0000', version: 1, updatedAt: '2024-01-01T00:00:00.000Z' },
        { id: 'shop-2', name: 'Aldi', color: '#00ff00', version: 1, updatedAt: '2024-01-01T00:00:00.000Z' },
      ],
    })
    const { container } = render(<ItemCard mode="repository" item={item} />)
    // ShopDots render as spans with title attribute matching shop name
    const dots = container.querySelectorAll('[title="Lidl"], [title="Aldi"]')
    expect(dots).toHaveLength(2)
  })

  it('renders frequency count when frequency > 0', () => {
    render(<ItemCard mode="repository" item={makeItem({ frequency: 7 })} />)
    expect(screen.getByText('7×')).toBeInTheDocument()
  })

  it('does not render frequency when frequency is 0', () => {
    render(<ItemCard mode="repository" item={makeItem({ frequency: 0 })} />)
    expect(screen.queryByText(/×/)).not.toBeInTheDocument()
  })

  it('calls onClick when card is clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<ItemCard mode="repository" item={makeItem()} onClick={onClick} />)
    await user.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('renders unit when provided', () => {
    render(<ItemCard mode="repository" item={makeItem({ unit: 'kg' })} />)
    expect(screen.getByText('kg')).toBeInTheDocument()
  })

  it('renders tag badges', () => {
    const item = makeItem({ tags: [{ id: 'tag-1', name: 'dairy' }] })
    render(<ItemCard mode="repository" item={item} />)
    expect(screen.getByText('dairy')).toBeInTheDocument()
  })
})

// ── Browse mode ───────────────────────────────────────────────────────────────

describe('ItemCard — browse mode', () => {
  it('renders item name', () => {
    render(
      <ItemCard mode="browse" listItem={makeListItem()} shops={shops} onRemove={() => {}} onQuantityChange={() => {}} />
    )
    expect(screen.getByText('Whole Milk')).toBeInTheDocument()
  })

  it('renders unchecked state indicator when state is active', () => {
    const { container } = render(
      <ItemCard mode="browse" listItem={makeListItem({ state: 'active' })} shops={shops} onRemove={() => {}} onQuantityChange={() => {}} />
    )
    const indicator = container.querySelector('.rounded.border.flex-shrink-0')
    expect(indicator).toBeInTheDocument()
    expect(indicator).not.toHaveClass('bg-blue-600')
  })

  it('renders checked state indicator when state is bought', () => {
    const { container } = render(
      <ItemCard mode="browse" listItem={makeListItem({ state: 'bought' })} shops={shops} onRemove={() => {}} onQuantityChange={() => {}} />
    )
    const indicator = container.querySelector('.rounded.border.flex-shrink-0')
    expect(indicator).toHaveClass('bg-blue-600')
  })

  it('renders faded name when state is bought', () => {
    render(
      <ItemCard mode="browse" listItem={makeListItem({ state: 'bought' })} shops={shops} onRemove={() => {}} onQuantityChange={() => {}} />
    )
    const nameEl = screen.getByText('Whole Milk')
    expect(nameEl).not.toHaveClass('line-through')
    expect(nameEl).toHaveClass('text-gray-500')
  })

  it('name is not faded when state is active', () => {
    render(
      <ItemCard mode="browse" listItem={makeListItem({ state: 'active' })} shops={shops} onRemove={() => {}} onQuantityChange={() => {}} />
    )
    const nameEl = screen.getByText('Whole Milk')
    expect(nameEl).not.toHaveClass('line-through')
  })

  it('calls onRemove when × button is clicked', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(
      <ItemCard mode="browse" listItem={makeListItem()} shops={shops} onRemove={onRemove} onQuantityChange={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: 'Remove from list' }))
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('shop dots show skipped state correctly', () => {
    const item = makeItem({
      shops: [
        { id: 'shop-1', name: 'Lidl', color: '#ff0000', version: 1, updatedAt: '2024-01-01T00:00:00.000Z' },
        { id: 'shop-2', name: 'Aldi', color: '#00ff00', version: 1, updatedAt: '2024-01-01T00:00:00.000Z' },
      ],
    })
    const listItem = makeListItem({ item, skippedShopIds: ['shop-1'] })

    const { container } = render(
      <ItemCard mode="browse" listItem={listItem} shops={shops} onRemove={() => {}} onQuantityChange={() => {}} />
    )

    // shop-1 is skipped: should have opacity 0.4 and no background color
    const skippedDot = container.querySelector('[title="Lidl"]') as HTMLElement
    expect(skippedDot.style.opacity).toBe('0.4')
    expect(skippedDot.style.backgroundColor).toBe('')

    // shop-2 is not skipped: should have background color and full opacity
    const normalDot = container.querySelector('[title="Aldi"]') as HTMLElement
    expect(normalDot.style.opacity).toBe('1')
    expect(normalDot.style.backgroundColor).toBe('#00ff00')
  })
})

// ── Browse mode — sub-1 quantity steps for kg and l ───────────────────────────

describe('ItemCard — browse mode — sub-1 quantity steps', () => {
  const renderBrowse = (qty: number | undefined, unit: string, onQuantityChange = vi.fn()) => {
    const listItem = makeListItem({ quantity: qty, unit })
    render(
      <ItemCard
        mode="browse"
        listItem={listItem}
        shops={shops}
               onRemove={() => {}}
        onQuantityChange={onQuantityChange}
      />
    )
    return { onQuantityChange }
  }

  it('decrement from 1kg goes to 0.75', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(1, 'kg')
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(0.75, 'kg')
  })

  it('decrement from 0.75kg goes to 0.5', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(0.75, 'kg')
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(0.5, 'kg')
  })

  it('decrement from 0.5kg goes to 0.25', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(0.5, 'kg')
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(0.25, 'kg')
  })

  it('decrement from 0.25kg goes to 0.1', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(0.25, 'kg')
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(0.1, 'kg')
  })

  it('decrement from 0.1kg does nothing (minimum)', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(0.1, 'kg')
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(onQuantityChange).not.toHaveBeenCalled()
  })

  it('decrement from 1l goes to 0.75', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(1, 'l')
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(0.75, 'l')
  })

  it('decrement from 0.1l does nothing (minimum)', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(0.1, 'l')
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(onQuantityChange).not.toHaveBeenCalled()
  })

  it('increment from 0.1kg goes to 0.25', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(0.1, 'kg')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(0.25, 'kg')
  })

  it('increment from 0.25kg goes to 0.5', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(0.25, 'kg')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(0.5, 'kg')
  })

  it('increment from 0.5kg goes to 0.75', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(0.5, 'kg')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(0.75, 'kg')
  })

  it('increment from 0.75kg goes to 1', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(0.75, 'kg')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(1, 'kg')
  })

  it('decrement from 2kg still goes to 1 (normal integer step)', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(2, 'kg')
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(1, 'kg')
  })

  it('non-sub-one unit (pcs) clears when decrementing from 1', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(1, 'pcs')
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(undefined, 'pcs')
  })
})

// ── Browse mode — g and ml quantity steps ─────────────────────────────────────

describe('ItemCard — browse mode — g and ml quantity steps', () => {
  const renderBrowse = (qty: number | undefined, unit: string, onQuantityChange = vi.fn()) => {
    const listItem = makeListItem({ quantity: qty, unit })
    render(
      <ItemCard
        mode="browse"
        listItem={listItem}
        shops={shops}
               onRemove={() => {}}
        onQuantityChange={onQuantityChange}
      />
    )
    return { onQuantityChange }
  }

  it('increment from 100g goes to 150g (50g step)', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(100, 'g')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(150, 'g')
  })

  it('decrement from 150g goes to 100g (50g step)', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(150, 'g')
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(100, 'g')
  })

  it('decrement from 100g goes to 75g', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(100, 'g')
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(75, 'g')
  })

  it('decrement from 75g goes to 50g', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(75, 'g')
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(50, 'g')
  })

  it('decrement from 50g goes to 25g', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(50, 'g')
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(25, 'g')
  })

  it('decrement from 25g goes to 10g', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(25, 'g')
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(10, 'g')
  })

  it('decrement from 10g does nothing (minimum)', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(10, 'g')
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(onQuantityChange).not.toHaveBeenCalled()
  })

  it('increment from 10g goes to 25g', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(10, 'g')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(25, 'g')
  })

  it('increment from 25g goes to 50g', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(25, 'g')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(50, 'g')
  })

  it('increment from 50g goes to 75g', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(50, 'g')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(75, 'g')
  })

  it('increment from 75g goes to 100g', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(75, 'g')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(100, 'g')
  })

  it('increment from 100g goes to 150g (back to 50g steps)', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(100, 'g')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(150, 'g')
  })

  it('decrement from 100ml goes to 75ml', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(100, 'ml')
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(75, 'ml')
  })

  it('decrement from 10ml does nothing (minimum)', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(10, 'ml')
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(onQuantityChange).not.toHaveBeenCalled()
  })

  it('increment from 200ml goes to 250ml (50ml step)', async () => {
    const user = userEvent.setup()
    const { onQuantityChange } = renderBrowse(200, 'ml')
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(onQuantityChange).toHaveBeenCalledWith(250, 'ml')
  })
})

// ── Shopping mode ─────────────────────────────────────────────────────────────

describe('ItemCard — shopping mode', () => {
  const renderShopping = (overrides?: Partial<ListItemWithItem>, handlers?: {
    onBuy?: () => void
    onSkip?: () => void
    onUndo?: () => void
  }) => {
    const listItem = makeListItem(overrides)
    return render(
      <ItemCard
        mode="shopping"
        listItem={listItem}
        activeShopId="shop-1"
        onBuy={handlers?.onBuy ?? vi.fn()}
        onSkip={handlers?.onSkip ?? vi.fn()}
        onUndo={handlers?.onUndo ?? vi.fn()}
      />
    )
  }

  it('renders item name', () => {
    renderShopping()
    expect(screen.getByText('Whole Milk')).toBeInTheDocument()
  })

  it('calls onBuy when tapped (non-swipe click) on active item', async () => {
    const user = userEvent.setup()
    const onBuy = vi.fn()
    renderShopping({ state: 'active' }, { onBuy })
    // The button is the swipeable card itself
    const btn = screen.getByRole('button')
    await user.click(btn)
    expect(onBuy).toHaveBeenCalledOnce()
  })

  it('renders crossed-out item name when state is bought', () => {
    renderShopping({ state: 'bought' })
    const nameEl = screen.getByText('Whole Milk')
    expect(nameEl).toHaveClass('line-through')
  })

  it('calls onUndo when bought item is clicked', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn()
    renderShopping({ state: 'bought' }, { onUndo })
    // The bought state renders a button with the name
    await user.click(screen.getByRole('button'))
    expect(onUndo).toHaveBeenCalledOnce()
  })

  it('active item shows a circular indicator (not a checkbox)', () => {
    const { container } = renderShopping({ state: 'active' })
    const roundEl = container.querySelector('.rounded-full.border-2')
    expect(roundEl).toBeInTheDocument()
  })

  it('renders shop dots for each shop on active item', () => {
    const item = makeItem({
      shops: [
        { id: 'shop-1', name: 'Lidl', color: '#ff0000', version: 1, updatedAt: '2024-01-01T00:00:00.000Z' },
      ],
    })
    const { container } = renderShopping({ item, state: 'active' })
    // ShopDot rendered for the shop
    const dots = container.querySelectorAll('.rounded-full.flex-shrink-0')
    // At least one dot for the shop (the circular indicator does not have flex-shrink-0)
    expect(dots.length).toBeGreaterThan(0)
  })
})
