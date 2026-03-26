---
title: "Implementing FCFS with Queues: From Redis Sorted Set to Kafka"
description: "Implements a first-come-first-served system using Redis Sorted Set waiting queues and Kafka message queues. Covers queue UX (polling vs WebSocket), slot reallocation on timeout/abandonment, and traffic spike absorption strategies."
pubDate: "2026-03-24T18:00:00+09:00"
tags: ["System Design", "First-Come-First-Served", "Redis", "Kafka", "Queue"]
heroImage: "../../../assets/FcfsQueueImplementation.png"
lang: en
---

## Introduction

In the [previous post](/blog/en/fcfs-redis-implementation), we handled tens of thousands of stock deductions per second with Redis. Fast and accurate — but one fundamental problem remains: **everyone hits the system at once.**

With 100 items and 10,000 concurrent requests, 9,900 people get an **instant "sold out."** It's over in 0.01 seconds. From the user's perspective, they click the button and it's immediately gone. That doesn't feel fair.

Queues solve this. They **transform "concurrent stampedes" into "orderly processing flows."** This post builds a waiting queue with Redis Sorted Set and processes orders asynchronously with Kafka.

---

## 1. Why Queues?

### 1.1 When Redis Alone Isn't Enough

| Scenario | Redis DECR/Lua | Queue |
|----------|---------------|-------|
| 100 stock, 100 concurrent | ✅ Perfect fit | Overengineered |
| 100 stock, 10,000 concurrent | 9,900 instant sold-out 😤 | Orderly guidance ✅ |
| 30,000 concert tickets | Handles it, but bad UX | Shows queue position ✅ |

The issue with Redis isn't **processing performance** — it's **user experience**. Just showing "you're #3,421 in line" completely changes how it feels.

### 1.2 Real-World Examples

The following are patterns observable from actual user-facing UX. Internal implementations are not publicly disclosed, so these are based on behavior visible on the user's screen.

- **Naver Ticketing**: "Current queue: 3,421 people, estimated wait: 5 minutes" — displays queue position and estimated time
- **Coupang Rocket Wow**: Waiting queue screen shown when accessing limited-quantity products
- **Interpark Tickets**: Queue position + entry token flow for concert bookings

Common pattern: **traffic is split into two phases.**
1. **Queue entry** — absorbs all traffic (fast)
2. **Actual purchase** — only a few enter at a time (stable)

---

## 2. Architecture Overview

```
[User] → [Queue Server (Redis Sorted Set)]
                    ↓ (in order)
          [Entry Allowed (token issued)]
                    ↓
          [Order Server (Kafka → DB)]
```

**Three separate layers:**
1. **Queue layer** — Redis Sorted Set manages ordering
2. **Entry control layer** — scheduler allows N users at a time
3. **Order processing layer** — Kafka handles async order processing

---

## 3. Queue Implementation: Redis Sorted Set

### 3.1 Why Sorted Set?

Redis Sorted Set is a **set sorted by score**. Put a timestamp as the score and you get a **FCFS waiting queue**.

| Command | Purpose |
|---------|---------|
| `ZADD` | Add to queue (score = timestamp) |
| `ZRANK` | Get my position |
| `ZCARD` | Total people waiting |
| `ZPOPMIN` | Pop the first N people |
| `ZSCORE` | A specific user's entry time |

### 3.2 Queue Service

