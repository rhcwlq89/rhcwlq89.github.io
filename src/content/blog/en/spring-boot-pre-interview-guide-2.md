---
title: "Spring Boot Pre-Interview Guide Part 2: Database & Testing — Environment Split · Test Pyramid · Testcontainers"
description: "Environment-specific DB selection and ddl-auto policies, Memory Repository pitfalls, Test Pyramid annotation choices, choosing between test doubles (Dummy, Stub, Spy, Mock, Fake), and using Testcontainers to catch bugs that H2 dialect differences hide — the second most-flagged area in Spring Boot pre-interview submissions, covered in one post."
pubDate: "2026-01-11T10:00:00+09:00"
lang: en
tags: ["Spring Boot", "JPA", "Testing", "Backend", "Pre-interview"]
heroImage: "../../../assets/SpringBootPreInterviewGuide2.png"
---

## Introduction

Part 1 covered how to split the Controller · Service · Repository · Domain four-layer architecture. The second most common area where reviewers flag submissions is <strong>Database configuration and testing strategy</strong>. Even when the feature works, points get docked when environment DB settings are not separated, all tests use `@SpringBootTest`, or Mocks are scattered without discipline.

Part 2 covers that second axis. Which DB to use per environment, how to set `ddl-auto` per profile, how to choose test annotations to build fast and reliable tests, and how to use Testcontainers to catch bugs that H2 hides.

The target reader is a junior backend developer who already knows Part 1 or has a working grasp of the four-layer structure. After reading this, you should not hesitate on environment DB configuration or test layer selection.

Read [the previous post](/blog/en/spring-boot-pre-interview-guide-1) first if you haven't covered the four-layer foundation yet.

- Part 1 — [Core Application Layer](/blog/en/spring-boot-pre-interview-guide-1)
- <strong>Part 2 — Database & Testing (this post)</strong>
- Part 3 — [Documentation & AOP](/blog/en/spring-boot-pre-interview-guide-3)
- Part 4 — [Performance & Optimization](/blog/en/spring-boot-pre-interview-guide-4)
- Part 5 — [Security & Authentication](/blog/en/spring-boot-pre-interview-guide-5)
- Part 6 — [DevOps & Deployment](/blog/en/spring-boot-pre-interview-guide-6)
- Part 7 — [Advanced Patterns](/blog/en/spring-boot-pre-interview-guide-7)

---

## TL;DR

- <strong>Environment DB selection and ddl-auto are not global settings</strong> — local uses `create-drop` + H2, test uses `create-drop` + H2, staging uses `validate`, production uses `none` + Flyway/Liquibase. Separate each via `application-{profile}.yml`.
- <strong>Memory Repository ≠ JPA Repository</strong> — Use `AtomicLong` for ID generation and return defensive copies from `findById()` to prevent external modifications from corrupting the store. Pagination must be implemented manually too.
- <strong>Test Pyramid — `@SpringBootTest` is the exception, slice tests are the default</strong> — Repository gets `@DataJpaTest`, Controller gets `@WebMvcTest`, pure units get `@ExtendWith(MockitoExtension.class)`. Reserve `@SpringBootTest` for one or two E2E scenarios.
- <strong>Mock at boundaries only; use Fake or real objects internally</strong> — Mock only things you cannot control (external APIs, time). For Services with heavy Repository dependencies, use a Fake Repository instead. Excessive mocking makes tests verify implementation details rather than behavior.
- <strong>Use Testcontainers when H2 dialect differences would mask a bug</strong> — native queries, DB-specific functions, JSON columns: validate with a real MySQL/PostgreSQL container. For pure CRUD pre-interview tasks, H2 is sufficient.

---

## 1. Database Environment Matrix — Local · Test · Production Split

### 1.1 DB Selection Criteria per Environment

The DB choice and `ddl-auto` policy must differ per environment. Use the table below as the reference.

