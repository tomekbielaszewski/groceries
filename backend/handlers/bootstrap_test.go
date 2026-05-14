package handlers_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBootstrap_EmptyDB(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	resp := doBootstrap(t, srv)

	// All collections must be present and empty (not null / nil).
	assert.NotNil(t, resp.Shops)
	assert.NotNil(t, resp.Items)
	assert.NotNil(t, resp.Tags)
	assert.NotNil(t, resp.ItemShops)
	assert.NotNil(t, resp.ItemTags)
	assert.NotNil(t, resp.Lists)
	assert.NotNil(t, resp.ListItems)
	assert.NotNil(t, resp.ListItemSkippedShops)
	assert.NotNil(t, resp.ShoppingSessions)
	assert.NotNil(t, resp.SessionItems)

	assert.Empty(t, resp.Shops)
	assert.Empty(t, resp.Items)
	assert.Empty(t, resp.Tags)
	assert.Empty(t, resp.ItemShops)
	assert.Empty(t, resp.ItemTags)
	assert.Empty(t, resp.Lists)
	assert.Empty(t, resp.ListItems)
	assert.Empty(t, resp.ListItemSkippedShops)
	assert.Empty(t, resp.ShoppingSessions)
	assert.Empty(t, resp.SessionItems)
}

func TestBootstrap_WithData(t *testing.T) {
	database := newTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	// Seed a shop.
	_, err := database.Exec(
		`INSERT INTO shops(id, name, color, version, updated_at) VALUES(?,?,?,?,?)`,
		"shop-1", "Lidl", "#ffcc00", 1, now.Format(time.RFC3339),
	)
	require.NoError(t, err)

	// Seed an item.
	_, err = database.Exec(
		`INSERT INTO items(id, name, version, created_at, updated_at) VALUES(?,?,?,?,?)`,
		"item-1", "Milk", 1, now.Format(time.RFC3339), now.Format(time.RFC3339),
	)
	require.NoError(t, err)

	// Seed a list.
	_, err = database.Exec(
		`INSERT INTO lists(id, name, version, created_at, updated_at) VALUES(?,?,?,?,?)`,
		"list-1", "Weekly", 1, now.Format(time.RFC3339), now.Format(time.RFC3339),
	)
	require.NoError(t, err)

	srv := newTestServer(t, database)
	resp := doBootstrap(t, srv)

	require.Len(t, resp.Shops, 1)
	assert.Equal(t, "shop-1", resp.Shops[0].ID)
	assert.Equal(t, "Lidl", resp.Shops[0].Name)
	assert.Equal(t, "#ffcc00", resp.Shops[0].Color)
	assert.Equal(t, 1, resp.Shops[0].Version)

	require.Len(t, resp.Items, 1)
	assert.Equal(t, "item-1", resp.Items[0].ID)
	assert.Equal(t, "Milk", resp.Items[0].Name)

	require.Len(t, resp.Lists, 1)
	assert.Equal(t, "list-1", resp.Lists[0].ID)
	assert.Equal(t, "Weekly", resp.Lists[0].Name)
}

func TestBootstrap_ResponseShape(t *testing.T) {
	database := newTestDB(t)
	srv := newTestServer(t, database)

	before := time.Now().UTC()
	resp := doBootstrap(t, srv)
	after := time.Now().UTC()

	// serverTime must be populated and fall within the test window.
	require.False(t, resp.ServerTime.IsZero(), "serverTime must not be zero")
	assert.True(t, !resp.ServerTime.Before(before.Add(-time.Second)),
		"serverTime should not be before the request was made")
	assert.True(t, !resp.ServerTime.After(after.Add(5*time.Second)),
		"serverTime should be within 5 seconds of now")
}

func TestBootstrap_List_ArchivedAt(t *testing.T) {
	database := newTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	archivedAt := now.Add(time.Minute)

	_, err := database.Exec(
		`INSERT INTO lists(id, name, version, created_at, updated_at, archived_at) VALUES(?,?,?,?,?,?)`,
		"list-archived", "Done", 1,
		now.Format(time.RFC3339), now.Format(time.RFC3339), archivedAt.Format(time.RFC3339),
	)
	require.NoError(t, err)

	srv := newTestServer(t, database)
	resp := doBootstrap(t, srv)

	require.Len(t, resp.Lists, 1)
	assert.Equal(t, "list-archived", resp.Lists[0].ID)
	require.NotNil(t, resp.Lists[0].ArchivedAt, "bootstrap must return archivedAt for archived lists")
}

func TestBootstrap_List_ArchivedAt_Nil_WhenNotSet(t *testing.T) {
	database := newTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)

	_, err := database.Exec(
		`INSERT INTO lists(id, name, version, created_at, updated_at) VALUES(?,?,?,?,?)`,
		"list-active", "Active", 1, now.Format(time.RFC3339), now.Format(time.RFC3339),
	)
	require.NoError(t, err)

	srv := newTestServer(t, database)
	resp := doBootstrap(t, srv)

	require.Len(t, resp.Lists, 1)
	assert.Nil(t, resp.Lists[0].ArchivedAt, "bootstrap must return nil archivedAt for active lists")
}
