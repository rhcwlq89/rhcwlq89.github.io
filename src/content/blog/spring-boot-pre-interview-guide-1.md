---
title: "스프링 사전과제 가이드 1편: Core Application Layer"
description: "REST API, Service, Repository, Domain 계층의 핵심 구현 가이드"
pubDate: 2026-01-09T10:00:00+09:00
tags: ["Spring Boot", "REST API", "Backend", "사전과제", "JPA"]
heroImage: "../../assets/PreinterviewTaskGuide.png"
---

## 시리즈 네비게이션

| 이전 | 현재 | 다음 |
|:---:|:---:|:---:|
| - | **1편: Core Layer** | [2편: DB & Testing](/blog/spring-boot-pre-interview-guide-2) |

> 📚 **전체 로드맵**: [스프링 사전과제 가이드 로드맵](/blog/spring-boot-pre-interview-guide-1) 참고

---

## 서론

이 시리즈는 Spring Boot 기반 사전과제를 여러 번 제출하고 리뷰하는 과정에서 반복적으로 언급된 포인트들을 정리한 가이드다.

**1편에서 다루는 내용:**
- REST API 설계 (Presentation Layer)
- 비즈니스 로직 분리 (Service Layer)
- 데이터 접근 (Repository Layer)
- 도메인 설계 (Entity Layer)
- 전역 예외 처리

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

<details>
<summary>💬 PUT vs PATCH 논쟁</summary>

**REST 원칙상 구분**
- `PUT`: 리소스 전체를 대체 (멱등성 보장)
- `PATCH`: 리소스 일부만 수정

**실무에서의 현실**

대부분의 실무 프로젝트에서는 **PATCH만 사용** 하거나 **PUT만 사용** 하는 경우가 많다.

- **PATCH만 사용하는 경우**: 대부분의 수정이 부분 수정이고, 전체 교체가 필요한 경우가 거의 없음
- **PUT만 사용하는 경우**: 팀 내 컨벤션이 PUT으로 통일되어 있거나, 프론트엔드에서 항상 전체 데이터를 전송

**과제에서의 권장**

과제에서는 **둘 중 하나로 통일** 하되, README에 선택 이유를 명시하면 좋다. 두 방식을 혼용하면서 명확한 기준이 없으면 오히려 감점 요인이 될 수 있다.

</details>

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
<summary>💬 공통 응답 클래스, 꼭 필요한가?</summary>

**찬성 의견**
- 클라이언트가 응답 형식을 예측할 수 있어 파싱이 쉬움
- 에러 코드를 통해 비즈니스 에러를 세분화할 수 있음
- 프론트엔드와의 협업 시 일관된 인터페이스 제공

**반대 의견**
- HTTP Status Code만으로 충분히 에러를 구분할 수 있음
- 불필요한 래핑으로 응답 크기가 증가
- REST 원칙에 따르면 HTTP Status가 응답의 성공/실패를 나타내야 함

**실무 팁**

대부분의 국내 기업에서는 공통 응답 클래스를 사용한다. 특히 레거시 시스템이나 다양한 클라이언트(웹, 앱, 외부 연동)를 지원해야 하는 경우 유용하다.

**과제에서는** 요구사항에 명시되어 있지 않다면, 공통 응답 클래스를 사용하는 것이 안전하다. 단, HTTP Status도 함께 적절히 설정해야 한다 (예: 201 Created, 404 Not Found).

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

- `@Valid`, `@NotBlank`, `@Size`, `@NotNull` 등 활용
- 중첩된 DTO도 `@Valid` 처리
- ExceptionHandler에서 Validation 예외 처리
- **Request DTO는 Controller에서만 사용하고, Service에는 Command 객체로 변환하여 전달**

> **Tip**: Request DTO를 직접 Service로 전달하면 Presentation Layer와 Business Layer 간의 결합도가 높아진다.
> Command 객체를 사용하면 레이어 간 책임이 명확히 분리되고, Service 테스트 시 웹 관련 의존성 없이 테스트할 수 있다.

<details>
<summary>💬 Command 패턴, 과연 항상 필요한가?</summary>

**찬성 의견**
- 레이어 간 의존성이 명확히 분리됨
- Service 테스트 시 웹 어노테이션 의존성 없음
- Request DTO 변경이 Service에 영향을 주지 않음
- 여러 Controller에서 동일한 Service 메서드를 다른 방식으로 호출 가능

**반대 의견**
- 단순한 CRUD에서는 오버엔지니어링
- 변환 코드가 추가되어 보일러플레이트 증가
- Request와 Command가 거의 동일한 경우가 많음
- 과제처럼 작은 프로젝트에서는 불필요한 복잡성