| Environment | DB Choice | ddl-auto | Profile | Reason |
|-------------|----------|----------|---------|--------|
| Local development | H2 or Docker RDB | `create-drop` (H2) / `update` (RDB) | `local` | Fast iteration, auto schema creation |
| Test | H2 | `create-drop` | `test` | Clean state guaranteed for every test run |
| Staging | Docker RDB (MySQL/PostgreSQL) | `validate` | `staging` | Catch schema mismatches early |
| Production | RDS / Cloud DB | `none` | `prod` | Schema changes through migration tools only |

### 1.2 application.yml Pattern — Base + H2 + Docker RDB

Put shared settings in `application.yml` and override the DB per profile. This is the standard pattern.

```mermaid
flowchart LR
    Base["application.yml<br/>(Shared JPA options)"]

    subgraph Profiles["Profile overrides"]
        Local["application-local.yml<br/>H2 or Docker RDB"]
        Test["application-test.yml<br/>H2 in-memory"]
        Staging["application-staging.yml<br/>MySQL / PostgreSQL"]
        Prod["application-prod.yml<br/>RDS / Cloud DB"]
    end

    Base --> Local
    Base --> Test
    Base --> Staging
    Base --> Prod
```

**Shared config (application.yml)**

```yaml
spring:
  jpa:
    show-sql: true
    properties:
      hibernate:
        format_sql: true
        default_batch_fetch_size: 100
    open-in-view: false
```

**Local H2 config (application-local.yml)**

```yaml
spring:
  datasource:
    url: jdbc:h2:mem:localdb;DB_CLOSE_DELAY=-1
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
```

**Test H2 config (application-test.yml)**

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
    show-sql: false
```

**Docker RDB config (application-staging.yml example)**

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/app
    driver-class-name: com.mysql.cj.jdbc.Driver
    username: app
    password: secret
  jpa:
    hibernate:
      ddl-auto: validate
```

<details>
<summary><strong>docker-compose.yml (MySQL + PostgreSQL)</strong></summary>

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

### 1.3 ddl-auto and Migration Tools — Production Safety Guide

<strong>ddl-auto</strong> controls what Hibernate does with the schema at application startup.

| Value | Behavior | Environment |
|-------|----------|-------------|
| `create` | Drops and recreates tables at startup (destroys existing data) | Never in production |
| `create-drop` | Creates at startup, drops at shutdown | Local and test |
| `update` | Applies schema changes (cannot drop columns) | Local only, never production |
| `validate` | Validates entity-to-table mapping only | Staging |
| `none` | Does nothing | Production |

The graduation point from `ddl-auto` is clear: <strong>as soon as a team shares a database, use a migration tool.</strong>

| Aspect | Flyway | Liquibase |
|--------|--------|-----------|
| Migration style | SQL file-based | XML/YAML/JSON/SQL |
| File naming | `V1__init.sql`, `V2__add_column.sql` | `changelog.xml` |
| Rollback | Paid version | Free version |
| Learning curve | Low (SQL only) | Medium (abstraction layer) |
| Spring Boot integration | `spring-boot-starter-flyway` | `spring-boot-starter-liquibase` |

> <strong>Note</strong>: For a pre-interview task you don't need to introduce a migration tool. `create-drop` for local/test and `validate` for a Docker RDB is sufficient. However, be ready to explain why `update` must never be used in production.

### 1.4 Aside: Memory Repository Implementation Pitfalls

When the task requires a "pure in-memory store," there are three common traps.

**1. ID generation — use `AtomicLong`**

```java
// Bad — race condition
private long sequence = 0;
product.setId(++sequence);

// Good
private final AtomicLong sequence = new AtomicLong(0);
product.setId(sequence.incrementAndGet());
```

**2. Defensive copy — never expose the stored reference directly**

```java
// Dangerous — external callers can mutate the stored object
return store.get(id);

// Safe — return a copy
return store.get(id).copy();  // or new Product(store.get(id))
```

