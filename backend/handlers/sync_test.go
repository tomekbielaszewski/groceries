package handlers_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"grocery/models"
)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func ptr[T any](v T) *T { return &v }

// emptyChanges returns a SyncChanges with all slices initialised to non-nil
// so JSON serialisation produces [] rather than null.
func emptyChanges() models.SyncChanges {
	return models.SyncChanges{
		Shops:                []models.Shop{},
		Items:                []models.Item{},
		Tags:                 []models.Tag{},
		ItemShops:            []models.ItemShop{},
		ItemTags:             []models.ItemTag{},
		Lists:                []models.List{},
		ListItems:            []models.ListItem{},
		ListItemSkippedShops: []models.ListItemSkippedShop{},
		ShoppingSessions:     []models.ShoppingSession{},
		SessionItems:         []models.SessionItem{},
	}
}

// syncRequest constructs a SyncRequest using the given lastSyncedAt and
// changes, filling in default empty slices where the caller left them nil.
func syncRequest(lastSyncedAt time.Time, changes models.SyncChanges) models.SyncRequest {
	return models.SyncRequest{
		LastSyncedAt: lastSyncedAt,
		Changes:      changes,
	}
}

// ---------------------------------------------------------------------------
// TestSync_EmptyPayload
// ---------------------------------------------------------------------------

func TestSync_EmptyPayload(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	req := syncRequest(time.Now().UTC().Add(-time.Hour), emptyChanges())
	resp := doSync(t, srv, req)

	assert.NotNil(t, resp.Applied)
	assert.NotNil(t, resp.Conflicts)
	assert.Empty(t, resp.Applied)
	assert.Empty(t, resp.Conflicts)

	// serverChanges collections must be present and empty.
	assert.NotNil(t, resp.ServerChanges.Shops)
	assert.NotNil(t, resp.ServerChanges.Items)
	assert.NotNil(t, resp.ServerChanges.Lists)
	assert.NotNil(t, resp.ServerChanges.ListItems)
	assert.Empty(t, resp.ServerChanges.Shops)
	assert.Empty(t, resp.ServerChanges.Items)
	assert.Empty(t, resp.ServerChanges.Lists)
	assert.Empty(t, resp.ServerChanges.ListItems)
}

// ---------------------------------------------------------------------------
// TestSync_NewShop
// ---------------------------------------------------------------------------

func TestSync_NewShop(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	now := time.Now().UTC().Truncate(time.Millisecond)
	shop := models.Shop{
		ID:        "shop-new-1",
		Name:      "Aldi",
		Color:     "#0000ff",
		Version:   1,
		UpdatedAt: now,
	}

	changes := emptyChanges()
	changes.Shops = []models.Shop{shop}

	resp := doSync(t, srv, syncRequest(now.Add(-time.Hour), changes))

	require.Contains(t, resp.Applied, "shop-new-1", "new shop ID must appear in applied")
	assert.Empty(t, resp.Conflicts)

	// Verify the shop is visible in bootstrap.
	br := doBootstrap(t, srv)
	require.Len(t, br.Shops, 1)
	assert.Equal(t, "shop-new-1", br.Shops[0].ID)
	assert.Equal(t, "Aldi", br.Shops[0].Name)
	assert.Equal(t, "#0000ff", br.Shops[0].Color)
}

// ---------------------------------------------------------------------------
// TestSync_NewItem
// ---------------------------------------------------------------------------

func TestSync_NewItem(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	now := time.Now().UTC().Truncate(time.Millisecond)
	item := models.Item{
		ID:        "item-new-1",
		Name:      "Eggs",
		Version:   1,
		CreatedAt: now,
		UpdatedAt: now,
	}

	changes := emptyChanges()
	changes.Items = []models.Item{item}

	resp := doSync(t, srv, syncRequest(now.Add(-time.Hour), changes))

	require.Contains(t, resp.Applied, "item-new-1")
	assert.Empty(t, resp.Conflicts)

	br := doBootstrap(t, srv)
	require.Len(t, br.Items, 1)
	assert.Equal(t, "Eggs", br.Items[0].Name)
}

