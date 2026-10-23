import { create } from 'zustand'
import type {
  SortMode,
  Shop, Tag, List, ListItem, ShoppingSession, SessionItem,
  ItemShop, ItemTag, ListItemSkippedShop,
  Item,
} from '../types'
import { apiClient } from '../api/client'

interface AppStore {
  shoppingModeShopId: string | null
  sortModes: Record<string, SortMode>

  shops: Shop[]
  items: Item[]
  tags: Tag[]
  lists: List[]
  listItems: ListItem[]
  shoppingSessions: ShoppingSession[]
  sessionItems: SessionItem[]
  itemShops: ItemShop[]
  itemTags: ItemTag[]
  listItemSkippedShops: ListItemSkippedShop[]

  enterShoppingMode: (shopId: string) => void
  exitShoppingMode: () => void
  setSortMode: (listId: string, mode: SortMode) => void

  loadData: () => Promise<void>
  addShop: (input: Omit<Shop, 'id' | 'version' | 'updatedAt'>) => Promise<void>
  updateShop: (id: string, patch: Partial<Shop>) => Promise<void>
  deleteShop: (id: string) => Promise<void>
  addTag: (name: string) => Promise<void>
  upsertItem: (item: Item, shopIds: string[], tagIds: string[]) => Promise<void>
  addItemToShop: (itemId: string, shopId: string) => Promise<void>
  removeItemFromShop: (itemId: string, shopId: string) => Promise<void>
  createOneTimeItem: (item: Item, shopIds: string[], tagIds: string[]) => Promise<void>
  upsertList: (list: List) => Promise<void>
  deleteList: (id: string) => Promise<void>
  cloneList: (id: string) => Promise<void>
  cloneListActive: (id: string) => Promise<void>
  upsertListItem: (li: ListItem) => Promise<void>
  updateListItemState: (id: string, state: 'active' | 'bought') => Promise<void>
  skipShopForListItem: (liId: string, shopId: string) => Promise<void>
  clearSkipForListItem: (liId: string, shopId: string) => Promise<void>
  createShoppingSession: (listId: string, shopId: string) => Promise<void>
  recordSessionItem: (input: { sessionId: string; itemId: string; action: 'bought' | 'skipped'; at: string }) => Promise<void>
}

