---
title: "Spring Boot Pre-Interview Guide Part 3: Documentation & AOP"
description: "API documentation with Swagger/SpringDoc, SLF4J logging, and cross-cutting concerns with AOP"
pubDate: 2026-02-08T13:20:00+09:00
lang: en
tags: ["Spring Boot", "Swagger", "AOP", "Logging", "Interview", "Practical Guide"]
heroImage: "../../../assets/PreinterviewTaskGuide.png"
---

## Series Navigation

| Previous | Current | Next |
|:---:|:---:|:---:|
| [Part 2: DB & Testing](/en/blog/spring-boot-pre-interview-guide-2) | **Part 3: Documentation & AOP** | [Part 4: Performance](/en/blog/spring-boot-pre-interview-guide-4) |

> **Full Roadmap**: See [Spring Boot Pre-Interview Guide Roadmap](/en/blog/spring-boot-pre-interview-guide-1)

---

## Introduction

After covering core feature implementation in Parts 1-2, this part addresses API documentation and cross-cutting concerns.

**What Part 3 covers:**
- API Documentation (Swagger, REST Docs)
- Logging Strategy (SLF4J, MDC)
- AOP Usage (Separation of cross-cutting concerns)


### Table of Contents

- [API Documentation (SpringDoc/Swagger)](#api-documentation-springdocswagger)
- [Logging Strategy](#logging-strategy)
- [AOP Usage](#aop-usage)
- [Summary](#summary)

---

## API Documentation (SpringDoc/Swagger)

API documentation is not mandatory in pre-interview tasks, but having it allows evaluators to quickly understand your APIs, leaving a good impression.

> **SpringDoc vs Springfox**
> - Springfox is no longer recommended due to compatibility issues with Spring Boot 2.6+
> - Using SpringDoc OpenAPI is the current standard

<details>
<summary>How far should you go with Swagger documentation?</summary>

**Minimal Documentation (Recommended)**
- API title, description, version info (`OpenApiConfig`)
- `@Operation` for key APIs (summary level)
- Error response codes (`@ApiResponse`)

**Excessive Documentation (Not Recommended)**
- Detailed `@Schema` descriptions for every field
- Writing example values for everything
- Documenting every error case

**Reality in Practice**

In most projects, Swagger documentation is **done diligently only at the beginning**, and afterward it often falls out of sync with the code.

**Solutions When Documentation Falls Behind**

| Approach | Description | Effect |
|------|------|------|
| **Switch to Spring REST Docs** | Test-based documentation -> docs fail when tests fail | Enforces code-doc synchronization |
| **Minimal documentation principle** | Maintain only `@Tag`, `@Operation(summary)` | Reduces maintenance burden |
| **Leverage auto-generation** | Rely on what SpringDoc generates automatically | Minimizes additional work |
| **CI validation** | Require review when OpenAPI spec changes | Prevents unintended changes |

**Recommendations for Pre-Interview Tasks**

1. Set up basic configuration so Swagger UI works
2. Add detailed documentation to only 1-2 complex APIs
3. Leave the rest to default auto-generation

```kotlin
// Good - appropriate level
@Operation(summary = "Register product")
@PostMapping
fun registerProduct(...)

// Bad - excessive documentation (waste of time)
@Operation(
    summary = "Register product",
    description = "Registers a new product. Product name must be within 100 characters...",
    responses = [
        ApiResponse(responseCode = "201", description = "...", content = [...]),
        ApiResponse(responseCode = "400", description = "...", content = [...]),
        ApiResponse(responseCode = "500", description = "...", content = [...])
    ]
)
```

</details>

### 1. Adding Dependencies

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

### 2. Basic Configuration

<details>
<summary>application.yml</summary>

```yaml
springdoc:
  api-docs:
    path: /api-docs                          # OpenAPI JSON spec path (accessible at /api-docs)
  swagger-ui:
    path: /swagger-ui.html                   # Swagger UI access path
    tags-sorter: alpha                       # Sort Tags (Controllers) alphabetically
    operations-sorter: alpha                 # Sort API methods alphabetically (method: by HTTP method)
  default-consumes-media-type: application/json   # Default request Content-Type
  default-produces-media-type: application/json   # Default response Content-Type
  # packages-to-scan: com.example.api.controller  # Scan specific packages only (optional)
  # paths-to-match: /api/**                       # Document specific paths only (optional)
```

| Setting | Description | Default |
|------|------|--------|
| `api-docs.path` | OpenAPI JSON spec path | `/v3/api-docs` |
| `swagger-ui.path` | Swagger UI path | `/swagger-ui.html` |
| `tags-sorter` | Controller sorting (`alpha`, declaration order) | Declaration order |
| `operations-sorter` | API sorting (`alpha`, `method`) | Declaration order |

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
                    .description("Product Management API Documentation")
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
                .description("Product Management API Documentation")
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

### 3. Controller Documentation

Key annotations:
- `@Tag`: Specifies API group
- `@Operation`: API description
- `@Parameter`: Parameter description
- `@ApiResponse`: Response description
- `@Schema`: Model field description

<details>
<summary>Controller Documentation (Kotlin)</summary>

```kotlin
@Tag(name = "Product", description = "Product Management API")
@RestController
@RequestMapping("/api/v1/products")
class ProductController(
    private val productService: ProductService
) {
    @Operation(
        summary = "Get product details",
        description = "Retrieves detailed product information by product ID."
    )
    @ApiResponses(
        ApiResponse(responseCode = "200", description = "Successfully retrieved"),
        ApiResponse(responseCode = "404", description = "Product not found")
    )
    @GetMapping("/{productId}")
    fun findProductDetail(
        @Parameter(description = "Product ID", example = "1")
        @PathVariable productId: Long
    ): CommonResponse<FindProductDetailResponse> {
        return CommonResponse.success(productService.findProductDetail(productId))
    }

    @Operation(
        summary = "Get product list",
        description = "Retrieves a paginated list of products matching the given conditions."
    )
    @GetMapping
    fun findProducts(
        @Parameter(description = "Product name (partial match)")
        @RequestParam(required = false) name: String?,
        @Parameter(description = "Enabled status")
        @RequestParam(required = false) enabled: Boolean?,
        @ParameterObject pageable: Pageable
    ): CommonResponse<Page<FindProductResponse>> {
        return CommonResponse.success(
            productService.findProducts(name, enabled, pageable)
        )
    }

    @Operation(
        summary = "Register product",
        description = "Registers a new product."
    )
    @ApiResponses(
        ApiResponse(responseCode = "201", description = "Successfully registered"),
        ApiResponse(responseCode = "400", description = "Bad request")
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
<summary>Controller Documentation (Java)</summary>

```java
@Tag(name = "Product", description = "Product Management API")
@RestController
@RequestMapping("/api/v1/products")
@RequiredArgsConstructor
public class ProductController {

    private final ProductService productService;

    @Operation(
        summary = "Get product details",
        description = "Retrieves detailed product information by product ID."
    )
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Successfully retrieved"),
        @ApiResponse(responseCode = "404", description = "Product not found")
    })
    @GetMapping("/{productId}")
    public CommonResponse<FindProductDetailResponse> findProductDetail(
            @Parameter(description = "Product ID", example = "1")
            @PathVariable Long productId) {
        return CommonResponse.success(productService.findProductDetail(productId));
    }

    @Operation(
        summary = "Get product list",
        description = "Retrieves a paginated list of products matching the given conditions."
    )
    @GetMapping
    public CommonResponse<Page<FindProductResponse>> findProducts(
            @Parameter(description = "Product name (partial match)")
            @RequestParam(required = false) String name,
            @Parameter(description = "Enabled status")
            @RequestParam(required = false) Boolean enabled,
            @ParameterObject Pageable pageable) {
        return CommonResponse.success(
            productService.findProducts(name, enabled, pageable)
        );
    }

    @Operation(
        summary = "Register product",
        description = "Registers a new product."
    )
    @ApiResponses({
        @ApiResponse(responseCode = "201", description = "Successfully registered"),
        @ApiResponse(responseCode = "400", description = "Bad request")
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

### 4. DTO Documentation

Use the `@Schema` annotation to add field descriptions.

<details>
<summary>Request DTO (Kotlin)</summary>

> **Tip: Use BigDecimal for price fields**
>
> For financial/pricing data, using `BigDecimal` instead of `Int`/`Long` is the industry standard.
>
> | Type | Pros | Cons | Recommended For |
> |------|------|------|----------|
> | `Int`/`Long` | Simple, good performance | No decimals, overflow risk | Simple counts, IDs |
> | `BigDecimal` | Precision guaranteed, decimal handling | Complex operations | Amounts, prices, ratios |
>
> ```kotlin
> // Using Int (for simple tasks)
> @field:Positive
> @Schema(description = "Price", example = "10000")
> val price: Int?
>
> // Using BigDecimal (recommended for production)
> @field:DecimalMin(value = "0", inclusive = false)
> @Schema(description = "Price", example = "10000.00")
> val price: BigDecimal?
> ```

```kotlin
@Schema(description = "Product registration request")
data class RegisterProductRequest(
    @field:NotBlank
    @field:Size(max = 100)
    @Schema(description = "Product name", example = "Delicious Apple", maxLength = 100)
    val name: String?,

    @field:NotNull
    @field:DecimalMin(value = "0", inclusive = false)
    @Schema(description = "Price", example = "10000.00", minimum = "0.01")
    val price: BigDecimal?,

    @field:NotNull
    @Schema(description = "Category", example = "FOOD")
    val category: ProductCategoryType?
)
```

</details>

<details>
<summary>Request DTO (Java)</summary>

```java
@Schema(description = "Product registration request")
public record RegisterProductRequest(
    @NotBlank
    @Size(max = 100)
    @Schema(description = "Product name", example = "Delicious Apple", maxLength = 100)
    String name,

    @NotNull
    @Positive
    @Schema(description = "Price", example = "10000", minimum = "1")
    Integer price,

    @NotNull
    @Schema(description = "Category", example = "FOOD")
    ProductCategoryType category
) {}
```

</details>

<details>
<summary>Response DTO (Kotlin)</summary>

```kotlin
@Schema(description = "Product detail response")
data class FindProductDetailResponse(
    @Schema(description = "Product ID", example = "1")
    val id: Long,

    @Schema(description = "Product name", example = "Delicious Apple")
    val name: String,

    @Schema(description = "Price", example = "10000")
    val price: Int,

    @Schema(description = "Category", example = "FOOD")
    val category: ProductCategoryType,

    @Schema(description = "Enabled status", example = "true")
    val enabled: Boolean,

    @Schema(description = "Created at", example = "2024-01-01T10:00:00")
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

### 5. Common Response Documentation

<details>
<summary>CommonResponse Documentation (Kotlin)</summary>

```kotlin
@Schema(description = "Common response")
data class CommonResponse<T>(
    @Schema(description = "Response code", example = "SUC200")
    val code: String = CODE_SUCCESS,

    @Schema(description = "Response message", example = "success")
    val message: String = MSG_SUCCESS,

    @Schema(description = "Response data")
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

### 6. Swagger Configuration with Security

When using Spring Security, you need to allow access to Swagger paths.

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
                    // Allow Swagger UI
                    .requestMatchers(
                        "/swagger-ui/**",
                        "/swagger-ui.html",
                        "/api-docs/**",
                        "/v3/api-docs/**"
                    ).permitAll()
                    // All other requests
                    .anyRequest().authenticated()
            }
            .build()
    }
}
```

</details>

<details>
<summary>With JWT Authentication (Kotlin)</summary>

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

### 7. Spring REST Docs (Alternative)

Instead of Swagger, this approach generates API documentation **based on tests**. Since documentation is only generated when tests pass, **synchronization between docs and code is guaranteed**.

<details>
<summary>Swagger vs REST Docs</summary>

| Comparison | Swagger (SpringDoc) | REST Docs |
|----------|---------------------|-----------|
| **Doc generation method** | Annotation-based | Test-based |
| **Doc-code sync** | Manual management required | Automatically guaranteed when tests pass |
| **Runtime dependency** | Yes (included in production deployment) | No (used only at build time) |
| **Try it out feature** | Built-in | Requires separate implementation |
| **Learning curve** | Low | High |
| **Production code intrusion** | Requires adding annotations | None (exists only in test code) |

**When Swagger is appropriate**
- Rapid prototyping
- When Try it out functionality is needed
- When there's heavy frontend collaboration

**When REST Docs is appropriate**
- When documentation accuracy is critical (financial, public APIs, etc.)
- When you want to keep production code clean
- Projects with high test coverage

**For pre-interview tasks**, Swagger is more appropriate. The setup is simple and the Try it out feature allows evaluators to test immediately.

</details>

<details>
<summary>Adding Dependencies (build.gradle)</summary>

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

// Copy generated docs to static folder
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
<summary>Adding Dependencies (build.gradle.kts)</summary>

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
<summary>Test Code (Java)</summary>

```java
@WebMvcTest(ProductController.class)
@AutoConfigureRestDocs  // REST Docs auto configuration
class ProductControllerDocsTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ProductService productService;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    @DisplayName("Get product detail API")
    void findProductDetail() throws Exception {
        // given
        FindProductDetailResponse response = new FindProductDetailResponse(
            1L, "Delicious Apple", 10000, ProductCategoryType.FOOD, true, LocalDateTime.now()
        );
        given(productService.findProductDetail(1L)).willReturn(response);

        // when & then
        mockMvc.perform(get("/api/v1/products/{productId}", 1L)
                .accept(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andDo(document("product-detail",  // Document identifier
                pathParameters(
                    parameterWithName("productId").description("Product ID")
                ),
                responseFields(
                    fieldWithPath("code").description("Response code"),
                    fieldWithPath("message").description("Response message"),
                    fieldWithPath("data.id").description("Product ID"),
                    fieldWithPath("data.name").description("Product name"),
                    fieldWithPath("data.price").description("Price"),
                    fieldWithPath("data.category").description("Category"),
                    fieldWithPath("data.enabled").description("Enabled status"),
                    fieldWithPath("data.createdAt").description("Created at")
                )
            ));
    }

    @Test
    @DisplayName("Register product API")
    void registerProduct() throws Exception {
        // given
        RegisterProductRequest request = new RegisterProductRequest(
            "Delicious Apple", 10000, ProductCategoryType.FOOD
        );
        given(productService.registerProduct(any())).willReturn(1L);

        // when & then
        mockMvc.perform(post("/api/v1/products")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isCreated())
            .andDo(document("product-create",
                requestFields(
                    fieldWithPath("name").description("Product name"),
                    fieldWithPath("price").description("Price"),
                    fieldWithPath("category").description("Category (FOOD, HOTEL)")
                ),
                responseFields(
                    fieldWithPath("code").description("Response code"),
                    fieldWithPath("message").description("Response message"),
                    fieldWithPath("data").description("Created product ID")
                )
            ));
    }
}
```

</details>

<details>
<summary>Test Code (Kotlin - JUnit Style)</summary>

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
    @DisplayName("Get product detail API")
    fun findProductDetail() {
        // given
        val response = FindProductDetailResponse(
            id = 1L,
            name = "Delicious Apple",
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
                        parameterWithName("productId").description("Product ID")
                    ),
                    responseFields(
                        fieldWithPath("code").description("Response code"),
                        fieldWithPath("message").description("Response message"),
                        fieldWithPath("data.id").description("Product ID"),
                        fieldWithPath("data.name").description("Product name"),
                        fieldWithPath("data.price").description("Price"),
                        fieldWithPath("data.category").description("Category"),
                        fieldWithPath("data.enabled").description("Enabled status"),
                        fieldWithPath("data.createdAt").description("Created at")
                    )
                )
            )
    }

    @Test
    @DisplayName("Register product API")
    fun registerProduct() {
        // given
        val request = RegisterProductRequest(
            name = "Delicious Apple",
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
                        fieldWithPath("name").description("Product name"),
                        fieldWithPath("price").description("Price"),
                        fieldWithPath("category").description("Category (FOOD, HOTEL)")
                    ),
                    responseFields(
                        fieldWithPath("code").description("Response code"),
                        fieldWithPath("message").description("Response message"),
                        fieldWithPath("data").description("Created product ID")
                    )
                )
            )
    }
}
```

</details>

<details>
<summary>Test Code (Kotlin - Kotest DescribeSpec Style)</summary>

> **What is Kotest?** A Kotlin-specific testing framework that provides BDD-style `DescribeSpec`. It offers clear test structure and excellent readability.

```kotlin
// Add dependencies to build.gradle.kts
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
        describe("Product API") {
            context("when retrieving product details") {
                it("returns product information") {
                    // given
                    val response = FindProductDetailResponse(
                        id = 1L,
                        name = "Delicious Apple",
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
                                    parameterWithName("productId").description("Product ID")
                                ),
                                responseFields(
                                    fieldWithPath("code").description("Response code"),
                                    fieldWithPath("message").description("Response message"),
                                    fieldWithPath("data.id").description("Product ID"),
                                    fieldWithPath("data.name").description("Product name"),
                                    fieldWithPath("data.price").description("Price"),
                                    fieldWithPath("data.category").description("Category"),
                                    fieldWithPath("data.enabled").description("Enabled status"),
                                    fieldWithPath("data.createdAt").description("Created at")
                                )
                            )
                        )
                }
            }

            context("when registering a product") {
                it("returns the created product ID") {
                    // given
                    val request = RegisterProductRequest(
                        name = "Delicious Apple",
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
                                    fieldWithPath("name").description("Product name"),
                                    fieldWithPath("price").description("Price"),
                                    fieldWithPath("category").description("Category (FOOD, HOTEL)")
                                ),
                                responseFields(
                                    fieldWithPath("code").description("Response code"),
                                    fieldWithPath("message").description("Response message"),
                                    fieldWithPath("data").description("Created product ID")
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
<summary>AsciiDoc Template (src/docs/asciidoc/index.adoc)</summary>

```asciidoc
= Product API Documentation
:doctype: book
:icons: font
:source-highlighter: highlightjs
:toc: left
:toclevels: 2
:sectlinks:

[[overview]]
== Overview

Product Management API Documentation.

[[Product-API]]
== Product API

[[Product-Detail]]
=== Get Product Details

operation::product-detail[snippets='path-parameters,response-fields,curl-request,http-response']

[[Product-Register]]
=== Register Product

operation::product-create[snippets='request-fields,response-fields,curl-request,http-response']
```

</details>

<details>
<summary>REST Docs Practical Tips</summary>

**Reduce duplication with test abstraction**

```java
// Use common configuration via inheritance
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
            "{class-name}/{method-name}",  // Auto-naming
            Preprocessors.preprocessRequest(Preprocessors.prettyPrint()),
            Preprocessors.preprocessResponse(Preprocessors.prettyPrint())
        );
    }
}
```

**Documenting field constraints**

```java
// Include validation annotation info in documentation
requestFields(
    fieldWithPath("name")
        .description("Product name")
        .attributes(key("constraints").value("Required, max 100 characters")),
    fieldWithPath("price")
        .description("Price")
        .attributes(key("constraints").value("Required, positive number"))
)
```

**Documenting error responses**

```java
@Test
void findProductDetail_notFound() throws Exception {
    given(productService.findProductDetail(999L))
        .willThrow(new NotFoundException());

    mockMvc.perform(get("/api/v1/products/{productId}", 999L))
        .andExpect(status().isNotFound())
        .andDo(document("product-detail-error",
            responseFields(
                fieldWithPath("code").description("Error code"),
                fieldWithPath("message").description("Error message"),
                fieldWithPath("data").description("null")
            )
        ));
}
```

</details>

---

## Logging Strategy

Logging is an important element in pre-interview tasks from both debugging and operational perspectives. Proper logging enhances code quality.

<details>
<summary>Myths and Facts About Logging Performance</summary>

**Common Mistakes**

```java
// Bad - string concatenation executes even when DEBUG level is off
log.debug("User " + userId + " requested " + itemCount + " items");

// Good - string concatenation is skipped when DEBUG level is off
log.debug("User {} requested {} items", userId, itemCount);
```

**When isDebugEnabled() Check is Needed**

```java
// No check needed for simple variable substitution
log.debug("User {} logged in", userId);

// Check only when expensive operations are involved
if (log.isDebugEnabled()) {
    log.debug("Request details: {}", expensiveJsonSerialization(request));
}
```

**Practical Tips**

- In most cases, `{}` placeholders are sufficient
- Only use `isDebugEnabled()` check for objects with expensive `toString()`
- Level checking is recommended for logging inside loops

</details>

<details>
<summary>MDC vs Distributed Tracing Systems</summary>

**MDC (Mapped Diagnostic Context)**
- Tracks requests within a single application
- Requires manual implementation
- Difficult to trace across microservices

**Distributed Tracing Systems (Zipkin, Jaeger, AWS X-Ray, etc.)**
- Tracks requests across multiple services
- Provides visual dashboards
- Requires setup and infrastructure

**Selection Criteria**

| Scenario | Recommended |
|-----|-----|
| Single application, pre-interview tasks | MDC |
| Microservices | Distributed tracing system |
| When quick implementation is needed | MDC |

**For pre-interview tasks**, MDC is more than sufficient. Distributed tracing systems require infrastructure setup, which often exceeds the scope of the task.

</details>

### 1. Logback Basic Configuration

Spring Boot uses Logback by default.

<details>
<summary>application.yml (Basic Logging Configuration)</summary>

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
<summary>logback-spring.xml (Detailed Configuration)</summary>

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <!-- Profile-specific configuration -->
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

    <!-- Package-level log levels -->
    <logger name="com.example.app" level="DEBUG"/>
    <logger name="org.springframework.web" level="INFO"/>
    <logger name="org.hibernate.SQL" level="DEBUG"/>
</configuration>
```

</details>

### 2. MDC (Mapped Diagnostic Context)

Using MDC, you can assign a unique ID to each request, making log tracing much easier.

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

### 3. Logging Level Guide

| Level | Purpose | Examples |
|------|------|------|
| **ERROR** | Errors requiring immediate attention | DB connection failure, external API outage |
| **WARN** | Potential issues, attention needed | Retries occurring, approaching thresholds |
| **INFO** | Major business events | Order completed, payment successful |
| **DEBUG** | Detailed info for development/debugging | Method entry/exit, parameter values |
| **TRACE** | Very detailed information | Value changes within loops |

<details>
<summary>Logging Examples (Kotlin)</summary>

```kotlin
@Service
class ProductService(
    private val productRepository: ProductRepository
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @Transactional
    fun registerProduct(request: RegisterProductRequest): Long {
        log.debug("Product registration request: name={}, price={}", request.name, request.price)

        val product = Product(
            name = request.name!!,
            price = request.price!!,
            category = request.category!!
        )

        val saved = productRepository.save(product)
        log.info("Product registration complete: productId={}", saved.id)

        return saved.id!!
    }

    fun findProductDetail(productId: Long): FindProductDetailResponse {
        log.debug("Product lookup: productId={}", productId)

        val product = productRepository.findById(productId)
            ?: run {
                log.warn("Product not found: productId={}", productId)
                throw NotFoundException()
            }

        return FindProductDetailResponse.from(product)
    }
}
```

</details>

<details>
<summary>Logging Examples (Java)</summary>

```java
@Slf4j
@Service
@RequiredArgsConstructor
public class ProductService {

    private final ProductRepository productRepository;

    @Transactional
    public Long registerProduct(RegisterProductRequest request) {
        log.debug("Product registration request: name={}, price={}", request.name(), request.price());

        Product product = new Product(
            request.name(),
            request.price(),
            request.category()
        );

        Product saved = productRepository.save(product);
        log.info("Product registration complete: productId={}", saved.getId());

        return saved.getId();
    }

    public FindProductDetailResponse findProductDetail(Long productId) {
        log.debug("Product lookup: productId={}", productId);

        Product product = productRepository.findById(productId)
            .orElseThrow(() -> {
                log.warn("Product not found: productId={}", productId);
                return new NotFoundException();
            });

        return FindProductDetailResponse.from(product);
    }
}
```

</details>

### 4. Sensitive Information Masking

Be careful not to expose sensitive information in logs.

<details>
<summary>Masking Utility (Kotlin)</summary>

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
<summary>Masking Utility Usage Examples</summary>

```kotlin
@Service
@RequiredArgsConstructor
class MemberService(
    private val memberRepository: MemberRepository
) {
    private val log = LoggerFactory.getLogger(javaClass)

    fun findMemberDetail(memberId: Long): MemberDetailResponse {
        val member = memberRepository.findById(memberId)
            .orElseThrow { NotFoundException("Member not found") }

        // Only masked information is logged
        log.info(
            "Member lookup complete: memberId={}, email={}, phone={}",
            member.id,
            MaskingUtils.maskEmail(member.email),    // ho***@example.com
            MaskingUtils.maskPhone(member.phone)     // 010****1234
        )

        return MemberDetailResponse.from(member)
    }

    fun processPayment(memberId: Long, cardNumber: String, amount: Int) {
        // Log before payment processing
        log.info(
            "Payment request: memberId={}, card={}, amount={}",
            memberId,
            MaskingUtils.maskCardNumber(cardNumber),  // ************1234
            amount
        )

        // Payment processing logic...
    }
}
```

**Practical tip**: Apply masking **only at the log output point**, and use the original data in actual business logic. Never use masked data for comparisons or processing.

</details>

---

## AOP Usage

AOP allows you to cleanly separate cross-cutting concerns (logging, performance measurement, etc.).

<details>
<summary>Caution: Avoid AOP Overuse</summary>

**When AOP is appropriate**
- Logging, monitoring
- Transaction management
- Security/authorization checks
- Caching

**When AOP is inappropriate**
- Business logic implementation
- Complex conditional branching
- Logic that applies to only specific methods

**Caveats**

1. **Debugging difficulty**: Logic handled by AOP is not directly visible in code, making debugging harder
2. **Performance overhead**: Applying Aspects to every method can degrade performance
3. **Ordering issues**: When multiple Aspects exist, execution order management is needed (`@Order`)
4. **Self-invocation problem**: AOP is not applied when calling methods within the same class

```java
@Service
public class ProductService {

    public void methodA() {
        methodB();  // AOP NOT applied (self-invocation)
    }

    @ExecutionTime
    public void methodB() { ... }
}
```

**Recommendations for Pre-Interview Tasks**

- Request/response logging AOP can leave a good impression
- Too many AOPs actually increase complexity
- If you use AOP, add an explanation in the README

</details>

<details>
<summary>AOP vs Filter vs Interceptor</summary>

| Type | Scope | Execution Timing | Use Cases |
|-----|----------|----------|----------|
| **Filter** | Servlet | Before/after DispatcherServlet | Encoding, CORS, Authentication |
| **Interceptor** | Spring MVC | Before/after Controller | Authentication, Logging, Authorization |
| **AOP** | Spring Bean | Before/after method execution | Transactions, Logging, Caching |

**Selection Guide**

- **Handling HTTP request/response itself**: Filter
- **Pre/post Controller processing**: Interceptor
- **Business logic in Service/Repository, etc.**: AOP

**For pre-interview tasks**, using just AOP or Interceptor alone is usually sufficient. There's no need to use all three.

</details>

### 1. Adding Dependencies

<details>
<summary>build.gradle</summary>

```groovy
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-aop'
}
```

</details>

### 2. Request/Response Logging AOP

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

        // Request logging
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

            // Response logging
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

        // Request logging
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

            // Response logging
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

### 3. Execution Time Measurement AOP

Used when you want to measure the execution time of specific methods.

<details>
<summary>ExecutionTime Annotation (Kotlin)</summary>

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
<summary>Usage Example (Kotlin)</summary>

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

### 4. Transaction Logging AOP

Logs transaction start/commit/rollback events.

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

### 5. Retry Logic AOP

Used when retry logic is needed, such as for external API calls.

<details>
<summary>Retry Annotation (Kotlin)</summary>

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

## Summary

### Key Points

| Topic | Checkpoints |
|------|------------|
| **API Documentation** | SpringDoc setup, annotation usage, Security path allowance |
| **Logging** | Appropriate log levels, MDC usage, sensitive information masking |
| **AOP** | Request/response logging, execution time measurement, cross-cutting concern separation |

### Checklist

- [ ] Is Swagger UI accessible? (`/swagger-ui.html`)
- [ ] Does the API documentation include descriptions and examples?
- [ ] Do logs include request IDs for traceability?
- [ ] Are sensitive data (passwords, card numbers, etc.) not exposed in logs?
- [ ] Are appropriate log levels being used?
- [ ] Can slow queries/methods be identified?

<details>
<summary>Elements That Give You an Edge in Pre-Interview Tasks</summary>

**Bonus Elements (If Time Permits)**

| Item | Effect | Difficulty |
|-----|-----|:---:|
| Swagger UI accessible | Evaluator can test immediately | Low |
| Request ID logging (MDC) | Easy log tracing | Medium |
| Execution time logging AOP | Demonstrates performance awareness | Medium |
| API versioning (`/v1/`) | Shows scalability consideration | Low |
| Profile separation (local/test) | Environment management competency | Low |

**Priorities When Time is Short**

1. **Complete core features** - Working code is the top priority
2. **Test code** - At least 1-2 tests for key logic
3. **Exception handling** - GlobalExceptionHandler is essential
4. **README** - How to run, design rationale

**What You Don't Need to Do**

- 100% test coverage
- Detailed Swagger documentation for every API
- Complex AOP structures
- Excessive design pattern application

</details>

### File Structure Example

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

The next part covers **N+1 problem resolution**, **pagination**, and **caching strategies**.

[Previous: Part 2 - Database & Testing](/en/blog/spring-boot-pre-interview-guide-2)
[Next: Part 4 - Performance & Optimization](/en/blog/spring-boot-pre-interview-guide-4)
