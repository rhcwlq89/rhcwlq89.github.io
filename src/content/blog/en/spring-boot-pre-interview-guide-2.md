---
title: "Spring Boot Pre-Interview Guide Part 2: Database & Testing"
description: "H2/MySQL setup, JPA entity mapping, and test strategies (unit, integration, slice) with practical examples"
pubDate: 2026-02-08T13:10:00+09:00
lang: en
tags: ["Spring Boot", "JPA", "Testing", "Database", "Interview", "Practical Guide"]
heroImage: "../../../assets/PreinterviewTaskGuide.png"
---

## Series Navigation

| Previous | Current | Next |
|:---:|:---:|:---:|
| [Part 1: Core Layer](/en/blog/spring-boot-pre-interview-guide-1) | **Part 2: DB & Testing** | [Part 3: Documentation & AOP](/en/blog/spring-boot-pre-interview-guide-3) |

> **Full Roadmap**: See [Spring Boot Pre-Interview Guide Roadmap](/en/blog/spring-boot-pre-interview-guide-1)

---

## Introduction

Building on the layered architecture covered in Part 1, this part covers database configuration and testing strategies.

**What Part 2 covers:**
- Database configuration (H2, MySQL, profile separation)
- Repository testing
- Service testing
- Controller testing

### Table of Contents