// ---------------------------------------------------------------------------
// TestSync_NewList
// ---------------------------------------------------------------------------

func TestSync_NewList(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	now := time.Now().UTC().Truncate(time.Millisecond)
	list := models.List{
		ID:        "list-new-1",
		Name:      "Weekend Shop",
		Version:   1,
		CreatedAt: now,
		UpdatedAt: now,
	}

	changes := emptyChanges()
	changes.Lists = []models.List{list}

	resp := doSync(t, srv, syncRequest(now.Add(-time.Hour), changes))

	require.Contains(t, resp.Applied, "list-new-1")
	assert.Empty(t, resp.Conflicts)

	br := doBootstrap(t, srv)
	require.Len(t, br.Lists, 1)
	assert.Equal(t, "Weekend Shop", br.Lists[0].Name)
}

// ---------------------------------------------------------------------------
// TestSync_NewListItem
// ---------------------------------------------------------------------------

func TestSync_NewListItem(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	now := time.Now().UTC().Truncate(time.Millisecond)
	lastSync := now.Add(-time.Hour)

	shop := models.Shop{ID: "s1", Name: "Tesco", Color: "#red1", Version: 1, UpdatedAt: now}
	item := models.Item{ID: "i1", Name: "Bread", Version: 1, CreatedAt: now, UpdatedAt: now}
	list := models.List{ID: "l1", Name: "Daily", Version: 1, CreatedAt: now, UpdatedAt: now}
	listItem := models.ListItem{
		ID:        "li1",
		ListID:    "l1",
		ItemID:    "i1",
		State:     "active",
		Version:   1,
		AddedAt:   now,
		UpdatedAt: now,
	}

	changes := emptyChanges()
	changes.Shops = []models.Shop{shop}
	changes.Items = []models.Item{item}
	changes.Lists = []models.List{list}
	changes.ListItems = []models.ListItem{listItem}

	resp := doSync(t, srv, syncRequest(lastSync, changes))

	assert.Contains(t, resp.Applied, "s1")
	assert.Contains(t, resp.Applied, "i1")
	assert.Contains(t, resp.Applied, "l1")
	assert.Contains(t, resp.Applied, "li1")
	assert.Empty(t, resp.Conflicts)

	br := doBootstrap(t, srv)
	require.Len(t, br.ListItems, 1)
	assert.Equal(t, "li1", br.ListItems[0].ID)
	assert.Equal(t, "l1", br.ListItems[0].ListID)
	assert.Equal(t, "i1", br.ListItems[0].ItemID)
}

// ---------------------------------------------------------------------------
// TestSync_UpdateItem_ClientNewer
// ---------------------------------------------------------------------------

func TestSync_UpdateItem_ClientNewer(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	base := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Millisecond)
	lastSync := base.Add(30 * time.Minute) // sync happened after the original insert
	clientUpdatedAt := lastSync.Add(10 * time.Minute)

	// Seed item v1 directly in the DB (simulates server state before client knew about update).
	_, err := database.Exec(
		`INSERT INTO items(id, name, version, created_at, updated_at) VALUES(?,?,?,?,?)`,
		"item-upd-1", "OldName", 1,
		base.Format(time.RFC3339Nano), base.Format(time.RFC3339Nano),
	)
	require.NoError(t, err)

	// Client sends v2 with a newer updatedAt.
	item := models.Item{
		ID:        "item-upd-1",
		Name:      "NewName",
		Version:   2,
		CreatedAt: base,
		UpdatedAt: clientUpdatedAt,
	}
	changes := emptyChanges()
	changes.Items = []models.Item{item}

	resp := doSync(t, srv, syncRequest(lastSync, changes))

	require.Contains(t, resp.Applied, "item-upd-1", "client-newer update must be applied")
	assert.Empty(t, resp.Conflicts)

	// DB must reflect the new name.
	var name string
	require.NoError(t, database.QueryRow(`SELECT name FROM items WHERE id=?`, "item-upd-1").Scan(&name))
	assert.Equal(t, "NewName", name)
}

