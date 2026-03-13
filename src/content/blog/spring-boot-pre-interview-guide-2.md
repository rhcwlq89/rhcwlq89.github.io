---
title: "스프링 사전과제 가이드 2편: Database & Testing"
description: "H2/MySQL 설정, JPA 엔티티 매핑, 테스트 전략(단위·통합·슬라이스)을 실무 예제와 함께 정리한 Spring Boot 사전과제 가이드"
pubDate: 2026-01-11T10:00:00+09:00
tags: ["Spring Boot", "JPA", "Testing", "Backend", "사전과제"]
heroImage: "../../assets/PreinterviewTaskGuide.png"
---

## 시리즈 네비게이션

| 이전 | 현재 | 다음 |
|:---:|:---:|:---:|
| [1편: Core Layer](/blog/spring-boot-pre-interview-guide-1) | **2편: DB & Testing** | [3편: Documentation & AOP](/blog/spring-boot-pre-interview-guide-3) |

> 📚 **전체 로드맵**: [스프링 사전과제 가이드 로드맵](/blog/spring-boot-pre-interview-guide-1) 참고

---

## 서론

1편에서 다룬 계층 구조를 기반으로, 이번 편에서는 데이터베이스 설정과 테스트 전략을 다룬다.

**2편에서 다루는 내용:**
- 데이터베이스 설정 (H2, MySQL, 프로파일 분리)
- Repository 테스트
- Service 테스트
- Controller 테스트

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

<details>
<summary>⚠️ ddl-auto 운영 환경 주의사항</summary>

**절대 사용하면 안 되는 조합**
- 운영 환경 + `create` = 기존 데이터 전체 삭제
- 운영 환경 + `create-drop` = 애플리케이션 종료 시 테이블 삭제
- 운영 환경 + `update` = 예상치 못한 스키마 변경 (컬럼 삭제는 안 되지만, 추가/변경은 됨)

**환경별 권장 설정**

| 환경 | 권장 설정 | 이유 |
|------|----------|------|
| 로컬 개발 | `create` 또는 `update` | 빠른 개발 사이클 |
| 테스트 | `create-drop` | 매 테스트마다 깨끗한 상태 |
| 스테이징 | `validate` | 스키마 불일치 조기 발견 |
| 운영 | `none` 또는 `validate` | 스키마 변경은 반드시 마이그레이션 도구로 |

**실무 팁**

운영 환경에서는 **Flyway** 또는 **Liquibase** 같은 DB 마이그레이션 도구를 사용하여 스키마를 관리한다. ddl-auto에 의존하면 예상치 못한 데이터 손실이 발생할 수 있다.

```yaml
# 운영 환경 설정 예시
spring:
  jpa:
    hibernate:
      ddl-auto: validate  # 또는 none
  flyway:
    enabled: true
```

**Flyway vs Liquibase 비교**

| 항목 | Flyway | Liquibase |
|------|--------|-----------|
| **마이그레이션 방식** | SQL 파일 기반 | XML/YAML/JSON/SQL 지원 |
| **파일 명명** | `V1__init.sql`, `V2__add_column.sql` | `changelog.xml` |
| **롤백** | 유료 버전에서 지원 | 무료 버전에서 지원 |
| **러닝커브** | 낮음 (SQL만 알면 됨) | 중간 (추상화 레이어 존재) |
| **Spring Boot 통합** | `spring-boot-starter-flyway` | `spring-boot-starter-liquibase` |

```
# Flyway 마이그레이션 파일 구조
src/main/resources/db/migration/
├── V1__create_member_table.sql
├── V2__create_product_table.sql
└── V3__add_category_column.sql
```

**과제에서의 권장**: 간단한 과제에서는 `ddl-auto: create-drop`(로컬) + `validate`(Docker)로 충분하다. 마이그레이션 도구는 실무에서 더 중요하다.

</details>

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

<details>
<summary>💡 Memory Repository 구현 시 주의사항</summary>

**ID 생성 전략**

JPA 환경에서는 `@GeneratedValue`가 자동으로 ID를 생성하지만, Memory 저장소에서는 직접 구현해야 한다.

