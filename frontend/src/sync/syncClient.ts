import { db } from '../db/schema'
import { isEmpty } from '../db/queries'
import { useStore } from '../store/useStore'
import type { BootstrapResponse, SyncRequest, SyncResponse, SyncChanges } from '../types'

const API = '/api'

export async function bootstrap(): Promise<void> {
  const { setSyncStatus, setLastSyncedAt, addConflicts } = useStore.getState()
  setSyncStatus('syncing')
  try {
    const res = await fetch(`${API}/bootstrap`)
    if (!res.ok) throw new Error(`bootstrap ${res.status}`)
    const data: BootstrapResponse = await res.json()
    await writeAll(data)
    setLastSyncedAt(data.serverTime)
    setSyncStatus('idle')
  } catch (e) {
    console.error('bootstrap failed', e)
    setSyncStatus('error')
  }
  void addConflicts // suppress unused warning
}

export async function sync(): Promise<void> {
  const { setSyncStatus, setLastSyncedAt, addConflicts, lastSyncedAt } = useStore.getState()

  if (!navigator.onLine) {
    setSyncStatus('offline')
    return
  }

  setSyncStatus('syncing')
  try {
    const changes = await collectChanges()
    const req: SyncRequest = {
      lastSyncedAt: lastSyncedAt ?? new Date(0).toISOString(),
      changes,
    }

    const res = await fetch(`${API}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
    if (!res.ok) throw new Error(`sync ${res.status}`)

    const data: SyncResponse = await res.json()

    // Apply server changes
    await writeAll(data.serverChanges)

    // Clear applied from pending queue
    if (data.applied.length > 0) {
      await db.pendingSyncIds.bulkDelete(data.applied)
    }

    // Queue conflicts for user review
    if (data.conflicts.length > 0) {
      addConflicts(data.conflicts)
    }

    setLastSyncedAt(data.serverTime)
    setSyncStatus('idle')
  } catch (e) {
    console.error('sync failed', e)
    setSyncStatus(navigator.onLine ? 'error' : 'offline')
  }
}

async function collectChanges(): Promise<SyncChanges> {
  const lastSyncedAt = useStore.getState().lastSyncedAt ?? new Date(0).toISOString()

  const [
    shops, items, tags, itemShops, itemTags,
    lists, listItems, listItemSkippedShops,
    shoppingSessions, sessionItems,
  ] = await Promise.all([
    // Shops, items, and lists are sent in full every time.
    // item_shops, list_items, shopping_sessions etc. reference these as FK parents,
    // so they must always be present on the server regardless of when they were last changed.
    db.shops.toArray(),
    db.items.toArray(),
    db.tags.toArray(),
    db.itemShops.toArray(),
    db.itemTags.toArray(),
    db.lists.toArray(),
    db.listItems.where('updatedAt').above(lastSyncedAt).toArray(),
    db.listItemSkippedShops.toArray(),
    db.shoppingSessions.toArray(),
    db.sessionItems.toArray(),
  ])

  return { shops, items, tags, itemShops, itemTags, lists, listItems, listItemSkippedShops, shoppingSessions, sessionItems }
}

async function writeAll(data: Partial<BootstrapResponse | SyncChanges>): Promise<void> {
  await db.transaction('rw', [
    db.shops, db.items, db.tags, db.itemShops, db.itemTags,
    db.lists, db.listItems, db.listItemSkippedShops,
    db.shoppingSessions, db.sessionItems,
  ], async () => {
    if (data.shops?.length)                 await db.shops.bulkPut(data.shops)
    if (data.items?.length)                 await db.items.bulkPut(data.items)
    if (data.tags?.length)                  await db.tags.bulkPut(data.tags)
    if (data.itemShops?.length)             await db.itemShops.bulkPut(data.itemShops)
    if (data.itemTags?.length)              await db.itemTags.bulkPut(data.itemTags)
    if (data.lists?.length)                 await db.lists.bulkPut(data.lists)
    if (data.listItems?.length)             await db.listItems.bulkPut(data.listItems)
    if (data.listItemSkippedShops?.length)  await db.listItemSkippedShops.bulkPut(data.listItemSkippedShops)
    if (data.shoppingSessions?.length)      await db.shoppingSessions.bulkPut(data.shoppingSessions)
    if (data.sessionItems?.length)          await db.sessionItems.bulkPut(data.sessionItems)
  })
}

export function scheduleSync(): () => void {
  const doSync = async () => {
    const empty = await isEmpty()
    if (empty) {
      await bootstrap()
    } else {
      await sync()
    }
  }

  // Sync on online event
  window.addEventListener('online', doSync)

  // Sync every 60s while online
  const interval = setInterval(() => {
    if (navigator.onLine) void doSync()
  }, 60_000)

  // Initial sync on load
  void doSync()

  return () => {
    window.removeEventListener('online', doSync)
    clearInterval(interval)
  }
}
