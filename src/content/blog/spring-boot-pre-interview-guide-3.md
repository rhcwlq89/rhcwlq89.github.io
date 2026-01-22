---
title: "Spring Boot Pre-interview Task Guide 3"
description: "Pre-interview 과제에서 자주 나오는 유형과 체크 포인트 정리"
pubDate: 2026-01-22
tags: ["Spring Boot", "Swagger", "OpenAPI", "Logging", "AOP", "Interview"]
heroImage: "../../assets/PreinterviewTaskGuide3.png"
---

## 서론

[1편](/blog/spring-boot-pre-interview-guide-1), [2편](/blog/spring-boot-pre-interview-guide-2)에 이어서 Spring Boot 기반의 Pre-interview 과제에서 체크 포인트를 정리합니다.

3편에서는 **API 문서화(Swagger/OpenAPI)**, **로깅 전략**, **AOP 활용**을 중심으로 설명합니다.

### 목차

- [API 문서화 (SpringDoc/Swagger)](#api-문서화-springdocswagger)
- [로깅 전략](#로깅-전략)
- [AOP 활용](#aop-활용)
- [정리](#정리)

---

## API 문서화 (SpringDoc/Swagger)

과제에서 API 문서화는 필수는 아니지만, 있으면 평가자가 API를 빠르게 파악할 수 있어 좋은 인상을 줄 수 있다.

> **SpringDoc vs Springfox**
> - Springfox는 Spring Boot 2.6+ 호환 이슈로 더 이상 권장되지 않음
> - SpringDoc OpenAPI를 사용하는 것이 현재 표준

### 1. 의존성 추가

<details>
<summary>build.gradle</summary>

```groovy
dependencies {
    implementation 'org.springdoc:springdoc-openapi-starter-webmvc-ui:2.3.0'
}
```

</details>

<details>
<summary>build.gradle.kts</summary>

```kotlin
dependencies {
    implementation("org.springdoc:springdoc-openapi-starter-webmvc-ui:2.3.0")
}
```

</details>

### 2. 기본 설정

<details>
<summary>application.yml</summary>

```yaml
springdoc:
  api-docs:
    path: /api-docs
  swagger-ui:
    path: /swagger-ui.html
    tags-sorter: alpha
    operations-sorter: alpha
  default-consumes-media-type: application/json
  default-produces-media-type: application/json
```

</details>

<details>
<summary>OpenAPI Config (Kotlin)</summary>

```kotlin
@Configuration
class OpenApiConfig {

    @Bean
    fun openAPI(): OpenAPI {
        return OpenAPI()
            .info(
                Info()
                    .title("Product API")
                    .description("상품 관리 API 문서")
                    .version("v1.0.0")
                    .contact(
                        Contact()
                            .name("Developer")
                            .email("dev@example.com")
                    )
            )
            .servers(
                listOf(
                    Server().url("http://localhost:8080").description("Local Server")
                )
            )
    }
}
```

</details>

<details>
<summary>OpenAPI Config (Java)</summary>

```java
@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI openAPI() {
        return new OpenAPI()
            .info(new Info()
                .title("Product API")
                .description("상품 관리 API 문서")
                .version("v1.0.0")
                .contact(new Contact()
                    .name("Developer")
                    .email("dev@example.com")))
            .servers(List.of(
                new Server().url("http://localhost:8080").description("Local Server")
            ));
    }
}
```

</details>

### 3. Controller 문서화

주요 어노테이션:
- `@Tag`: API 그룹 지정
- `@Operation`: API 설명
- `@Parameter`: 파라미터 설명
- `@ApiResponse`: 응답 설명
- `@Schema`: 모델 필드 설명

<details>
<summary>Controller 문서화 (Kotlin)</summary>

```kotlin
@Tag(name = "Product", description = "상품 관리 API")
@RestController
@RequestMapping("/api/v1/products")
class ProductController(
    private val productService: ProductService
) {
    @Operation(
        summary = "상품 상세 조회",
        description = "상품 ID로 상품 상세 정보를 조회합니다."
    )
    @ApiResponses(
        ApiResponse(responseCode = "200", description = "조회 성공"),
        ApiResponse(responseCode = "404", description = "상품을 찾을 수 없음")
    )
    @GetMapping("/{productId}")
    fun findProductDetail(
        @Parameter(description = "상품 ID", example = "1")
        @PathVariable productId: Long
    ): CommonResponse<FindProductDetailResponse> {
        return CommonResponse.success(productService.findProductDetail(productId))
    }

    @Operation(
        summary = "상품 목록 조회",
        description = "조건에 맞는 상품 목록을 페이징하여 조회합니다."
    )
    @GetMapping
    fun findProducts(
        @Parameter(description = "상품명 (부분 일치)")
        @RequestParam(required = false) name: String?,
        @Parameter(description = "활성화 여부")
        @RequestParam(required = false) enabled: Boolean?,
        @ParameterObject pageable: Pageable
    ): CommonResponse<Page<FindProductResponse>> {
        return CommonResponse.success(
            productService.findProducts(name, enabled, pageable)
        )
    }

    @Operation(
        summary = "상품 등록",
        description = "새로운 상품을 등록합니다."
    )
    @ApiResponses(
        ApiResponse(responseCode = "201", description = "등록 성공"),
        ApiResponse(responseCode = "400", description = "잘못된 요청")
    )
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun registerProduct(
        @RequestBody request: RegisterProductRequest
    ): CommonResponse<Long> {
        return CommonResponse.success(productService.registerProduct(request))
    }
}
```

</details>

<details>
<summary>Controller 문서화 (Java)</summary>

```java
@Tag(name = "Product", description = "상품 관리 API")
@RestController
@RequestMapping("/api/v1/products")
@RequiredArgsConstructor
public class ProductController {

    private final ProductService productService;

    @Operation(
        summary = "상품 상세 조회",
        description = "상품 ID로 상품 상세 정보를 조회합니다."
    )
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "404", description = "상품을 찾을 수 없음")
    })
    @GetMapping("/{productId}")
    public CommonResponse<FindProductDetailResponse> findProductDetail(
            @Parameter(description = "상품 ID", example = "1")
            @PathVariable Long productId) {
        return CommonResponse.success(productService.findProductDetail(productId));
    }

    @Operation(
        summary = "상품 목록 조회",
        description = "조건에 맞는 상품 목록을 페이징하여 조회합니다."
    )
    @GetMapping
    public CommonResponse<Page<FindProductResponse>> findProducts(
            @Parameter(description = "상품명 (부분 일치)")
            @RequestParam(required = false) String name,
            @Parameter(description = "활성화 여부")
            @RequestParam(required = false) Boolean enabled,
            @ParameterObject Pageable pageable) {
        return CommonResponse.success(
            productService.findProducts(name, enabled, pageable)
        );
    }

    @Operation(
        summary = "상품 등록",
        description = "새로운 상품을 등록합니다."
    )
    @ApiResponses({
        @ApiResponse(responseCode = "201", description = "등록 성공"),
        @ApiResponse(responseCode = "400", description = "잘못된 요청")
    })
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CommonResponse<Long> registerProduct(
            @RequestBody RegisterProductRequest request) {
        return CommonResponse.success(productService.registerProduct(request));
    }
}
```

</details>

### 4. DTO 문서화

`@Schema` 어노테이션으로 필드 설명을 추가한다.

<details>
<summary>Request DTO (Kotlin)</summary>

```kotlin
@Schema(description = "상품 등록 요청")
data class RegisterProductRequest(
    @field:NotBlank
    @field:Size(max = 100)
    @Schema(description = "상품명", example = "맛있는 사과", maxLength = 100)
    val name: String?,

    @field:NotNull
    @field:Positive
    @Schema(description = "가격", example = "10000", minimum = "1")
    val price: Int?,

    @field:NotNull
    @Schema(description = "카테고리", example = "FOOD")
    val category: ProductCategoryType?
)
```

</details>

<details>
<summary>Request DTO (Java)</summary>

```java
@Schema(description = "상품 등록 요청")
public record RegisterProductRequest(
    @NotBlank
    @Size(max = 100)
    @Schema(description = "상품명", example = "맛있는 사과", maxLength = 100)
    String name,

    @NotNull
    @Positive
    @Schema(description = "가격", example = "10000", minimum = "1")
    Integer price,

    @NotNull
    @Schema(description = "카테고리", example = "FOOD")
    ProductCategoryType category
) {}
```

</details>

<details>
<summary>Response DTO (Kotlin)</summary>

```kotlin
@Schema(description = "상품 상세 응답")
data class FindProductDetailResponse(
    @Schema(description = "상품 ID", example = "1")
    val id: Long,

    @Schema(description = "상품명", example = "맛있는 사과")
    val name: String,

    @Schema(description = "가격", example = "10000")
    val price: Int,

    @Schema(description = "카테고리", example = "FOOD")
    val category: ProductCategoryType,

    @Schema(description = "활성화 여부", example = "true")
    val enabled: Boolean,

    @Schema(description = "생성일시", example = "2024-01-01T10:00:00")
    val createdAt: LocalDateTime
) {
    companion object {
        fun from(product: Product): FindProductDetailResponse {
            return FindProductDetailResponse(
                id = product.id!!,
                name = product.name,
                price = product.price,
                category = product.category,
                enabled = product.enabled,
                createdAt = product.createdAt
            )
        }
    }
}
```

</details>

### 5. 공통 응답 문서화

<details>
<summary>CommonResponse 문서화 (Kotlin)</summary>

```kotlin
@Schema(description = "공통 응답")
data class CommonResponse<T>(
    @Schema(description = "응답 코드", example = "SUC200")
    val code: String = CODE_SUCCESS,

    @Schema(description = "응답 메시지", example = "success")
    val message: String = MSG_SUCCESS,

    @Schema(description = "응답 데이터")
    val data: T? = null
) {
    companion object {
        const val CODE_SUCCESS = "SUC200"
        const val MSG_SUCCESS = "success"

        fun <T> success(data: T? = null): CommonResponse<T> {
            return CommonResponse(CODE_SUCCESS, MSG_SUCCESS, data)
        }

        fun <T> error(code: String, message: String): CommonResponse<T> {
            return CommonResponse(code, message, null)
        }
    }
}
```

</details>

### 6. Security 환경에서의 Swagger 설정

Spring Security 사용 시 Swagger 경로를 허용해야 한다.

<details>
<summary>SecurityConfig (Kotlin)</summary>

```kotlin
@Configuration
@EnableWebSecurity
class SecurityConfig {

    @Bean
    fun securityFilterChain(http: HttpSecurity): SecurityFilterChain {
        return http
            .csrf { it.disable() }
            .authorizeHttpRequests { auth ->
                auth
                    // Swagger UI 허용
                    .requestMatchers(
                        "/swagger-ui/**",
                        "/swagger-ui.html",
                        "/api-docs/**",
                        "/v3/api-docs/**"
                    ).permitAll()
                    // 그 외 요청
                    .anyRequest().authenticated()
            }
            .build()
    }
}
```

</details>

<details>
<summary>JWT 인증 설정이 있는 경우 (Kotlin)</summary>

```kotlin
@Configuration
class OpenApiConfig {

    @Bean
    fun openAPI(): OpenAPI {
        val securityScheme = SecurityScheme()
            .type(SecurityScheme.Type.HTTP)
            .scheme("bearer")
            .bearerFormat("JWT")
            .`in`(SecurityScheme.In.HEADER)
            .name("Authorization")

        val securityRequirement = SecurityRequirement()
            .addList("bearerAuth")

        return OpenAPI()
            .info(
                Info()
                    .title("Product API")
                    .version("v1.0.0")
            )
            .addSecurityItem(securityRequirement)
            .components(
                Components().addSecuritySchemes("bearerAuth", securityScheme)
            )
    }
}
```

</details>

---

## 로깅 전략

과제에서 로깅은 디버깅과 운영 관점에서 중요한 요소다. 적절한 로깅은 코드 품질을 높여준다.

### 1. Logback 기본 설정

Spring Boot는 기본적으로 Logback을 사용한다.

<details>
<summary>application.yml (기본 로깅 설정)</summary>

```yaml
logging:
  level:
    root: INFO
    com.example.app: DEBUG
    org.springframework.web: INFO
    org.hibernate.SQL: DEBUG
    org.hibernate.orm.jdbc.bind: TRACE
  pattern:
    console: "%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n"
```

</details>

<details>
<summary>logback-spring.xml (상세 설정)</summary>

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <!-- 프로파일별 설정 -->
    <springProfile name="local">
        <property name="LOG_LEVEL" value="DEBUG"/>
    </springProfile>
    <springProfile name="prod">
        <property name="LOG_LEVEL" value="INFO"/>
    </springProfile>

    <!-- Console Appender -->
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] [%X{requestId}] %-5level %logger{36} - %msg%n</pattern>
        </encoder>
    </appender>

    <!-- File Appender -->
    <appender name="FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
        <file>logs/application.log</file>
        <rollingPolicy class="ch.qos.logback.core.rolling.TimeBasedRollingPolicy">
            <fileNamePattern>logs/application.%d{yyyy-MM-dd}.%i.log</fileNamePattern>
            <timeBasedFileNamingAndTriggeringPolicy class="ch.qos.logback.core.rolling.SizeAndTimeBasedFNATP">
                <maxFileSize>100MB</maxFileSize>
            </timeBasedFileNamingAndTriggeringPolicy>
            <maxHistory>30</maxHistory>
        </rollingPolicy>
        <encoder>
            <pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] [%X{requestId}] %-5level %logger{36} - %msg%n</pattern>
        </encoder>
    </appender>

    <!-- Root Logger -->
    <root level="${LOG_LEVEL:-INFO}">
        <appender-ref ref="CONSOLE"/>
        <appender-ref ref="FILE"/>
    </root>

    <!-- 패키지별 로그 레벨 -->
    <logger name="com.example.app" level="DEBUG"/>
    <logger name="org.springframework.web" level="INFO"/>
    <logger name="org.hibernate.SQL" level="DEBUG"/>
</configuration>
```

</details>

### 2. MDC (Mapped Diagnostic Context)

MDC를 활용하면 요청별로 고유 ID를 부여하여 로그 추적이 용이해진다.

<details>
<summary>MDC Filter (Kotlin)</summary>

```kotlin
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class MdcFilter : OncePerRequestFilter() {

    companion object {
        const val REQUEST_ID = "requestId"
    }

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain
    ) {
        val requestId = request.getHeader("X-Request-ID")
            ?: UUID.randomUUID().toString().substring(0, 8)

        try {
            MDC.put(REQUEST_ID, requestId)
            response.setHeader("X-Request-ID", requestId)
            filterChain.doFilter(request, response)
        } finally {
            MDC.clear()
        }
    }
}
```

</details>

<details>
<summary>MDC Filter (Java)</summary>

```java
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class MdcFilter extends OncePerRequestFilter {

    public static final String REQUEST_ID = "requestId";

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {

        String requestId = request.getHeader("X-Request-ID");
        if (requestId == null || requestId.isBlank()) {
            requestId = UUID.randomUUID().toString().substring(0, 8);
        }

        try {
            MDC.put(REQUEST_ID, requestId);
            response.setHeader("X-Request-ID", requestId);
            filterChain.doFilter(request, response);
        } finally {
            MDC.clear();
        }
    }
}
```

</details>

### 3. 로깅 레벨 가이드

| 레벨 | 용도 | 예시 |
|------|------|------|
| **ERROR** | 즉시 대응이 필요한 오류 | DB 연결 실패, 외부 API 장애 |
| **WARN** | 잠재적 문제, 대응 필요 | 재시도 발생, 임계치 근접 |
| **INFO** | 주요 비즈니스 이벤트 | 주문 완료, 결제 성공 |
| **DEBUG** | 개발/디버깅용 상세 정보 | 메서드 진입/종료, 파라미터 값 |
| **TRACE** | 매우 상세한 정보 | 루프 내 값 변화 |

<details>
<summary>로깅 예시 (Kotlin)</summary>

```kotlin
@Service
class ProductService(
    private val productRepository: ProductRepository
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @Transactional
    fun registerProduct(request: RegisterProductRequest): Long {
        log.debug("상품 등록 요청: name={}, price={}", request.name, request.price)

        val product = Product(
            name = request.name!!,
            price = request.price!!,
            category = request.category!!
        )

        val saved = productRepository.save(product)
        log.info("상품 등록 완료: productId={}", saved.id)

        return saved.id!!
    }

    fun findProductDetail(productId: Long): FindProductDetailResponse {
        log.debug("상품 조회: productId={}", productId)

        val product = productRepository.findById(productId)
            ?: run {
                log.warn("상품을 찾을 수 없음: productId={}", productId)
                throw NotFoundException()
            }

        return FindProductDetailResponse.from(product)
    }
}
```

</details>

<details>
<summary>로깅 예시 (Java)</summary>

```java
@Slf4j
@Service
@RequiredArgsConstructor
public class ProductService {

    private final ProductRepository productRepository;

    @Transactional
    public Long registerProduct(RegisterProductRequest request) {
        log.debug("상품 등록 요청: name={}, price={}", request.name(), request.price());

        Product product = new Product(
            request.name(),
            request.price(),
            request.category()
        );

        Product saved = productRepository.save(product);
        log.info("상품 등록 완료: productId={}", saved.getId());

        return saved.getId();
    }

    public FindProductDetailResponse findProductDetail(Long productId) {
        log.debug("상품 조회: productId={}", productId);

        Product product = productRepository.findById(productId)
            .orElseThrow(() -> {
                log.warn("상품을 찾을 수 없음: productId={}", productId);
                return new NotFoundException();
            });

        return FindProductDetailResponse.from(product);
    }
}
```

</details>

### 4. 민감 정보 마스킹

로그에 민감 정보가 노출되지 않도록 주의한다.

<details>
<summary>마스킹 유틸리티 (Kotlin)</summary>

```kotlin
object MaskingUtils {

    fun maskEmail(email: String?): String {
        if (email.isNullOrBlank()) return "***"
        val atIndex = email.indexOf('@')
        if (atIndex <= 1) return "***"
        return email.substring(0, 2) + "***" + email.substring(atIndex)
    }

    fun maskPhone(phone: String?): String {
        if (phone.isNullOrBlank() || phone.length < 4) return "***"
        return phone.substring(0, 3) + "****" + phone.takeLast(4)
    }

    fun maskCardNumber(cardNumber: String?): String {
        if (cardNumber.isNullOrBlank() || cardNumber.length < 4) return "***"
        return "*".repeat(cardNumber.length - 4) + cardNumber.takeLast(4)
    }
}
```

</details>

---

## AOP 활용

AOP를 활용하면 횡단 관심사(로깅, 성능 측정 등)를 깔끔하게 분리할 수 있다.

### 1. 의존성 추가

<details>
<summary>build.gradle</summary>

```groovy
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-aop'
}
```

</details>

### 2. 요청/응답 로깅 AOP

<details>
<summary>RequestLoggingAspect (Kotlin)</summary>

```kotlin
@Aspect
@Component
class RequestLoggingAspect {

