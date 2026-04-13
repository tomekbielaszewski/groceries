import { type FC, useEffect, useState } from 'react'
import { getFrequentItems } from '../db/queries'
import type { ItemWithDetails } from '../types'

interface SuggestionsPanelProps {
  listId: string
  refresh?: number
  onAdd: (item: ItemWithDetails) => void
}

const SuggestionsPanel: FC<SuggestionsPanelProps> = ({ listId, refresh, onAdd }) => {
  const [items, setItems] = useState<ItemWithDetails[]>([])

  useEffect(() => {
    getFrequentItems(listId, 20).then(setItems)
  }, [listId, refresh])

  if (items.length === 0) return null

  return (
    <div className="flex gap-1.5 overflow-x-auto py-1 scrollbar-none">
      {items.map(item => (
        <button
          key={item.id}
          onClick={() => onAdd(item)}
          className="flex-shrink-0 text-xs px-2.5 py-1 rounded-full border border-border text-gray-300 hover:border-blue-500 hover:text-blue-400 transition-colors whitespace-nowrap"
        >
          {item.name}
          {item.frequency > 0 && (
            <span className="ml-1 text-gray-500">{item.frequency}×</span>
          )}
        </button>
      ))}
    </div>
  )
}

export default SuggestionsPanel
