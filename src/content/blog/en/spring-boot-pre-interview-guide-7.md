---
title: "Spring Boot Pre-Interview Guide Part 7: Advanced Patterns"
description: "Advanced patterns and architecture — events, async processing, file handling, and multi-module"
pubDate: 2026-02-08T14:00:00+09:00
lang: en
tags: ["Spring Boot", "Architecture", "Async", "Events", "Interview", "Practical Guide"]
heroImage: "../../../assets/PreinterviewTaskGuide.png"
---

## Series Navigation

| Previous | Current | Next |
|:---:|:---:|:---:|
| [Part 6: DevOps](/en/blog/spring-boot-pre-interview-guide-6) | **Part 7: Advanced Patterns** | [Comprehensive Assignment](/en/blog/spring-boot-pre-interview-assignment) |

> **Full Roadmap**: See the [Spring Boot Pre-Interview Guide Roadmap](/en/blog/spring-boot-pre-interview-guide-1)

---

## Introduction

As the final part of the series, we cover advanced patterns that can set you apart. You don't need to apply all of them to every assignment, but using them where appropriate can demonstrate your design capabilities.

**Topics covered in Part 7:**
- Event-driven architecture
- Async processing
- File handling
- API versioning
- Architecture patterns
- Multi-module projects

### Table of Contents

