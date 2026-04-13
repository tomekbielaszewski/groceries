package handlers

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"grocery/models"
	gsync "grocery/sync"
	"grocery/strutil"
)

func Sync(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req models.SyncRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonError(w, "invalid request body", http.StatusBadRequest)
			return
		}

		serverTime := time.Now().UTC()
		resp := models.SyncResponse{
			ServerTime: serverTime,
			Applied:    []string{},
			Conflicts:  []models.Conflict{},
		}

		if err := applyChanges(db, req, &resp); err != nil {
			log.Printf("ERROR sync applyChanges: %v", err)
			jsonError(w, "sync failed: "+err.Error(), http.StatusInternalServerError)
			return
		}

		serverChanges, err := loadChangesSince(db, req.LastSyncedAt)
		if err != nil {
			log.Printf("ERROR sync loadChangesSince: %v", err)
			jsonError(w, "failed to load server changes", http.StatusInternalServerError)
			return
		}
		resp.ServerChanges = *serverChanges

		jsonOK(w, resp)
	}
}

func applyChanges(db *sql.DB, req models.SyncRequest, resp *models.SyncResponse) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, s := range req.Changes.Shops {
		applied, conflict, err := upsertShop(tx, s, req.LastSyncedAt)
		if err != nil {
			return err
		}
		if conflict != nil {
			resp.Conflicts = append(resp.Conflicts, *conflict)
		} else if applied {
			resp.Applied = append(resp.Applied, s.ID)
		}
	}

	for _, item := range req.Changes.Items {
		applied, conflict, err := upsertItem(tx, item, req.LastSyncedAt)
		if err != nil {
			return err
		}
		if conflict != nil {
			resp.Conflicts = append(resp.Conflicts, *conflict)
		} else if applied {
			resp.Applied = append(resp.Applied, item.ID)
		}
	}

	for _, t := range req.Changes.Tags {
		if _, err := tx.Exec(
			`INSERT INTO tags(id, name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name`,
			t.ID, strutil.NormalizeTag(t.Name),
		); err != nil {
			return err
		}
	}

	// Full-replace per item: delete existing shop associations for any item
	// present in the request, then insert the new set.
	touchedItemsForShops := map[string]struct{}{}
	for _, x := range req.Changes.ItemShops {
		touchedItemsForShops[x.ItemID] = struct{}{}
	}
	for itemID := range touchedItemsForShops {
		if _, err := tx.Exec(`DELETE FROM item_shops WHERE item_id=?`, itemID); err != nil {
			return err
		}
	}
	for _, x := range req.Changes.ItemShops {
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO item_shops(item_id, shop_id)
			 SELECT ?,? WHERE EXISTS (SELECT 1 FROM items WHERE id=?)
			              AND EXISTS (SELECT 1 FROM shops WHERE id=?)`,
			x.ItemID, x.ShopID, x.ItemID, x.ShopID,
		); err != nil {
			return err
		}
	}

	// Collect the set of items whose tags are being synced, then replace
	// their tag associations in full (delete old, insert new).  This ensures
	// that a client removing a tag is honoured rather than silently unioned
	// with the server's existing set.
	touchedItems := map[string]struct{}{}
	for _, x := range req.Changes.ItemTags {
		touchedItems[x.ItemID] = struct{}{}
	}
	for itemID := range touchedItems {
		if _, err := tx.Exec(`DELETE FROM item_tags WHERE item_id=?`, itemID); err != nil {
			return err
		}
	}
	for _, x := range req.Changes.ItemTags {
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO item_tags(item_id, tag_id)
			 SELECT ?,? WHERE EXISTS (SELECT 1 FROM items WHERE id=?)
			              AND EXISTS (SELECT 1 FROM tags WHERE id=?)`,
			x.ItemID, x.TagID, x.ItemID, x.TagID,
		); err != nil {
			return err
		}
	}

	for _, l := range req.Changes.Lists {
		applied, conflict, err := upsertList(tx, l, req.LastSyncedAt)
		if err != nil {
			return err
		}
		if conflict != nil {
			resp.Conflicts = append(resp.Conflicts, *conflict)
		} else if applied {
			resp.Applied = append(resp.Applied, l.ID)
		}
	}

	for _, li := range req.Changes.ListItems {
		applied, conflict, err := upsertListItem(tx, li, req.LastSyncedAt)
		if err != nil {
			return err
		}
		if conflict != nil {
			resp.Conflicts = append(resp.Conflicts, *conflict)
		} else if applied {
			resp.Applied = append(resp.Applied, li.ID)
		}
	}

	for _, x := range req.Changes.ListItemSkippedShops {
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO list_item_skipped_shops(list_item_id, shop_id, skipped_at)
			 SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM list_items WHERE id=?)
			               AND EXISTS (SELECT 1 FROM shops WHERE id=?)`,
			x.ListItemID, x.ShopID, x.SkippedAt, x.ListItemID, x.ShopID,
		); err != nil {
			return err
		}
	}

	for _, ss := range req.Changes.ShoppingSessions {
		if _, err := tx.Exec(
			`INSERT INTO shopping_sessions(id, list_id, shop_id, started_at, ended_at, version)
			 SELECT ?,?,?,?,?,?
			 WHERE EXISTS (SELECT 1 FROM lists WHERE id=?)
			   AND EXISTS (SELECT 1 FROM shops WHERE id=?)
			 ON CONFLICT(id) DO UPDATE SET ended_at=excluded.ended_at, version=excluded.version`,
			ss.ID, ss.ListID, ss.ShopID, ss.StartedAt, ss.EndedAt, ss.Version,
			ss.ListID, ss.ShopID,
		); err != nil {
			return err
		}
	}

	for _, si := range req.Changes.SessionItems {
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO session_items(id, session_id, item_id, action, quantity, unit, at)
			 SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM shopping_sessions WHERE id=?)
			                       AND EXISTS (SELECT 1 FROM items WHERE id=?)`,
			si.ID, si.SessionID, si.ItemID, si.Action, si.Quantity, si.Unit, si.At,
			si.SessionID, si.ItemID,
		); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// ptrStringEqual returns true if both pointers are nil, or both point to equal strings.