```java
@Service
@RequiredArgsConstructor
public class WaitingQueueService {
    private final RedissonClient redissonClient;

    private static final String QUEUE_KEY = "waiting:product:";
    private static final String ALLOWED_KEY = "allowed:product:";

    /**
     * Enter the queue
     */
    public QueueEntryResult enterQueue(Long productId, Long userId) {
        RScoredSortedSet<String> queue = redissonClient
            .getScoredSortedSet(queueKey(productId));

        String member = userId.toString();

        // Already in queue → return current position
        Integer rank = queue.rank(member);
        if (rank != null) {
            return QueueEntryResult.alreadyInQueue(rank + 1, queue.size());
        }

        // Add to queue (score = current time in nanoseconds)
        queue.add(System.nanoTime(), member);
        int position = queue.rank(member) + 1;

        return QueueEntryResult.entered(position, queue.size());
    }

    /**
     * Check my position
     */
    public QueueStatusResult getQueueStatus(Long productId, Long userId) {
        RScoredSortedSet<String> queue = redissonClient
            .getScoredSortedSet(queueKey(productId));

        String member = userId.toString();
        Integer rank = queue.rank(member);

        if (rank == null) {
            // Not in queue → check if already allowed
            RSet<String> allowed = redissonClient.getSet(allowedKey(productId));
            if (allowed.contains(member)) {
                return QueueStatusResult.allowed();
            }
            return QueueStatusResult.notInQueue();
        }

        return QueueStatusResult.waiting(rank + 1, queue.size());
    }

    /**
     * Allow the next N users from the queue
     */
    public int allowNextBatch(Long productId, int batchSize) {
        RScoredSortedSet<String> queue = redissonClient
            .getScoredSortedSet(queueKey(productId));
        RSet<String> allowed = redissonClient.getSet(allowedKey(productId));

        Collection<String> batch = queue.pollFirst(batchSize);
        if (batch.isEmpty()) {
            return 0;
        }

        allowed.addAll(batch);
        return batch.size();
    }

    /**
     * Check if user is allowed to purchase
     */
    public boolean isAllowed(Long productId, Long userId) {
        RSet<String> allowed = redissonClient.getSet(allowedKey(productId));
        return allowed.contains(userId.toString());
    }

    private String queueKey(Long productId) {
        return QUEUE_KEY + productId;
    }

    private String allowedKey(Long productId) {
        return ALLOWED_KEY + productId;
    }
}
```

### 3.3 Response Models

```java
public record QueueEntryResult(
    QueueEntryStatus status,
    int position,
    long totalWaiting
) {
    public static QueueEntryResult entered(int position, long total) {
        return new QueueEntryResult(QueueEntryStatus.ENTERED, position, total);
    }

    public static QueueEntryResult alreadyInQueue(int position, long total) {
        return new QueueEntryResult(QueueEntryStatus.ALREADY_IN_QUEUE, position, total);
    }
}

public record QueueStatusResult(
    QueueWaitingStatus status,
    int position,
    long totalWaiting
) {
    public static QueueStatusResult waiting(int position, long total) {
        return new QueueStatusResult(QueueWaitingStatus.WAITING, position, total);
    }

    public static QueueStatusResult allowed() {
        return new QueueStatusResult(QueueWaitingStatus.ALLOWED, 0, 0);
    }

    public static QueueStatusResult notInQueue() {
        return new QueueStatusResult(QueueWaitingStatus.NOT_IN_QUEUE, 0, 0);
    }
}
```

### 3.4 Entry Scheduler

```java
@Component
@RequiredArgsConstructor
public class QueueScheduler {
    private final WaitingQueueService queueService;

    /**
     * Allow 10 users every 3 seconds
     */
    @Scheduled(fixedRate = 3000)
    public void processQueue() {
        List<Long> activeProducts = getActiveProductIds();

        for (Long productId : activeProducts) {
            int allowed = queueService.allowNextBatch(productId, 10);
            if (allowed > 0) {
                log.info("Product {}: {} users allowed entry", productId, allowed);
            }
        }
    }
}
```

The key is **tuning batchSize and interval** to control server load:
- batchSize 10, interval 3s → **~3.3 users/sec**
- batchSize 50, interval 1s → **50 users/sec**

Adjust to match your server's processing capacity.

---

## 4. Queue UX: Polling vs WebSocket

Users need to see their position in real time. Two approaches.

### 4.1 Polling

```
Client → [every 3 seconds] GET /api/queue/status?productId=1
Server → { "status": "WAITING", "position": 142, "total": 3421 }
```

```javascript
// Frontend
const pollQueue = async (productId) => {
    const interval = setInterval(async () => {
        const res = await fetch(`/api/queue/status?productId=${productId}`);
        const data = await res.json();

        updateUI(data.position, data.totalWaiting);

        if (data.status === 'ALLOWED') {
            clearInterval(interval);
            redirectToPurchasePage();
        }
    }, 3000);
};
```

### 4.2 WebSocket

```
Client ←→ [persistent WebSocket connection] ←→ Server
Server pushes on position change → { "position": 130, "total": 3400 }
```

```java
@Component
public class QueueWebSocketHandler extends TextWebSocketHandler {
    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();

    public void notifyPositionUpdate(Long userId, int position, long total) {
        WebSocketSession session = sessions.get(userId.toString());
        if (session != null && session.isOpen()) {
            String message = String.format(
                "{\"position\":%d,\"total\":%d}", position, total
            );
            session.sendMessage(new TextMessage(message));
        }
    }
}
```