- [Database Config](#database-config)
- [Test](#test)
- [Summary](#summary)

---

## Database Config

There are generally three types of databases presented in pre-interview tasks:
- Memory-based RDB (H2)
- Pure in-memory storage (HashMap, etc.)
- Docker-based RDB (MySQL, PostgreSQL, etc.)

### 1. Common Configuration (application.yml)

Configure the DB connection information (url, jdbc driver, username, password).
No separate configuration is needed when using a pure in-memory storage.

<details>
<summary>application.yml (DB Connection)</summary>

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/app
    driver-class-name: com.mysql.cj.jdbc.Driver
    username: app
    password: secret
  jpa:
    hibernate:
      ddl-auto: update
    show-sql: true
    properties:
      hibernate:
        format_sql: true
```

</details>

> **Tip**: `ddl-auto` options
> - `create`: Creates tables at startup
> - `create-drop`: Creates at startup, drops at shutdown
> - `update`: Applies only schema changes
> - `validate`: Only validates entity-table mapping
> - `none`: Does nothing

<details>
<summary>ddl-auto Production Environment Warnings</summary>

**Combinations you must NEVER use**
- Production + `create` = Deletes all existing data
- Production + `create-drop` = Drops tables on application shutdown
- Production + `update` = Unexpected schema changes (columns won't be deleted, but additions/modifications will occur)

**Recommended settings per environment**

| Environment | Recommended Setting | Reason |
|------|----------|------|
| Local development | `create` or `update` | Fast development cycle |
| Test | `create-drop` | Clean state for every test |
| Staging | `validate` | Early detection of schema mismatches |
| Production | `none` or `validate` | Schema changes must use migration tools |

**Practical Tips**

In production, use DB migration tools like **Flyway** or **Liquibase** to manage schemas. Relying on ddl-auto can cause unexpected data loss.

```yaml
# Production environment configuration example
spring:
  jpa:
    hibernate:
      ddl-auto: validate  # or none
  flyway:
    enabled: true
```

**Flyway vs Liquibase Comparison**

| Aspect | Flyway | Liquibase |
|------|--------|-----------|
| **Migration approach** | SQL file-based | Supports XML/YAML/JSON/SQL |
| **File naming** | `V1__init.sql`, `V2__add_column.sql` | `changelog.xml` |
| **Rollback** | Supported in paid version | Supported in free version |
| **Learning curve** | Low (just need to know SQL) | Medium (abstraction layer exists) |
| **Spring Boot integration** | `spring-boot-starter-flyway` | `spring-boot-starter-liquibase` |

```
# Flyway migration file structure
src/main/resources/db/migration/
├── V1__create_member_table.sql
├── V2__create_product_table.sql
└── V3__add_category_column.sql
```

**Recommendation for tasks**: For simple tasks, `ddl-auto: create-drop` (local) + `validate` (Docker) is sufficient. Migration tools are more important in production environments.

</details>

### 2. H2 Configuration

H2 is an in-memory database that can be used without separate installation, making it frequently used in pre-interview tasks.

<details>
<summary>application.yml (H2 Configuration)</summary>

```yaml
spring:
  datasource:
    url: jdbc:h2:mem:testdb
    driver-class-name: org.h2.Driver
    username: sa
    password:
  h2:
    console:
      enabled: true
      path: /h2-console
  jpa:
    hibernate:
      ddl-auto: create-drop
    show-sql: true
```

</details>

<details>
<summary>build.gradle</summary>

```groovy
dependencies {
    runtimeOnly 'com.h2database:h2'
    // Separate dependency required for Spring Boot 4.x and above
    runtimeOnly 'org.springframework.boot:spring-boot-h2console'
}
```

</details>

> **Note**: When accessing the H2 console, make sure the JDBC URL matches `jdbc:h2:mem:testdb` exactly.

### 3. Memory DB Configuration (HashMap)

No separate configuration is needed when using a pure in-memory storage.
Implement the memory storage logic directly in the Repository implementation.

<details>
<summary>MemoryRepository Implementation Example</summary>

```java
@Repository
public class MemoryProductRepository implements ProductRepository {

    // Use ConcurrentHashMap for thread safety
    private final Map<Long, Product> store = new ConcurrentHashMap<>();
    private final AtomicLong sequence = new AtomicLong(0);

    @Override
    public Product save(Product product) {
        if (product.getId() == null) {
            product.setId(sequence.incrementAndGet());
        }
        store.put(product.getId(), product);
        return product;
    }

    @Override
    public Optional<Product> findById(Long id) {
        return Optional.ofNullable(store.get(id));
    }

    @Override
    public List<Product> findAll() {
        return new ArrayList<>(store.values());
    }

    @Override
    public void deleteById(Long id) {
        store.remove(id);
    }
}
```

</details>

> **Tip**: Collection selection guide
> - `ConcurrentHashMap`: General key-value storage (recommended)
> - `ConcurrentSkipListMap`: When sorting is needed
> - `CopyOnWriteArrayList`: When reads are frequent and writes are rare

<details>
<summary>Memory Repository Implementation Considerations</summary>

**ID Generation Strategy**

In a JPA environment, `@GeneratedValue` automatically generates IDs, but in a memory storage, you need to implement it yourself.

```java
// Bad example - concurrency issue
private long sequence = 0;
product.setId(++sequence);  // Race condition possible

// Good example - using AtomicLong
private final AtomicLong sequence = new AtomicLong(0);
product.setId(sequence.incrementAndGet());
```

**Object Copy Warning**

If you return a direct reference to a stored object, external modifications will also change the data in the storage.

```java
// Dangerous code
return store.get(id);  // Returns the original

// Safe code (defensive copy)
return store.get(id).copy();  // Or copy with new Product(...)
```

**When Defensive Copying Is Needed**

| Situation | Defensive Copy Needed | Reason |
|------|:---:|------|
| Memory Repository (for testing) | Yes | External modifications affect the storage |
| JPA Repository | No | Persistence context manages change detection |
| DTO return | - | A new object is already created |

**Key point**: Since Memory Repository is for testing purposes, it should mimic JPA behavior. In actual JPA, modifying a retrieved entity reflects changes to the DB at transaction commit, but Memory Repository lacks this mechanism, so defensive copying prevents unintended modifications.

**Pagination Handling**

```java
public Page<Product> findAll(Pageable pageable) {
    List<Product> all = new ArrayList<>(store.values());
    int start = (int) pageable.getOffset();
    int end = Math.min(start + pageable.getPageSize(), all.size());

    List<Product> content = all.subList(start, end);
    return new PageImpl<>(content, pageable, all.size());
}
```

</details>

### 4. Docker-Based RDB Configuration

Use Docker Compose to set up MySQL, PostgreSQL, etc.
For most pre-interview tasks, only a single DB is used, so you just need to configure the connection info in application.yml.

<details>
<summary>docker-compose.yml (MySQL)</summary>

```yaml
services:
  mysql-db:
    container_name: mysql-db
    image: mysql:8.0
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-rootpassword}
      MYSQL_DATABASE: testdb
      MYSQL_USER: ${MYSQL_USER:-user}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD:-password}
      TZ: Asia/Seoul
    ports:
      - "3306:3306"
    volumes:
      - db_data:/var/lib/mysql
    command:
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_unicode_ci
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  db_data:
```

</details>

<details>
<summary>docker-compose.yml (PostgreSQL)</summary>

```yaml
services:
  postgres-db:
    container_name: postgres-db
    image: postgres:15
    restart: unless-stopped
    environment:
      POSTGRES_DB: testdb
      POSTGRES_USER: ${POSTGRES_USER:-user}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-password}
      TZ: Asia/Seoul
    ports:
      - "5432:5432"
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-user}"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pg_data:
```

</details>

**Docker Compose Commands**

```bash
# Start containers (background)
docker compose up -d

