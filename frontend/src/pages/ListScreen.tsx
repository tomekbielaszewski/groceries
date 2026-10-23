import { type FC, useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiClient } from '../api/client'
import { useStore } from '../store/useStore'
import type { List, ListItemWithItem, ItemWithDetails, Shop, SortMode } from '../types'
import ItemCard from '../components/ItemCard'
import SearchInput from '../components/SearchInput'
import SuggestionsPanel from '../components/SuggestionsPanel'
import SortToggle from '../components/SortToggle'
import ShopDot from '../components/ShopDot'
import { useLiveData } from '../components/useLiveData'

const ListScreen: FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { shoppingModeShopId, enterShoppingMode, exitShoppingMode, sortModes, setSortMode } = useStore()
  const [list, setList] = useState<List | null>(null)
  const [listItems, setListItems] = useState<ListItemWithItem[]>([])
  const [shops, setShops] = useState<Shop[]>([])
  const [refresh, setRefresh] = useState(0)

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [shopPickerOpen, setShopPickerOpen] = useState(false)
  const [oneTimeNames, setOneTimeNames] = useState<Set<string>>(new Set())

  const sortMode: SortMode = (id ? sortModes[id] : undefined) ?? 'date'
  const isShoppingMode = !!shoppingModeShopId
  const isArchived = !!list?.archivedAt

  const reload = useCallback(() => setRefresh(r => r + 1), [])
  useLiveData(reload)

  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  const openRename = () => {
    setRenameName(list?.name ?? '')
    setMenuOpen(false)
    setRenameOpen(true)
  }

  const saveRename = async () => {
    if (!list || !renameName.trim()) return
    const updated = await apiClient.renameList(list.id, renameName.trim())
    setList(updated)
    setRenameOpen(false)
  }

  const toggleArchive = async () => {
    if (!list) return
    if (list.archivedAt) {
      await apiClient.unarchiveList(list.id)
    } else {
      await apiClient.archiveList(list.id)
    }
    setMenuOpen(false)
    exitShoppingMode()
    navigate('/')
  }

  const handleCloneList = async () => {
    if (!list) return
    setMenuOpen(false)
    const cloned = await apiClient.cloneList(list.id)
    navigate(`/list/${cloned.id}`)
  }

  const handleCloneActiveItems = async () => {
    if (!list) return
    setMenuOpen(false)
    const cloned = await apiClient.cloneListActive(list.id)
    navigate(`/list/${cloned.id}`)
  }

  useEffect(() => {
    if (!id) return
    apiClient.getList(id).then(l => setList(l ?? null))
    apiClient.getShops().then(setShops)
    apiClient.getListItemsWithItems(id).then(setListItems)
  }, [id, refresh])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      const lis = await apiClient.getListItemsWithItems(id)
      if (cancelled) return
      const names = new Set<string>()
      for (const li of lis) {
        if (li.state !== 'active') continue
        if (await apiClient.isOneTimeItem(li.itemId)) names.add(li.item.name)
      }
      if (!cancelled) setOneTimeNames(names)
    })()
    return () => { cancelled = true }
  }, [id, refresh])

  const sorted = useSorted(listItems, sortMode)
  const activeItems = sorted.filter(li => li.state === 'active')
  const boughtItems = sorted.filter(li => li.state === 'bought')

  const [enteringIds, setEnteringIds] = useState<ReadonlySet<string>>(new Set())
  const knownIds = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (activeItems.length === 0) return
    if (knownIds.current === null) {
      knownIds.current = new Set(activeItems.map(li => li.id))
      return
    }
    const fresh = activeItems.filter(li => !knownIds.current!.has(li.id)).map(li => li.id)
    knownIds.current = new Set(activeItems.map(li => li.id))
    if (fresh.length > 0) setEnteringIds(prev => new Set([...prev, ...fresh]))
  }, [activeItems])

  const addItem = async (item: ItemWithDetails) => {
    if (!id) return
    const existing = listItems.find(li => li.itemId === item.id)
    if (existing) {
      if (existing.state !== 'active') {
        await apiClient.setListItemState(existing.id, 'active')
        reload()
      }
      return
    }
    const defaultQty = item.defaultQuantity ?? (item.unit === 'g' || item.unit === 'ml' ? 100 : 1)
    await apiClient.addListItem({
      listId: id,
      itemId: item.id,
      state: 'active',
      quantity: defaultQty,
      unit: item.unit,
    })
    reload()
  }

  const toggleItem = async (li: ListItemWithItem) => {
    const newState = li.state === 'active' ? 'bought' : 'active'
    await apiClient.setListItemState(li.id, newState)

    if (newState === 'bought' && shoppingModeShopId && id) {
      const sessionId = await getOrCreateSession(id, shoppingModeShopId)
      await apiClient.recordSessionItem({
        sessionId,
        itemId: li.itemId,
        action: 'bought',
        at: new Date().toISOString(),
      })
    }

    reload()
  }

  const removeItem = async (li: ListItemWithItem) => {
    await apiClient.removeListItem(li.id)
    reload()
  }

  const updateQuantity = async (li: ListItemWithItem, qty: number | undefined, unit: string | undefined) => {
    await apiClient.changeListItemQuantity(li.id, qty, unit)
    reload()
  }

  const skipAtShop = async (li: ListItemWithItem) => {
    if (!shoppingModeShopId || !id) return
    await apiClient.skipShopForListItem(li.id, shoppingModeShopId)
    const sessionId = await getOrCreateSession(id, shoppingModeShopId)
    await apiClient.recordSessionItem({
      sessionId,
      itemId: li.itemId,
      action: 'skipped',
      at: new Date().toISOString(),
    })
    reload()
  }

  const clearSkip = async (li: ListItemWithItem) => {
    if (!shoppingModeShopId) return
    await apiClient.clearSkipForListItem(li.id, shoppingModeShopId)
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
          <h1 className="flex-1 text-sm font-semibold text-gray-100 truncate" role="heading" aria-level={1}>{list.name}</h1>
          {!isShoppingMode ? (
            <>
              <SortToggle value={sortMode} onChange={m => id && setSortMode(id, m)} />
              {isArchived && (
                <span className="text-xs px-2 py-1 border border-border rounded text-gray-500">Archived</span>
              )}
              {!isArchived && (
                <button
                  onClick={() => setShopPickerOpen(true)}
                  className="text-xs px-2.5 py-1 bg-green-700 hover:bg-green-600 text-white rounded transition-colors whitespace-nowrap"
                >
                  Shop
                </button>
              )}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen(o => !o)}
                  aria-label="More options"
                  className="text-gray-400 hover:text-gray-200 transition-colors p-1"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
                  </svg>
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-44 bg-card border border-border rounded-md shadow-lg z-50 py-1">
                    {!isArchived && (
                      <button
                        onClick={openRename}
                        className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/5 transition-colors"
                      >
                        Rename list
                      </button>
                    )}
                    <button
                      onClick={() => void handleCloneList()}
                      className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/5 transition-colors"
                    >
                      Clone list
                    </button>
                    <button
                      onClick={() => void handleCloneActiveItems()}
                      className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/5 transition-colors"
                    >
                      Clone active items
                    </button>
                    <button
                      onClick={() => void toggleArchive()}
                      className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-white/5 transition-colors"
                    >
                      {list?.archivedAt ? 'Unarchive list' : 'Archive list'}
                    </button>
                  </div>
                )}
              </div>
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
                className={enteringIds.has(li.id) ? 'animate-item-in' : undefined}
                onRemove={isArchived ? undefined : () => void removeItem(li)}
                onQuantityChange={isArchived ? undefined : (qty, unit) => void updateQuantity(li, qty, unit)}
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
                    onRemove={isArchived ? undefined : () => void removeItem(li)}
                    onQuantityChange={isArchived ? undefined : (qty, unit) => void updateQuantity(li, qty, unit)}
                    onClick={() => navigate(`/item/${li.itemId}`)}
                  />
                ))}
              </>
            )}
            {id && !isArchived && <SuggestionsPanel listId={id} refresh={refresh} onAdd={addItem} />}
          </>
        )}
      </div>

      {!isShoppingMode && !isArchived && (
        <div className="border-t border-border px-3 pt-2 pb-3">
          <SearchInput
            dropUp
            onSelect={addItem}
            onCreateNew={name => navigate(`/item/new?name=${encodeURIComponent(name)}&listId=${id}`)}
            excludeIds={new Set(activeItems.map(li => li.itemId))}
            onAddOneTime={name => navigate(`/item/new?name=${encodeURIComponent(name)}&listId=${id}&oneTime=1`)}
            excludeOneTimeNames={oneTimeNames}
          />
        </div>
      )}

      {renameOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-card border border-border rounded-lg p-4 w-full max-w-sm space-y-3">
            <h2 className="text-sm font-semibold text-gray-100">Rename list</h2>
            <input
              autoFocus
              type="text"
              aria-label="List name"
              value={renameName}
              onChange={e => setRenameName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void saveRename()
                if (e.key === 'Escape') setRenameOpen(false)
              }}
              className="w-full bg-transparent border border-border rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-gray-500"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setRenameOpen(false)}
                className="text-xs px-3 py-1.5 border border-border rounded text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void saveRename()}
                className="text-xs px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {shopPickerOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-card border border-border rounded-lg p-4 w-full max-w-sm space-y-3">
            <h2 className="text-sm font-semibold text-gray-100">Choose a shop</h2>
            {shops.length === 0 ? (
              <div className="text-sm text-gray-500 py-2">No shops yet. Add one in Settings.</div>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {shops.map(shop => (
                  <button
                    key={shop.id}
                    onClick={() => {
                      setShopPickerOpen(false)
                      enterShoppingMode(shop.id)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-surface border border-border rounded-md hover:border-gray-500 text-left transition-colors"
                  >
                    <ShopDot color={shop.color} />
                    <span className="text-sm text-gray-200">{shop.name}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <button
                onClick={() => setShopPickerOpen(false)}
                className="text-xs px-3 py-1.5 border border-border rounded text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

async function getOrCreateSession(listId: string, shopId: string): Promise<string> {
  const existing = await apiClient.findOpenSession(listId, shopId)
  if (existing) return existing.id
  const session = await apiClient.startShoppingSession(listId, shopId)
  return session.id
}

function useSorted(items: ListItemWithItem[], mode: SortMode): ListItemWithItem[] {
  return [...items].sort((a, b) => {
    if (mode === 'name')      return a.item.name.localeCompare(b.item.name)
    if (mode === 'frequency') return b.item.frequency - a.item.frequency
    if (mode === 'tag') {
      const tagA = a.item.tags[0]?.name
      const tagB = b.item.tags[0]?.name
      if (tagA == null && tagB == null) return 0
      if (tagA == null) return 1
      if (tagB == null) return -1
      return tagA.localeCompare(tagB)
    }
    return b.addedAt.localeCompare(a.addedAt) // date (newest first)
  })
}

export default ListScreen
