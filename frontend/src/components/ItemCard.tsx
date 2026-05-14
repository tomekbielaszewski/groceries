import { type FC, useRef, useState } from 'react'
import type { ItemWithDetails, ListItemWithItem } from '../types'
import ShopDot from './ShopDot'
import TagBadge from './TagBadge'

// ── Repository mode ──────────────────────────────────────────────────────────
interface RepositoryCardProps {
  mode: 'repository'
  item: ItemWithDetails
  onClick?: () => void
}

// ── Browse mode ──────────────────────────────────────────────────────────────
interface BrowseCardProps {
  mode: 'browse'
  listItem: ListItemWithItem
  shops: { id: string; name: string; color: string }[]
  onRemove?: () => void
  onQuantityChange?: (qty: number | undefined, unit: string | undefined) => void
  onClick?: () => void
}

// ── Shopping mode ────────────────────────────────────────────────────────────
interface ShoppingCardProps {
  mode: 'shopping'
  listItem: ListItemWithItem
  activeShopId: string
  onBuy: () => void
  onSkip: () => void
  onUndo: () => void
}

type ItemCardProps = RepositoryCardProps | BrowseCardProps | ShoppingCardProps

const ItemCard: FC<ItemCardProps> = (props) => {
  if (props.mode === 'repository') return <RepositoryCard {...props} />
  if (props.mode === 'browse')     return <BrowseCard {...props} />
  return <ShoppingCard {...props} />
}

// ── Repository ───────────────────────────────────────────────────────────────
const RepositoryCard: FC<RepositoryCardProps> = ({ item, onClick }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-3 px-3 py-2.5 bg-card border border-border rounded-md hover:border-gray-600 transition-colors text-left"
  >
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-100 truncate">{item.name}</span>
        {item.unit && <span className="text-xs text-gray-500">{item.unit}</span>}
      </div>
      {item.tags.length > 0 && (
        <div className="flex gap-1 mt-1 flex-wrap">
          {item.tags.map(t => <TagBadge key={t.id} name={t.name} />)}
        </div>
      )}
    </div>
    <div className="flex items-center gap-2 flex-shrink-0">
      <div className="flex gap-1">
        {item.shops.map(s => <ShopDot key={s.id} color={s.color} title={s.name} />)}
      </div>
      {item.frequency > 0 && (
        <span className="text-xs text-gray-500">{item.frequency}×</span>
      )}
    </div>
  </button>
)

// ── Browse ───────────────────────────────────────────────────────────────────

// kg / l: sub-one fractional steps, integer steps above
const KG_L_SUB_STEPS = [0.1, 0.25, 0.5, 0.75, 1]
const isKgL = (u: string) => u === 'kg' || u === 'l'
const findKgLIdx = (v: number) => KG_L_SUB_STEPS.findIndex(s => Math.abs(s - v) < 0.001)

// g / ml: sub-100 fine steps, 50-unit steps above
const G_ML_SUB_STEPS = [10, 25, 50, 75, 100]
const isGMl = (u: string) => u === 'g' || u === 'ml'
const findGMlIdx = (v: number) => G_ML_SUB_STEPS.findIndex(s => Math.abs(s - v) < 0.1)

