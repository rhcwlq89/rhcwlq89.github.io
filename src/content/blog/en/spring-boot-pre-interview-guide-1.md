---
title: "Spring Boot Pre-Interview Guide Part 1: Core Application Layer"
description: "Core implementation guide for REST API, Service, Repository, and Domain layers"
pubDate: 2026-02-08T13:00:00+09:00
lang: en
tags: ["Spring Boot", "REST API", "Backend", "Interview", "Practical Guide"]
heroImage: "../../../assets/PreinterviewTaskGuide.png"
---

## Series Navigation

| Previous | Current | Next |
|:---:|:---:|:---:|
| - | **Part 1: Core Layer** | [Part 2: DB & Testing](/en/blog/spring-boot-pre-interview-guide-2) |

> **Full Roadmap**: See [Spring Boot Pre-Interview Guide Roadmap](/en/blog/spring-boot-pre-interview-guide-1)

---

## Introduction

This series is a guide compiled from recurring feedback points gathered through multiple rounds of submitting and reviewing Spring Boot-based pre-interview assignments.

**What Part 1 covers:**
- REST API Design (Presentation Layer)
- Business Logic Separation (Service Layer)
- Data Access (Repository Layer)
- Domain Design (Entity Layer)
- Global Exception Handling

### Table of Contents