# Check logs
docker compose logs -f

# Stop containers
docker compose down

# Remove containers + volumes (data)
docker compose down -v

# Restart a specific service
docker compose restart mysql-db
```

### 5. Querydsl Configuration

Use Querydsl when complex dynamic queries are needed.

<details>
<summary>Querydsl Config (Kotlin)</summary>

```kotlin
@Configuration(proxyBeanMethods = false)
class QuerydslConfig(
    private val entityManager: EntityManager
) {
    @Bean
    fun jpaQueryFactory(): JPAQueryFactory {
        return JPAQueryFactory(entityManager)
    }
}
```

</details>

> **What is `proxyBeanMethods = false`?**
>
> Spring's `@Configuration` class uses CGLIB proxies by default to **guarantee singletons** when `@Bean` methods call each other. However, when `@Bean` methods don't call each other, the proxy is unnecessary. Setting `proxyBeanMethods = false`:
> - **Reduces proxy creation cost** (faster application startup)
> - **Reduces memory usage**
>
> This is mainly used in configuration classes that simply register beans. Most of Spring Boot's own auto-configurations also use this option.

<details>
<summary>build.gradle.kts (Querydsl Dependencies)</summary>

```kotlin
dependencies {
    implementation("com.querydsl:querydsl-jpa:5.0.0:jakarta")
    kapt("com.querydsl:querydsl-apt:5.0.0:jakarta")
}
```

</details>

---

## Test

### 1. Test DB Configuration

It is common to use H2 in the test environment.
You can use profile separation or a separate yaml file.

> **Profile Separation vs Separate YAML File**
>
> | Approach | File Name Example | Activation Method | Characteristics |
> |------|-------------|-------------|------|
> | Profile separation | `application-test.yml` | `@ActiveProfiles("test")` | Spring Boot standard, suitable for per-environment config separation |
> | Separate yaml | `application-test.yml` or `test-application.yml` | `@TestPropertySource` | Explicit separation for test-specific config |
>
> **Practical recommendation**: Profile separation in the `application-{profile}.yml` format is most common. It can be easily activated with `@ActiveProfiles("test")` and follows Spring Boot's configuration loading rules as-is.

<details>
<summary>application-test.yml</summary>

```yaml
spring:
  datasource:
    url: jdbc:h2:mem:testdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE
    driver-class-name: org.h2.Driver
    username: sa
    password:
  jpa:
    hibernate:
      ddl-auto: create-drop
    show-sql: true
