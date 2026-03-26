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

### 거부 정책 (RejectedExecutionHandler)

스레드 풀의 스레드가 전부 바쁘고, 대기 큐까지 꽉 찬 상태에서 새 작업이 들어오면 어떻게 할 것인가? 이것이 **거부 정책**이다.

| 정책 | 동작 | 적합한 상황 |
|------|------|-----------|
| `AbortPolicy` (기본값) | `RejectedExecutionException` 예외 발생 | 작업 유실을 허용하지 않을 때 |
| `CallerRunsPolicy` | 작업을 **제출한 스레드가 직접 실행** | 작업을 버리면 안 되고, 자연스럽게 속도를 늦추고 싶을 때 |
| `DiscardPolicy` | 조용히 버림 (예외도 없음) | 로그 수집처럼 일부 유실이 괜찮을 때 |
| `DiscardOldestPolicy` | 대기 큐에서 가장 오래된 작업을 버리고 새 작업 추가 | 최신 데이터가 더 중요할 때 |

```java
// 거부 정책 설정 예시
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    3, 10, 60L, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(50),
    new ThreadPoolExecutor.CallerRunsPolicy() // 풀이 꽉 차면 호출 스레드가 직접 실행
);
```

> `CallerRunsPolicy`는 실무에서 가장 많이 쓰이는 정책이다. 풀이 과부하되면 호출 스레드(보통 요청 스레드)가 직접 작업을 처리하게 되면서 자연스럽게 **배압(backpressure)**이 걸린다 — 새 요청 자체가 느려지므로 시스템이 무한정 밀리지 않는다.

### 풀 사이즈는 어떻게 정하는가?

정해진 공식은 없지만, 널리 쓰이는 가이드라인은 **작업의 유형**에 따라 나뉜다.

| 유형 | 특징 | corePoolSize 가이드 |
|------|------|-------------------|
| **CPU 바운드** | 계산, 암호화, 압축 등 CPU를 계속 쓰는 작업 | `코어 수` 또는 `코어 수 + 1` |
| **I/O 바운드** | DB 쿼리, API 호출, 파일 읽기 등 대기 시간이 긴 작업 | `코어 수 × 2` ~ `코어 수 × 4` |

왜 이런 차이가 나는가?
- **CPU 바운드**는 스레드가 CPU를 계속 점유한다 → 코어 수 이상 만들면 컨텍스트 스위칭만 늘어남
- **I/O 바운드**는 스레드가 대기(waiting) 상태로 CPU를 놓는다 → 더 많은 스레드가 교대로 CPU를 활용 가능

대부분의 Spring Boot 앱은 DB 조회, 외부 API 호출 등 **I/O 바운드 작업**이 대부분이므로, 다음을 출발점으로 삼는다.

```java
int cpuCores = Runtime.getRuntime().availableProcessors(); // 예: 4

ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
executor.setCorePoolSize(cpuCores * 2);    // 8  — 평상시 유지되는 스레드 수
executor.setMaxPoolSize(cpuCores * 4);     // 16 — 트래픽 급증 시 최대 스레드 수
executor.setQueueCapacity(100);            // 대기 큐 크기
```

> 이 값은 **출발점이지 정답이 아니다.** 실제 운영에서는 부하 테스트(nGrinder, k6 등)로 조정해야 한다.

### corePoolSize, maxPoolSize, queueCapacity의 동작 순서

이 세 값이 어떤 순서로 작동하는지 이해하는 것이 중요하다.

```
새 작업 도착
  ↓
core 스레드에 여유 있음? → YES → core 스레드가 처리
  ↓ NO
대기 큐에 자리 있음?     → YES → 큐에 넣고 대기
  ↓ NO
max 스레드까지 여유 있음? → YES → 새 스레드 생성해서 처리
  ↓ NO
거부 정책 발동 (CallerRunsPolicy 등)
```

> **주의:** core 스레드가 바쁘면 바로 max까지 늘어나는 게 아니라, **큐가 먼저 찬다.** max 스레드는 큐까지 꽉 찬 후에야 생성된다. 이 순서를 모르면 "maxPoolSize를 늘렸는데 왜 스레드가 안 늘어나지?"라는 혼란에 빠진다.