**실무 팁**

- **대규모 프로젝트**: Command 패턴 권장. 특히 도메인 로직이 복잡하거나, 여러 채널(API, 배치, 메시지 큐)에서 동일한 로직을 호출하는 경우
- **소규모 프로젝트/과제**: Request DTO를 직접 전달해도 무방. 단, 일관성 있게 한 가지 방식으로 통일

**과제에서의 권장**

시간이 충분하다면 Command 패턴을 사용하여 레이어 분리에 대한 이해도를 보여주는 것이 좋다. 하지만 시간이 부족하다면 Request DTO를 직접 사용해도 감점 요인은 아니다.

</details>

<details>
<summary>Request DTO & Command (Kotlin)</summary>

```kotlin
// Request DTO - Controller에서 Validation 용도로 사용
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

// Command - Service Layer에서 사용하는 순수한 데이터 객체
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
// Request DTO - Controller에서 Validation 용도로 사용
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

// Command - Service Layer에서 사용하는 순수한 데이터 객체
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

### 6. Controller 작성

Controller는 비즈니스 로직을 포함하지 않도록 한다. **Request DTO는 Controller에서 Command로 변환 후 Service에 전달한다.**

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

### 1. 트랜잭션 처리

- 조회 트랜잭션은 `readOnly = true`로 분리하여 불필요한 Dirty Checking 방지
- 로깅 설정으로 트랜잭션 동작 확인

<details>
<summary>💬 readOnly = true의 실제 효과</summary>

**동작 원리**
1. **Dirty Checking 비활성화**: 엔티티 변경 감지를 하지 않아 스냅샷 저장 비용 절약
2. **Flush 모드 변경**: `FlushMode.MANUAL`로 설정되어 자동 flush 방지 
3. **DB 힌트 전달**: 일부 DB(MySQL의 경우 Read Replica 라우팅 등)에서 읽기 전용 힌트로 활용

**주의사항**
- `readOnly = true`여도 **트랜잭션은 시작됨** (No Transaction이 아님)
- 엔티티를 수정하면 **예외 없이 무시됨** (조용히 실패할 수 있어 주의)
- OSIV가 켜져 있으면 지연 로딩은 여전히 동작함

**FlushMode 종류**

| 모드 | 설명 | 사용 시점 |
|------|------|----------|
| `AUTO` | 쿼리 실행 전, 커밋 전 자동 flush (기본값) | 일반 트랜잭션 |
| `COMMIT` | 커밋 시에만 flush | 대량 읽기 작업 |
| `MANUAL` | 명시적 `flush()` 호출 시에만 | `readOnly = true` 시 자동 설정 |
| `ALWAYS` | 모든 쿼리 전에 flush | 거의 사용하지 않음 |

**OSIV (Open Session In View)**

OSIV는 영속성 컨텍스트의 생존 범위를 HTTP 요청 전체로 확장하는 설정이다.

```yaml
# Spring Boot 기본값: true
spring:
  jpa:
    open-in-view: true  # OSIV 활성화 (기본값)
```

| OSIV 상태 | 영속성 컨텍스트 범위 | 장점 | 단점 |
|----------|-------------------|------|------|
| `true` (기본) | 요청 시작 ~ 응답 완료 | Controller에서 지연로딩 가능 | DB 커넥션 오래 점유 |
| `false` | 트랜잭션 범위 내 | 커넥션 빠른 반환 | Controller에서 `LazyInitializationException` 발생 가능 |

**권장**: 실무에서는 `open-in-view: false`로 설정하고, 필요한 데이터는 Service 계층에서 미리 로딩하는 것이 좋다.

**실무 팁**

클래스 레벨에 `@Transactional(readOnly = true)`를 선언하고, 쓰기 메서드에만 `@Transactional`을 오버라이드하는 패턴이 일반적이다.

```java
@Service
@Transactional(readOnly = true)  // 기본값: 읽기 전용
public class ProductService {

    public Product findById(Long id) { ... }  // readOnly = true 적용

    @Transactional  // 쓰기 작업: readOnly = false로 오버라이드
    public Long save(Product product) { ... }
}
```

</details>

<details>
<summary>트랜잭션 로깅레벨 설정 (application.yml)</summary>

```yaml
logging:
  level:
    org.springframework.orm.jpa: DEBUG
    org.springframework.transaction: DEBUG
    org.hibernate.SQL: DEBUG
    org.hibernate.orm.jdbc.bind: DEBUG
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