export const useStore = create<AppStore>((set) => ({
  shoppingModeShopId: null,
  sortModes: JSON.parse(localStorage.getItem('sortModes') ?? '{}') as Record<string, SortMode>,

  shops: [],
  items: [],
  tags: [],
  lists: [],
  listItems: [],
  shoppingSessions: [],
  sessionItems: [],
  itemShops: [],
  itemTags: [],
  listItemSkippedShops: [],

  enterShoppingMode: (shopId) => set({ shoppingModeShopId: shopId }),
  exitShoppingMode: () => set({ shoppingModeShopId: null }),

  setSortMode: (listId, mode) =>
    set(state => {
      const sortModes = { ...state.sortModes, [listId]: mode }
      localStorage.setItem('sortModes', JSON.stringify(sortModes))
      return { sortModes }
    }),

  loadData: async () => {
    await apiClient.loadData()
    const [shops, tags, items, lists] = await Promise.all([
      apiClient.getShops(),
      apiClient.getTags(),
      apiClient.getItemsWithDetails(),
      apiClient.getLists(),
    ])
    const listItemsArr = await Promise.all(
      lists.map(l => apiClient.getListItemsWithItems(l.id))
    ).then(r => r.flat())
    set({ shops, tags, items, lists, listItems: listItemsArr })
  },

  addShop: async (input) => {
    const shop = await apiClient.createShop(input)
    set(state => ({ shops: [...state.shops, shop] }))
  },

  updateShop: async (id, patch) => {
    let updated: Shop | undefined
    if (patch.name !== undefined) updated = await apiClient.renameShop(id, patch.name)
    if (patch.color !== undefined) updated = await apiClient.changeShopColor(id, patch.color)
    if (updated) {
      set(state => ({ shops: state.shops.map(s => s.id === id ? updated : s) }))
    }
  },

  deleteShop: async (id) => {
    await apiClient.softDeleteShop(id)
    set(state => ({ shops: state.shops.filter(s => s.id !== id) }))
  },

  addTag: async (name) => {
    const tag = await apiClient.createTag(name)
    set(state => ({ tags: [...state.tags, tag] }))
  },

  upsertItem: async (item, shopIds, tagIds) => {
    const existing = useStore.getState().items.find(i => i.id === item.id)
    if (existing) {
      const patch: Partial<Item> = {}
      if (existing.name !== item.name) patch.name = item.name
      if (existing.unit !== item.unit) patch.unit = item.unit
      if (existing.defaultQuantity !== item.defaultQuantity) patch.defaultQuantity = item.defaultQuantity
      if (existing.description !== item.description) patch.description = item.description
      if (existing.notes !== item.notes) patch.notes = item.notes
      if (Object.keys(patch).length > 0) {
        await apiClient.updateItem(item.id, patch)
      }
      await apiClient.saveItemShopsAndTags(item.id, shopIds, tagIds)
    } else {
      await apiClient.createItem(
        {
          name: item.name,
          unit: item.unit,
          defaultQuantity: item.defaultQuantity,
          description: item.description,
          notes: item.notes,
        },
        shopIds,
        tagIds,
        item.id,
      )
    }
  },

  addItemToShop: async (itemId, shopId) => {
    await apiClient.assignShopToItem(itemId, shopId)
  },

  removeItemFromShop: async (itemId, shopId) => {
    await apiClient.removeShopFromItem(itemId, shopId)
  },

  createOneTimeItem: async (item, shopIds, tagIds) => {
    await apiClient.createOneTimeItem(
      {
        name: item.name,
        unit: item.unit,
        defaultQuantity: item.defaultQuantity,
        description: item.description,
        notes: item.notes,
      },
      shopIds,
      tagIds,
      item.id,
    )
  },

  upsertList: async (list) => {
    const exists = useStore.getState().lists.some(l => l.id === list.id)
    if (exists) {
      const saved = await apiClient.renameList(list.id, list.name)
      set(state => ({ lists: state.lists.map(l => l.id === list.id ? saved : l) }))
    } else {
      const saved = await apiClient.createList(list.name, list.id)
      set(state => ({ lists: [...state.lists, saved] }))
    }
  },

  deleteList: async (id) => {
    await apiClient.deleteList(id)
    set(state => ({ lists: state.lists.filter(l => l.id !== id) }))
  },

  cloneList: async (id) => {
    const cloned = await apiClient.cloneList(id)
    set(state => ({ lists: [...state.lists, cloned] }))
  },

  cloneListActive: async (id) => {
    const cloned = await apiClient.cloneListActive(id)
    set(state => ({ lists: [...state.lists, cloned] }))
  },

  upsertListItem: async (li) => {
    const existing = useStore.getState().listItems.find(x => x.id === li.id)
    if (!existing) {
      await apiClient.addListItem({
        listId: li.listId,
        itemId: li.itemId,
        state: li.state,
        quantity: li.quantity,
        unit: li.unit,
        notes: li.notes,
      })
      return
    }
    if (existing.state !== li.state) {
      await apiClient.setListItemState(li.id, li.state)
    }
    if (existing.quantity !== li.quantity || existing.unit !== li.unit) {
      await apiClient.changeListItemQuantity(li.id, li.quantity, li.unit)
    }
  },

  updateListItemState: async (id, state) => {
    await apiClient.setListItemState(id, state)
  },

  skipShopForListItem: async (liId, shopId) => {
    await apiClient.skipShopForListItem(liId, shopId)
  },

  clearSkipForListItem: async (liId, shopId) => {
    await apiClient.clearSkipForListItem(liId, shopId)
  },

  createShoppingSession: async (listId, shopId) => {
    await apiClient.startShoppingSession(listId, shopId)
  },

  recordSessionItem: async (input) => {
    await apiClient.recordSessionItem(input)
  },
}))