// ---------------------------------------------------------------------------
// TestSync_UpdateItem_ServerNewer
// ---------------------------------------------------------------------------

func TestSync_UpdateItem_ServerNewer(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	base := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Millisecond)
	lastSync := base.Add(30 * time.Minute)
	serverUpdatedAt := lastSync.Add(20 * time.Minute) // server updated after lastSync
	clientUpdatedAt := base.Add(10 * time.Minute)     // client updated BEFORE lastSync

	// Seed item with a newer server timestamp.
	_, err := database.Exec(
		`INSERT INTO items(id, name, version, created_at, updated_at) VALUES(?,?,?,?,?)`,
		"item-sv-1", "ServerName", 3,
		base.Format(time.RFC3339Nano), serverUpdatedAt.Format(time.RFC3339Nano),
	)
	require.NoError(t, err)

	// Client sends an older version.
	item := models.Item{
		ID:        "item-sv-1",
		Name:      "ClientName",
		Version:   2,
		CreatedAt: base,
		UpdatedAt: clientUpdatedAt,
	}
	changes := emptyChanges()
	changes.Items = []models.Item{item}

	resp := doSync(t, srv, syncRequest(lastSync, changes))

	assert.NotContains(t, resp.Applied, "item-sv-1", "server-newer item must NOT be applied")
	assert.Empty(t, resp.Conflicts)

	// DB must still have the server name.
	var name string
	require.NoError(t, database.QueryRow(`SELECT name FROM items WHERE id=?`, "item-sv-1").Scan(&name))
	assert.Equal(t, "ServerName", name)
}

// ---------------------------------------------------------------------------
// TestSync_Conflict
// ---------------------------------------------------------------------------

func TestSync_Conflict(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	lastSync := time.Now().UTC().Add(-30 * time.Minute).Truncate(time.Millisecond)
	serverUpdatedAt := lastSync.Add(5 * time.Minute)  // server changed after sync
	clientUpdatedAt := lastSync.Add(10 * time.Minute) // client also changed after sync

	// Seed the server version.
	_, err := database.Exec(
		`INSERT INTO items(id, name, version, created_at, updated_at) VALUES(?,?,?,?,?)`,
		"item-conflict-1", "ServerVersion", 2,
		lastSync.Add(-time.Hour).Format(time.RFC3339Nano),
		serverUpdatedAt.Format(time.RFC3339Nano),
	)
	require.NoError(t, err)

	// Client sends its own version, also newer than lastSync → conflict.
	item := models.Item{
		ID:        "item-conflict-1",
		Name:      "ClientVersion",
		Version:   2,
		CreatedAt: lastSync.Add(-time.Hour),
		UpdatedAt: clientUpdatedAt,
	}
	changes := emptyChanges()
	changes.Items = []models.Item{item}

	resp := doSync(t, srv, syncRequest(lastSync, changes))

	assert.NotContains(t, resp.Applied, "item-conflict-1", "conflicting item must NOT be in applied")
	require.Len(t, resp.Conflicts, 1, "exactly one conflict expected")
	assert.Equal(t, "item", resp.Conflicts[0].Entity)
	assert.Equal(t, "item-conflict-1", resp.Conflicts[0].ID)

	// Server payload must be present and valid JSON.
	var serverPayload map[string]any
	require.NoError(t, json.Unmarshal(resp.Conflicts[0].Server, &serverPayload))

	// DB must remain unchanged (server version wins in conflict — no write).
	var name string
	require.NoError(t, database.QueryRow(`SELECT name FROM items WHERE id=?`, "item-conflict-1").Scan(&name))
	assert.Equal(t, "ServerVersion", name)
}

// ---------------------------------------------------------------------------
// TestSync_ServerChanges
// ---------------------------------------------------------------------------

