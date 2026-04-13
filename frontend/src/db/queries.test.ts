import { describe, it, expect, beforeEach } from 'vitest'
import { db } from './schema'
import {
  getItemsWithDetails,
  getFrequentItems,
  upsertItem,
  skipShopForListItem,
  clearSkipForListItem,
  isEmpty,
} from './queries'
import type { Item, Shop, SessionItem, ShoppingSession, ListItem } from '../types'

// Helpers to build minimal valid records
const makeShop = (id: string, color = '#ff0000'): Shop => ({
  id,
  name: `Shop ${id}`,
  color,
  version: 1,
  updatedAt: new Date().toISOString(),
})

const makeItem = (id: string, name: string): Item => ({
  id,
  name,
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

const makeListItem = (id: string, listId: string, itemId: string, state: 'active' | 'bought' = 'active'): ListItem => ({
  id,
  listId,
  itemId,
  state,
  version: 1,
  addedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

const makeSession = (id: string, listId: string, shopId: string): ShoppingSession => ({
  id,
  listId,
  shopId,
  startedAt: new Date().toISOString(),
  version: 1,
})

const makeSessionItem = (id: string, sessionId: string, itemId: string, at: string): SessionItem => ({
  id,
  sessionId,
  itemId,
  action: 'bought',
  at,
})

// Wipe all tables before each test for a clean slate
beforeEach(async () => {
  await db.transaction('rw', [
    db.shops, db.items, db.tags, db.itemShops, db.itemTags,
    db.lists, db.listItems, db.listItemSkippedShops,
    db.shoppingSessions, db.sessionItems, db.pendingSyncIds,
  ], async () => {
    await Promise.all([
      db.shops.clear(),
      db.items.clear(),
      db.tags.clear(),
      db.itemShops.clear(),
      db.itemTags.clear(),
      db.lists.clear(),
      db.listItems.clear(),
      db.listItemSkippedShops.clear(),
      db.shoppingSessions.clear(),
      db.sessionItems.clear(),
      db.pendingSyncIds.clear(),
    ])
  })
})

// ── getItemsWithDetails ────────────────────────────────────────────────────────

describe('getItemsWithDetails', () => {
  it('getItemsWithDetails_emptyDB returns empty array', async () => {
    const result = await getItemsWithDetails()
    expect(result).toEqual([])
  })

  it('getItemsWithDetails_withItems returns enriched result with correct shops array', async () => {
    const shop1 = makeShop('shop-1', '#ff0000')
    const shop2 = makeShop('shop-2', '#00ff00')
    const item = makeItem('item-1', 'Milk')

    await db.shops.bulkPut([shop1, shop2])
    await db.items.put(item)
    await db.itemShops.bulkPut([
      { itemId: 'item-1', shopId: 'shop-1' },
      { itemId: 'item-1', shopId: 'shop-2' },
    ])

    const result = await getItemsWithDetails()
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('Milk')
    expect(result[0]!.shops).toHaveLength(2)
    const shopIds = result[0]!.shops.map(s => s.id)
    expect(shopIds).toContain('shop-1')
    expect(shopIds).toContain('shop-2')
  })

  it('getItemsWithDetails_withItems excludes deleted items', async () => {
    await db.items.bulkPut([
      makeItem('item-1', 'Active'),
      { ...makeItem('item-2', 'Deleted'), deletedAt: new Date().toISOString() },
    ])
    const result = await getItemsWithDetails()
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('Active')
  })

  it('getItemsWithDetails_withItems returns empty shops array when item has no shops', async () => {
    await db.items.put(makeItem('item-1', 'Eggs'))
    const result = await getItemsWithDetails()
    expect(result[0]!.shops).toEqual([])
    expect(result[0]!.tags).toEqual([])
    expect(result[0]!.frequency).toBe(0)
  })

  it('getItemsWithDetails_searchFilter returns matching items only', async () => {
    await db.items.bulkPut([
      makeItem('item-1', 'Whole Milk'),
      makeItem('item-2', 'Oat Milk'),
      makeItem('item-3', 'Eggs'),
    ])
    const result = await getItemsWithDetails('milk')
    expect(result).toHaveLength(2)
    expect(result.map(i => i.name).sort()).toEqual(['Oat Milk', 'Whole Milk'])
  })

  it('getItemsWithDetails_searchFilter is case-insensitive', async () => {
    await db.items.bulkPut([
      makeItem('item-1', 'Whole Milk'),
      makeItem('item-2', 'BUTTER'),
    ])
    const result = await getItemsWithDetails('MILK')
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('Whole Milk')
  })

  it('getItemsWithDetails_searchFilter returns empty when no match', async () => {
    await db.items.put(makeItem('item-1', 'Eggs'))
    const result = await getItemsWithDetails('xyz')
    expect(result).toEqual([])
  })

  it('getItemsWithDetails_searchFilter matches Polish diacritics with plain ASCII', async () => {
    await db.items.bulkPut([
      makeItem('item-1', 'Jabłka'),
      makeItem('item-2', 'Żółw'),
      makeItem('item-3', 'Eggs'),
    ])
    const result1 = await getItemsWithDetails('jabl')
    expect(result1).toHaveLength(1)
    expect(result1[0]!.name).toBe('Jabłka')

    const result2 = await getItemsWithDetails('zolw')
    expect(result2).toHaveLength(1)
    expect(result2[0]!.name).toBe('Żółw')
  })

  it('getItemsWithDetails_searchFilter matches when search term has diacritics and name does not', async () => {
    await db.items.put(makeItem('item-1', 'Jablka'))
    const result = await getItemsWithDetails('jabłka')
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('Jablka')
  })

  it('getItemsWithDetails_searchFilter matches when search term has trailing or leading whitespace', async () => {
    await db.items.put(makeItem('item-1', 'szczypiorek'))
    const resultTrailing = await getItemsWithDetails('szczypiorek ')
    expect(resultTrailing).toHaveLength(1)
    expect(resultTrailing[0]!.name).toBe('szczypiorek')

    const resultLeading = await getItemsWithDetails(' szczypiorek')
    expect(resultLeading).toHaveLength(1)
    expect(resultLeading[0]!.name).toBe('szczypiorek')
  })
})

// ── getFrequentItems ───────────────────────────────────────────────────────────

describe('getFrequentItems', () => {
  it('getFrequentItems_excludesActiveOnList excludes items active on given list', async () => {
    await db.items.bulkPut([
      makeItem('item-1', 'Milk'),
      makeItem('item-2', 'Eggs'),
    ])
    await db.listItems.put(makeListItem('li-1', 'list-1', 'item-1', 'active'))

    const result = await getFrequentItems('list-1')
    const ids = result.map(i => i.id)
    expect(ids).not.toContain('item-1')
    expect(ids).toContain('item-2')
  })

  it('getFrequentItems_excludesActiveOnList includes bought items on list', async () => {
    await db.items.bulkPut([
      makeItem('item-1', 'Milk'),
      makeItem('item-2', 'Eggs'),
    ])
    // bought state should NOT exclude from suggestions
    await db.listItems.put(makeListItem('li-1', 'list-1', 'item-1', 'bought'))

    const result = await getFrequentItems('list-1')
    const ids = result.map(i => i.id)
    expect(ids).toContain('item-1')
  })

  it('getFrequentItems_sortsByFrequency returns items ordered by buy count descending', async () => {
    await db.items.bulkPut([
      makeItem('item-1', 'Rare'),
      makeItem('item-2', 'Common'),
      makeItem('item-3', 'Most Common'),
    ])

    const session = makeSession('sess-1', 'list-1', 'shop-1')
    await db.shoppingSessions.put(session)

    const t1 = '2024-01-01T10:00:00.000Z'
    const t2 = '2024-01-02T10:00:00.000Z'
    const t3 = '2024-01-03T10:00:00.000Z'

    await db.sessionItems.bulkPut([
      makeSessionItem('si-1', 'sess-1', 'item-3', t1),
      makeSessionItem('si-2', 'sess-1', 'item-3', t2),
      makeSessionItem('si-3', 'sess-1', 'item-3', t3),
      makeSessionItem('si-4', 'sess-1', 'item-2', t1),
      makeSessionItem('si-5', 'sess-1', 'item-2', t2),
      makeSessionItem('si-6', 'sess-1', 'item-1', t1),
    ])

    const result = await getFrequentItems('list-X')
    expect(result[0]!.id).toBe('item-3')
    expect(result[1]!.id).toBe('item-2')
    expect(result[2]!.id).toBe('item-1')
    expect(result[0]!.frequency).toBe(3)
    expect(result[1]!.frequency).toBe(2)
    expect(result[2]!.frequency).toBe(1)
  })
})

// ── upsertItem ─────────────────────────────────────────────────────────────────

describe('upsertItem', () => {
  it('upsertItem_createsNewItem creates item with shops and tags', async () => {
    const shop = makeShop('shop-1')
    await db.shops.put(shop)
    await db.tags.put({ id: 'tag-1', name: 'dairy' })

    const item = makeItem('item-1', 'Milk')
    await upsertItem(item, ['shop-1'], ['tag-1'])

    const saved = await db.items.get('item-1')
    expect(saved).toBeDefined()
    expect(saved!.name).toBe('Milk')

    const itemShops = await db.itemShops.where('itemId').equals('item-1').toArray()
    expect(itemShops).toHaveLength(1)
    expect(itemShops[0]!.shopId).toBe('shop-1')

    const itemTags = await db.itemTags.where('itemId').equals('item-1').toArray()
    expect(itemTags).toHaveLength(1)
    expect(itemTags[0]!.tagId).toBe('tag-1')
  })

  it('upsertItem_createsNewItem adds entry to pendingSyncIds', async () => {
    const item = makeItem('item-2', 'Eggs')
    await upsertItem(item, [], [])

    const pending = await db.pendingSyncIds.get('item-2')
    expect(pending).toBeDefined()
    expect(pending!.entity).toBe('item')
  })

  it('upsertItem_updatesExisting overwrites name and replaces shops', async () => {
    await db.shops.bulkPut([makeShop('shop-1'), makeShop('shop-2')])

    const item = makeItem('item-1', 'Whole Milk')
    await upsertItem(item, ['shop-1'], [])

    // Update — change name, swap shop
    const updated = { ...item, name: 'Skimmed Milk', updatedAt: new Date().toISOString() }
    await upsertItem(updated, ['shop-2'], [])

    // Only one item should exist
    const allItems = await db.items.toArray()
    expect(allItems).toHaveLength(1)
    expect(allItems[0]!.name).toBe('Skimmed Milk')

    // Shops replaced: only shop-2
    const itemShops = await db.itemShops.where('itemId').equals('item-1').toArray()
    expect(itemShops).toHaveLength(1)
    expect(itemShops[0]!.shopId).toBe('shop-2')
  })
})

// ── skipShopForListItem / clearSkipForListItem ─────────────────────────────────

describe('skipShopForListItem', () => {
  it('skipShopForListItem creates row in listItemSkippedShops', async () => {
    await skipShopForListItem('li-1', 'shop-1')

    const row = await db.listItemSkippedShops.get(['li-1', 'shop-1'])
    expect(row).toBeDefined()
    expect(row!.listItemId).toBe('li-1')
    expect(row!.shopId).toBe('shop-1')
    expect(row!.skippedAt).toBeDefined()
  })

  it('skipShopForListItem is idempotent — put again updates skippedAt', async () => {
    await skipShopForListItem('li-1', 'shop-1')
    await skipShopForListItem('li-1', 'shop-1')

    const rows = await db.listItemSkippedShops.where('listItemId').equals('li-1').toArray()
    expect(rows).toHaveLength(1)
  })
})

describe('clearSkipForListItem', () => {
  it('clearSkipForListItem removes row', async () => {
    await skipShopForListItem('li-1', 'shop-1')
    await clearSkipForListItem('li-1', 'shop-1')

    const row = await db.listItemSkippedShops.get(['li-1', 'shop-1'])
    expect(row).toBeUndefined()
  })

  it('clearSkipForListItem only removes the targeted shop, not others', async () => {
    await skipShopForListItem('li-1', 'shop-1')
    await skipShopForListItem('li-1', 'shop-2')
    await clearSkipForListItem('li-1', 'shop-1')

    const remaining = await db.listItemSkippedShops.where('listItemId').equals('li-1').toArray()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.shopId).toBe('shop-2')
  })

  it('clearSkipForListItem is a no-op when row does not exist', async () => {
    // Should not throw
    await expect(clearSkipForListItem('no-such-li', 'no-such-shop')).resolves.not.toThrow()
  })
})

// ── isEmpty ────────────────────────────────────────────────────────────────────

describe('isEmpty', () => {
  it('isEmpty returns true on empty DB', async () => {
    expect(await isEmpty()).toBe(true)
  })

  it('isEmpty returns false after adding an item', async () => {
    await db.items.put(makeItem('item-1', 'Milk'))
    expect(await isEmpty()).toBe(false)
  })
})
