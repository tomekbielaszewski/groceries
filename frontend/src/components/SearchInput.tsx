import { type FC, useState, useEffect, useRef } from 'react'
import { getItemsWithDetails } from '../db/queries'
import type { ItemWithDetails } from '../types'
import ShopDot from './ShopDot'

interface SearchInputProps {
  placeholder?: string
  onSelect: (item: ItemWithDetails) => void
  onCreateNew: (name: string) => void
  excludeIds?: Set<string>
  dropUp?: boolean
}

const SearchInput: FC<SearchInputProps> = ({ placeholder = 'Search items…', onSelect, onCreateNew, excludeIds, dropUp }) => {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ItemWithDetails[]>([])
  const [allResults, setAllResults] = useState<ItemWithDetails[]>([])
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!query.trim()) { setResults([]); setAllResults([]); setOpen(false); return }

    timer.current = setTimeout(async () => {
      const items = await getItemsWithDetails(query)
      setAllResults(items)
      const filtered = excludeIds ? items.filter(i => !excludeIds.has(i.id)) : items
      setResults(filtered.slice(0, 8))
      setOpen(true)
    }, 200)
  }, [query, excludeIds])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Check all catalogue items (including excluded ones) to prevent duplicate creation
  const exactMatch = allResults.some(r => r.name.toLowerCase() === query.toLowerCase())

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && query.trim()) {
            if (results.length > 0) {
              onSelect(results[0])
            } else if (!exactMatch) {
              onCreateNew(query.trim())
            }
            setQuery('')
            setOpen(false)
          }
        }}
        placeholder={placeholder}
        className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
      />
      {open && (results.length > 0 || query.trim()) && (
        <div className={`absolute ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'} left-0 right-0 bg-card border border-border rounded shadow-lg z-50 overflow-hidden`}>
          {results.map(item => (
            <button
              key={item.id}
              onMouseDown={() => { onSelect(item); setQuery(''); setOpen(false) }}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-sm hover:bg-border text-left transition-colors"
            >
              <span className="flex-1 truncate">{item.name}</span>
              <span className="flex gap-1">
                {item.shops.map(s => <ShopDot key={s.id} color={s.color} title={s.name} />)}
              </span>
              {item.frequency > 0 && (
                <span className="text-xs text-gray-500">{item.frequency}×</span>
              )}
            </button>
          ))}
          {!exactMatch && query.trim() && (
            <button
              onMouseDown={() => { onCreateNew(query.trim()); setQuery(''); setOpen(false) }}
              className="w-full px-2.5 py-2 text-sm text-blue-400 hover:bg-border text-left transition-colors border-t border-border"
            >
              + Add "{query.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default SearchInput