func TestSync_ServerChanges(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	lastSync := time.Now().UTC().Add(-30 * time.Minute).Truncate(time.Millisecond)
	seededAt := lastSync.Add(10 * time.Minute) // seeded after lastSync → must appear in serverChanges

	_, err := database.Exec(
		`INSERT INTO shops(id, name, color, version, updated_at) VALUES(?,?,?,?,?)`,
		"shop-srv-1", "Biedronka", "#cc0000", 1,
		seededAt.Format(time.RFC3339Nano),
	)
	require.NoError(t, err)

	_, err = database.Exec(
		`INSERT INTO items(id, name, version, created_at, updated_at) VALUES(?,?,?,?,?)`,
		"item-srv-1", "Butter", 1,
		seededAt.Format(time.RFC3339Nano),
		seededAt.Format(time.RFC3339Nano),
	)
	require.NoError(t, err)

	req := syncRequest(lastSync, emptyChanges())
	resp := doSync(t, srv, req)

	assert.Empty(t, resp.Applied)
	assert.Empty(t, resp.Conflicts)

	// Both seeded records should appear in serverChanges.
	shopIDs := make([]string, 0, len(resp.ServerChanges.Shops))
	for _, s := range resp.ServerChanges.Shops {
		shopIDs = append(shopIDs, s.ID)
	}
	assert.Contains(t, shopIDs, "shop-srv-1", "seeded shop must appear in serverChanges.shops")

	itemIDs := make([]string, 0, len(resp.ServerChanges.Items))
	for _, item := range resp.ServerChanges.Items {
		itemIDs = append(itemIDs, item.ID)
	}
	assert.Contains(t, itemIDs, "item-srv-1", "seeded item must appear in serverChanges.items")
}

// ---------------------------------------------------------------------------
// TestSync_NoConflict_WhenContentIdentical
// ---------------------------------------------------------------------------

// TestSync_NoConflict_WhenContentIdentical reproduces a false-positive conflict
// that arises when the server already has an item whose updatedAt is after
// lastSyncedAt (e.g. because the client clock is slightly ahead of the server
// clock, or because serverTime was captured before applyChanges ran).
//
// If the client resends that same item with the same updatedAt and the same
// field values, there is no real conflict — no conflict must be reported.
func TestSync_NoConflict_WhenContentIdentical(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	// lastSyncedAt is deliberately BEFORE the item's updatedAt to simulate
	// the clock-skew / race scenario.
	lastSync := time.Now().UTC().Add(-30 * time.Minute).Truncate(time.Millisecond)
	itemUpdatedAt := lastSync.Add(10 * time.Minute) // item timestamp is after lastSync
	unit := "pcs"

	// Seed the server with an item whose updatedAt > lastSync.
	_, err := database.Exec(
		`INSERT INTO items(id, name, unit, version, created_at, updated_at) VALUES(?,?,?,?,?,?)`,
		"item-no-conflict", "Wędlina", unit, 1,
		lastSync.Add(-time.Hour).Format(time.RFC3339Nano),
		itemUpdatedAt.Format(time.RFC3339Nano),
	)
	require.NoError(t, err)

	// Client sends the exact same item — same content, same updatedAt.
	item := models.Item{
		ID:        "item-no-conflict",
		Name:      "Wędlina",
		Unit:      ptr(unit),
		Version:   1,
		CreatedAt: lastSync.Add(-time.Hour),
		UpdatedAt: itemUpdatedAt,
	}
	changes := emptyChanges()
	changes.Items = []models.Item{item}

	resp := doSync(t, srv, syncRequest(lastSync, changes))

	assert.Empty(t, resp.Conflicts, "identical content must not produce a conflict")
}

// ---------------------------------------------------------------------------
// TestSync_Conflict_ServerPayloadHasFullData
// ---------------------------------------------------------------------------