```

</details>

<details>
<summary>build.gradle</summary>

```groovy
dependencies {
    testRuntimeOnly 'com.h2database:h2'
}

tasks.named('test') {
    useJUnitPlatform()
    systemProperty 'spring.profiles.active', 'test'
}
```

</details>

### 2. Test Annotation Guide

| Annotation | Purpose | Characteristics |
|-----------|------|------|
| `@DataJpaTest` | Repository testing | Loads only JPA-related beans, auto-rollback |
| `@WebMvcTest` | Controller testing | Loads only MVC-related beans |
| `@SpringBootTest` | Integration testing | Loads full context |
| `@Transactional` | Test rollback | Auto-rollback after test completion |

<details>
<summary>@DataJpaTest vs @SpringBootTest Selection Criteria</summary>

**@DataJpaTest**
- Loads only JPA-related beans, so it's **fast**
- `@Transactional` is applied by default for auto-rollback
- Service, Controller, etc. are not loaded
- Suitable for pure Repository logic testing

**@SpringBootTest**
- Loads the entire ApplicationContext, so it's **slow**
- Integration testing similar to actual environment
- All beans are injected, enabling E2E testing

**Selection Guide**

| Test Target | Recommended Annotation |
|------------|----------------|
| Repository unit test | `@DataJpaTest` |
| Service + Repository integration | `@SpringBootTest` |
| Controller + Service + Repository | `@SpringBootTest` + `MockMvc` |
| Controller unit test | `@WebMvcTest` |

**Practical Tips**

If test speed matters, actively use **Slice Tests** (`@DataJpaTest`, `@WebMvcTest`), and only use `@SpringBootTest` for key integration test scenarios.

</details>

<details>
<summary>Mock vs Real Objects: When to Use What?</summary>

**When mock objects are appropriate**
- External API calls (payment, notifications, etc.)
- Hard-to-test dependencies (time, random, etc.)
- When testing only a specific layer in unit tests
- Error scenario simulation

**When real objects are appropriate**
- Verifying actual DB interactions
- Query performance testing
- Transaction behavior verification
- Relationship mapping verification

**Warning: Problems with excessive mocking**

```java
// Bad - excessive mocking makes the test meaningless
given(repository.save(any())).willReturn(product);
given(repository.findById(1L)).willReturn(Optional.of(product));

Product saved = service.create(request);  // calls save()
Product found = service.find(1L);         // calls findById()

// These might not be the same object in reality, but mocking always succeeds
assertThat(found.getId()).isEqualTo(saved.getId());
```

**Ways to reduce excessive mocking**

| Method | Description | When to Apply |
|------|------|----------|
| **Use Fake objects** | Mimic real behavior with Memory Repository | Service tests with many Repository dependencies |
| **Use @DataJpaTest** | Test Repository with real DB | When query verification is needed |
| **Testcontainers** | Integration test with real DB containers | When same verification as production is needed |
| **Mock only boundaries** | Mock only uncontrollable things like external APIs, time | Most tests |

```java
// Good - using Fake Repository
class ProductServiceTest {
    private ProductService service;
    private FakeProductRepository repository;  // Memory implementation

    @BeforeEach
    void setUp() {
        repository = new FakeProductRepository();
        service = new ProductService(repository);
    }

    @Test
    void save_and_retrieve_product() {
        // Given
        CreateProductRequest request = new CreateProductRequest("Product", 1000);

        // When
        Long savedId = service.create(request);
        Product found = service.findById(savedId);

        // Then - verifies actual save/retrieve behavior
        assertThat(found.getName()).isEqualTo("Product");
    }
}
```

**Practical Tips**

| Test Target | Recommended Approach |
|------------|----------|
| Repository | Real DB (`@DataJpaTest` or Testcontainers) |
| Service | Fake Repository or `@SpringBootTest` |
| Controller | Mock Service (`@WebMvcTest`) |
| External API integration | Mock (WireMock, Mockito) |
- Integration tests: all real objects

</details>

### 3. Test Examples

<details>
<summary>Repository Test (Java)</summary>

```java
@DataJpaTest
class ProductRepositoryTest {

