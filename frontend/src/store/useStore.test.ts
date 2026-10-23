import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { SortMode, Shop, Item, Tag, List, ListItem, ShoppingSession, SessionItem } from '../types'

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    reset: vi.fn(),
    getShops: vi.fn(),
    createShop: vi.fn(),
    renameShop: vi.fn(),
    changeShopColor: vi.fn(),
    softDeleteShop: vi.fn(),
    getTags: vi.fn(),
    createTag: vi.fn(),
    getItemsWithDetails: vi.fn(),
    getItemWithDetails: vi.fn(),
    createItem: vi.fn(),
    createOneTimeItem: vi.fn(),
    updateItem: vi.fn(),
    saveItemShopsAndTags: vi.fn(),
    assignShopToItem: vi.fn(),
    removeShopFromItem: vi.fn(),
    assignTagToItem: vi.fn(),
    removeTagFromItem: vi.fn(),
    getItemsForShop: vi.fn(),
    isEmpty: vi.fn(),
    loadData: vi.fn().mockResolvedValue(undefined),
    getLists: vi.fn(),
    createList: vi.fn(),
    renameList: vi.fn(),
    deleteList: vi.fn(),
    cloneList: vi.fn(),
    cloneListActive: vi.fn(),
    getListItemsWithItems: vi.fn(),
    addListItem: vi.fn(),
    setListItemState: vi.fn(),
    changeListItemQuantity: vi.fn(),
    removeListItem: vi.fn(),
    skipShopForListItem: vi.fn(),
    clearSkipForListItem: vi.fn(),
    getFrequentItems: vi.fn(),
    startShoppingSession: vi.fn(),
    recordSessionItem: vi.fn(),
    getSessionItems: vi.fn(),
  },
}))

vi.mock('../api/client', () => ({
  apiClient: mockApi,
}))

import { useStore } from './useStore'

const resetStore = () =>
  useStore.setState({
    shoppingModeShopId: null,
    sortModes: {},
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
  })

