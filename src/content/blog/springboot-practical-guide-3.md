---
title: "스프링부트 실무 가이드 3편: 이벤트 드리븐 아키텍처"
description: "Kafka와 Outbox 패턴으로 신뢰성 있는 이벤트 시스템 구축하기"
pubDate: 2026-01-25T12:00:00
tags: ["Spring Boot", "Kafka", "Event-Driven", "Backend", "실무가이드"]
heroImage: "../../assets/PracticalGuideSeries.png"
---

## 시리즈 네비게이션

| 이전 | 현재 | 다음 |
|:---:|:---:|:---:|
| [2편: 캐싱 전략](/blog/springboot-practical-guide-2) | **3편: 이벤트 드리븐** | [4편: Resilience 패턴](/blog/springboot-practical-guide-4) |

---

## TL;DR (핵심 요약)

```
이벤트 드리븐 = 비동기 + 느슨한 결합 + 확장성
Outbox 패턴 = DB 트랜잭션 + 이벤트 저장 → 별도 발행 (At-least-once)
Consumer = 멱등성 필수 (중복 처리 대비)
```

| 패턴 | 목적 | 핵심 |
|------|------|------|
| **이벤트 드리븐** | 서비스 간 느슨한 결합 | Producer → Queue → Consumer |
| **Outbox 패턴** | 이벤트 발행 신뢰성 | DB와 이벤트를 같은 트랜잭션에 저장 |
| **멱등성** | 중복 메시지 처리 | 같은 메시지 N번 처리해도 결과 동일 |

---

## 1. 이벤트 드리븐 아키텍처 (EDA)

### 1.1 전통적인 동기 방식의 한계

**직접 호출 방식 (Request-Response)**

```
주문 서비스가 모든 후속 작업을 직접 호출:

[OrderService]
     │
     ├──▶ [InventoryService].decreaseStock()    (50ms)
     ├──▶ [PaymentService].processPayment()     (200ms)
     ├──▶ [EmailService].sendConfirmation()     (500ms)
     ├──▶ [NotificationService].sendPush()      (300ms)
     └──▶ [AnalyticsService].recordOrder()      (100ms)

총 응답 시간: 1,150ms
```

**문제점:**

| 문제 | 설명 |
|------|------|
| **강한 결합** | OrderService가 5개 서비스에 의존 |
| **긴 응답 시간** | 모든 작업이 끝나야 응답 |
| **장애 전파** | EmailService 장애 → 주문 실패 |
| **확장 어려움** | 새 기능 추가 시 OrderService 수정 필요 |

### 1.2 이벤트 드리븐 방식

**"무슨 일이 일어났다"를 알리고, 관심 있는 서비스가 반응**

```
[OrderService]
     │
     └──▶ "주문이 생성되었다" (이벤트 발행)
              │
              ├──▶ [InventoryService] "재고 차감할게"
              ├──▶ [PaymentService] "결제 처리할게"
              ├──▶ [EmailService] "이메일 보낼게"
              ├──▶ [NotificationService] "푸시 보낼게"
              └──▶ [AnalyticsService] "기록할게"

OrderService 응답 시간: 50ms (이벤트 발행만)
나머지는 비동기로 각자 처리
```

### 1.3 핵심 개념

```
┌─────────────────────────────────────────────────────────────────┐
│                    이벤트 드리븐 아키텍처                         │
│                                                                  │
│   ┌───────────┐         ┌───────────┐         ┌───────────┐    │
│   │ Producer  │ ──────▶ │  Message  │ ──────▶ │ Consumer  │    │
│   │ (발행자)   │  Event  │   Queue   │  Event  │ (소비자)   │    │
│   └───────────┘         │  (브로커)  │         └───────────┘    │
│                         └───────────┘                           │
│        │                      │                      │          │
│   "일이 일어났다"         메시지 저장/전달        "내가 처리할게"   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

| 용어 | 설명 | 프로젝트 예시 |
|------|------|--------------|
| **Event** | 시스템에서 발생한 사실 | "주문이 생성됨" |
| **Producer** | 이벤트를 발행하는 서비스 | OrderService |
| **Consumer** | 이벤트를 소비하는 서비스 | EmailService |
| **Message Queue** | 이벤트를 저장하고 전달 | Kafka |

---

## 2. 메시지 큐

### 2.1 메시지 큐란?

**비유: 우체국 시스템**

```
[동기 방식] - 직접 전달
발신자 ──────────────────────▶ 수신자
       발신자가 수신자 집까지 가서
       직접 전달 (수신자 없으면 대기)

