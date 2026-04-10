import Dexie, { type Table } from 'dexie'
import type {
  Shop, Item, Tag, ItemShop, ItemTag,
  List, ListItem, ListItemSkippedShop,
  ShoppingSession, SessionItem,
} from '../types'
import { normalizeTag } from '../utils/tagUtils'

export class GroceryDB extends Dexie {
  shops!: Table<Shop, string>
  items!: Table<Item, string>
  tags!: Table<Tag, string>
  itemShops!: Table<ItemShop, [string, string]>
  itemTags!: Table<ItemTag, [string, string]>
  lists!: Table<List, string>
  listItems!: Table<ListItem, string>
  listItemSkippedShops!: Table<ListItemSkippedShop, [string, string]>
  shoppingSessions!: Table<ShoppingSession, string>
  sessionItems!: Table<SessionItem, string>

  // Client-side pending sync queue
  pendingSyncIds!: Table<{ id: string; entity: string; changedAt: string }, string>

  constructor() {
    super('grocery')

    this.version(1).stores({
      shops:                  'id, updatedAt',
      items:                  'id, name, updatedAt',
      tags:                   'id, name',
      itemShops:              '[itemId+shopId], itemId, shopId',
      itemTags:               '[itemId+tagId], itemId, tagId',
      lists:                  'id, updatedAt',
      listItems:              'id, listId, itemId, state, updatedAt',
      listItemSkippedShops:   '[listItemId+shopId], listItemId',
      shoppingSessions:       'id, listId, shopId, startedAt',
      sessionItems:           'id, sessionId, itemId, action, at',
      pendingSyncIds:         'id, entity, changedAt',
    })

    this.version(2).upgrade(async tx => {
      const tags: Tag[] = await tx.table('tags').toArray()

      // Build a map of normalizedName -> first tag id encountered (the one we keep)
      const normalizedToKeepId = new Map<string, string>()
      const idRemap = new Map<string, string>() // mergedId -> keepId
      const toDelete: string[] = []

      for (const tag of tags) {
        const normalized = normalizeTag(tag.name)
        if (normalizedToKeepId.has(normalized)) {
          // Duplicate after normalization — merge into the first one
          idRemap.set(tag.id, normalizedToKeepId.get(normalized)!)
          toDelete.push(tag.id)
        } else {
          normalizedToKeepId.set(normalized, tag.id)
          if (normalized !== tag.name) {
            await tx.table('tags').update(tag.id, { name: normalized })
          }
        }
      }

      if (idRemap.size > 0) {
        const itemTags: ItemTag[] = await tx.table('itemTags').toArray()
        for (const it of itemTags) {
          if (idRemap.has(it.tagId)) {
            const newTagId = idRemap.get(it.tagId)!
            await tx.table('itemTags').delete([it.itemId, it.tagId])
            const exists = await tx.table('itemTags').get([it.itemId, newTagId])
            if (!exists) {
              await tx.table('itemTags').put({ itemId: it.itemId, tagId: newTagId })
            }
          }
        }
        await tx.table('tags').bulkDelete(toDelete)
      }
    })
  }
}

export const db = new GroceryDB()