// TestSync_Conflict_ServerPayloadHasFullData ensures that when a conflict is
// detected, the server-side payload in the conflict contains all fields from
// the database record — not just the ID/version/updatedAt skeleton that was
// previously constructed.
func TestSync_Conflict_ServerPayloadHasFullData(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	lastSync := time.Now().UTC().Add(-30 * time.Minute).Truncate(time.Millisecond)
	serverUpdatedAt := lastSync.Add(5 * time.Minute)
	clientUpdatedAt := lastSync.Add(10 * time.Minute)
	createdAt := lastSync.Add(-time.Hour)
	unit := "pcs"

	// Seed the full server record with all fields populated.
	_, err := database.Exec(
		`INSERT INTO items(id, name, unit, version, created_at, updated_at) VALUES(?,?,?,?,?,?)`,
		"item-conflict-full", "ServerName", unit, 2,
		createdAt.Format(time.RFC3339Nano),
		serverUpdatedAt.Format(time.RFC3339Nano),
	)
	require.NoError(t, err)

	// Client sends a conflicting version (also updated after lastSync).
	item := models.Item{
		ID:        "item-conflict-full",
		Name:      "ClientName",
		Unit:      ptr(unit),
		Version:   2,
		CreatedAt: createdAt,
		UpdatedAt: clientUpdatedAt,
	}
	changes := emptyChanges()
	changes.Items = []models.Item{item}

	resp := doSync(t, srv, syncRequest(lastSync, changes))

	require.Len(t, resp.Conflicts, 1, "exactly one conflict expected")

	var serverPayload map[string]any
	require.NoError(t, json.Unmarshal(resp.Conflicts[0].Server, &serverPayload))

	// The server payload must carry the real name, not empty string.
	assert.Equal(t, "ServerName", serverPayload["name"], "server conflict payload must have full name field")
	// createdAt must not be Go zero time.
	assert.NotEqual(t, "0001-01-01T00:00:00Z", serverPayload["createdAt"], "server conflict payload must have real createdAt")
}

// ---------------------------------------------------------------------------
// TestSync_InvalidJSON
// ---------------------------------------------------------------------------

func TestSync_InvalidJSON(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	resp, err := http.Post(
		srv.URL+"/api/sync",
		"application/json",
		bytes.NewBufferString(`{not valid json`),
	)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
}

// ---------------------------------------------------------------------------
// TestSync_RemoveShopAssociation
// ---------------------------------------------------------------------------

// TestSync_RemoveShopAssociation reproduces the same union-merge bug for
// item_shops: removing a shop association and syncing must not leave the old
// association on the server.
func TestSync_RemoveShopAssociation(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	now := time.Now().UTC().Truncate(time.Millisecond)
	lastSync := now.Add(-time.Hour)

	item := models.Item{ID: "rs-item-1", Name: "Butter", Version: 1, CreatedAt: now, UpdatedAt: now}
	shop1 := models.Shop{ID: "rs-shop-1", Name: "Tesco", Color: "#111", Version: 1, UpdatedAt: now}
	shop2 := models.Shop{ID: "rs-shop-2", Name: "Lidl", Color: "#222", Version: 1, UpdatedAt: now}

	// --- Step 1: sync item associated with 2 shops ---
	changes := emptyChanges()
	changes.Items = []models.Item{item}
	changes.Shops = []models.Shop{shop1, shop2}
	changes.ItemShops = []models.ItemShop{
		{ItemID: "rs-item-1", ShopID: "rs-shop-1"},
		{ItemID: "rs-item-1", ShopID: "rs-shop-2"},
	}
	doSync(t, srv, syncRequest(lastSync, changes))

	// Sanity: server should have 2 itemShops
	br := doBootstrap(t, srv)
	require.Len(t, br.ItemShops, 2, "setup: server should have 2 itemShops after first sync")

	// --- Step 2: client removes shop2, syncs with only shop1 ---
	lastSync = now
	changes2 := emptyChanges()
	changes2.Items = []models.Item{item}
	changes2.Shops = []models.Shop{shop1, shop2}
	changes2.ItemShops = []models.ItemShop{
		{ItemID: "rs-item-1", ShopID: "rs-shop-1"},
	}
	doSync(t, srv, syncRequest(lastSync, changes2))

	// --- Step 3: server must have only 1 itemShop ---
	br2 := doBootstrap(t, srv)
	require.Len(t, br2.ItemShops, 1, "after removing shop2, server must have only 1 itemShop")
	assert.Equal(t, "rs-shop-1", br2.ItemShops[0].ShopID)
}