[메시지 큐] - 우체국 경유
발신자 ──▶ [우체국] ──▶ 수신자
           │
           ├── 메시지 보관
           ├── 수신자 부재 시 보관
           └── 수신자가 원할 때 수령
```

### 2.2 메시지 큐의 장점

| 장점 | 설명 | 예시 |
|------|------|------|
| **비동기 처리** | 응답 기다리지 않음 | 주문 후 즉시 응답, 이메일은 나중에 |
| **디커플링** | 서비스 간 직접 의존 제거 | OrderService는 EmailService 몰라도 됨 |
| **버퍼링** | 트래픽 급증 시 완충 | 초당 1000건 → 큐에 쌓고 천천히 처리 |
| **신뢰성** | 메시지 유실 방지 | Consumer 죽어도 메시지 보존 |
| **확장성** | Consumer 수평 확장 | 처리 느리면 Consumer 추가 |

### 2.3 메시지 큐 종류

| 종류 | 특징 | 사용 사례 |
|------|------|----------|
| **Kafka** | 고성능, 영구 저장, 재처리 가능 | 대용량 이벤트 스트리밍 |
| **RabbitMQ** | 유연한 라우팅, 다양한 프로토콜 | 복잡한 라우팅 필요 시 |
| **AWS SQS** | 관리형, 간편한 설정 | AWS 환경 |
| **Redis Pub/Sub** | 초경량, 메모리 기반 | 실시간 알림 (비영구적) |

### 2.4 Point-to-Point vs Pub/Sub

**Point-to-Point (1:1)**
```
Producer ──▶ [Queue] ──▶ Consumer
              │
              └── 하나의 Consumer만 메시지 수신
```

**Publish/Subscribe (1:N)** - Kafka 방식
```
Producer ──▶ [Topic] ──┬──▶ Consumer Group A
                       ├──▶ Consumer Group B
                       └──▶ Consumer Group C

              └── 모든 그룹이 같은 메시지 수신
```

---

## 3. 이벤트 설계

### 3.1 좋은 이벤트의 특징

**1. 과거형으로 명명 (이미 일어난 사실)**
```
좋음: OrderCreated, PaymentCompleted, ItemShipped
나쁨: CreateOrder, ProcessPayment, ShipItem
```

**2. 불변성 (Immutable)**
```kotlin
// 이벤트는 발생한 사실이므로 변경 불가
data class OrderCreatedEvent(
    val orderId: Long,
    val buyerId: Long,
    val totalAmount: BigDecimal,
    val occurredAt: LocalDateTime = LocalDateTime.now()
)
```

**3. 자기 완결성 (Self-contained)**
```kotlin
// 나쁨: Consumer가 추가 조회 필요
data class OrderCreatedEvent(
    val orderId: Long  // 이것만으론 정보 부족
)

// 좋음: 필요한 정보 포함
data class OrderCreatedEvent(
    val orderId: Long,
    val orderNumber: String,
    val buyerId: Long,
    val buyerEmail: String,
    val items: List<OrderItemDto>,
    val totalAmount: BigDecimal
)
```

### 3.2 프로젝트의 이벤트 예시

```kotlin
// 주문 생성 이벤트
payload = mapOf(
    "orderId" to savedOrder.id,
    "buyerId" to buyerId,
    "sellerIds" to sellerIds.toList(),
    "totalAmount" to savedOrder.totalAmount,
    "orderNumber" to savedOrder.orderNumber
)