    private val log = LoggerFactory.getLogger(javaClass)
    private val objectMapper = ObjectMapper().apply {
        registerModule(JavaTimeModule())
        configure(SerializationFeature.FAIL_ON_EMPTY_BEANS, false)
    }

    @Pointcut("within(@org.springframework.web.bind.annotation.RestController *)")
    fun restController() {}

    @Around("restController()")
    fun logAround(joinPoint: ProceedingJoinPoint): Any? {
        val request = (RequestContextHolder.getRequestAttributes() as? ServletRequestAttributes)
            ?.request

        val methodName = joinPoint.signature.name
        val className = joinPoint.target.javaClass.simpleName

        // 요청 로깅
        log.info(
            "[REQUEST] {} {} - {}.{}",
            request?.method,
            request?.requestURI,
            className,
            methodName
        )

        if (log.isDebugEnabled) {
            val args = joinPoint.args
                .filterNotNull()
                .filter { it !is HttpServletRequest && it !is HttpServletResponse }
            if (args.isNotEmpty()) {
                log.debug("[REQUEST BODY] {}", toJson(args))
            }
        }

        val startTime = System.currentTimeMillis()

        return try {
            val result = joinPoint.proceed()
            val duration = System.currentTimeMillis() - startTime

            // 응답 로깅
            log.info(
                "[RESPONSE] {} {} - {}ms",
                request?.method,
                request?.requestURI,
                duration
            )

            if (log.isDebugEnabled && result != null) {
                log.debug("[RESPONSE BODY] {}", toJson(result))
            }

            result
        } catch (e: Exception) {
            val duration = System.currentTimeMillis() - startTime
            log.error(
                "[ERROR] {} {} - {}ms - {}",
                request?.method,
                request?.requestURI,
                duration,
                e.message
            )
            throw e
        }
    }

