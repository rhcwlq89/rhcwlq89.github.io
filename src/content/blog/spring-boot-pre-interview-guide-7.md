---
title: "스프링 사전과제 가이드 7편: Advanced Patterns"
description: "고급 패턴과 아키텍처 - 이벤트, 비동기, 파일 처리, 멀티 모듈"
pubDate: 2026-02-02
tags: ["Spring Boot", "Event", "Async", "Architecture", "Backend", "사전과제"]
heroImage: "../../assets/PreinterviewTaskGuide.png"
---

## 시리즈 네비게이션

| 이전 | 현재 | 다음 |
|:---:|:---:|:---:|
| [6편: DevOps](/blog/spring-boot-pre-interview-guide-6) | **7편: Advanced Patterns** | [종합 과제](/blog/spring-boot-pre-interview-assignment) |

> 📚 **전체 로드맵**: [스프링 사전과제 가이드 로드맵](/blog/spring-boot-pre-interview-guide-1) 참고

---

## 서론

시리즈의 마지막 편으로, 차별화를 보여줄 수 있는 고급 패턴들을 다룬다. 모든 과제에 적용할 필요는 없지만, 상황에 맞게 활용하면 설계 역량을 보여줄 수 있다.

**7편에서 다루는 내용:**
- 이벤트 기반 아키텍처
- 비동기 처리
- 파일 처리
- API 버저닝
- 아키텍처 패턴
- 멀티 모듈 프로젝트

### 목차

