---
title: "대기열로 선착순 시스템 구현하기: Redis Sorted Set부터 Kafka까지"
description: "Redis Sorted Set 대기열과 Kafka 메시지 큐로 선착순 시스템을 구현한다. 대기열 UX(폴링 vs 웹소켓), 이탈/만료 시 슬롯 재할당, 트래픽 폭주 흡수 전략까지 다룬다."
pubDate: 2026-03-24T18:00:00+09:00
tags:
  - System Design
  - First-Come-First-Served
  - Redis
  - Kafka
  - Queue
heroImage: "../../assets/FcfsQueueImplementation.png"
---

## 서론

[이전 글](/blog/fcfs-redis-implementation)에서 Redis로 초당 수만 건의 재고 차감을 처리했다. 빠르고 정확했지만, 한 가지 근본적인 문제가 남아 있다 — **모든 사용자가 동시에 몰린다.**

재고 100개에 10,000명이 동시에 요청하면, 9,900명은 **즉시 "품절"을 받는다.** 0.01초 만에 끝난다. 사용자 입장에서는 버튼을 누르자마자 품절이다. 공정하다고 느끼기 어렵다.

대기열은 이 문제를 해결한다. **"동시에 몰리는 요청"을 "순서대로 처리하는 흐름"으로 바꾼다.** 이번 글에서는 Redis Sorted Set으로 대기열을 만들고, Kafka로 주문을 비동기 처리하는 방식을 다룬다.

---

## 1. 왜 대기열인가?

### 1.1 Redis만으로는 부족한 경우

| 상황 | Redis DECR/Lua | 대기열 |
|------|---------------|--------|
| 재고 100, 동시 100명 | ✅ 적합 | 과잉 설계 |
| 재고 100, 동시 10,000명 | 9,900명 즉시 품절 😤 | 순서대로 안내 ✅ |
| 콘서트 티켓 30,000석 | 처리는 되지만 UX 나쁨 | 대기 순번 표시 ✅ |

Redis는 **처리 성능**의 문제가 아니라 **사용자 경험**의 문제다. "내가 몇 번째인지"를 보여주는 것만으로 체감이 완전히 달라진다.

### 1.2 실제 서비스에서 볼 수 있는 패턴

아래는 각 서비스를 실제로 사용할 때 확인할 수 있는 UX 기반의 사례다. 내부 구현은 공개되지 않았으므로, 사용자 화면에서 관찰 가능한 동작을 기준으로 정리한다.

- **네이버 예매**: "현재 대기 인원 3,421명, 예상 대기 시간 5분" — 대기열 순번과 예상 시간 표시
- **쿠팡 로켓와우**: 한정 수량 상품 접근 시 대기열 진입 화면 노출
- **인터파크 티켓**: 콘서트 예매 시 대기 순번 + 진입 토큰 방식

공통점: **트래픽을 두 단계로 분리**한다.
1. **대기열 진입** — 전체 트래픽을 받는다 (빠름)
2. **실제 구매** — 소수만 순서대로 진입한다 (안정적)

---

## 2. 아키텍처 개요

```
[사용자] → [대기열 서버 (Redis Sorted Set)]
                    ↓ (순서대로)
          [구매 진입 허용 (토큰 발급)]
                    ↓
          [주문 서버 (Kafka → DB)]
```

**3개의 계층으로 분리:**
1. **대기열 계층** — Redis Sorted Set으로 순서 관리
2. **진입 제어 계층** — 스케줄러가 N명씩 진입 허용
3. **주문 처리 계층** — Kafka로 비동기 주문 처리

---

## 3. 대기열 구현: Redis Sorted Set

### 3.1 왜 Sorted Set인가?

Redis Sorted Set은 **score 기준으로 정렬된 집합**이다. score에 진입 시각(타임스탬프)을 넣으면 **선착순 대기열**이 된다.

| 명령 | 역할 |
|------|------|
| `ZADD` | 대기열에 추가 (score = 타임스탬프) |
| `ZRANK` | 내 순번 조회 |
| `ZCARD` | 전체 대기 인원 |
| `ZPOPMIN` | 가장 앞 N명 꺼내기 |
| `ZSCORE` | 특정 사용자의 진입 시각 |

### 3.2 대기열 서비스