func ptrStringEqual(a, b *string) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

// ptrTimeEqual returns true if both pointers are nil, or both point to equal times.
func ptrTimeEqual(a, b *time.Time) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return a.Equal(*b)
}

func shopContentEqual(a, b models.Shop) bool {
	return a.Name == b.Name && a.Color == b.Color && ptrTimeEqual(a.DeletedAt, b.DeletedAt)
}

func ptrFloat64Equal(a, b *float64) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

func itemContentEqual(a, b models.Item) bool {
	return a.Name == b.Name &&
		ptrStringEqual(a.Unit, b.Unit) &&
		ptrFloat64Equal(a.DefaultQuantity, b.DefaultQuantity) &&
		ptrStringEqual(a.Description, b.Description) &&
		ptrStringEqual(a.Notes, b.Notes) &&
		ptrTimeEqual(a.DeletedAt, b.DeletedAt)
}

func listContentEqual(a, b models.List) bool {
	return a.Name == b.Name && ptrTimeEqual(a.DeletedAt, b.DeletedAt)
}

func listItemContentEqual(a, b models.ListItem) bool {
	return a.State == b.State &&
		ptrStringEqual(a.Unit, b.Unit) &&
		ptrStringEqual(a.Notes, b.Notes)
}

func upsertShop(tx *sql.Tx, s models.Shop, lastSync time.Time) (applied bool, conflict *models.Conflict, err error) {
	var dbVersion int
	var dbUpdatedAt time.Time
	scanErr := tx.QueryRow(`SELECT version, updated_at FROM shops WHERE id=?`, s.ID).
		Scan(&dbVersion, &dbUpdatedAt)

	if scanErr == sql.ErrNoRows {
		_, err = tx.Exec(
			`INSERT INTO shops(id, name, color, version, updated_at, deleted_at) VALUES(?,?,?,?,?,?)`,
			s.ID, s.Name, s.Color, s.Version, s.UpdatedAt, s.DeletedAt,
		)
		return err == nil, nil, err
	}
	if scanErr != nil {
		return false, nil, scanErr
	}

	if gsync.IsConflict(s.UpdatedAt, dbUpdatedAt, lastSync) {
		var dbShop models.Shop
		if e := tx.QueryRow(`SELECT id, name, color, version, updated_at, deleted_at FROM shops WHERE id=?`, s.ID).
			Scan(&dbShop.ID, &dbShop.Name, &dbShop.Color, &dbShop.Version, &dbShop.UpdatedAt, &dbShop.DeletedAt); e != nil {
			return false, nil, e
		}
		if shopContentEqual(s, dbShop) {
			if s.UpdatedAt.After(dbUpdatedAt) {
				_, err = tx.Exec(
					`UPDATE shops SET name=?, color=?, version=?, updated_at=?, deleted_at=? WHERE id=?`,
					s.Name, s.Color, s.Version, s.UpdatedAt, s.DeletedAt, s.ID,
				)
				return err == nil, nil, err
			}
			return false, nil, nil
		}
		c, e := gsync.MakeConflict("shop", s.ID, s, dbShop)
		return false, &c, e
	}

	if s.UpdatedAt.After(dbUpdatedAt) {
		_, err = tx.Exec(
			`UPDATE shops SET name=?, color=?, version=?, updated_at=?, deleted_at=? WHERE id=?`,
			s.Name, s.Color, s.Version, s.UpdatedAt, s.DeletedAt, s.ID,
		)
		return err == nil, nil, err
	}
	return false, nil, nil
}