```java
// ❌ 잘못된 예 - 동시성 문제
private long sequence = 0;
product.setId(++sequence);  // Race condition 발생 가능

// ✅ 올바른 예 - AtomicLong 사용
private final AtomicLong sequence = new AtomicLong(0);
product.setId(sequence.incrementAndGet());
```

**객체 복사 주의**

저장된 객체의 참조를 그대로 반환하면 외부에서 수정 시 저장소 데이터도 변경된다.

```java
// ❌ 위험한 코드
return store.get(id);  // 원본 반환

// ✅ 안전한 코드 (방어적 복사)
return store.get(id).copy();  // 또는 new Product(...)로 복사
```

**방어적 복사가 필요한 경우**

| 상황 | 방어적 복사 필요 | 이유 |
|------|:---:|------|
| Memory Repository (테스트용) | ✅ | 외부 수정이 저장소에 영향 |
| JPA Repository | ❌ | 영속성 컨텍스트가 변경 감지 관리 |
| DTO 반환 | - | 이미 새 객체 생성됨 |

**핵심**: Memory Repository는 테스트 목적이므로 JPA의 동작을 흉내내야 한다. 실제 JPA에서는 조회한 엔티티를 수정하면 트랜잭션 커밋 시 DB에 반영되지만, Memory Repository는 그런 메커니즘이 없으므로 방어적 복사로 의도치 않은 변경을 방지하는 것이 안전하다.

**페이징 처리**

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

**Docker Compose 실행 명령**

```bash
# 컨테이너 시작 (백그라운드)
docker compose up -d

# 로그 확인
docker compose logs -f

# 컨테이너 중지
docker compose down

# 컨테이너 + 볼륨(데이터) 삭제
docker compose down -v

# 특정 서비스만 재시작
docker compose restart mysql-db
```

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

> **`proxyBeanMethods = false`란?**
>
> Spring의 `@Configuration` 클래스는 기본적으로 CGLIB 프록시를 통해 `@Bean` 메서드 간 호출 시 **싱글톤을 보장** 한다. 하지만 `@Bean` 메서드가 서로 호출하지 않는 경우 프록시가 불필요하며, `proxyBeanMethods = false`로 설정하면:
> - **프록시 생성 비용 절감** (애플리케이션 시작 시간 단축)
> - **메모리 사용량 감소**
>
> 주로 단순히 빈을 등록만 하는 설정 클래스에서 사용한다. Spring Boot 자체 auto-configuration도 대부분 이 옵션을 사용한다.

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

> **Profile 분리 vs 별도 yaml 파일**
>
> | 방식 | 파일명 예시 | 활성화 방법 | 특징 |
> |------|-------------|-------------|------|
> | Profile 분리 | `application-test.yml` | `@ActiveProfiles("test")` | Spring Boot 표준, 환경별 설정 분리에 적합 |
> | 별도 yaml | `application-test.yml` 또는 `test-application.yml` | `@TestPropertySource` | 테스트 전용 설정 명시적 분리 |
>
> **실무 권장**: `application-{profile}.yml` 형태의 Profile 분리가 가장 보편적이다. `@ActiveProfiles("test")`로 간단히 활성화할 수 있고, Spring Boot의 설정 로딩 규칙을 그대로 따르기 때문이다.

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

<details>
<summary>💬 @DataJpaTest vs @SpringBootTest 선택 기준</summary>

**@DataJpaTest**
- JPA 관련 빈만 로드하여 **빠름**
- `@Transactional`이 기본 적용되어 자동 롤백
- Service, Controller 등은 로드되지 않음
- 순수 Repository 로직 테스트에 적합

**@SpringBootTest**
- 전체 ApplicationContext 로드하여 **느림**
- 실제 환경과 유사한 통합 테스트
- 모든 빈이 주입되어 E2E 테스트 가능

**선택 가이드**

| 테스트 대상 | 권장 어노테이션 |
|------------|----------------|
| Repository 단위 테스트 | `@DataJpaTest` |
| Service + Repository 통합 | `@SpringBootTest` |
| Controller + Service + Repository | `@SpringBootTest` + `MockMvc` |
| Controller 단위 테스트 | `@WebMvcTest` |

**실무 팁**

테스트 속도가 중요하다면 **Slice Test** (`@DataJpaTest`, `@WebMvcTest`)를 적극 활용하고, 주요 시나리오만 `@SpringBootTest`로 통합 테스트한다.

