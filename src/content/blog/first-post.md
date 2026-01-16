---
title: "Spring Boot Pre-interview Task Guide"
description: "Pre-interview 과제에서 자주 나오는 유형과 체크 포인트 정리"
pubDate: 2026-01-16
tags: ["Spring Boot", "REST API", "Backend", "Interview"]
heroImage: "../../assets/PreinterviewTaskGuide.png"
---

# Spring Boot Pre-interview Task Guide
대부분 과제는 크게 3가지 정도로 나뉘는 것 같다.

1. REST API 구현
2. 코드 리뷰
3. 특정 도메인 비즈니스 로직 구현

1번, 2번 유형은 유의할 점들은 동일하고 3번의 경우만 조금 다르지만, 대체로 인증부 구현, 동시성 이슈 처리, API 연동 정도를 크게 벗어나진 않을 것 같다.

---

## REST API (Controller 또는 Presentation Layer)

### 1. CRUD 와 HttpMethod가 잘 매핑되어 있는지 체크

### 2. URI가 자원의 위치를 명확하게 표현하는지 체크

```text
/* 상품 도메인
 * GET    /products/{productId}  : 상품 단건 조회
 * GET    /products              : 상품 목록 조회
 * POST   /products              : 상품 생성
 * PUT    /products/{productId}  : 상품 수정
 * DELETE /products/{productId}  : 상품 삭제
 */

/* 회원 도메인
 * POST   /auth/signup           : 회원가입
 * POST   /auth/login            : 로그인
 * POST   /auth/logout           : 로그아웃
 * POST   /auth/refresh          : 토큰 재발급(JWT일 경우)
 * GET    /auth/me               : 내정보 조회
 */
```

### 3. @RequestBody, @ModelAttribute, @RequestParam, Pageable 이 정확하게 사용되어있는지 체크

@RequestMapping의 value들은 ApiPaths같은 형태로 처리
API : 웹페이지와 API 의 경로분리
V1 : API의 버전정보

```kotlin
@RestController
@RequestMapping(API + V1 + PRODUCT)
class ProductController(val productService: ProductService) {

    @GetMapping("/{productId}")
    fun findProductDetail(
        @PathVariable productId: Long
    ): CommonResponse<FindProductDetailResponse> {
        return CommonResponse(
            data = productService.findProductDetail(productId)
        )
    }

    @GetMapping
    fun findProducts(
        @Valid @ModelAttribute findProductRequest: FindProductRequest,
        @PageableDefault(page = 0, size = 20) pageable: Pageable,
    ): CommonResponse<PaginationResponse<FindProductResponse>> {
        return CommonResponse(
            data = productService.findProducts(findProductRequest, pageable)
        )
    }

    @PostMapping
    fun registerProduct(
        @Valid @RequestBody registerProductRequest: RegisterProductRequest
    ): CommonResponse<Long> {
        return CommonResponse(
            data = productService.registerProduct(registerProductRequest)
        )
    }

    @PutMapping("/{productId}")
    fun modifyProduct(
        @PathVariable productId: Long,
        @Valid @RequestBody modifyProductRequest: ModifyProductRequest,
    ): CommonResponse<Boolean> {
        return CommonResponse(
            data = productService.modifyProduct(productId, modifyProductRequest)
        )
    }

    @DeleteMapping
    fun deleteProducts(
        @Valid @Size(min = 1) @RequestParam productIds: Set<Long>,
    ): CommonResponse<Boolean> {
        return CommonResponse(
            data = productService.deleteProducts(productIds)
        )
    }

}

object ApiPaths {
    const val API = "/api"
    const val V1 = "/v1"
    const val PRODUCTS = "/products"
}
```

4. DTO 는 Java에서는 record, Kotlin에서는 data class(Nullable 처리 필수) 를 사용하고 @Valid로 검증

