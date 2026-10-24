import type {
  Shop, Item, Tag, List, ListItem, ShoppingSession, SessionItem,
  ItemShop, ItemTag, ListItemSkippedShop,
  ItemWithDetails, ListItemWithItem,
} from '../types'
import type { AppEvent } from '../types/event'
import { fetchRemoteEvents, publishPendingEvents, subscribeEventStream } from './transport'
import type { ServerEvent } from './transport'

type ItemCreateInput = {
  name: string
  unit?: string
  defaultQuantity?: number
  description?: string
  notes?: string
}

type ItemPatch = Partial<ItemCreateInput>

type EventInput = AppEvent extends infer U
  ? U extends AppEvent ? Omit<U, 'id' | 'clientId' | 'lamport' | 'timestamp'> : never
  : never

const SNAPSHOT_KEY = 'grocery-snapshot'

type Snapshot = {
  shops: Shop[]
  items: Item[]
  tags: Tag[]
  lists: List[]
  listItems: ListItem[]
  itemShops: ItemShop[]
  itemTags: ItemTag[]
  listItemSkippedShops: ListItemSkippedShop[]
  shoppingSessions: ShoppingSession[]
  sessionItems: SessionItem[]
  oneTimeItemIds: string[]
  outbox: AppEvent[]
  lastSeq: number
  lamport: number
  clientId: string
  lastTs: number
}

