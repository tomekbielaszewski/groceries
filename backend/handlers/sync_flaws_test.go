package handlers_test

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"groceries/handlers"
	"groceries/models"
)

// ─────────────────────────────────────────────────────────────────────────────
// Sync architecture flaw reproductions (backend side).
//
// Each test pins the *correct* behaviour of the event pipeline. The
// implementation has been fixed to satisfy them; see SYNC-ARCHITECTURE-REVIEW.md
// for the original write-up.
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

	// First attempt: projection fails (payload field has the wrong type).
	// Because record + project are atomic, this leaves nothing in the log and
	// does not "burn" the event id.
	bad := makeEvent(t, models.EventShopCreated, "shop-1", map[string]any{"name": 123, "color": "red"})
	status, _ := postEvents(t, srv, bad)
	require.Equal(t, 500, status, "a projection failure must be reported as an error")

	// The failed event must not be committed to the log.
	er := doGetEvents(t, srv, 0, 0)
	require.Empty(t, er.Events, "a projection failure must not commit the event to the log")

	// A corrected retry of the same id must now project: the failed attempt
	// left no committed-but-unprojected event behind for the retry to skip.
	good := bad
	good.Payload = json.RawMessage(`{"name":"Corner","color":"red"}`)
	status, _ = postEvents(t, srv, good)
	require.Equal(t, 200, status, "a corrected retry of a previously failed id must succeed")

	var count int
	require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM shops WHERE id = 'shop-1'`).Scan(&count))
	require.Equal(t, 1, count, "a corrected retry must be projected")
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

	// Delivery is asynchronous (a forwarder drains the subscriber's queue), so
	// read with a deadline instead of a racy non-blocking drain.
	delivered := 0
	timeout := time.After(5 * time.Second)
	for delivered < total {
		select {
		case _, ok := <-ch:
			if !ok {
				t.Fatalf("subscriber channel closed after %d/%d events", delivered, total)
			}
			delivered++
		case <-timeout:
			t.Fatalf("only %d/%d events delivered", delivered, total)
		}
	}
}

// FLAW: live hub events carried no seq (`json:"seq,omitempty"` omits Seq == 0),
// so the client cursor became NaN. The server must broadcast events WITH their
// DB-assigned seq so subscribers can advance their cursor.
func TestPublish_BroadcastsEventsWithAssignedSeq(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	ch := hub.Subscribe()
	defer hub.Unsubscribe(ch)

	e := makeEvent(t, models.EventShopCreated, "shop-1", map[string]any{"name": "Corner", "color": "red"})
	doPublish(t, srv, e)

	select {
	case got := <-ch:
		require.Equal(t, e.ID, got.ID, "live broadcast must carry the committed event")
		require.NotZero(t, got.Seq, "live broadcast must carry the DB-assigned seq")
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for live event on the hub")
	}
}
