---
title: "Spring Boot Practical Guide Part 3: Event-Driven Architecture"
description: "Building a reliable event system with Kafka and the Outbox pattern"
pubDate: 2026-02-08T12:10:00+09:00
lang: en
tags: ["Spring Boot", "Kafka", "Event-Driven", "Backend", "Practical Guide"]
heroImage: "../../../assets/PracticalGuideSeries.png"
---

## Series Navigation

| Previous | Current | Next |
|:---:|:---:|:---:|
| [Part 2: Caching Strategy](/en/blog/springboot-practical-guide-2) | **Part 3: Event-Driven** | [Part 4: Resilience Patterns](/en/blog/springboot-practical-guide-4) |

---

## Introduction

In a microservice environment, inter-service communication determines the performance and reliability of the entire system. Synchronous direct calls create tight coupling and cascade failures, and **event-driven architecture** is widely used to solve these problems.

**Topics covered in Part 3:**
- Limitations of synchronous approaches and advantages of event-driven design
- The role of message queues and Kafka fundamentals
- Ensuring event publishing reliability with the Outbox pattern
- Consumer idempotency implementation strategies

### Table of Contents

- [Event-Driven Architecture (EDA)](#1-event-driven-architecture-eda)
- [Message Queue](#2-message-queue)
- [Event Design](#3-event-design)
- [Reliability Problem in Event Publishing](#4-reliability-problem-in-event-publishing)
- [Outbox Pattern Implementation](#5-outbox-pattern-implementation)
- [Duplicate Publishing and Idempotency](#6-duplicate-publishing-and-idempotency)
- [Kafka Fundamentals](#7-kafka-fundamentals)
- [Kafka Configuration](#8-kafka-configuration)
- [End-to-End Flow Summary](#9-end-to-end-flow-summary)
- [FAQ](#10-faq-interview-prep)
- [Summary](#summary)

---

## 1. Event-Driven Architecture (EDA)

### 1.1 Limitations of Traditional Synchronous Approach

**Direct Call Method (Request-Response)**

```
Order Service directly calls all downstream tasks:

[OrderService]
     |
     |-->  [InventoryService].decreaseStock()    (50ms)
     |-->  [PaymentService].processPayment()     (200ms)
     |-->  [EmailService].sendConfirmation()     (500ms)
     |-->  [NotificationService].sendPush()      (300ms)
     +-->  [AnalyticsService].recordOrder()      (100ms)

Total response time: 1,150ms
```

**Problems:**

| Problem | Description |
|---------|-------------|
| **Tight Coupling** | OrderService depends on 5 services |
| **Long Response Time** | Must wait for all tasks to complete before responding |
| **Failure Propagation** | EmailService failure -> Order failure |
| **Difficult to Extend** | Adding new features requires modifying OrderService |

### 1.2 Event-Driven Approach

**"Announce what happened" and let interested services react**

```
[OrderService]
     |
     +-->  "An order has been created" (publish event)
              |
              |-->  [InventoryService] "I'll decrease stock"
              |-->  [PaymentService] "I'll process payment"
              |-->  [EmailService] "I'll send an email"
              |-->  [NotificationService] "I'll send a push notification"
              +-->  [AnalyticsService] "I'll record it"

OrderService response time: 50ms (only event publishing)
The rest is processed asynchronously by each service
```

### 1.3 Core Concepts

```
+------------------------------------------------------------------+
|                    Event-Driven Architecture                       |
|                                                                    |
|   +-----------+         +-----------+         +-----------+       |
|   | Producer  | ------> |  Message  | ------> | Consumer  |       |
|   | (Publisher)|  Event  |   Queue   |  Event  |(Subscriber)|      |
|   +-----------+         |  (Broker) |         +-----------+       |
|                         +-----------+                              |
|        |                      |                      |             |
|   "Something happened"   Store/deliver msgs   "I'll handle it"    |
|                                                                    |
+------------------------------------------------------------------+
```

| Term | Description | Project Example |
|------|-------------|-----------------|
| **Event** | A fact that occurred in the system | "Order was created" |
| **Producer** | The service that publishes events | OrderService |
| **Consumer** | The service that consumes events | EmailService |
| **Message Queue** | Stores and delivers events | Kafka |

---

## 2. Message Queue

### 2.1 What Is a Message Queue?

**Analogy: Post Office System**

```
[Synchronous] - Direct delivery
Sender --------------------------> Receiver
       Sender goes to receiver's house
       and delivers directly (waits if receiver is absent)

[Message Queue] - Via post office
Sender -->  [Post Office] -->  Receiver
             |
             +-- Stores messages
             +-- Holds messages if receiver is absent
             +-- Receiver picks up when ready
```

### 2.2 Benefits of Message Queues

| Benefit | Description | Example |
|---------|-------------|---------|
| **Asynchronous Processing** | No waiting for response | Respond immediately after ordering, email sent later |
| **Decoupling** | Removes direct dependencies between services | OrderService doesn't need to know EmailService |
| **Buffering** | Absorbs traffic spikes | 1000 req/s -> queue them and process gradually |
| **Reliability** | Prevents message loss | Messages preserved even if consumer dies |
| **Scalability** | Horizontal scaling of consumers | Add more consumers if processing is slow |

### 2.3 Types of Message Queues

| Type | Characteristics | Use Case |
|------|-----------------|----------|
| **Kafka** | High performance, persistent storage, reprocessing | High-volume event streaming |
| **RabbitMQ** | Flexible routing, various protocols | When complex routing is needed |
| **AWS SQS** | Managed, easy setup | AWS environments |
| **Redis Pub/Sub** | Ultra-lightweight, memory-based | Real-time notifications (non-persistent) |

### 2.4 Point-to-Point vs Pub/Sub

**Point-to-Point (1:1)**
```
Producer -->  [Queue] -->  Consumer
               |
               +-- Only one Consumer receives the message
```

**Publish/Subscribe (1:N)** - Kafka's approach
```
Producer -->  [Topic] --+-->  Consumer Group A
                        +-->  Consumer Group B
                        +-->  Consumer Group C

               +-- All groups receive the same message
```

---

## 3. Event Design

### 3.1 Characteristics of Good Events

**1. Named in Past Tense (a fact that already occurred)**
```
Good: OrderCreated, PaymentCompleted, ItemShipped
Bad:  CreateOrder, ProcessPayment, ShipItem
```

**2. Immutable**
```kotlin
// Events represent facts that occurred, so they cannot be changed
data class OrderCreatedEvent(
    val orderId: Long,
    val buyerId: Long,
    val totalAmount: BigDecimal,
    val occurredAt: LocalDateTime = LocalDateTime.now()
)
```

**3. Self-contained**
```kotlin
// Bad: Consumer needs additional queries
data class OrderCreatedEvent(
    val orderId: Long  // Not enough information
)

// Good: Contains all necessary information
data class OrderCreatedEvent(
    val orderId: Long,
    val orderNumber: String,
    val buyerId: Long,
    val buyerEmail: String,
    val items: List<OrderItemDto>,
    val totalAmount: BigDecimal
)
```

### 3.2 Event Examples in the Project

```kotlin
// Order created event
payload = mapOf(
    "orderId" to savedOrder.id,
    "buyerId" to buyerId,
    "sellerIds" to sellerIds.toList(),
    "totalAmount" to savedOrder.totalAmount,
    "orderNumber" to savedOrder.orderNumber
)

// Order status changed event
payload = mapOf(
    "orderId" to savedOrder.id,
    "buyerId" to order.buyer.id,
    "sellerId" to sellerId,
    "status" to newStatus.name,
    "orderNumber" to savedOrder.orderNumber
)
```

---

## 4. Reliability Problem in Event Publishing

### 4.1 Dual Write Problem

```kotlin
@Transactional
fun createOrder(request: CreateOrderRequest) {
    // 1. Save order to DB
    val order = orderRepository.save(Order(...))

    // 2. Publish event to message queue
    messageQueue.send(OrderCreatedEvent(order.id))  // <- Problem!
}
```

**Why is this a problem?**

```
DB and message queue are separate systems (different transactions)

Case 1: DB commit succeeds, message publishing fails
+---------+     +---------+
|   DB    |     |  Queue  |
| OK Save |     | X Fail  |
+---------+     +---------+
-> Order exists but no event

Case 2: Message published but DB rolls back
+---------+     +---------+
|   DB    |     |  Queue  |
| X Rollback|   | OK Sent |
+---------+     +---------+
-> No order but event exists
```

### 4.2 Solution: Outbox Pattern

**Core Idea**: Store events in the **same DB** instead of the message queue

```
+------------------------------------------------------------------+
|                   Single DB Transaction                            |
|                                                                    |
|   +------------------+     +------------------+                   |
|   |  orders table    |     | outbox_events    |                   |
|   |                  |     |     table        |                   |
|   |  INSERT order    |     |  INSERT event    |                   |
|   +------------------+     +------------------+                   |
|                                                                    |
|          Both succeed or both fail (atomicity)                     |
+------------------------------------------------------------------+
                                    |
                            (Separate process)
                                    |
                                    v
                         +---------------------+
                         |   Message Queue     |
                         |   (Kafka, etc.)     |
                         +---------------------+
```

### 4.3 Guarantees of the Outbox Pattern

| Guarantee | Description |
|-----------|-------------|
| **At-least-once** | Events are published at least once |
| **Order Guarantee** | Events for the same aggregate are published in order |
| **Failure Recovery** | PENDING events are re-published after app restart |

**Note**: Duplicate publishing is possible -> Consumer idempotency is required

---

## 5. Outbox Pattern Implementation

### 5.1 Outbox Table

```sql
CREATE TABLE outbox_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    aggregate_type VARCHAR(100) NOT NULL,   -- "Order"
    aggregate_id VARCHAR(100) NOT NULL,     -- "123"
    event_type VARCHAR(100) NOT NULL,       -- "OrderCreated"
    payload TEXT NOT NULL,                  -- JSON data
    status VARCHAR(20) DEFAULT 'PENDING',   -- PENDING/PROCESSED/FAILED
    created_at DATETIME DEFAULT NOW(),
    processed_at DATETIME,
    retry_count INT DEFAULT 0
);
```

### 5.2 Saving Events Within a Transaction

```kotlin
@Transactional
fun createOrder(buyerId: Long, req: CreateOrderRequest): OrderResponse {
    // 1. Save order (same transaction)
    val savedOrder = orderJpaRepository.save(order)

    // 2. Save event to Outbox (same transaction)
    outboxEventService.saveEvent(
        aggregateType = "Order",
        aggregateId = savedOrder.id.toString(),
        eventType = "OrderCreated",
        payload = mapOf(
            "orderId" to savedOrder.id,
            "buyerId" to buyerId,
            "sellerIds" to sellerIds.toList(),
            "totalAmount" to savedOrder.totalAmount
        )
    )
    // On commit, both are saved or both are rolled back

    return OrderResponse.from(savedOrder)
}
```

### 5.3 Separate Process Publishes to Message Queue

```kotlin
// OutboxPublisher.kt
@Component
@Profile("docker", "prod")
class OutboxPublisher(
    private val outboxJpaRepository: OutboxJpaRepository,
    private val kafkaTemplate: KafkaTemplate<String, Any>
) {
    @Scheduled(fixedDelay = 1000)  // Every 1 second
    @Transactional
    fun publishPendingEvents() {
        val pendingEvents = outboxJpaRepository.findRetryableEvents()

        pendingEvents.forEach { event ->
            try {
                val topic = determineTopicForEvent(event.eventType)
                kafkaTemplate.send(topic, event.aggregateId, event.payload)
                event.markAsProcessed()
            } catch (e: Exception) {
                event.markAsFailed(e.message ?: "Unknown error")
            }
            outboxJpaRepository.save(event)
        }
    }

    // Clean up processed events older than 7 days
    @Scheduled(cron = "0 0 * * * *")
    fun cleanupProcessedEvents() {
        val cutoff = LocalDateTime.now().minusDays(7)
        outboxJpaRepository.deleteProcessedEventsBefore(PROCESSED, cutoff)
    }
}
```

### 5.4 Outbox Entity

```kotlin
// OutboxEvent.kt
@Entity
@Table(name = "outbox_events")
class OutboxEvent(
    val aggregateType: String,    // "Order"
    val aggregateId: String,      // "123"
    val eventType: String,        // "OrderCreated"
    val payload: String,          // JSON

    var status: OutboxStatus = OutboxStatus.PENDING,
    var retryCount: Int = 0
) {
    fun markAsProcessed() {
        this.status = OutboxStatus.PROCESSED
        this.processedAt = LocalDateTime.now()
    }

    fun markAsFailed(error: String) {
        this.retryCount++
        if (this.retryCount >= MAX_RETRY_COUNT) {
            this.status = OutboxStatus.FAILED
        }
    }
}
```

---

## 6. Duplicate Publishing and Idempotency

### 6.1 Cases Where Duplicate Publishing Occurs

Since the Outbox pattern guarantees **at-least-once** delivery, duplicate publishing can occur.

**Case 1: Kafka publish succeeds, but DB update fails before completing**

```
OutboxPublisher execution flow:

1. Query PENDING events             OK
2. Publish to Kafka                 OK (message sent)
3. Update status = PROCESSED        X  (server crash!)
   ---------------------------------
   |  What if the app dies here?   |
   ---------------------------------

After restart:
- DB still shows status = PENDING
- OutboxPublisher publishes the same event again
- Consumer receives the same message twice
```

**Case 2: Network timeout**

```
1. Send publish request to Kafka    OK
2. Kafka stores the message         OK
3. Network timeout during response  X
   ---------------------------------
   |  Producer perceives failure   |
   |  But Kafka actually stored it |
   ---------------------------------

4. Retry logic publishes again
5. Kafka now has 2 copies of the same message
```

**Case 3: Simultaneous processing across multiple instances**

```
+------------------+     +------------------+
|   Instance A     |     |   Instance B     |
|                  |     |                  |
| 1. Query event   |     | 1. Query event   |
|    (id=1, PENDING)     |    (id=1, PENDING)
|                  |     |                  |
| 2. Publish to    |     | 2. Publish to    |
|    Kafka         |     |    Kafka         |
|                  |     |                  |
| 3. PROCESSED     |     | 3. PROCESSED     |
+------------------+     +------------------+

-> Same event published twice
```

### 6.2 Duplicate Handling Strategies

**Strategy 1: Ensure idempotency in the Consumer (recommended)**

```kotlin
@Component
class OrderEventConsumer(
    private val processedEventRepository: ProcessedEventRepository,
    private val emailService: EmailService
) {
    @KafkaListener(topics = ["marketplace.order.created"])
    fun handleOrderCreated(payload: Map<String, Any>, ack: Acknowledgment) {
        val eventId = payload["eventId"] as String

        // 1. Check if this event was already processed
        if (processedEventRepository.existsById(eventId)) {
            log.info("Event already processed, skipping: $eventId")
            ack.acknowledge()
            return
        }

        // 2. Execute business logic
        emailService.sendOrderConfirmation(payload)

        // 3. Record processing completion
        processedEventRepository.save(ProcessedEvent(eventId))

        ack.acknowledge()
    }
}
```

**Strategy 2: Prevent duplicates with DB unique constraints**

```kotlin
// Email sending record table
@Entity
@Table(
    uniqueConstraints = [
        UniqueConstraint(columnNames = ["order_id", "email_type"])
    ]
)
class EmailSentRecord(
    val orderId: Long,
    val emailType: String,  // "ORDER_CONFIRMATION"
    val sentAt: LocalDateTime = LocalDateTime.now()
)

// Used in the Consumer
fun sendOrderConfirmation(orderId: Long) {
    try {
        emailSentRecordRepository.save(
            EmailSentRecord(orderId, "ORDER_CONFIRMATION")
        )
        // Save succeeded = first processing -> send email
        emailService.send(...)
    } catch (e: DataIntegrityViolationException) {
        // Unique constraint violation = already processed -> skip
        log.info("Email already sent, skipping: orderId=$orderId")
    }
}
```

**Strategy 3: Prevent concurrent processing with distributed locks**

```kotlin
@Component
class OutboxPublisher(
    private val redissonClient: RedissonClient
) {
    @Scheduled(fixedDelay = 1000)
    fun publishPendingEvents() {
        val lock = redissonClient.getLock("outbox-publisher-lock")

        // Only one instance executes
        if (lock.tryLock(0, 5, TimeUnit.SECONDS)) {
            try {
                doPublish()
            } finally {
                lock.unlock()
            }
        }
    }
}
```

**Strategy 4: Prevent concurrent reads with SELECT FOR UPDATE**

```kotlin
interface OutboxJpaRepository : JpaRepository<OutboxEvent, Long> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT e FROM OutboxEvent e WHERE e.status = :status ORDER BY e.createdAt")
    fun findPendingEventsWithLock(status: OutboxStatus): List<OutboxEvent>
}
```

### 6.3 Idempotency Design Principles

| Principle | Description | Example |
|-----------|-------------|---------|
| **Unique Identifier** | Include a unique ID in every event | `eventId: UUID` |
| **Processing Record** | Store processed event IDs | `processed_events` table |
| **Business Key** | Check duplicates by natural key | `orderId + emailType` |
| **Result Consistency** | Same result after N executions | `UPDATE ... SET status = 'SENT'` |

```
Idempotent operation examples:

OK Idempotent: UPDATE status = 'SENT' WHERE id = 123
               (Result is the same no matter how many times it runs)

X  Not idempotent: INSERT INTO emails (order_id, ...)
                   (Running multiple times creates duplicate data)

X  Not idempotent: UPDATE point = point + 100
                   (Running multiple times keeps increasing)

OK Idempotent: UPDATE point = 1100 WHERE id = 123 AND point = 1000
               (Conditional update ensures idempotency)
```

---

## 7. Kafka Fundamentals

### 7.1 Kafka Architecture

```
+------------------------------------------------------------------+
|                        Kafka Cluster                               |
|                                                                    |
|   +----------------------------------------------------------+   |
|   |              Topic: marketplace.order.created              |   |
|   |                                                            |   |
|   |   Partition 0: [msg0] [msg3] [msg6] ---->  offset         |   |
|   |   Partition 1: [msg1] [msg4] [msg7] ---->  offset         |   |
|   |   Partition 2: [msg2] [msg5] [msg8] ---->  offset         |   |
|   |                                                            |   |
|   +----------------------------------------------------------+   |
|                                                                    |
+------------------------------------------------------------------+
```

#### Key Terms

| Term | Description |
|------|-------------|
| **Topic** | Message category (similar to a table) |
| **Partition** | A subdivision of a topic (for parallel processing) |
| **Offset** | Position of a message within a partition |
| **Consumer Group** | A set of consumers that consume messages together |

### 7.2 Partitions and Parallel Processing

```
Topic: orders (3 partitions)

[Producer]
    |
    +-- key=order-123 -->  Partition 0
    +-- key=order-456 -->  Partition 1
    +-- key=order-789 -->  Partition 2

[Consumer Group: email-service]
    |
    +-- Consumer 1 <-- Partition 0
    +-- Consumer 2 <-- Partition 1
    +-- Consumer 3 <-- Partition 2

-> 3 Consumers process in parallel
-> Same key (orderId) goes to the same partition -> order guaranteed
```

### 7.3 Consumer Group

```
Processing the same message for different purposes:

Topic: marketplace.order.created
              |
              +-->  Consumer Group: email-service
              |         +-- Send order confirmation email
              |
              +-->  Consumer Group: notification-service
              |         +-- Send push notification
              |
              +-->  Consumer Group: analytics-service
                        +-- Aggregate order statistics

Each group receives all messages (independent processing)
```

### 7.4 Message Retention Policy

**Kafka's characteristic: Messages are NOT deleted after consumption**

```
Traditional message queue (RabbitMQ, etc.):
+-----------------------------------------+
| Queue: [msg1] [msg2] [msg3]             |
|              v                          |
|        Consumer consumes msg1           |
|              v                          |
| Queue: [msg2] [msg3]  <- msg1 deleted   |
+-----------------------------------------+

Kafka:
+-----------------------------------------+
| Topic: [msg1] [msg2] [msg3]             |
|              v                          |
|        Consumer consumes msg1           |
|              v                          |
| Topic: [msg1] [msg2] [msg3]  <- intact! |
|         ^                               |
|    Only the consumer's offset moves     |
|    (0 -> 1)                             |
+-----------------------------------------+
```

#### Why Doesn't Kafka Delete Messages?

| Reason | Description |
|--------|-------------|
| **Multiple Consumer Groups** | Each group independently consumes the same messages |
| **Reprocessing (Replay)** | Move offset back to reprocess past messages |
| **Failure Recovery** | Process missed messages when consumer restarts |
| **Audit Log** | Ability to trace past events |

#### Retention Configuration

```yaml
# Kafka Topic configuration example
retention.ms: 604800000     # 7 days (milliseconds)
retention.bytes: -1         # No size limit (-1)

# Or
retention.hours: 168        # 7 days (hours)
```

#### Consumer Offset Management

```
Partition 0: [msg0] [msg1] [msg2] [msg3] [msg4] [msg5]
              offset: 0     1      2      3      4      5

Consumer Group A: offset = 3  (msg0~2 processed, processing from msg3)
Consumer Group B: offset = 1  (msg0 processed, processing from msg1)
Consumer Group C: offset = 5  (all processed)

-> Each group manages its own progress (offset) independently
-> Messages themselves are deleted according to the retention policy
```

#### Reprocessing (Replay) Use Cases

**Usage scenarios:**
- Reprocessing past data after a bug fix
- Processing past events when adding a new Consumer Group
- Re-querying events for data analysis

---

## 8. Kafka Configuration

### 8.1 Project's Kafka Config

```kotlin
// KafkaConfig.kt
@Configuration
@Profile("docker", "prod")
class KafkaConfig {

    companion object {
        const val ORDER_CREATED_TOPIC = "marketplace.order.created"
        const val ORDER_STATUS_CHANGED_TOPIC = "marketplace.order.status-changed"
    }

    @Bean
    fun producerFactory(): ProducerFactory<String, Any> {
        return DefaultKafkaProducerFactory(mapOf(
            ProducerConfig.BOOTSTRAP_SERVERS_CONFIG to bootstrapServers,
            ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG to StringSerializer::class.java,
            ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG to JsonSerializer::class.java,
            ProducerConfig.ACKS_CONFIG to "all",        // Confirm all replicas
            ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG to true  // Prevent duplicates
        ))
    }
}
```

### 8.2 Consumer Implementation Example

```kotlin
@Component
class OrderEventConsumer(
    private val emailService: EmailService
) {
    @KafkaListener(
        topics = ["marketplace.order.created"],
        groupId = "email-service"
    )
    fun handleOrderCreated(
        payload: Map<String, Any>,
        ack: Acknowledgment
    ) {
        val orderId = payload["orderId"] as Long
        val buyerId = payload["buyerId"] as Long

        // Idempotency check (prevent duplicate processing)
        if (emailService.alreadySent(orderId)) {
            ack.acknowledge()
            return
        }

        emailService.sendOrderConfirmation(orderId, buyerId)
        ack.acknowledge()  // Commit after processing complete
    }
}
```

---

## 9. End-to-End Flow Summary

```
+------------------------------------------------------------------+
|  1. Order creation request                                         |
|     POST /api/v1/orders                                           |
+------------------------------------------------------------------+
                              |
                              v
+------------------------------------------------------------------+
|  2. OrderService.createOrder() - Single transaction                |
|                                                                    |
|     orders table             outbox_events table                  |
|     +---------------+       +-------------------+                 |
|     | INSERT order  |       | INSERT event      |                 |
|     | id=123        |       | type=OrderCreated  |                |
|     | status=PENDING|       | status=PENDING     |                |
|     +---------------+       +-------------------+                 |
|                                                                    |
|     -> Return response (fast)                                      |
+------------------------------------------------------------------+
                              |
                              v
+------------------------------------------------------------------+
|  3. OutboxPublisher (runs every 1 second)                          |
|                                                                    |
|     Query outbox_events (status=PENDING)                          |
|              |                                                     |
|              v                                                     |
|     Publish to Kafka -->  marketplace.order.created               |
|              |                                                     |
|              v                                                     |
|     Update status = PROCESSED                                      |
+------------------------------------------------------------------+
                              |
                              v
+------------------------------------------------------------------+
|  4. Kafka Consumers (each processes independently)                 |
|                                                                    |
|     +------------------+  +------------------+                    |
|     | EmailService     |  | NotificationSvc  |                    |
|     | Order confirm    |  | Push notification|                    |
|     | email            |  |                  |                    |
|     +------------------+  +------------------+                    |
+------------------------------------------------------------------+
```

---

## 10. FAQ (Interview Prep)

### Q1. What are the pros and cons of event-driven architecture?

**Pros:**
- Loose coupling between services (decoupling)
- Reduced response time through asynchronous processing
- Independent scaling of individual services
- Failure isolation (one service failure doesn't propagate)

**Cons:**
- Difficult debugging (complex flow tracing)
- Eventual consistency
- Must consider message ordering and duplicate handling
- Increased infrastructure complexity

### Q2. Why use the Outbox pattern?

DB persistence and message publishing are separate transactions, so only one might succeed (dual write problem). The Outbox pattern stores events in the same DB transaction to guarantee atomicity, and a separate process later publishes them to the message queue.

### Q3. At-least-once vs At-most-once vs Exactly-once?

| Guarantee Level | Meaning | Implementation |
|----------------|---------|----------------|
| At-most-once | At most once (possible loss) | Commit before processing |
| At-least-once | At least once (possible duplicates) | Commit after processing |
| Exactly-once | Exactly once | Transaction + idempotency |

In practice, **at-least-once + consumer idempotency** is the realistic choice.

### Q4. How do you implement consumer idempotency?

```kotlin
fun handleEvent(event: OrderCreatedEvent, ack: Acknowledgment) {
    // 1. Check if already processed
    if (processedEventRepository.exists(event.eventId)) {
        ack.acknowledge()
        return
    }

    // 2. Execute business logic
    processOrder(event)

    // 3. Record processing completion
    processedEventRepository.save(event.eventId)

    ack.acknowledge()
}
```

### Q5. What if message ordering matters?

Messages with the same key (e.g., orderId) go to the same partition, so ordering is guaranteed.

```kotlin
// Events for the same order go to the same partition
kafkaTemplate.send(topic, orderId.toString(), payload)
```

### Q6. Kafka vs RabbitMQ: How to choose?

| Criteria | Kafka | RabbitMQ |
|----------|-------|----------|
| Throughput | High (millions of msg/s) | Medium |
| Message Retention | Persistent storage | Deleted after consumption |
| Reprocessing | Possible (move offset) | Difficult |
| Routing | Simple | Complex routing possible |
| Use Case | Event streaming, logs | Task queues, RPC |

---

## 11. Project File Structure

```
marketplace/
+-- marketplace-domain/
|   +-- src/main/kotlin/.../outbox/
|       +-- OutboxEvent.kt              # Outbox entity
|
+-- marketplace-infra/
|   +-- src/main/kotlin/.../outbox/
|       +-- OutboxJpaRepository.kt      # Repository
|
+-- marketplace-api/
|   +-- src/main/kotlin/.../
|       +-- config/
|       |   +-- KafkaConfig.kt          # Kafka configuration
|       +-- outbox/
|       |   +-- OutboxPublisher.kt      # Publishing scheduler
|       +-- order/
|           +-- OrderService.kt         # Event persistence
|
+-- docker-compose.yml                  # Kafka, Zookeeper
```

---

## Summary

### Core Pattern Comparison

| Pattern | Purpose | Key Concept |
|---------|---------|-------------|
| **Event-Driven** | Loose coupling between services | Producer -> Queue -> Consumer |
| **Outbox Pattern** | Event publishing reliability | Store DB and event in the same transaction |
| **Idempotency** | Duplicate message handling | Same result after processing same message N times |

### Message Guarantee Levels

| Guarantee Level | Meaning | Implementation |
|----------------|---------|----------------|
| At-most-once | At most once (possible loss) | Commit before processing |
| At-least-once | At least once (possible duplicates) | Commit after processing |
| Exactly-once | Exactly once | Transaction + idempotency |

### Quick Checklist

- [ ] Are events stored in the same transaction as the DB? (Outbox pattern)
- [ ] Is idempotency guaranteed in the consumer?
- [ ] Are duplicate checks performed using event IDs?
- [ ] Is ordering guaranteed for messages with the same key? (partition key)
- [ ] Is there a retry/DLQ strategy for processing failures?
- [ ] Are events named in past tense? (OrderCreated)
- [ ] Do events contain all necessary information? (self-containment)

---

The next part covers **Resilience Patterns (Circuit Breaker, Rate Limiter)**.

[Next: Part 4 - Resilience Patterns](/en/blog/springboot-practical-guide-4)
