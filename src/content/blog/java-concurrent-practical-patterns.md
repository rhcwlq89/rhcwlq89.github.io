---
title: "java.util.concurrent 실무 패턴 7선: 스레드 풀부터 동시성 제어까지"
description: "ExecutorService, CompletableFuture, CountDownLatch, ConcurrentHashMap, BlockingQueue, Semaphore, ReentrantLock — 실무에서 자주 쓰이는 java.util.concurrent 클래스 7개의 동작 원리와 실전 패턴을 정리한다."
pubDate: 2026-03-26T14:00:00+09:00
tags: ["Java", "Concurrency", "Thread", "Spring Boot", "Backend"]
heroImage: "../../assets/JavaConcurrentPracticalPatterns.png"
---

## 서론

멀티스레드 코드를 작성할 때 `synchronized`만으로 해결하려다 보면 금방 한계에 부딪힌다. 성능 병목, 데드락, 복잡한 콜백 지옥 — 이런 문제들을 해결하기 위해 Java는 `java.util.concurrent` 패키지를 제공한다.

문제는 이 패키지에 클래스가 너무 많다는 것이다. 뭘 언제 써야 하는지 감이 안 잡힌다. 이 글에서는 **실무에서 실제로 자주 쓰이는 7개 클래스**를 골라, 각각 **어떤 상황에서 왜 쓰는지**를 코드와 함께 정리한다.

---

## 1. ExecutorService — 스레드 풀 관리

### 왜 필요한가?

요청마다 `new Thread()`를 생성하면 스레드 생성/소멸 비용이 반복되고, 동시에 수천 개가 만들어지면 OOM이 발생한다. **스레드를 미리 만들어두고 재사용**하는 것이 스레드 풀이다.

### 실무 패턴: 외부 API 병렬 호출

상품 상세 페이지에서 상품 정보, 리뷰, 추천 상품을 **동시에** 가져오는 상황.

```java
ExecutorService executor = Executors.newFixedThreadPool(3);

Future<Product> productFuture = executor.submit(() -> productApi.getProduct(id));
Future<List<Review>> reviewFuture = executor.submit(() -> reviewApi.getReviews(id));
Future<List<Product>> recommendFuture = executor.submit(() -> recommendApi.get(id));

Product product = productFuture.get(3, TimeUnit.SECONDS);
List<Review> reviews = reviewFuture.get(3, TimeUnit.SECONDS);
List<Product> recommends = recommendFuture.get(3, TimeUnit.SECONDS);
```

### 주의할 점

| 실수 | 결과 | 해결 |
|------|------|------|
| 풀 크기를 너무 크게 설정 | 컨텍스트 스위칭 비용 증가, 오히려 느려짐 | CPU 바운드: 코어 수, I/O 바운드: 코어 수 × 2~4 |
| `executor.shutdown()`을 안 호출 | 스레드가 안 죽어서 앱이 종료 안 됨 | `try-finally`로 반드시 shutdown |
| `Executors.newCachedThreadPool()` 남용 | 요청 폭증 시 스레드가 무한 생성 → OOM | `newFixedThreadPool` 또는 직접 `ThreadPoolExecutor` 생성 |

> Spring Boot에서는 직접 ExecutorService를 만들기보다 `@Async` + `TaskExecutor` 빈을 사용하는 것이 일반적이다. 하지만 내부 동작 원리는 동일하다.

---

## 2. CompletableFuture — 비동기 조합

### 왜 필요한가?

`Future.get()`은 **블로킹**이다. 결과를 기다리는 동안 스레드가 놀게 된다. `CompletableFuture`는 콜백 체이닝으로 **논블로킹 비동기 처리**를 가능하게 한다.

### 실무 패턴: 비동기 파이프라인

주문 생성 → 결제 요청 → 알림 발송을 순차적으로, 하지만 **호출 스레드는 블로킹하지 않고** 처리.

```java
CompletableFuture
    .supplyAsync(() -> orderService.create(request))
    .thenApplyAsync(order -> paymentService.pay(order))
    .thenAcceptAsync(payment -> notificationService.send(payment))
    .exceptionally(ex -> {
        log.error("주문 처리 실패", ex);
        return null;
    });
```

### 여러 작업을 동시에 실행하고 합치기

```java
CompletableFuture<Product> productCf = CompletableFuture
    .supplyAsync(() -> productApi.getProduct(id));
CompletableFuture<List<Review>> reviewCf = CompletableFuture
    .supplyAsync(() -> reviewApi.getReviews(id));

// 둘 다 끝나면 합치기
CompletableFuture<ProductDetail> detailCf = productCf
    .thenCombine(reviewCf, (product, reviews) -> new ProductDetail(product, reviews));
```

### Future vs CompletableFuture

