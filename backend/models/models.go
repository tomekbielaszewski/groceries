package models

import (
	"encoding/json"
	"time"
)

type Shop struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Color     string     `json:"color"`
	Version   int        `json:"version"`
	UpdatedAt time.Time  `json:"updatedAt"`
	DeletedAt *time.Time `json:"deletedAt,omitempty"`
}

type Item struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	Unit            *string    `json:"unit,omitempty"`
	DefaultQuantity *float64   `json:"defaultQuantity,omitempty"`
	Description     *string    `json:"description,omitempty"`
	Notes           *string    `json:"notes,omitempty"`
	Version         int        `json:"version"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
	DeletedAt       *time.Time `json:"deletedAt,omitempty"`
}

type ItemShop struct {
	ItemID string `json:"itemId"`
	ShopID string `json:"shopId"`
}

type Tag struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type ItemTag struct {
	ItemID string `json:"itemId"`
	TagID  string `json:"tagId"`
}

type List struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Version   int        `json:"version"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
	DeletedAt *time.Time `json:"deletedAt,omitempty"`
}

type ListItem struct {
	ID        string     `json:"id"`
	ListID    string     `json:"listId"`
	ItemID    string     `json:"itemId"`
	State     string     `json:"state"` // active | bought
	Quantity  *float64   `json:"quantity,omitempty"`
	Unit      *string    `json:"unit,omitempty"`
	Notes     *string    `json:"notes,omitempty"`
	Version   int        `json:"version"`
	AddedAt   time.Time  `json:"addedAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
}

type ListItemSkippedShop struct {
	ListItemID string    `json:"listItemId"`
	ShopID     string    `json:"shopId"`
	SkippedAt  time.Time `json:"skippedAt"`
}

type ShoppingSession struct {
	ID        string     `json:"id"`
	ListID    string     `json:"listId"`
	ShopID    string     `json:"shopId"`
	StartedAt time.Time  `json:"startedAt"`
	EndedAt   *time.Time `json:"endedAt,omitempty"`
	Version   int        `json:"version"`
}

type SessionItem struct {
	ID        string    `json:"id"`
	SessionID string    `json:"sessionId"`
	ItemID    string    `json:"itemId"`
	Action    string    `json:"action"` // bought | skipped
	Quantity  *float64  `json:"quantity,omitempty"`
	Unit      *string   `json:"unit,omitempty"`
	At        time.Time `json:"at"`
}

// Sync types

type SyncChanges struct {
	Shops                []Shop                `json:"shops"`
	Items                []Item                `json:"items"`
	Tags                 []Tag                 `json:"tags"`
	ItemShops            []ItemShop            `json:"itemShops"`
	ItemTags             []ItemTag             `json:"itemTags"`
	Lists                []List                `json:"lists"`
	ListItems            []ListItem            `json:"listItems"`
	ListItemSkippedShops []ListItemSkippedShop `json:"listItemSkippedShops"`
	ShoppingSessions     []ShoppingSession     `json:"shoppingSessions"`
	SessionItems         []SessionItem         `json:"sessionItems"`
}

type SyncRequest struct {
	LastSyncedAt time.Time   `json:"lastSyncedAt"`
	Changes      SyncChanges `json:"changes"`
}

type Conflict struct {
	Entity string          `json:"entity"`
	ID     string          `json:"id"`
	Client json.RawMessage `json:"client"`
	Server json.RawMessage `json:"server"`
}

type SyncResponse struct {
	ServerTime    time.Time   `json:"serverTime"`
	Applied       []string    `json:"applied"`
	Conflicts     []Conflict  `json:"conflicts"`
	ServerChanges SyncChanges `json:"serverChanges"`
}

type BootstrapResponse struct {
	Shops                []Shop                `json:"shops"`
	Items                []Item                `json:"items"`
	Tags                 []Tag                 `json:"tags"`
	ItemShops            []ItemShop            `json:"itemShops"`
	ItemTags             []ItemTag             `json:"itemTags"`
	Lists                []List                `json:"lists"`
	ListItems            []ListItem            `json:"listItems"`
	ListItemSkippedShops []ListItemSkippedShop `json:"listItemSkippedShops"`
	ShoppingSessions     []ShoppingSession     `json:"shoppingSessions"`
	SessionItems         []SessionItem         `json:"sessionItems"`
	ServerTime           time.Time             `json:"serverTime"`
}