JPA relies on the persistence context to track changes. A Memory Repository has no such mechanism. Without a defensive copy, tests can corrupt the store's state.

**3. Pagination — must be implemented manually**

```java
public Page<Product> findAll(Pageable pageable) {
    List<Product> all = new ArrayList<>(store.values());
    int start = (int) pageable.getOffset();
    int end = Math.min(start + pageable.getPageSize(), all.size());
    return new PageImpl<>(all.subList(start, end), pageable, all.size());
}
```

| Aspect | Memory Repository | JPA Repository |
|--------|:-----------------:|:--------------:|
| ID auto-generation | `AtomicLong`, manual | `@GeneratedValue` |
| Change tracking | Defensive copy needed | Persistence context |
| Pagination | `PageImpl`, manual | Spring Data provided |

---

## 2. JPA & Querydsl Configuration

### 2.1 Core application.yml Options

These are the JPA options that belong in the shared `application.yml`. Understanding *why* each one is set matters more than memorizing the values.

| Option | Recommended value | Reason |
|--------|------------------|--------|
| `show-sql` | `true` (dev), `false` (prod) | SQL visibility — performance and security concern in production |
| `format_sql` | `true` | Query readability |
| `default_batch_fetch_size` | `100` | Mitigates N+1 by batching fetches into IN queries |
| `open-in-view` | `false` | Disabling OSIV exposes lazy-loading exceptions at the boundary they actually occur |
| Naming strategy | default (snake_case) | Entity field names automatically map to column names |

> <strong>Note</strong>: `open-in-view` defaults to `true`. With `true`, the persistence context stays open for the full HTTP request, making lazy loading freely available — but it holds a DB connection longer. For pre-interview tasks, setting it to `false` and handling all necessary associations with fetch joins inside the Service layer earns better marks.

### 2.2 When to Introduce Querydsl and Q-Class Generation

<strong>Querydsl</strong> is a library that lets you write type-safe JPQL using a builder pattern.

| Criteria | Spring Data JPA methods only | Querydsl needed |
|----------|:----------------------------:|:---------------:|
| 1–2 fixed conditions | ✅ | — |
| 3+ conditions or dynamic | — | ✅ |
| Aggregates, subqueries, multi-join | — | ✅ |
| Dynamic sort or pagination | — | ✅ |

**JPAQueryFactory bean registration (Kotlin)**

```kotlin
@Configuration(proxyBeanMethods = false)
class QuerydslConfig(
    private val entityManager: EntityManager
) {
    @Bean
    fun jpaQueryFactory(): JPAQueryFactory = JPAQueryFactory(entityManager)
}
```

**build.gradle.kts dependencies**

```kotlin
dependencies {
    implementation("com.querydsl:querydsl-jpa:5.0.0:jakarta")
    kapt("com.querydsl:querydsl-apt:5.0.0:jakarta")
}
```

Q-Classes are auto-generated by `kapt` at build time by scanning entity classes. Generated output lands in `build/generated/source/kapt/main` — add this path to `.gitignore`.

### 2.3 Aside: What `@Configuration(proxyBeanMethods = false)` Means

> <strong>Bottom line</strong>: for new configuration classes, default to `proxyBeanMethods = false`. The default (`true`) is only needed when one `@Bean` method's body directly calls another `@Bean` method in the same class — and that pattern is itself an anti-pattern. Inject dependencies as method parameters instead, and `false` is always safe and lighter. This is why every Spring Boot auto-configuration uses `false`.

<strong>`proxyBeanMethods`</strong> controls whether Spring wraps the `@Configuration` class with a CGLIB proxy. The default is `true` (Full mode); setting it to `false` switches to Lite mode. The name suggests a simple optimization toggle, but the flag actually changes the *meaning* of `@Bean` method calls inside the class. The mechanics below explain why.

