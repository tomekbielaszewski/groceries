package handlers

import (
	"sync"

	"groceries/models"
)

// subscriber buffers events for a single stream connection. A forwarder
// goroutine drains the queue into the channel the stream handler reads, so a
// slow reader can neither stall the publisher nor cause an event to be
// silently dropped.
type subscriber struct {
	ch    chan models.Event
	mu    sync.Mutex
	queue []models.Event
	wake  chan struct{} // buffered(1); pokes the forwarder when the queue gains an entry
	done  chan struct{} // closed on Unsubscribe
}

// run moves queued events into ch until Unsubscribe closes done. It closes ch
// on exit so a reader blocked on <-ch observes the end of the stream.
func (s *subscriber) run() {
	defer close(s.ch)
	for {
		s.mu.Lock()
		if len(s.queue) == 0 {
			s.mu.Unlock()
			select {
			case <-s.done:
				return
			case <-s.wake:
				continue
			}
		}
		e := s.queue[0]
		s.queue = s.queue[1:]
		s.mu.Unlock()

		select {
		case s.ch <- e:
		case <-s.done:
			return
		}
	}
}

func (s *subscriber) enqueue(e models.Event) {
	s.mu.Lock()
	s.queue = append(s.queue, e)
	s.mu.Unlock()
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// Hub is an in-process pub/sub for live events. Publishers never block, and
// events are never silently dropped: each subscriber owns an unbounded queue
// drained by a forwarder goroutine.
type Hub struct {
	mu   sync.Mutex
	subs map[*subscriber]struct{}
}

func NewHub() *Hub {
	return &Hub{subs: make(map[*subscriber]struct{})}
}

// Subscribe registers a new subscriber and returns its event channel.
func (h *Hub) Subscribe() chan models.Event {
	s := &subscriber{
		ch:   make(chan models.Event, 16),
		wake: make(chan struct{}, 1),
		done: make(chan struct{}),
	}
	h.mu.Lock()
	h.subs[s] = struct{}{}
	h.mu.Unlock()
	go s.run()
	return s.ch
}

// Unsubscribe removes a subscriber and signals its forwarder to stop. The
// forwarder closes the channel once it drains, so a blocked reader can
// observe the stream ending.
func (h *Hub) Unsubscribe(ch chan models.Event) {
	h.mu.Lock()
	for s := range h.subs {
		if s.ch == ch {
			delete(h.subs, s)
			close(s.done)
		}
	}
	h.mu.Unlock()
}

// Publish delivers an event to every subscriber without blocking or dropping.
func (h *Hub) Publish(e models.Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for s := range h.subs {
		s.enqueue(e)
	}
}