    private fun toJson(obj: Any): String {
        return try {
            objectMapper.writeValueAsString(obj)
        } catch (e: Exception) {
            obj.toString()
        }
    }
}
```

</details>

<details>
<summary>RequestLoggingAspect (Java)</summary>

```java
@Aspect
@Component
@Slf4j
public class RequestLoggingAspect {

    private final ObjectMapper objectMapper;

    public RequestLoggingAspect() {
        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());
        this.objectMapper.configure(SerializationFeature.FAIL_ON_EMPTY_BEANS, false);
    }

    @Pointcut("within(@org.springframework.web.bind.annotation.RestController *)")
    public void restController() {}

    @Around("restController()")
    public Object logAround(ProceedingJoinPoint joinPoint) throws Throwable {
        HttpServletRequest request = ((ServletRequestAttributes) RequestContextHolder
            .getRequestAttributes()).getRequest();

        String methodName = joinPoint.getSignature().getName();
        String className = joinPoint.getTarget().getClass().getSimpleName();

        // 요청 로깅
        log.info("[REQUEST] {} {} - {}.{}",
            request.getMethod(),
            request.getRequestURI(),
            className,
            methodName);

        if (log.isDebugEnabled()) {
            Object[] args = Arrays.stream(joinPoint.getArgs())
                .filter(Objects::nonNull)
                .filter(arg -> !(arg instanceof HttpServletRequest))
                .filter(arg -> !(arg instanceof HttpServletResponse))
                .toArray();

            if (args.length > 0) {
                log.debug("[REQUEST BODY] {}", toJson(args));
            }
        }

        long startTime = System.currentTimeMillis();

        try {
            Object result = joinPoint.proceed();
            long duration = System.currentTimeMillis() - startTime;

            // 응답 로깅
            log.info("[RESPONSE] {} {} - {}ms",
                request.getMethod(),
                request.getRequestURI(),
                duration);

            if (log.isDebugEnabled() && result != null) {
                log.debug("[RESPONSE BODY] {}", toJson(result));
            }

            return result;
        } catch (Exception e) {
            long duration = System.currentTimeMillis() - startTime;
            log.error("[ERROR] {} {} - {}ms - {}",
                request.getMethod(),
                request.getRequestURI(),
                duration,
                e.getMessage());
            throw e;
        }
    }

    private String toJson(Object obj) {
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (Exception e) {
            return obj.toString();
        }
    }
}
```

</details>

### 3. 실행 시간 측정 AOP

특정 메서드의 실행 시간을 측정하고 싶을 때 사용한다.

<details>
<summary>ExecutionTime 어노테이션 (Kotlin)</summary>

```kotlin
@Target(AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.RUNTIME)
annotation class ExecutionTime
```

</details>

<details>
<summary>ExecutionTimeAspect (Kotlin)</summary>

```kotlin
@Aspect
@Component
class ExecutionTimeAspect {