</details>

<details>
<summary>💬 Mock vs 실제 객체, 언제 무엇을 써야 하나?</summary>

**Mock 객체 사용이 적합한 경우**
- 외부 API 호출 (결제, 알림 등)
- 테스트하기 어려운 의존성 (시간, 랜덤 등)
- 단위 테스트에서 특정 레이어만 테스트할 때
- 에러 상황 시뮬레이션

**실제 객체 사용이 적합한 경우**
- DB와의 실제 상호작용 검증
- 쿼리 성능 테스트
- 트랜잭션 동작 검증
- 연관관계 매핑 검증

**주의: 과도한 Mock 사용의 문제**

```java
// ❌ 과도한 Mock - 테스트 의미가 없음
given(repository.save(any())).willReturn(product);
given(repository.findById(1L)).willReturn(Optional.of(product));

Product saved = service.create(request);  // save() 호출
Product found = service.find(1L);         // findById() 호출

// 실제로는 같은 객체가 아닐 수 있는데, Mock이라 항상 성공
assertThat(found.getId()).isEqualTo(saved.getId());
```

**과도한 Mock 사용을 줄이는 방법**

| 방법 | 설명 | 적용 시점 |
|------|------|----------|
| **Fake 객체 사용** | Memory Repository로 실제 동작 흉내 | Repository 의존성이 많은 Service 테스트 |
| **@DataJpaTest 활용** | 실제 DB로 Repository 테스트 | 쿼리 검증이 필요한 경우 |
| **Testcontainers** | 실제 DB 컨테이너로 통합 테스트 | 운영 환경과 동일한 검증 필요 시 |
| **경계만 Mock** | 외부 API, 시간 등 제어 불가능한 것만 Mock | 대부분의 테스트 |

```java
// ✅ Fake Repository 활용 예시
class ProductServiceTest {
    private ProductService service;
    private FakeProductRepository repository;  // Memory 구현체

    @BeforeEach
    void setUp() {
        repository = new FakeProductRepository();
        service = new ProductService(repository);
    }

    @Test
    void 상품_저장_후_조회() {
        // Given
        CreateProductRequest request = new CreateProductRequest("상품", 1000);

        // When
        Long savedId = service.create(request);
        Product found = service.findById(savedId);

        // Then - 실제 저장/조회 동작 검증
        assertThat(found.getName()).isEqualTo("상품");
    }
}
```

**실무 팁**

| 테스트 대상 | 권장 방식 |
|------------|----------|
| Repository | 실제 DB (`@DataJpaTest` 또는 Testcontainers) |
| Service | Fake Repository 또는 `@SpringBootTest` |
| Controller | Mock Service (`@WebMvcTest`) |
| 외부 API 연동 | Mock (WireMock, Mockito) |
- 통합 테스트: 모두 실제 객체

</details>

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

<details>
<summary>Controller 테스트 (Kotlin + Kotest + MockMvc)</summary>

Kotest 스타일로 작성하면 더 표현력 있는 테스트가 가능하다.

```kotlin
@WebMvcTest(ProductController::class)
class ProductControllerKotestTest(
    private val mockMvc: MockMvc,
    @MockkBean private val productService: ProductService
) : DescribeSpec({

    val objectMapper = ObjectMapper().registerModule(JavaTimeModule())

    describe("POST /api/v1/products") {
        context("유효한 요청이 주어지면") {
            it("201 Created와 생성된 상품 ID를 반환한다") {
                val request = RegisterProductRequest(name = "테스트 상품", price = 10000)
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

        context("상품명이 비어있으면") {
            it("400 Bad Request를 반환한다") {
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
        context("존재하는 상품 ID로 조회하면") {
            it("200 OK와 상품 정보를 반환한다") {
                val response = FindProductDetailResponse(
                    id = 1L,
                    name = "테스트 상품",
                    price = 10000,
                    category = ProductCategoryType.FOOD,
                    enabled = true,
                    createdAt = LocalDateTime.now()
                )
                every { productService.findProductDetail(1L) } returns response

                mockMvc.perform(get("/api/v1/products/1"))
                    .andExpect(status().isOk)
                    .andExpect(jsonPath("$.data.name").value("테스트 상품"))
            }
        }

        context("존재하지 않는 상품 ID로 조회하면") {
            it("404 Not Found를 반환한다") {
                every { productService.findProductDetail(999L) } throws NotFoundException()

                mockMvc.perform(get("/api/v1/products/999"))
                    .andExpect(status().isNotFound)
            }
        }
    }
})
```