### Spring Boot에서는?

Spring Boot에서는 직접 `ExecutorService`를 생성하지 않는다. 대신 `ThreadPoolTaskExecutor`를 빈으로 등록하고, `@Async`로 비동기 실행을 위임한다.

```java
@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean(name = "apiExecutor")
    public TaskExecutor apiExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(3);
        executor.setMaxPoolSize(10);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("api-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.initialize();
        return executor;
    }
}

@Service
public class ProductService {

    @Async("apiExecutor")
    public CompletableFuture<Product> getProduct(Long id) {
        return CompletableFuture.completedFuture(productApi.getProduct(id));
    }
}
```

**왜 Spring 방식이 나은가?**
- 스레드 풀 라이프사이클(shutdown)을 Spring이 관리 → `try-finally`로 직접 닫을 필요 없음
- `application.yml`로 풀 크기를 외부에서 변경 가능
- 거부 정책(`RejectedExecutionHandler`)을 선언적으로 설정 — 위에서 설명한 `CallerRunsPolicy` 등 순수 Java 클래스를 그대로 사용한다

**그래도 원시 API가 필요한 경우:** 테스트 코드에서 정밀한 스레드 제어가 필요하거나, Spring 컨텍스트 밖에서 동작하는 배치 유틸리티를 작성할 때.

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

### 체이닝 메서드 역할 정리

위 코드에서 사용된 메서드들은 **입력과 출력의 유무**에 따라 구분된다.

| 메서드 | 입력 | 출력 | 역할 | 위 예시에서 |
|--------|------|------|------|-----------|
| `supplyAsync` | 없음 | 있음 (`T`) | 체인의 시작점. 값을 생산한다 | 주문 생성 → `Order` 반환 |
| `thenApplyAsync` | 있음 (`T`) | 있음 (`U`) | 이전 결과를 받아 **변환**한다 | `Order` → 결제 → `Payment` 반환 |
| `thenAcceptAsync` | 있음 (`T`) | 없음 (`void`) | 이전 결과를 받아 **소비**한다 (반환값 없음) | `Payment` → 알림 발송 |
| `thenRunAsync` | 없음 | 없음 (`void`) | 이전 결과와 무관하게 **실행만** 한다 | (예: 로그 기록, 카운터 증가) |

> **`Async` 접미사의 의미:** `thenApply`는 이전 단계와 **같은 스레드**에서 실행될 수 있고, `thenApplyAsync`는 반드시 **별도 스레드(ForkJoinPool 또는 지정한 Executor)**에서 실행된다. I/O가 포함된 작업이라면 `Async` 버전을 쓰는 것이 안전하다.

### 여러 작업을 동시에 실행하고 합치기 — thenCombine

위의 `thenApply`는 **하나의 결과를 변환**하는 것이다. 하지만 실무에서는 **두 개의 독립적인 작업을 동시에 실행하고, 둘 다 끝나면 결과를 합쳐야** 하는 경우가 많다. 이때 `thenCombine`을 쓴다.

```
thenApply:    A 결과 ──→ 변환 ──→ B
thenCombine:  A 결과 ─┐
                       ├─→ 합쳐서 ──→ C
              B 결과 ─┘
```

상품 상세 페이지에서 상품 정보와 리뷰를 **동시에** 가져와서 하나의 DTO로 합치는 예시:

```java
CompletableFuture<Product> productCf = CompletableFuture
    .supplyAsync(() -> productApi.getProduct(id));
CompletableFuture<List<Review>> reviewCf = CompletableFuture
    .supplyAsync(() -> reviewApi.getReviews(id));

// 둘 다 끝나면 합치기
CompletableFuture<ProductDetail> detailCf = productCf
    .thenCombine(reviewCf, (product, reviews) -> new ProductDetail(product, reviews));
```

**`thenCombine`이 없다면?** `get()`으로 블로킹해야 한다.