<strong>Full mode (default) — what the CGLIB proxy does</strong>

When the context starts, CGLIB generates a runtime subclass of the `@Configuration` class. That subclass overrides every `@Bean` method to intercept calls. Each overridden method behaves as follows:

1. If a singleton with the same bean name is already registered in the BeanFactory, return the cached instance instead of invoking the original method.
2. Otherwise, call `super.<beanMethod>()` once, register the result in the BeanFactory, and return it.

This is what guarantees singleton semantics even when `@Bean` methods reference each other (inter-bean method references).

```kotlin
@Configuration  // proxyBeanMethods = true (default)
class AppConfig {
    @Bean fun repo(): Repo = Repo()
    @Bean fun service(): Service = Service(repo())  // ← proxy intercepts, returns cached Repo
}
```

The `repo()` call inside `service()` looks like a plain method call, but it's actually routed through the CGLIB subclass's overridden `repo()`. No matter how many times `repo()` is invoked, the same instance comes back.

<strong>Lite mode (`proxyBeanMethods = false`) — no proxy at all</strong>

`@Bean` methods become plain factory methods that the container calls once each. If you call another `@Bean` method directly from inside the class, that's a real same-class method call — and it creates a new instance every time.

```kotlin
@Configuration(proxyBeanMethods = false)
class AppConfig {
    @Bean fun repo(): Repo = Repo()
    @Bean fun service(): Service = Service(repo())  // ← no proxy → fresh Repo!
}
```

You'd end up with one `repo` bean registered by the container *and* a separate `Repo` that `service()` constructed by hand. That's why Lite mode is unsafe in the presence of inter-bean calls.

Inject dependencies as method parameters instead — the container will resolve them.

```kotlin
@Configuration(proxyBeanMethods = false)
class AppConfig {
    @Bean fun repo(): Repo = Repo()
    @Bean fun service(repo: Repo): Service = Service(repo)  // ← container injects
}
```

<strong>Full vs Lite at a glance</strong>

| Aspect | Full mode (default) | Lite mode (`false`) |
|--------|---------------------|---------------------|
| CGLIB proxy | Generated | Not generated |
| Inter-bean method call | Singleton guaranteed | New instance every time |
| Class constraints | Cannot be `final`, needs no-arg constructor | None (`final`, `data class`, `private constructor` all OK) |
| Startup time | Slower by the proxy generation cost | Faster |
| Memory | Extra subclass per configuration | None |
| When to use | Traditional configs with inter-bean calls | Plain bean registration with parameter injection |

<strong>So how should you actually use it?</strong>

| Situation | Setting |
|-----------|---------|
| Writing new code | <strong>`proxyBeanMethods = false`</strong>. Inject dependencies via method parameters. |
| The rare case where a `@Bean` body must directly call another `@Bean` | Default (`true`) — but refactoring to parameter injection is almost always better |
| Legacy configs that already contain inter-bean calls | Default (`true`) — switch to `false` only after refactoring those calls into parameter injection |

<strong>One-line check</strong>: does any `@Bean` method's body directly call another `@Bean` method in the same class? No (the usual case) → use `false`. Yes → use the default, or refactor.

The `QuerydslConfig` above registers a single `@Bean`, so it is trivially safe. The same reasoning explains why nearly all of Spring Boot's auto-configurations use `proxyBeanMethods = false` — each class typically registers one or two beans and pulls dependencies in through parameters. The startup speedup is negligible per class, but with hundreds of auto-configuration classes the savings add up to something measurable.

---

## 3. Test Pyramid — Choosing the Right Annotation

### 3.1 Test Pyramid

Tests follow a pyramid structure: more tests at the base (fast, isolated), fewer at the top (slow, broad).