```kotlin
data class RegisterProductRequest(
    @field:NotBlank
    @field:Size(max = 10)
    val name: String?,
    @field:Size(min = 1)
    @field:Valid
    val details: List<ProductDetailDto>?,
)

data class ProductDetailDto(
    @field:NotNull
    val type: ProductCategoryType?,
    @field:NotNull
    val name: String?
)

enum class ProductCategoryType {
    FOOD, HOTEL
}
```

```java
public record RegisterProductRequest(
    @NotBlank
    @Size(max = 10)
    String name,
    @Size(min = 1)
    @Valid
    List<ProductDetailDto> details
){}

public record ProductDetailDto(
    @NotNull
    ProductCategoryType type,
    @NotNull
    String name
){}

public enum ProductCategoryType {
    FOOD,
    HOTEL
}
```

5. 공통 응답 클래스를 활용하는지 체크

```kotlin
data class CommonResponse<T>(val code: String = "200", val message: String = "success", val data: T)
```

```java
public record CommonResponse<T>(
        String code,
        String message,
        T data
) {

    public static final String CODE_SUCCESS = "200";
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

    public static <T> CommonResponse<T> error(String code, String message, T data) {
        return new CommonResponse<>(code, message, data);
    }
}
```

Business Logic ( Service 또는 Application Layer )
1. 트랜잭션 처리 확인 ( readonly 옵션 )

```java
@Service
@Transactional
public class ProductService {
  

  @Transactional(readonly = true)
  public FindProductDetailResponse findProductDetail(Long productId) {
  
  }
  
}
```

로깅레벨로 트랜잭션을 확인 가능하다

```yaml
logging:
  level:
    org.springframework.orm.jpa: TRACE
    org.hibernate.sql: DEBUG
    com.querydsl.sql: DEBUG
    org.springframework.transaction: DEBUG
```

2. 예상되는 예외사항들을 Custom Exception으로 처리
```kotlin
open class CommonException(val statusCode: HttpStatusCode) : RuntimeException() {
    var errorCode: ErrorCode = ErrorCode.ERR000
}

open class BadRequestException(errorCode: ErrorCode) : CommonException(HttpStatus.BAD_REQUEST) {
    init {
        this.errorCode = errorCode
    }
}

class InvalidRequestException() : BadRequestException(errorCode = ErrorCode.ERR001)

enum class ErrorCode (
  val code: String,
  val message: String,
) {
  ERR000("ERR000", "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."),
  ERR001("ERR001", "잘못된 요청입니다.")
}
```

RestControllerAdvice에서 활용

```kotlin
@RestControllerAdvice
class GlobalExceptionHandler {

    @ExceptionHandler(CommonException::class)
    fun handleCommonException(e: CommonException): CommonResponse {
        val code = e.errorCode
        return CommonResponse(
            code = code.code,
            message = code.message
        )
        
    }

    @ExceptionHandler(InvalidRequestException::class)
    fun handleValidationException(e: InvalidRequestException): CommonResponse{
        val details = e.bindingResult.fieldErrors.map {
            mapOf(
                "field" to it.field,
                "message" to (it.defaultMessage ?: "Invalid value")
            )
        }

        return CommonResponse(
            code = e.errorCode,
            message = code.message,
            details = details
        )
    }
}
```

3. Optional 객체 처리 + Domain Model을 직접 변환하지 않도록 처리

```kotlin
@Transactional(readonly = true)
fun findProductDetail(productId: Long): FindProductDetailResponse {
    val product = productRepository.findById(productId) 
                        ?: throw NotFoundProductException()
}
```

4. Data를 처리할 때 Stream을 최대한 활용

---

### DB/Query ( Repository 또는 Infrastructure Layer)
1. Nullable 처리 (Java — Optional / Kotlin — Nullable)
2. JPA Query Method를 활용하거나, 활용이 어렵다면 Querydsl로 처리
3. Querydsl 사용시 @Transactional 체크

### Domain (Entity 또는 Domain Layer)
1. 단순 Setter 대신 비즈니스 로직에 맞게 method 만들기
2. enum 활용 또는 연관 Entity 분리
3. 기본생성자는 protected로 설정