// ---------------------------------------------------------------------------
// TestSync_RemoveTag
// ---------------------------------------------------------------------------

// TestSync_RemoveTag reproduces the bug where removing a tag from an item and
// syncing still leaves the old tag on the server.  The sequence is:
//  1. Sync item + 2 tags → server stores both
//  2. Client removes one tag, syncs with only 1 tag → server must store only 1
//  3. Bootstrap must return exactly 1 itemTag for the item
func TestSync_RemoveTag(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	now := time.Now().UTC().Truncate(time.Millisecond)
	lastSync := now.Add(-time.Hour)

	item := models.Item{ID: "rt-item-1", Name: "Milk", Version: 1, CreatedAt: now, UpdatedAt: now}
	tag1 := models.Tag{ID: "rt-tag-1", Name: "dairy"}
	tag2 := models.Tag{ID: "rt-tag-2", Name: "cold"}

	// --- Step 1: sync item with 2 tags ---
	changes := emptyChanges()
	changes.Items = []models.Item{item}
	changes.Tags = []models.Tag{tag1, tag2}
	changes.ItemTags = []models.ItemTag{
		{ItemID: "rt-item-1", TagID: "rt-tag-1"},
		{ItemID: "rt-item-1", TagID: "rt-tag-2"},
	}
	doSync(t, srv, syncRequest(lastSync, changes))

	// Sanity: server should have 2 itemTags
	br := doBootstrap(t, srv)
	require.Len(t, br.ItemTags, 2, "setup: server should have 2 itemTags after first sync")

	// --- Step 2: client removes tag2, syncs with only tag1 ---
	lastSync = now
	changes2 := emptyChanges()
	changes2.Items = []models.Item{item}
	changes2.Tags = []models.Tag{tag1, tag2}
	changes2.ItemTags = []models.ItemTag{
		{ItemID: "rt-item-1", TagID: "rt-tag-1"},
	}
	doSync(t, srv, syncRequest(lastSync, changes2))

	// --- Step 3: server must have only 1 itemTag ---
	br2 := doBootstrap(t, srv)
	require.Len(t, br2.ItemTags, 1, "after removing tag2, server must have only 1 itemTag")
	assert.Equal(t, "rt-tag-1", br2.ItemTags[0].TagID)
}

// ---------------------------------------------------------------------------
// TestSync_SkippedShops
// ---------------------------------------------------------------------------

func TestSync_SkippedShops(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	now := time.Now().UTC().Truncate(time.Millisecond)
	lastSync := now.Add(-time.Hour)

	// Need the dependent rows to satisfy foreign-key constraints.
	shop := models.Shop{ID: "sk-shop-1", Name: "Skip Shop", Color: "#111", Version: 1, UpdatedAt: now}
	item := models.Item{ID: "sk-item-1", Name: "Skip Item", Version: 1, CreatedAt: now, UpdatedAt: now}
	list := models.List{ID: "sk-list-1", Name: "Skip List", Version: 1, CreatedAt: now, UpdatedAt: now}
	listItem := models.ListItem{
		ID: "sk-li-1", ListID: "sk-list-1", ItemID: "sk-item-1",
		State: "active", Version: 1, AddedAt: now, UpdatedAt: now,
	}
	skipped := models.ListItemSkippedShop{
		ListItemID: "sk-li-1",
		ShopID:     "sk-shop-1",
		SkippedAt:  now,
	}

	changes := emptyChanges()
	changes.Shops = []models.Shop{shop}
	changes.Items = []models.Item{item}
	changes.Lists = []models.List{list}
	changes.ListItems = []models.ListItem{listItem}
	changes.ListItemSkippedShops = []models.ListItemSkippedShop{skipped}

	resp := doSync(t, srv, syncRequest(lastSync, changes))

	assert.Empty(t, resp.Conflicts)
	assert.Contains(t, resp.Applied, "sk-shop-1")
	assert.Contains(t, resp.Applied, "sk-li-1")

	// Verify the skipped-shop appears in the subsequent bootstrap.
	br := doBootstrap(t, srv)
	require.Len(t, br.ListItemSkippedShops, 1)
	assert.Equal(t, "sk-li-1", br.ListItemSkippedShops[0].ListItemID)
	assert.Equal(t, "sk-shop-1", br.ListItemSkippedShops[0].ShopID)
}