`@RestControllerAdvice`를 사용하여 애플리케이션 전역에서 발생하는 예외를 일관되게 처리한다.

#### 예외 처리 우선순위

Spring은 예외 클래스의 상속 계층을 기준으로 **가장 구체적인 핸들러** 를 먼저 매칭한다.

| 우선순위 | 핸들러 | 처리 대상 |
|:---:|--------|----------|
| 1 | `CommonException.class` | 비즈니스 로직에서 의도적으로 발생시킨 예외 |
| 2 | `MethodArgumentNotValidException.class` | `@Valid` 검증 실패 시 발생하는 예외 |
| 3 | `Exception.class` | 위에서 처리되지 않은 모든 예외 (Fallback) |

#### 핸들러별 역할

**CommonException 핸들러**

서비스 로직에서 명시적으로 던진 예외를 처리한다. `NotFoundException`, `BadRequestException` 등 비즈니스 규칙 위반 시 사용하며, 예외에 정의된 HTTP 상태 코드와 에러 코드를 그대로 응답한다.

**MethodArgumentNotValidException 핸들러**

Controller에서 `@Valid`로 검증 실패 시 발생한다. 어떤 필드가 왜 실패했는지 메시지를 추출하여 클라이언트에게 전달한다.

**Exception 핸들러 (Fallback)**

위 핸들러들에서 처리되지 않은 **모든 예외** 를 잡아내는 최후의 방어선이다.

- **보안**: NPE, DB 연결 오류 등 내부 정보가 담긴 메시지나 스택트레이스를 클라이언트에 노출하지 않는다
- **로깅**: 디버깅을 위해 서버 로그에는 전체 스택트레이스를 기록한다 (이후 로깅에 대해서 추가로 다룰 예정)
- **일관성**: 예상치 못한 에러도 `CommonResponse` 형식으로 응답한다

> **주의**: 이 핸들러가 없으면 Spring 기본 에러 페이지(Whitelabel Error Page)나 스택트레이스가 그대로 노출된다.
> 과제 평가 시 이런 화면이 노출되면 예외 처리 미흡으로 감점될 수 있다.

<details>
<summary>GlobalExceptionHandler (Kotlin)</summary>

```kotlin
@RestControllerAdvice
class GlobalExceptionHandler {

    private val log = LoggerFactory.getLogger(javaClass)

    /**
     * 비즈니스 예외 처리
     * - 서비스에서 의도적으로 발생시킨 예외
     * - 예외에 정의된 HTTP 상태 코드와 에러 코드를 그대로 사용
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
     * Validation 예외 처리
     * - @Valid 검증 실패 시 발생
     * - 실패한 필드명과 메시지를 추출하여 응답
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
     * 예상치 못한 예외 처리 (Fallback)
     * - 위 핸들러에서 잡히지 않은 모든 예외를 처리
     * - 내부 정보 노출 방지를 위해 일반적인 메시지만 응답
     * - 디버깅을 위해 서버 로그에는 전체 스택트레이스 기록
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
     * 비즈니스 예외 처리
     * - 서비스에서 의도적으로 발생시킨 예외
     * - 예외에 정의된 HTTP 상태 코드와 에러 코드를 그대로 사용
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
     * Validation 예외 처리
     * - @Valid 검증 실패 시 발생
     * - 실패한 필드명과 메시지를 추출하여 응답
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
     * 예상치 못한 예외 처리 (Fallback)
     * - 위 핸들러에서 잡히지 않은 모든 예외를 처리
     * - 내부 정보 노출 방지를 위해 일반적인 메시지만 응답
     * - 디버깅을 위해 서버 로그에는 전체 스택트레이스 기록
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
- **Request DTO가 아닌 Command 객체를 파라미터로 받는다**

<details>
<summary>💡 deleteAll() vs deleteAllInBatch() 차이</summary>

**deleteAll()**
- 엔티티를 하나씩 조회 후 삭제 (N+1 쿼리 발생)
- `@PreRemove`, `@PostRemove` 등 JPA 콜백 실행됨
- Cascade 삭제가 동작함

**deleteAllInBatch()**
- 단일 DELETE 쿼리로 일괄 삭제
- JPA 콜백 실행되지 않음
- Cascade 삭제가 동작하지 않음 (FK 제약조건 위반 가능)

**실무 팁**

- 연관 엔티티가 있거나 삭제 콜백이 필요하면 `deleteAll()` 사용
- 대량 삭제가 필요하고 연관관계가 없으면 `deleteAllInBatch()` 사용
- 과제에서는 **`deleteAll()`이 안전한 선택**

</details>

<details>
<summary>💬 Soft Delete vs Hard Delete</summary>

**Hard Delete**
- 데이터를 실제로 삭제
- 구현이 단순하고 직관적
- 저장 공간 절약

**Soft Delete**
- `deleted` 플래그나 `deletedAt` 컬럼으로 논리 삭제
- 데이터 복구 가능, 감사(Audit) 용이
- 조회 시 항상 삭제 여부 조건 필요 (`@Where`, `@SQLRestriction`)

**실무에서의 선택**

대부분의 실무 프로젝트에서는 **Soft Delete** 를 사용한다. 특히:
- 법적으로 데이터 보관이 필요한 경우 (금융, 의료 등)
- 삭제 취소 기능이 필요한 경우
- 삭제된 데이터도 통계/분석에 활용하는 경우

**과제에서의 권장**

요구사항에 명시되지 않았다면 **Hard Delete** 로 구현해도 무방하다. Soft Delete를 구현한다면 조회 로직에서 삭제된 데이터를 필터링하는 것을 잊지 말아야 한다.

```java
// Soft Delete 구현 시 조회 메서드 예시
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