```mermaid
flowchart TB
    Integration["Integration tests<br/>@SpringBootTest<br/>— slow, few"]
    Slice["Slice tests<br/>@DataJpaTest · @WebMvcTest<br/>— medium speed, most tests"]
    Unit["Unit tests<br/>@ExtendWith(MockitoExtension)<br/>— fast, most numerous"]

    Integration --> Slice
    Slice --> Unit
```

The most common mistake in pre-interview submissions is writing every test with `@SpringBootTest`. It loads the full ApplicationContext — slow and heavy. Use slice tests by default and reserve `@SpringBootTest` for key E2E scenarios.

### 3.2 Annotation Comparison

| Annotation | What loads | Speed | When to use |
|-----------|-----------|-------|-------------|
| `@ExtendWith(MockitoExtension.class)` | Nothing (pure JUnit) | Fastest | Pure logic with no dependencies |
| `@DataJpaTest` | JPA beans only | Fast | Repository query verification |
| `@WebMvcTest` | MVC beans only | Fast | Controller HTTP response verification |
| `@SpringBootTest` | Full context | Slow | E2E, multi-layer integration |

Both `@DataJpaTest` and `@WebMvcTest` apply `@Transactional` by default, rolling back after each test.

### 3.3 Test Doubles — Dummy, Stub, Spy, Mock, Fake

The first principle of testing: <strong>use the real object whenever you can.</strong> When a real dependency cannot be used (external APIs, time, message queues, email delivery, etc.), substitute a stand-in — collectively known as <strong>test doubles</strong>. People casually say "Mock" for all of them, but there are actually five distinct kinds with different uses.

| Kind | One-line definition | Typical example |
|------|---------------------|-----------------|
| Dummy | Object that only fills a parameter slot, never invoked | `null`, an empty placeholder |
| Stub | Returns canned values | Mockito `when().thenReturn()` |
| Spy | Wraps a real object; records calls and lets you stub a subset | Mockito `@Spy`, `spy()` |
| Mock | Verifies calls themselves (count, arguments) | Mockito `@Mock` + `verify()` |
| Fake | A simplified working implementation (in-memory, etc.) | Hand-written `FakeProductRepository` |

<strong>Stub vs Mock — same library, different intent</strong>

Mockito's `mock()` does not distinguish between Stub and Mock at the library level. The distinction comes from whether you call `verify()`.

- Define the return value but do not assert on calls → <strong>Stub</strong>
- Use `verify()` to assert call count and arguments → <strong>Mock</strong>

```kotlin
// Stub — freezes time. We don't care that it was called.
val clock = mock<Clock>()
whenever(clock.now()).thenReturn(Instant.parse("2026-01-01T00:00:00Z"))

// Mock — the point is that the email was sent with these exact arguments
val mailer = mock<Mailer>()
service.signUp(request)
verify(mailer).send(eq("welcome"), eq(request.email))
```

Side-effect boundaries — external APIs, mail delivery, message queues — naturally fit Mocks. Pure value-fetching dependencies are usually fine as Stubs.

<strong>Spy — wraps a real object and intercepts only part of it</strong>

A Spy keeps the real object's behavior while letting you override a subset of its methods or assert on call history. If a Mock is "an empty shell from the start," a Spy is "a thin layer of fakery laid over a real object."

```kotlin
val realRepo = JpaProductRepository(em)
val spy = spy(realRepo)

doReturn(emptyList<Product>()).whenever(spy).findAll()  // stub a subset
spy.save(product)                                        // remaining methods stay real
verify(spy).save(product)                                // call history is also verifiable
```

When a Spy fits:

- Legacy code where you want to replace just one or two methods and let the rest behave normally.
- You need call-history verification, but mocking the whole class would explode the stub setup.

> <strong>Caution</strong>: if Spies show up frequently in new code, that's a design smell. The class likely has too many responsibilities or its dependency boundaries are wrong. First consider extracting an interface and substituting a Mock or Fake, or splitting the responsibilities.

<strong>Fake — a simplified working implementation</strong>