```java
// ❌ 블로킹 방식 — 호출 스레드가 멈춤
Product product = productCf.get();
List<Review> reviews = reviewCf.get();
ProductDetail detail = new ProductDetail(product, reviews);
```

`thenCombine`은 **둘 다 끝나는 순간 자동으로 합쳐주므로** 호출 스레드를 블로킹하지 않는다.

### Future vs CompletableFuture

| 항목 | Future | CompletableFuture |
|------|--------|-------------------|
| 결과 확인 | `get()` 블로킹 | `thenApply()` 논블로킹 |
| 체이닝 | 불가 | `thenApply → thenCompose → thenCombine` |
| 예외 처리 | try-catch로 감싸야 함 | `exceptionally()`, `handle()` |
| 여러 작업 합치기 | 직접 구현 | `allOf()`, `anyOf()`, `thenCombine()` |

### Spring Boot에서는?

1절에서 등록한 `@Async` 메서드가 `CompletableFuture`를 반환하면, 이후 체이닝은 순수 Java와 동일하다.

```java
@Service
public class ProductFacade {

    private final ProductService productService;
    private final ReviewService reviewService;

    public CompletableFuture<ProductDetail> getDetail(Long id) {
        CompletableFuture<Product> productCf = productService.getProduct(id);   // @Async
        CompletableFuture<List<Review>> reviewCf = reviewService.getReviews(id); // @Async

        return productCf.thenCombine(reviewCf, ProductDetail::new);
    }
}
```

**핵심:** `@Async`는 "어떤 스레드 풀에서 실행할지"를 Spring이 결정해주는 것이고, 반환된 `CompletableFuture`의 체이닝 API(`thenApply`, `thenCombine`, `exceptionally`)는 순수 Java 그대로다. 즉 **2절의 조합 패턴은 Spring Boot에서도 동일하게 적용**된다.

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

### countDown()과 await() 동작 원리

`CountDownLatch`는 내부에 **카운트 숫자 하나**만 가지고 있다. 두 메서드가 이 숫자를 중심으로 동작한다.

- **`countDown()`** — 카운트를 1 줄인다. 0 밑으로는 내려가지 않는다.
- **`await()`** — 카운트가 0이 될 때까지 **현재 스레드를 멈추고 기다린다.** 이미 0이면 즉시 통과한다.

위 코드의 흐름을 시간순으로 보면:

```
[Phase 1: 준비]
워커 스레드 1  → ready.countDown()  → start.await()에서 멈춤
워커 스레드 2  → ready.countDown()  → start.await()에서 멈춤
  ...
워커 스레드 100 → ready.countDown() → start.await()에서 멈춤
                  ↓
        ready 카운트가 0이 됨
                  ↓
[Phase 2: 동시 출발]
메인 스레드    → ready.await() 통과 → start.countDown()
                                       ↓
                              start 카운트가 0이 됨
                                       ↓
                              100개 스레드가 동시에 깨어남
                                       ↓
[Phase 3: 완료 대기]
워커 스레드들   → purchaseService.buy() 실행 → done.countDown()
                                                ↓
                                      done 카운트가 0이 됨
                                                ↓
메인 스레드    → done.await() 통과 → assertThat 실행
```

**왜 Latch가 3개인가?** 각각 역할이 다르다.

| Latch | 초기값 | 누가 countDown | 누가 await | 역할 |
|-------|--------|---------------|-----------|------|
| `ready` | 100 | 워커 스레드 | 메인 스레드 | 모든 스레드가 생성 완료됐는지 확인 |
| `start` | 1 | 메인 스레드 | 워커 스레드 | "출발!" 신호 — 동시에 깨우기 |
| `done` | 100 | 워커 스레드 | 메인 스레드 | 모든 작업이 끝났는지 확인 |

### 추가 포인트

- **한 번 쓰고 버리는 도구**다. 카운트가 0이 되면 재사용할 수 없다. 재사용이 필요하면 `CyclicBarrier`를 쓴다.

### Spring Boot에서는?

CountDownLatch는 Spring이 감싸주는 래퍼가 없다. `@SpringBootTest`에서 동시성 테스트를 작성할 때 **그대로 사용하는 것이 정석**이다.