    @Autowired
    private ProductRepository productRepository;

    @Test
    @DisplayName("Product save test")
    void saveProduct() {
        // given
        Product product = new Product("Test Product", 10000);

        // when
        Product saved = productRepository.save(product);

        // then
        assertThat(saved.getId()).isNotNull();
        assertThat(saved.getName()).isEqualTo("Test Product");
    }

    @Test
    @DisplayName("Product find by ID test")
    void findById() {
        // given
        Product product = productRepository.save(new Product("Test Product", 10000));

        // when
        Optional<Product> found = productRepository.findById(product.getId());

        // then
        assertThat(found).isPresent();
        assertThat(found.get().getName()).isEqualTo("Test Product");
    }
}
```

</details>

<details>
<summary>Service Test (Java + Mockito)</summary>

```java
@ExtendWith(MockitoExtension.class)
class ProductServiceTest {

    @Mock
    private ProductRepository productRepository;

    @InjectMocks
    private ProductService productService;

    @Test
    @DisplayName("Product creation test")
    void createProduct() {
        // given
        ProductRequest request = new ProductRequest("Test Product", 10000);
        Product product = new Product(1L, "Test Product", 10000);

        given(productRepository.save(any(Product.class))).willReturn(product);

        // when
        ProductResponse response = productService.create(request);

        // then
        assertThat(response.getName()).isEqualTo("Test Product");
        verify(productRepository, times(1)).save(any(Product.class));
    }
}
```

</details>

<details>
<summary>Controller Test (Java)</summary>

```java
@WebMvcTest(ProductController.class)
class ProductControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ProductService productService;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    @DisplayName("Product creation API test")
    void createProduct() throws Exception {
        // given
        ProductRequest request = new ProductRequest("Test Product", 10000);
        ProductResponse response = new ProductResponse(1L, "Test Product", 10000);

        given(productService.create(any())).willReturn(response);

        // when & then
        mockMvc.perform(post("/api/products")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value(1))
            .andExpect(jsonPath("$.name").value("Test Product"));
    }
}
```

</details>

### 4. Kotlin + Kotest Testing

Kotest is a testing framework for Kotlin that provides various Spec styles.

| Spec | Purpose | Characteristics |
|------|------|------|
| `FunSpec` | General testing | `test("name") { }` format |
| `BehaviorSpec` | BDD style | Given-When-Then structure |
| `DescribeSpec` | Grouped tests | describe-context-it structure |
| `StringSpec` | Simple tests | Tests defined with just strings |

<details>
<summary>Repository Test (Kotlin + Kotest)</summary>

```kotlin
@DataJpaTest
class ProductRepositoryTest(
    private val productRepository: ProductRepository
) : FunSpec({

    test("Save product") {
        // given
        val product = Product(name = "Test Product", price = 10000)

        // when
        val saved = productRepository.save(product)

        // then
        saved.id shouldNotBe null
        saved.name shouldBe "Test Product"
    }
})
```

</details>

<details>
<summary>Service Test (Kotlin + Kotest + MockK)</summary>

```kotlin
class ProductServiceTest : BehaviorSpec({

    val productRepository = mockk<ProductRepository>()
    val productService = ProductService(productRepository)

    Given("a product creation request is given") {
        val request = ProductRequest(name = "Test Product", price = 10000)
        val product = Product(id = 1L, name = "Test Product", price = 10000)

        every { productRepository.save(any()) } returns product

        When("creating a product") {
            val response = productService.create(request)

            Then("the product is created successfully") {
                response.name shouldBe "Test Product"
                verify(exactly = 1) { productRepository.save(any()) }
            }
        }
    }
})
```

</details>

<details>
<summary>Controller Test (Kotlin + Kotest + MockMvc)</summary>

Writing in Kotest style enables more expressive tests.

```kotlin
@WebMvcTest(ProductController::class)
class ProductControllerKotestTest(
    private val mockMvc: MockMvc,
    @MockkBean private val productService: ProductService
) : DescribeSpec({

    val objectMapper = ObjectMapper().registerModule(JavaTimeModule())

    describe("POST /api/v1/products") {
        context("when a valid request is given") {
            it("returns 201 Created with the created product ID") {
                val request = RegisterProductRequest(name = "Test Product", price = 10000)
                every { productService.registerProduct(any()) } returns 1L

                mockMvc.perform(
                    post("/api/v1/products")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request))
                )
                    .andExpect(status().isCreated)
                    .andExpect(jsonPath("$.data").value(1))
            }
        }

        context("when the product name is empty") {
            it("returns 400 Bad Request") {
                val invalidRequest = mapOf("name" to "", "price" to 10000)

                mockMvc.perform(
                    post("/api/v1/products")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(invalidRequest))
                )
                    .andExpect(status().isBadRequest)
            }
        }
    }

    describe("GET /api/v1/products/{productId}") {
        context("when querying with an existing product ID") {
            it("returns 200 OK with product information") {
                val response = FindProductDetailResponse(
                    id = 1L,
                    name = "Test Product",
                    price = 10000,
                    category = ProductCategoryType.FOOD,
                    enabled = true,
                    createdAt = LocalDateTime.now()
                )
                every { productService.findProductDetail(1L) } returns response

                mockMvc.perform(get("/api/v1/products/1"))
                    .andExpect(status().isOk)
                    .andExpect(jsonPath("$.data.name").value("Test Product"))
            }
        }

        context("when querying with a non-existing product ID") {
            it("returns 404 Not Found") {
                every { productService.findProductDetail(999L) } throws NotFoundException()

                mockMvc.perform(get("/api/v1/products/999"))
                    .andExpect(status().isNotFound)
            }
        }
    }
})
```

</details>

> **Tip**: To use `@MockkBean` in Kotlin MockMvc tests, you need the `spring-mockk` dependency.
>
> ```kotlin
> // build.gradle.kts
> testImplementation("com.ninja-squad:springmockk:4.0.2")
> ```

### 5. Spring Security Testing

Use the following methods when testing APIs that require authentication.

<details>
<summary>Using @WithMockUser</summary>

```java
@WebMvcTest(UserController.class)
class UserControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    @WithMockUser(username = "test@test.com", roles = {"USER"})
    void getUserProfile() throws Exception {
        mockMvc.perform(get("/api/users/me"))
            .andExpect(status().isOk());
    }
}
```

</details>

<details>
<summary>Direct SecurityContextHolder Configuration (Kotlin)</summary>

```kotlin
@BeforeEach
fun setUp() {
    SecurityContextHolder.getContext().authentication =
        PreAuthenticatedAuthenticationToken(
            "test@test.com",
            null,
            listOf(SimpleGrantedAuthority("ROLE_USER"))
        )
}
```

</details>

<details>
<summary>Using TestSecurityConfig</summary>

```java
@TestConfiguration
public class TestSecurityConfig {