### 4.3 Comparison

| Aspect | Polling | WebSocket |
|--------|---------|-----------|
| Implementation complexity | Low | High |
| Real-time accuracy | Delayed by poll interval | Instant |
| Server load | Waiters × QPS | Connection maintenance cost |
| Scalability | Stateless (easy horizontal scaling) | Stateful (session management needed) |
| 10,000 waiters, 3s polling | ~3,333 QPS | ~10,000 connections |

**Production recommendation: start with polling, switch to WebSocket if needed.**

Polling is simple and stateless — easy to scale horizontally. Consider WebSocket only when polling QPS becomes a burden with tens of thousands of waiters.

---

## 5. Order Processing: Kafka Async

Orders from allowed users are **processed asynchronously via Kafka**.

### 5.1 Why Kafka?

When allowed users place orders simultaneously, DB load spikes. Kafka acts as a buffer:

```
[Allowed Users] → [Order API] → [Kafka] → [Order Consumer] → [DB]
                                    ↑
                            Buffer (absorbs traffic)
```

- **Traffic absorption**: Kafka buffers sudden spikes
- **Controlled processing**: Consumer processes at DB's pace
- **Failure recovery**: Failed messages can be retried

### 5.2 Order Event

```java
public record OrderEvent(
    String eventId,
    Long productId,
    Long userId,
    int quantity,
    LocalDateTime requestedAt
) {
    public static OrderEvent create(Long productId, Long userId, int quantity) {
        return new OrderEvent(
            UUID.randomUUID().toString(),
            productId,
            userId,
            quantity,
            LocalDateTime.now()
        );
    }
}
```

### 5.3 Producer

```java
@Service
@RequiredArgsConstructor
public class OrderProducer {
    private final KafkaTemplate<String, OrderEvent> kafkaTemplate;
    private final WaitingQueueService queueService;

    private static final String TOPIC = "fcfs-orders";

    public void submitOrder(Long productId, Long userId, int quantity) {
        // Verify user is allowed
        if (!queueService.isAllowed(productId, userId)) {
            throw new RuntimeException("User not allowed through queue");
        }

        OrderEvent event = OrderEvent.create(productId, userId, quantity);

        kafkaTemplate.send(TOPIC, productId.toString(), event)
            .whenComplete((result, ex) -> {
                if (ex != null) {
                    log.error("Order event publish failed: {}", event.eventId(), ex);
                }
            });
    }
}
```

Using `productId` as the key ensures **orders for the same product go to the same partition** — processed in order.

### 5.4 Consumer

```java
@Component
@RequiredArgsConstructor
public class OrderConsumer {
    private final RedisLuaStockService redisStockService;
    private final OrderRepository orderRepository;

In Kafka, Consumers belong to a **Consumer Group**. The `groupId` is the name of that group.

When multiple Consumers share the same `groupId`, Kafka **distributes** partitions among them. Within the same group, each message is processed by **only one Consumer** — preventing duplicate processing.

```
Partition 0 → Consumer A (groupId: order-processor)
Partition 1 → Consumer B (groupId: order-processor)
Partition 2 → Consumer A (groupId: order-processor)
```

> Scaling up Pods adds more Consumers with the same `groupId`, and Kafka automatically rebalances partitions. This is how Kafka Consumers **scale horizontally**.

```java
@Component
@RequiredArgsConstructor
public class OrderConsumer {
    private final RedisLuaStockService redisStockService;
    private final OrderRepository orderRepository;