// 주문 상태 변경 이벤트
payload = mapOf(
    "orderId" to savedOrder.id,
    "buyerId" to order.buyer.id,
    "sellerId" to sellerId,
    "status" to newStatus.name,
    "orderNumber" to savedOrder.orderNumber
)
```

---

## 4. 이벤트 발행의 신뢰성 문제

### 4.1 이중 쓰기 문제 (Dual Write Problem)

```kotlin
@Transactional
fun createOrder(request: CreateOrderRequest) {
    // 1. DB에 주문 저장
    val order = orderRepository.save(Order(...))

    // 2. 메시지 큐에 이벤트 발행
    messageQueue.send(OrderCreatedEvent(order.id))  // ← 문제!
}
```

**왜 문제인가?**

```
DB와 메시지 큐는 별개의 시스템 (서로 다른 트랜잭션)

Case 1: DB 커밋 성공, 메시지 발행 실패
┌─────────┐     ┌─────────┐
│   DB    │     │  Queue  │
│ ✅ 저장  │     │ ❌ 실패  │
└─────────┘     └─────────┘
→ 주문은 있는데 이벤트 없음

Case 2: 메시지 발행 후 DB 롤백
┌─────────┐     ┌─────────┐
│   DB    │     │  Queue  │
│ ❌ 롤백  │     │ ✅ 발행  │
└─────────┘     └─────────┘
→ 주문은 없는데 이벤트 있음
```

### 4.2 해결책: Outbox 패턴

**핵심 아이디어**: 이벤트를 메시지 큐 대신 **같은 DB에 저장**

```
┌─────────────────────────────────────────────────────────────────┐
│                   하나의 DB 트랜잭션                              │
│                                                                  │
│   ┌─────────────────┐     ┌─────────────────┐                   │
│   │   orders 테이블  │     │ outbox_events   │                   │
│   │                 │     │     테이블       │                   │
│   │  INSERT 주문    │     │  INSERT 이벤트  │                   │
│   └─────────────────┘     └─────────────────┘                   │
│                                                                  │
│            둘 다 성공하거나 둘 다 실패 (원자성)                    │
└─────────────────────────────────────────────────────────────────┘
                                    │
                            (별도 프로세스)
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   Message Queue     │
                         │   (Kafka 등)        │
                         └─────────────────────┘
```

### 4.3 Outbox 패턴의 보장

| 보장 | 설명 |
|------|------|
| **At-least-once** | 이벤트가 최소 한 번은 발행됨 |
| **순서 보장** | 같은 aggregate는 순서대로 발행 |
| **장애 복구** | 앱 재시작 후 PENDING 이벤트 재발행 |

**주의**: 중복 발행 가능 → Consumer에서 멱등성 필요

---

## 5. Outbox 패턴 구현

### 5.1 Outbox 테이블

```sql
CREATE TABLE outbox_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    aggregate_type VARCHAR(100) NOT NULL,   -- "Order"
    aggregate_id VARCHAR(100) NOT NULL,     -- "123"
    event_type VARCHAR(100) NOT NULL,       -- "OrderCreated"
    payload TEXT NOT NULL,                  -- JSON 데이터
    status VARCHAR(20) DEFAULT 'PENDING',   -- PENDING/PROCESSED/FAILED
    created_at DATETIME DEFAULT NOW(),
    processed_at DATETIME,
    retry_count INT DEFAULT 0
);
```

### 5.2 트랜잭션 내에서 이벤트 저장

```kotlin
@Transactional
fun createOrder(buyerId: Long, req: CreateOrderRequest): OrderResponse {
    // 1. 주문 저장 (같은 트랜잭션)
    val savedOrder = orderJpaRepository.save(order)

    // 2. Outbox에 이벤트 저장 (같은 트랜잭션)
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
    // 커밋 시 둘 다 저장되거나 둘 다 롤백

    return OrderResponse.from(savedOrder)
}
```

### 5.3 별도 프로세스가 메시지 큐로 발행

```kotlin
// OutboxPublisher.kt
@Component
@Profile("docker", "prod")
class OutboxPublisher(
    private val outboxJpaRepository: OutboxJpaRepository,
    private val kafkaTemplate: KafkaTemplate<String, Any>
) {
    @Scheduled(fixedDelay = 1000)  // 1초마다
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

    // 7일 지난 처리 완료 이벤트 정리
    @Scheduled(cron = "0 0 * * * *")
    fun cleanupProcessedEvents() {
        val cutoff = LocalDateTime.now().minusDays(7)
        outboxJpaRepository.deleteProcessedEventsBefore(PROCESSED, cutoff)
    }
}
```

### 5.4 Outbox 엔티티

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

## 6. 중복 발행과 멱등성

### 6.1 중복 발행이 발생하는 케이스

Outbox 패턴은 **At-least-once**를 보장하므로 중복 발행이 발생할 수 있습니다.

**Case 1: Kafka 발행 성공, DB 업데이트 전 장애**

```
OutboxPublisher 실행 흐름:

1. PENDING 이벤트 조회          ✅
2. Kafka로 발행                 ✅ (메시지 전송됨)
3. status = PROCESSED 업데이트  ❌ (서버 크래시!)
   ─────────────────────────────────
   │  이 시점에 앱이 죽으면?      │
   └─────────────────────────────────

재시작 후:
- DB에는 여전히 status = PENDING
- OutboxPublisher가 같은 이벤트를 다시 발행
- Consumer는 같은 메시지를 2번 받음
```

**Case 2: 네트워크 타임아웃**

```
1. Kafka로 발행 요청            ✅
2. Kafka가 메시지 저장          ✅
3. 응답 반환 중 네트워크 타임아웃  ❌
   ─────────────────────────────────
   │  Producer는 실패로 인식      │
   │  실제로는 Kafka에 저장됨     │
   └─────────────────────────────────

4. 재시도 로직에 의해 다시 발행
5. Kafka에 같은 메시지가 2개
```

**Case 3: 여러 인스턴스에서 동시 처리**

```
┌─────────────────┐     ┌─────────────────┐
│   Instance A    │     │   Instance B    │
│                 │     │                 │
│ 1. 이벤트 조회   │     │ 1. 이벤트 조회   │
│    (id=1, PENDING)    │    (id=1, PENDING)
│                 │     │                 │
│ 2. Kafka 발행   │     │ 2. Kafka 발행   │
│                 │     │                 │
│ 3. PROCESSED    │     │ 3. PROCESSED    │
└─────────────────┘     └─────────────────┘

→ 같은 이벤트가 2번 발행됨
```

### 6.2 중복 처리 전략

**전략 1: Consumer에서 멱등성 보장 (권장)**

```kotlin
@Component
class OrderEventConsumer(
    private val processedEventRepository: ProcessedEventRepository,
    private val emailService: EmailService
) {
    @KafkaListener(topics = ["marketplace.order.created"])
    fun handleOrderCreated(payload: Map<String, Any>, ack: Acknowledgment) {
        val eventId = payload["eventId"] as String

        // 1. 이미 처리한 이벤트인지 확인
        if (processedEventRepository.existsById(eventId)) {
            log.info("이미 처리된 이벤트, 스킵: $eventId")
            ack.acknowledge()
            return
        }

        // 2. 비즈니스 로직 처리
        emailService.sendOrderConfirmation(payload)

        // 3. 처리 완료 기록
        processedEventRepository.save(ProcessedEvent(eventId))

        ack.acknowledge()
    }
}
```

**전략 2: DB 유니크 제약으로 중복 방지**

```kotlin
// 이메일 발송 기록 테이블
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