func upsertItem(tx *sql.Tx, item models.Item, lastSync time.Time) (applied bool, conflict *models.Conflict, err error) {
	var dbVersion int
	var dbUpdatedAt time.Time
	scanErr := tx.QueryRow(`SELECT version, updated_at FROM items WHERE id=?`, item.ID).
		Scan(&dbVersion, &dbUpdatedAt)

	if scanErr == sql.ErrNoRows {
		_, err = tx.Exec(
			`INSERT INTO items(id, name, unit, default_quantity, description, notes, version, created_at, updated_at, deleted_at)
			 VALUES(?,?,?,?,?,?,?,?,?,?)`,
			item.ID, item.Name, item.Unit, item.DefaultQuantity, item.Description, item.Notes,
			item.Version, item.CreatedAt, item.UpdatedAt, item.DeletedAt,
		)
		return err == nil, nil, err
	}
	if scanErr != nil {
		return false, nil, scanErr
	}

	if gsync.IsConflict(item.UpdatedAt, dbUpdatedAt, lastSync) {
		var dbItem models.Item
		var dbUnit, dbDescription, dbNotes sql.NullString
		var dbDefaultQuantity sql.NullFloat64
		var dbDeletedAt sql.NullTime
		if e := tx.QueryRow(`SELECT id, name, unit, default_quantity, description, notes, version, created_at, updated_at, deleted_at FROM items WHERE id=?`, item.ID).
			Scan(&dbItem.ID, &dbItem.Name, &dbUnit, &dbDefaultQuantity, &dbDescription, &dbNotes, &dbItem.Version, &dbItem.CreatedAt, &dbItem.UpdatedAt, &dbDeletedAt); e != nil {
			return false, nil, e
		}
		if dbUnit.Valid {
			dbItem.Unit = &dbUnit.String
		}
		if dbDefaultQuantity.Valid {
			dbItem.DefaultQuantity = &dbDefaultQuantity.Float64
		}
		if dbDescription.Valid {
			dbItem.Description = &dbDescription.String
		}
		if dbNotes.Valid {
			dbItem.Notes = &dbNotes.String
		}
		if dbDeletedAt.Valid {
			dbItem.DeletedAt = &dbDeletedAt.Time
		}
		if itemContentEqual(item, dbItem) {
			if item.UpdatedAt.After(dbUpdatedAt) {
				_, err = tx.Exec(
					`UPDATE items SET name=?, unit=?, default_quantity=?, description=?, notes=?, version=?, updated_at=?, deleted_at=? WHERE id=?`,
					item.Name, item.Unit, item.DefaultQuantity, item.Description, item.Notes,
					item.Version, item.UpdatedAt, item.DeletedAt, item.ID,
				)
				return err == nil, nil, err
			}
			return false, nil, nil
		}
		c, e := gsync.MakeConflict("item", item.ID, item, dbItem)
		return false, &c, e
	}

	if item.UpdatedAt.After(dbUpdatedAt) {
		_, err = tx.Exec(
			`UPDATE items SET name=?, unit=?, default_quantity=?, description=?, notes=?, version=?, updated_at=?, deleted_at=? WHERE id=?`,
			item.Name, item.Unit, item.DefaultQuantity, item.Description, item.Notes,
			item.Version, item.UpdatedAt, item.DeletedAt, item.ID,
		)
		return err == nil, nil, err
	}
	return false, nil, nil
}

func upsertList(tx *sql.Tx, l models.List, lastSync time.Time) (applied bool, conflict *models.Conflict, err error) {
	var dbVersion int
	var dbUpdatedAt time.Time
	scanErr := tx.QueryRow(`SELECT version, updated_at FROM lists WHERE id=?`, l.ID).
		Scan(&dbVersion, &dbUpdatedAt)

	if scanErr == sql.ErrNoRows {
		_, err = tx.Exec(
			`INSERT INTO lists(id, name, version, created_at, updated_at, deleted_at) VALUES(?,?,?,?,?,?)`,
			l.ID, l.Name, l.Version, l.CreatedAt, l.UpdatedAt, l.DeletedAt,
		)
		return err == nil, nil, err
	}
	if scanErr != nil {
		return false, nil, scanErr
	}

	if gsync.IsConflict(l.UpdatedAt, dbUpdatedAt, lastSync) {
		var dbList models.List
		if e := tx.QueryRow(`SELECT id, name, version, created_at, updated_at, deleted_at FROM lists WHERE id=?`, l.ID).
			Scan(&dbList.ID, &dbList.Name, &dbList.Version, &dbList.CreatedAt, &dbList.UpdatedAt, &dbList.DeletedAt); e != nil {
			return false, nil, e
		}
		if listContentEqual(l, dbList) {
			if l.UpdatedAt.After(dbUpdatedAt) {
				_, err = tx.Exec(
					`UPDATE lists SET name=?, version=?, updated_at=?, deleted_at=? WHERE id=?`,
					l.Name, l.Version, l.UpdatedAt, l.DeletedAt, l.ID,
				)
				return err == nil, nil, err
			}
			return false, nil, nil
		}
		c, e := gsync.MakeConflict("list", l.ID, l, dbList)
		return false, &c, e
	}

	if l.UpdatedAt.After(dbUpdatedAt) {
		_, err = tx.Exec(
			`UPDATE lists SET name=?, version=?, updated_at=?, deleted_at=? WHERE id=?`,
			l.Name, l.Version, l.UpdatedAt, l.DeletedAt, l.ID,
		)
		return err == nil, nil, err
	}
	return false, nil, nil
}