</details>

> **Tip**: Kotlin에서 MockMvc 테스트 시 `@MockkBean`을 사용하려면 `spring-mockk` 의존성이 필요하다.
>
> ```kotlin
> // build.gradle.kts
> testImplementation("com.ninja-squad:springmockk:4.0.2")
> ```

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
<summary>💬 H2 vs Testcontainers 선택 기준</summary>

**H2 인메모리 DB**

| 장점 | 단점 |
|-----|-----|
| 빠른 실행 속도 | 실제 DB와 문법/기능 차이 |
| 별도 설정 불필요 | MySQL/PostgreSQL 전용 기능 테스트 불가 |
| CI/CD에서 추가 설정 없음 | 호환 모드도 100% 호환은 아님 |

**Testcontainers**

| 장점 | 단점 |
|-----|-----|
| 실제 DB와 동일한 환경 | Docker 필요 |
| DB 전용 기능 테스트 가능 | 컨테이너 시작 시간 소요 |
| 운영 환경과 동일한 쿼리 검증 | CI/CD에서 Docker 설정 필요 |

**선택 가이드**

- **H2 사용**: 대부분의 CRUD, 과제, 빠른 피드백이 필요한 경우
- **Testcontainers 사용**:
  - 네이티브 쿼리나 DB 전용 함수 사용 시
  - JSON 컬럼, Full-text search 등 특정 기능 테스트
  - 운영 환경과 동일한 쿼리 플랜 검증이 필요한 경우

**과제에서의 권장**

대부분의 과제에서는 **H2로 충분** 하다. 특별히 MySQL/PostgreSQL 전용 기능을 사용하는 경우에만 Testcontainers를 고려한다.

</details>

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

<details>
<summary>💡 테스트 커버리지, 얼마나 해야 할까?</summary>

**커버리지 목표치 논쟁**

- **100% 추구파**: 모든 코드가 테스트되어야 안전하다
- **실용주의파**: 중요한 비즈니스 로직만 테스트하면 충분하다

**실무에서의 현실**

| 항목 | 일반적인 목표 | 비고 |
|-----|-------------|-----|
| 전체 커버리지 | 60~80% | 팀/프로젝트마다 다름 |
| 비즈니스 로직 (Service) | 80~90% | 핵심 로직은 반드시 테스트 |
| Repository | 필요시 | 복잡한 쿼리만 테스트 |
| Controller | 주요 시나리오 | Happy path + 주요 예외 |
| Config/Util | 선택적 | 복잡한 로직이 있는 경우만 |

**과제에서의 권장**

시간이 제한된 과제에서 **모든 코드를 테스트할 필요는 없다**. 다음 우선순위로 작성:

1. **필수**: Service 레이어의 핵심 비즈니스 로직
2. **권장**: 복잡한 Querydsl 쿼리, 예외 상황 처리
3. **선택**: Controller 테스트, 단순 CRUD

**테스트가 없는 것보다 낫지만**, 의미 없는 테스트(getter/setter 테스트 등)는 오히려 마이너스다.

```java
// ❌ 의미 없는 테스트
@Test
void getterTest() {
    Product p = new Product("test", 1000);
    assertThat(p.getName()).isEqualTo("test");
}

// ✅ 의미 있는 테스트
@Test
void 재고가_부족하면_예외가_발생한다() {
    Product product = new Product("test", 1000, 5);
    assertThrows(InsufficientStockException.class,
        () -> product.decreaseStock(10));
}
```

</details>

---

다음 편에서는 **API 문서화(Swagger)**, **로깅 전략**, **AOP 활용** 에 대해 다룹니다.

👉 [이전: 1편 - Core Application Layer](/blog/spring-boot-pre-interview-guide-1)
👉 [다음: 3편 - Documentation & AOP](/blog/spring-boot-pre-interview-guide-3)
