import { type FC, useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { db } from '../db/schema'
import { upsertItem, getItemWithDetails } from '../db/queries'
import type { Shop, Tag, ItemWithDetails, SessionItem } from '../types'
import ShopDot from '../components/ShopDot'
import TagBadge from '../components/TagBadge'
import { normalizeTag } from '../utils/tagUtils'

const COMMON_UNITS = ['kg', 'g', 'l', 'ml', 'pcs', 'pack', 'bottle', 'bag', 'box']

function defaultQtyForUnit(unit: string): number {
  return (unit === 'g' || unit === 'ml') ? 100 : 1
}

const ItemDetailScreen: FC = () => {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const isNew = id === 'new'

  const [name, setName]             = useState(searchParams.get('name') ?? '')
  const [unit, setUnit]             = useState(isNew ? 'pcs' : '')
  const [defaultQuantity, setDefaultQuantity] = useState(isNew ? 1 : 1)
  const [description, setDescription] = useState('')
  const [notes, setNotes]           = useState('')
  const [selectedShops, setSelectedShops] = useState<string[]>([])
  const [selectedTags, setSelectedTags]   = useState<string[]>([])
  const [newTag, setNewTag]         = useState('')
  const [shops, setShops]           = useState<Shop[]>([])
  const [tags, setTags]             = useState<Tag[]>([])
  const [item, setItem]             = useState<ItemWithDetails | null>(null)
  const [history, setHistory]       = useState<SessionItem[]>([])

  useEffect(() => {
    db.shops.toArray().then(setShops)
    db.tags.toArray().then(setTags)

    if (!isNew && id) {
      getItemWithDetails(id).then(async enriched => {
        if (!enriched) return
        setItem(enriched)
        setName(enriched.name)
        setUnit(enriched.unit ?? '')
        setDefaultQuantity(enriched.defaultQuantity ?? defaultQtyForUnit(enriched.unit ?? ''))
        setDescription(enriched.description ?? '')
        setNotes(enriched.notes ?? '')
        setSelectedShops(enriched.shops.map(s => s.id))
        setSelectedTags(enriched.tags.map(t => t.id))

        const hist = await db.sessionItems.where('itemId').equals(id).sortBy('at')
        setHistory([...hist].reverse().slice(0, 20))
      })
    }
  }, [id, isNew])

  const changeUnit = (newUnit: string) => {
    setUnit(newUnit)
    if (isNew) setDefaultQuantity(defaultQtyForUnit(newUnit))
  }

  const save = async () => {
    if (!name.trim()) return
    const now = new Date().toISOString()
    const itemId = isNew ? crypto.randomUUID() : id!

    await upsertItem(
      {
        id: itemId,
        name: name.trim(),
        unit: unit || undefined,
        defaultQuantity,
        description: description || undefined,
        notes: notes || undefined,
        version: item ? item.version + 1 : 1,
        createdAt: item?.createdAt ?? now,
        updatedAt: now,
      },
      selectedShops,
      selectedTags,
    )

    // If coming from list add flow, add to that list
    const listId = searchParams.get('listId')
    if (listId && isNew) {
      await db.listItems.add({
        id: crypto.randomUUID(),
        listId,
        itemId,
        state: 'active',
        quantity: defaultQuantity,
        unit: unit || undefined,
        version: 1,
        addedAt: now,
        updatedAt: now,
      })
      navigate(`/list/${listId}`)
      return
    }

    navigate(-1)
  }

  const deleteItem = async () => {
    if (!id || isNew) return
    await db.items.update(id, { deletedAt: new Date().toISOString() })
    navigate(-1)
  }

  const addTag = async () => {
    const normalized = normalizeTag(newTag)
    if (!normalized) return
    const existing = tags.find(t => t.name === normalized)
    let tagId: string
    if (existing) {
      tagId = existing.id
    } else {
      tagId = crypto.randomUUID()
      await db.tags.add({ id: tagId, name: normalized })
      setTags(prev => [...prev, { id: tagId, name: normalized }])
    }
    setSelectedTags(prev => prev.includes(tagId) ? prev : [...prev, tagId])
    setNewTag('')
  }

  const shopMap = new Map(shops.map(s => [s.id, s]))
  const tagMap  = new Map(tags.map(t => [t.id, t]))

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-border">
        <button onClick={() => navigate(-1)} aria-label="Back" className="text-gray-400 hover:text-gray-200 transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="flex-1 text-sm font-semibold text-gray-100">{isNew ? 'New item' : 'Edit item'}</h1>
        {!isNew && (
          <button onClick={deleteItem} aria-label="Delete" className="text-gray-500 hover:text-red-400 transition-colors p-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Name */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Name *</label>
          <input
            autoFocus={isNew}
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) void save() }}
            placeholder="e.g. Whole milk"
            className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {/* Unit */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Unit {isNew && <span className="text-red-400">*</span>}</label>
          <div className="flex gap-1.5 flex-wrap mb-1.5">
            {COMMON_UNITS.map(u => (
              <button
                key={u}
                onClick={() => changeUnit(unit === u ? '' : u)}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${unit === u ? 'border-blue-500 text-blue-400' : 'border-border text-gray-400 hover:border-gray-500'}`}
              >
                {u}
              </button>
            ))}
          </div>
          <input
            value={unit}
            onChange={e => changeUnit(e.target.value)}
            placeholder="or type custom…"
            className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {/* Default amount */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Default amount</label>
          <input
            type="number"
            min={1}
            value={defaultQuantity}
            onChange={e => setDefaultQuantity(Math.max(1, Number(e.target.value) || 1))}
            className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {/* Shops */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Available at</label>
          <div className="flex gap-2 flex-wrap">
            {shops.map(shop => {
              const selected = selectedShops.includes(shop.id)
              return (
                <button
                  key={shop.id}
                  onClick={() => setSelectedShops(prev => selected ? prev.filter(id => id !== shop.id) : [...prev, shop.id])}
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${selected ? 'border-transparent text-white' : 'border-border text-gray-400 hover:border-gray-500'}`}
                  style={selected ? { backgroundColor: shop.color } : undefined}
                >
                  <ShopDot color={shop.color} />
                  {shop.name}
                </button>
              )
            })}
            {shops.length === 0 && (
              <span className="text-xs text-gray-500">No shops defined. <button onClick={() => navigate('/settings')} className="text-blue-400 hover:underline">Add shops</button></span>
            )}
          </div>
        </div>

        {/* Tags */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Tags</label>
          <div className="flex gap-1.5 flex-wrap mb-2">
            {selectedTags.map(tagId => {
              const tag = tagMap.get(tagId)
              return tag ? <TagBadge key={tagId} name={tag.name} onRemove={() => setSelectedTags(prev => prev.filter(id => id !== tagId))} /> : null
            })}
          </div>
          <div className="flex gap-2">
            <input
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void addTag() }}
              placeholder="Add tag…"
              className="flex-1 bg-card border border-border rounded px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-500 transition-colors"
            />
            <button onClick={() => void addTag()} className="text-xs px-2.5 py-1.5 border border-border rounded text-gray-400 hover:text-gray-200 transition-colors">
              Add
            </button>
          </div>
          {(() => {
            const normalized = normalizeTag(newTag)
            const available = tags.filter(t => !selectedTags.includes(t.id))
            const filtered = normalized
              ? available.filter(t => t.name.includes(normalized))
              : available
            return filtered.length > 0 ? (
              <div className="flex gap-1.5 flex-wrap mt-2">
                {filtered.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTags(prev => [...prev, t.id])}
                    className="text-xs px-1.5 py-0.5 rounded border border-dashed border-border text-gray-500 hover:border-gray-400 hover:text-gray-300 transition-colors"
                  >
                    + {t.name}
                  </button>
                ))}
              </div>
            ) : null
          })()}
        </div>

        {/* Description */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Description</label>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Optional short description"
            className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Any notes or comments…"
            className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500 transition-colors resize-none"
          />
        </div>

        {/* Stats (existing items only) */}
        {!isNew && item && (
          <div>
            <div className="text-xs text-gray-500 mb-2">Purchase history</div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <Stat label="Times bought" value={String(item.frequency)} />
              <Stat label="Last bought" value={item.lastBoughtAt ? new Date(item.lastBoughtAt).toLocaleDateString() : '—'} />
              <Stat label="Last shop" value={item.lastBoughtShopId ? (shopMap.get(item.lastBoughtShopId)?.name ?? '—') : '—'} />
            </div>
            {history.length > 0 && (
              <div className="border border-border rounded overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-border/50">
                    <tr>
                      <th className="text-left px-2 py-1.5 text-gray-400 font-medium">Date</th>
                      <th className="text-left px-2 py-1.5 text-gray-400 font-medium">Qty</th>
                      <th className="text-left px-2 py-1.5 text-gray-400 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {history.map(h => (
                      <tr key={h.id}>
                        <td className="px-2 py-1.5 text-gray-300">{new Date(h.at).toLocaleDateString()}</td>
                        <td className="px-2 py-1.5 text-gray-400">{h.quantity ?? '—'}{h.unit ?? ''}</td>
                        <td className="px-2 py-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-xs ${h.action === 'bought' ? 'bg-green-900/50 text-green-400' : 'bg-orange-900/50 text-orange-400'}`}>
                            {h.action}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-3 py-3 border-t border-border">
        <button
          onClick={() => void save()}
          disabled={!name.trim() || (isNew && !unit.trim())}
          className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded transition-colors"
        >
          {isNew ? 'Add item' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}

const Stat: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-card border border-border rounded p-2 text-center">
    <div className="text-base font-semibold text-gray-100">{value}</div>
    <div className="text-xs text-gray-500 mt-0.5">{label}</div>
  </div>
)

export default ItemDetailScreen
