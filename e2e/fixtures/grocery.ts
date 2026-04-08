import { test as base, expect, type Locator } from '@playwright/test'

export { expect }

// ─── Type mirrors of frontend/src/types/index.ts ────────────────────────────

export interface Shop {
  id: string; name: string; color: string
  version: number; updatedAt: string; deletedAt?: string
}
export interface Item {
  id: string; name: string; unit?: string; description?: string; notes?: string
  version: number; createdAt: string; updatedAt: string; deletedAt?: string
}
export interface Tag { id: string; name: string }
export interface ItemShop { itemId: string; shopId: string }
export interface ItemTag { itemId: string; tagId: string }
export interface List {
  id: string; name: string; version: number
  createdAt: string; updatedAt: string; deletedAt?: string
}
export interface ListItem {
  id: string; listId: string; itemId: string; state: 'active' | 'bought'
  quantity?: number; unit?: string; notes?: string
  version: number; addedAt: string; updatedAt: string
}
export interface ListItemSkippedShop { listItemId: string; shopId: string; skippedAt: string }
export interface ShoppingSession {
  id: string; listId: string; shopId: string
  startedAt: string; endedAt?: string; version: number
}
export interface SessionItem {
  id: string; sessionId: string; itemId: string; action: 'bought' | 'skipped'
  quantity?: number; unit?: string; at: string
}
export interface SyncChanges {
  shops: Shop[]; items: Item[]; tags: Tag[]
  itemShops: ItemShop[]; itemTags: ItemTag[]
  lists: List[]; listItems: ListItem[]
  listItemSkippedShops: ListItemSkippedShop[]
  shoppingSessions: ShoppingSession[]; sessionItems: SessionItem[]
}
export interface SyncResponse {
  serverTime: string; applied: string[]
  conflicts: Array<{ entity: string; id: string; client: unknown; server: unknown }>
  serverChanges: SyncChanges
}
export interface BootstrapResponse extends SyncChanges { serverTime: string }

// ─── Standalone API helpers ──────────────────────────────────────────────────

const BASE_URL = 'http://localhost:8080'

const EMPTY_CHANGES: SyncChanges = {
  shops: [], items: [], tags: [], itemShops: [], itemTags: [],
  lists: [], listItems: [], listItemSkippedShops: [],
  shoppingSessions: [], sessionItems: [],
}

export async function seedViaApi(
  data: Partial<SyncChanges>,
  lastSyncedAt = new Date(0).toISOString(),
): Promise<SyncResponse> {
  const res = await fetch(`${BASE_URL}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lastSyncedAt, changes: { ...EMPTY_CHANGES, ...data } }),
  })
  if (!res.ok) throw new Error(`seedViaApi failed: ${res.status} ${await res.text()}`)
  return res.json() as Promise<SyncResponse>
}

export async function resetViaApi(): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/bootstrap`)
  if (!res.ok) throw new Error(`resetViaApi bootstrap failed: ${res.status}`)
  const data = await res.json() as BootstrapResponse
  const now = new Date().toISOString()
  await seedViaApi({
    shops: data.shops
      .filter(s => !s.deletedAt)
      .map(s => ({ ...s, deletedAt: now, version: s.version + 1, updatedAt: now })),
    items: data.items
      .filter(i => !i.deletedAt)
      .map(i => ({ ...i, deletedAt: now, version: i.version + 1, updatedAt: now })),
    lists: data.lists
      .filter(l => !l.deletedAt)
      .map(l => ({ ...l, deletedAt: now, version: l.version + 1, updatedAt: now })),
  })
}

// ─── Fixture interface ───────────────────────────────────────────────────────

interface GroceryFixtures {
  /** POST /api/sync to seed server-side state */
  seedViaApi: (data: Partial<SyncChanges>, lastSyncedAt?: string) => Promise<SyncResponse>
  /** Soft-delete every visible entity via API (clean-slate helper) */
  resetViaApi: () => Promise<void>
  /**
   * Clear the browser's 'grocery' IndexedDB, then navigate to `path` and wait
   * for the app to bootstrap from the server (networkidle).
   */
  gotoApp: (path?: string) => Promise<void>
  /** Same as gotoApp but navigates to /list/:id */
  gotoList: (listId: string) => Promise<void>
  /** Simulate a left or right touch swipe on the given locator */
  swipeCard: (locator: Locator, direction: 'left' | 'right') => Promise<void>
}

