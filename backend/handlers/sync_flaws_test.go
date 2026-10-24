package handlers_test

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"

	"groceries/handlers"
	"groceries/models"
)

// ─────────────────────────────────────────────────────────────────────────────
// Sync architecture flaw reproductions (backend side).
//
// These tests are INTENTIONALLY RED. Each pins the *correct* behaviour of the
// event pipeline; today the implementation fails them, proving the flaw.
// See SYNC-ARCHITECTURE-REVIEW.md for the full write-up.
// ─────────────────────────────────────────────────────────────────────────────

// FLAW: PublishEvents records events in the log (InsertEvents commits its own
// transaction) BEFORE projecting them (ApplyEvent, a separate transaction).
// When a projection fails, the event is already committed to the log but never
// projected, and the retry path (eventExists) classifies it as a duplicate and
// skips projection forever. Correct behaviour: record + project must be atomic
// per event (one transaction), with the accepted count derived from the same
// transaction.

func TestPublish_ProjectionFailureMustBeAtomic(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	// Valid JSON, valid event type, but the payload field type is wrong:
	// `name` must be a string. Validate() passes (json.Valid only checks the
	// payload is well-formed JSON), while projectEvent's json.Unmarshal fails.
	e := makeEvent(t, models.EventShopCreated, "shop-1", map[string]any{"name": 123, "color": "red"})

	postEvents(t, srv, e) // today: 500, but the event is already committed

	// Correct: a publish whose projection fails must not leave the event in the
	// log. Today the log contains the event while the shops table does not.
	er := doGetEvents(t, srv, 0, 0)
	require.Empty(t, er.Events, "event committed to the log while its projection failed (log/projection divergence)")

	var count int
	require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM shops WHERE id = 'shop-1'`).Scan(&count))
	require.Equal(t, 0, count, "projection must not exist for a publish that failed")
}

func TestPublish_RetryAfterProjectionFailureMustProject(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	// First attempt: projection fails, but the event is committed to the log.
	bad := makeEvent(t, models.EventShopCreated, "shop-1", map[string]any{"name": 123, "color": "red"})
	postEvents(t, srv, bad)

	// A client retry of the same event id is classified as a duplicate and
	// skips projection entirely.
	status, _ := postEvents(t, srv, bad)
	require.Equal(t, 200, status, "retrying a known id should be an idempotent success")

	// Correct: the committed event must eventually be projected. Today it never
	// is, so the client and the server stay permanently out of sync.
	var count int
	require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM shops WHERE id = 'shop-1'`).Scan(&count))
	require.Equal(t, 1, count, "a committed event must eventually be projected (retry never re-projects today)")
}

// FLAW: the Hub drops events for slow subscribers (non-blocking send into a
// 16-slot buffer). An event-sourced client relies on every event being
// delivered; a dropped event on a live connection is never recovered because
// the client advances its cursor past the gap (no gap detection). Correct
// behaviour: publish must not silently drop events.

func TestHub_MustNotDropEventsWhenBufferIsFull(t *testing.T) {
	hub := handlers.NewHub()
	ch := hub.Subscribe()
	defer hub.Unsubscribe(ch)

	const total = 32 // greater than the subscriber's 16-slot buffer
	for i := 0; i < total; i++ {
		hub.Publish(models.Event{
			ID:       fmt.Sprintf("e-%d", i),
			Type:     models.EventShopCreated,
			EntityID: "shop-1",
		})
	}

	delivered := 0
drain:
	for {
		select {
		case _, ok := <-ch:
			if !ok {
				break drain
			}
			delivered++
		default:
			break drain
		}
	}

	require.Equal(t, total, delivered, "publish must not silently drop events for a subscriber")
}
