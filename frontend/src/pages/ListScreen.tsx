import { type FC, useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { db } from '../db/schema'
import { getListItemsWithItems, upsertListItem, skipShopForListItem, clearSkipForListItem } from '../db/queries'
import { useStore } from '../store/useStore'
import type { List, ListItemWithItem, ItemWithDetails, Shop, SortMode } from '../types'
import ItemCard from '../components/ItemCard'
import SearchInput from '../components/SearchInput'
import SuggestionsPanel from '../components/SuggestionsPanel'
import SortToggle from '../components/SortToggle'

const ListScreen: FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { shoppingModeShopId, enterShoppingMode, exitShoppingMode, sortModes, setSortMode } = useStore()
  const [list, setList] = useState<List | null>(null)
  const [listItems, setListItems] = useState<ListItemWithItem[]>([])
  const [shops, setShops] = useState<Shop[]>([])
  const [refresh, setRefresh] = useState(0)

  const sortMode: SortMode = (id ? sortModes[id] : undefined) ?? 'date'
  const isShoppingMode = !!shoppingModeShopId

  const reload = useCallback(() => setRefresh(r => r + 1), [])

  useEffect(() => {
    if (!id) return
    db.lists.get(id).then(l => setList(l ?? null))
    db.shops.toArray().then(setShops)
    getListItemsWithItems(id).then(setListItems)
  }, [id, refresh])

  const sorted = useSorted(listItems, sortMode)
  const activeItems = sorted.filter(li => li.state === 'active')
  const boughtItems = sorted.filter(li => li.state === 'bought')

  const addItem = async (item: ItemWithDetails) => {
    if (!id) return
    const existing = listItems.find(li => li.itemId === item.id)
    if (existing) {
      if (existing.state !== 'active') {
        await upsertListItem({ ...existing, state: 'active', updatedAt: new Date().toISOString(), version: existing.version + 1 })
        reload()
      }
      return
    }
    const now = new Date().toISOString()
    const defaultQty = item.defaultQuantity ?? (item.unit === 'g' || item.unit === 'ml' ? 100 : 1)
    await upsertListItem({
      id: crypto.randomUUID(),
      listId: id,
      itemId: item.id,
      state: 'active',
      quantity: defaultQty,
      unit: item.unit,
      version: 1,
      addedAt: now,
      updatedAt: now,
    })
    reload()
  }

  const toggleItem = async (li: ListItemWithItem) => {
    const newState = li.state === 'active' ? 'bought' : 'active'
    await upsertListItem({ ...li, state: newState, updatedAt: new Date().toISOString(), version: li.version + 1 })
    reload()
  }

  const removeItem = async (li: ListItemWithItem) => {
    await db.listItems.delete(li.id)
    reload()
  }

  const updateQuantity = async (li: ListItemWithItem, qty: number | undefined, unit: string | undefined) => {
    await upsertListItem({ ...li, quantity: qty, unit, updatedAt: new Date().toISOString(), version: li.version + 1 })
    reload()
  }

  const skipAtShop = async (li: ListItemWithItem) => {
    if (!shoppingModeShopId) return
    await skipShopForListItem(li.id, shoppingModeShopId)
    reload()
  }

  const clearSkip = async (li: ListItemWithItem) => {
    if (!shoppingModeShopId) return
    await clearSkipForListItem(li.id, shoppingModeShopId)
    reload()
  }

  const shoppingItems = activeItems.filter(li =>
    shoppingModeShopId
      ? li.item.shops.some(s => s.id === shoppingModeShopId) &&
        !li.skippedShopIds.includes(shoppingModeShopId)
      : true
  )

  if (!list) return <div className="p-4 text-gray-500 text-sm">Loading…</div>

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-border">
        <div className="flex items-center gap-2">
          <button onClick={() => { exitShoppingMode(); navigate('/') }} aria-label="Back" className="text-gray-400 hover:text-gray-200 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="flex-1 text-sm font-semibold text-gray-100 truncate">{list.name}</h1>
          {!isShoppingMode ? (
            <>
              <SortToggle value={sortMode} onChange={m => id && setSortMode(id, m)} />
              <button
                onClick={() => {
                  const firstShop = shops[0]
                  if (firstShop) enterShoppingMode(firstShop.id)
                }}
                className="text-xs px-2.5 py-1 bg-green-700 hover:bg-green-600 text-white rounded transition-colors whitespace-nowrap"
              >
                Shop
              </button>
            </>
          ) : (
            <>
              <select
                value={shoppingModeShopId}
                onChange={e => enterShoppingMode(e.target.value)}
                className="text-xs bg-card border border-border rounded px-2 py-1 text-gray-200 focus:outline-none"
              >
                {shops.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <button
                onClick={exitShoppingMode}
                className="text-xs px-2.5 py-1 border border-border rounded text-gray-400 hover:text-gray-200 transition-colors"
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>

      {/* Item list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {isShoppingMode ? (
          <>
            {shoppingItems.length === 0 && (
              <div className="text-center py-8 text-gray-500 text-sm">All done here!</div>
            )}
            {shoppingItems.map(li => (
              <ItemCard
                key={li.id}
                mode="shopping"
                listItem={li}
                activeShopId={shoppingModeShopId!}
                onBuy={() => void toggleItem(li)}
                onSkip={() => void skipAtShop(li)}
                onUndo={() => void clearSkip(li)}
              />
            ))}
            {boughtItems.length > 0 && (
              <>
                <div className="text-xs text-gray-500 pt-2 pb-1">Bought</div>
                {boughtItems.map(li => (
                  <ItemCard
                    key={li.id}
                    mode="shopping"
                    listItem={li}
                    activeShopId={shoppingModeShopId!}
                    onBuy={() => void toggleItem(li)}
                    onSkip={() => void skipAtShop(li)}
                    onUndo={() => void toggleItem(li)}
                  />
                ))}
              </>
            )}
          </>
        ) : (
          <>
            {activeItems.length === 0 && boughtItems.length === 0 && (
              <div className="text-center py-8 text-gray-500 text-sm">
                No items yet. Search below to add some.
              </div>
            )}
            {activeItems.map(li => (
              <ItemCard
                key={li.id}
                mode="browse"
                listItem={li}
                shops={shops}
                onToggle={() => void toggleItem(li)}
                onRemove={() => void removeItem(li)}
                onQuantityChange={(qty, unit) => void updateQuantity(li, qty, unit)}
                onClick={() => navigate(`/item/${li.itemId}`)}
              />
            ))}
            {boughtItems.length > 0 && (
              <>
                <div className="text-xs text-gray-500 pt-2 pb-1">Bought</div>
                {boughtItems.map(li => (
                  <ItemCard
                    key={li.id}
                    mode="browse"
                    listItem={li}
                    shops={shops}
                    onToggle={() => void toggleItem(li)}
                    onRemove={() => void removeItem(li)}
                    onQuantityChange={(qty, unit) => void updateQuantity(li, qty, unit)}
                    onClick={() => navigate(`/item/${li.itemId}`)}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {!isShoppingMode && (
        <div className="border-t border-border px-3 pt-2 pb-3 space-y-2">
          {id && <SuggestionsPanel listId={id} onAdd={addItem} />}
          <SearchInput
            dropUp
            onSelect={addItem}
            onCreateNew={name => navigate(`/item/new?name=${encodeURIComponent(name)}&listId=${id}`)}
            excludeIds={new Set(activeItems.map(li => li.itemId))}
          />
        </div>
      )}
    </div>
  )
}

function useSorted(items: ListItemWithItem[], mode: SortMode): ListItemWithItem[] {
  return [...items].sort((a, b) => {
    if (mode === 'name')      return a.item.name.localeCompare(b.item.name)
    if (mode === 'frequency') return b.item.frequency - a.item.frequency
    return b.addedAt.localeCompare(a.addedAt) // date (newest first)
  })
}

export default ListScreen