- [이벤트 기반 아키텍처](#이벤트-기반-아키텍처)
- [비동기 처리](#비동기-처리)
- [파일 처리](#파일-처리)
- [API 버저닝](#api-버저닝)
- [아키텍처 패턴](#아키텍처-패턴)
- [멀티 모듈 프로젝트](#멀티-모듈-프로젝트)
- [정리](#정리)

---

## 이벤트 기반 아키텍처

### 1. Spring Events 기본

이벤트를 활용하면 도메인 로직과 부가 기능(알림, 로깅 등)을 분리할 수 있다.

```java
// 이벤트 정의
public record OrderCreatedEvent(
    Long orderId,
    Long memberId,
    Integer totalAmount,
    LocalDateTime occurredAt
) {
    public OrderCreatedEvent(Order order) {
        this(order.getId(), order.getMember().getId(),
             order.getTotalAmount(), LocalDateTime.now());
    }
}
```

```java
// 이벤트 발행
@Service
@RequiredArgsConstructor
public class OrderService {

    private final OrderRepository orderRepository;
    private final ApplicationEventPublisher eventPublisher;

    @Transactional
    public Long createOrder(OrderCreateCommand command) {
        Order order = Order.create(command);
        orderRepository.save(order);

        // 이벤트 발행
        eventPublisher.publishEvent(new OrderCreatedEvent(order));

        return order.getId();
    }
}
```

```java
// 이벤트 리스너
@Component
@RequiredArgsConstructor
public class OrderEventListener {

    private static final Logger log = LoggerFactory.getLogger(OrderEventListener.class);
    private final NotificationService notificationService;

    @EventListener
    public void handleOrderCreated(OrderCreatedEvent event) {
        log.info("Order created: orderId={}, memberId={}",
                 event.orderId(), event.memberId());

        // 알림 발송
        notificationService.sendOrderConfirmation(event.memberId(), event.orderId());
    }
}
```

<details>
<summary>Kotlin 버전</summary>

```kotlin
// 이벤트 정의
data class OrderCreatedEvent(
    val orderId: Long,
    val memberId: Long,
    val totalAmount: Int,
    val occurredAt: LocalDateTime = LocalDateTime.now()
) {
    constructor(order: Order) : this(
        orderId = order.id!!,
        memberId = order.member.id!!,
        totalAmount = order.totalAmount
    )
}

// 이벤트 발행
@Service
class OrderService(
    private val orderRepository: OrderRepository,
    private val eventPublisher: ApplicationEventPublisher
) {
    @Transactional
    fun createOrder(command: OrderCreateCommand): Long {
        val order = Order.create(command)
        orderRepository.save(order)

        eventPublisher.publishEvent(OrderCreatedEvent(order))

        return order.id!!
    }
}

// 이벤트 리스너
@Component
class OrderEventListener(
    private val notificationService: NotificationService
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @EventListener
    fun handleOrderCreated(event: OrderCreatedEvent) {
        log.info("Order created: orderId={}, memberId={}", event.orderId, event.memberId)
        notificationService.sendOrderConfirmation(event.memberId, event.orderId)
    }
}
```

</details>

### 2. @TransactionalEventListener

트랜잭션 상태에 따라 이벤트 처리 시점을 제어할 수 있다.

```java
@Component
@RequiredArgsConstructor
public class OrderEventListener {

    private final NotificationService notificationService;

    /**
     * 트랜잭션 커밋 후 실행
     * - 주문 저장이 확정된 후에만 알림 발송
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handleOrderCreatedAfterCommit(OrderCreatedEvent event) {
        notificationService.sendOrderConfirmation(event.memberId(), event.orderId());
    }

    /**
     * 트랜잭션 롤백 시 실행
     * - 실패 로깅 등
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_ROLLBACK)
    public void handleOrderCreatedOnRollback(OrderCreatedEvent event) {
        // 실패 로깅
    }
}
```

| Phase | 설명 | 사용 시점 |
|-------|------|----------|
| `AFTER_COMMIT` | 커밋 성공 후 | 알림, 외부 시스템 연동 |
| `AFTER_ROLLBACK` | 롤백 후 | 실패 로깅, 보상 처리 |
| `AFTER_COMPLETION` | 커밋/롤백 상관없이 | 리소스 정리 |
| `BEFORE_COMMIT` | 커밋 직전 | 추가 검증 |

### 3. 비동기 이벤트 처리

```java
@Component
@RequiredArgsConstructor
public class OrderEventListener {

    private final NotificationService notificationService;

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handleOrderCreatedAsync(OrderCreatedEvent event) {
        // 비동기로 실행되어 메인 트랜잭션에 영향 없음
        notificationService.sendOrderConfirmation(event.memberId(), event.orderId());
    }
}
```

<details>
<summary>💬 이벤트 vs 직접 호출 선택 기준</summary>

| 상황 | 권장 방식 | 이유 |
|------|----------|------|
| 핵심 비즈니스 로직 | 직접 호출 | 명확한 흐름, 디버깅 용이 |
| 부가 기능 (알림, 로깅) | 이벤트 | 느슨한 결합, 확장 용이 |
| 외부 시스템 연동 | 이벤트 + 비동기 | 실패해도 메인 로직 영향 없음 |
| 여러 모듈에서 반응 | 이벤트 | 발행자가 구독자를 몰라도 됨 |

**과제에서 권장**: 핵심 로직은 직접 호출, 알림/로깅 등은 이벤트로 분리하면 좋은 설계로 평가받을 수 있다.

</details>

<details>
<summary>⚠️ 이벤트 사용 시 주의점</summary>

1. **트랜잭션 경계 주의**
   - `@EventListener`는 같은 트랜잭션 내에서 실행
   - 리스너에서 예외 발생 시 전체 롤백

2. **순환 참조 주의**
   - A → 이벤트 발행 → B 리스너 → A 호출 → 무한 루프

3. **테스트 어려움**
   - 이벤트 발행/구독 검증 필요
   - `@SpyBean`이나 테스트용 리스너 활용

4. **디버깅 어려움**
   - 흐름 추적이 어려움
   - 로깅을 충실히 남길 것

</details>

---

## 비동기 처리

### 1. @Async 설정

```java
@Configuration
@EnableAsync
public class AsyncConfig implements AsyncConfigurer {

    @Override
    public Executor getAsyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(5);
        executor.setMaxPoolSize(10);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("async-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.initialize();
        return executor;
    }

    @Override
    public AsyncUncaughtExceptionHandler getAsyncUncaughtExceptionHandler() {
        return (ex, method, params) -> {
            Logger log = LoggerFactory.getLogger(method.getDeclaringClass());
            log.error("Async method {} threw exception: {}", method.getName(), ex.getMessage(), ex);
        };
    }
}
```

### 2. @Async 사용

```java
@Service
@RequiredArgsConstructor
public class NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);
    private final EmailSender emailSender;
    private final SmsSender smsSender;

    @Async
    public void sendOrderConfirmation(Long memberId, Long orderId) {
        log.info("Sending order confirmation: memberId={}, orderId={}", memberId, orderId);

        // 이메일 발송 (비동기로 실행)
        emailSender.send(memberId, "주문 확인", "주문이 완료되었습니다.");
    }

    @Async
    public CompletableFuture<Boolean> sendSmsAsync(String phoneNumber, String message) {
        boolean result = smsSender.send(phoneNumber, message);
        return CompletableFuture.completedFuture(result);
    }
}
```

### 3. CompletableFuture 활용

```java
@Service
@RequiredArgsConstructor
public class ProductAggregationService {

    private final ProductService productService;
    private final ReviewService reviewService;
    private final InventoryService inventoryService;

    /**
     * 여러 서비스에서 데이터를 병렬로 조회
     */
    public ProductDetailResponse getProductDetail(Long productId) {
        CompletableFuture<Product> productFuture =
            CompletableFuture.supplyAsync(() -> productService.getProduct(productId));

        CompletableFuture<List<Review>> reviewsFuture =
            CompletableFuture.supplyAsync(() -> reviewService.getReviews(productId));

        CompletableFuture<Integer> stockFuture =
            CompletableFuture.supplyAsync(() -> inventoryService.getStock(productId));

        // 모든 비동기 작업 완료 대기
        CompletableFuture.allOf(productFuture, reviewsFuture, stockFuture).join();

        return ProductDetailResponse.of(
            productFuture.join(),
            reviewsFuture.join(),
            stockFuture.join()
        );
    }

    /**
     * 타임아웃 적용
     */
    public ProductDetailResponse getProductDetailWithTimeout(Long productId) {
        try {
            CompletableFuture<ProductDetailResponse> future = CompletableFuture.supplyAsync(() ->
                getProductDetail(productId)
            );

            return future.get(5, TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            throw new ServiceTimeoutException("Product detail fetch timeout");
        } catch (Exception e) {
            throw new ServiceException("Failed to fetch product detail", e);
        }
    }
}
```

<details>
<summary>💬 동기 vs 비동기 처리 판단</summary>

| 상황 | 권장 방식 | 이유 |
|------|----------|------|
| 응답에 결과 필요 | 동기 | 결과를 기다려야 함 |
| 응답에 결과 불필요 | 비동기 | 응답 시간 단축 |
| 외부 API 호출 | 비동기 (타임아웃) | 실패/지연에 영향받지 않음 |
| 트랜잭션 필수 | 동기 | 트랜잭션 전파 어려움 |
| 여러 작업 병렬 실행 | 비동기 | 처리 시간 단축 |

**과제에서**: 알림 발송 등 응답에 필요 없는 작업을 비동기로 처리하면 좋은 평가를 받을 수 있다.

</details>

<details>
<summary>⚠️ @Async 사용 시 주의점</summary>

1. **같은 클래스 내 호출 불가**
   - 프록시 기반이므로 self-invocation 시 동기로 실행
   - 다른 Bean에서 호출해야 함

2. **트랜잭션 전파 안됨**
   - `@Async` 메서드는 별도 스레드에서 실행
   - 새로운 트랜잭션 필요 시 `@Transactional` 추가

3. **예외 처리**
   - void 반환 시 예외가 무시될 수 있음
   - `AsyncUncaughtExceptionHandler` 설정 필수

4. **스레드풀 고갈**
   - 큐 용량, 최대 스레드 수 적절히 설정
   - 모니터링 필요

</details>

---

## 파일 처리

### 1. 파일 업로드

```java
@RestController
@RequestMapping("/api/v1/files")
@RequiredArgsConstructor
public class FileController {

    private final FileService fileService;

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<FileUploadResponse> uploadFile(
            @RequestParam("file") MultipartFile file) {

        FileUploadResponse response = fileService.upload(file);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @PostMapping(value = "/multiple", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<List<FileUploadResponse>> uploadFiles(
            @RequestParam("files") List<MultipartFile> files) {

        List<FileUploadResponse> responses = fileService.uploadMultiple(files);
        return ResponseEntity.status(HttpStatus.CREATED).body(responses);
    }
}
```

```java
@Service
@RequiredArgsConstructor
public class FileService {

    private static final Logger log = LoggerFactory.getLogger(FileService.class);
    private static final List<String> ALLOWED_EXTENSIONS = List.of("jpg", "jpeg", "png", "gif", "pdf");
    private static final long MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

    @Value("${file.upload-dir}")
    private String uploadDir;

    public FileUploadResponse upload(MultipartFile file) {
        validateFile(file);

        String originalFilename = file.getOriginalFilename();
        String extension = getExtension(originalFilename);
        String storedFilename = UUID.randomUUID() + "." + extension;
        Path filePath = Paths.get(uploadDir, storedFilename);

        try {
            Files.createDirectories(filePath.getParent());
            file.transferTo(filePath);

            log.info("File uploaded: original={}, stored={}", originalFilename, storedFilename);

            return new FileUploadResponse(storedFilename, originalFilename, file.getSize());
        } catch (IOException e) {
            throw new FileUploadException("Failed to upload file", e);
        }
    }

    private void validateFile(MultipartFile file) {
        if (file.isEmpty()) {
            throw new InvalidFileException("File is empty");
        }

        if (file.getSize() > MAX_FILE_SIZE) {
            throw new InvalidFileException("File size exceeds limit");
        }

        String extension = getExtension(file.getOriginalFilename());
        if (!ALLOWED_EXTENSIONS.contains(extension.toLowerCase())) {
            throw new InvalidFileException("File type not allowed: " + extension);
        }
    }

    private String getExtension(String filename) {
        return filename.substring(filename.lastIndexOf(".") + 1);
    }
}
```

### 2. 파일 다운로드

```java
@GetMapping("/{filename}")
public ResponseEntity<Resource> downloadFile(@PathVariable String filename) {
    Resource resource = fileService.loadAsResource(filename);

    String contentDisposition = ContentDisposition.attachment()
        .filename(filename, StandardCharsets.UTF_8)
        .build()
        .toString();

    return ResponseEntity.ok()
        .header(HttpHeaders.CONTENT_DISPOSITION, contentDisposition)
        .contentType(MediaType.APPLICATION_OCTET_STREAM)
        .body(resource);
}
```

```java
public Resource loadAsResource(String filename) {
    try {
        Path filePath = Paths.get(uploadDir).resolve(filename).normalize();
        Resource resource = new UrlResource(filePath.toUri());

        if (resource.exists() && resource.isReadable()) {
            return resource;
        } else {
            throw new FileNotFoundException("File not found: " + filename);
        }
    } catch (MalformedURLException e) {
        throw new FileNotFoundException("File not found: " + filename, e);
    }
}
```

### 3. S3 연동 (AWS)

```groovy
// build.gradle
implementation 'software.amazon.awssdk:s3:2.21.0'
```

```java
@Configuration
public class S3Config {

    @Value("${aws.region}")
    private String region;

    @Bean
    public S3Client s3Client() {
        return S3Client.builder()
            .region(Region.of(region))
            .build();
    }
}
```

```java
@Service
@RequiredArgsConstructor
public class S3FileService {

    private final S3Client s3Client;

    @Value("${aws.s3.bucket}")
    private String bucket;

    public String upload(MultipartFile file) {
        String key = "uploads/" + UUID.randomUUID() + "_" + file.getOriginalFilename();

        try {
            PutObjectRequest request = PutObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .contentType(file.getContentType())
                .build();

            s3Client.putObject(request, RequestBody.fromInputStream(
                file.getInputStream(), file.getSize()));

            return key;
        } catch (IOException e) {
            throw new FileUploadException("Failed to upload to S3", e);
        }
    }

    public byte[] download(String key) {
        GetObjectRequest request = GetObjectRequest.builder()
            .bucket(bucket)
            .key(key)
            .build();

        try (ResponseInputStream<GetObjectResponse> response = s3Client.getObject(request)) {
            return response.readAllBytes();
        } catch (IOException e) {
            throw new FileDownloadException("Failed to download from S3", e);
        }
    }
}
```

<details>
<summary>💬 로컬 파일 vs 클라우드 스토리지</summary>

| 방식 | 장점 | 단점 | 사용 시점 |
|------|------|------|----------|
| **로컬 파일** | 간단, 네트워크 비용 없음 | 서버 확장 시 공유 어려움 | 단일 서버, 개발/테스트 |
| **S3/GCS** | 확장성, 내구성, CDN 연계 | 비용, 네트워크 지연 | 프로덕션, 대용량 |

**과제에서 권장**:
- 기본: 로컬 파일 시스템으로 구현
- 가산점: S3 연동 또는 S3 인터페이스 추상화

</details>

---

## API 버저닝

### 1. URI 버저닝 (가장 일반적)

```java
@RestController
@RequestMapping("/api/v1/products")
public class ProductControllerV1 {

    @GetMapping("/{id}")
    public ProductResponseV1 getProduct(@PathVariable Long id) {
        // V1 응답
    }
}

@RestController
@RequestMapping("/api/v2/products")
public class ProductControllerV2 {

    @GetMapping("/{id}")
    public ProductResponseV2 getProduct(@PathVariable Long id) {
        // V2 응답 (필드 추가 등)
    }
}
```

### 2. Header 버저닝

```java
@RestController
@RequestMapping("/api/products")
public class ProductController {

    @GetMapping(value = "/{id}", headers = "X-API-VERSION=1")
    public ProductResponseV1 getProductV1(@PathVariable Long id) {
        // V1 응답
    }

    @GetMapping(value = "/{id}", headers = "X-API-VERSION=2")
    public ProductResponseV2 getProductV2(@PathVariable Long id) {
        // V2 응답
    }
}
```

### 3. Accept Header 버저닝

```java
@RestController
@RequestMapping("/api/products")
public class ProductController {

    @GetMapping(value = "/{id}", produces = "application/vnd.myapp.v1+json")
    public ProductResponseV1 getProductV1(@PathVariable Long id) {
        // V1 응답
    }

    @GetMapping(value = "/{id}", produces = "application/vnd.myapp.v2+json")
    public ProductResponseV2 getProductV2(@PathVariable Long id) {
        // V2 응답
    }
}
```

<details>
<summary>💬 버저닝 전략 비교</summary>

| 방식 | 장점 | 단점 |
|------|------|------|
| **URI** | 명확, 캐싱 용이, 테스트 쉬움 | URL 변경 필요 |
| **Header** | URL 깔끔 | 테스트/문서화 어려움 |
| **Accept** | RESTful | 복잡, 이해하기 어려움 |
| **Parameter** | 간단 | 선택적 파라미터와 혼동 |

**과제에서 권장**: URI 버저닝 (`/api/v1/...`)이 가장 명확하고 일반적

</details>

---

## 아키텍처 패턴

### 1. 계층형 아키텍처 (기본)

```
┌─────────────────────────────────────┐
│         Controller (Presentation)    │
├─────────────────────────────────────┤
│            Service (Business)        │
├─────────────────────────────────────┤
│         Repository (Persistence)     │
├─────────────────────────────────────┤
│              Domain (Entity)         │
└─────────────────────────────────────┘
```

대부분의 과제에서 사용하는 기본 구조다.

### 2. Hexagonal Architecture (포트와 어댑터)

```
                    ┌─────────────────┐
    Driving         │                 │        Driven
    Adapters        │    Application  │        Adapters
                    │      Core       │
┌──────────┐       │                 │       ┌──────────┐
│Controller│──────▶│  ┌───────────┐  │──────▶│Repository│
└──────────┘       │  │  Domain   │  │       └──────────┘
                    │  │  Service  │  │
┌──────────┐       │  └───────────┘  │       ┌──────────┐
│  Event   │──────▶│                 │──────▶│ External │
│ Listener │       │                 │       │   API    │
└──────────┘       └─────────────────┘       └──────────┘
```

```
src/main/java/com/example/
├── application/              # Application Layer
│   ├── port/
│   │   ├── in/              # Inbound Ports (Use Cases)
│   │   │   └── CreateOrderUseCase.java
│   │   └── out/             # Outbound Ports
│   │       ├── OrderRepository.java
│   │       └── PaymentGateway.java
│   └── service/
│       └── OrderService.java
├── domain/                   # Domain Layer
│   ├── Order.java
│   └── OrderItem.java
└── adapter/                  # Adapter Layer
    ├── in/
    │   └── web/
    │       └── OrderController.java
    └── out/
        ├── persistence/
        │   └── OrderJpaAdapter.java
        └── external/
            └── PaymentGatewayAdapter.java
```

```java
// Inbound Port (Use Case Interface)
public interface CreateOrderUseCase {
    Long createOrder(CreateOrderCommand command);
}

// Outbound Port
public interface OrderRepository {
    Order save(Order order);
    Optional<Order> findById(Long id);
}

// Application Service
@Service
@RequiredArgsConstructor
public class OrderService implements CreateOrderUseCase {

    private final OrderRepository orderRepository;  // Port 사용
    private final PaymentGateway paymentGateway;    // Port 사용

    @Override
    @Transactional
    public Long createOrder(CreateOrderCommand command) {
        Order order = Order.create(command);
        orderRepository.save(order);
        paymentGateway.process(order);
        return order.getId();
    }
}

// Outbound Adapter
@Repository
@RequiredArgsConstructor
public class OrderJpaAdapter implements OrderRepository {

    private final OrderJpaRepository jpaRepository;

    @Override
    public Order save(Order order) {
        return jpaRepository.save(order);
    }

    @Override
    public Optional<Order> findById(Long id) {
        return jpaRepository.findById(id);
    }
}
```

### 3. CQRS (Command Query Responsibility Segregation)

명령(쓰기)과 조회(읽기)를 분리하는 패턴이다.

```
src/main/java/com/example/order/
├── command/                  # 명령 (쓰기)
│   ├── CreateOrderCommand.java
│   ├── OrderCommandService.java
│   └── OrderCommandRepository.java
└── query/                    # 조회 (읽기)
    ├── OrderQueryService.java
    ├── OrderQueryRepository.java
    └── OrderDetailResponse.java
```

```java
// Command Service (쓰기)
@Service
@RequiredArgsConstructor
@Transactional
public class OrderCommandService {

    private final OrderRepository orderRepository;

    public Long createOrder(CreateOrderCommand command) {
        Order order = Order.create(command);
        return orderRepository.save(order).getId();
    }

    public void cancelOrder(Long orderId) {
        Order order = orderRepository.findById(orderId)
            .orElseThrow(() -> new OrderNotFoundException(orderId));
        order.cancel();
    }
}

// Query Service (읽기)
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class OrderQueryService {

    private final OrderQueryRepository queryRepository;

    public OrderDetailResponse getOrderDetail(Long orderId) {
        return queryRepository.findOrderDetail(orderId)
            .orElseThrow(() -> new OrderNotFoundException(orderId));
    }

    public Page<OrderSummaryResponse> getMyOrders(Long memberId, Pageable pageable) {
        return queryRepository.findOrdersByMemberId(memberId, pageable);
    }
}
```

<details>
<summary>💬 아키텍처 오버엔지니어링 주의</summary>

**과제에서의 아키텍처 선택**:

| 과제 규모 | 권장 아키텍처 |
|----------|-------------|
| 단순 CRUD | 계층형 (Controller-Service-Repository) |
| 복잡한 도메인 | 계층형 + DDD 요소 (도메인 서비스, 값 객체) |
| 읽기/쓰기 분리 필요 | CQRS 부분 적용 |

**주의**:
- 과제는 보통 1~2주 내 완성해야 함
- 과도한 추상화는 오히려 감점 요인
- README에 아키텍처 선택 이유를 명시하면 좋음

**Hexagonal을 적용하면 좋은 경우**:
- 외부 시스템 연동이 많은 과제
- 테스트 용이성이 강조된 과제
- 명시적으로 클린 아키텍처를 요구하는 경우

</details>

---

## 멀티 모듈 프로젝트

### 1. 멀티 모듈이란?

하나의 프로젝트를 여러 모듈로 분리하여 관심사를 분리하고 의존성을 명확히 하는 구조다.

```
marketplace/
├── build.gradle (root)
├── settings.gradle
├── marketplace-api/           # API 모듈 (Controller, 실행)
├── marketplace-domain/        # 도메인 모듈 (Entity, Service)
├── marketplace-infra/         # 인프라 모듈 (Repository, 외부 연동)
└── marketplace-common/        # 공통 모듈 (Utils, Exception)
```

### 2. 기본 모듈 구조

#### settings.gradle

```groovy
rootProject.name = 'marketplace'

include 'marketplace-api'
include 'marketplace-domain'
include 'marketplace-infra'
include 'marketplace-common'
```

<details>
<summary>Kotlin DSL (settings.gradle.kts)</summary>

```kotlin
rootProject.name = "marketplace"

include("marketplace-api")
include("marketplace-domain")
include("marketplace-infra")
include("marketplace-common")
```

</details>

#### Root build.gradle

```groovy
plugins {
    id 'java'
    id 'org.springframework.boot' version '3.2.0'
    id 'io.spring.dependency-management' version '1.1.4'
}

allprojects {
    group = 'com.example'
    version = '1.0.0'

    repositories {
        mavenCentral()
    }
}

subprojects {
    apply plugin: 'java'
    apply plugin: 'io.spring.dependency-management'

    java {
        sourceCompatibility = JavaVersion.VERSION_17
    }

    dependencies {
        compileOnly 'org.projectlombok:lombok'
        annotationProcessor 'org.projectlombok:lombok'
        testImplementation 'org.springframework.boot:spring-boot-starter-test'
    }

    dependencyManagement {
        imports {
            mavenBom "org.springframework.boot:spring-boot-dependencies:3.2.0"
        }
    }

    test {
        useJUnitPlatform()
    }
}

// Root 프로젝트는 빌드하지 않음
bootJar.enabled = false
jar.enabled = false
```

<details>
<summary>Kotlin DSL (build.gradle.kts)</summary>

```kotlin
plugins {
    java
    id("org.springframework.boot") version "3.2.0"
    id("io.spring.dependency-management") version "1.1.4"
}

allprojects {
    group = "com.example"
    version = "1.0.0"

    repositories {
        mavenCentral()
    }
}

subprojects {
    apply(plugin = "java")
    apply(plugin = "io.spring.dependency-management")

    configure<JavaPluginExtension> {
        sourceCompatibility = JavaVersion.VERSION_17
    }

    the<io.spring.gradle.dependencymanagement.dsl.DependencyManagementExtension>().apply {
        imports {
            mavenBom("org.springframework.boot:spring-boot-dependencies:3.2.0")
        }
    }

    dependencies {
        "compileOnly"("org.projectlombok:lombok")
        "annotationProcessor"("org.projectlombok:lombok")
        "testImplementation"("org.springframework.boot:spring-boot-starter-test")
    }

    tasks.withType<Test> {
        useJUnitPlatform()
    }
}

tasks.named<org.springframework.boot.gradle.tasks.bundling.BootJar>("bootJar") {
    enabled = false
}

tasks.named<Jar>("jar") {
    enabled = false
}
```

</details>

### 3. 각 모듈 설정

#### marketplace-common (공통 모듈)

```groovy
// marketplace-common/build.gradle
dependencies {
    // 공통 유틸리티만 포함
}
```

```
marketplace-common/
└── src/main/java/com/example/common/
    ├── exception/
    │   ├── BusinessException.java
    │   ├── ErrorCode.java
    │   └── ErrorResponse.java
    └── util/
        └── DateUtils.java
```

#### marketplace-domain (도메인 모듈)

```groovy
// marketplace-domain/build.gradle
dependencies {
    implementation project(':marketplace-common')

    // JPA (인터페이스만)
    implementation 'org.springframework.boot:spring-boot-starter-data-jpa'

    // Validation
    implementation 'org.springframework.boot:spring-boot-starter-validation'
}
```

```
marketplace-domain/
└── src/main/java/com/example/domain/
    ├── member/
    │   ├── Member.java
    │   ├── MemberRepository.java (인터페이스)
    │   └── MemberService.java
    ├── product/
    │   ├── Product.java
    │   ├── ProductRepository.java (인터페이스)
    │   └── ProductService.java
    └── order/
        ├── Order.java
        ├── OrderRepository.java (인터페이스)
        └── OrderService.java
```

#### marketplace-infra (인프라 모듈)

```groovy
// marketplace-infra/build.gradle
dependencies {
    implementation project(':marketplace-common')
    implementation project(':marketplace-domain')

    // JPA 구현체
    implementation 'org.springframework.boot:spring-boot-starter-data-jpa'
    runtimeOnly 'com.h2database:h2'
    runtimeOnly 'com.mysql:mysql-connector-j'

    // Redis (선택)
    implementation 'org.springframework.boot:spring-boot-starter-data-redis'

    // 외부 API 클라이언트
    implementation 'org.springframework.boot:spring-boot-starter-webflux'
}
```

```
marketplace-infra/
└── src/main/java/com/example/infra/
    ├── persistence/
    │   ├── member/
    │   │   ├── MemberJpaRepository.java
    │   │   └── MemberRepositoryImpl.java
    │   ├── product/
    │   │   └── ProductRepositoryImpl.java
    │   └── order/
    │       └── OrderRepositoryImpl.java
    ├── cache/
    │   └── RedisCacheConfig.java
    └── external/
        └── PaymentGatewayClient.java
```

#### marketplace-api (API 모듈)

```groovy
// marketplace-api/build.gradle
plugins {
    id 'org.springframework.boot'
}

dependencies {
    implementation project(':marketplace-common')
    implementation project(':marketplace-domain')
    implementation project(':marketplace-infra')

    // Web
    implementation 'org.springframework.boot:spring-boot-starter-web'

    // Security
    implementation 'org.springframework.boot:spring-boot-starter-security'
    implementation 'io.jsonwebtoken:jjwt-api:0.12.3'
    runtimeOnly 'io.jsonwebtoken:jjwt-impl:0.12.3'
    runtimeOnly 'io.jsonwebtoken:jjwt-jackson:0.12.3'

    // Swagger
    implementation 'org.springdoc:springdoc-openapi-starter-webmvc-ui:2.3.0'
}

bootJar {
    enabled = true
    archiveFileName = 'marketplace-api.jar'
}
```

```
marketplace-api/
└── src/main/java/com/example/api/
    ├── MarketplaceApplication.java
    ├── config/
    │   ├── SecurityConfig.java
    │   └── SwaggerConfig.java
    ├── controller/
    │   ├── MemberController.java
    │   ├── ProductController.java
    │   └── OrderController.java
    ├── dto/
    │   ├── request/
    │   └── response/
    └── security/
        ├── JwtTokenProvider.java
        └── JwtAuthenticationFilter.java
```

### 4. 모듈 간 의존성 규칙

```
┌─────────────────┐
│  marketplace-api │  ← 실행 모듈 (Spring Boot Application)
├─────────────────┤
│     depends on   │
├─────────────────┤
│ marketplace-domain │  ← 비즈니스 로직, Entity
├─────────────────┤
│     depends on   │
├─────────────────┤
│ marketplace-infra │  ← DB, 외부 API 구현체
├─────────────────┤
│     depends on   │
├─────────────────┤
│ marketplace-common │  ← 공통 유틸, 예외
└─────────────────┘
```

**핵심 규칙**:
- `domain`은 `infra`를 의존하지 않음 (의존성 역전)
- `domain`에는 Repository 인터페이스만 정의
- `infra`에서 Repository 인터페이스 구현
- `api`가 모든 모듈을 조립하여 실행

### 5. Repository 인터페이스와 구현 분리

```java
// marketplace-domain/src/.../ProductRepository.java (인터페이스)
public interface ProductRepository {
    Product save(Product product);
    Optional<Product> findById(Long id);
    List<Product> findByCategory(Category category);
    Page<Product> search(ProductSearchCondition condition, Pageable pageable);
}
```

```java
// marketplace-infra/src/.../ProductRepositoryImpl.java (구현체)
@Repository
@RequiredArgsConstructor
public class ProductRepositoryImpl implements ProductRepository {

    private final ProductJpaRepository jpaRepository;
    private final ProductQueryRepository queryRepository;

    @Override
    public Product save(Product product) {
        return jpaRepository.save(product);
    }

    @Override
    public Optional<Product> findById(Long id) {
        return jpaRepository.findById(id);
    }

    @Override
    public List<Product> findByCategory(Category category) {
        return jpaRepository.findByCategory(category);
    }

    @Override
    public Page<Product> search(ProductSearchCondition condition, Pageable pageable) {
        return queryRepository.search(condition, pageable);
    }
}

// JPA Repository (infra 내부에서만 사용)
interface ProductJpaRepository extends JpaRepository<Product, Long> {
    List<Product> findByCategory(Category category);
}
```

### 6. 빌드 및 실행

```bash
# 전체 빌드
./gradlew build

# 특정 모듈만 빌드
./gradlew :marketplace-api:build

# 실행
./gradlew :marketplace-api:bootRun

# JAR 생성
./gradlew :marketplace-api:bootJar
# → marketplace-api/build/libs/marketplace-api.jar
```

### 7. Docker 설정 (멀티 모듈)

```dockerfile
# Dockerfile
FROM gradle:8.5-jdk17 AS builder

WORKDIR /app

# Gradle 파일 먼저 복사 (캐싱)
COPY build.gradle settings.gradle ./
COPY gradle ./gradle
COPY marketplace-common/build.gradle ./marketplace-common/
COPY marketplace-domain/build.gradle ./marketplace-domain/
COPY marketplace-infra/build.gradle ./marketplace-infra/
COPY marketplace-api/build.gradle ./marketplace-api/

RUN gradle dependencies --no-daemon || true

# 소스 복사 및 빌드
COPY . .
RUN gradle :marketplace-api:bootJar --no-daemon -x test

# Runtime
FROM eclipse-temurin:17-jre-alpine

WORKDIR /app
COPY --from=builder /app/marketplace-api/build/libs/marketplace-api.jar app.jar

RUN addgroup -S spring && adduser -S spring -G spring
USER spring:spring

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

<details>
<summary>💬 싱글 모듈 vs 멀티 모듈</summary>

| 구분 | 싱글 모듈 | 멀티 모듈 |
|------|----------|----------|
| **복잡도** | 단순 | 초기 설정 복잡 |
| **빌드 시간** | 빠름 | 모듈별 캐싱으로 최적화 가능 |
| **의존성 관리** | 암묵적 | 명시적, 강제 |
| **테스트** | 전체 테스트 | 모듈별 독립 테스트 |
| **확장성** | 제한적 | 모듈 추가 용이 |
| **팀 협업** | 충돌 가능성 | 모듈별 분업 용이 |

**과제에서의 선택 기준**:

| 상황 | 권장 |
|------|------|
| 단순 CRUD, 기한 짧음 | 싱글 모듈 |
| 도메인 복잡, 외부 연동 多 | 멀티 모듈 |
| 클린 아키텍처 요구 | 멀티 모듈 |
| 멀티 모듈 명시적 요구 | 멀티 모듈 |

</details>

<details>
<summary>💡 멀티 모듈 설계 팁</summary>

**1. 순환 의존성 방지**
```
// 잘못된 예: A → B → A
marketplace-domain → marketplace-infra (X)
marketplace-infra → marketplace-domain (O)
```

**2. 공통 모듈 비대화 방지**
- common 모듈에 모든 것을 넣지 말 것
- 정말 공통으로 쓰이는 것만 포함
- 특정 도메인 로직은 해당 모듈에

**3. 모듈 책임 명확화**
- api: HTTP 요청 처리, DTO 변환, 보안
- domain: 비즈니스 로직, 도메인 규칙
- infra: 기술 구현 (DB, 캐시, 외부 API)
- common: 유틸리티, 공통 예외

**4. 설정 파일 위치**
- `application.yml`: api 모듈에 위치
- 모듈별 설정이 필요하면 `@ConfigurationProperties`로 분리

</details>

<details>
<summary>⚠️ 멀티 모듈 흔한 실수</summary>

1. **의존성 방향 위반**
   - domain이 infra를 의존하면 의미 없음
   - Repository 인터페이스/구현 분리 필수

2. **Entity 위치 오류**
   - Entity는 domain 모듈에 위치
   - `@Entity` 스캔을 위해 api에서 패키지 설정 필요

3. **Component 스캔 누락**
   ```java
   @SpringBootApplication(scanBasePackages = "com.example")
   public class MarketplaceApplication { }
   ```

4. **테스트 설정 누락**
   - 각 모듈의 테스트는 해당 모듈 내에서 실행
   - 통합 테스트는 api 모듈에서 실행

5. **빌드 순서 문제**
   - 의존하는 모듈이 먼저 빌드되어야 함
   - Gradle이 자동 처리하지만 순환 의존 시 실패

</details>

---

## 정리

### 체크리스트

| 항목 | 확인 |
|------|------|
| 부가 기능(알림, 로깅)이 핵심 로직과 분리되어 있는가? | ⬜ |
| 비동기 처리가 필요한 곳에 @Async가 적용되어 있는가? | ⬜ |
| 파일 업로드 시 검증(크기, 확장자)이 적용되어 있는가? | ⬜ |
| API 버전 전략이 일관되게 적용되어 있는가? | ⬜ |
| 아키텍처가 과제 복잡도에 맞게 선택되었는가? | ⬜ |
| 멀티 모듈 적용 시 의존성 방향이 올바른가? | ⬜ |
| 멀티 모듈 적용 시 Repository 인터페이스/구현이 분리되었는가? | ⬜ |

### 핵심 포인트

1. **이벤트**: 부가 기능 분리, `@TransactionalEventListener`로 트랜잭션 제어
2. **비동기**: 응답에 불필요한 작업 분리, 스레드풀 설정 필수
3. **파일 처리**: 검증 필수, 저장 경로 보안 고려
4. **API 버저닝**: URI 방식이 가장 명확
5. **아키텍처**: 과제 규모에 맞게 선택, 오버엔지니어링 주의
6. **멀티 모듈**: 의존성 역전 원칙, domain → infra 의존 금지

<details>
<summary>💡 과제 Plus Alpha 팁</summary>

1. **이벤트 활용**
   - 주문 완료 → 알림 발송을 이벤트로 분리
   - `@TransactionalEventListener(AFTER_COMMIT)` 사용

2. **비동기 처리**
   - 이메일/SMS 발송을 `@Async`로 처리
   - 스레드풀 설정 포함

3. **인터페이스 추상화**
   - 외부 연동(결제, 알림)을 인터페이스로 추상화
   - 테스트 시 Mock 구현체 사용

4. **멀티 모듈 적용**
   - api / domain / infra / common 분리
   - 의존성 역전으로 테스트 용이성 확보
   - README에 모듈 구조 다이어그램 포함

5. **README에 설계 의도 명시**
   - 왜 이 아키텍처를 선택했는지
   - 어떤 트레이드오프를 고려했는지

</details>

<details>
<summary>⚠️ 과제에서 흔한 실수</summary>

1. **이벤트 남용**
   - 모든 로직을 이벤트로 처리 → 흐름 파악 어려움
   - 핵심 로직은 직접 호출이 명확

2. **비동기 예외 무시**
   - void 반환 + 예외 미처리 → 에러 확인 불가
   - `AsyncUncaughtExceptionHandler` 필수

3. **파일 검증 누락**
   - 확장자, 크기 검증 없이 저장 → 보안 취약점
   - 악성 파일 업로드 방지 필요

4. **과도한 아키텍처**
   - 간단한 CRUD에 Hexagonal 적용 → 복잡도만 증가
   - 과제 규모에 맞는 적절한 선택 필요

5. **멀티 모듈 의존성 오류**
   - domain이 infra를 의존하면 분리 의미 없음
   - 순환 의존성 발생 시 빌드 실패
   - Component 스캔 범위 설정 누락

</details>