Implements the interface for real, but backed by memory (or a simple data structure). For dependencies with many calls and read-after-write semantics — like a Repository — a Fake usually beats a Mock. The anti-pattern below shows why.

<strong>Real object</strong>

Validate Repositories with `@DataJpaTest` + real H2 or Testcontainers. Domain layer value objects and entities should almost always be tested as themselves.

**Anti-pattern: excessive mocking**

```java
// Bad — test only verifies implementation details, not behavior
given(repository.save(any())).willReturn(product);
given(repository.findById(1L)).willReturn(Optional.of(product));

Product saved = service.create(request);
Product found = service.find(1L);

// Always passes because Mock returns the same object we configured
// The actual save/find logic is never exercised
assertThat(found.getId()).isEqualTo(saved.getId());
```

**Fixed with a Fake Repository**

First, what `FakeProductRepository` actually is. It implements the same JPA Repository interface, but it's backed by a `Map` instead of a database.

```java
class FakeProductRepository implements ProductRepository {
    private final Map<Long, Product> store = new HashMap<>();
    private long sequence = 0L;

    @Override
    public Product save(Product product) {
        long id = product.getId() != null ? product.getId() : ++sequence;
        Product saved = new Product(id, product.getName(), product.getPrice());
        store.put(id, saved);
        return saved;
    }

    @Override
    public Optional<Product> findById(Long id) {
        return Optional.ofNullable(store.get(id));
    }
}
```

This fake honors the real Repository's core contract without a database — <strong>save assigns an ID, and reading by that ID returns the same data back</strong>. Wiring it into the Service test:

```java
// Good — exercises actual save/find behavior
class ProductServiceTest {
    private ProductService service;
    private FakeProductRepository repository;

    @BeforeEach
    void setUp() {
        repository = new FakeProductRepository();
        service = new ProductService(repository);
    }

    @Test
    void save_and_retrieve_product() {
        CreateProductRequest request = new CreateProductRequest("Product", 1000);

        Long savedId = service.create(request);
        Product found = service.findById(savedId);

        assertThat(found.getName()).isEqualTo("Product");
    }
}
```

What the test actually exercises:

1. `service.create(request)` → calls `repository.save(product)` → the Fake assigns an ID, puts the entity in `store`, returns the saved Product → Service hands the ID back to the caller.
2. `service.findById(savedId)` → calls `repository.findById(savedId)` → the Fake pulls the same entry out of `store`.
3. The retrieved Product's `name` is asserted to match the original `"Product"`.

For the assertion to pass, `ProductService` has to do all three of the following correctly:

- (a) Carry `request.name` into the new Product on the way in.
- (b) Pull the ID out of the `save` result and return it to the caller.
- (c) Pass the same ID through to `findById`.

Drop any of the three and the test breaks. If the Service accidentally stored an empty string for the name, the final `assertThat` would fail.

The Mock version above, in contrast, has both `save()` and `findById()` stubbed to return the same pre-built `product`. That means even if `ProductService` ignored the request entirely and constructed an empty Product, the test would still pass. <strong>This is concretely what "only verifies implementation details" means — when the Mock's return value is already the answer, the actual logic can do anything and the test reaches the same result.</strong>

| Test target | Recommended approach |
|------------|---------------------|
| Repository | Real DB (`@DataJpaTest` or Testcontainers) |
| Service | Fake Repository or `@SpringBootTest` |
| Controller | Mock Service (`@WebMvcTest`) |
| External API | Mock (WireMock, Mockito) |
| Time / randomness | Stub (inject `Clock`, `Random` and pin the values) |
| Domain objects (VOs, entities) | Real object |
| Legacy partial replacement | Spy (temporary — refactor toward Mock/Fake) |

---

## 4. Layer-by-Layer Test Patterns

### 4.1 Repository — Query Verification with `@DataJpaTest`

**Java**

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

**Kotlin + Kotest FunSpec**