    private val log = LoggerFactory.getLogger(javaClass)

    @Around("@annotation(com.example.app.common.annotation.ExecutionTime)")
    fun measureExecutionTime(joinPoint: ProceedingJoinPoint): Any? {
        val methodName = joinPoint.signature.name
        val className = joinPoint.target.javaClass.simpleName

        val startTime = System.currentTimeMillis()

        return try {
            joinPoint.proceed()
        } finally {
            val duration = System.currentTimeMillis() - startTime
            log.info("[EXECUTION TIME] {}.{} - {}ms", className, methodName, duration)

            if (duration > 1000) {
                log.warn("[SLOW EXECUTION] {}.{} took {}ms", className, methodName, duration)
            }
        }
    }
}
```

</details>

<details>
<summary>사용 예시 (Kotlin)</summary>

```kotlin
@Service
class ProductService(
    private val productRepository: ProductRepository
) {
    @ExecutionTime
    fun findAllProducts(): List<FindProductResponse> {
        return productRepository.findAll()
            .map { FindProductResponse.from(it) }
    }
}
```

</details>

### 4. 트랜잭션 로깅 AOP

트랜잭션 시작/커밋/롤백을 로깅한다.

<details>
<summary>TransactionLoggingAspect (Kotlin)</summary>

```kotlin
@Aspect
@Component
class TransactionLoggingAspect {