beforeEach(() => {
  localStorage.clear()
  resetStore()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Default state ──────────────────────────────────────────────────────────────

describe('useStore — default state', () => {
  it('has all data arrays empty', () => {
    const state = useStore.getState()
    expect(state.shops).toEqual([])
    expect(state.items).toEqual([])
    expect(state.tags).toEqual([])
    expect(state.lists).toEqual([])
    expect(state.listItems).toEqual([])
    expect(state.shoppingSessions).toEqual([])
    expect(state.sessionItems).toEqual([])
    expect(state.itemShops).toEqual([])
    expect(state.itemTags).toEqual([])
    expect(state.listItemSkippedShops).toEqual([])
  })

  it('has UI state defaults', () => {
    const state = useStore.getState()
    expect(state.shoppingModeShopId).toBeNull()
    expect(state.sortModes).toEqual({})
  })
})

// ── loadData ───────────────────────────────────────────────────────────────────

describe('useStore — loadData', () => {
  it('populates all arrays from apiClient', async () => {
    const shops: Shop[] = [{ id: 's1', name: 'Shop', color: '#f00', version: 1, updatedAt: '2024-01-01T00:00:00Z' }]
    const tags: Tag[] = [{ id: 't1', name: 'dairy' }]
    const lists: List[] = [{ id: 'l1', name: 'List', version: 1, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }]

    mockApi.getShops.mockResolvedValue(shops)
    mockApi.getTags.mockResolvedValue(tags)
    mockApi.getItemsWithDetails.mockResolvedValue([])
    mockApi.getLists.mockResolvedValue(lists)
    mockApi.getListItemsWithItems.mockResolvedValue([])
    mockApi.getFrequentItems.mockResolvedValue([])

    await useStore.getState().loadData()

    const state = useStore.getState()
    expect(state.shops).toEqual(shops)
    expect(state.tags).toEqual(tags)
    expect(state.lists).toEqual(lists)
  })

  it('calls apiClient.loadData() before populating state', async () => {
    mockApi.loadData.mockResolvedValue(undefined)
    mockApi.getShops.mockResolvedValue([])
    mockApi.getTags.mockResolvedValue([])
    mockApi.getItemsWithDetails.mockResolvedValue([])
    mockApi.getLists.mockResolvedValue([])
    mockApi.getListItemsWithItems.mockResolvedValue([])

    await useStore.getState().loadData()

    expect(mockApi.loadData).toHaveBeenCalled()
    expect(mockApi.loadData.mock.invocationCallOrder[0]!).toBeLessThan(
      mockApi.getShops.mock.invocationCallOrder[0]!
    )
  })

  it('rejects when the backend pull fails', async () => {
    mockApi.loadData.mockRejectedValue(new Error('down'))

    await expect(useStore.getState().loadData()).rejects.toThrow('down')

    expect(mockApi.getShops).not.toHaveBeenCalled()
    expect(useStore.getState().shops).toEqual([])
    expect(useStore.getState().lists).toEqual([])
  })
})

// ── Shop actions ───────────────────────────────────────────────────────────────

describe('useStore — shop actions', () => {
  it('addShop calls apiClient.createShop and updates state', async () => {
    const shop: Shop = { id: 's1', name: 'New', color: '#f00', version: 1, updatedAt: '2024-01-01T00:00:00Z' }
    mockApi.createShop.mockResolvedValue(shop)

    await useStore.getState().addShop({ name: 'New', color: '#f00' })
    expect(mockApi.createShop).toHaveBeenCalledWith({ name: 'New', color: '#f00' })
    expect(useStore.getState().shops).toEqual([shop])
  })

  it('updateShop with a name patch calls renameShop only', async () => {
    const shop: Shop = { id: 's1', name: 'New', color: '#f00', version: 1, updatedAt: '2024-01-01T00:00:00Z' }
    const updated: Shop = { ...shop, name: 'Renamed', version: 2 }
    useStore.setState({ shops: [shop] })
    mockApi.renameShop.mockResolvedValue(updated)

    await useStore.getState().updateShop('s1', { name: 'Renamed' })
    expect(mockApi.renameShop).toHaveBeenCalledWith('s1', 'Renamed')
    expect(mockApi.changeShopColor).not.toHaveBeenCalled()
    expect(useStore.getState().shops[0]!.name).toBe('Renamed')
  })

  it('updateShop with a color patch calls changeShopColor only', async () => {
    const shop: Shop = { id: 's1', name: 'New', color: '#f00', version: 1, updatedAt: '2024-01-01T00:00:00Z' }
    const updated: Shop = { ...shop, color: '#00f', version: 2 }
    useStore.setState({ shops: [shop] })
    mockApi.changeShopColor.mockResolvedValue(updated)

    await useStore.getState().updateShop('s1', { color: '#00f' })
    expect(mockApi.changeShopColor).toHaveBeenCalledWith('s1', '#00f')
    expect(mockApi.renameShop).not.toHaveBeenCalled()
    expect(useStore.getState().shops[0]!.color).toBe('#00f')
  })

  it('updateShop with name and color patch calls both methods', async () => {
    const shop: Shop = { id: 's1', name: 'New', color: '#f00', version: 1, updatedAt: '2024-01-01T00:00:00Z' }
    const updated: Shop = { ...shop, name: 'Renamed', color: '#00f', version: 2 }
    useStore.setState({ shops: [shop] })
    mockApi.renameShop.mockResolvedValue(updated)
    mockApi.changeShopColor.mockResolvedValue(updated)

    await useStore.getState().updateShop('s1', { name: 'Renamed', color: '#00f' })
    expect(mockApi.renameShop).toHaveBeenCalledWith('s1', 'Renamed')
    expect(mockApi.changeShopColor).toHaveBeenCalledWith('s1', '#00f')
  })

  it('deleteShop calls apiClient.softDeleteShop and removes from state', async () => {
    const shop: Shop = { id: 's1', name: 'New', color: '#f00', version: 1, updatedAt: '2024-01-01T00:00:00Z' }
    useStore.setState({ shops: [shop] })
    mockApi.softDeleteShop.mockResolvedValue(undefined)

    await useStore.getState().deleteShop('s1')
    expect(mockApi.softDeleteShop).toHaveBeenCalledWith('s1')
    expect(useStore.getState().shops).toEqual([])
  })
})

// ── Tag actions ────────────────────────────────────────────────────────────────

describe('useStore — tag actions', () => {
  it('addTag calls apiClient.createTag and updates state', async () => {
    const tag: Tag = { id: 't1', name: 'dairy' }
    mockApi.createTag.mockResolvedValue(tag)

    await useStore.getState().addTag('dairy')
    expect(mockApi.createTag).toHaveBeenCalledWith('dairy')
    expect(useStore.getState().tags).toEqual([tag])
  })
})

// ── Item actions ───────────────────────────────────────────────────────────────

describe('useStore — item actions', () => {
  it('upsertItem with a new item calls createItem with the caller-provided id', async () => {
    const item: Item = {
      id: 'i1', name: 'Milk', unit: 'l', defaultQuantity: 2, description: 'desc', notes: 'note',
      version: 1, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
    }
    mockApi.createItem.mockResolvedValue(item)

    await useStore.getState().upsertItem(item, ['s1'], ['t1'])
    expect(mockApi.createItem).toHaveBeenCalledWith(
      { name: 'Milk', unit: 'l', defaultQuantity: 2, description: 'desc', notes: 'note' },
      ['s1'],
      ['t1'],
      'i1',
    )
    expect(mockApi.saveItemShopsAndTags).not.toHaveBeenCalled()
    expect(mockApi.updateItem).not.toHaveBeenCalled()
  })

  it('upsertItem with an existing item calls updateItem (changed fields) + saveItemShopsAndTags', async () => {
    const existing: Item = {
      id: 'i1', name: 'Milk', unit: 'l', version: 1,
      createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
    }
    const incoming: Item = {
      id: 'i1', name: 'Skimmed Milk', unit: 'l', version: 1,
      createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
    }
    useStore.setState({ items: [existing] })
    mockApi.updateItem.mockResolvedValue(incoming)

    await useStore.getState().upsertItem(incoming, ['s1'], ['t1'])
    expect(mockApi.updateItem).toHaveBeenCalledWith('i1', { name: 'Skimmed Milk' })
    expect(mockApi.saveItemShopsAndTags).toHaveBeenCalledWith('i1', ['s1'], ['t1'])
    expect(mockApi.createItem).not.toHaveBeenCalled()
  })

  it('addItemToShop calls apiClient.assignShopToItem', async () => {
    mockApi.assignShopToItem.mockResolvedValue(undefined)
    await useStore.getState().addItemToShop('i1', 's1')
    expect(mockApi.assignShopToItem).toHaveBeenCalledWith('i1', 's1')
  })

  it('removeItemFromShop calls apiClient.removeShopFromItem', async () => {
    mockApi.removeShopFromItem.mockResolvedValue(undefined)
    await useStore.getState().removeItemFromShop('i1', 's1')
    expect(mockApi.removeShopFromItem).toHaveBeenCalledWith('i1', 's1')
  })

  it('createOneTimeItem passes the item payload, relations and caller id through to apiClient', async () => {
    const item: Item = {
      id: 'ot-1', name: 'Special Cheese', unit: 'kg', defaultQuantity: 1,
      version: 1, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
    }
    mockApi.createOneTimeItem.mockResolvedValue(item)

    await useStore.getState().createOneTimeItem(item, ['s1'], ['t1'])
    expect(mockApi.createOneTimeItem).toHaveBeenCalledWith(
      { name: 'Special Cheese', unit: 'kg', defaultQuantity: 1, description: undefined, notes: undefined },
      ['s1'],
      ['t1'],
      'ot-1',
    )
    expect(mockApi.createItem).not.toHaveBeenCalled()
  })
})

// ── List actions ───────────────────────────────────────────────────────────────

describe('useStore — list actions', () => {
  it('upsertList with a new list calls createList with the caller-provided id and appends to state', async () => {
    const list: List = { id: 'l1', name: 'List', version: 1, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }
    mockApi.createList.mockResolvedValue(list)

    await useStore.getState().upsertList(list)
    expect(mockApi.createList).toHaveBeenCalledWith('List', 'l1')
    expect(mockApi.renameList).not.toHaveBeenCalled()
    expect(useStore.getState().lists).toEqual([list])
  })

  it('upsertList with an existing list calls renameList and updates state', async () => {
    const list: List = { id: 'l1', name: 'Old Name', version: 1, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }
    const renamed: List = { ...list, name: 'New Name', version: 2 }
    useStore.setState({ lists: [list] })
    mockApi.renameList.mockResolvedValue(renamed)

    await useStore.getState().upsertList({ ...renamed })
    expect(mockApi.renameList).toHaveBeenCalledWith('l1', 'New Name')
    expect(mockApi.createList).not.toHaveBeenCalled()
    expect(useStore.getState().lists).toEqual([renamed])
  })

  it('deleteList calls apiClient.deleteList and removes from state', async () => {
    const list: List = { id: 'l1', name: 'List', version: 1, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }
    useStore.setState({ lists: [list] })
    mockApi.deleteList.mockResolvedValue(undefined)

    await useStore.getState().deleteList('l1')
    expect(mockApi.deleteList).toHaveBeenCalledWith('l1')
    expect(useStore.getState().lists).toEqual([])
  })

  it('cloneList calls apiClient.cloneList and adds to state', async () => {
    const list: List = { id: 'l1', name: 'List', version: 1, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }
    const cloned: List = { ...list, id: 'l2', name: 'Copy of List' }
    useStore.setState({ lists: [list] })
    mockApi.cloneList.mockResolvedValue(cloned)

    await useStore.getState().cloneList('l1')
    expect(mockApi.cloneList).toHaveBeenCalledWith('l1')
    expect(useStore.getState().lists).toHaveLength(2)
  })

  it('cloneListActive calls apiClient.cloneListActive and adds to state', async () => {
    const list: List = { id: 'l1', name: 'List', version: 1, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }
    const cloned: List = { ...list, id: 'l2', name: 'Copy of List' }
    useStore.setState({ lists: [list] })
    mockApi.cloneListActive.mockResolvedValue(cloned)

    await useStore.getState().cloneListActive('l1')
    expect(mockApi.cloneListActive).toHaveBeenCalledWith('l1')
    expect(useStore.getState().lists).toHaveLength(2)
  })
})

// ── ListItem actions ───────────────────────────────────────────────────────────

describe('useStore — listItem actions', () => {
  const makeLi = (overrides: Partial<ListItem> = {}): ListItem => ({
    id: 'li1', listId: 'l1', itemId: 'i1', state: 'active', quantity: 2, unit: 'l', notes: 'note',
    version: 1, addedAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  })

  it('upsertListItem with a new listItem calls addListItem (id generated internally)', async () => {
    const li = makeLi()
    mockApi.addListItem.mockResolvedValue(li)

    await useStore.getState().upsertListItem(li)
    expect(mockApi.addListItem).toHaveBeenCalledWith({
      listId: 'l1', itemId: 'i1', state: 'active', quantity: 2, unit: 'l', notes: 'note',
    })
    expect(mockApi.setListItemState).not.toHaveBeenCalled()
    expect(mockApi.changeListItemQuantity).not.toHaveBeenCalled()
  })

  it('upsertListItem with a state diff calls setListItemState', async () => {
    const existing = makeLi()
    useStore.setState({ listItems: [existing] })
    mockApi.setListItemState.mockResolvedValue({ ...existing, state: 'bought' })

    await useStore.getState().upsertListItem(makeLi({ state: 'bought' }))
    expect(mockApi.setListItemState).toHaveBeenCalledWith('li1', 'bought')
    expect(mockApi.changeListItemQuantity).not.toHaveBeenCalled()
    expect(mockApi.addListItem).not.toHaveBeenCalled()
  })

  it('upsertListItem with a quantity/unit diff calls changeListItemQuantity', async () => {
    const existing = makeLi()
    useStore.setState({ listItems: [existing] })
    mockApi.changeListItemQuantity.mockResolvedValue({ ...existing, quantity: 5, unit: 'kg' })

    await useStore.getState().upsertListItem(makeLi({ quantity: 5, unit: 'kg' }))
    expect(mockApi.changeListItemQuantity).toHaveBeenCalledWith('li1', 5, 'kg')
    expect(mockApi.setListItemState).not.toHaveBeenCalled()
    expect(mockApi.addListItem).not.toHaveBeenCalled()
  })

  it('updateListItemState calls apiClient.setListItemState', async () => {
    const li = makeLi()
    const updated: ListItem = { ...li, state: 'bought' }
    useStore.setState({ listItems: [li] })
    mockApi.setListItemState.mockResolvedValue(updated)

    await useStore.getState().updateListItemState('li1', 'bought')
    expect(mockApi.setListItemState).toHaveBeenCalledWith('li1', 'bought')
  })

  it('skipShopForListItem calls apiClient.skipShopForListItem', async () => {
    mockApi.skipShopForListItem.mockResolvedValue(undefined)
    await useStore.getState().skipShopForListItem('li1', 's1')
    expect(mockApi.skipShopForListItem).toHaveBeenCalledWith('li1', 's1')
  })

  it('clearSkipForListItem calls apiClient.clearSkipForListItem', async () => {
    mockApi.clearSkipForListItem.mockResolvedValue(undefined)
    await useStore.getState().clearSkipForListItem('li1', 's1')
    expect(mockApi.clearSkipForListItem).toHaveBeenCalledWith('li1', 's1')
  })
})

// ── Session actions ────────────────────────────────────────────────────────────

describe('useStore — session actions', () => {
  it('createShoppingSession calls apiClient.startShoppingSession', async () => {
    const session: ShoppingSession = { id: 'ss1', listId: 'l1', shopId: 's1', startedAt: '2024-01-01T00:00:00Z', version: 1 }
    mockApi.startShoppingSession.mockResolvedValue(session)

    await useStore.getState().createShoppingSession('l1', 's1')
    expect(mockApi.startShoppingSession).toHaveBeenCalledWith('l1', 's1')
  })

  it('recordSessionItem calls apiClient.recordSessionItem', async () => {
    const si = { sessionId: 'ss1', itemId: 'i1', action: 'bought' as const, at: '2024-01-01T00:00:00Z' }
    mockApi.recordSessionItem.mockResolvedValue({ id: 'si1', ...si })

    await useStore.getState().recordSessionItem(si)
    expect(mockApi.recordSessionItem).toHaveBeenCalledWith(si)
  })
})

// ── shopping mode (preserved from original) ────────────────────────────────────

describe('useStore — shopping mode', () => {
  it('shoppingModeShopId defaults to null', () => {
    expect(useStore.getState().shoppingModeShopId).toBeNull()
  })

  it('enterShoppingMode sets shopId', () => {
    useStore.getState().enterShoppingMode('shop-abc')
    expect(useStore.getState().shoppingModeShopId).toBe('shop-abc')
  })

  it('exitShoppingMode clears shopId', () => {
    useStore.getState().enterShoppingMode('shop-abc')
    useStore.getState().exitShoppingMode()
    expect(useStore.getState().shoppingModeShopId).toBeNull()
  })
})

// ── sortModes (preserved from original) ────────────────────────────────────────

describe('useStore — sortModes', () => {
  it('sortModes defaults to empty object', () => {
    expect(useStore.getState().sortModes).toEqual({})
  })

  it('setSortMode stores mode per-listId', () => {
    useStore.getState().setSortMode('list-1', 'name')
    expect(useStore.getState().sortModes['list-1']).toBe('name')
  })

  it('setSortMode does not affect other lists', () => {
    useStore.getState().setSortMode('list-1', 'name')
    useStore.getState().setSortMode('list-2', 'frequency')
    expect(useStore.getState().sortModes['list-1']).toBe('name')
    expect(useStore.getState().sortModes['list-2']).toBe('frequency')
  })

  it('setSortMode overwrites previous mode for same list', () => {
    useStore.getState().setSortMode('list-1', 'date')
    useStore.getState().setSortMode('list-1', 'frequency')
    expect(useStore.getState().sortModes['list-1']).toBe('frequency')
  })

  it('setSortMode writes sortModes to localStorage', () => {
    useStore.getState().setSortMode('list-1', 'name')
    expect(JSON.parse(localStorage.getItem('sortModes') ?? '{}')).toEqual({ 'list-1': 'name' })
  })

  it('setSortMode accumulates multiple lists in localStorage', () => {
    useStore.getState().setSortMode('list-1', 'name')
    useStore.getState().setSortMode('list-2', 'frequency')
    expect(JSON.parse(localStorage.getItem('sortModes') ?? '{}')).toEqual({ 'list-1': 'name', 'list-2': 'frequency' })
  })
})