```java
@SpringBootTest
class PurchaseConcurrencyTest {

    @Autowired
    private PurchaseService purchaseService;

    @Test
    void 선착순_100명_동시_구매() throws InterruptedException {
        int threadCount = 100;
        ExecutorService executor = Executors.newFixedThreadPool(threadCount);
        CountDownLatch ready = new CountDownLatch(threadCount);
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(threadCount);

        for (int i = 0; i < threadCount; i++) {
            final long userId = i;
            executor.submit(() -> {
                ready.countDown();
                start.await();
                try {
                    purchaseService.buy(productId, userId);
                } finally {
                    done.countDown();
                }
                return null;
            });
        }

        ready.await();
        start.countDown();
        done.await();

        assertThat(product.getStock()).isEqualTo(0);
        executor.shutdown();
    }
}
```

**포인트:** Spring Boot 테스트에서도 `CountDownLatch` + `ExecutorService` 조합은 그대로 쓴다. 이 패턴은 "동시에 N개 요청이 들어오는 상황"을 시뮬레이션하는 사실상 유일한 방법이다.

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

### Spring Boot에서는?

로컬 캐시가 필요하다면 Spring Cache + Caffeine이 일반적이다.

```java
// build.gradle
// implementation 'org.springframework.boot:spring-boot-starter-cache'
// implementation 'com.github.ben-manes.caffeine:caffeine'

@Configuration
@EnableCaching
public class CacheConfig {

    @Bean
    public CacheManager cacheManager() {
        CaffeineCacheManager manager = new CaffeineCacheManager("products");
        manager.setCaffeine(Caffeine.newBuilder()
            .maximumSize(1_000)
            .expireAfterWrite(Duration.ofMinutes(10)));
        return manager;
    }
}

@Service
public class ProductService {

    @Cacheable(value = "products", key = "#id")
    public Product getProduct(String id) {
        return productApi.fetch(id); // 캐시 미스일 때만 호출
    }
}
```

**왜 Spring Cache가 나은가?**
- TTL, 최대 크기, 퇴거 정책을 선언적으로 설정
- `@CacheEvict`로 무효화 로직 분리
- Caffeine 내부는 `ConcurrentHashMap` 기반이므로 동시성은 보장됨

**그래도 `ConcurrentHashMap`이 필요한 경우:** 한 요청 안에서의 메모이제이션, 캐시 애노테이션이 동작하지 않는 `private` 메서드, 또는 캐시 키가 복잡한 동적 구조일 때.

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

### Spring Boot에서는?

생산자-소비자 패턴은 Spring의 이벤트 시스템으로 대체할 수 있다.

```java
// 이벤트 정의
public record OrderCreatedEvent(Long orderId, String userId) {}

// 생산자: 이벤트 발행
@Service
public class OrderService {

    private final ApplicationEventPublisher eventPublisher;

    @Transactional
    public Order create(OrderRequest request) {
        Order order = orderRepository.save(new Order(request));
        eventPublisher.publishEvent(new OrderCreatedEvent(order.getId(), request.getUserId()));
        return order;
    }
}

// 소비자: 비동기 이벤트 리스너
@Component
public class OrderEventListener {

    @Async("apiExecutor")
    @EventListener
    public void handleOrderCreated(OrderCreatedEvent event) {
        notificationService.send(event.orderId());
        analyticsService.track(event);
    }
}
```

**왜 Spring 이벤트가 나은가?**
- 생산자와 소비자가 서로를 모름 → 결합도 낮음
- `@Async`를 붙이면 별도 스레드에서 처리 → 비동기
- `@TransactionalEventListener`를 쓰면 트랜잭션 커밋 후에만 실행 가능

**그래도 `BlockingQueue`가 필요한 경우:** 배치 처리(큐에 모아서 한꺼번에 flush), 배압(backpressure) 제어가 필요할 때, 또는 Spring 컨텍스트 없이 동작해야 하는 라이브러리 코드.

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

### Spring Boot에서는?