// ─── Extended test ───────────────────────────────────────────────────────────

export const test = base.extend<GroceryFixtures>({
  seedViaApi: async ({}, use) => {
    await use(seedViaApi)
  },

  resetViaApi: async ({}, use) => {
    await use(resetViaApi)
  },

  gotoApp: async ({ page }, use) => {
    await use(async (path = '/') => {
      // Step 1: land on origin so we can access IndexedDB
      if (!page.url().startsWith('http://localhost:8080')) {
        await page.goto('http://localhost:8080/')
      }
      // Step 2: wipe local DB so the app bootstraps fresh from the server
      await page.evaluate(async () => {
        await new Promise<void>(resolve => {
          const req = indexedDB.deleteDatabase('grocery')
          req.onsuccess = req.onerror = () => resolve()
          req.onblocked = () => resolve()
        })
      })
      // Step 3: bootstrap at root — networkidle means the bootstrap fetch +
      // all Dexie writes have completed before we proceed.
      await page.goto('http://localhost:8080/')
      await page.waitForLoadState('networkidle')
      // Step 4: navigate to the actual target; Dexie is pre-populated so
      // every component's useEffect will find data on first read.
      if (path !== '/') {
        await page.goto(`http://localhost:8080${path}`)
        await page.waitForLoadState('networkidle')
      }
    })
  },

  gotoList: async ({ page }, use) => {
    await use(async (listId: string) => {
      if (!page.url().startsWith('http://localhost:8080')) {
        await page.goto('http://localhost:8080/')
      }
      await page.evaluate(async () => {
        await new Promise<void>(resolve => {
          const req = indexedDB.deleteDatabase('grocery')
          req.onsuccess = req.onerror = () => resolve()
          req.onblocked = () => resolve()
        })
      })
      // Bootstrap at root first so Dexie is populated
      await page.goto('http://localhost:8080/')
      await page.waitForLoadState('networkidle')
      // Then navigate to the list
      await page.goto(`http://localhost:8080/list/${listId}`)
      await page.waitForLoadState('networkidle')
    })
  },

  swipeCard: async ({ page }, use) => {
    await use(async (locator: Locator, direction: 'left' | 'right') => {
      const box = await locator.boundingBox()
      if (!box) throw new Error('swipeCard: element has no bounding box')

      const startX = box.x + box.width / 2
      const y = box.y + box.height / 2
      // Exceed the SWIPE_THRESHOLD (60px) used in ShoppingCard
      const endX = direction === 'left' ? startX - 80 : startX + 80

      await page.evaluate(
        ({ startX, y, endX }: { startX: number; y: number; endX: number }) => {
          const el = document.elementFromPoint(startX, y)
          if (!el) return
          const mkTouch = (x: number) =>
            new Touch({ identifier: 1, target: el, clientX: x, clientY: y })

          el.dispatchEvent(
            new TouchEvent('touchstart', {
              touches: [mkTouch(startX)],
              bubbles: true, cancelable: true,
            }),
          )
          // Fire several intermediate move events so swipeDelta accumulates
          const step = endX > startX ? 10 : -10
          for (let x = startX + step; Math.abs(x - endX) > Math.abs(step); x += step) {
            el.dispatchEvent(
              new TouchEvent('touchmove', {
                touches: [mkTouch(x)],
                bubbles: true, cancelable: true,
              }),
            )
          }
          el.dispatchEvent(
            new TouchEvent('touchmove', {
              touches: [mkTouch(endX)],
              bubbles: true, cancelable: true,
            }),
          )
          el.dispatchEvent(
            new TouchEvent('touchend', {
              changedTouches: [mkTouch(endX)],
              bubbles: true, cancelable: true,
            }),
          )
        },
        { startX, y, endX },
      )
    })
  },
})