func upsertListItem(tx *sql.Tx, li models.ListItem, lastSync time.Time) (applied bool, conflict *models.Conflict, err error) {
	var dbVersion int
	var dbUpdatedAt time.Time
	scanErr := tx.QueryRow(`SELECT version, updated_at FROM list_items WHERE id=?`, li.ID).
		Scan(&dbVersion, &dbUpdatedAt)

	if scanErr == sql.ErrNoRows {
		_, err = tx.Exec(
			`INSERT OR IGNORE INTO list_items(id, list_id, item_id, state, quantity, unit, notes, version, added_at, updated_at)
			 VALUES(?,?,?,?,?,?,?,?,?,?)`,
			li.ID, li.ListID, li.ItemID, li.State, li.Quantity, li.Unit, li.Notes,
			li.Version, li.AddedAt, li.UpdatedAt,
		)
		return err == nil, nil, err
	}
	if scanErr != nil {
		return false, nil, scanErr
	}

	if gsync.IsConflict(li.UpdatedAt, dbUpdatedAt, lastSync) {
		var dbLI models.ListItem
		if e := tx.QueryRow(`SELECT id, list_id, item_id, state, quantity, unit, notes, version, added_at, updated_at FROM list_items WHERE id=?`, li.ID).
			Scan(&dbLI.ID, &dbLI.ListID, &dbLI.ItemID, &dbLI.State, &dbLI.Quantity, &dbLI.Unit, &dbLI.Notes, &dbLI.Version, &dbLI.AddedAt, &dbLI.UpdatedAt); e != nil {
			return false, nil, e
		}
		if listItemContentEqual(li, dbLI) {
			if li.UpdatedAt.After(dbUpdatedAt) {
				_, err = tx.Exec(
					`UPDATE list_items SET state=?, quantity=?, unit=?, notes=?, version=?, updated_at=? WHERE id=?`,
					li.State, li.Quantity, li.Unit, li.Notes, li.Version, li.UpdatedAt, li.ID,
				)
				return err == nil, nil, err
			}
			return false, nil, nil
		}
		c, e := gsync.MakeConflict("listItem", li.ID, li, dbLI)
		return false, &c, e
	}

	if li.UpdatedAt.After(dbUpdatedAt) {
		_, err = tx.Exec(
			`UPDATE list_items SET state=?, quantity=?, unit=?, notes=?, version=?, updated_at=? WHERE id=?`,
			li.State, li.Quantity, li.Unit, li.Notes, li.Version, li.UpdatedAt, li.ID,
		)
		return err == nil, nil, err
	}
	return false, nil, nil
}

func loadChangesSince(db *sql.DB, since time.Time) (*models.SyncChanges, error) {
	sinceStr := since.UTC().Format(time.RFC3339Nano)
	changes := &models.SyncChanges{}
	var err error

	changes.Shops, err = queryShops(db, sinceStr)
	if err != nil {
		return nil, err
	}
	changes.Items, err = queryItems(db, sinceStr)
	if err != nil {
		return nil, err
	}
	changes.Lists, err = queryLists(db, sinceStr)
	if err != nil {
		return nil, err
	}
	changes.ListItems, err = queryListItems(db, sinceStr)
	if err != nil {
		return nil, err
	}
	changes.Tags, err = queryTags(db)
	if err != nil {
		return nil, err
	}
	changes.ItemShops, err = queryItemShops(db)
	if err != nil {
		return nil, err
	}
	changes.ItemTags, err = queryItemTags(db)
	if err != nil {
		return nil, err
	}
	changes.ListItemSkippedShops, err = queryListItemSkippedShops(db)
	if err != nil {
		return nil, err
	}
	changes.ShoppingSessions, err = queryShoppingSessions(db, sinceStr)
	if err != nil {
		return nil, err
	}
	changes.SessionItems, err = querySessionItems(db, sinceStr)
	if err != nil {
		return nil, err
	}
	return changes, nil
}