// Consumer에서 사용
fun sendOrderConfirmation(orderId: Long) {
    try {
        emailSentRecordRepository.save(
            EmailSentRecord(orderId, "ORDER_CONFIRMATION")
        )
        // 저장 성공 = 첫 번째 처리 → 이메일 발송
        emailService.send(...)
    } catch (e: DataIntegrityViolationException) {
        // 유니크 제약 위반 = 이미 처리됨 → 스킵
        log.info("이미 발송된 이메일, 스킵: orderId=$orderId")
    }
}
```

**전략 3: 분산 락으로 동시 처리 방지**

```kotlin
@Component
class OutboxPublisher(
    private val redissonClient: RedissonClient
) {
    @Scheduled(fixedDelay = 1000)
    fun publishPendingEvents() {
        val lock = redissonClient.getLock("outbox-publisher-lock")

        // 하나의 인스턴스만 실행
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

**전략 4: SELECT FOR UPDATE로 동시 조회 방지**

```kotlin
interface OutboxJpaRepository : JpaRepository<OutboxEvent, Long> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT e FROM OutboxEvent e WHERE e.status = :status ORDER BY e.createdAt")
    fun findPendingEventsWithLock(status: OutboxStatus): List<OutboxEvent>
}
```

### 6.3 멱등성 설계 원칙

| 원칙 | 설명 | 예시 |
|------|------|------|
| **고유 식별자** | 모든 이벤트에 unique ID 포함 | `eventId: UUID` |
| **처리 기록** | 처리한 이벤트 ID 저장 | `processed_events` 테이블 |
| **비즈니스 키** | 자연 키로 중복 체크 | `orderId + emailType` |
| **결과 동일성** | N번 실행해도 결과 같음 | `UPDATE ... SET status = 'SENT'` |

```
멱등한 연산 예시:

✅ 멱등: UPDATE status = 'SENT' WHERE id = 123
         (여러 번 실행해도 결과 동일)

❌ 비멱등: INSERT INTO emails (order_id, ...)
          (여러 번 실행하면 중복 데이터)

❌ 비멱등: UPDATE point = point + 100
          (여러 번 실행하면 계속 증가)

✅ 멱등: UPDATE point = 1100 WHERE id = 123 AND point = 1000
         (조건부 업데이트로 멱등성 확보)
```

---

## 7. Kafka 기본 개념

### 7.1 Kafka 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                        Kafka Cluster                             │
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              Topic: marketplace.order.created            │   │
│   │                                                          │   │
│   │   Partition 0: [msg0] [msg3] [msg6] ───▶ offset         │   │
│   │   Partition 1: [msg1] [msg4] [msg7] ───▶ offset         │   │
│   │   Partition 2: [msg2] [msg5] [msg8] ───▶ offset         │   │
│   │                                                          │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### 핵심 용어

| 용어 | 설명 |
|------|------|
| **Topic** | 메시지 카테고리 (테이블과 유사) |
| **Partition** | 토픽을 나눈 단위 (병렬 처리용) |
| **Offset** | 파티션 내 메시지 위치 |
| **Consumer Group** | 함께 메시지를 소비하는 Consumer 집합 |

### 7.2 파티션과 병렬 처리

```
Topic: orders (3 partitions)

[Producer]
    │
    ├── key=order-123 ──▶ Partition 0
    ├── key=order-456 ──▶ Partition 1
    └── key=order-789 ──▶ Partition 2

[Consumer Group: email-service]
    │
    ├── Consumer 1 ◀── Partition 0
    ├── Consumer 2 ◀── Partition 1
    └── Consumer 3 ◀── Partition 2

→ 3개의 Consumer가 병렬로 처리
→ 같은 key(orderId)는 같은 파티션 → 순서 보장
```

### 7.3 Consumer Group

```
같은 메시지를 다른 용도로 처리:

Topic: marketplace.order.created
              │
              ├──▶ Consumer Group: email-service
              │         └── 주문 확인 이메일 발송
              │
              ├──▶ Consumer Group: notification-service
              │         └── 푸시 알림 발송
              │
              └──▶ Consumer Group: analytics-service
                        └── 주문 통계 집계

각 그룹은 모든 메시지를 받음 (독립적 처리)
```

### 7.4 메시지 보존 정책 (Retention)

**Kafka의 특징: 소비해도 메시지를 삭제하지 않음**

```
전통적인 메시지 큐 (RabbitMQ 등):
┌─────────────────────────────────────────┐
│ Queue: [msg1] [msg2] [msg3]             │
│              ↓                          │
│        Consumer가 msg1 소비             │
│              ↓                          │
│ Queue: [msg2] [msg3]  ← msg1 삭제됨     │
└─────────────────────────────────────────┘

Kafka:
┌─────────────────────────────────────────┐
│ Topic: [msg1] [msg2] [msg3]             │
│              ↓                          │
│        Consumer가 msg1 소비             │
│              ↓                          │
│ Topic: [msg1] [msg2] [msg3]  ← 그대로!  │
│         ↑                               │
│    Consumer의 offset만 이동 (0 → 1)     │
└─────────────────────────────────────────┘
```

#### 왜 삭제하지 않는가?

| 이유 | 설명 |
|------|------|
| **다중 Consumer Group** | 각 그룹이 독립적으로 같은 메시지 소비 |
| **재처리 (Replay)** | offset을 되돌려 과거 메시지 재처리 가능 |
| **장애 복구** | Consumer 재시작 시 놓친 메시지 처리 |
| **감사 로그** | 과거 이벤트 추적 가능 |

#### Retention 설정

```yaml
# Kafka Topic 설정 예시
retention.ms: 604800000     # 7일 (밀리초)
retention.bytes: -1         # 크기 제한 없음 (-1)

# 또는
retention.hours: 168        # 7일 (시간)
```

#### Consumer Offset 관리

```
Partition 0: [msg0] [msg1] [msg2] [msg3] [msg4] [msg5]
              offset: 0     1      2      3      4      5

Consumer Group A: offset = 3  (msg0~2 처리 완료, msg3부터 처리)
Consumer Group B: offset = 1  (msg0 처리 완료, msg1부터 처리)
Consumer Group C: offset = 5  (모두 처리 완료)

→ 각 그룹이 자신의 진행 상황(offset)을 별도로 관리
→ 메시지 자체는 retention 정책에 따라 삭제
```

#### 재처리 (Replay) 활용

**활용 사례:**
- 버그 수정 후 과거 데이터 재처리
- 새 Consumer Group 추가 시 과거 이벤트 처리
- 데이터 분석을 위한 이벤트 재조회

---

## 8. Kafka 설정

### 8.1 프로젝트의 Kafka Config

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
            ProducerConfig.ACKS_CONFIG to "all",        // 모든 복제본 확인
            ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG to true  // 중복 방지
        ))
    }
}
```

### 8.2 Consumer 구현 예시

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

        // 멱등성 체크 (중복 처리 방지)
        if (emailService.alreadySent(orderId)) {
            ack.acknowledge()
            return
        }

        emailService.sendOrderConfirmation(orderId, buyerId)
        ack.acknowledge()  // 처리 완료 후 커밋
    }
}
```

