---
title: "Spring Boot Pre-interview Task Guide 1"
description: "Pre-interview 과제에서 자주 나오는 유형과 체크 포인트 정리"
pubDate: 2026-01-16
tags: ["Spring Boot", "REST API", "Backend", "Interview", "사전과제", "코드리뷰과제"]
heroImage: "../../assets/PreinterviewTaskGuide.png"
---

## 서론

이 글은 Spring Boot 기반 Pre-interview 과제를 여러 번 제출하고, 또 리뷰하는 과정에서 반복적으로 언급된 포인트들을 정리한 가이드다.

단순히 "동작하는 코드"가 아니라, 과제 평가자가 실제로 확인하는 기준(구조, 책임 분리, 예외 처리, 트랜잭션)을 빠르게 점검할 수 있도록 정리했다.

실제 과제에서 접했던 내용을 바탕으로 작성되었으며, 그대로 공개할 순 없기 때문에 적당히 각색해서 일반적인 형태로 작성했다.

### 목차

- [REST API (Presentation Layer)](#rest-api-presentation-layer)
- [Business Logic (Service Layer)](#business-logic-service-layer)
- [DB/Query (Repository Layer)](#dbquery-repository-layer)
- [Domain (Entity Layer)](#domain-entity-layer)
- [정리](#정리)

---

## REST API (Presentation Layer)

### 1. CRUD와 HttpMethod 매핑

PUT은 전체 수정, PATCH는 부분 수정으로 구분하는 것도 방법이지만, 혼용하지 않고 한 가지 방식으로 통일하는 것이 좋다.

| 작업 | HTTP Method |
|------|-------------|
| Create | POST |
| Read | GET |
| Update | PUT / PATCH |
| Delete | DELETE |

### 2. URI 설계 원칙

- **복수형** 사용: `/orders`, `/users`, `/products`
- **소유관계**: `/users/{userId}/orders`
- **행위 표현**: `/orders/{orderId}/cancel`

> **Tip**: cancel 같은 행위 URI는 도메인 성격에 따라 허용 여부가 갈릴 수 있다.
> 단순 CRUD 과제에서는 상태 변경(PATCH)으로 표현하는 것도 고려해볼 것

### 3. URI 하드코딩 방지

반복적으로 사용되는 URI는 상수로 관리한다.

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

### 4. 공통 응답 클래스

일반적으로 응답코드, 응답메시지, 데이터 영역으로 구성한다.

- **HTTP Status**: 프로토콜 의미 (200, 400, 500 등)
- **code**: 비즈니스 에러 분류 (ERR001, ERR002 등)

> **예외**: 파일 다운로드, 스트리밍 API, HealthCheck는 공통 응답 클래스를 적용하지 않는 것이 적절하다.

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

- `@Valid`, `@NotBlank`, `@Size`, `@NotNull` 등 활용
- 중첩된 DTO도 `@Valid` 처리
- ExceptionHandler에서 Validation 예외 처리

<details>
<summary>DTO 클래스 (Kotlin)</summary>

```kotlin
data class RegisterProductRequest(
    @field:NotBlank
    @field:Size(max = 100)
    val name: String?,

    @field:Size(min = 1)
    @field:Valid
    val details: List<ProductDetailDto>?
)

data class ProductDetailDto(
    @field:NotNull
    val type: ProductCategoryType?,

    @field:NotBlank
    val name: String?
)

enum class ProductCategoryType {
    FOOD, HOTEL
}
```

</details>

<details>
<summary>DTO 클래스 (Java)</summary>

```java
public record RegisterProductRequest(
    @NotBlank
    @Size(max = 100)
    String name,

    @Size(min = 1)
    @Valid
    List<ProductDetailDto> details
) {}

public record ProductDetailDto(
    @NotNull
    ProductCategoryType type,

    @NotBlank
    String name
) {}

public enum ProductCategoryType {
    FOOD, HOTEL
}
```

</details>

### 6. Controller 작성

Controller는 비즈니스 로직을 포함하지 않도록 한다.

<details>
<summary>페이지네이션 설정 (application.yml)</summary>

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
        return CommonResponse.success(productService.findProducts(request, pageable))
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun registerProduct(
        @Valid @RequestBody request: RegisterProductRequest
    ): CommonResponse<Long> {
        return CommonResponse.success(productService.registerProduct(request))
    }

    @PutMapping("/{productId}")
    fun modifyProduct(
        @PathVariable productId: Long,
        @Valid @RequestBody request: ModifyProductRequest
    ): CommonResponse<Long> {
        return CommonResponse.success(productService.modifyProduct(productId, request))
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
        return CommonResponse.success(productService.findProducts(request, pageable));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CommonResponse<Long> registerProduct(
            @Valid @RequestBody RegisterProductRequest request) {
        return CommonResponse.success(productService.registerProduct(request));
    }

    @PutMapping("/{productId}")
    public CommonResponse<Long> modifyProduct(
            @PathVariable Long productId,
            @Valid @RequestBody ModifyProductRequest request) {
        return CommonResponse.success(productService.modifyProduct(productId, request));
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

### 1. 트랜잭션 처리

- 조회 트랜잭션은 `readOnly = true`로 분리하여 불필요한 Dirty Checking 방지
- 로깅 설정으로 트랜잭션 동작 확인

<details>
<summary>트랜잭션 로깅 설정 (application.yml)</summary>

```yaml
logging:
  level:
    org.springframework.orm.jpa: DEBUG
    org.springframework.transaction: DEBUG
    org.hibernate.SQL: DEBUG
    org.hibernate.orm.jdbc.bind: TRACE
```

</details>

### 2. Custom Exception 정의

예상되는 예외사항들을 Custom Exception으로 처리한다.

<details>
<summary>Custom Exception (Kotlin)</summary>

```kotlin
enum class ErrorCode(
    val code: String,
    val message: String
) {
    ERR000("ERR000", "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."),
    ERR001("ERR001", "잘못된 요청입니다."),
    ERR002("ERR002", "상품을 찾을 수 없습니다.")
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
    ERR000("ERR000", "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."),
    ERR001("ERR001", "잘못된 요청입니다."),
    ERR002("ERR002", "상품을 찾을 수 없습니다.");

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

`@RestControllerAdvice`에서 Custom Exception을 처리한다.

<details>
<summary>GlobalExceptionHandler (Kotlin)</summary>

```kotlin
@RestControllerAdvice
class GlobalExceptionHandler {

    @ExceptionHandler(CommonException::class)
    fun handleCommonException(e: CommonException): ResponseEntity<CommonResponse<Unit>> {
        val response = CommonResponse.error<Unit>(
            e.errorCode.code,
            e.errorCode.message
        )
        return ResponseEntity(response, e.statusCode)
    }

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

    @ExceptionHandler(Exception::class)
    fun handleException(e: Exception): ResponseEntity<CommonResponse<Unit>> {
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
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(CommonException.class)
    public ResponseEntity<CommonResponse<Void>> handleCommonException(CommonException e) {
        CommonResponse<Void> response = CommonResponse.error(
            e.getErrorCode().getCode(),
            e.getErrorCode().getMessage()
        );
        return ResponseEntity.status(e.getStatusCode()).body(response);
    }

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

    @ExceptionHandler(Exception.class)
    public ResponseEntity<CommonResponse<Void>> handleException(Exception e) {
        CommonResponse<Void> response = CommonResponse.error(
            ErrorCode.ERR000.getCode(),
            ErrorCode.ERR000.getMessage()
        );
        return ResponseEntity.internalServerError().body(response);
    }
}
```

</details>

### 4. Nullable 처리

- Kotlin: `?:` (Elvis operator)와 nullable 활용
- Java: `Optional`과 `orElseThrow()` 활용

<details>
<summary>Service 조회 (Kotlin)</summary>

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
<summary>Service 조회 (Java)</summary>

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

### 5. Service 작성 원칙

- Domain Model을 직접 반환하지 않고 응답 전용 DTO로 변환
- 반복 로직은 Stream을 활용하되 가독성 유지

<details>
<summary>Service (Kotlin)</summary>

```kotlin
@Service
@Transactional(readOnly = true)
class ProductService(
    private val productRepository: ProductRepository
) {
    @Transactional
    fun modifyProduct(productId: Long, request: ModifyProductRequest): Long {
        val product = productRepository.findById(productId)
            ?: throw NotFoundException()

        product.update(
            name = request.name,
            category = request.category
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
    public Long modifyProduct(Long productId, ModifyProductRequest request) {
        Product product = productRepository.findById(productId)
            .orElseThrow(NotFoundException::new);

        product.update(request.name(), request.category());

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

### 1. 기본 원칙

- **Nullable 처리**: Java는 Optional, Kotlin은 Nullable
- **단순 조회**: JPA Query Method 활용
- **복잡한 조회**: Querydsl 활용
- **Querydsl 사용 시**: `@Transactional` 명시

### 2. 페이징 처리

`PageableExecutionUtils.getPage()`를 사용하면 마지막 페이지일 경우 count 쿼리를 생략하여 성능상 이점이 있다.

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

### 1. 설계 원칙

- **Setter 대신 비즈니스 메서드**: `updateName()`, `activate()` 등
- **기본 생성자는 protected**: JPA 스펙 만족 + 무분별한 객체 생성 방지
- **연관 Entity 분리**: 하위 Entity가 필요하면 분리
- **고정 값**: Enum 활용

### 2. BaseEntity

생성일시, 수정일시 등 공통 영역은 BaseEntity로 분리한다.

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

### 3. Entity 작성

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

## 정리

### 레이어별 체크리스트

| 레이어 | 체크 포인트 |
|--------|------------|
| **Controller** | HTTP Method 매핑, URI 설계, Validation, 공통 응답 |
| **Service** | 트랜잭션 처리, 예외 처리, DTO 변환 |
| **Repository** | Nullable 처리, 페이징, Querydsl 활용 |
| **Domain** | 비즈니스 메서드, BaseEntity, protected 생성자 |

### Quick Checklist

- [ ] CRUD와 HTTP Method가 올바르게 매핑되어 있는가?
- [ ] URI가 자원을 명확하게 표현하는가?
- [ ] DTO에 Validation이 적용되어 있는가?
- [ ] 조회 트랜잭션에 `readOnly = true`가 설정되어 있는가?
- [ ] 예외 처리가 GlobalExceptionHandler에서 일관되게 처리되는가?
- [ ] Entity에 setter 대신 비즈니스 메서드가 있는가?

---

다음 편에서는 **Database Configuration**과 **Test 환경**에 대해 다룹니다.

👉 [Spring Boot Pre-interview Task Guide 2](/blog/spring-boot-pre-interview-guide-2)