Resilience4j의 `@Bulkhead`를 사용하면 동시 접근 수 제한을 선언적으로 걸 수 있다.

```java
// build.gradle
// implementation 'io.github.resilience4j:resilience4j-spring-boot3'

// application.yml
// resilience4j:
//   bulkhead:
//     instances:
//       paymentApi:
//         maxConcurrentCalls: 10
//         maxWaitDuration: 3s

@Service
public class PaymentService {

    @Bulkhead(name = "paymentApi", fallbackMethod = "payFallback")
    public PaymentResult pay(PaymentRequest request) {
        return paymentApi.call(request);
    }

    private PaymentResult payFallback(PaymentRequest request, BulkheadFullException ex) {
        throw new ServiceUnavailableException("결제 서비스가 일시적으로 혼잡합니다");
    }
}
```

**왜 Resilience4j가 나은가?**
- 설정을 `application.yml`로 외부화 → 재배포 없이 변경 가능
- fallback 메서드로 우아한 실패 처리
- Actuator 연동으로 동시 호출 수, 대기 수 등 메트릭 자동 수집
- Circuit Breaker, Retry 등 다른 패턴과 조합 가능

**그래도 `Semaphore`가 필요한 경우:** Resilience4j를 도입하기에는 과한 단순한 유틸리티, 또는 프레임워크 의존 없이 동작해야 하는 라이브러리 코드.

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

### Spring Boot에서는?

단일 인스턴스에서의 `ReentrantLock`은 프로덕션 환경에서 거의 불충분하다. Pod가 여러 개인 순간 락의 의미가 사라진다. **분산 락**이 필요하다.

```java
// build.gradle
// implementation 'org.redisson:redisson-spring-boot-starter'

@Service
public class StockService {

    private final RedissonClient redissonClient;

    public void decrease(Long productId, int quantity) {
        RLock lock = redissonClient.getLock("stock:" + productId);

        try {
            if (lock.tryLock(5, 3, TimeUnit.SECONDS)) { // 대기 5초, 자동 해제 3초
                try {
                    Stock stock = stockRepository.findByProductId(productId);
                    stock.decrease(quantity);
                    stockRepository.save(stock);
                } finally {
                    lock.unlock();
                }
            } else {
                throw new RuntimeException("재고 차감 락 획득 실패");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
```

**왜 분산 락인가?**
- Spring Boot 앱은 보통 2개 이상의 Pod로 운영됨
- JVM 내 `ReentrantLock`은 같은 프로세스의 스레드만 제어
- Redis 기반 Redisson 락은 **모든 Pod에서 동일한 락을 공유**

**그래도 `ReentrantLock`이 필요한 경우:** 단일 인스턴스가 보장되는 배치 서버, 또는 JVM 내부의 리소스(파일 쓰기, 커넥션 풀 초기화)를 보호할 때.

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

---

## Spring Boot는 j.u.c를 대체하는 게 아니라 감싼다

이 글에서 다룬 7개 클래스는 Spring Boot 환경에서도 사라지지 않는다. Spring은 이들을 **더 쓰기 편하게 감싸줄 뿐**이다.

| 순수 Java | Spring Boot 래퍼 |
|-----------|-----------------|
| `ExecutorService` | `@Async` + `ThreadPoolTaskExecutor` |
| `CompletableFuture` | `@Async` 반환 타입으로 그대로 사용 |
| `CountDownLatch` | 래퍼 없음 — 테스트에서 그대로 사용 |
| `ConcurrentHashMap` | `@Cacheable` + Caffeine |
| `BlockingQueue` | `ApplicationEventPublisher` + `@EventListener` |
| `Semaphore` | Resilience4j `@Bulkhead` |
| `ReentrantLock` | Redisson 분산 락 |

**원리를 알아야 래퍼를 제대로 쓸 수 있다.** `@Async`가 왜 안 먹히는지 디버깅하려면 `ExecutorService`를 이해해야 하고, Caffeine 캐시의 동시성 보장이 어떻게 되는지 알려면 `ConcurrentHashMap`을 알아야 한다. 추상화 위에서 일하되, 한 계층 아래를 이해하자.
