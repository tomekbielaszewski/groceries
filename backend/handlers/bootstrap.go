package handlers

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"grocery/models"
)

func Bootstrap(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		resp, err := loadAll(db)
		if err != nil {
			log.Printf("ERROR bootstrap: %v", err)
			jsonError(w, "failed to load data", http.StatusInternalServerError)
			return
		}
		resp.ServerTime = time.Now().UTC()
		jsonOK(w, resp)
	}
}

func loadAll(db *sql.DB) (*models.BootstrapResponse, error) {
	resp := &models.BootstrapResponse{
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
	var err error

	resp.Shops, err = queryShops(db, "")
	if err != nil {
		return nil, err
	}
	resp.Items, err = queryItems(db, "")
	if err != nil {
		return nil, err
	}
	resp.Tags, err = queryTags(db)
	if err != nil {
		return nil, err
	}
	resp.ItemShops, err = queryItemShops(db)
	if err != nil {
		return nil, err
	}
	resp.ItemTags, err = queryItemTags(db)
	if err != nil {
		return nil, err
	}
	resp.Lists, err = queryLists(db, "")
	if err != nil {
		return nil, err
	}
	resp.ListItems, err = queryListItems(db, "")
	if err != nil {
		return nil, err
	}
	resp.ListItemSkippedShops, err = queryListItemSkippedShops(db)
	if err != nil {
		return nil, err
	}
	resp.ShoppingSessions, err = queryShoppingSessions(db, "")
	if err != nil {
		return nil, err
	}
	resp.SessionItems, err = querySessionItems(db, "")
	if err != nil {
		return nil, err
	}

	return resp, nil
}

// ---- query helpers ----

func queryShops(db *sql.DB, since string) ([]models.Shop, error) {
	q := `SELECT id, name, color, version, updated_at, deleted_at FROM shops`
	args := []any{}
	if since != "" {
		q += ` WHERE updated_at > ?`
		args = append(args, since)
	}
	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []models.Shop{}
	for rows.Next() {
		var s models.Shop
		var deletedAt sql.NullTime
		if err := rows.Scan(&s.ID, &s.Name, &s.Color, &s.Version, &s.UpdatedAt, &deletedAt); err != nil {
			return nil, err
		}
		if deletedAt.Valid {
			s.DeletedAt = &deletedAt.Time
		}
		result = append(result, s)
	}
	return result, rows.Err()
}

func queryItems(db *sql.DB, since string) ([]models.Item, error) {
	q := `SELECT id, name, unit, default_quantity, description, notes, version, created_at, updated_at, deleted_at FROM items`
	args := []any{}
	if since != "" {
		q += ` WHERE updated_at > ?`
		args = append(args, since)
	}
	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []models.Item{}
	for rows.Next() {
		var item models.Item
		var unit, description, notes sql.NullString
		var defaultQuantity sql.NullFloat64
		var deletedAt sql.NullTime
		if err := rows.Scan(&item.ID, &item.Name, &unit, &defaultQuantity, &description, &notes,
			&item.Version, &item.CreatedAt, &item.UpdatedAt, &deletedAt); err != nil {
			return nil, err
		}
		if unit.Valid {
			item.Unit = &unit.String
		}
		if defaultQuantity.Valid {
			item.DefaultQuantity = &defaultQuantity.Float64
		}
		if description.Valid {
			item.Description = &description.String
		}
		if notes.Valid {
			item.Notes = &notes.String
		}
		if deletedAt.Valid {
			item.DeletedAt = &deletedAt.Time
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func queryTags(db *sql.DB) ([]models.Tag, error) {
	rows, err := db.Query(`SELECT id, name FROM tags`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []models.Tag{}
	for rows.Next() {
		var t models.Tag
		if err := rows.Scan(&t.ID, &t.Name); err != nil {
			return nil, err
		}
		result = append(result, t)
	}
	return result, rows.Err()
}

func queryItemShops(db *sql.DB) ([]models.ItemShop, error) {
	rows, err := db.Query(`SELECT item_id, shop_id FROM item_shops`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []models.ItemShop{}
	for rows.Next() {
		var x models.ItemShop
		if err := rows.Scan(&x.ItemID, &x.ShopID); err != nil {
			return nil, err
		}
		result = append(result, x)
	}
	return result, rows.Err()
}

func queryItemTags(db *sql.DB) ([]models.ItemTag, error) {
	rows, err := db.Query(`SELECT item_id, tag_id FROM item_tags`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []models.ItemTag{}
	for rows.Next() {
		var x models.ItemTag
		if err := rows.Scan(&x.ItemID, &x.TagID); err != nil {
			return nil, err
		}
		result = append(result, x)
	}
	return result, rows.Err()
}

func queryLists(db *sql.DB, since string) ([]models.List, error) {
	q := `SELECT id, name, version, created_at, updated_at, deleted_at FROM lists`
	args := []any{}
	if since != "" {
		q += ` WHERE updated_at > ?`
		args = append(args, since)
	}
	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []models.List{}
	for rows.Next() {
		var l models.List
		var deletedAt sql.NullTime
		if err := rows.Scan(&l.ID, &l.Name, &l.Version, &l.CreatedAt, &l.UpdatedAt, &deletedAt); err != nil {
			return nil, err
		}
		if deletedAt.Valid {
			l.DeletedAt = &deletedAt.Time
		}
		result = append(result, l)
	}
	return result, rows.Err()
}

func queryListItems(db *sql.DB, since string) ([]models.ListItem, error) {
	q := `SELECT id, list_id, item_id, state, quantity, unit, notes, version, added_at, updated_at FROM list_items`
	args := []any{}
	if since != "" {
		q += ` WHERE updated_at > ?`
		args = append(args, since)
	}
	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []models.ListItem{}
	for rows.Next() {
		var li models.ListItem
		var quantity sql.NullFloat64
		var unit, notes sql.NullString
		if err := rows.Scan(&li.ID, &li.ListID, &li.ItemID, &li.State,
			&quantity, &unit, &notes, &li.Version, &li.AddedAt, &li.UpdatedAt); err != nil {
			return nil, err
		}
		if quantity.Valid {
			li.Quantity = &quantity.Float64
		}
		if unit.Valid {
			li.Unit = &unit.String
		}
		if notes.Valid {
			li.Notes = &notes.String
		}
		result = append(result, li)
	}
	return result, rows.Err()
}

func queryListItemSkippedShops(db *sql.DB) ([]models.ListItemSkippedShop, error) {
	rows, err := db.Query(`SELECT list_item_id, shop_id, skipped_at FROM list_item_skipped_shops`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []models.ListItemSkippedShop{}
	for rows.Next() {
		var x models.ListItemSkippedShop
		if err := rows.Scan(&x.ListItemID, &x.ShopID, &x.SkippedAt); err != nil {
			return nil, err
		}
		result = append(result, x)
	}
	return result, rows.Err()
}

func queryShoppingSessions(db *sql.DB, since string) ([]models.ShoppingSession, error) {
	q := `SELECT id, list_id, shop_id, started_at, ended_at, version FROM shopping_sessions`
	args := []any{}
	if since != "" {
		q += ` WHERE started_at > ?`
		args = append(args, since)
	}
	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []models.ShoppingSession{}
	for rows.Next() {
		var s models.ShoppingSession
		var endedAt sql.NullTime
		if err := rows.Scan(&s.ID, &s.ListID, &s.ShopID, &s.StartedAt, &endedAt, &s.Version); err != nil {
			return nil, err
		}
		if endedAt.Valid {
			s.EndedAt = &endedAt.Time
		}
		result = append(result, s)
	}
	return result, rows.Err()
}

func querySessionItems(db *sql.DB, since string) ([]models.SessionItem, error) {
	q := `SELECT id, session_id, item_id, action, quantity, unit, at FROM session_items`
	args := []any{}
	if since != "" {
		q += ` WHERE at > ?`
		args = append(args, since)
	}
	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []models.SessionItem{}
	for rows.Next() {
		var si models.SessionItem
		var quantity sql.NullFloat64
		var unit sql.NullString
		if err := rows.Scan(&si.ID, &si.SessionID, &si.ItemID, &si.Action, &quantity, &unit, &si.At); err != nil {
			return nil, err
		}
		if quantity.Valid {
			si.Quantity = &quantity.Float64
		}
		if unit.Valid {
			si.Unit = &unit.String
		}
		result = append(result, si)
	}
	return result, rows.Err()
}

func jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