---

## 9. 전체 흐름 요약

```
┌─────────────────────────────────────────────────────────────────┐
│  1. 주문 생성 요청                                               │
│     POST /api/v1/orders                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. OrderService.createOrder() - 하나의 트랜잭션                 │
│                                                                  │
│     orders 테이블          outbox_events 테이블                  │
│     ┌──────────────┐       ┌──────────────────┐                 │
│     │ INSERT 주문  │       │ INSERT 이벤트    │                 │
│     │ id=123       │       │ type=OrderCreated│                 │
│     │ status=PENDING│       │ status=PENDING   │                 │
│     └──────────────┘       └──────────────────┘                 │
│                                                                  │
│     → 응답 반환 (빠름)                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. OutboxPublisher (1초마다 실행)                               │
│                                                                  │
│     outbox_events 조회 (status=PENDING)                         │
│              │                                                   │
│              ▼                                                   │
│     Kafka로 발행 ──▶ marketplace.order.created                  │
│              │                                                   │
│              ▼                                                   │
│     status = PROCESSED로 변경                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Kafka Consumers (각자 독립적으로 처리)                        │
│                                                                  │
│     ┌─────────────────┐  ┌─────────────────┐                    │
│     │ EmailService    │  │ NotificationSvc │                    │
│     │ 주문 확인 메일   │  │ 푸시 알림       │                    │
│     └─────────────────┘  └─────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. FAQ (면접 대비)

### Q1. 이벤트 드리븐 아키텍처의 장단점은?

**장점:**
- 서비스 간 느슨한 결합 (디커플링)
- 비동기 처리로 응답 시간 단축
- 개별 서비스 독립적 확장 가능
- 장애 격리 (한 서비스 장애가 전파되지 않음)

**단점:**
- 디버깅 어려움 (흐름 추적이 복잡)
- 최종 일관성 (Eventual Consistency)
- 메시지 순서, 중복 처리 고려 필요
- 인프라 복잡도 증가

### Q2. Outbox 패턴을 사용하는 이유는?

DB 저장과 메시지 발행은 서로 다른 트랜잭션이라 둘 중 하나만 성공할 수 있습니다 (이중 쓰기 문제). Outbox 패턴은 이벤트를 같은 DB 트랜잭션에 저장하여 원자성을 보장하고, 별도 프로세스가 나중에 메시지 큐로 발행합니다.

### Q3. At-least-once vs At-most-once vs Exactly-once?

| 보장 수준 | 의미 | 구현 |
|----------|------|------|
| At-most-once | 최대 한 번 (유실 가능) | 처리 전 커밋 |
| At-least-once | 최소 한 번 (중복 가능) | 처리 후 커밋 |
| Exactly-once | 정확히 한 번 | 트랜잭션 + 멱등성 |

일반적으로 **At-least-once + Consumer 멱등성**이 현실적인 선택입니다.

### Q4. Consumer 멱등성은 어떻게 구현하나요?

```kotlin
fun handleEvent(event: OrderCreatedEvent, ack: Acknowledgment) {
    // 1. 이미 처리했는지 확인
    if (processedEventRepository.exists(event.eventId)) {
        ack.acknowledge()
        return
    }

    // 2. 비즈니스 로직 처리
    processOrder(event)

    // 3. 처리 완료 기록
    processedEventRepository.save(event.eventId)

    ack.acknowledge()
}
```

### Q5. 메시지 순서가 중요하면 어떻게 하나요?

같은 키(예: orderId)를 가진 메시지는 같은 파티션으로 가므로 순서가 보장됩니다.

```kotlin
// 같은 주문의 이벤트는 같은 파티션으로
kafkaTemplate.send(topic, orderId.toString(), payload)
```

### Q6. Kafka vs RabbitMQ 선택 기준은?

| 기준 | Kafka | RabbitMQ |
|------|-------|----------|
| 처리량 | 높음 (수백만 msg/s) | 중간 |
| 메시지 보존 | 영구 저장 | 소비 후 삭제 |
| 재처리 | 가능 (offset 이동) | 어려움 |
| 라우팅 | 단순 | 복잡한 라우팅 가능 |
| 사용 사례 | 이벤트 스트리밍, 로그 | 작업 큐, RPC |

---

## 11. 프로젝트 파일 구조

```
marketplace/
├── marketplace-domain/
│   └── src/main/kotlin/.../outbox/
│       └── OutboxEvent.kt              # Outbox 엔티티
│
├── marketplace-infra/
│   └── src/main/kotlin/.../outbox/
│       └── OutboxJpaRepository.kt      # Repository
│
├── marketplace-api/
│   └── src/main/kotlin/.../
│       ├── config/
│       │   └── KafkaConfig.kt          # Kafka 설정
│       ├── outbox/
│       │   └── OutboxPublisher.kt      # 발행 스케줄러
│       └── order/
│           └── OrderService.kt         # 이벤트 저장
│
└── docker-compose.yml                  # Kafka, Zookeeper
```

---

## 요약

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  ✅ 이벤트 드리븐 = 비동기 + 느슨한 결합 + 확장성            │
│                                                             │
│  ✅ Outbox 패턴 = DB와 이벤트를 같은 트랜잭션에 저장         │
│     → 별도 프로세스가 Kafka로 발행                          │
│                                                             │
│  ✅ At-least-once 보장 → Consumer에서 멱등성 필수           │
│                                                             │
│  ✅ Kafka 특징:                                             │
│     - 파티션으로 병렬 처리                                  │
│     - Consumer Group으로 다중 구독                          │
│     - 메시지 보존 (재처리 가능)                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

> **다음 편**: [스프링부트 실무 가이드 4편: Resilience 패턴](/blog/springboot-practical-guide-4)
