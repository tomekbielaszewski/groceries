PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS shops (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL,
    version    INTEGER NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL,
    deleted_at DATETIME
);

CREATE TABLE IF NOT EXISTS items (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    unit        TEXT,
    description TEXT,
    notes       TEXT,
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  DATETIME NOT NULL,
    updated_at  DATETIME NOT NULL,
    deleted_at  DATETIME
);

CREATE TABLE IF NOT EXISTS item_shops (
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, shop_id)
);

CREATE TABLE IF NOT EXISTS tags (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS item_tags (
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS lists (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  DATETIME NOT NULL,
    updated_at  DATETIME NOT NULL,
    deleted_at  DATETIME,
    archived_at DATETIME
);

CREATE TABLE IF NOT EXISTS list_items (
    id         TEXT PRIMARY KEY,
    list_id    TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    state      TEXT NOT NULL DEFAULT 'active',
    quantity   REAL,
    unit       TEXT,
    notes      TEXT,
    version    INTEGER NOT NULL DEFAULT 1,
    added_at   DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE(list_id, item_id)
);

CREATE TABLE IF NOT EXISTS list_item_skipped_shops (
    list_item_id TEXT NOT NULL REFERENCES list_items(id) ON DELETE CASCADE,
    shop_id      TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    skipped_at   DATETIME NOT NULL,
    PRIMARY KEY (list_item_id, shop_id)
);

CREATE TABLE IF NOT EXISTS shopping_sessions (
    id         TEXT PRIMARY KEY,
    list_id    TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    shop_id    TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    started_at DATETIME NOT NULL,
    ended_at   DATETIME,
    version    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS session_items (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES shopping_sessions(id) ON DELETE CASCADE,
    item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    action     TEXT NOT NULL,
    quantity   REAL,
    unit       TEXT,
    at         DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_updated_at        ON items(updated_at);
CREATE INDEX IF NOT EXISTS idx_items_deleted_at        ON items(deleted_at);
CREATE INDEX IF NOT EXISTS idx_item_shops_item_id      ON item_shops(item_id);
CREATE INDEX IF NOT EXISTS idx_item_shops_shop_id      ON item_shops(shop_id);
CREATE INDEX IF NOT EXISTS idx_item_tags_item_id       ON item_tags(item_id);
CREATE INDEX IF NOT EXISTS idx_lists_updated_at        ON lists(updated_at);
CREATE INDEX IF NOT EXISTS idx_list_items_list_id      ON list_items(list_id);
CREATE INDEX IF NOT EXISTS idx_list_items_item_id      ON list_items(item_id);
CREATE INDEX IF NOT EXISTS idx_list_items_updated_at   ON list_items(updated_at);
CREATE INDEX IF NOT EXISTS idx_skipped_list_item_id    ON list_item_skipped_shops(list_item_id);
CREATE INDEX IF NOT EXISTS idx_session_items_item_id   ON session_items(item_id);
CREATE INDEX IF NOT EXISTS idx_session_items_session_id ON session_items(session_id);

CREATE TABLE IF NOT EXISTS bug_reports (
    id          TEXT PRIMARY KEY,
    text        TEXT NOT NULL,
    created_at  DATETIME NOT NULL,
    resolved_at DATETIME
);