    @Bean
    public SecurityFilterChain testSecurityFilterChain(HttpSecurity http) throws Exception {
        return http
            .csrf(AbstractHttpConfigurer::disable)
            .authorizeHttpRequests(auth -> auth.anyRequest().permitAll())
            .build();
    }
}
```

```java
@WebMvcTest(UserController.class)
@Import(TestSecurityConfig.class)
class UserControllerTest {
    // test code
}
```

</details>

### 6. Testcontainers (Optional)

Use Testcontainers when testing in an environment identical to the actual DB is needed.

<details>
<summary>H2 vs Testcontainers Selection Criteria</summary>

**H2 In-Memory DB**

| Pros | Cons |
|-----|-----|
| Fast execution speed | Syntax/feature differences from actual DB |
| No separate configuration needed | Cannot test MySQL/PostgreSQL-specific features |
| No additional setup in CI/CD | Compatibility mode is not 100% compatible |

**Testcontainers**

| Pros | Cons |
|-----|-----|
| Same environment as actual DB | Docker required |
| Can test DB-specific features | Container startup time overhead |
| Same query verification as production | Docker setup needed in CI/CD |

**Selection Guide**

- **Use H2**: Most CRUD operations, pre-interview tasks, when fast feedback is needed
- **Use Testcontainers**:
  - When using native queries or DB-specific functions
  - Testing specific features like JSON columns, full-text search
  - When same query plan verification as production is needed

**Recommendation for tasks**

For most pre-interview tasks, **H2 is sufficient**. Only consider Testcontainers when using MySQL/PostgreSQL-specific features.

</details>

<details>
<summary>Testcontainers Configuration</summary>

```groovy
dependencies {
    testImplementation 'org.testcontainers:testcontainers:1.19.0'
    testImplementation 'org.testcontainers:mysql:1.19.0'
    testImplementation 'org.testcontainers:junit-jupiter:1.19.0'
}
```

```java
@SpringBootTest
@Testcontainers
class IntegrationTest {