const BrowseCard: FC<BrowseCardProps> = ({ listItem, onRemove, onQuantityChange, onClick }) => {
  const bought = listItem.state === 'bought'
  const unit = listItem.unit ?? listItem.item.unit ?? ''
  const qty  = listItem.quantity != null ? listItem.quantity : undefined

  const hasTags  = listItem.item.tags.length > 0
  const hasShops = listItem.item.shops.length > 0

  const increment = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isKgL(unit) && qty != null && qty < 1) {
      const idx = findKgLIdx(qty)
      onQuantityChange!(idx !== -1 && idx < KG_L_SUB_STEPS.length - 1 ? KG_L_SUB_STEPS[idx + 1] : 1, unit || undefined)
    } else if (isGMl(unit) && qty != null && qty < 100) {
      const idx = findGMlIdx(qty)
      onQuantityChange!(idx !== -1 && idx < G_ML_SUB_STEPS.length - 1 ? G_ML_SUB_STEPS[idx + 1] : 100, unit || undefined)
    } else if (isGMl(unit)) {
      onQuantityChange!((qty ?? 0) + 50, unit || undefined)
    } else {
      onQuantityChange!((qty ?? 0) + 1, unit || undefined)
    }
  }

  const decrement = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isKgL(unit) && qty != null && qty <= 1) {
      const idx = findKgLIdx(qty)
      if (idx <= 0) return
      onQuantityChange!(KG_L_SUB_STEPS[idx - 1], unit || undefined)
    } else if (isGMl(unit) && qty != null && qty <= 100) {
      const idx = findGMlIdx(qty)
      if (idx <= 0) return
      onQuantityChange!(G_ML_SUB_STEPS[idx - 1], unit || undefined)
    } else if (isGMl(unit) && qty != null) {
      onQuantityChange!(qty - 50, unit || undefined)
    } else if (qty == null || qty <= 1) {
      onQuantityChange!(undefined, unit || undefined)
    } else {
      onQuantityChange!(qty - 1, unit || undefined)
    }
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-2 bg-card border rounded-md transition-colors ${bought ? 'border-border opacity-60' : 'border-border'}`}>
      {/* State indicator (read-only) */}
      <div
        className={`w-5 h-5 rounded border flex-shrink-0 ${bought ? 'bg-blue-600 border-blue-600' : 'border-gray-500'}`}
      >
        {bought && <svg viewBox="0 0 12 12" fill="white" className="w-full h-full p-0.5"><path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>}
      </div>

      {/* Name + qty/unit stepper below */}
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onClick}>
        <span className={`text-sm font-medium truncate block ${bought ? 'text-gray-500' : 'text-gray-100'}`}>
          {listItem.item.name}
        </span>
        {!bought && onQuantityChange && (
          <div className="flex items-center gap-1 mt-0.5" onClick={e => e.stopPropagation()}>
            <button
              onClick={decrement}
              aria-label="Decrease quantity"
              className="w-7 h-7 flex items-center justify-center rounded border border-border text-gray-400 hover:text-gray-200 hover:border-gray-500 active:bg-border transition-colors text-base leading-none"
            >
              −
            </button>
            <span className="text-sm text-gray-300 min-w-[1.75rem] text-center tabular-nums">
              {qty ?? '–'}
            </span>
            <button
              onClick={increment}
              aria-label="Increase quantity"
              className="w-7 h-7 flex items-center justify-center rounded border border-border text-gray-400 hover:text-gray-200 hover:border-gray-500 active:bg-border transition-colors text-base leading-none"
            >
              +
            </button>
            {unit && <span className="text-xs text-gray-500 ml-1">{unit}</span>}
          </div>
        )}
        {!bought && !onQuantityChange && unit && (
          <span className="text-xs text-gray-500 mt-0.5">{qty != null ? `${qty} ${unit}` : unit}</span>
        )}
      </div>

      {/* Tags (top) + shop dots (bottom), right-aligned column */}
      {(hasTags || hasShops) && (
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {hasTags && (
            <div className="flex gap-1 flex-wrap justify-end">
              {listItem.item.tags.map(t => <TagBadge key={t.id} name={t.name} />)}
            </div>
          )}
          {hasShops && (
            <div className="flex gap-1">
              {listItem.item.shops.map(s => (
                <ShopDot
                  key={s.id}
                  color={s.color}
                  skipped={listItem.skippedShopIds.includes(s.id)}
                  title={s.name}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Remove */}
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label="Remove from list"
          className="text-gray-600 hover:text-red-400 transition-colors text-lg leading-none flex-shrink-0 p-1"
        >
          ×
        </button>
      )}
    </div>
  )
}

// ── Shopping ─────────────────────────────────────────────────────────────────
const SWIPE_THRESHOLD = 60

const ShoppingCard: FC<ShoppingCardProps> = ({ listItem, onBuy, onSkip, onUndo }) => {
  const bought = listItem.state === 'bought'
  const touchStartX = useRef(0)
  const [swipeDelta, setSwipeDelta] = useState(0)
  const [swiping, setSwiping] = useState(false)

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]!.clientX
    setSwiping(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    const delta = e.touches[0]!.clientX - touchStartX.current
    if (delta < 0) setSwipeDelta(delta)
  }

  const handleTouchEnd = () => {
    setSwiping(false)
    if (swipeDelta < -SWIPE_THRESHOLD) onSkip()
    setSwipeDelta(0)
  }

  if (bought) {
    return (
      <button
        onClick={onUndo}
        className="w-full flex items-center gap-3 px-3 py-2 opacity-50 text-left"
      >
        <span className="text-sm line-through text-gray-500 truncate">{listItem.item.name}</span>
        {(listItem.quantity ?? listItem.item.unit) && (
          <span className="text-xs text-gray-600">{listItem.quantity}{listItem.unit ?? listItem.item.unit}</span>
        )}
      </button>
    )
  }

  const skipProgress = Math.min(Math.abs(swipeDelta) / SWIPE_THRESHOLD, 1)

  return (
    <div className="relative overflow-hidden rounded-md">
      {/* Skip hint background */}
      <div
        className="absolute inset-0 flex items-center justify-end pr-4 bg-orange-900/60"
        style={{ opacity: skipProgress }}
      >
        <span className="text-xs text-orange-300 font-medium">Skip here</span>
      </div>

      <button
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={!swiping ? onBuy : undefined}
        className="relative w-full flex items-center gap-3 px-3 py-3 bg-card border border-border rounded-md active:bg-border transition-colors text-left"
        style={{ transform: `translateX(${swipeDelta}px)`, transition: swiping ? 'none' : 'transform 0.2s ease' }}
      >
        <div className="w-5 h-5 rounded-full border-2 border-gray-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-gray-100">{listItem.item.name}</span>
          {(listItem.quantity ?? listItem.item.unit) && (
            <span className="ml-2 text-xs text-gray-500">{listItem.quantity}{listItem.unit ?? listItem.item.unit}</span>
          )}
        </div>
        <div className="flex gap-1">
          {listItem.item.shops.map(s => (
            <ShopDot key={s.id} color={s.color} />
          ))}
        </div>
      </button>
    </div>
  )
}

export default ItemCard