<details>
<summary>💬 Entity에서 Lombok 사용, 괜찮은가?</summary>

**주의가 필요한 어노테이션**

| 어노테이션 | 위험도 | 이유 |
|-----------|:---:|------|
| `@Data` | ⚠️ 높음 | `@EqualsAndHashCode` 포함 - 양방향 연관관계에서 무한 루프 |
| `@EqualsAndHashCode` | ⚠️ 높음 | 연관 엔티티 포함 시 StackOverflow |
| `@ToString` | ⚠️ 중간 | 지연 로딩 프록시 강제 초기화, 무한 루프 |
| `@AllArgsConstructor` | ⚠️ 중간 | 필드 순서 변경 시 버그 발생 가능 |
| `@Setter` | 🔸 낮음 | 의도하지 않은 상태 변경 가능 |
| `@Getter` | ✅ 안전 | 일반적으로 문제없음 |
| `@NoArgsConstructor` | ✅ 안전 | `access = PROTECTED`와 함께 사용 권장 |
| `@Builder` | ✅ 안전 | 단, `@AllArgsConstructor`와 함께 사용 시 주의 |

**@Builder + @AllArgsConstructor 조합 주의**

```java
// ❌ 문제가 될 수 있는 패턴
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

// Builder를 사용하면 AllArgsConstructor가 호출됨
// 필드 순서가 변경되면 값이 잘못 들어갈 수 있음
Product product = Product.builder()
    .name("상품")
    .price(1000)
    .build();
```

```java
// ✅ 권장 패턴 - 생성자에 직접 @Builder 적용
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

생성자에 `@Builder`를 적용하면 필요한 필드만 명시적으로 받을 수 있고, 필드 순서 변경에도 안전하다.

**실무 권장 패턴**

```java
@Entity
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Product {
    // @Setter 사용하지 않음 - 비즈니스 메서드로 상태 변경
    // @ToString - 필요시 연관 엔티티 제외하고 직접 구현
    // @EqualsAndHashCode - ID 기반으로 직접 구현하거나 사용하지 않음
}
```

**과제에서의 권장**

`@Getter`, `@NoArgsConstructor(access = PROTECTED)` 정도만 사용하고, 나머지는 직접 구현하는 것이 안전하다. `@Data`는 절대 사용하지 않는다.

</details>

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
| **Controller** | HTTP Method 매핑, URI 설계, Validation, 공통 응답, Request → Command 변환 |
| **Service** | 트랜잭션 처리, 예외 처리, DTO 변환, Command 객체 사용 |
| **Repository** | Nullable 처리, 페이징, Querydsl 활용 |
| **Domain** | 비즈니스 메서드, BaseEntity, protected 생성자 |

### Quick Checklist

- [ ] CRUD와 HTTP Method가 올바르게 매핑되어 있는가?
- [ ] URI가 자원을 명확하게 표현하는가?
- [ ] DTO에 Validation이 적용되어 있는가?
- [ ] Request DTO를 Command로 변환하여 Service에 전달하는가?
- [ ] 조회 트랜잭션에 `readOnly = true`가 설정되어 있는가?
- [ ] 예외 처리가 GlobalExceptionHandler에서 일관되게 처리되는가?
- [ ] Entity에 setter 대신 비즈니스 메서드가 있는가?

---

다음 편에서는 **Database Configuration** 과 **Test 환경** 에 대해 다룹니다.

👉 [다음: 2편 - Database & Testing](/blog/spring-boot-pre-interview-guide-2)