| 항목 | Future | CompletableFuture |
|------|--------|-------------------|
| 결과 확인 | `get()` 블로킹 | `thenApply()` 논블로킹 |
| 체이닝 | 불가 | `thenApply → thenCompose → thenCombine` |
| 예외 처리 | try-catch로 감싸야 함 | `exceptionally()`, `handle()` |
| 여러 작업 합치기 | 직접 구현 | `allOf()`, `anyOf()`, `thenCombine()` |

---

## 3. CountDownLatch — 동시 출발 / 완료 대기

### 왜 필요한가?

"N개의 스레드가 **동시에 시작**하게 하고 싶다" 또는 "N개의 작업이 **모두 끝날 때까지** 기다리고 싶다"는 상황에서 사용한다.

### 실무 패턴: 동시성 테스트

선착순 시스템에서 100명이 동시에 구매 요청을 보내는 테스트.

```java
int threadCount = 100;
ExecutorService executor = Executors.newFixedThreadPool(threadCount);
CountDownLatch ready = new CountDownLatch(threadCount);  // 모두 준비될 때까지
CountDownLatch start = new CountDownLatch(1);             // 동시 출발 신호
CountDownLatch done = new CountDownLatch(threadCount);    // 모두 끝날 때까지

for (int i = 0; i < threadCount; i++) {
    executor.submit(() -> {
        ready.countDown();   // "나 준비됐어"
        start.await();       // 출발 신호 대기
        try {
            purchaseService.buy(productId, userId);
        } finally {
            done.countDown(); // "나 끝났어"
        }
    });
}

ready.await();   // 100개 스레드 모두 준비 대기
start.countDown(); // 동시 출발!
done.await();    // 100개 스레드 모두 완료 대기

assertThat(product.getStock()).isEqualTo(0);
```

### 핵심 포인트

- `countDown()`은 카운트를 1 줄인다. 0이 되면 `await()` 중인 스레드가 깨어난다.
- **한 번 쓰고 버리는 도구**다. 카운트가 0이 되면 재사용할 수 없다. 재사용이 필요하면 `CyclicBarrier`를 쓴다.

---

## 4. ConcurrentHashMap — 스레드 안전한 캐시

### 왜 필요한가?

`HashMap`은 멀티스레드에서 동시에 put/get하면 무한 루프, 데이터 유실 등 예측 불가능한 버그가 발생한다. `Collections.synchronizedMap()`은 안전하지만 **모든 연산에 락**이 걸려서 느리다.

`ConcurrentHashMap`은 내부를 세그먼트로 나눠서 **동시 읽기는 락 없이, 쓰기는 해당 세그먼트만 잠근다.**

### 실무 패턴: 로컬 캐시

외부 API 결과를 메모리에 캐싱하되, 여러 스레드가 동시에 같은 키를 요청할 때 **API를 한 번만 호출**하고 싶은 상황.

```java
private final ConcurrentHashMap<String, Product> cache = new ConcurrentHashMap<>();

public Product getProduct(String id) {
    return cache.computeIfAbsent(id, key -> {
        // 이 블록은 같은 key에 대해 한 번만 실행됨
        return productApi.fetch(key);
    });
}
```

### 자주 하는 실수

```java
// ❌ check-then-act → 두 스레드가 동시에 null을 보고 둘 다 put
if (!map.containsKey(key)) {
    map.put(key, value);
}

// ✅ 원자적 연산 사용
map.putIfAbsent(key, value);
map.computeIfAbsent(key, k -> createValue(k));
```

> `containsKey()` → `put()` 사이에 다른 스레드가 끼어들 수 있다. ConcurrentHashMap의 원자적 메서드(`putIfAbsent`, `computeIfAbsent`, `merge`)를 사용해야 진짜 스레드 안전하다.

---

## 5. BlockingQueue — 생산자-소비자 패턴

### 왜 필요한가?

"한쪽에서 데이터를 넣고, 다른 쪽에서 꺼내 처리"하는 구조. 큐가 비면 소비자가 자동으로 대기하고, 큐가 가득 차면 생산자가 자동으로 대기한다. **직접 `wait()`/`notify()`를 구현할 필요가 없다.**

### 실무 패턴: 비동기 로그 수집기

요청 처리 중에 로그를 동기적으로 쓰면 응답 시간이 느려진다. 로그를 큐에 넣고 별도 스레드가 배치로 처리.

```java
private final BlockingQueue<LogEvent> logQueue = new LinkedBlockingQueue<>(10_000);

// 생산자: 요청 처리 스레드
public void log(LogEvent event) {
    if (!logQueue.offer(event)) {
        // 큐가 가득 차면 버림 (로그 유실 vs 서비스 장애 트레이드오프)
        System.err.println("로그 큐 초과, 이벤트 버림");
    }
}

// 소비자: 별도 스레드
public void startConsumer() {
    new Thread(() -> {
        while (!Thread.currentThread().isInterrupted()) {
            try {
                LogEvent event = logQueue.take(); // 큐가 빌 때까지 대기
                logWriter.write(event);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
    }).start();
}
```