    private val log = LoggerFactory.getLogger(javaClass)

    @Before("@annotation(transactional)")
    fun logTransactionStart(joinPoint: JoinPoint, transactional: Transactional) {
        val methodName = joinPoint.signature.name
        val readOnly = if (transactional.readOnly) "(readOnly)" else ""
        log.debug("[TX START{}] {}", readOnly, methodName)
    }

    @AfterReturning("@annotation(org.springframework.transaction.annotation.Transactional)")
    fun logTransactionCommit(joinPoint: JoinPoint) {
        val methodName = joinPoint.signature.name
        log.debug("[TX COMMIT] {}", methodName)
    }

    @AfterThrowing(
        pointcut = "@annotation(org.springframework.transaction.annotation.Transactional)",
        throwing = "ex"
    )
    fun logTransactionRollback(joinPoint: JoinPoint, ex: Exception) {
        val methodName = joinPoint.signature.name
        log.warn("[TX ROLLBACK] {} - {}", methodName, ex.message)
    }
}
```

</details>

### 5. 재시도 로직 AOP

외부 API 호출 등에서 재시도가 필요한 경우 활용한다.

<details>
<summary>Retry 어노테이션 (Kotlin)</summary>

```kotlin
@Target(AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.RUNTIME)
annotation class Retry(
    val maxAttempts: Int = 3,
    val delay: Long = 1000
)
```

</details>

<details>
<summary>RetryAspect (Kotlin)</summary>

```kotlin
@Aspect
@Component
class RetryAspect {

