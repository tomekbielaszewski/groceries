import { db } from './schema'
import type {
  Item, ItemWithDetails, ListItemWithItem,
  ListItem, Shop, Tag, SessionItem,
} from '../types'

export async function getItemsWithDetails(searchTerm?: string): Promise<ItemWithDetails[]> {
  let items = await db.items.filter(i => !i.deletedAt).toArray()

  if (searchTerm) {
    // Normalize diacritics: NFD decomposition strips most combining marks,
    // but ł/Ł don't decompose that way so we replace them explicitly first.
    const normalize = (s: string) =>
      s.trim().toLowerCase()
        .replace(/ł/g, 'l')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
    const needle = normalize(searchTerm)
    items = items.filter(i => normalize(i.name).includes(needle))
  }

  return enrichItems(items)
}

export async function getItemWithDetails(itemId: string): Promise<ItemWithDetails | undefined> {
  const item = await db.items.get(itemId)
  if (!item) return undefined
  const enriched = await enrichItems([item])
  return enriched[0]
}

async function enrichItems(items: Item[]): Promise<ItemWithDetails[]> {
  const [allShops, allItemShops, allTags, allItemTags, allSessionItems] = await Promise.all([
    db.shops.toArray(),
    db.itemShops.toArray(),
    db.tags.toArray(),
    db.itemTags.toArray(),
    db.sessionItems.where('action').equals('bought').toArray(),
  ])

  const shopMap = new Map(allShops.map(s => [s.id, s]))
  const tagMap  = new Map(allTags.map(t => [t.id, t]))

  const itemShopMap = new Map<string, Shop[]>()
  for (const is of allItemShops) {
    const shop = shopMap.get(is.shopId)
    if (!shop) continue
    const arr = itemShopMap.get(is.itemId) ?? []
    arr.push(shop)
    itemShopMap.set(is.itemId, arr)
  }

  const itemTagMap = new Map<string, Tag[]>()
  for (const it of allItemTags) {
    const tag = tagMap.get(it.tagId)
    if (!tag) continue
    const arr = itemTagMap.get(it.itemId) ?? []
    arr.push(tag)
    itemTagMap.set(it.itemId, arr)
  }

  // frequency + last bought per item
  const freqMap = new Map<string, number>()
  const lastBoughtMap = new Map<string, string>()
  const lastShopMap = new Map<string, string>()
  for (const si of allSessionItems) {
    freqMap.set(si.itemId, (freqMap.get(si.itemId) ?? 0) + 1)
    const prev = lastBoughtMap.get(si.itemId)
    if (!prev || si.at > prev) {
      lastBoughtMap.set(si.itemId, si.at)
      // get shop from session
    }
  }

  // enrich session items with shopId
  const sessionMap = new Map(
    (await db.shoppingSessions.toArray()).map(s => [s.id, s])
  )
  for (const si of allSessionItems) {
    const prev = lastBoughtMap.get(si.itemId)
    if (prev && si.at >= prev) {
      const sess = sessionMap.get(si.sessionId)
      if (sess) lastShopMap.set(si.itemId, sess.shopId)
    }
  }

  return items.map(item => ({
    ...item,
    shops:           itemShopMap.get(item.id) ?? [],
    tags:            itemTagMap.get(item.id) ?? [],
    frequency:       freqMap.get(item.id) ?? 0,
    lastBoughtAt:    lastBoughtMap.get(item.id),
    lastBoughtShopId: lastShopMap.get(item.id),
  }))
}

export async function getListItemsWithItems(listId: string): Promise<ListItemWithItem[]> {
  const listItems = await db.listItems.where('listId').equals(listId).toArray()
  const skippedAll = await db.listItemSkippedShops.toArray()

  const skippedByListItem = new Map<string, string[]>()
  for (const s of skippedAll) {
    const arr = skippedByListItem.get(s.listItemId) ?? []
    arr.push(s.shopId)
    skippedByListItem.set(s.listItemId, arr)
  }

  const itemIds = [...new Set(listItems.map(li => li.itemId))]
  const items = await db.items.bulkGet(itemIds)
  const enriched = await enrichItems(items.filter((i): i is Item => i != null))
  const itemMap = new Map(enriched.map(i => [i.id, i]))

  return listItems
    .map(li => {
      const item = itemMap.get(li.itemId)
      if (!item) return null
      return {
        ...li,
        item,
        skippedShopIds: skippedByListItem.get(li.id) ?? [],
      }
    })
    .filter((x): x is ListItemWithItem => x !== null)
}

export async function getFrequentItems(listId: string, limit = 20): Promise<ItemWithDetails[]> {
  const activeOnList = new Set(
    (await db.listItems.where('listId').equals(listId).filter(li => li.state === 'active').toArray())
      .map(li => li.itemId)
  )

  const all = await getItemsWithDetails()
  return all
    .filter(i => !activeOnList.has(i.id) && !i.deletedAt)
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, limit)
}

export async function upsertItem(
  item: Item,
  shopIds: string[],
  tagIds: string[],
): Promise<void> {
  await db.transaction('rw', [db.items, db.itemShops, db.itemTags, db.tags, db.pendingSyncIds], async () => {
    await db.items.put(item)
    await db.itemShops.where('itemId').equals(item.id).delete()
    await db.itemShops.bulkPut(shopIds.map(shopId => ({ itemId: item.id, shopId })))
    await db.itemTags.where('itemId').equals(item.id).delete()
    await db.itemTags.bulkPut(tagIds.map(tagId => ({ itemId: item.id, tagId })))
    await db.pendingSyncIds.put({ id: item.id, entity: 'item', changedAt: new Date().toISOString() })
  })
}

export async function upsertListItem(listItem: ListItem): Promise<void> {
  await db.transaction('rw', [db.listItems, db.pendingSyncIds], async () => {
    await db.listItems.put(listItem)
    await db.pendingSyncIds.put({ id: listItem.id, entity: 'listItem', changedAt: new Date().toISOString() })
  })
}

export async function skipShopForListItem(listItemId: string, shopId: string): Promise<void> {
  await db.listItemSkippedShops.put({ listItemId, shopId, skippedAt: new Date().toISOString() })
}

export async function clearSkipForListItem(listItemId: string, shopId: string): Promise<void> {
  await db.listItemSkippedShops.delete([listItemId, shopId])
}

export async function recordSessionItem(si: SessionItem): Promise<void> {
  await db.sessionItems.put(si)
}

export async function isEmpty(): Promise<boolean> {
  const count = await db.items.count()
  return count === 0
}