    @Container
    static MySQLContainer<?> mysql = new MySQLContainer<>("mysql:8.0")
        .withDatabaseName("testdb")
        .withUsername("test")
        .withPassword("test");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", mysql::getJdbcUrl);
        registry.add("spring.datasource.username", mysql::getUsername);
        registry.add("spring.datasource.password", mysql::getPassword);
    }
}
```

</details>

---

## Summary

| Item | Development Environment | Test Environment |
|------|----------|------------|
| **DB** | Docker RDB or H2 | H2 (recommended) or Testcontainers |
| **Profile** | `default` or `local` | `test` |
| **Config file** | `application.yml` | `application-test.yml` |

### Checklist

- [ ] Is the DB connection configuration correct?
- [ ] Is the test H2 configuration separated?
- [ ] Does rollback work correctly in tests?
- [ ] Is mock object usage appropriate?
- [ ] Is the Security configuration not interfering with tests?

<details>
<summary>How Much Test Coverage Should You Have?</summary>

**The Coverage Target Debate**

- **100% advocates**: All code must be tested for safety
- **Pragmatists**: Testing important business logic is sufficient

**The Reality in Practice**

| Item | Typical Target | Notes |
|-----|-------------|-----|
| Overall coverage | 60~80% | Varies by team/project |
| Business logic (Service) | 80~90% | Core logic must be tested |
| Repository | As needed | Test only complex queries |
| Controller | Key scenarios | Happy path + major exceptions |
| Config/Util | Optional | Only when complex logic exists |

**Recommendation for tasks**

In time-limited tasks, **you don't need to test all code**. Write tests in this priority order:

1. **Required**: Core business logic in the Service layer
2. **Recommended**: Complex Querydsl queries, exception handling
3. **Optional**: Controller tests, simple CRUD

**Having tests is better than none**, but meaningless tests (getter/setter tests, etc.) are actually a negative.

```java
// Bad - meaningless test
@Test
void getterTest() {
    Product p = new Product("test", 1000);
    assertThat(p.getName()).isEqualTo("test");
}

// Good - meaningful test
@Test
void throws_exception_when_stock_is_insufficient() {
    Product product = new Product("test", 1000, 5);
    assertThrows(InsufficientStockException.class,
        () -> product.decreaseStock(10));
}
```

</details>

---

The next part covers **API documentation (Swagger)**, **logging strategies**, and **AOP usage**.

[Previous: Part 1 - Core Application Layer](/en/blog/spring-boot-pre-interview-guide-1)
[Next: Part 3 - Documentation & AOP](/en/blog/spring-boot-pre-interview-guide-3)
