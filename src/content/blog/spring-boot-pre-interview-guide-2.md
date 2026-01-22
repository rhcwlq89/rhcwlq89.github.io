---
title: "Spring Boot Pre-interview Task Guide 2"
description: "Pre-interview 과제에서 자주 나오는 유형과 체크 포인트 정리"
pubDate: 2026-01-19
tags: ["Spring Boot", "REST API", "Backend", "Interview"]
heroImage: "../../assets/PreinterviewTaskGuide2.png"
---

## 서론

[1편](/blog/spring-boot-pre-interview-guide-1)에 이어서 Spring Boot 기반의 Pre-interview 과제에서 체크 포인트를 정리합니다.

2편에서는 **Database Configuration**과 **Test 환경**을 중심으로 설명합니다.

### 목차
- [Database Config](#database-config)
- [Test](#test)
- [정리](#정리)

---

## Database Config

일반적으로 과제에서 제시하는 DB는 세 가지다.
- Memory 기반 RDB (H2)
- 순수 Memory 저장소 (HashMap 등)
- Docker 기반 RDB (MySQL, PostgreSQL 등)

### 1. 공통 설정 (application.yml)

DB 접속 정보 (url, jdbc driver, username, password)를 설정한다.
순수 Memory 저장소 사용 시에는 별도 설정이 불필요하다.

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

> **Tip**: `ddl-auto` 옵션
> - `create`: 시작 시 테이블 새로 생성
> - `create-drop`: 시작 시 생성, 종료 시 삭제
> - `update`: 변경된 스키마만 반영
> - `validate`: 엔티티와 테이블 매핑 검증만 수행
> - `none`: 아무 작업도 하지 않음

### 2. H2 설정

H2는 인메모리 데이터베이스로, 별도 설치 없이 사용할 수 있어 과제에서 자주 활용된다.

<details>
<summary>application.yml (H2 설정)</summary>

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
    // Spring Boot 4.x 이상에서는 별도 의존성 필요
    runtimeOnly 'org.springframework.boot:spring-boot-h2console'
}
```

</details>

> **주의**: H2 콘솔 접속 시 JDBC URL이 `jdbc:h2:mem:testdb`와 정확히 일치하는지 확인한다.

### 3. Memory DB 설정 (HashMap)

순수 메모리 저장소 사용 시 별도 설정이 불필요하다.
Repository 구현체에서 직접 메모리 저장 로직을 작성한다.

<details>
<summary>MemoryRepository 구현 예시</summary>

```java
@Repository
public class MemoryProductRepository implements ProductRepository {

    // 동시성 처리를 위해 ConcurrentHashMap 사용
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

> **Tip**: 컬렉션 선택 가이드
> - `ConcurrentHashMap`: 일반적인 key-value 저장 (권장)
> - `ConcurrentSkipListMap`: 정렬이 필요한 경우
> - `CopyOnWriteArrayList`: 읽기가 많고 쓰기가 적은 경우

### 4. Docker 기반 RDB 설정

Docker Compose로 MySQL, PostgreSQL 등을 구성한다.
과제의 경우 대부분 단일 DB만 사용하므로 application.yml에 접속 정보만 설정하면 된다.

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

### 5. Querydsl 설정

복잡한 동적 쿼리가 필요한 경우 Querydsl을 사용한다.

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

<details>
<summary>build.gradle.kts (Querydsl 의존성)</summary>

```kotlin
dependencies {
    implementation("com.querydsl:querydsl-jpa:5.0.0:jakarta")
    kapt("com.querydsl:querydsl-apt:5.0.0:jakarta")
}
```

</details>

---

## Test

### 1. Test DB 설정

테스트 환경에서는 H2를 사용하는 것이 일반적이다.
Profile 분리 또는 별도 yaml 파일을 사용할 수 있다.

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

### 2. 테스트 어노테이션 가이드

| 어노테이션 | 용도 | 특징 |
|-----------|------|------|
| `@DataJpaTest` | Repository 테스트 | JPA 관련 빈만 로드, 자동 롤백 |
| `@WebMvcTest` | Controller 테스트 | MVC 관련 빈만 로드 |
| `@SpringBootTest` | 통합 테스트 | 전체 컨텍스트 로드 |
| `@Transactional` | 테스트 롤백 | 테스트 종료 후 자동 롤백 |

### 3. 테스트 예제

<details>
<summary>Repository 테스트 (Java)</summary>

```java
@DataJpaTest
class ProductRepositoryTest {

    @Autowired
    private ProductRepository productRepository;

    @Test
    @DisplayName("상품 저장 테스트")
    void saveProduct() {
        // given
        Product product = new Product("테스트 상품", 10000);

        // when
        Product saved = productRepository.save(product);

        // then
        assertThat(saved.getId()).isNotNull();
        assertThat(saved.getName()).isEqualTo("테스트 상품");
    }

    @Test
    @DisplayName("상품 조회 테스트")
    void findById() {
        // given
        Product product = productRepository.save(new Product("테스트 상품", 10000));

        // when
        Optional<Product> found = productRepository.findById(product.getId());

        // then
        assertThat(found).isPresent();
        assertThat(found.get().getName()).isEqualTo("테스트 상품");
    }
}
```

</details>

<details>
<summary>Service 테스트 (Java + Mockito)</summary>

```java
@ExtendWith(MockitoExtension.class)
class ProductServiceTest {

    @Mock
    private ProductRepository productRepository;

    @InjectMocks
    private ProductService productService;

    @Test
    @DisplayName("상품 생성 테스트")
    void createProduct() {
        // given
        ProductRequest request = new ProductRequest("테스트 상품", 10000);
        Product product = new Product(1L, "테스트 상품", 10000);

        given(productRepository.save(any(Product.class))).willReturn(product);

        // when
        ProductResponse response = productService.create(request);

        // then
        assertThat(response.getName()).isEqualTo("테스트 상품");
        verify(productRepository, times(1)).save(any(Product.class));
    }
}
```

</details>

<details>
<summary>Controller 테스트 (Java)</summary>

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
    @DisplayName("상품 생성 API 테스트")
    void createProduct() throws Exception {
        // given
        ProductRequest request = new ProductRequest("테스트 상품", 10000);
        ProductResponse response = new ProductResponse(1L, "테스트 상품", 10000);

        given(productService.create(any())).willReturn(response);

        // when & then
        mockMvc.perform(post("/api/products")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value(1))
            .andExpect(jsonPath("$.name").value("테스트 상품"));
    }
}
```

</details>

### 4. Kotlin + Kotest 테스트

Kotest는 Kotlin에서 사용하는 테스트 프레임워크로, 다양한 Spec 스타일을 제공한다.

| Spec | 용도 | 특징 |
|------|------|------|
| `FunSpec` | 일반적인 테스트 | `test("name") { }` 형태 |
| `BehaviorSpec` | BDD 스타일 | Given-When-Then 구조 |
| `DescribeSpec` | 그룹화된 테스트 | describe-context-it 구조 |
| `StringSpec` | 간단한 테스트 | 문자열만으로 테스트 정의 |

<details>
<summary>Repository 테스트 (Kotlin + Kotest)</summary>

```kotlin
@DataJpaTest
class ProductRepositoryTest(
    private val productRepository: ProductRepository
) : FunSpec({

    test("상품 저장") {
        // given
        val product = Product(name = "테스트 상품", price = 10000)

        // when
        val saved = productRepository.save(product)

        // then
        saved.id shouldNotBe null
        saved.name shouldBe "테스트 상품"
    }
})
```

</details>

<details>
<summary>Service 테스트 (Kotlin + Kotest + MockK)</summary>

```kotlin
class ProductServiceTest : BehaviorSpec({

    val productRepository = mockk<ProductRepository>()
    val productService = ProductService(productRepository)

    Given("상품 생성 요청이 주어졌을 때") {
        val request = ProductRequest(name = "테스트 상품", price = 10000)
        val product = Product(id = 1L, name = "테스트 상품", price = 10000)

        every { productRepository.save(any()) } returns product

        When("상품을 생성하면") {
            val response = productService.create(request)

            Then("상품이 정상적으로 생성된다") {
                response.name shouldBe "테스트 상품"
                verify(exactly = 1) { productRepository.save(any()) }
            }
        }
    }
})
```

</details>

### 5. Spring Security 테스트

인증이 필요한 API 테스트 시 다음 방법을 사용한다.

<details>
<summary>@WithMockUser 사용</summary>

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
<summary>SecurityContextHolder 직접 설정 (Kotlin)</summary>

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
<summary>TestSecurityConfig 사용</summary>

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
    // 테스트 코드
}
```

</details>

### 6. Testcontainers (선택)

실제 DB와 동일한 환경에서 테스트가 필요한 경우 Testcontainers를 사용한다.

<details>
<summary>Testcontainers 설정</summary>

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

## 정리

| 항목 | 개발 환경 | 테스트 환경 |
|------|----------|------------|
| **DB** | Docker RDB 또는 H2 | H2 (권장) 또는 Testcontainers |
| **Profile** | `default` 또는 `local` | `test` |
| **설정 파일** | `application.yml` | `application-test.yml` |

### 체크리스트

- [ ] DB 연결 설정이 올바른가?
- [ ] 테스트용 H2 설정이 분리되어 있는가?
- [ ] 테스트에서 롤백이 정상 동작하는가?
- [ ] Mock 객체 사용이 적절한가?
- [ ] Security 설정이 테스트를 방해하지 않는가?

---

다음 편에서는 **API 문서화(Swagger)**, **로깅 전략**, **AOP 활용**에 대해 다룹니다.

👉 [Spring Boot Pre-interview Task Guide 1](/blog/spring-boot-pre-interview-guide-1)
👉 [Spring Boot Pre-interview Task Guide 3](/blog/spring-boot-pre-interview-guide-3)