```kotlin
@DataJpaTest
class ProductRepositoryTest(
    private val productRepository: ProductRepository
) : FunSpec({

    test("Save product") {
        val product = Product(name = "Test Product", price = 10000)
        val saved = productRepository.save(product)

        saved.id shouldNotBe null
        saved.name shouldBe "Test Product"
    }
})
```

### 4.2 Service — Mock vs Fake Trade-offs

**Java + Mockito (Mock approach)**

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

**Kotlin + MockK BehaviorSpec (Mock approach)**

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

**Fake Repository pattern — suited for Services with heavy Repository dependencies**

```java
class ProductServiceFakeTest {
    private ProductService service;
    private FakeProductRepository repository;

    @BeforeEach
    void setUp() {
        repository = new FakeProductRepository();
        service = new ProductService(repository);
    }

    @Test
    void save_and_retrieve_product() {
        Long savedId = service.create(new CreateProductRequest("Product", 1000));
        Product found = service.findById(savedId);
        assertThat(found.getName()).isEqualTo("Product");
    }
}
```

A Fake Repository implements the `ProductRepository` interface using an in-memory store. Unlike a Mock, actual save and retrieve operations occur — so "save then find" scenarios are validated naturally.

### 4.3 Controller — `@WebMvcTest` + MockMvc

**Java**

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

**Kotlin + Kotest DescribeSpec**

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
})
```

> <strong>Note</strong>: To use `@MockkBean` in Kotlin MockMvc tests, the `spring-mockk` dependency is required.
>
> ```kotlin
> // build.gradle.kts
> testImplementation("com.ninja-squad:springmockk:4.0.2")
> ```

### 4.4 Aside: Kotlin + Kotest BDD Style — Choosing a Spec

<strong>Kotest</strong> is Kotlin's test framework. Unlike JUnit, it offers multiple Spec styles.

| Spec | Style | Best for |
|------|-------|----------|
| `FunSpec` | `test("name") { }` | Simple unit tests (Repository) |
| `BehaviorSpec` | Given-When-Then | Scenario-based tests (Service) |
| `DescribeSpec` | describe-context-it | Grouped API endpoint tests (Controller) |
| `StringSpec` | `"name" { }` | Very simple tests |

The right time to introduce Kotest in a Kotlin project is when <strong>expressive BDD-style grouping is needed</strong>. Both `@DataJpaTest` and `@WebMvcTest` integrate cleanly with Kotest Specs.

---

## 5. Testcontainers — Verifying Against the Real Database

### 5.1 H2's Limits — Bugs Hidden by MySQL/PostgreSQL Dialect Differences

H2 is fast and requires no setup, but it is not identical to MySQL or PostgreSQL. In these situations, H2 tests pass while production breaks.

| Situation | Example |
|-----------|---------|
| Native queries | `SELECT * FROM product USE INDEX (idx_name)` — silently ignored in H2 |
| DB-specific functions | `DATE_FORMAT()`, `JSON_EXTRACT()` — not supported in H2 |
| Full-text search | `MATCH AGAINST` — not supported in H2 |
| `ON DUPLICATE KEY UPDATE` | MySQL-only syntax |
| Index hints / query plans | H2 produces a different execution plan |

### 5.2 Testcontainers Setup

**Dependencies (build.gradle)**

```groovy
dependencies {
    testImplementation 'org.testcontainers:testcontainers:1.19.0'
    testImplementation 'org.testcontainers:mysql:1.19.0'
    testImplementation 'org.testcontainers:junit-jupiter:1.19.0'
}
```

**Test class configuration**

```java
@SpringBootTest
@Testcontainers
class ProductIntegrationTest {

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