```java
@Service
@RequiredArgsConstructor
public class WaitingQueueService {
    private final RedissonClient redissonClient;

    private static final String QUEUE_KEY = "waiting:product:";
    private static final String ALLOWED_KEY = "allowed:product:";

    /**
     * 대기열 진입
     */
    public QueueEntryResult enterQueue(Long productId, Long userId) {
        RScoredSortedSet<String> queue = redissonClient
            .getScoredSortedSet(queueKey(productId));

        String member = userId.toString();

        // 이미 대기열에 있으면 현재 순번 반환
        Integer rank = queue.rank(member);
        if (rank != null) {
            return QueueEntryResult.alreadyInQueue(rank + 1, queue.size());
        }

        // 대기열에 추가 (score = 현재 시각 나노초)
        queue.add(System.nanoTime(), member);
        int position = queue.rank(member) + 1;

        return QueueEntryResult.entered(position, queue.size());
    }

    /**
     * 내 순번 조회
     */
    public QueueStatusResult getQueueStatus(Long productId, Long userId) {
        RScoredSortedSet<String> queue = redissonClient
            .getScoredSortedSet(queueKey(productId));

        String member = userId.toString();
        Integer rank = queue.rank(member);

        if (rank == null) {
            // 대기열에 없음 → 이미 진입 허용되었는지 확인
            RSet<String> allowed = redissonClient.getSet(allowedKey(productId));
            if (allowed.contains(member)) {
                return QueueStatusResult.allowed();
            }
            return QueueStatusResult.notInQueue();
        }

        return QueueStatusResult.waiting(rank + 1, queue.size());
    }

    /**
     * 상위 N명을 대기열에서 꺼내서 진입 허용
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
     * 진입 허용 여부 확인
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

### 3.3 응답 모델

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

### 3.4 진입 허용 스케줄러

```java
@Component
@RequiredArgsConstructor
public class QueueScheduler {
    private final WaitingQueueService queueService;

    /**
     * 3초마다 10명씩 진입 허용
     */
    @Scheduled(fixedRate = 3000)
    public void processQueue() {
        List<Long> activeProducts = getActiveProductIds();

        for (Long productId : activeProducts) {
            int allowed = queueService.allowNextBatch(productId, 10);
            if (allowed > 0) {
                log.info("상품 {}: {}명 진입 허용", productId, allowed);
            }
        }
    }
}
```

핵심은 **batchSize와 주기를 조절**해서 서버 부하를 제어하는 것이다:
- batchSize 10, 주기 3초 → **초당 ~3.3명** 처리
- batchSize 50, 주기 1초 → **초당 50명** 처리

서버의 처리 용량에 맞춰 조절한다.

---

## 4. 대기열 UX: 폴링 vs 웹소켓

사용자가 "내가 몇 번째인지"를 실시간으로 알아야 한다. 두 가지 방법이 있다.

### 4.1 폴링 (Polling)

```
클라이언트 → [3초마다] GET /api/queue/status?productId=1
서버 → { "status": "WAITING", "position": 142, "total": 3421 }
```

```javascript
// 프론트엔드
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

### 4.2 웹소켓 (WebSocket)

```
클라이언트 ←→ [WebSocket 연결 유지] ←→ 서버
서버가 순번 변경 시 push → { "position": 130, "total": 3400 }
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

### 4.3 비교

| 항목 | 폴링 | 웹소켓 |
|------|------|--------|
| 구현 복잡도 | 낮음 | 높음 |
| 실시간성 | 폴링 간격만큼 지연 | 즉시 |
| 서버 부하 | 대기 인원 × QPS | 연결 유지 비용 |
| 확장성 | 스테이트리스 (수평 확장 쉬움) | 스테이트풀 (세션 관리 필요) |
| 대기 인원 1만 명, 3초 폴링 | ~3,333 QPS | ~10,000 커넥션 |

**실무 권장: 폴링으로 시작하고, 필요하면 웹소켓으로 전환한다.**

폴링은 단순하고 스테이트리스라 수평 확장이 쉽다. 대기 인원이 수만 명을 넘어서 폴링 QPS가 부담되면 그때 웹소켓을 고려한다.

---

## 5. 주문 처리: Kafka 비동기 처리

진입이 허용된 사용자의 주문을 **Kafka로 비동기 처리**한다.

### 5.1 왜 Kafka인가?

구매 진입이 허용된 사용자가 동시에 주문을 넣으면, 결국 DB에 부하가 몰린다. Kafka를 사이에 두면:

```
[진입 허용된 사용자] → [주문 API] → [Kafka] → [주문 Consumer] → [DB]
                                       ↑
                               버퍼 역할 (트래픽 흡수)