function normalize(s: string) {
  return s.trim().toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

class ApiClient {
  private shops = new Map<string, Shop>()
  private items = new Map<string, Item>()
  private tags = new Map<string, Tag>()
  private lists = new Map<string, List>()
  private listItems = new Map<string, ListItem>()
  private itemShops: ItemShop[] = []
  private itemTags: ItemTag[] = []
  private listItemSkippedShops: ListItemSkippedShop[] = []
  private shoppingSessions = new Map<string, ShoppingSession>()
  private sessionItems: SessionItem[] = []
  private oneTimeItemIds = new Set<string>()

  private events: AppEvent[] = []
  private appliedIds = new Set<string>()
  private outbox: AppEvent[] = []
  private clientId: string = crypto.randomUUID()
  private lamport = 0
  private lastTs = 0
  private lastSeq = 0
  private listeners = new Set<(e: AppEvent) => void>()
  private syncScheduled = false
  private streamUnsub: (() => void) | null = null

  private nowIso(): string {
    const t = Math.max(Date.now(), this.lastTs + 1)
    this.lastTs = t
    return new Date(t).toISOString()
  }

  private clearLocal() {
    this.shops.clear()
    this.items.clear()
    this.tags.clear()
    this.lists.clear()
    this.listItems.clear()
    this.itemShops = []
    this.itemTags = []
    this.listItemSkippedShops = []
    this.shoppingSessions.clear()
    this.sessionItems = []
    this.oneTimeItemIds.clear()
    this.events = []
    this.appliedIds.clear()
    this.outbox = []
    this.lamport = 0
    this.lastSeq = 0
    this.syncScheduled = false
    this.streamUnsub?.()
    this.streamUnsub = null
    localStorage.removeItem(SNAPSHOT_KEY)
  }

  reset() {
    this.clearLocal()
    this.listeners.clear()
  }

  private persist() {
    const snap: Snapshot = {
      shops: [...this.shops.values()],
      items: [...this.items.values()],
      tags: [...this.tags.values()],
      lists: [...this.lists.values()],
      listItems: [...this.listItems.values()],
      itemShops: this.itemShops,
      itemTags: this.itemTags,
      listItemSkippedShops: this.listItemSkippedShops,
      shoppingSessions: [...this.shoppingSessions.values()],
      sessionItems: this.sessionItems,
      oneTimeItemIds: [...this.oneTimeItemIds],
      outbox: this.outbox,
      lastSeq: this.lastSeq,
      lamport: this.lamport,
      clientId: this.clientId,
      lastTs: this.lastTs,
    }
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap))
    } catch {
      // storage unavailable (private mode / quota): keep running in memory
    }
  }

  private restore() {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    if (!raw) return
    try {
      const snap = JSON.parse(raw) as Snapshot
      this.shops = new Map(snap.shops.map(s => [s.id, s]))
      this.items = new Map(snap.items.map(i => [i.id, i]))
      this.tags = new Map(snap.tags.map(t => [t.id, t]))
      this.lists = new Map(snap.lists.map(l => [l.id, l]))
      this.listItems = new Map(snap.listItems.map(li => [li.id, li]))
      this.itemShops = snap.itemShops
      this.itemTags = snap.itemTags
      this.listItemSkippedShops = snap.listItemSkippedShops
      this.shoppingSessions = new Map(snap.shoppingSessions.map(s => [s.id, s]))
      this.sessionItems = snap.sessionItems
      this.oneTimeItemIds = new Set(snap.oneTimeItemIds)
      this.outbox = snap.outbox
      this.lastSeq = snap.lastSeq
      this.lamport = snap.lamport
      this.clientId = snap.clientId
      this.lastTs = snap.lastTs
    } catch {
      // corrupt snapshot: fall back to a fresh pull
    }
  }

  private stamp(event: EventInput): AppEvent {
    return {
      ...event,
      id: crypto.randomUUID(),
      clientId: this.clientId,
      lamport: ++this.lamport,
      timestamp: this.nowIso(),
    }
  }

  private commit(event: EventInput): AppEvent {
    const stamped = this.stamp(event)
    console.log(`[event] #${stamped.lamport} ${stamped.type}`, {
      entityId: stamped.entityId,
      payload: stamped.payload,
      timestamp: stamped.timestamp,
    })
    this.applyEvent(stamped)
    this.events.push(stamped)
    this.outbox.push(stamped)
    for (const listener of this.listeners) listener(stamped)
    this.scheduleSync()
    this.persist()
    return stamped
  }

  private scheduleSync() {
    if (this.syncScheduled) return
    this.syncScheduled = true
    queueMicrotask(() => {
      this.syncScheduled = false
      this.sync().catch(() => {})
    })
  }

  private mutate<T extends { id: string; version: number; updatedAt: string }>(
    map: Map<string, T>,
    id: string,
    patch: Partial<T>,
  ) {
    const existing = map.get(id)
    if (!existing) return
    map.set(id, {
      ...existing,
      ...patch,
      version: existing.version + 1,
      updatedAt: this.nowIso(),
    })
  }

  private applyEvent(event: AppEvent) {
    this.appliedIds.add(event.id)
    switch (event.type) {
      case 'ShopCreated':
        this.shops.set(event.entityId, {
          id: event.entityId, name: event.payload.name, color: event.payload.color,
          version: 1, updatedAt: event.timestamp,
        })
        break
      case 'ShopRenamed':
        this.mutate(this.shops, event.entityId, event.payload)
        break
      case 'ShopColorChanged':
        this.mutate(this.shops, event.entityId, event.payload)
        break
      case 'ShopSoftDeleted':
        this.mutate(this.shops, event.entityId, event.payload)
        break
      case 'TagCreated':
        this.tags.set(event.entityId, { id: event.entityId, name: event.payload.name })
        break
      case 'TagDeleted':
        this.tags.delete(event.entityId)
        break
      case 'ItemCreated':
        this.items.set(event.entityId, {
          id: event.entityId,
          name: event.payload.name,
          unit: event.payload.unit,
          defaultQuantity: event.payload.defaultQuantity,
          description: event.payload.description,
          notes: event.payload.notes,
          version: 1,
          createdAt: event.timestamp,
          updatedAt: event.timestamp,
        })
        break
      case 'OneTimeItemCreated':
        this.oneTimeItemIds.add(event.entityId)
        this.items.set(event.entityId, {
          id: event.entityId,
          name: event.payload.name,
          unit: event.payload.unit,
          defaultQuantity: event.payload.defaultQuantity,
          description: event.payload.description,
          notes: event.payload.notes,
          version: 1,
          createdAt: event.timestamp,
          updatedAt: event.timestamp,
        })
        break
      case 'ItemUpdated':
        this.mutate(this.items, event.entityId, event.payload)
        break
      case 'ItemSoftDeleted':
        this.mutate(this.items, event.entityId, event.payload)
        break
      case 'ShopAssignedToItem':
        if (!this.itemShops.some(is => is.itemId === event.entityId && is.shopId === event.payload.shopId)) {
          this.itemShops.push({ itemId: event.entityId, shopId: event.payload.shopId })
        }
        break
      case 'ShopRemovedFromItem':
        this.itemShops = this.itemShops.filter(is => !(is.itemId === event.entityId && is.shopId === event.payload.shopId))
        break
      case 'TagAssignedToItem':
        if (!this.itemTags.some(it => it.itemId === event.entityId && it.tagId === event.payload.tagId)) {
          this.itemTags.push({ itemId: event.entityId, tagId: event.payload.tagId })
        }
        break
      case 'TagRemovedFromItem':
        this.itemTags = this.itemTags.filter(it => !(it.itemId === event.entityId && it.tagId === event.payload.tagId))
        break
      case 'ListCreated':
        this.lists.set(event.entityId, {
          id: event.entityId, name: event.payload.name,
          version: 1, createdAt: event.timestamp, updatedAt: event.timestamp,
        })
        break
      case 'ListRenamed':
        this.mutate(this.lists, event.entityId, event.payload)
        break
      case 'ListArchived':
        this.mutate(this.lists, event.entityId, event.payload)
        break
      case 'ListUnarchived':
        this.mutate(this.lists, event.entityId, { archivedAt: undefined })
        break
      case 'ListDeleted':
        this.mutate(this.lists, event.entityId, event.payload)
        break
      case 'ListItemAdded':
        this.listItems.set(event.entityId, {
          id: event.entityId,
          listId: event.payload.listId,
          itemId: event.payload.itemId,
          state: event.payload.state,
          quantity: event.payload.quantity,
          unit: event.payload.unit,
          notes: event.payload.notes,
          version: 1,
          addedAt: event.timestamp,
          updatedAt: event.timestamp,
        })
        break
      case 'ListItemStateChanged':
        this.mutate(this.listItems, event.entityId, event.payload)
        break
      case 'ListItemQuantityChanged':
        this.mutate(this.listItems, event.entityId, event.payload)
        break
      case 'ListItemRemoved':
        this.listItems.delete(event.entityId)
        break
      case 'ShopSkippedForListItem':
        if (!this.listItemSkippedShops.some(s => s.listItemId === event.entityId && s.shopId === event.payload.shopId)) {
          this.listItemSkippedShops.push({ listItemId: event.entityId, shopId: event.payload.shopId, skippedAt: event.timestamp })
        }
        break
      case 'ShopSkipCleared':
        this.listItemSkippedShops = this.listItemSkippedShops.filter(
          s => !(s.listItemId === event.entityId && s.shopId === event.payload.shopId)
        )
        break
      case 'ShoppingSessionStarted':
        this.shoppingSessions.set(event.entityId, {
          id: event.entityId, listId: event.payload.listId, shopId: event.payload.shopId,
          startedAt: event.timestamp, version: 1,
        })
        break
      case 'SessionItemBought':
        if (!this.sessionItems.some(si => si.id === event.id)) {
          this.sessionItems.push({
            id: event.id,
            sessionId: event.entityId,
            itemId: event.payload.itemId,
            action: 'bought',
            at: event.timestamp,
            quantity: event.payload.quantity,
            unit: event.payload.unit,
          })
        }
        break
      case 'SessionItemSkipped':
        if (!this.sessionItems.some(si => si.id === event.id)) {
          this.sessionItems.push({
            id: event.id,
            sessionId: event.entityId,
            itemId: event.payload.itemId,
            action: 'skipped',
            at: event.timestamp,
          })
        }
        break
      case 'BugReported':
        break
    }
  }

  subscribe(listener: (e: AppEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async isEmpty(): Promise<boolean> {
    return this.items.size === 0
  }

  async getShops(): Promise<Shop[]> {
    return [...this.shops.values()]
  }

  async getShop(id: string): Promise<Shop | undefined> {
    return this.shops.get(id)
  }

  async getTags(): Promise<Tag[]> {
    return [...this.tags.values()]
  }

  async getItemsWithDetails(searchTerm?: string): Promise<ItemWithDetails[]> {
    let items = [...this.items.values()].filter(i => !i.deletedAt && !this.oneTimeItemIds.has(i.id))
    if (searchTerm) {
      const needle = normalize(searchTerm)
      items = items.filter(i => normalize(i.name).includes(needle))
    }
    return this.enrichItems(items)
  }

  async getItemWithDetails(id: string): Promise<ItemWithDetails | undefined> {
    if (this.oneTimeItemIds.has(id)) return undefined
    const item = this.items.get(id)
    if (!item) return undefined
    const enriched = this.enrichItems([item])
    return enriched[0]
  }

  async getItemsForShop(shopId: string): Promise<ItemWithDetails[]> {
    const itemIds = this.itemShops.filter(is => is.shopId === shopId).map(is => is.itemId)
    const items = itemIds.map(id => this.items.get(id)).filter((i): i is Item => i != null && !i.deletedAt && !this.oneTimeItemIds.has(i.id))
    return this.enrichItems(items)
  }

  async getFrequentItems(listId: string): Promise<ItemWithDetails[]> {
    const activeOnList = new Set(
      [...this.listItems.values()]
        .filter(li => li.listId === listId && li.state === 'active')
        .map(li => li.itemId)
    )
    const all = await this.getItemsWithDetails()
    return all
      .filter(i => !activeOnList.has(i.id))
      .sort((a, b) => b.frequency - a.frequency)
  }

  async getLists(): Promise<List[]> {
    return [...this.lists.values()]
  }

  async getList(id: string): Promise<List | undefined> {
    return this.lists.get(id)
  }

  async getListItemsWithItems(listId: string): Promise<ListItemWithItem[]> {
    const lis = [...this.listItems.values()].filter(li => li.listId === listId)
    const itemIds = [...new Set(lis.map(li => li.itemId))]
    const items = itemIds.map(id => this.items.get(id)).filter((i): i is Item => i != null)
    const enriched = this.enrichItems(items)
    const itemMap = new Map(enriched.map(i => [i.id, i]))
    return lis.map(li => ({
      ...li,
      item: itemMap.get(li.itemId)!,
      skippedShopIds: this.listItemSkippedShops
        .filter(s => s.listItemId === li.id)
        .map(s => s.shopId),
    }))
  }

  async getListItemsByItemId(itemId: string): Promise<ListItem[]> {
    return [...this.listItems.values()].filter(li => li.itemId === itemId)
  }

  async findOpenSession(listId: string, shopId: string): Promise<ShoppingSession | undefined> {
    return [...this.shoppingSessions.values()].find(s => s.listId === listId && s.shopId === shopId && !s.endedAt)
  }

  async getSessionItemsByItemId(itemId: string): Promise<SessionItem[]> {
    return this.sessionItems.filter(si => si.itemId === itemId).sort((a, b) => a.at.localeCompare(b.at))
  }

  async getShoppingSessionsByIds(ids: string[]): Promise<ShoppingSession[]> {
    const result: ShoppingSession[] = []
    for (const id of ids) {
      const s = this.shoppingSessions.get(id)
      if (s) result.push(s)
    }
    return result
  }

  async getSessionItems(sessionId: string): Promise<SessionItem[]> {
    return this.sessionItems.filter(si => si.sessionId === sessionId)
  }

  async getItemShopsByShop(shopId: string): Promise<ItemShop[]> {
    return this.itemShops.filter(is => is.shopId === shopId)
  }

  async createTagWithId(id: string, name: string): Promise<Tag> {
    const tag: Tag = { id, name }
    this.tags.set(tag.id, tag)
    return tag
  }

  async loadData(): Promise<void> {
    this.restore()
    try {
      const { events, lastSeq } = await fetchRemoteEvents(this.lastSeq)
      for (const e of events) this.applyRemoteEvent(e)
      this.lastSeq = Math.max(this.lastSeq, lastSeq)
    } catch {
      // offline: keep restored state; the outbox is retried by the next sync
    }
    try {
      await this.sync()
    } catch {
      // offline: keep the outbox for a later retry
    }
    this.persist()
  }

  async resync(): Promise<void> {
    this.clearLocal()
    try {
      const { events, lastSeq } = await fetchRemoteEvents(0)
      for (const e of events) this.applyRemoteEvent(e)
      this.lastSeq = Math.max(this.lastSeq, lastSeq)
    } catch {
      // network error: stay dropped and empty
    }
    this.persist()
    this.connectStream()
  }

  async sync(): Promise<void> {
    const since = this.lastSeq
    const hadPending = this.outbox.length > 0
    await publishPendingEvents(this.outbox)
    this.outbox = []
    if (hadPending) {
      // We just advanced the server's cursor with our own events, so events
      // published by other clients between our old cursor and the server's new
      // position must be pulled and applied, not skipped. Pull-and-apply from
      // the pre-sync cursor; our own just-published events are deduped by
      // appliedIds. We never advance lastSeq straight from resp.lastSeq.
      try {
        const { events, lastSeq } = await fetchRemoteEvents(since)
        for (const e of events) this.applyRemoteEvent(e)
        this.lastSeq = Math.max(this.lastSeq, lastSeq)
      } catch {
        // The pull failed (offline again). Leave lastSeq at its pre-sync value;
        // the stream/poller will backfill from there. Our own events are
        // already on the server and will be deduped on re-fetch.
      }
    }
    this.persist()
  }

  connectStream(): () => void {
    if (this.streamUnsub) this.streamUnsub()

    let stopped = false
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let graceTimer: ReturnType<typeof setTimeout> | null = null
    let failures = 0
    let abortStream: (() => void) | null = null

    const clearTimers = () => {
      if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null }
      if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null }
      if (graceTimer !== null) { clearTimeout(graceTimer); graceTimer = null }
    }

    const teardown = () => {
      if (stopped) return
      stopped = true
      clearTimers()
      abortStream?.()
      abortStream = null
    }
    this.streamUnsub = teardown

    const open = () => {
      if (stopped) return
      abortStream = subscribeEventStream(
        this.lastSeq,
        e => { if (!stopped) this.applyRemoteEvent(e) },
        () => {
          if (stopped) return
          if (graceTimer !== null) { clearTimeout(graceTimer); graceTimer = null }
          if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null }
          if (pollTimer === null) {
            pollTimer = setInterval(() => {
              void fetchRemoteEvents(this.lastSeq)
                .then(({ events, lastSeq }) => {
                  for (const e of events) this.applyRemoteEvent(e)
                  this.lastSeq = Math.max(this.lastSeq, lastSeq)
                })
                .catch(() => {})
            }, 3000)
          }
          failures += 1
          const delay = failures >= 4 ? 30000 : 2000 * 2 ** (failures - 1)
          retryTimer = setTimeout(() => {
            retryTimer = null
            open()
          }, delay)
        },
        () => {
          if (stopped) return
          // only treat the open as genuine once it survives the grace window:
          // a connection that dies immediately must not stop the poller
          graceTimer = setTimeout(() => {
            graceTimer = null
            if (stopped) return
            failures = 0
            clearTimers()
          }, 250)
        },
      )
    }

    open()
    return teardown
  }

  private applyRemoteEvent(e: ServerEvent) {
    this.lamport = Math.max(this.lamport, e.lamport)
    // Advance the cursor only over a contiguous prefix. A non-finite seq (a
    // legacy server that omits `seq` on live events) must not poison lastSeq
    // with NaN, and a gap (a dropped live event) must not be skipped: leave
    // lastSeq at the last contiguous seq so the next pull/stream-reconnect
    // backfills the gap instead of jumping past it.
    const seq = e.seq
    if (typeof seq === 'number' && Number.isFinite(seq) && seq === this.lastSeq + 1) {
      this.lastSeq = seq
    }
    if (this.appliedIds.has(e.id)) return
    this.applyEvent(e)
    for (const listener of this.listeners) listener(e)
  }

  // ── Mutations (granular events) ──────────────────────────────────────────────

  async createShop(input: { name: string; color: string }): Promise<Shop> {
    const id = crypto.randomUUID()
    this.commit({ entityId: id, type: 'ShopCreated', payload: { name: input.name, color: input.color } })
    return this.shops.get(id)!
  }

  async renameShop(id: string, name: string): Promise<Shop> {
    this.commit({ entityId: id, type: 'ShopRenamed', payload: { name } })
    return this.shops.get(id)!
  }

  async changeShopColor(id: string, color: string): Promise<Shop> {
    this.commit({ entityId: id, type: 'ShopColorChanged', payload: { color } })
    return this.shops.get(id)!
  }

  async softDeleteShop(id: string): Promise<void> {
    this.commit({ entityId: id, type: 'ShopSoftDeleted', payload: { deletedAt: this.nowIso() } })
  }

  async createTag(name: string): Promise<Tag> {
    const id = crypto.randomUUID()
    this.commit({ entityId: id, type: 'TagCreated', payload: { name } })
    return this.tags.get(id)!
  }

  async deleteTag(id: string): Promise<void> {
    this.commit({ entityId: id, type: 'TagDeleted', payload: {} })
  }

  async createItem(
    input: ItemCreateInput,
    shopIds: string[],
    tagIds: string[],
    id: string = crypto.randomUUID(),
  ): Promise<Item> {
    this.commit({ entityId: id, type: 'ItemCreated', payload: { ...input } })
    for (const shopId of shopIds) {
      this.commit({ entityId: id, type: 'ShopAssignedToItem', payload: { shopId } })
    }
    for (const tagId of tagIds) {
      this.commit({ entityId: id, type: 'TagAssignedToItem', payload: { tagId } })
    }
    return this.items.get(id)!
  }

  async createOneTimeItem(
    input: ItemCreateInput,
    shopIds: string[],
    tagIds: string[],
    id: string = crypto.randomUUID(),
  ): Promise<Item> {
    this.commit({ entityId: id, type: 'OneTimeItemCreated', payload: { ...input } })
    for (const shopId of shopIds) {
      this.commit({ entityId: id, type: 'ShopAssignedToItem', payload: { shopId } })
    }
    for (const tagId of tagIds) {
      this.commit({ entityId: id, type: 'TagAssignedToItem', payload: { tagId } })
    }
    return this.items.get(id)!
  }

  async isOneTimeItem(id: string): Promise<boolean> {
    return this.oneTimeItemIds.has(id)
  }

  async updateItem(id: string, patch: ItemPatch): Promise<Item> {
    this.commit({ entityId: id, type: 'ItemUpdated', payload: { ...patch } })
    return this.items.get(id)!
  }

  async assignShopToItem(itemId: string, shopId: string): Promise<void> {
    this.commit({ entityId: itemId, type: 'ShopAssignedToItem', payload: { shopId } })
  }

  async removeShopFromItem(itemId: string, shopId: string): Promise<void> {
    this.commit({ entityId: itemId, type: 'ShopRemovedFromItem', payload: { shopId } })
  }

  async assignTagToItem(itemId: string, tagId: string): Promise<void> {
    this.commit({ entityId: itemId, type: 'TagAssignedToItem', payload: { tagId } })
  }

  async removeTagFromItem(itemId: string, tagId: string): Promise<void> {
    this.commit({ entityId: itemId, type: 'TagRemovedFromItem', payload: { tagId } })
  }

  async saveItemShopsAndTags(itemId: string, shopIds: string[], tagIds: string[]): Promise<void> {
    const currentShops = new Set(this.itemShops.filter(is => is.itemId === itemId).map(is => is.shopId))
    const targetShops = new Set(shopIds)
    for (const shopId of currentShops) {
      if (!targetShops.has(shopId)) this.commit({ entityId: itemId, type: 'ShopRemovedFromItem', payload: { shopId } })
    }
    for (const shopId of targetShops) {
      if (!currentShops.has(shopId)) this.commit({ entityId: itemId, type: 'ShopAssignedToItem', payload: { shopId } })
    }
    const currentTags = new Set(this.itemTags.filter(it => it.itemId === itemId).map(it => it.tagId))
    const targetTags = new Set(tagIds)
    for (const tagId of currentTags) {
      if (!targetTags.has(tagId)) this.commit({ entityId: itemId, type: 'TagRemovedFromItem', payload: { tagId } })
    }
    for (const tagId of targetTags) {
      if (!currentTags.has(tagId)) this.commit({ entityId: itemId, type: 'TagAssignedToItem', payload: { tagId } })
    }
  }

  async softDeleteItem(id: string): Promise<void> {
    this.commit({ entityId: id, type: 'ItemSoftDeleted', payload: { deletedAt: this.nowIso() } })
  }

  async createList(name: string, id: string = crypto.randomUUID()): Promise<List> {
    this.commit({ entityId: id, type: 'ListCreated', payload: { name } })
    return this.lists.get(id)!
  }

  async renameList(id: string, name: string): Promise<List> {
    this.commit({ entityId: id, type: 'ListRenamed', payload: { name } })
    return this.lists.get(id)!
  }

  async archiveList(id: string): Promise<List> {
    this.commit({ entityId: id, type: 'ListArchived', payload: { archivedAt: this.nowIso() } })
    return this.lists.get(id)!
  }

  async unarchiveList(id: string): Promise<List> {
    const list = this.lists.get(id)
    if (!list) return undefined as unknown as List
    this.commit({ entityId: id, type: 'ListUnarchived', payload: {} })
    return this.lists.get(id)!
  }

  async deleteList(id: string): Promise<void> {
    this.commit({ entityId: id, type: 'ListDeleted', payload: { deletedAt: this.nowIso() } })
  }

  async cloneList(id: string, name?: string): Promise<List> {
    return this.cloneListFiltered(id, () => true, name)
  }

  async cloneListActive(id: string, name?: string): Promise<List> {
    return this.cloneListFiltered(id, li => li.state === 'active', name)
  }

  private cloneListFiltered(id: string, include: (li: ListItem) => boolean, name?: string): List {
    const original = this.lists.get(id)!
    const newId = crypto.randomUUID()
    this.commit({ entityId: newId, type: 'ListCreated', payload: { name: name ?? `Copy of ${original.name}` } })
    const originalItems = [...this.listItems.values()].filter(li => li.listId === id && include(li))
    for (const li of originalItems) {
      this.commit({
        entityId: crypto.randomUUID(),
        type: 'ListItemAdded',
        payload: {
          listId: newId,
          itemId: li.itemId,
          state: li.state,
          quantity: li.quantity,
          unit: li.unit,
          notes: li.notes,
        },
      })
    }
    return this.lists.get(newId)!
  }

  async addListItem(input: {
    listId: string
    itemId: string
    state: 'active' | 'bought'
    quantity?: number
    unit?: string
    notes?: string
  }): Promise<ListItem> {
    const id = crypto.randomUUID()
    this.commit({ entityId: id, type: 'ListItemAdded', payload: { ...input } })
    return this.listItems.get(id)!
  }

  async setListItemState(id: string, state: 'active' | 'bought'): Promise<ListItem> {
    const li = this.listItems.get(id)
    this.commit({ entityId: id, type: 'ListItemStateChanged', payload: { state } })
    if (state === 'bought' && li && this.oneTimeItemIds.has(li.itemId)) {
      await this.softDeleteItem(li.itemId)
    }
    return this.listItems.get(id)!
  }

  async changeListItemQuantity(id: string, quantity?: number, unit?: string): Promise<ListItem> {
    this.commit({ entityId: id, type: 'ListItemQuantityChanged', payload: { quantity: quantity as number, unit } })
    return this.listItems.get(id)!
  }

  async removeListItem(id: string): Promise<void> {
    const li = this.listItems.get(id)
    this.commit({ entityId: id, type: 'ListItemRemoved', payload: {} })
    if (li && this.oneTimeItemIds.has(li.itemId)) {
      await this.softDeleteItem(li.itemId)
    }
  }

  async skipShopForListItem(listItemId: string, shopId: string): Promise<void> {
    this.commit({ entityId: listItemId, type: 'ShopSkippedForListItem', payload: { shopId } })
  }

  async clearSkipForListItem(listItemId: string, shopId: string): Promise<void> {
    this.commit({ entityId: listItemId, type: 'ShopSkipCleared', payload: { shopId } })
  }

  async startShoppingSession(listId: string, shopId: string): Promise<ShoppingSession> {
    const id = crypto.randomUUID()
    this.commit({ entityId: id, type: 'ShoppingSessionStarted', payload: { listId, shopId } })
    return this.shoppingSessions.get(id)!
  }

  async recordSessionItem(input: {
    sessionId: string
    itemId: string
    action: 'bought' | 'skipped'
    at: string
    quantity?: number
    unit?: string
  }): Promise<SessionItem> {
    const event = input.action === 'bought'
      ? this.commit({
          entityId: input.sessionId,
          type: 'SessionItemBought',
          payload: { itemId: input.itemId, quantity: input.quantity, unit: input.unit },
        })
      : this.commit({
          entityId: input.sessionId,
          type: 'SessionItemSkipped',
          payload: { itemId: input.itemId },
        })
    return this.sessionItems.find(si => si.id === event.id)!
  }

  async reportBug(text: string): Promise<string> {
    const id = crypto.randomUUID()
    this.commit({ entityId: id, type: 'BugReported', payload: { text } })
    return id
  }

  private enrichItems(items: Item[]): ItemWithDetails[] {
    const shopMap = new Map([...this.shops.entries()])
    const tagMap = new Map([...this.tags.entries()])
    const sessionMap = new Map([...this.shoppingSessions.entries()])

    const itemShopMap = new Map<string, Shop[]>()
    for (const is of this.itemShops) {
      const shop = shopMap.get(is.shopId)
      if (!shop) continue
      const arr = itemShopMap.get(is.itemId) ?? []
      arr.push(shop)
      itemShopMap.set(is.itemId, arr)
    }

    const itemTagMap = new Map<string, Tag[]>()
    for (const it of this.itemTags) {
      const tag = tagMap.get(it.tagId)
      if (!tag) continue
      const arr = itemTagMap.get(it.itemId) ?? []
      arr.push(tag)
      itemTagMap.set(it.itemId, arr)
    }

    const boughtItems = this.sessionItems.filter(si => si.action === 'bought')
    const freqMap = new Map<string, number>()
    const lastBoughtMap = new Map<string, string>()
    const lastShopMap = new Map<string, string>()

    for (const si of boughtItems) {
      freqMap.set(si.itemId, (freqMap.get(si.itemId) ?? 0) + 1)
      const prev = lastBoughtMap.get(si.itemId)
      if (!prev || si.at > prev) {
        lastBoughtMap.set(si.itemId, si.at)
      }
    }

    for (const si of boughtItems) {
      const prev = lastBoughtMap.get(si.itemId)
      if (prev && si.at >= prev) {
        const sess = sessionMap.get(si.sessionId)
        if (sess) lastShopMap.set(si.itemId, sess.shopId)
      }
    }

    return items.map(item => ({
      ...item,
      shops: itemShopMap.get(item.id) ?? [],
      tags: itemTagMap.get(item.id) ?? [],
      frequency: freqMap.get(item.id) ?? 0,
      lastBoughtAt: lastBoughtMap.get(item.id),
      lastBoughtShopId: lastShopMap.get(item.id),
    }))
  }
}

export { type ItemPatch }
export const apiClient = new ApiClient()