    @Test
    void native_query_verification() {
        // Test queries that only work correctly on real MySQL
    }
}
```

### 5.3 When to Apply — Always vs Critical Paths Only

Testcontainers is much slower than slice tests due to container startup time. Use these criteria to scope adoption.

| Criteria | H2 sufficient | Testcontainers needed |
|----------|:-------------:|:---------------------:|
| CRUD, simple JPQL | ✅ | — |
| Native queries, DB-specific functions | — | ✅ |
| JSON columns, full-text search | — | ✅ |
| Production-equivalent query plan | — | ✅ |
| Pre-interview CRUD task | ✅ | — |

> <strong>Note</strong>: Testcontainers requires Docker on the CI runner. On GitHub Actions, `ubuntu-latest` runners include Docker by default — no additional configuration needed.

---

## Recap

- <strong>Separate DB and ddl-auto per environment</strong> — use `application-{profile}.yml` to give each environment its own DB and ddl-auto policy. `create` and `update` in production are never acceptable.
- <strong>Memory Repository must mimic JPA</strong> — `AtomicLong` for ID generation, defensive copies on return, and manual `PageImpl` for pagination. Skip any of these and tests will silently corrupt state or fail to mirror JPA behavior.
- <strong>The Test Pyramid keeps the suite fast and maintainable</strong> — `@DataJpaTest` for Repositories, `@WebMvcTest` for Controllers, `@ExtendWith(MockitoExtension.class)` for pure logic. Limit `@SpringBootTest` to one or two E2E scenarios.
- <strong>Mock at boundaries; use Fake for internal Repository dependencies</strong> — Mock only what you cannot control. For Services with Repository-heavy flows, a Fake Repository exercises actual save/find behavior.
- <strong>Testcontainers catches what H2 hides</strong> — wire in a real MySQL/PostgreSQL container via `@DynamicPropertySource` whenever native queries or DB-specific features are in play.

Part 3 covers API documentation (Swagger/OpenAPI), cross-cutting concern handling with AOP, and logging infrastructure. You'll see why Swagger is more than just annotating endpoints, and how `@Around` AOP cleanly separates logging and performance measurement from business logic.

[Previous: Part 1 - Core Application Layer](/blog/en/spring-boot-pre-interview-guide-1) | [Next: Part 3 - Documentation & AOP](/blog/en/spring-boot-pre-interview-guide-3)

---

## Appendix

### Meaningful Tests vs Meaningless Tests

Tests are better than no tests, but meaningless tests raise maintenance cost without benefit.

| Category | Example | Reason |
|----------|---------|--------|
| Meaningless | Assert getter/setter round-trip | The compiler already guarantees this |
| Meaningless | `new Product("test", 1000)` then check `getName()` | No logic involved |
| Meaningful | Exception thrown when stock is insufficient | Verifies a business rule |
| Meaningful | Unique constraint violation on duplicate name | Verifies a DB constraint |

```java
// Bad — meaningless test
@Test
void getterTest() {
    Product p = new Product("test", 1000);
    assertThat(p.getName()).isEqualTo("test");
}

// Good — meaningful test
@Test
void throws_when_stock_is_insufficient() {
    Product product = new Product("test", 1000, 5);
    assertThrows(InsufficientStockException.class,
        () -> product.decreaseStock(10));
}
```

### Coverage Guide

<details>
<summary><strong>More detail — coverage targets and pre-interview priorities</strong></summary>

Coverage targets vary by team and project. General benchmarks:

| Layer | Typical target | Notes |
|-------|---------------|-------|
| Service (business logic) | 80–90% | Core logic must be covered |
| Repository | Complex queries only | Simple CRUD is optional |
| Controller | Key scenarios | Happy path + main exceptions |
| Config / Util | Optional | Only if complex logic present |
| Overall | 60–80% | Depends on team agreement |

For a time-constrained pre-interview task, follow this priority order:

1. <strong>Required</strong>: Core business logic in the Service layer (including exception paths)
2. <strong>Recommended</strong>: Complex Querydsl queries, exception handling
3. <strong>Optional</strong>: Controller tests, simple CRUD Repository tests

</details>