- [Event-Driven Architecture](#event-driven-architecture)
- [Async Processing](#async-processing)
- [File Handling](#file-handling)
- [API Versioning](#api-versioning)
- [Architecture Patterns](#architecture-patterns)
- [Multi-Module Projects](#multi-module-projects)
- [Summary](#summary)

---

## Event-Driven Architecture

### 1. Spring Events Basics

Using events allows you to separate domain logic from supplementary features (notifications, logging, etc.).

```java
// Event definition
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
// Event publishing
@Service
@RequiredArgsConstructor
public class OrderService {

    private final OrderRepository orderRepository;
    private final ApplicationEventPublisher eventPublisher;

    @Transactional
    public Long createOrder(OrderCreateCommand command) {
        Order order = Order.create(command);
        orderRepository.save(order);

        // Publish event
        eventPublisher.publishEvent(new OrderCreatedEvent(order));

        return order.getId();
    }
}
```

```java
// Event listener
@Component
@RequiredArgsConstructor
public class OrderEventListener {

    private static final Logger log = LoggerFactory.getLogger(OrderEventListener.class);
    private final NotificationService notificationService;

    @EventListener
    public void handleOrderCreated(OrderCreatedEvent event) {
        log.info("Order created: orderId={}, memberId={}",
                 event.orderId(), event.memberId());

        // Send notification
        notificationService.sendOrderConfirmation(event.memberId(), event.orderId());
    }
}
```

<details>
<summary>Kotlin Version</summary>

```kotlin
// Event definition
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

// Event publishing
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

// Event listener
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

You can control when events are processed based on the transaction state.

```java
@Component
@RequiredArgsConstructor
public class OrderEventListener {

    private final NotificationService notificationService;

    /**
     * Executes after transaction commit
     * - Sends notification only after order save is confirmed
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handleOrderCreatedAfterCommit(OrderCreatedEvent event) {
        notificationService.sendOrderConfirmation(event.memberId(), event.orderId());
    }

    /**
     * Executes on transaction rollback
     * - For failure logging, etc.
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_ROLLBACK)
    public void handleOrderCreatedOnRollback(OrderCreatedEvent event) {
        // Failure logging
    }
}
```

| Phase | Description | When to Use |
|-------|-------------|-------------|
| `AFTER_COMMIT` | After successful commit | Notifications, external system integration |
| `AFTER_ROLLBACK` | After rollback | Failure logging, compensating actions |
| `AFTER_COMPLETION` | Regardless of commit/rollback | Resource cleanup |
| `BEFORE_COMMIT` | Just before commit | Additional validation |

### 3. Async Event Processing

```java
@Component
@RequiredArgsConstructor
public class OrderEventListener {

    private final NotificationService notificationService;

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handleOrderCreatedAsync(OrderCreatedEvent event) {
        // Runs asynchronously, no impact on the main transaction
        notificationService.sendOrderConfirmation(event.memberId(), event.orderId());
    }
}
```

<details>
<summary>Events vs Direct Calls: Selection Criteria</summary>

| Scenario | Recommended Approach | Reason |
|----------|---------------------|--------|
| Core business logic | Direct call | Clear flow, easy debugging |
| Supplementary features (notifications, logging) | Events | Loose coupling, easy to extend |
| External system integration | Events + Async | Main logic unaffected by failures |
| Multiple modules reacting | Events | Publisher doesn't need to know subscribers |

**Recommended for assignments**: Keep core logic as direct calls and separate notifications/logging into events -- this can be evaluated as good design.

</details>

<details>
<summary>Cautions When Using Events</summary>

1. **Watch transaction boundaries**
   - `@EventListener` executes within the same transaction
   - Exceptions in the listener cause a full rollback

2. **Watch for circular references**
   - A -> publish event -> B listener -> call A -> infinite loop

3. **Testing challenges**
   - Need to verify event publishing/subscribing
   - Use `@SpyBean` or test listeners

4. **Debugging challenges**
   - Flow tracing is difficult
   - Ensure thorough logging

</details>

---

## Async Processing

### 1. @Async Configuration

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

### 2. Using @Async

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

        // Email sending (runs asynchronously)
        emailSender.send(memberId, "Order Confirmation", "Your order has been completed.");
    }

    @Async
    public CompletableFuture<Boolean> sendSmsAsync(String phoneNumber, String message) {
        boolean result = smsSender.send(phoneNumber, message);
        return CompletableFuture.completedFuture(result);
    }
}
```

### 3. Using CompletableFuture

```java
@Service
@RequiredArgsConstructor
public class ProductAggregationService {

    private final ProductService productService;
    private final ReviewService reviewService;
    private final InventoryService inventoryService;

    /**
     * Fetch data from multiple services in parallel
     */
    public ProductDetailResponse getProductDetail(Long productId) {
        CompletableFuture<Product> productFuture =
            CompletableFuture.supplyAsync(() -> productService.getProduct(productId));

        CompletableFuture<List<Review>> reviewsFuture =
            CompletableFuture.supplyAsync(() -> reviewService.getReviews(productId));

        CompletableFuture<Integer> stockFuture =
            CompletableFuture.supplyAsync(() -> inventoryService.getStock(productId));

        // Wait for all async tasks to complete
        CompletableFuture.allOf(productFuture, reviewsFuture, stockFuture).join();

        return ProductDetailResponse.of(
            productFuture.join(),
            reviewsFuture.join(),
            stockFuture.join()
        );
    }

    /**
     * With timeout
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
<summary>Sync vs Async: Decision Guide</summary>

| Scenario | Recommended Approach | Reason |
|----------|---------------------|--------|
| Result needed in response | Synchronous | Must wait for result |
| Result not needed in response | Asynchronous | Reduces response time |
| External API calls | Async (with timeout) | Unaffected by failures/delays |
| Transaction required | Synchronous | Transaction propagation is difficult |
| Multiple tasks in parallel | Asynchronous | Reduces processing time |

**In assignments**: Processing tasks like notification sending asynchronously (when not needed for the response) can earn a good evaluation.

</details>

<details>
<summary>Cautions When Using @Async</summary>

1. **Cannot call within the same class**
   - Proxy-based, so self-invocation runs synchronously
   - Must be called from another Bean

2. **Transaction propagation does not work**
   - `@Async` methods run in a separate thread
   - Add `@Transactional` if a new transaction is needed

3. **Exception handling**
   - Exceptions may be silently ignored with void return type
   - `AsyncUncaughtExceptionHandler` configuration is essential

4. **Thread pool exhaustion**
   - Set queue capacity and max thread count appropriately
   - Monitoring is required

</details>

---

## File Handling

### 1. File Upload

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

### 2. File Download

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

### 3. S3 Integration (AWS)

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
<summary>Local File vs Cloud Storage</summary>

| Approach | Pros | Cons | When to Use |
|----------|------|------|-------------|
| **Local file** | Simple, no network cost | Difficult to share when scaling servers | Single server, development/testing |
| **S3/GCS** | Scalability, durability, CDN integration | Cost, network latency | Production, large-scale |

**Recommended for assignments**:
- Basic: Implement with local file system
- Bonus points: S3 integration or S3 interface abstraction

</details>

---

## API Versioning

### 1. URI Versioning (Most Common)

```java
@RestController
@RequestMapping("/api/v1/products")
public class ProductControllerV1 {

    @GetMapping("/{id}")
    public ProductResponseV1 getProduct(@PathVariable Long id) {
        // V1 response
    }
}

@RestController
@RequestMapping("/api/v2/products")
public class ProductControllerV2 {

    @GetMapping("/{id}")
    public ProductResponseV2 getProduct(@PathVariable Long id) {
        // V2 response (added fields, etc.)
    }
}
```

### 2. Header Versioning

```java
@RestController
@RequestMapping("/api/products")
public class ProductController {

    @GetMapping(value = "/{id}", headers = "X-API-VERSION=1")
    public ProductResponseV1 getProductV1(@PathVariable Long id) {
        // V1 response
    }

    @GetMapping(value = "/{id}", headers = "X-API-VERSION=2")
    public ProductResponseV2 getProductV2(@PathVariable Long id) {
        // V2 response
    }
}
```

### 3. Accept Header Versioning

```java
@RestController
@RequestMapping("/api/products")
public class ProductController {

    @GetMapping(value = "/{id}", produces = "application/vnd.myapp.v1+json")
    public ProductResponseV1 getProductV1(@PathVariable Long id) {
        // V1 response
    }

    @GetMapping(value = "/{id}", produces = "application/vnd.myapp.v2+json")
    public ProductResponseV2 getProductV2(@PathVariable Long id) {
        // V2 response
    }
}
```

<details>
<summary>Versioning Strategy Comparison</summary>

| Approach | Pros | Cons |
|----------|------|------|
| **URI** | Clear, cache-friendly, easy to test | Requires URL changes |
| **Header** | Clean URLs | Difficult to test/document |
| **Accept** | RESTful | Complex, harder to understand |
| **Parameter** | Simple | Confused with optional parameters |

**Recommended for assignments**: URI versioning (`/api/v1/...`) is the most clear and common approach

</details>

---

## Architecture Patterns

### 1. Layered Architecture (Default)

```
+-----------------------------------------+
|         Controller (Presentation)       |
+-----------------------------------------+
|            Service (Business)           |
+-----------------------------------------+
|         Repository (Persistence)        |
+-----------------------------------------+
|              Domain (Entity)            |
+-----------------------------------------+
```

This is the basic structure used in most assignments.

### 2. Hexagonal Architecture (Ports and Adapters)

```
                    +-----------------+
    Driving         |                 |        Driven
    Adapters        |    Application  |        Adapters
                    |      Core       |
+----------+       |                 |       +----------+
|Controller|------>|  +-----------+  |------>|Repository|
+----------+       |  |  Domain   |  |       +----------+
                    |  |  Service  |  |
+----------+       |  +-----------+  |       +----------+
|  Event   |------>|                 |------>| External |
| Listener |       |                 |       |   API    |
+----------+       +-----------------+       +----------+
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

    private final OrderRepository orderRepository;  // Uses Port
    private final PaymentGateway paymentGateway;    // Uses Port

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

A pattern that separates commands (writes) and queries (reads).

```
src/main/java/com/example/order/
├── command/                  # Command (Write)
│   ├── CreateOrderCommand.java
│   ├── OrderCommandService.java
│   └── OrderCommandRepository.java
└── query/                    # Query (Read)
    ├── OrderQueryService.java
    ├── OrderQueryRepository.java
    └── OrderDetailResponse.java
```

```java
// Command Service (Write)
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

// Query Service (Read)
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
<summary>Beware of Architecture Over-Engineering</summary>

**Architecture selection for assignments**:

| Assignment Scale | Recommended Architecture |
|-----------------|------------------------|
| Simple CRUD | Layered (Controller-Service-Repository) |
| Complex domain | Layered + DDD elements (domain services, value objects) |
| Read/write separation needed | Partial CQRS adoption |

**Caution**:
- Assignments typically need to be completed within 1-2 weeks
- Excessive abstraction can actually lead to point deductions
- State your architecture choice rationale in the README

**When to apply Hexagonal**:
- Assignments with many external system integrations
- Assignments where testability is emphasized
- When clean architecture is explicitly required

</details>

---

## Multi-Module Projects

### 1. What is Multi-Module?

A structure that separates a single project into multiple modules to achieve separation of concerns and clarify dependencies.

```
marketplace/
├── build.gradle (root)
├── settings.gradle
├── marketplace-api/           # API module (Controller, execution)
├── marketplace-domain/        # Domain module (Entity, Service)
├── marketplace-infra/         # Infrastructure module (Repository, external integration)
└── marketplace-common/        # Common module (Utils, Exception)
```

### 2. Multi-Module Structure Options

There are two approaches to multi-module design.

| Option | Characteristics | Service Location | Repository Handling |
|--------|----------------|-----------------|-------------------|
| **Option A (Canonical)** | Strict DIP applied | domain module | Interface/implementation separation |
| **Option B (Simplified)** | Pragmatic approach | api module | Direct JpaRepository usage |

<details>
<summary>Which option should you choose?</summary>

**When to choose Option A**:
- When clean architecture is explicitly required
- When there are many external integrations (payments, notifications) making test isolation important
- When you want to completely separate domain logic from infrastructure technology

**When to choose Option B**:
- When you want a pragmatic and simple structure
- When you want to use JPA/QueryDSL directly in the domain layer
- When the Repository wrapper layer only does simple delegation

For most assignments, **Option B** is sufficient and helps avoid over-engineering.

</details>

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

// Root project does not build
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

### 3. Module Configuration

#### marketplace-common (Common Module)

```groovy
// marketplace-common/build.gradle
dependencies {
    // Only common utilities
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

#### marketplace-domain (Domain Module)

```groovy
// marketplace-domain/build.gradle
dependencies {
    implementation project(':marketplace-common')

    // JPA
    implementation 'org.springframework.boot:spring-boot-starter-data-jpa'

    // Validation
    implementation 'org.springframework.boot:spring-boot-starter-validation'
}
```

<details>
<summary>Option A (Canonical) - Entity, Service, Repository Interface</summary>

```
marketplace-domain/
└── src/main/java/com/example/domain/
    ├── member/
    │   ├── Member.java
    │   ├── MemberRepository.java (interface)
    │   └── MemberService.java
    ├── product/
    │   ├── Product.java
    │   ├── ProductRepository.java (interface)
    │   └── ProductService.java
    └── order/
        ├── Order.java
        ├── OrderRepository.java (interface)
        └── OrderService.java
```

</details>

<details open>
<summary>Option B (Simplified) - Entity Only</summary>

```
marketplace-domain/
└── src/main/java/com/example/domain/
    ├── common/
    │   └── BaseEntity.java
    ├── member/
    │   ├── Member.java
    │   └── Role.java
    ├── product/
    │   ├── Product.java
    │   ├── ProductImage.java
    │   └── ProductStatus.java
    ├── order/
    │   ├── Order.java
    │   ├── OrderItem.java
    │   └── OrderStatus.java
    └── category/
        └── Category.java
```

Services are located in the api module, and Repositories directly use JpaRepository from the infra module.

</details>

#### marketplace-infra (Infrastructure Module)

```groovy
// marketplace-infra/build.gradle
dependencies {
    implementation project(':marketplace-common')
    implementation project(':marketplace-domain')

    // JPA implementation
    implementation 'org.springframework.boot:spring-boot-starter-data-jpa'
    runtimeOnly 'com.h2database:h2'
    runtimeOnly 'com.mysql:mysql-connector-j'

    // QueryDSL (optional)
    implementation 'com.querydsl:querydsl-jpa:5.0.0:jakarta'
    annotationProcessor 'com.querydsl:querydsl-apt:5.0.0:jakarta'

    // Redis (optional)
    implementation 'org.springframework.boot:spring-boot-starter-data-redis'
}
```

<details>
<summary>Option A (Canonical) - Repository Implementation</summary>

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

</details>

<details open>
<summary>Option B (Simplified) - Direct JpaRepository + QueryDSL Usage</summary>

```
marketplace-infra/
└── src/main/java/com/example/infra/
    ├── member/
    │   └── MemberJpaRepository.java
    ├── product/
    │   ├── ProductJpaRepository.java
    │   ├── ProductJpaRepositoryCustom.java
    │   └── ProductJpaRepositoryImpl.java (QueryDSL)
    ├── order/
    │   ├── OrderJpaRepository.java
    │   ├── OrderJpaRepositoryCustom.java
    │   └── OrderJpaRepositoryImpl.java (QueryDSL)
    └── category/
        └── CategoryJpaRepository.java
```

Using the QueryDSL Custom Repository pattern, complex dynamic queries can also be integrated into the JpaRepository interface.

</details>

#### marketplace-api (API Module)

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

<details>
<summary>Option A (Canonical) - Controller and Security Only</summary>

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

</details>

<details open>
<summary>Option B (Simplified) - Controller, Service, and Security Included</summary>

```
marketplace-api/
└── src/main/java/com/example/api/
    ├── MarketplaceApplication.java
    ├── config/
    │   ├── SecurityConfig.java
    │   ├── SwaggerConfig.java
    │   └── DataInitializer.java
    ├── member/
    │   ├── MembersController.java
    │   ├── AuthController.java
    │   ├── AuthService.java
    │   ├── MemberService.java
    │   └── dto/
    ├── product/
    │   ├── ProductController.java
    │   ├── ProductService.java
    │   └── dto/
    ├── order/
    │   ├── OrderController.java
    │   ├── OrderService.java
    │   ├── dto/
    │   └── event/
    ├── category/
    │   ├── CategoryController.java
    │   └── CategoryService.java
    └── security/
        ├── JwtTokenProvider.java
        └── JwtAuthenticationFilter.java
```

Since Services are in the api module, organizing by domain package increases cohesion.

</details>

### 4. Module Dependency Rules

#### Option A (Canonical) - Dependency Inversion Applied

```
+-----------------------+
|  marketplace-api      |  <- Controller, Security
+-----------------------+
|     depends on        |
+-----------------------+
| marketplace-domain    |  <- Entity, Service, Repository interface
+-----------------------+
| (does not depend)     |  <- domain does NOT depend on infra!
+-----------------------+
| marketplace-infra     |  <- Repository implementation (implements domain interfaces)
+-----------------------+
|     depends on        |
+-----------------------+
| marketplace-common    |  <- Common utils, exceptions
+-----------------------+
```

**Key point**: domain -> infra dependency is prohibited, Repository interface/implementation is separated

#### Option B (Simplified) - Pragmatic Approach

```
+-----------------------+
|  marketplace-api      |  <- Controller, Service, Security
+-----------------------+
|     depends on        |
+-----------------------+
| marketplace-domain    |  <- Entity only
| marketplace-infra     |  <- JpaRepository, QueryDSL
+-----------------------+
|     depends on        |
+-----------------------+
| marketplace-common    |  <- Common utils, exceptions
+-----------------------+
```

**Key point**: api combines and uses both domain and infra. domain contains only pure Entities

### 5. Repository Implementation Patterns

#### Option A: Interface/Implementation Separation (DIP)

```java
// marketplace-domain/src/.../ProductRepository.java (interface)
public interface ProductRepository {
    Product save(Product product);
    Optional<Product> findById(Long id);
    List<Product> findByCategory(Category category);
    Page<Product> search(ProductSearchCondition condition, Pageable pageable);
}
```

```java
// marketplace-infra/src/.../ProductRepositoryImpl.java (implementation)
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

// JPA Repository (used only within infra)
interface ProductJpaRepository extends JpaRepository<Product, Long> {
    List<Product> findByCategory(Category category);
}
```

#### Option B: QueryDSL Custom Repository Pattern

A Spring Data standard pattern that integrates QueryDSL with JpaRepository.

```kotlin
// marketplace-infra/src/.../ProductJpaRepository.kt
interface ProductJpaRepository : JpaRepository<Product, Long>, ProductJpaRepositoryCustom {
    fun findBySellerId(sellerId: Long, pageable: Pageable): Page<Product>
    fun findByStatusOrderBySalesCountDesc(status: ProductStatus, pageable: Pageable): List<Product>
}
```

```kotlin
// marketplace-infra/src/.../ProductJpaRepositoryCustom.kt
interface ProductJpaRepositoryCustom {
    fun findByIdWithLock(id: Long): Optional<Product>
    fun search(
        keyword: String?,
        categoryId: Long?,
        minPrice: BigDecimal?,
        maxPrice: BigDecimal?,
        status: ProductStatus?,
        sellerId: Long?,
        pageable: Pageable
    ): Page<Product>
}
```

```kotlin
// marketplace-infra/src/.../ProductJpaRepositoryImpl.kt
class ProductJpaRepositoryImpl(
    private val queryFactory: JPAQueryFactory
) : ProductJpaRepositoryCustom {

    private val product = QProduct.product

    override fun findByIdWithLock(id: Long): Optional<Product> {
        val result = queryFactory
            .selectFrom(product)
            .where(product.id.eq(id))
            .setLockMode(LockModeType.PESSIMISTIC_WRITE)
            .fetchOne()
        return Optional.ofNullable(result)
    }

    override fun search(
        keyword: String?,
        categoryId: Long?,
        minPrice: BigDecimal?,
        maxPrice: BigDecimal?,
        status: ProductStatus?,
        sellerId: Long?,
        pageable: Pageable
    ): Page<Product> {
        val content = queryFactory
            .selectFrom(product)
            .where(
                keywordContains(keyword),
                categoryIdEq(categoryId),
                priceGoe(minPrice),
                priceLoe(maxPrice),
                statusEq(status),
                sellerIdEq(sellerId),
                notDeleted()
            )
            .offset(pageable.offset)
            .limit(pageable.pageSize.toLong())
            .orderBy(product.createdAt.desc())
            .fetch()

        val countQuery = queryFactory
            .select(product.count())
            .from(product)
            .where(/* same conditions */)

        return PageableExecutionUtils.getPage(content, pageable) {
            countQuery.fetchOne() ?: 0L
        }
    }

    private fun keywordContains(keyword: String?) =
        keyword?.takeIf { it.isNotBlank() }?.let {
            product.name.containsIgnoreCase(it)
                .or(product.description.containsIgnoreCase(it))
        }

    // ... other condition methods
}
```

```kotlin
// Service directly uses JpaRepository
@Service
class ProductService(
    private val productJpaRepository: ProductJpaRepository,  // Direct injection
    private val memberJpaRepository: MemberJpaRepository,
    private val categoryJpaRepository: CategoryJpaRepository
) {
    fun searchProducts(req: ProductSearchRequest, pageable: Pageable): Page<ProductResponse> {
        return productJpaRepository.search(
            keyword = req.keyword,
            categoryId = req.categoryId,
            minPrice = req.minPrice,
            maxPrice = req.maxPrice,
            status = req.status?.let { ProductStatus.valueOf(it) },
            sellerId = req.sellerId,
            pageable = pageable
        ).map { ProductResponse.from(it) }
    }
}
```

<details>
<summary>Option A vs Option B Comparison</summary>

| Criteria | Option A (DIP) | Option B (QueryDSL Custom) |
|----------|---------------|---------------------------|
| **Abstraction level** | High (complete separation) | Medium (JPA dependency) |
| **Code volume** | High (wrappers needed) | Low |
| **Testability** | Easy mock replacement | Leverages Spring Data testing |
| **Flexibility** | Easy DB replacement | Optimized for JPA ecosystem |
| **Learning curve** | High | Low |

**Recommendation**: For most assignments, **Option B** is suitable. Choose Option A when there are many external integrations or when clean architecture is explicitly required.

</details>

### 6. Build and Run

```bash
# Full build
./gradlew build

# Build specific module only
./gradlew :marketplace-api:build

# Run
./gradlew :marketplace-api:bootRun

# Generate JAR
./gradlew :marketplace-api:bootJar
# -> marketplace-api/build/libs/marketplace-api.jar
```

### 7. Docker Configuration (Multi-Module)

```dockerfile
# Dockerfile
FROM gradle:8.5-jdk17 AS builder

WORKDIR /app

# Copy Gradle files first (caching)
COPY build.gradle settings.gradle ./
COPY gradle ./gradle
COPY marketplace-common/build.gradle ./marketplace-common/
COPY marketplace-domain/build.gradle ./marketplace-domain/
COPY marketplace-infra/build.gradle ./marketplace-infra/
COPY marketplace-api/build.gradle ./marketplace-api/

RUN gradle dependencies --no-daemon || true

# Copy source and build
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
<summary>Single Module vs Multi-Module</summary>

| Aspect | Single Module | Multi-Module |
|--------|--------------|-------------|
| **Complexity** | Simple | Complex initial setup |
| **Build time** | Fast | Optimizable with per-module caching |
| **Dependency management** | Implicit | Explicit, enforced |
| **Testing** | Full testing | Independent testing per module |
| **Scalability** | Limited | Easy to add modules |
| **Team collaboration** | Potential conflicts | Easy to divide work by module |

**Selection criteria for assignments**:

| Scenario | Recommendation |
|----------|---------------|
| Simple CRUD, short deadline | Single module |
| Complex domain, many external integrations | Multi-module |
| Clean architecture required | Multi-module |
| Multi-module explicitly required | Multi-module |

</details>

<details>
<summary>Multi-Module Design Tips</summary>

**1. Prevent circular dependencies**
```
// Wrong example: A -> B -> A
marketplace-domain -> marketplace-infra (X)
marketplace-infra -> marketplace-domain (O)
```

**2. Prevent common module bloat**
- Don't put everything in the common module
- Include only what is truly shared
- Domain-specific logic belongs in the respective module

**3. Clarify module responsibilities**
- api: HTTP request handling, DTO conversion, security
- domain: Business logic, domain rules
- infra: Technical implementation (DB, cache, external APIs)
- common: Utilities, common exceptions

**4. Configuration file location**
- `application.yml`: Located in the api module
- If module-specific configuration is needed, separate with `@ConfigurationProperties`

</details>

<details>
<summary>Common Multi-Module Mistakes</summary>

1. **Dependency direction violation**
   - domain depending on infra defeats the purpose
   - Repository interface/implementation separation is essential

2. **Entity location error**
   - Entities belong in the domain module
   - Package configuration in api is needed for `@Entity` scanning

3. **Component scan omission**
   ```java
   @SpringBootApplication(scanBasePackages = "com.example")
   public class MarketplaceApplication { }
   ```

4. **Test configuration omission**
   - Each module's tests run within that module
   - Integration tests run in the api module

5. **Build order issues**
   - Dependent modules must be built first
   - Gradle handles this automatically, but fails on circular dependencies

</details>

---

## Summary

### Checklist

| Item | Check |
|------|-------|
| Are supplementary features (notifications, logging) separated from core logic? | |
| Is @Async applied where async processing is needed? | |
| Is file upload validation (size, extension) applied? | |
| Is the API versioning strategy applied consistently? | |
| Is the architecture chosen appropriately for the assignment complexity? | |
| Are dependency directions correct when multi-module is applied? | |
| Is the chosen option (DIP vs Simplified) applied consistently in multi-module? | |

### Key Points

1. **Events**: Separate supplementary features, control transactions with `@TransactionalEventListener`
2. **Async**: Separate tasks not needed for the response, thread pool configuration is essential
3. **File handling**: Validation is essential, consider storage path security
4. **API versioning**: URI approach is the most clear
5. **Architecture**: Choose according to assignment scale, beware of over-engineering
6. **Multi-module**: Dependency Inversion Principle, domain -> infra dependency is prohibited

<details>
<summary>Assignment Plus Alpha Tips</summary>

1. **Leverage events**
   - Separate order completion -> notification sending into events
   - Use `@TransactionalEventListener(AFTER_COMMIT)`

2. **Async processing**
   - Process email/SMS sending with `@Async`
   - Include thread pool configuration

3. **Interface abstraction**
   - Abstract external integrations (payments, notifications) with interfaces
   - Use mock implementations for testing

4. **Apply multi-module**
   - Separate into api / domain / infra / common
   - Ensure testability through dependency inversion
   - Include module structure diagram in README

5. **State design intent in README**
   - Why you chose this architecture
   - What trade-offs you considered

</details>

<details>
<summary>Common Mistakes in Assignments</summary>

1. **Event overuse**
   - Processing all logic through events -> difficult to follow the flow
   - Direct calls are clearer for core logic

2. **Ignoring async exceptions**
   - void return + unhandled exceptions -> errors go unnoticed
   - `AsyncUncaughtExceptionHandler` is essential

3. **Missing file validation**
   - Saving without extension/size validation -> security vulnerability
   - Malicious file upload prevention is needed

4. **Excessive architecture**
   - Applying Hexagonal to simple CRUD -> only increases complexity
   - Appropriate selection matching the assignment scale is needed

5. **Inconsistent multi-module structure**
   - With Option A: domain depending on infra violates DIP
   - With Option B: Placing Service in domain makes infra access impossible
   - Mixing both options causes confusion
   - Missing Component scan scope configuration

</details>

---

The series is complete! Try applying everything from Parts 1-7 in the **Comprehensive Assignment**.

-> [Previous: Part 6 - DevOps & Deployment](/en/blog/spring-boot-pre-interview-guide-6)
-> [Next: Comprehensive Assignment](/en/blog/spring-boot-pre-interview-assignment)
