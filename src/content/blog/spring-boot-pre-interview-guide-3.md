---
title: "스프링 사전과제 가이드 3편: Documentation & AOP"
description: "Swagger/SpringDoc 기반 API 문서화, SLF4J 로깅 설정, AOP를 활용한 횡단 관심사 분리를 다루는 Spring Boot 사전과제 가이드"
pubDate: 2026-01-13T10:00:00+09:00
tags: ["Spring Boot", "Swagger", "Logging", "AOP", "Backend", "사전과제"]
heroImage: "../../assets/PreinterviewTaskGuide.png"
---

## 시리즈 네비게이션

| 이전 | 현재 | 다음 |
|:---:|:---:|:---:|
| [2편: DB & Testing](/blog/spring-boot-pre-interview-guide-2) | **3편: Documentation & AOP** | [4편: Performance](/blog/spring-boot-pre-interview-guide-4) |

> 📚 **전체 로드맵**: [스프링 사전과제 가이드 로드맵](/blog/spring-boot-pre-interview-guide-1) 참고

---

## 서론

1~2편에서 다룬 핵심 기능 구현 이후, 이번 편에서는 API 문서화와 횡단 관심사를 다룬다.

**3편에서 다루는 내용:**
- API 문서화 (Swagger, REST Docs)
- 로깅 전략 (SLF4J, MDC)
- AOP 활용 (공통 관심사 분리)


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

<details>
<summary>💬 Swagger 문서화, 어느 정도까지 해야 할까?</summary>

**최소한의 문서화 (권장)**
- API 제목, 설명, 버전 정보 (`OpenApiConfig`)
- 주요 API의 `@Operation` (summary 정도)
- 에러 응답 코드 (`@ApiResponse`)

**과도한 문서화 (비권장)**
- 모든 필드에 `@Schema` 상세 설명
- 예시 값 전부 작성
- 모든 에러 케이스 문서화

**실무에서의 현실**

대부분의 프로젝트에서 Swagger 문서화는 **초기에만 열심히** 하고, 이후에는 코드와 동기화가 안 되는 경우가 많다.

**문서 관리가 안 될 때 해결 방법**

| 방법 | 설명 | 효과 |
|------|------|------|
| **Spring REST Docs 전환** | 테스트 기반 문서화 → 테스트 실패 시 문서도 실패 | 코드-문서 동기화 강제 |
| **최소 문서화 원칙** | `@Tag`, `@Operation(summary)` 정도만 유지 | 유지보수 부담 감소 |
| **자동 생성 활용** | SpringDoc이 자동 생성하는 부분에 의존 | 추가 작업 최소화 |
| **CI에서 검증** | OpenAPI spec 변경 시 리뷰 필수 | 의도치 않은 변경 방지 |

**과제에서의 권장**

1. 기본 설정만 해서 Swagger UI가 동작하도록 함
2. 복잡한 API 1~2개에만 상세 문서화
3. 나머지는 기본 자동 생성에 맡김

```kotlin
// ✅ 적절한 수준
@Operation(summary = "상품 등록")
@PostMapping
fun registerProduct(...)

// ❌ 과도한 문서화 (시간 낭비)
@Operation(
    summary = "상품 등록",
    description = "새로운 상품을 등록합니다. 상품명은 100자 이내...",
    responses = [
        ApiResponse(responseCode = "201", description = "...", content = [...]),
        ApiResponse(responseCode = "400", description = "...", content = [...]),
        ApiResponse(responseCode = "500", description = "...", content = [...])
    ]
)
```

</details>

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
    path: /api-docs                          # OpenAPI JSON 스펙 경로 (/api-docs로 접근)
  swagger-ui:
    path: /swagger-ui.html                   # Swagger UI 접근 경로
    tags-sorter: alpha                       # Tag(Controller) 알파벳 순 정렬
    operations-sorter: alpha                 # API 메서드 알파벳 순 정렬 (method: HTTP 메서드 순)
  default-consumes-media-type: application/json   # 요청 기본 Content-Type
  default-produces-media-type: application/json   # 응답 기본 Content-Type
  # packages-to-scan: com.example.api.controller  # 특정 패키지만 스캔 (선택)
  # paths-to-match: /api/**                       # 특정 경로만 문서화 (선택)