    @KafkaListener(topics = "fcfs-orders", groupId = "order-processor")
    @Transactional
    public void processOrder(OrderEvent event) {
        // 1. Redis stock deduction (Lua script)
        PurchaseResult result = redisStockService.tryPurchase(
            event.productId(), event.userId()
        );

        if (result != PurchaseResult.SUCCESS) {
            log.info("Order failed - product: {}, user: {}, reason: {}",
                event.productId(), event.userId(), result);
            // Send failure notification (WebSocket or push)
            return;
        }

        // 2. Save order to DB
        Order order = Order.create(
            event.productId(),
            event.userId(),
            event.quantity()
        );
        orderRepository.save(order);

        // 3. Send success notification
        log.info("Order success - orderId: {}, user: {}", order.getId(), event.userId());
    }
}
```

### 5.5 Connection to Outbox Pattern

For resilience against Kafka publish failures, apply the **Outbox pattern**:

```
1. Save event to outbox table in DB (same transaction as order)
2. Separate scheduler reads outbox and publishes to Kafka
3. Delete from outbox on successful publish
```

This prevents the **"DB saved but Kafka publish failed"** scenario — a pattern already used in the marketplace project.

---

## 6. Abandonment and Expiration Handling

Users may leave the queue or fail to purchase within the allowed time.

### 6.1 Queue Abandonment

When a user closes the browser or clicks cancel:

```java
public void leaveQueue(Long productId, Long userId) {
    RScoredSortedSet<String> queue = redissonClient
        .getScoredSortedSet(queueKey(productId));
    queue.remove(userId.toString());
}
```

Removing from the Sorted Set automatically advances everyone behind them.

### 6.2 Entry Token Expiration

If an allowed user doesn't purchase within the time limit, reclaim the slot:

```java
/**
 * Set TTL when allowing entry
 */
public int allowNextBatch(Long productId, int batchSize) {
    RScoredSortedSet<String> queue = redissonClient
        .getScoredSortedSet(queueKey(productId));

    Collection<String> batch = queue.pollFirst(batchSize);
    if (batch.isEmpty()) {
        return 0;
    }

    for (String userId : batch) {
        // Entry allowed + 5-minute TTL
        RBucket<String> token = redissonClient.getBucket(
            "entry-token:" + productId + ":" + userId
        );
        token.set("allowed", Duration.ofMinutes(5));
    }

    return batch.size();
}

/**
 * Reclaim expired slots (scheduler)
 */
@Scheduled(fixedRate = 10000) // every 10 seconds
public void reclaimExpiredSlots() {
    for (Long productId : getActiveProductIds()) {
        int expiredCount = countExpiredTokens(productId);
        if (expiredCount > 0) {
            queueService.allowNextBatch(productId, expiredCount);
            log.info("Product {}: {} expired → {} new entries allowed",
                productId, expiredCount, expiredCount);
        }
    }
}
```

### 6.3 Expiration Flow

```
User A: Entry allowed → doesn't purchase within 5 min → token expires
→ Scheduler detects → 1 slot reclaimed
→ Next user B in queue gets entry permission
```

---

## 7. End-to-End Flow

```
[1] User → POST /api/queue/enter
    → Redis ZADD (enter queue)
    → Response: { position: 342, total: 5000 }

[2] User → GET /api/queue/status (poll every 3s)
    → Redis ZRANK (check position)
    → Response: { position: 128, total: 4800 }

[3] Scheduler → ZPOPMIN 10 users every 3s
    → Issue entry-token (TTL 5 min)

[4] User → GET /api/queue/status
    → Response: { status: "ALLOWED" }
    → Redirect to purchase page

[5] User → POST /api/orders
    → Verify entry-token → Publish to Kafka

[6] Consumer → Redis Lua stock deduction → Save order to DB
    → Success/failure notification
```

---

## 8. Approach Comparison

| Aspect | DB Lock (Part 4) | Redis (Part 5) | Queue + Kafka (this post) |
|--------|-----------------|----------------|--------------------------|
| Processing | Serial (one at a time) | Atomic (very fast) | Async (ordered) |
| TPS | Hundreds | Tens of thousands | Tuned to server capacity |
| User experience | Instant response | Instant response | Queue position shown |
| 100K concurrent users | ❌ | Works, but 99K get instant sold-out | ✅ Orderly guidance |
| Implementation complexity | Low | Medium | High |
| Extra infrastructure | None | Redis | Redis + Kafka |
| Best for | Small events | Medium-scale FCFS | Large-scale ticketing |

---

## Summary

| Key Point | Details |
|-----------|---------|
| **Queue essence** | Transforms "concurrent stampede" into "orderly processing flow" |
| **Redis Sorted Set** | Score (timestamp) guarantees FCFS order, ZRANK for position |
| **Entry control** | Scheduler allows N users at a time, batchSize controls server load |
| **UX** | Start with polling → switch to WebSocket if needed |
| **Kafka** | Async order processing, absorbs traffic spikes |
| **Expiration handling** | Entry token TTL + slot reallocation scheduler |

Queues solve a **user experience problem, not a performance problem**. "Sold out" is worse than "You're #3,421 in line. Please wait."

The next post covers **token-based implementation**. Similar to queues, but issues entry tokens upfront — only token holders can purchase.