### 구현체 선택

| 구현체 | 특징 | 적합한 상황 |
|--------|------|------------|
| `LinkedBlockingQueue` | 노드 기반, 크기 제한 선택 가능 | 일반적인 생산자-소비자 |
| `ArrayBlockingQueue` | 배열 기반, 크기 고정 | 메모리를 예측 가능하게 관리하고 싶을 때 |
| `PriorityBlockingQueue` | 우선순위 정렬 | 긴급 작업을 먼저 처리해야 할 때 |
| `SynchronousQueue` | 버퍼 없음, 직접 전달 | `Executors.newCachedThreadPool()` 내부에서 사용 |

---

## 6. Semaphore — 동시 접근 수 제한

### 왜 필요한가?

"최대 N개의 스레드만 동시에 이 자원을 사용할 수 있다"는 제약을 걸고 싶을 때. `synchronized`는 1개만 허용하지만, Semaphore는 **N개를 허용**한다.

### 실무 패턴: 외부 API 동시 호출 수 제한

외부 결제 API가 동시 요청을 10개까지만 허용하는 상황.

```java
private final Semaphore apiLimit = new Semaphore(10);

public PaymentResult pay(PaymentRequest request) throws InterruptedException {
    apiLimit.acquire(); // 10개 초과 시 대기
    try {
        return paymentApi.call(request);
    } finally {
        apiLimit.release(); // 슬롯 반환
    }
}
```

### 타임아웃 적용

```java
if (apiLimit.tryAcquire(3, TimeUnit.SECONDS)) {
    try {
        return paymentApi.call(request);
    } finally {
        apiLimit.release();
    }
} else {
    throw new RuntimeException("결제 API 호출 대기 시간 초과");
}
```

### Semaphore vs Rate Limiter

| 항목 | Semaphore | Rate Limiter (Guava/Resilience4j) |
|------|-----------|----------------------------------|
| 제어 기준 | **동시 실행 수** (지금 몇 개가 실행 중인가) | **단위 시간당 처리량** (초당 몇 개 허용) |
| 예시 | "동시에 10개만 호출" | "초당 100개만 호출" |
| 슬롯 반환 | 작업 완료 시 `release()` | 시간이 지나면 자동 충전 |

---

## 7. ReentrantLock — synchronized의 확장판

### 왜 필요한가?

`synchronized`는 단순하지만 **타임아웃**, **공정성 보장**, **조건 분기 대기** 같은 기능이 없다. `ReentrantLock`은 이런 부분을 지원한다.

### 실무 패턴: 타임아웃이 있는 락

데드락을 예방하기 위해 락 획득에 제한 시간을 두는 패턴.

```java
private final ReentrantLock lock = new ReentrantLock();

public void transferMoney(Account from, Account to, long amount) {
    try {
        if (lock.tryLock(3, TimeUnit.SECONDS)) {
            try {
                from.withdraw(amount);
                to.deposit(amount);
            } finally {
                lock.unlock();
            }
        } else {
            throw new RuntimeException("락 획득 타임아웃 — 잠시 후 재시도");
        }
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    }
}
```

### synchronized vs ReentrantLock

| 항목 | synchronized | ReentrantLock |
|------|-------------|---------------|
| 사용법 | 키워드 (자동 해제) | `lock()` / `unlock()` (수동 해제) |
| 타임아웃 | 불가 | `tryLock(timeout)` |
| 공정성 | 보장 안 됨 | `new ReentrantLock(true)` → 먼저 대기한 스레드 우선 |
| 조건 대기 | `wait()` / `notify()` | `Condition` 객체로 여러 조건 분리 가능 |
| 실수 위험 | 낮음 (자동 해제) | `unlock()` 누락 시 영구 락 → 반드시 `finally`에서 해제 |

> 단순한 임계 영역 보호라면 `synchronized`로 충분하다. `tryLock`, 공정성, 다중 조건이 필요할 때만 `ReentrantLock`을 쓰자.

---

## 정리: 언제 뭘 쓸까?

| 상황 | 클래스 |
|------|--------|
| 작업을 스레드 풀에서 병렬 실행 | `ExecutorService` |
| 비동기 작업을 체이닝하고 합치기 | `CompletableFuture` |
| N개 스레드 동시 출발 / 완료 대기 | `CountDownLatch` |
| 멀티스레드 환경의 Map (로컬 캐시) | `ConcurrentHashMap` |
| 생산자-소비자 큐 | `BlockingQueue` |
| 동시 접근 수 N개로 제한 | `Semaphore` |
| 타임아웃 / 공정성이 필요한 락 | `ReentrantLock` |

> 핵심은 **"직접 `Thread`를 만들지 말고, 직접 `wait()`/`notify()`를 쓰지 말라"**는 것이다. `java.util.concurrent`는 이미 검증된 도구들을 제공한다. 바퀴를 다시 발명하지 말자.