```

| 설정 | 설명 | 기본값 |
|------|------|--------|
| `api-docs.path` | OpenAPI JSON 스펙 경로 | `/v3/api-docs` |
| `swagger-ui.path` | Swagger UI 경로 | `/swagger-ui.html` |
| `tags-sorter` | Controller 정렬 (`alpha`, 선언순) | 선언순 |
| `operations-sorter` | API 정렬 (`alpha`, `method`) | 선언순 |

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

> **💡 가격 필드는 BigDecimal 사용을 권장**
>
> 금융/가격 데이터는 `Int`/`Long` 대신 `BigDecimal`을 사용하는 것이 실무 표준이다.
>
> | 타입 | 장점 | 단점 | 권장 상황 |
> |------|------|------|----------|
> | `Int`/`Long` | 단순, 성능 우수 | 소수점 불가, 오버플로우 위험 | 단순 개수, ID |
> | `BigDecimal` | 정밀도 보장, 소수점 처리 | 연산 복잡 | 금액, 가격, 비율 |
>
> ```kotlin
> // Int 사용 시 (간단한 과제용)
> @field:Positive
> @Schema(description = "가격", example = "10000")
> val price: Int?
>
> // BigDecimal 사용 시 (실무 권장)
> @field:DecimalMin(value = "0", inclusive = false)
> @Schema(description = "가격", example = "10000.00")
> val price: BigDecimal?
> ```

```kotlin
@Schema(description = "상품 등록 요청")
data class RegisterProductRequest(
    @field:NotBlank
    @field:Size(max = 100)
    @Schema(description = "상품명", example = "맛있는 사과", maxLength = 100)
    val name: String?,

    @field:NotNull
    @field:DecimalMin(value = "0", inclusive = false)
    @Schema(description = "가격", example = "10000.00", minimum = "0.01")
    val price: BigDecimal?,

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

### 7. Spring REST Docs (대안)

Swagger 대신 **테스트 기반** 으로 API 문서를 생성하는 방식이다. 테스트가 통과해야만 문서가 생성되므로 **문서와 코드의 동기화가 보장** 된다.

<details>
<summary>💬 Swagger vs REST Docs</summary>

| 비교 항목 | Swagger (SpringDoc) | REST Docs |
|----------|---------------------|-----------|
| **문서 생성 방식** | 어노테이션 기반 | 테스트 기반 |
| **문서-코드 동기화** | 수동 관리 필요 | 테스트 통과 시 자동 보장 |
| **런타임 의존성** | 있음 (운영 배포 시 포함) | 없음 (빌드 시에만 사용) |
| **Try it out 기능** | ✅ 기본 제공 | ❌ 별도 구현 필요 |
| **학습 곡선** | 낮음 | 높음 |
| **프로덕션 코드 침투** | 어노테이션 추가 필요 | 없음 (테스트 코드에만 존재) |

**Swagger가 적합한 경우**
- 빠른 프로토타이핑
- Try it out 기능이 필요한 경우
- 프론트엔드 협업이 많은 경우

**REST Docs가 적합한 경우**
- 문서 정확성이 중요한 경우 (금융, 공공 API 등)
- 프로덕션 코드를 깔끔하게 유지하고 싶은 경우
- 테스트 커버리지가 높은 프로젝트

**과제에서는** Swagger가 더 적합하다. 설정이 간단하고 Try it out 기능으로 평가자가 바로 테스트할 수 있기 때문이다.

</details>

<details>
<summary>의존성 추가 (build.gradle)</summary>

```groovy
plugins {
    id 'org.asciidoctor.jvm.convert' version '3.3.2'
}

configurations {
    asciidoctorExt
}

dependencies {
    asciidoctorExt 'org.springframework.restdocs:spring-restdocs-asciidoctor'
    testImplementation 'org.springframework.restdocs:spring-restdocs-mockmvc'
}

ext {
    snippetsDir = file('build/generated-snippets')
}

test {
    outputs.dir snippetsDir
}

asciidoctor {
    inputs.dir snippetsDir
    configurations 'asciidoctorExt'
    dependsOn test
}

// 생성된 문서를 static 폴더로 복사
tasks.register('copyDocument', Copy) {
    dependsOn asciidoctor
    from file("build/docs/asciidoc")
    into file("src/main/resources/static/docs")
}

build {
    dependsOn copyDocument
}
```

</details>

<details>
<summary>의존성 추가 (build.gradle.kts)</summary>

```kotlin
plugins {
    id("org.asciidoctor.jvm.convert") version "3.3.2"
}

val asciidoctorExt: Configuration by configurations.creating
val snippetsDir by extra { file("build/generated-snippets") }

dependencies {
    asciidoctorExt("org.springframework.restdocs:spring-restdocs-asciidoctor")
    testImplementation("org.springframework.restdocs:spring-restdocs-mockmvc")
}

tasks.test {
    outputs.dir(snippetsDir)
}

tasks.asciidoctor {
    inputs.dir(snippetsDir)
    configurations(asciidoctorExt.name)
    dependsOn(tasks.test)
}

tasks.register<Copy>("copyDocument") {
    dependsOn(tasks.asciidoctor)
    from(file("build/docs/asciidoc"))
    into(file("src/main/resources/static/docs"))
}

tasks.build {
    dependsOn("copyDocument")
}
```

</details>

<details>
<summary>테스트 코드 (Java)</summary>

```java
@WebMvcTest(ProductController.class)
@AutoConfigureRestDocs  // REST Docs 자동 설정
class ProductControllerDocsTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ProductService productService;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    @DisplayName("상품 상세 조회 API")
    void findProductDetail() throws Exception {
        // given
        FindProductDetailResponse response = new FindProductDetailResponse(
            1L, "맛있는 사과", 10000, ProductCategoryType.FOOD, true, LocalDateTime.now()
        );
        given(productService.findProductDetail(1L)).willReturn(response);

        // when & then
        mockMvc.perform(get("/api/v1/products/{productId}", 1L)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andDo(document("product-detail",  // 문서 식별자
                pathParameters(
                    parameterWithName("productId").description("상품 ID")
                ),
                responseFields(
                    fieldWithPath("code").description("응답 코드"),
                    fieldWithPath("message").description("응답 메시지"),
                    fieldWithPath("data.id").description("상품 ID"),
                    fieldWithPath("data.name").description("상품명"),
                    fieldWithPath("data.price").description("가격"),
                    fieldWithPath("data.category").description("카테고리"),
                    fieldWithPath("data.enabled").description("활성화 여부"),
                    fieldWithPath("data.createdAt").description("생성일시")
                )
            ));
    }

    @Test
    @DisplayName("상품 등록 API")
    void registerProduct() throws Exception {
        // given
        RegisterProductRequest request = new RegisterProductRequest(
            "맛있는 사과", 10000, ProductCategoryType.FOOD
        );
        given(productService.registerProduct(any())).willReturn(1L);

        // when & then
        mockMvc.perform(post("/api/v1/products")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isCreated())
            .andDo(document("product-create",
                requestFields(
                    fieldWithPath("name").description("상품명"),
                    fieldWithPath("price").description("가격"),
                    fieldWithPath("category").description("카테고리 (FOOD, HOTEL)")
                ),
                responseFields(
                    fieldWithPath("code").description("응답 코드"),
                    fieldWithPath("message").description("응답 메시지"),
                    fieldWithPath("data").description("생성된 상품 ID")
                )
            ));
    }
}
```

</details>

<details>
<summary>테스트 코드 (Kotlin - JUnit 스타일)</summary>

```kotlin
@WebMvcTest(ProductController::class)
@AutoConfigureRestDocs
class ProductControllerDocsTest {

    @Autowired
    private lateinit var mockMvc: MockMvc

    @MockkBean
    private lateinit var productService: ProductService

    @Autowired
    private lateinit var objectMapper: ObjectMapper

    @Test
    @DisplayName("상품 상세 조회 API")
    fun findProductDetail() {
        // given
        val response = FindProductDetailResponse(
            id = 1L,
            name = "맛있는 사과",
            price = 10000,
            category = ProductCategoryType.FOOD,
            enabled = true,
            createdAt = LocalDateTime.now()
        )
        every { productService.findProductDetail(1L) } returns response

        // when & then
        mockMvc.perform(
            get("/api/v1/products/{productId}", 1L)
                .accept(MediaType.APPLICATION_JSON)
        )
            .andExpect(status().isOk)
            .andDo(
                document(
                    "product-detail",
                    pathParameters(
                        parameterWithName("productId").description("상품 ID")
                    ),
                    responseFields(
                        fieldWithPath("code").description("응답 코드"),
                        fieldWithPath("message").description("응답 메시지"),
                        fieldWithPath("data.id").description("상품 ID"),
                        fieldWithPath("data.name").description("상품명"),
                        fieldWithPath("data.price").description("가격"),
                        fieldWithPath("data.category").description("카테고리"),
                        fieldWithPath("data.enabled").description("활성화 여부"),
                        fieldWithPath("data.createdAt").description("생성일시")
                    )
                )
            )
    }

    @Test
    @DisplayName("상품 등록 API")
    fun registerProduct() {
        // given
        val request = RegisterProductRequest(
            name = "맛있는 사과",
            price = 10000,
            category = ProductCategoryType.FOOD
        )
        every { productService.registerProduct(any()) } returns 1L

        // when & then
        mockMvc.perform(
            post("/api/v1/products")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request))
        )
            .andExpect(status().isCreated)
            .andDo(
                document(
                    "product-create",
                    requestFields(
                        fieldWithPath("name").description("상품명"),
                        fieldWithPath("price").description("가격"),
                        fieldWithPath("category").description("카테고리 (FOOD, HOTEL)")
                    ),
                    responseFields(
                        fieldWithPath("code").description("응답 코드"),
                        fieldWithPath("message").description("응답 메시지"),
                        fieldWithPath("data").description("생성된 상품 ID")
                    )
                )
            )
    }
}
```

</details>

<details>
<summary>테스트 코드 (Kotlin - Kotest DescribeSpec 스타일)</summary>

> **Kotest란?** Kotlin 전용 테스트 프레임워크로, BDD 스타일의 `DescribeSpec`을 제공한다. 테스트 구조가 명확하고 가독성이 좋다.

```kotlin
// build.gradle.kts에 의존성 추가
// testImplementation("io.kotest:kotest-runner-junit5:5.8.0")
// testImplementation("io.kotest.extensions:kotest-extensions-spring:1.1.3")

@WebMvcTest(ProductController::class)
@AutoConfigureRestDocs
class ProductControllerDocsTest : DescribeSpec() {

    @Autowired
    private lateinit var mockMvc: MockMvc

    @MockkBean
    private lateinit var productService: ProductService

    @Autowired
    private lateinit var objectMapper: ObjectMapper

    init {
        describe("상품 API") {
            context("상품 상세 조회 시") {
                it("상품 정보를 반환한다") {
                    // given
                    val response = FindProductDetailResponse(
                        id = 1L,
                        name = "맛있는 사과",
                        price = 10000,
                        category = ProductCategoryType.FOOD,
                        enabled = true,
                        createdAt = LocalDateTime.now()
                    )
                    every { productService.findProductDetail(1L) } returns response

                    // when & then
                    mockMvc.perform(
                        get("/api/v1/products/{productId}", 1L)
                            .accept(MediaType.APPLICATION_JSON)
                    )
                        .andExpect(status().isOk)
                        .andDo(
                            document(
                                "product-detail",
                                pathParameters(
                                    parameterWithName("productId").description("상품 ID")
                                ),
                                responseFields(
                                    fieldWithPath("code").description("응답 코드"),
                                    fieldWithPath("message").description("응답 메시지"),
                                    fieldWithPath("data.id").description("상품 ID"),
                                    fieldWithPath("data.name").description("상품명"),
                                    fieldWithPath("data.price").description("가격"),
                                    fieldWithPath("data.category").description("카테고리"),
                                    fieldWithPath("data.enabled").description("활성화 여부"),
                                    fieldWithPath("data.createdAt").description("생성일시")
                                )
                            )
                        )
                }
            }

            context("상품 등록 시") {
                it("생성된 상품 ID를 반환한다") {
                    // given
                    val request = RegisterProductRequest(
                        name = "맛있는 사과",
                        price = 10000,
                        category = ProductCategoryType.FOOD
                    )
                    every { productService.registerProduct(any()) } returns 1L

                    // when & then
                    mockMvc.perform(
                        post("/api/v1/products")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(request))
                    )
                        .andExpect(status().isCreated)
                        .andDo(
                            document(
                                "product-create",
                                requestFields(
                                    fieldWithPath("name").description("상품명"),
                                    fieldWithPath("price").description("가격"),
                                    fieldWithPath("category").description("카테고리 (FOOD, HOTEL)")
                                ),
                                responseFields(
                                    fieldWithPath("code").description("응답 코드"),
                                    fieldWithPath("message").description("응답 메시지"),
                                    fieldWithPath("data").description("생성된 상품 ID")
                                )
                            )
                        )
                }
            }
        }
    }
}
```

</details>

<details>
<summary>AsciiDoc 템플릿 (src/docs/asciidoc/index.adoc)</summary>

```asciidoc
= Product API 문서
:doctype: book
:icons: font
:source-highlighter: highlightjs
:toc: left
:toclevels: 2
:sectlinks:

[[overview]]
== 개요

상품 관리 API 문서입니다.

[[Product-API]]
== 상품 API

[[Product-상세조회]]
=== 상품 상세 조회

operation::product-detail[snippets='path-parameters,response-fields,curl-request,http-response']

[[Product-등록]]
=== 상품 등록

operation::product-create[snippets='request-fields,response-fields,curl-request,http-response']
```

</details>

<details>
<summary>💡 REST Docs 실무 팁</summary>

**테스트 추상화로 중복 제거**

```java
// 공통 설정을 상속받아 사용
@Import(RestDocsConfig.class)
public abstract class RestDocsTestSupport {
    @Autowired
    protected MockMvc mockMvc;

    @Autowired
    protected ObjectMapper objectMapper;
}

@TestConfiguration
public class RestDocsConfig {
    @Bean
    public RestDocumentationResultHandler restDocs() {
        return MockMvcRestDocumentation.document(
            "{class-name}/{method-name}",  // 자동 명명
            Preprocessors.preprocessRequest(Preprocessors.prettyPrint()),
            Preprocessors.preprocessResponse(Preprocessors.prettyPrint())
        );
    }
}
```

**필드 제약조건 문서화**

```java
// Validation 어노테이션 정보를 문서에 포함
requestFields(
    fieldWithPath("name")
        .description("상품명")
        .attributes(key("constraints").value("필수, 최대 100자")),
    fieldWithPath("price")
        .description("가격")
        .attributes(key("constraints").value("필수, 양수"))
)
```

**에러 응답 문서화**

```java
@Test
void findProductDetail_notFound() throws Exception {
    given(productService.findProductDetail(999L))
        .willThrow(new NotFoundException());

    mockMvc.perform(get("/api/v1/products/{productId}", 999L))
        .andExpect(status().isNotFound())
        .andDo(document("product-detail-error",
            responseFields(
                fieldWithPath("code").description("에러 코드"),
                fieldWithPath("message").description("에러 메시지"),
                fieldWithPath("data").description("null")
            )
        ));
}
```

</details>

---

## 로깅 전략

과제에서 로깅은 디버깅과 운영 관점에서 중요한 요소다. 적절한 로깅은 코드 품질을 높여준다.

<details>
<summary>💡 로깅 성능에 대한 오해와 진실</summary>

**자주 하는 실수**

```java
// ❌ 비효율적 - DEBUG 레벨이 꺼져 있어도 문자열 연결이 실행됨
log.debug("User " + userId + " requested " + itemCount + " items");

// ✅ 효율적 - DEBUG 레벨이 꺼져 있으면 문자열 연결 안 함
log.debug("User {} requested {} items", userId, itemCount);
```

**isDebugEnabled() 체크가 필요한 경우**

```java
// 단순 변수 대입은 체크 불필요
log.debug("User {} logged in", userId);

// 복잡한 연산이 포함된 경우에만 체크
if (log.isDebugEnabled()) {
    log.debug("Request details: {}", expensiveJsonSerialization(request));
}
```

**실무 팁**

- 대부분의 경우 `{}` 플레이스홀더로 충분
- `toString()`이 비용이 큰 객체만 `isDebugEnabled()` 체크
- 루프 안에서의 로깅은 레벨 체크 권장

</details>

<details>
<summary>💬 MDC vs 분산 추적 시스템</summary>

**MDC (Mapped Diagnostic Context)**
- 단일 애플리케이션 내에서 요청 추적
- 직접 구현 필요
- 마이크로서비스 간 추적은 어려움

**분산 추적 시스템 (Zipkin, Jaeger, AWS X-Ray 등)**
- 여러 서비스에 걸친 요청 추적
- 시각적 대시보드 제공
- 설정 및 인프라 필요

**선택 기준**

| 상황 | 권장 |
|-----|-----|
| 단일 애플리케이션, 과제 | MDC |
| 마이크로서비스 | 분산 추적 시스템 |
| 빠른 구현이 필요한 경우 | MDC |

**과제에서는** MDC 정도면 충분하다. 분산 추적 시스템은 인프라 설정이 필요하므로 과제 범위를 벗어나는 경우가 많다.

</details>

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

<details>
<summary>마스킹 유틸리티 사용 예제</summary>

```kotlin
@Service
@RequiredArgsConstructor
class MemberService(
    private val memberRepository: MemberRepository
) {
    private val log = LoggerFactory.getLogger(javaClass)

    fun findMemberDetail(memberId: Long): MemberDetailResponse {
        val member = memberRepository.findById(memberId)
            .orElseThrow { NotFoundException("회원을 찾을 수 없습니다") }

        // 로그에는 마스킹된 정보만 출력
        log.info(
            "회원 조회 완료: memberId={}, email={}, phone={}",
            member.id,
            MaskingUtils.maskEmail(member.email),    // ho***@example.com
            MaskingUtils.maskPhone(member.phone)     // 010****1234
        )

        return MemberDetailResponse.from(member)
    }

    fun processPayment(memberId: Long, cardNumber: String, amount: Int) {
        // 결제 처리 전 로그
        log.info(
            "결제 요청: memberId={}, card={}, amount={}",
            memberId,
            MaskingUtils.maskCardNumber(cardNumber),  // ************1234
            amount
        )

        // 결제 처리 로직...
    }
}
```

**실무 팁**: 마스킹은 **로그 출력 시점** 에만 적용하고, 실제 비즈니스 로직에서는 원본 데이터를 사용해야 한다. 마스킹된 데이터로 비교나 처리를 하면 안 된다.

</details>

---

## AOP 활용

AOP를 활용하면 횡단 관심사(로깅, 성능 측정 등)를 깔끔하게 분리할 수 있다.

<details>
<summary>⚠️ AOP 남용 주의</summary>

**AOP가 적합한 경우**
- 로깅, 모니터링
- 트랜잭션 관리
- 보안/권한 체크
- 캐싱

**AOP가 부적합한 경우**
- 비즈니스 로직 구현
- 복잡한 조건 분기
- 특정 메서드에만 적용되는 로직

**주의사항**

1. **디버깅 어려움**: AOP로 처리되는 로직은 코드에서 직접 보이지 않아 디버깅이 어려움
2. **성능 오버헤드**: 모든 메서드에 Aspect를 적용하면 성능 저하 가능
3. **순서 문제**: 여러 Aspect가 있을 때 실행 순서 관리 필요 (`@Order`)
4. **self-invocation 문제**: 같은 클래스 내 메서드 호출 시 AOP 적용 안 됨

```java
@Service
public class ProductService {

    public void methodA() {
        methodB();  // ❌ AOP 적용 안 됨 (self-invocation)
    }

    @ExecutionTime
    public void methodB() { ... }
}
```

**과제에서의 권장**

- 요청/응답 로깅 AOP 정도는 좋은 인상을 줄 수 있음
- 너무 많은 AOP는 오히려 복잡성 증가
- AOP를 사용했다면 README에 설명 추가

</details>

<details>
<summary>💬 AOP vs Filter vs Interceptor</summary>

| 구분 | 적용 범위 | 실행 시점 | 사용 예시 |
|-----|----------|----------|----------|
| **Filter** | 서블릿 | DispatcherServlet 전/후 | 인코딩, CORS, 인증 |
| **Interceptor** | Spring MVC | Controller 전/후 | 인증, 로깅, 권한 |
| **AOP** | Spring Bean | 메서드 실행 전/후 | 트랜잭션, 로깅, 캐싱 |

**선택 가이드**

- **HTTP 요청/응답 자체를 다룬다면**: Filter
- **Controller 진입 전/후 처리**: Interceptor
- **Service/Repository 등 비즈니스 로직**: AOP

**과제에서는** 대부분 AOP나 Interceptor 중 하나만 사용해도 충분하다. 세 가지를 모두 사용할 필요는 없다.

</details>

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

### 핵심 포인트

| 항목 | 체크 포인트 |
|------|------------|
| **API 문서화** | SpringDoc 설정, 어노테이션 활용, Security 경로 허용 |
| **로깅** | 적절한 로그 레벨, MDC 활용, 민감 정보 마스킹 |
| **AOP** | 요청/응답 로깅, 실행 시간 측정, 횡단 관심사 분리 |

### 체크리스트

- [ ] Swagger UI가 접속 가능한가? (`/swagger-ui.html`)
- [ ] API 문서에 설명과 예시가 포함되어 있는가?
- [ ] 로그에 요청 ID가 포함되어 추적 가능한가?
- [ ] 민감 정보(비밀번호, 카드번호 등)가 로그에 노출되지 않는가?
- [ ] 적절한 로그 레벨을 사용하고 있는가?
- [ ] 느린 쿼리/메서드를 식별할 수 있는가?

<details>
<summary>💡 과제에서 플러스 알파가 되는 요소들</summary>

**가점 요소 (시간이 남으면)**

| 항목 | 효과 | 난이도 |
|-----|-----|:---:|
| Swagger UI 접속 가능 | 평가자가 바로 테스트 가능 | ⭐ |
| 요청 ID 로깅 (MDC) | 로그 추적 용이 | ⭐⭐ |
| 실행 시간 로깅 AOP | 성능 관심 어필 | ⭐⭐ |
| API 버저닝 (`/v1/`) | 확장성 고려 | ⭐ |
| Profile 분리 (local/test) | 환경 관리 역량 | ⭐ |

**시간이 부족할 때 우선순위**

1. **핵심 기능 완성** - 동작하는 코드가 최우선
2. **테스트 코드** - 주요 로직 1~2개라도
3. **예외 처리** - GlobalExceptionHandler 필수
4. **README** - 실행 방법, 설계 의도

**하지 않아도 되는 것**

- 100% 테스트 커버리지
- 모든 API의 상세 Swagger 문서화
- 복잡한 AOP 구조
- 과도한 디자인 패턴 적용

</details>

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

다음 편에서는 **N+1 문제 해결**, **페이지네이션**, **캐싱 전략** 에 대해 다룹니다.

👉 [이전: 2편 - Database & Testing](/blog/spring-boot-pre-interview-guide-2)
👉 [다음: 4편 - Performance & Optimization](/blog/spring-boot-pre-interview-guide-4)