    private val log = LoggerFactory.getLogger(javaClass)

    @Around("@annotation(retry)")
    fun retry(joinPoint: ProceedingJoinPoint, retry: Retry): Any? {
        val methodName = joinPoint.signature.name
        var lastException: Exception? = null

        repeat(retry.maxAttempts) { attempt ->
            try {
                if (attempt > 0) {
                    log.info("[RETRY] {} - attempt {}/{}", methodName, attempt + 1, retry.maxAttempts)
                }
                return joinPoint.proceed()
            } catch (e: Exception) {
                lastException = e
                log.warn("[RETRY FAILED] {} - attempt {}/{} - {}",
                    methodName, attempt + 1, retry.maxAttempts, e.message)

                if (attempt < retry.maxAttempts - 1) {
                    Thread.sleep(retry.delay)
                }
            }
        }

        log.error("[RETRY EXHAUSTED] {} after {} attempts", methodName, retry.maxAttempts)
        throw lastException!!
    }
}
```

</details>

---

## 정리

### 주요 포인트

| 항목 | 체크 포인트 |
|------|------------|
| **API 문서화** | SpringDoc 설정, 어노테이션 활용, Security 경로 허용 |
| **로깅** | 적절한 로그 레벨, MDC 활용, 민감 정보 마스킹 |
| **AOP** | 요청/응답 로깅, 실행 시간 측정, 횡단 관심사 분리 |

### Quick Checklist

- [ ] Swagger UI가 접속 가능한가? (`/swagger-ui.html`)
- [ ] API 문서에 설명과 예시가 포함되어 있는가?
- [ ] 로그에 요청 ID가 포함되어 추적 가능한가?
- [ ] 민감 정보(비밀번호, 카드번호 등)가 로그에 노출되지 않는가?
- [ ] 적절한 로그 레벨을 사용하고 있는가?
- [ ] 느린 쿼리/메서드를 식별할 수 있는가?

### 파일 구조 예시

```
src/main/kotlin/com/example/app/
├── common/
│   ├── annotation/
│   │   ├── ExecutionTime.kt
│   │   └── Retry.kt
│   ├── aop/
│   │   ├── RequestLoggingAspect.kt
│   │   ├── ExecutionTimeAspect.kt
│   │   └── RetryAspect.kt
│   ├── filter/
│   │   └── MdcFilter.kt
│   └── util/
│       └── MaskingUtils.kt
├── config/
│   ├── OpenApiConfig.kt
│   └── SecurityConfig.kt
└── ...
```

---

다음 편에서는 **인증/인가(Spring Security, JWT)**에 대해 다룰 예정입니다.

👉 [Spring Boot Pre-interview Task Guide 1](/blog/spring-boot-pre-interview-guide-1)
👉 [Spring Boot Pre-interview Task Guide 2](/blog/spring-boot-pre-interview-guide-2)