```

- **트래픽 흡수**: 순간 폭주를 Kafka가 버퍼링
- **처리 속도 제어**: Consumer가 DB 용량에 맞춰 소비
- **실패 복구**: 처리 실패 시 재시도 가능

### 5.2 주문 이벤트

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
        // 진입 허용된 사용자인지 확인
        if (!queueService.isAllowed(productId, userId)) {
            throw new RuntimeException("대기열 진입이 허용되지 않은 사용자");
        }

        OrderEvent event = OrderEvent.create(productId, userId, quantity);

        kafkaTemplate.send(TOPIC, productId.toString(), event)
            .whenComplete((result, ex) -> {
                if (ex != null) {
                    log.error("주문 이벤트 발행 실패: {}", event.eventId(), ex);
                }
            });
    }
}
```

`productId`를 key로 사용하면 **같은 상품의 주문이 같은 파티션**으로 간다. 이렇게 하면 하나의 상품에 대한 주문이 순서대로 처리된다.

### 5.4 Consumer

Kafka에서 메시지를 소비하는 Consumer는 **Consumer Group**에 소속된다. `groupId`는 이 그룹의 이름이다.

같은 `groupId`를 가진 Consumer가 여러 개 있으면, Kafka는 파티션을 Consumer들에게 **분배**한다. 즉 같은 그룹 내에서는 하나의 메시지를 **한 Consumer만** 처리한다 — 중복 처리가 방지된다.

```
파티션 0 → Consumer A (groupId: order-processor)
파티션 1 → Consumer B (groupId: order-processor)
파티션 2 → Consumer A (groupId: order-processor)
```

> Pod를 늘리면 같은 `groupId`의 Consumer가 추가되고, Kafka가 파티션을 자동으로 재분배한다. 이것이 Kafka Consumer의 **수평 확장** 방식이다.

```java
@Component
@RequiredArgsConstructor
public class OrderConsumer {
    private final RedisLuaStockService redisStockService;
    private final OrderRepository orderRepository;

    @KafkaListener(topics = "fcfs-orders", groupId = "order-processor")
    @Transactional
    public void processOrder(OrderEvent event) {
        // 1. Redis 재고 차감 (Lua 스크립트)
        PurchaseResult result = redisStockService.tryPurchase(
            event.productId(), event.userId()
        );

        if (result != PurchaseResult.SUCCESS) {
            log.info("주문 실패 - 상품: {}, 사용자: {}, 사유: {}",
                event.productId(), event.userId(), result);
            // 실패 알림 발송 (웹소켓 또는 푸시)
            return;
        }

        // 2. DB 주문 저장
        Order order = Order.create(
            event.productId(),
            event.userId(),
            event.quantity()
        );
        orderRepository.save(order);

        // 3. 성공 알림 발송
        log.info("주문 성공 - 주문 ID: {}, 사용자: {}", order.getId(), event.userId());
    }
}
```

### 5.5 Outbox 패턴과의 연결

Kafka 발행 실패에 대비해 **Outbox 패턴**을 적용할 수 있다:

```
1. DB에 outbox 테이블에 이벤트 저장 (주문과 같은 트랜잭션)
2. 별도 스케줄러가 outbox를 읽어서 Kafka에 발행
3. 발행 성공 시 outbox에서 삭제
```

이렇게 하면 **"DB 저장은 됐는데 Kafka 발행 실패"** 상황을 방지할 수 있다. marketplace 프로젝트에서 이미 사용 중인 패턴이다.

---

## 6. 이탈/만료 처리

대기열에서 사용자가 이탈하거나, 진입 후 시간 내에 구매하지 않는 경우를 처리해야 한다.

### 6.1 대기열 이탈

사용자가 브라우저를 닫거나 취소 버튼을 누르면:

```java
public void leaveQueue(Long productId, Long userId) {
    RScoredSortedSet<String> queue = redissonClient
        .getScoredSortedSet(queueKey(productId));
    queue.remove(userId.toString());
}
```

Sorted Set에서 제거하면 뒤의 사람들의 순번이 자동으로 앞당겨진다.

### 6.2 진입 토큰 만료

