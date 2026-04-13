export interface Shop {
  id: string
  name: string
  color: string
  version: number
  updatedAt: string
  deletedAt?: string
}

export interface Item {
  id: string
  name: string
  unit?: string
  defaultQuantity?: number
  description?: string
  notes?: string
  version: number
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface Tag {
  id: string
  name: string
}

export interface ItemShop {
  itemId: string
  shopId: string
}

export interface ItemTag {
  itemId: string
  tagId: string
}

export interface List {
  id: string
  name: string
  version: number
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface ListItem {
  id: string
  listId: string
  itemId: string
  state: 'active' | 'bought'
  quantity?: number
  unit?: string
  notes?: string
  version: number
  addedAt: string
  updatedAt: string
}

export interface ListItemSkippedShop {
  listItemId: string
  shopId: string
  skippedAt: string
}

export interface ShoppingSession {
  id: string
  listId: string
  shopId: string
  startedAt: string
  endedAt?: string
  version: number
}

export interface SessionItem {
  id: string
  sessionId: string
  itemId: string
  action: 'bought' | 'skipped'
  quantity?: number
  unit?: string
  at: string
}

// Derived / view types

export interface ItemWithDetails extends Item {
  shops: Shop[]
  tags: Tag[]
  frequency: number        // times bought
  lastBoughtAt?: string
  lastBoughtShopId?: string
}

export interface ListItemWithItem extends ListItem {
  item: ItemWithDetails
  skippedShopIds: string[]
}

// Sync types

export interface SyncChanges {
  shops: Shop[]
  items: Item[]
  tags: Tag[]
  itemShops: ItemShop[]
  itemTags: ItemTag[]
  lists: List[]
  listItems: ListItem[]
  listItemSkippedShops: ListItemSkippedShop[]
  shoppingSessions: ShoppingSession[]
  sessionItems: SessionItem[]
}

export interface Conflict {
  entity: string
  id: string
  client: unknown
  server: unknown
}

export interface SyncRequest {
  lastSyncedAt: string
  changes: SyncChanges
}

export interface SyncResponse {
  serverTime: string
  applied: string[]
  conflicts: Conflict[]
  serverChanges: SyncChanges
}

export interface BootstrapResponse extends SyncChanges {
  serverTime: string
}

export type SortMode = 'date' | 'name' | 'frequency'
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'offline'
