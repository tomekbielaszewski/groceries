import { type FC, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../db/schema'
import { upsertList } from '../db/queries'
import type { List } from '../types'

const ListsScreen: FC = () => {
  const [lists, setLists] = useState<List[]>([])
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const navigate = useNavigate()

  const load = () =>
    db.lists.filter(l => !l.deletedAt).sortBy('createdAt').then(ls => {
      const sorted = [...ls].reverse()
      const active = sorted.filter(l => !l.archivedAt)
      const archived = sorted.filter(l => !!l.archivedAt)
      setLists([...active, ...archived])
    })

  useEffect(() => { void load() }, [])

  const createList = async () => {
    if (!newName.trim()) return
    const now = new Date().toISOString()
    const list: List = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    await upsertList(list)
    setNewName('')
    setCreating(false)
    void load()
  }

  const deleteList = async (id: string) => {
    const list = await db.lists.get(id)
    if (!list) return
    await upsertList({ ...list, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: list.version + 1 })
    void load()
  }

  const activeLists = lists.filter(l => !l.archivedAt)
  const archivedLists = lists.filter(l => !!l.archivedAt)

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 border-b border-border">
        <h1 className="text-base font-semibold text-gray-100">Lists</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {lists.length === 0 && !creating && (
          <div className="text-center py-12 text-gray-500 text-sm">
            No lists yet. Create one to get started.
          </div>
        )}

        {activeLists.map(list => (
          <ListCard
            key={list.id}
            list={list}
            onOpen={() => navigate(`/list/${list.id}`)}
            onDelete={() => void deleteList(list.id)}
          />
        ))}

        {archivedLists.length > 0 && (
          <>
            {activeLists.length > 0 && <div className="border-t border-border mt-1" />}
            <div className="text-xs text-gray-600 pt-1 pb-0.5 px-1">Archived</div>
            {archivedLists.map(list => (
              <ListCard
                key={list.id}
                list={list}
                archived
                onOpen={() => navigate(`/list/${list.id}`)}
                onDelete={() => void deleteList(list.id)}
              />
            ))}
          </>
        )}
      </div>

      <div className="px-3 pt-2 pb-3 border-t border-border space-y-2">
        {creating && (
          <div className="flex gap-2">
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void createList(); if (e.key === 'Escape') setCreating(false) }}
              placeholder="List name…"
              className="flex-1 bg-card border border-blue-500 rounded px-2.5 py-1.5 text-sm focus:outline-none"
            />
            <button onClick={() => void createList()} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors">
              Add
            </button>
            <button onClick={() => setCreating(false)} className="px-2 py-1.5 text-gray-400 hover:text-gray-200 text-sm transition-colors">
              ✕
            </button>
          </div>
        )}
        <button
          onClick={() => setCreating(true)}
          className="w-full text-sm py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
        >
          + New list
        </button>
      </div>
    </div>
  )
}

const ListCard: FC<{
  list: List
  archived?: boolean
  onOpen: () => void
  onDelete: () => void
}> = ({ list, archived, onOpen, onDelete }) => {
  const [counts, setCounts] = useState({ active: 0, total: 0 })

  useEffect(() => {
    db.listItems.where('listId').equals(list.id).toArray().then(items => {
      setCounts({ active: items.filter(i => i.state === 'active').length, total: items.length })
    })
  }, [list.id])

  return (
    <div className={`flex items-center gap-3 px-3 py-3 border rounded-md transition-colors ${
      archived
        ? 'bg-card/40 border-border/50 hover:border-gray-700'
        : 'bg-card border-border hover:border-gray-600'
    }`}>
      <button onClick={onOpen} className="flex-1 text-left min-w-0">
        <div className={`text-sm font-medium truncate ${archived ? 'text-gray-500' : 'text-gray-100'}`}>{list.name}</div>
        <div className="text-xs text-gray-600 mt-0.5">
          {counts.active} active · {counts.total} total · {new Date(list.createdAt).toLocaleDateString()}
        </div>
      </button>
      <button
        onClick={onDelete}
        aria-label="Delete list"
        className="text-gray-600 hover:text-red-400 transition-colors p-1"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  )
}

export default ListsScreen