진입이 허용된 사용자가 일정 시간 내에 구매하지 않으면 슬롯을 회수한다:

```java
/**
 * 진입 허용 시 TTL 설정
 */
public int allowNextBatch(Long productId, int batchSize) {
    RScoredSortedSet<String> queue = redissonClient
        .getScoredSortedSet(queueKey(productId));

    Collection<String> batch = queue.pollFirst(batchSize);
    if (batch.isEmpty()) {
        return 0;
    }

    for (String userId : batch) {
        // 진입 허용 + 5분 TTL
        RBucket<String> token = redissonClient.getBucket(
            "entry-token:" + productId + ":" + userId
        );
        token.set("allowed", Duration.ofMinutes(5));
    }

    return batch.size();
}

/**
 * 만료된 슬롯 재할당 (스케줄러)
 */
@Scheduled(fixedRate = 10000) // 10초마다
public void reclaimExpiredSlots() {
    for (Long productId : getActiveProductIds()) {
        int expiredCount = countExpiredTokens(productId);
        if (expiredCount > 0) {
            queueService.allowNextBatch(productId, expiredCount);
            log.info("상품 {}: 만료 {}건 → {}명 추가 진입",
                productId, expiredCount, expiredCount);
        }
    }
}
```

### 6.3 만료 처리 흐름

```
사용자 A: 진입 허용 → 5분 내 미구매 → 토큰 만료
→ 스케줄러 감지 → 슬롯 1개 회수
→ 대기열 다음 사용자 B에게 진입 허용
```

---

## 7. 전체 흐름 정리

```
[1] 사용자 → POST /api/queue/enter
    → Redis ZADD (대기열 진입)
    → 응답: { position: 342, total: 5000 }

[2] 사용자 → GET /api/queue/status (3초 폴링)
    → Redis ZRANK (순번 조회)
    → 응답: { position: 128, total: 4800 }

[3] 스케줄러 → 3초마다 10명씩 ZPOPMIN
    → entry-token 발급 (TTL 5분)

[4] 사용자 → GET /api/queue/status
    → 응답: { status: "ALLOWED" }
    → 구매 페이지로 이동

[5] 사용자 → POST /api/orders
    → entry-token 확인 → Kafka 발행

[6] Consumer → Redis Lua 재고 차감 → DB 주문 저장
    → 성공/실패 알림
```

---

## 8. 방식별 비교

| 항목 | DB 락 (4편) | Redis (5편) | 대기열 + Kafka (이번 글) |
|------|-----------|------------|----------------------|
| 동시 처리 | 직렬 (1명씩) | 원자적 (매우 빠름) | 비동기 (순서대로) |
| TPS | 수백 | 수만 | 서버 용량에 맞춰 조절 |
| 사용자 경험 | 즉시 응답 | 즉시 응답 | 대기 순번 표시 |
| 트래픽 10만 명 | ❌ | 처리는 되지만 9.9만 명 즉시 품절 | ✅ 순서대로 안내 |
| 구현 복잡도 | 낮음 | 중간 | 높음 |
| 추가 인프라 | 없음 | Redis | Redis + Kafka |
| 적합한 상황 | 소규모 이벤트 | 중규모 선착순 | 대규모 티켓팅/예매 |

---

## 정리

| 핵심 포인트 | 내용 |
|------------|------|
| **대기열의 본질** | "동시에 몰리는 요청"을 "순서대로 처리하는 흐름"으로 전환 |
| **Redis Sorted Set** | score(타임스탬프)로 선착순 보장, ZRANK로 순번 조회 |
| **진입 제어** | 스케줄러가 N명씩 허용, 서버 부하를 batchSize로 제어 |
| **UX** | 폴링으로 시작 → 필요 시 웹소켓 전환 |
| **Kafka** | 주문을 비동기 처리, 트래픽 폭주 흡수 |
| **만료 처리** | 진입 토큰 TTL + 슬롯 재할당 스케줄러 |

대기열은 **성능이 아니라 경험의 문제**를 해결한다. "품절입니다"보다 "3,421번째입니다. 잠시만 기다려주세요"가 훨씬 낫다.

다음 글에서는 **토큰 발급 방식**을 다룬다. 대기열과 비슷하지만, 입장 토큰을 먼저 발급하고 토큰 보유자만 구매할 수 있게 하는 방식이다.