- [REST API (Presentation Layer)](#rest-api-presentation-layer)
- [Business Logic (Service Layer)](#business-logic-service-layer)
- [DB/Query (Repository Layer)](#dbquery-repository-layer)
- [Domain (Entity Layer)](#domain-entity-layer)
- [Summary](#summary)

---

## REST API (Presentation Layer)

### 1. CRUD and HTTP Method Mapping

While you can distinguish PUT for full updates and PATCH for partial updates, it's best to avoid mixing them and stick with one consistent approach.

| Operation | HTTP Method |
|------|-------------|
| Create | POST |
| Read | GET |
| Update | PUT / PATCH |
| Delete | DELETE |

<details>
<summary>PUT vs PATCH Debate</summary>

**REST Principle Distinction**
- `PUT`: Replaces the entire resource (guarantees idempotency)
- `PATCH`: Modifies only part of the resource

**Reality in Practice**

In most real-world projects, teams either **use only PATCH** or **use only PUT**.

- **PATCH-only approach**: Most modifications are partial updates, and full replacements are rarely needed
- **PUT-only approach**: The team convention is standardized on PUT, or the frontend always sends the complete data

**Recommendation for Assignments**

For assignments, **stick with one approach** and explain your reasoning in the README. Mixing both approaches without a clear rationale can actually hurt your evaluation.

</details>

### 2. URI Design Principles

- **Plural nouns**: `/orders`, `/users`, `/products`
- **Ownership relationships**: `/users/{userId}/orders`
- **Actions**: `/orders/{orderId}/cancel`

> **Tip**: Action URIs like cancel may or may not be acceptable depending on the domain.
> For simple CRUD assignments, consider expressing state changes via PATCH instead.

### 3. Avoiding Hardcoded URIs

Manage frequently used URIs as constants.

<details>
<summary>ApiPaths (Kotlin)</summary>

```kotlin
object ApiPaths {
    const val API = "/api"
    const val V1 = "/v1"
    const val PRODUCTS = "/products"
}
```

</details>

<details>
<summary>ApiPaths (Java)</summary>

```java
public final class ApiPaths {
    public static final String API = "/api";
    public static final String V1 = "/v1";
    public static final String PRODUCTS = "/products";

    private ApiPaths() {}
}
```

</details>

### 4. Common Response Class

Typically composed of a response code, response message, and data section.

- **HTTP Status**: Protocol semantics (200, 400, 500, etc.)
- **code**: Business error classification (ERR001, ERR002, etc.)

> **Exceptions**: File downloads, streaming APIs, and HealthCheck endpoints should not use the common response class.

<details>
<summary>Is a Common Response Class Really Necessary?</summary>

**Arguments For**
- Clients can predict the response format, making parsing easier
- Business errors can be subdivided through error codes
- Provides a consistent interface for frontend collaboration

**Arguments Against**
- HTTP Status Codes alone are sufficient to distinguish errors
- Unnecessary wrapping increases response size
- According to REST principles, HTTP Status should indicate success/failure

**Practical Tips**

Most companies use a common response class. It's especially useful for legacy systems or when supporting multiple clients (web, mobile app, external integrations).

**For assignments**, if not explicitly specified in the requirements, using a common response class is the safer choice. However, make sure to set appropriate HTTP Status codes as well (e.g., 201 Created, 404 Not Found).

</details>

<details>
<summary>CommonResponse (Kotlin)</summary>

```kotlin
data class CommonResponse<T>(
    val code: String = CODE_SUCCESS,
    val message: String = MSG_SUCCESS,
    val data: T? = null
) {
    companion object {
        const val CODE_SUCCESS = "SUC200"
        const val MSG_SUCCESS = "success"

        fun <T> success(data: T? = null): CommonResponse<T> {
            return CommonResponse(CODE_SUCCESS, MSG_SUCCESS, data)
        }

        fun <T> error(code: String, message: String, data: T? = null): CommonResponse<T> {
            return CommonResponse(code, message, data)
        }
    }
}
```

</details>

<details>
<summary>CommonResponse (Java)</summary>

```java
public record CommonResponse<T>(
    String code,
    String message,
    T data
) {
    public static final String CODE_SUCCESS = "SUC200";
    public static final String MSG_SUCCESS = "success";

    public static <T> CommonResponse<T> success() {
        return new CommonResponse<>(CODE_SUCCESS, MSG_SUCCESS, null);
    }

    public static <T> CommonResponse<T> success(T data) {
        return new CommonResponse<>(CODE_SUCCESS, MSG_SUCCESS, data);
    }

    public static <T> CommonResponse<T> error(String code, String message) {
        return new CommonResponse<>(code, message, null);
    }
}
```

</details>

### 5. DTO Validation

- Use `@Valid`, `@NotBlank`, `@Size`, `@NotNull`, etc.
- Apply `@Valid` to nested DTOs as well
- Handle validation exceptions in ExceptionHandler
- **Request DTOs should only be used in the Controller; convert them to Command objects before passing to the Service**

> **Tip**: Passing Request DTOs directly to the Service increases coupling between the Presentation Layer and Business Layer.
> Using Command objects clearly separates layer responsibilities and allows Service tests to run without web-related dependencies.

<details>
<summary>Is the Command Pattern Always Necessary?</summary>

**Arguments For**
- Clear separation of dependencies between layers
- No web annotation dependencies in Service tests
- Changes to Request DTOs don't affect the Service
- Multiple Controllers can call the same Service method in different ways

**Arguments Against**
- Over-engineering for simple CRUD operations
- Additional conversion code increases boilerplate
- Request and Command are often nearly identical
- Unnecessary complexity for small projects like assignments

**Practical Tips**

- **Large-scale projects**: Command pattern recommended. Especially when domain logic is complex or the same logic is called from multiple channels (API, batch, message queue)
- **Small projects/assignments**: Passing Request DTOs directly is fine. Just be consistent with one approach

**Recommendation for Assignments**

If you have enough time, using the Command pattern demonstrates your understanding of layer separation. However, if time is limited, using Request DTOs directly is not a penalty.

</details>

<details>
<summary>Request DTO & Command (Kotlin)</summary>

```kotlin
// Request DTO - Used for validation in the Controller
data class RegisterProductRequest(
    @field:NotBlank
    @field:Size(max = 100)
    val name: String?,

    @field:Size(min = 1)
    @field:Valid
    val details: List<ProductDetailDto>?
) {
    fun toCommand() = RegisterProductCommand(
        name = name!!,
        details = details!!.map { it.toCommand() }
    )
}

data class ProductDetailDto(
    @field:NotNull
    val type: ProductCategoryType?,

    @field:NotBlank
    val name: String?
) {
    fun toCommand() = ProductDetailCommand(
        type = type!!,
        name = name!!
    )
}

data class ModifyProductRequest(
    @field:NotBlank
    @field:Size(max = 100)
    val name: String?,

    @field:NotNull
    val category: ProductCategoryType?
) {
    fun toCommand() = ModifyProductCommand(
        name = name!!,
        category = category!!
    )
}

// Command - Pure data object used in the Service Layer
data class RegisterProductCommand(
    val name: String,
    val details: List<ProductDetailCommand>
)

data class ProductDetailCommand(
    val type: ProductCategoryType,
    val name: String
)

data class ModifyProductCommand(
    val name: String,
    val category: ProductCategoryType
)

enum class ProductCategoryType {
    FOOD, HOTEL
}
```

</details>

<details>
<summary>Request DTO & Command (Java)</summary>

```java
// Request DTO - Used for validation in the Controller
public record RegisterProductRequest(
    @NotBlank
    @Size(max = 100)
    String name,

    @Size(min = 1)
    @Valid
    List<ProductDetailDto> details
) {
    public RegisterProductCommand toCommand() {
        return new RegisterProductCommand(
            name,
            details.stream()
                .map(ProductDetailDto::toCommand)
                .toList()
        );
    }
}

public record ProductDetailDto(
    @NotNull
    ProductCategoryType type,

    @NotBlank
    String name
) {
    public ProductDetailCommand toCommand() {
        return new ProductDetailCommand(type, name);
    }
}

public record ModifyProductRequest(
    @NotBlank
    @Size(max = 100)
    String name,

    @NotNull
    ProductCategoryType category
) {
    public ModifyProductCommand toCommand() {
        return new ModifyProductCommand(name, category);
    }
}

// Command - Pure data object used in the Service Layer
public record RegisterProductCommand(
    String name,
    List<ProductDetailCommand> details
) {}

public record ProductDetailCommand(
    ProductCategoryType type,
    String name
) {}

public record ModifyProductCommand(
    String name,
    ProductCategoryType category
) {}

public enum ProductCategoryType {
    FOOD, HOTEL
}
```

</details>

### 6. Controller Implementation

The Controller should not contain business logic. **Request DTOs are converted to Commands in the Controller before being passed to the Service.**

<details>
<summary>Pagination Configuration (application.yml)</summary>

```yaml
spring:
  data:
    web:
      pageable:
        max-page-size: 100
```

</details>

<details>
<summary>Controller (Kotlin)</summary>

```kotlin
@RestController
@RequestMapping(API + V1 + PRODUCTS)
class ProductController(
    private val productService: ProductService
) {
    @GetMapping("/{productId}")
    fun findProductDetail(
        @PathVariable productId: Long
    ): CommonResponse<FindProductDetailResponse> {
        return CommonResponse.success(productService.findProductDetail(productId))
    }

    @GetMapping
    fun findProducts(
        @Valid @ModelAttribute request: FindProductRequest,
        @PageableDefault(page = 0, size = 20) pageable: Pageable
    ): CommonResponse<Page<FindProductResponse>> {
        return CommonResponse.success(productService.findProducts(request.toCommand(), pageable))
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun registerProduct(
        @Valid @RequestBody request: RegisterProductRequest
    ): CommonResponse<Long> {
        return CommonResponse.success(productService.registerProduct(request.toCommand()))
    }

    @PutMapping("/{productId}")
    fun modifyProduct(
        @PathVariable productId: Long,
        @Valid @RequestBody request: ModifyProductRequest
    ): CommonResponse<Long> {
        return CommonResponse.success(productService.modifyProduct(productId, request.toCommand()))
    }

    @DeleteMapping
    fun deleteProducts(
        @Valid @Size(min = 1) @RequestParam productIds: Set<Long>
    ): CommonResponse<Unit> {
        productService.deleteProducts(productIds)
        return CommonResponse.success()
    }
}
```

</details>

<details>
<summary>Controller (Java)</summary>

```java
@RestController
@RequestMapping(ApiPaths.API + ApiPaths.V1 + ApiPaths.PRODUCTS)
@RequiredArgsConstructor
public class ProductController {

    private final ProductService productService;

    @GetMapping("/{productId}")
    public CommonResponse<FindProductDetailResponse> findProductDetail(
            @PathVariable Long productId) {
        return CommonResponse.success(productService.findProductDetail(productId));
    }

    @GetMapping
    public CommonResponse<Page<FindProductResponse>> findProducts(
            @Valid @ModelAttribute FindProductRequest request,
            @PageableDefault(page = 0, size = 20) Pageable pageable) {
        return CommonResponse.success(productService.findProducts(request.toCommand(), pageable));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CommonResponse<Long> registerProduct(
            @Valid @RequestBody RegisterProductRequest request) {
        return CommonResponse.success(productService.registerProduct(request.toCommand()));
    }

    @PutMapping("/{productId}")
    public CommonResponse<Long> modifyProduct(
            @PathVariable Long productId,
            @Valid @RequestBody ModifyProductRequest request) {
        return CommonResponse.success(productService.modifyProduct(productId, request.toCommand()));
    }

    @DeleteMapping
    public CommonResponse<Void> deleteProducts(
            @Valid @Size(min = 1) @RequestParam Set<Long> productIds) {
        productService.deleteProducts(productIds);
        return CommonResponse.success();
    }
}
```

</details>

---

## Business Logic (Service Layer)

### 1. Transaction Management

- Separate read transactions with `readOnly = true` to prevent unnecessary Dirty Checking
- Verify transaction behavior through logging configuration

<details>
<summary>Actual Effects of readOnly = true</summary>

**How It Works**
1. **Dirty Checking disabled**: No entity change detection, saving snapshot storage costs
2. **Flush mode changed**: Set to `FlushMode.MANUAL`, preventing automatic flushes
3. **DB hint propagation**: Some databases (e.g., MySQL Read Replica routing) utilize read-only hints

**Caveats**
- Even with `readOnly = true`, **a transaction is still started** (it's not No Transaction)
- Modifying an entity will be **silently ignored** without throwing an exception (be careful)
- If OSIV is enabled, lazy loading still works

**FlushMode Types**

| Mode | Description | Use Case |
|------|------|----------|
| `AUTO` | Automatic flush before query execution and before commit (default) | Normal transactions |
| `COMMIT` | Flush only on commit | Bulk read operations |
| `MANUAL` | Only on explicit `flush()` call | Automatically set when `readOnly = true` |
| `ALWAYS` | Flush before every query | Rarely used |

**OSIV (Open Session In View)**

OSIV is a setting that extends the lifecycle of the persistence context to cover the entire HTTP request.

```yaml
# Spring Boot default: true
spring:
  jpa:
    open-in-view: true  # OSIV enabled (default)
```

| OSIV State | Persistence Context Scope | Pros | Cons |
|----------|-------------------|------|------|
| `true` (default) | Request start ~ Response complete | Lazy loading available in Controller | DB connection held for a long time |
| `false` | Within transaction scope | Faster connection release | `LazyInitializationException` possible in Controller |

**Recommendation**: In production, set `open-in-view: false` and pre-load required data in the Service layer.

**Practical Tip**

A common pattern is to declare `@Transactional(readOnly = true)` at the class level and override with `@Transactional` only on write methods.

```java
@Service
@Transactional(readOnly = true)  // Default: read-only
public class ProductService {

    public Product findById(Long id) { ... }  // readOnly = true applied

    @Transactional  // Write operation: overrides to readOnly = false
    public Long save(Product product) { ... }
}
```

</details>

<details>
<summary>Transaction Logging Level Configuration (application.yml)</summary>

```yaml
logging:
  level:
    org.springframework.orm.jpa: DEBUG
    org.springframework.transaction: DEBUG
    org.hibernate.SQL: DEBUG
    org.hibernate.orm.jdbc.bind: DEBUG
```

</details>

### 2. Custom Exception Definition

Handle expected exceptions using Custom Exceptions.

<details>
<summary>Custom Exception (Kotlin)</summary>

```kotlin
enum class ErrorCode(
    val code: String,
    val message: String
) {
    ERR000("ERR000", "A temporary error occurred. Please try again later."),
    ERR001("ERR001", "Invalid request."),
    ERR002("ERR002", "Product not found.")
}

open class CommonException(
    val statusCode: HttpStatus,
    val errorCode: ErrorCode
) : RuntimeException(errorCode.message)

class BadRequestException(errorCode: ErrorCode = ErrorCode.ERR001)
    : CommonException(HttpStatus.BAD_REQUEST, errorCode)

class NotFoundException(errorCode: ErrorCode = ErrorCode.ERR002)
    : CommonException(HttpStatus.NOT_FOUND, errorCode)
```

</details>

<details>
<summary>Custom Exception (Java)</summary>

```java
@Getter
@RequiredArgsConstructor
public enum ErrorCode {
    ERR000("ERR000", "A temporary error occurred. Please try again later."),
    ERR001("ERR001", "Invalid request."),
    ERR002("ERR002", "Product not found.");

    private final String code;
    private final String message;
}

@Getter
public class CommonException extends RuntimeException {
    private final HttpStatus statusCode;
    private final ErrorCode errorCode;

    public CommonException(HttpStatus statusCode, ErrorCode errorCode) {
        super(errorCode.getMessage());
        this.statusCode = statusCode;
        this.errorCode = errorCode;
    }
}

public class NotFoundException extends CommonException {
    public NotFoundException() {
        super(HttpStatus.NOT_FOUND, ErrorCode.ERR002);
    }

    public NotFoundException(ErrorCode errorCode) {
        super(HttpStatus.NOT_FOUND, errorCode);
    }
}
```

</details>

### 3. GlobalExceptionHandler

Use `@RestControllerAdvice` to handle exceptions consistently across the entire application.

#### Exception Handling Priority

Spring matches the **most specific handler** first based on the exception class hierarchy.

| Priority | Handler | Target |
|:---:|--------|----------|
| 1 | `CommonException.class` | Exceptions intentionally thrown from business logic |
| 2 | `MethodArgumentNotValidException.class` | Exceptions thrown when `@Valid` validation fails |
| 3 | `Exception.class` | All unhandled exceptions (Fallback) |

#### Role of Each Handler

**CommonException Handler**

Handles exceptions explicitly thrown from service logic. Used for business rule violations such as `NotFoundException` and `BadRequestException`, responding with the HTTP status code and error code defined in the exception.

**MethodArgumentNotValidException Handler**

Triggered when `@Valid` validation fails in the Controller. Extracts which field failed and why, then delivers the message to the client.

**Exception Handler (Fallback)**

The last line of defense that catches **all exceptions** not handled by the above handlers.

- **Security**: Prevents internal information such as NPE messages, DB connection errors, or stack traces from being exposed to the client
- **Logging**: Records the full stack trace in server logs for debugging (logging will be covered in more detail later)
- **Consistency**: Returns unexpected errors in the `CommonResponse` format

> **Note**: Without this handler, Spring's default error page (Whitelabel Error Page) or stack traces will be exposed.
> If such screens are visible during assignment evaluation, it may result in penalties for insufficient exception handling.

<details>
<summary>GlobalExceptionHandler (Kotlin)</summary>

```kotlin
@RestControllerAdvice
class GlobalExceptionHandler {

    private val log = LoggerFactory.getLogger(javaClass)

    /**
     * Business exception handler
     * - Handles exceptions intentionally thrown from the service
     * - Uses the HTTP status code and error code defined in the exception as-is
     */
    @ExceptionHandler(CommonException::class)
    fun handleCommonException(e: CommonException): ResponseEntity<CommonResponse<Unit>> {
        val response = CommonResponse.error<Unit>(
            e.errorCode.code,
            e.errorCode.message
        )
        return ResponseEntity(response, e.statusCode)
    }

    /**
     * Validation exception handler
     * - Triggered when @Valid validation fails
     * - Extracts the failed field name and message for the response
     */
    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun handleValidationException(
        e: MethodArgumentNotValidException
    ): ResponseEntity<CommonResponse<Unit>> {
        val fieldError = e.bindingResult.fieldErrors.firstOrNull()
        val message = fieldError?.let { "${it.field}: ${it.defaultMessage}" }
            ?: "Validation failed"

        val response = CommonResponse.error<Unit>(ErrorCode.ERR001.code, message)
        return ResponseEntity(response, HttpStatus.BAD_REQUEST)
    }

    /**
     * Unexpected exception handler (Fallback)
     * - Catches all exceptions not handled by the above handlers
     * - Returns a generic message to prevent internal information exposure
     * - Records the full stack trace in server logs for debugging
     */
    @ExceptionHandler(Exception::class)
    fun handleException(e: Exception): ResponseEntity<CommonResponse<Unit>> {
        log.error("Unexpected error occurred", e)

        val response = CommonResponse.error<Unit>(
            ErrorCode.ERR000.code,
            ErrorCode.ERR000.message
        )
        return ResponseEntity(response, HttpStatus.INTERNAL_SERVER_ERROR)
    }
}
```

</details>

<details>
<summary>GlobalExceptionHandler (Java)</summary>

```java
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    /**
     * Business exception handler
     * - Handles exceptions intentionally thrown from the service
     * - Uses the HTTP status code and error code defined in the exception as-is
     */
    @ExceptionHandler(CommonException.class)
    public ResponseEntity<CommonResponse<Void>> handleCommonException(CommonException e) {
        CommonResponse<Void> response = CommonResponse.error(
            e.getErrorCode().getCode(),
            e.getErrorCode().getMessage()
        );
        return ResponseEntity.status(e.getStatusCode()).body(response);
    }

    /**
     * Validation exception handler
     * - Triggered when @Valid validation fails
     * - Extracts the failed field name and message for the response
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<CommonResponse<Void>> handleValidationException(
            MethodArgumentNotValidException e) {
        FieldError fieldError = e.getBindingResult().getFieldErrors().stream()
            .findFirst()
            .orElse(null);

        String message = fieldError != null
            ? fieldError.getField() + ": " + fieldError.getDefaultMessage()
            : "Validation failed";

        CommonResponse<Void> response = CommonResponse.error(
            ErrorCode.ERR001.getCode(),
            message
        );
        return ResponseEntity.badRequest().body(response);
    }

    /**
     * Unexpected exception handler (Fallback)
     * - Catches all exceptions not handled by the above handlers
     * - Returns a generic message to prevent internal information exposure
     * - Records the full stack trace in server logs for debugging
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<CommonResponse<Void>> handleException(Exception e) {
        log.error("Unexpected error occurred", e);

        CommonResponse<Void> response = CommonResponse.error(
            ErrorCode.ERR000.getCode(),
            ErrorCode.ERR000.getMessage()
        );
        return ResponseEntity.internalServerError().body(response);
    }
}
```

</details>

### 4. Nullable Handling

- Kotlin: Use `?:` (Elvis operator) and nullable types
- Java: Use `Optional` and `orElseThrow()`

<details>
<summary>Service Query (Kotlin)</summary>

```kotlin
@Service
@Transactional(readOnly = true)
class ProductService(
    private val productRepository: ProductRepository
) {
    fun findProductDetail(productId: Long): FindProductDetailResponse {
        val product = productRepository.findById(productId)
            ?: throw NotFoundException()

        return FindProductDetailResponse.from(product)
    }
}
```

</details>

<details>
<summary>Service Query (Java)</summary>

```java
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class ProductService {

    private final ProductRepository productRepository;

    public FindProductDetailResponse findProductDetail(Long productId) {
        Product product = productRepository.findById(productId)
            .orElseThrow(NotFoundException::new);

        return FindProductDetailResponse.from(product);
    }
}
```

</details>

### 5. Service Implementation Principles

- Do not return Domain Models directly; convert them to response-specific DTOs
- Use Streams for repetitive logic while maintaining readability
- **Accept Command objects as parameters, not Request DTOs**

<details>
<summary>deleteAll() vs deleteAllInBatch() Differences</summary>

**deleteAll()**
- Queries and deletes entities one by one (N+1 query issue)
- JPA callbacks like `@PreRemove`, `@PostRemove` are executed
- Cascade deletion works

**deleteAllInBatch()**
- Bulk deletion with a single DELETE query
- JPA callbacks are not executed
- Cascade deletion does not work (potential FK constraint violations)

**Practical Tips**

- Use `deleteAll()` when there are related entities or deletion callbacks are needed
- Use `deleteAllInBatch()` for bulk deletion without relationships
- For assignments, **`deleteAll()` is the safe choice**

</details>

<details>
<summary>Soft Delete vs Hard Delete</summary>

**Hard Delete**
- Actually deletes the data
- Simple and straightforward implementation
- Saves storage space

**Soft Delete**
- Logical deletion using a `deleted` flag or `deletedAt` column
- Data recovery possible, easier auditing
- Always requires deletion status condition in queries (`@Where`, `@SQLRestriction`)

**Choosing in Practice**

Most production projects use **Soft Delete**. Especially when:
- Legal data retention is required (finance, healthcare, etc.)
- Undo deletion functionality is needed
- Deleted data is used for statistics/analysis

**Recommendation for Assignments**

If not specified in the requirements, implementing **Hard Delete** is fine. If you implement Soft Delete, don't forget to filter out deleted data in query logic.

```java
// Example query method when implementing Soft Delete
Optional<Product> findByIdAndDeletedFalse(Long id);
```

</details>

<details>
<summary>Service (Kotlin)</summary>

```kotlin
@Service
@Transactional(readOnly = true)
class ProductService(
    private val productRepository: ProductRepository
) {
    @Transactional
    fun modifyProduct(productId: Long, command: ModifyProductCommand): Long {
        val product = productRepository.findById(productId)
            ?: throw NotFoundException()

        product.update(
            name = command.name,
            category = command.category
        )

        return product.id!!
    }

    @Transactional
    fun deleteProducts(productIds: Set<Long>) {
        val products = productRepository.findAllById(productIds)

        if (products.size != productIds.size) {
            throw NotFoundException()
        }

        productRepository.deleteAll(products)
    }
}
```

</details>

<details>
<summary>Service (Java)</summary>

```java
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class ProductService {

    private final ProductRepository productRepository;

    @Transactional
    public Long modifyProduct(Long productId, ModifyProductCommand command) {
        Product product = productRepository.findById(productId)
            .orElseThrow(NotFoundException::new);

        product.update(command.name(), command.category());

        return product.getId();
    }

    @Transactional
    public void deleteProducts(Set<Long> productIds) {
        List<Product> products = productRepository.findAllById(productIds);

        if (products.size() != productIds.size()) {
            throw new NotFoundException();
        }

        productRepository.deleteAll(products);
    }
}
```

</details>

---

## DB/Query (Repository Layer)

### 1. Basic Principles

- **Nullable handling**: Java uses Optional, Kotlin uses Nullable
- **Simple queries**: Use JPA Query Methods
- **Complex queries**: Use Querydsl
- **When using Querydsl**: Explicitly declare `@Transactional`

### 2. Pagination

Using `PageableExecutionUtils.getPage()` provides a performance benefit by skipping the count query on the last page.

<details>
<summary>Repository (Kotlin)</summary>

```kotlin
interface ProductRepository : JpaRepository<Product, Long>, ProductRepositoryCustom {
    fun findByIdAndDeletedFalse(id: Long): Product?
    fun findAllByIdIn(ids: Collection<Long>): List<Product>
}

interface ProductRepositoryCustom {
    fun findProducts(
        name: String?,
        enabled: Boolean?,
        pageable: Pageable
    ): Page<Product>
}

class ProductRepositoryImpl(
    private val queryFactory: JPAQueryFactory
) : ProductRepositoryCustom {

    override fun findProducts(
        name: String?,
        enabled: Boolean?,
        pageable: Pageable
    ): Page<Product> {
        val product = QProduct.product

        val results = queryFactory
            .selectFrom(product)
            .where(
                nameContains(name),
                enabledEq(enabled)
            )
            .offset(pageable.offset)
            .limit(pageable.pageSize.toLong())
            .orderBy(product.id.desc())
            .fetch()

        val countQuery = queryFactory
            .select(product.count())
            .from(product)
            .where(
                nameContains(name),
                enabledEq(enabled)
            )

        return PageableExecutionUtils.getPage(results, pageable) {
            countQuery.fetchOne() ?: 0L
        }
    }

    private fun nameContains(name: String?): BooleanExpression? {
        return name?.let { QProduct.product.name.containsIgnoreCase(it) }
    }

    private fun enabledEq(enabled: Boolean?): BooleanExpression? {
        return enabled?.let { QProduct.product.enabled.eq(it) }
    }
}
```

</details>

<details>
<summary>Repository (Java)</summary>

```java
public interface ProductRepository extends JpaRepository<Product, Long>,
        ProductRepositoryCustom {

    Optional<Product> findByIdAndDeletedFalse(Long id);
    List<Product> findAllByIdIn(Collection<Long> ids);
}

public interface ProductRepositoryCustom {
    Page<Product> findProducts(String name, Boolean enabled, Pageable pageable);
}

@RequiredArgsConstructor
public class ProductRepositoryImpl implements ProductRepositoryCustom {

    private final JPAQueryFactory queryFactory;

    @Override
    public Page<Product> findProducts(String name, Boolean enabled, Pageable pageable) {
        QProduct product = QProduct.product;

        List<Product> results = queryFactory
            .selectFrom(product)
            .where(
                nameContains(name),
                enabledEq(enabled)
            )
            .offset(pageable.getOffset())
            .limit(pageable.getPageSize())
            .orderBy(product.id.desc())
            .fetch();

        JPAQuery<Long> countQuery = queryFactory
            .select(product.count())
            .from(product)
            .where(
                nameContains(name),
                enabledEq(enabled)
            );

        return PageableExecutionUtils.getPage(results, pageable, countQuery::fetchOne);
    }

    private BooleanExpression nameContains(String name) {
        return name != null ? QProduct.product.name.containsIgnoreCase(name) : null;
    }

    private BooleanExpression enabledEq(Boolean enabled) {
        return enabled != null ? QProduct.product.enabled.eq(enabled) : null;
    }
}
```

</details>

---

## Domain (Entity Layer)

### 1. Design Principles

- **Business methods instead of setters**: `updateName()`, `activate()`, etc.
- **Default constructor should be protected**: Satisfies JPA spec + prevents indiscriminate object creation
- **Separate related Entities**: Split child Entities when needed
- **Fixed values**: Use Enums

<details>
<summary>Using Lombok in Entities -- Is It Safe?</summary>

**Annotations That Require Caution**

| Annotation | Risk Level | Reason |
|-----------|:---:|------|
| `@Data` | High | Includes `@EqualsAndHashCode` - infinite loop with bidirectional relationships |
| `@EqualsAndHashCode` | High | StackOverflow when including related entities |
| `@ToString` | Medium | Forces lazy loading proxy initialization, infinite loop |
| `@AllArgsConstructor` | Medium | Bugs possible when field order changes |
| `@Setter` | Low | Unintended state changes possible |
| `@Getter` | Safe | Generally no issues |
| `@NoArgsConstructor` | Safe | Recommended with `access = PROTECTED` |
| `@Builder` | Safe | But be careful when combined with `@AllArgsConstructor` |

**@Builder + @AllArgsConstructor Combination Caution**

```java
// Potentially problematic pattern
@Entity
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class Product {
    @Id @GeneratedValue
    private Long id;
    private String name;
    private int price;
}

// Builder calls AllArgsConstructor
// If field order changes, values may be assigned incorrectly
Product product = Product.builder()
    .name("Product")
    .price(1000)
    .build();
```

```java
// Recommended pattern - Apply @Builder directly to the constructor
@Entity
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Product {
    @Id @GeneratedValue
    private Long id;
    private String name;
    private int price;

    @Builder
    private Product(String name, int price) {
        this.name = name;
        this.price = price;
    }
}
```

Applying `@Builder` to the constructor allows you to explicitly specify only the required fields and is safe against field order changes.

**Recommended Pattern for Production**

```java
@Entity
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Product {
    // Do not use @Setter - change state through business methods
    // @ToString - if needed, implement manually excluding related entities
    // @EqualsAndHashCode - implement ID-based manually or don't use
}
```

**Recommendation for Assignments**

Use only `@Getter` and `@NoArgsConstructor(access = PROTECTED)`, and implement everything else manually. Never use `@Data`.

</details>

### 2. BaseEntity

Separate common fields like creation time and modification time into a BaseEntity.

<details>
<summary>BaseEntity (Kotlin)</summary>

```kotlin
@MappedSuperclass
@EntityListeners(AuditingEntityListener::class)
abstract class BaseEntity {

    @CreatedDate
    @Column(updatable = false)
    var createdAt: LocalDateTime = LocalDateTime.now()
        protected set

    @LastModifiedDate
    @Column
    var updatedAt: LocalDateTime = LocalDateTime.now()
        protected set
}

@MappedSuperclass
abstract class BaseEntityWithAuditor : BaseEntity() {

    @CreatedBy
    @Column(updatable = false)
    var createdBy: Long? = null
        protected set

    @LastModifiedBy
    @Column
    var updatedBy: Long? = null
        protected set
}
```

</details>

<details>
<summary>BaseEntity (Java)</summary>

```java
@MappedSuperclass
@EntityListeners(AuditingEntityListener.class)
@Getter
public abstract class BaseEntity {

    @CreatedDate
    @Column(updatable = false)
    private LocalDateTime createdAt;

    @LastModifiedDate
    @Column
    private LocalDateTime updatedAt;
}

@MappedSuperclass
@Getter
public abstract class BaseEntityWithAuditor extends BaseEntity {

    @CreatedBy
    @Column(updatable = false)
    private Long createdBy;

    @LastModifiedBy
    @Column
    private Long updatedBy;
}
```

</details>

### 3. Entity Implementation

<details>
<summary>Entity (Kotlin)</summary>

```kotlin
@Entity
@Table(name = "products")
class Product(
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    val id: Long? = null,

    @Column(nullable = false)
    var name: String,

    @Column(nullable = false)
    var enabled: Boolean = true,

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    var category: ProductCategoryType
) : BaseEntity() {

    fun update(name: String, category: ProductCategoryType) {
        this.name = name
        this.category = category
    }

    fun enable() {
        this.enabled = true
    }

    fun disable() {
        this.enabled = false
    }
}
```

</details>

<details>
<summary>Entity (Java)</summary>

```java
@Entity
@Table(name = "products")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Product extends BaseEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private Boolean enabled = true;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ProductCategoryType category;

    public Product(String name, ProductCategoryType category) {
        this.name = name;
        this.category = category;
    }

    public void update(String name, ProductCategoryType category) {
        this.name = name;
        this.category = category;
    }

    public void enable() {
        this.enabled = true;
    }

    public void disable() {
        this.enabled = false;
    }
}
```

</details>

---

## Summary

### Checklist by Layer

| Layer | Check Points |
|--------|------------|
| **Controller** | HTTP Method mapping, URI design, Validation, Common response, Request to Command conversion |
| **Service** | Transaction management, Exception handling, DTO conversion, Command object usage |
| **Repository** | Nullable handling, Pagination, Querydsl usage |
| **Domain** | Business methods, BaseEntity, protected constructor |

### Quick Checklist

- [ ] Are CRUD operations correctly mapped to HTTP Methods?
- [ ] Do URIs clearly represent resources?
- [ ] Is Validation applied to DTOs?
- [ ] Are Request DTOs converted to Commands before passing to the Service?
- [ ] Is `readOnly = true` set for read transactions?
- [ ] Are exceptions handled consistently in the GlobalExceptionHandler?
- [ ] Do Entities have business methods instead of setters?

---

The next part covers **Database Configuration** and **Test Environment**.

[Next: Part 2 - Database & Testing](/en/blog/spring-boot-pre-interview-guide-2)