// ---------------------------------------------------------------------------
// TestSync_ListItem_DuplicateItemIgnored
// ---------------------------------------------------------------------------

// TestSync_ListItem_DuplicateItemIgnored reproduces the 500 error that occurred
// when the client sent two list-item rows referencing the same (list_id, item_id)
// pair but with different primary-key IDs.  The server must accept the first and
// silently ignore the second rather than failing with a UNIQUE constraint error.
func TestSync_ListItem_DuplicateItemIgnored(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	now := time.Now().UTC().Truncate(time.Millisecond)
	lastSync := now.Add(-time.Hour)

	item := models.Item{ID: "dup-item-1", Name: "Gruszki", Version: 1, CreatedAt: now, UpdatedAt: now}
	list := models.List{ID: "dup-list-1", Name: "Weekly", Version: 1, CreatedAt: now, UpdatedAt: now}

	// First sync: add the item + list + first list-item row.
	li1 := models.ListItem{
		ID: "dup-li-1", ListID: "dup-list-1", ItemID: "dup-item-1",
		State: "active", Version: 1, AddedAt: now, UpdatedAt: now,
	}
	changes := emptyChanges()
	changes.Items = []models.Item{item}
	changes.Lists = []models.List{list}
	changes.ListItems = []models.ListItem{li1}
	resp := doSync(t, srv, syncRequest(lastSync, changes))
	require.Contains(t, resp.Applied, "dup-li-1", "first list-item must be applied")

	// Second sync: same (list_id, item_id) but a *different* list-item ID.
	// This simulates a race condition where the client created a duplicate row
	// locally (e.g. addItem called twice before listItems state loaded).
	li2 := models.ListItem{
		ID: "dup-li-2", ListID: "dup-list-1", ItemID: "dup-item-1",
		State: "active", Version: 1, AddedAt: now, UpdatedAt: now.Add(time.Millisecond),
	}
	changes2 := emptyChanges()
	changes2.Items = []models.Item{item}
	changes2.Lists = []models.List{list}
	changes2.ListItems = []models.ListItem{li2}
	resp2 := doSync(t, srv, syncRequest(lastSync, changes2))

	// Must succeed — no 500 from UNIQUE constraint.
	assert.Empty(t, resp2.Conflicts, "duplicate list-item must not produce a conflict")

	// The original row must still be stored.
	br := doBootstrap(t, srv)
	listItemIDs := make([]string, 0, len(br.ListItems))
	for _, li := range br.ListItems {
		listItemIDs = append(listItemIDs, li.ID)
	}
	assert.Contains(t, listItemIDs, "dup-li-1", "original list-item must be preserved")
}

// ---------------------------------------------------------------------------
// TestSync_Item_DefaultQuantityRoundTrip
// ---------------------------------------------------------------------------

// TestSync_Item_DefaultQuantityRoundTrip ensures that an item's defaultQuantity
// is stored on the server and returned correctly via bootstrap.
func TestSync_Item_DefaultQuantityRoundTrip(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	now := time.Now().UTC().Truncate(time.Millisecond)
	unit := "kg"
	dq := 2.5

	item := models.Item{
		ID:              "dq-item-1",
		Name:            "Apples",
		Unit:            &unit,
		DefaultQuantity: &dq,
		Version:         1,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	changes := emptyChanges()
	changes.Items = []models.Item{item}
	resp := doSync(t, srv, syncRequest(now.Add(-time.Hour), changes))
	require.Contains(t, resp.Applied, "dq-item-1")

	br := doBootstrap(t, srv)
	require.Len(t, br.Items, 1)
	require.NotNil(t, br.Items[0].DefaultQuantity, "defaultQuantity must be stored and returned")
	assert.Equal(t, 2.5, *br.Items[0].DefaultQuantity)
}
