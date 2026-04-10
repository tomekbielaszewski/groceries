package db

import (
	"database/sql"
	_ "embed"
	"fmt"
	"strings"

	_ "modernc.org/sqlite"

	"grocery/strutil"
)

//go:embed schema.sql
var schema string

func Open(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	// Single writer connection is fine for SQLite
	db.SetMaxOpenConns(1)

	if err := applyPragmas(db); err != nil {
		db.Close()
		return nil, err
	}

	if err := applySchema(db); err != nil {
		db.Close()
		return nil, err
	}

	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}

	return db, nil
}

func applyPragmas(db *sql.DB) error {
	pragmas := []string{
		"PRAGMA journal_mode = WAL",
		"PRAGMA foreign_keys = ON",
		"PRAGMA busy_timeout = 5000",
	}
	for _, p := range pragmas {
		if _, err := db.Exec(p); err != nil {
			return fmt.Errorf("pragma %q: %w", p, err)
		}
	}
	return nil
}

func applySchema(db *sql.DB) error {
	if _, err := db.Exec(schema); err != nil {
		return fmt.Errorf("apply schema: %w", err)
	}
	return nil
}

// migrate applies incremental schema changes that cannot be expressed as
// idempotent CREATE TABLE IF NOT EXISTS statements.
func migrate(db *sql.DB) error {
	// Add resolved_at to existing bug_reports tables created before this column was introduced.
	_, err := db.Exec(`ALTER TABLE bug_reports ADD COLUMN resolved_at DATETIME`)
	if err != nil && !isDuplicateColumnError(err) {
		return fmt.Errorf("migrate bug_reports.resolved_at: %w", err)
	}

	if err := normalizeExistingTags(db); err != nil {
		return fmt.Errorf("migrate normalize tags: %w", err)
	}

	return nil
}

// normalizeExistingTags normalizes tag names already stored in the database.
// Tags that collide after normalization are merged: item_tags rows are
// re-pointed to the surviving tag and the duplicate is deleted.
func normalizeExistingTags(db *sql.DB) error {
	rows, err := db.Query(`SELECT id, name FROM tags`)
	if err != nil {
		return err
	}
	type tagRow struct{ id, name string }
	var tags []tagRow
	for rows.Next() {
		var t tagRow
		if err := rows.Scan(&t.id, &t.name); err != nil {
			rows.Close()
			return err
		}
		tags = append(tags, t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	// Determine which tags need updating and which collapse into an existing one.
	keepID := map[string]string{} // normalizedName -> id to keep
	remap := map[string]string{}  // obsolete id -> keep id
	for _, t := range tags {
		n := strutil.NormalizeTag(t.name)
		if existing, ok := keepID[n]; ok {
			remap[t.id] = existing
		} else {
			keepID[n] = t.id
		}
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Update names that changed but have no collision.
	for _, t := range tags {
		if _, merged := remap[t.id]; merged {
			continue
		}
		n := strutil.NormalizeTag(t.name)
		if n != t.name {
			if _, err := tx.Exec(`UPDATE tags SET name=? WHERE id=?`, n, t.id); err != nil {
				return err
			}
		}
	}

	// Merge duplicates.
	if len(remap) > 0 {
		itRows, err := tx.Query(`SELECT item_id, tag_id FROM item_tags`)
		if err != nil {
			return err
		}
		type itRow struct{ itemID, tagID string }
		var itemTags []itRow
		for itRows.Next() {
			var it itRow
			if err := itRows.Scan(&it.itemID, &it.tagID); err != nil {
				itRows.Close()
				return err
			}
			itemTags = append(itemTags, it)
		}
		itRows.Close()
		if err := itRows.Err(); err != nil {
			return err
		}

		for _, it := range itemTags {
			newTagID, ok := remap[it.tagID]
			if !ok {
				continue
			}
			if _, err := tx.Exec(`DELETE FROM item_tags WHERE item_id=? AND tag_id=?`, it.itemID, it.tagID); err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT OR IGNORE INTO item_tags(item_id, tag_id) VALUES(?,?)`, it.itemID, newTagID); err != nil {
				return err
			}
		}

		for obsoleteID := range remap {
			if _, err := tx.Exec(`DELETE FROM tags WHERE id=?`, obsoleteID); err != nil {
				return err
			}
		}
	}

	return tx.Commit()
}

func isDuplicateColumnError(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "duplicate column name") || strings.Contains(msg, "already exists")
}
