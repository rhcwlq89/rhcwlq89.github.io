---
title: "Spring Boot Pre-Interview Guide: Comprehensive Assignment"
description: "Spring Boot-based online marketplace REST API comprehensive assignment — from product, order, and member domain design to testing and deployment"
pubDate: 2026-02-08T14:10:00+09:00
lang: en
tags: ["Spring Boot", "REST API", "Backend", "Interview", "Practical Guide"]
heroImage: "../../../assets/PreinterviewTaskGuide.png"
---

## Series Navigation

| Previous | Current |
|:---:|:---:|
| [Part 7: Advanced Patterns](/en/blog/spring-boot-pre-interview-guide-7) | **Comprehensive Assignment** |

> **Full Roadmap**: See [Spring Boot Pre-Interview Guide Roadmap](/en/blog/spring-boot-pre-interview-guide-1)
>
> This assignment is a hands-on exercise that comprehensively applies everything covered in Parts 1 through 7.

---

## Assignment Overview

Implement the backend API for an online marketplace. Sellers can register products, and buyers can search for products and place orders.

### Submission Deadline

- **Deadline**: 7 days from the date the assignment is received

### Tech Stack

- **Required**: Java 17+ or Kotlin, Spring Boot 3.x, JPA/Hibernate, Gradle
- **Database**: H2 (local), MySQL 8.0 (Docker)
- **Optional**: QueryDSL, Redis

---

## Business Requirements

### 1. Member Management

- Member types: `BUYER`, `SELLER`, `ADMIN`
- Email duplication check during registration
- JWT token issuance upon login (Access Token + Refresh Token)
- Business registration number is required for sellers

### 2. Product Management (Seller Only)

- Product create/update/delete (own products only)
- Product image upload (up to 5 images, max 10MB each)
- Product status: `DRAFT`, `ON_SALE`, `SOLD_OUT`, `DELETED`
- Inventory management

### 3. Product Search (Public)

- Product list retrieval (pagination, search, filtering)
- Product detail retrieval
- Category-based retrieval
- Popular products list (with caching)

### 4. Order Management

- Buyer: Create order, cancel order, view order history
- Seller: View orders for own products, update shipping status
- Order status: `PENDING` -> `CONFIRMED` -> `SHIPPED` -> `DELIVERED`
- Order cancellation is only allowed in `PENDING` or `CONFIRMED` status

### 5. Notifications

- Notify seller when an order is created (asynchronous)
- Notify buyer when shipping status changes (asynchronous)
- Notifications can be replaced with logs (actual delivery implementation not required)

---

## API Specification

### Authentication API

| Method | URI | Description | Auth |
|--------|-----|-------------|------|
| POST | `/api/v1/auth/signup` | Sign up | X |
| POST | `/api/v1/auth/login` | Login | X |
| POST | `/api/v1/auth/refresh` | Token refresh | X |

### Member API

| Method | URI | Description | Auth |
|--------|-----|-------------|------|
| GET | `/api/v1/members/me` | Get my info | O |
| PATCH | `/api/v1/members/me` | Update my info | O |
| GET | `/api/v1/admin/members` | Member list (admin) | ADMIN |

### Product API

| Method | URI | Description | Auth |
|--------|-----|-------------|------|
| POST | `/api/v1/products` | Register product | SELLER |
| GET | `/api/v1/products` | Product list | X |
| GET | `/api/v1/products/{productId}` | Product detail | X |
| PATCH | `/api/v1/products/{productId}` | Update product | SELLER (owner) |
| DELETE | `/api/v1/products/{productId}` | Delete product | SELLER (owner) |
| POST | `/api/v1/products/{productId}/images` | Upload product images | SELLER (owner) |
| GET | `/api/v1/products/popular` | Popular products list | X |

### Order API

| Method | URI | Description | Auth |
|--------|-----|-------------|------|
| POST | `/api/v1/orders` | Create order | BUYER |
| GET | `/api/v1/orders` | My order list | O |
| GET | `/api/v1/orders/{orderId}` | Order detail | O (owner) |
| POST | `/api/v1/orders/{orderId}/cancel` | Cancel order | BUYER (owner) |
| GET | `/api/v1/sellers/orders` | Seller order list | SELLER |
| PATCH | `/api/v1/sellers/orders/{orderId}/status` | Update shipping status | SELLER |

### Category API

| Method | URI | Description | Auth |
|--------|-----|-------------|------|
| GET | `/api/v1/categories` | Category list | X |
| POST | `/api/v1/admin/categories` | Register category | ADMIN |

---

## Detailed Requirements

### 1. Authentication/Authorization

```
[Requirements]
- JWT-based authentication (Access Token: 1 hour, Refresh Token: 7 days)
- Passwords encrypted with BCrypt
- Role-based access control (BUYER, SELLER, ADMIN)
- Resource owner verification (can only modify own products/orders)
```

### 2. Product Search/Filtering

```
GET /api/v1/products?keyword=laptop&categoryId=1&minPrice=100000&maxPrice=2000000&status=ON_SALE&page=0&size=20&sort=createdAt,desc
```

| Parameter | Type       | Description |
|-----------|------------|-------------|
| keyword | String     | Product name search (partial match) |
| categoryId | Long       | Category filter |
| minPrice | BigDecimal | Minimum price |
| maxPrice | BigDecimal    | Maximum price |
| status | String     | Product status |
| sellerId | Long       | Seller filter |
| page | Integer    | Page number (starts from 0) |
| size | Integer    | Page size (default 20, max 100) |
| sort | String     | Sort (createdAt, price, salesCount) |

### 3. Order Creation

```json
// POST /api/v1/orders
{
  "orderItems": [
    {
      "productId": 1,
      "quantity": 2
    },
    {
      "productId": 3,
      "quantity": 1
    }
  ],
  "shippingAddress": {
    "zipCode": "12345",
    "address": "123 Teheran-ro, Gangnam-gu, Seoul",
    "addressDetail": "Unit 456",
    "receiverName": "John Doe",
    "receiverPhone": "010-1234-5678"
  }
}
```

```
[Order Processing Rules]
- Check and deduct inventory (consider concurrency)
- Allow simultaneous ordering of products from multiple sellers (separate orders per seller)
- Publish notification event to seller upon order creation
- Fail the order if inventory is insufficient
```

### 4. File Upload

```
[Requirements]
- Supported extensions: jpg, jpeg, png, gif
- Max file size: 10MB
- Max 5 images per product
- Storage path: /uploads/products/{productId}/{filename}
- Filenames are converted to UUID before saving
```

### 5. Caching

```
[Caching Targets]
- Popular products list: 10-minute TTL
- Category list: 1-hour TTL
- Product detail (optional): 5-minute TTL, invalidated on update
```

### 6. Logging

```
[Requirements]
- Assign a unique Request ID to every request (MDC)
- API request/response logging (AOP)
- Log format: [timestamp] [level] [requestId] [class] message
```

---

## Technical Requirements

### Project Structure Options

Choose one of the following two structures for implementation.

#### Option A: Single Module (Recommended)

```
marketplace/
└── src/main/java/com/example/
    ├── controller/
    ├── service/
    ├── repository/
    ├── domain/
    ├── dto/
    └── config/
```

#### Option B: Multi-Module (Challenge)

Two structure choices available:

**B-1. Standard (with DIP)**
```
marketplace/
├── marketplace-api/           # Controller, Security, Execution
├── marketplace-domain/        # Entity, Service, Repository interfaces
├── marketplace-infra/         # Repository implementations, External integrations
└── marketplace-common/        # Common exceptions, Utilities
```

**B-2. Simplified (Pragmatic)**
```
marketplace/
├── marketplace-api/           # Controller, Service, Security, Execution
├── marketplace-domain/        # Entities only
├── marketplace-infra/         # JpaRepository, QueryDSL
└── marketplace-common/        # Common exceptions, Utilities
```

> **Requirements when choosing multi-module**:
> - Consistently apply the chosen structure (B-1 or B-2)
> - If B-1: No domain -> infra dependency, separate Repository interface/implementation
> - If B-2: Services are located in the api module, use JpaRepository directly
> - Specify the chosen structure and reasoning in README

### Required Implementation

| Item | Description |
|------|-------------|
| **Layer Separation** | Controller -> Service -> Repository, DTO/Command separation |
| **Exception Handling** | GlobalExceptionHandler, Custom exceptions, Consistent error responses |
| **Validation** | Bean Validation applied to Request DTOs |
| **Transactions** | Service layer transaction management, readOnly separation |
| **Testing** | Controller, Service, Repository tests (at least 1 each) |
| **API Documentation** | Swagger or REST Docs |
| **Docker** | Dockerfile + docker-compose.yml (App + MySQL) |
| **README** | How to run, Tech stack rationale, API documentation link |

### Optional Implementation (Bonus Points)

| Item | Description |
|------|-------------|
| **Multi-Module** | api/domain/infra/common separation, Dependency Inversion applied |
| **QueryDSL** | Dynamic search queries |
| **Redis Caching** | Popular products caching |
| **GitHub Actions** | CI pipeline (build, test) |
| **Test Coverage** | JaCoCo 70% or higher |
| **Event-Driven** | Order/notification event separation |
| **Kotlin** | Implementation in Kotlin |

---

## Data Model (Reference)

```
Member
├── id (PK)
├── email (UNIQUE)
├── password (encrypted)
├── name
├── phone
├── role (BUYER, SELLER, ADMIN)
├── businessNumber (SELLER only)
├── createdAt
└── updatedAt

Product
├── id (PK)
├── sellerId (FK -> Member)
├── categoryId (FK -> Category)
├── name
├── description
├── price
├── stockQuantity
├── status (DRAFT, ON_SALE, SOLD_OUT, DELETED)
├── salesCount
├── createdAt
└── updatedAt

ProductImage
├── id (PK)
├── productId (FK -> Product)
├── imageUrl
├── displayOrder
└── createdAt

Category
├── id (PK)
├── name
├── parentId (FK -> Category, nullable)
└── displayOrder

Order
├── id (PK)
├── buyerId (FK -> Member)
├── orderNumber (UNIQUE)
├── status (PENDING, CONFIRMED, SHIPPED, DELIVERED, CANCELLED)
├── totalAmount
├── shippingAddress (embedded)
├── orderedAt
└── updatedAt

OrderItem
├── id (PK)
├── orderId (FK -> Order)
├── productId (FK -> Product)
├── sellerId (FK -> Member)
├── productName (snapshot)
├── productPrice (snapshot)
├── quantity
└── subtotal
```

---

## Evaluation Criteria

### Base Score (70 points)

| Item | Points | Detailed Criteria |
|------|--------|-------------------|
| **Feature Implementation** | 30 pts | Requirements met, working correctly |
| **Code Quality** | 20 pts | Readability, naming, consistency |
| **Design** | 10 pts | Layer separation, responsibility distribution, exception handling |
| **Testing** | 10 pts | Test coverage, test quality |

### Bonus Points (35 points)

| Item | Points |
|------|--------|
| Docker Compose runnable | +5 pts |
| Swagger/REST Docs documentation | +5 pts |
| GitHub Actions CI | +5 pts |
| Caching applied (Redis or local) | +5 pts |
| Event-driven notification handling | +5 pts |
| QueryDSL dynamic queries | +5 pts |
| Multi-module structure (with Dependency Inversion) | +5 pts |

### Deduction Factors

| Item | Deduction |
|------|-----------|
| Build failure | -20 pts |
| Missing/incomplete README | -10 pts |
| No tests written | -10 pts |
| SQL Injection vulnerability | -10 pts |
| Plain text password storage | -10 pts |
| N+1 problem (obvious cases) | -5 pts |

---

## Submission Method

1. Upload code to a GitHub Repository
2. Include the following in README.md:
   - How to run (local, Docker)
   - Tech stack and rationale for choices
   - How to access API documentation
   - Project structure description
   - Additional implementations
3. Submit the Repository URL

---

## Notes

### Execution Environment

**Single Module**
```bash
# Local execution (H2)
./gradlew bootRun --args='--spring.profiles.active=local'

# Docker Compose execution
docker-compose up -d
```

**Multi-Module**
```bash
# Local execution (H2)
./gradlew :marketplace-api:bootRun --args='--spring.profiles.active=local'

# JAR build
./gradlew :marketplace-api:bootJar

# Docker Compose execution
docker-compose up -d
```

### Test Accounts (Seed Data)

| Role | Email | Password |
|------|-------|----------|
| ADMIN | admin@example.com | admin123! |
| SELLER | seller@example.com | seller123! |
| BUYER | buyer@example.com | buyer123! |

### Questions

- Contact via email for questions during the assignment
- If requirements are ambiguous, make reasonable decisions, implement accordingly, and specify in README

---

## Checklist

Please verify before submission:

- [ ] `./gradlew build` succeeds
- [ ] `docker-compose up` runs successfully
- [ ] Swagger UI or REST Docs accessible
- [ ] All tests pass
- [ ] README.md completed
- [ ] Sensitive information excluded (.env, secret keys, etc.)
- [ ] Unnecessary files excluded (.idea, .DS_Store, etc.)

---

## Hints

<details>
<summary>Implementation Order Recommendation (Single Module)</summary>

1. **Project Setup**: Dependencies, profile separation, Docker Compose
2. **Domain Design**: Entity, Repository
3. **Authentication Implementation**: Spring Security, JWT
4. **Member API**: Registration, login, my info
5. **Product API**: CRUD, image upload
6. **Order API**: Creation, retrieval, status changes
7. **Search/Pagination**: Product search, filtering
8. **Caching/Events**: Popular product caching, notification events
9. **Test Writing**: Unit/integration tests
10. **Documentation**: Swagger setup, README writing

</details>

<details>
<summary>Implementation Order Recommendation (Multi-Module)</summary>

1. **Project Structure Setup**: settings.gradle, build.gradle for each module
2. **common Module**: Common exceptions, ErrorCode, utilities
3. **domain Module**: Entity, Repository interface, Service
4. **infra Module**: Repository implementation, JPA configuration
5. **api Module**: Controller, Security, Swagger
6. **Integration Testing**: Full flow testing from the api module
7. **Docker Setup**: Multi-module build Dockerfile
8. **Documentation**: README including module structure diagram

**Note**: Be careful to avoid circular dependencies after module separation

</details>

<details>
<summary>Concurrency Handling Hint</summary>

Solutions for concurrency issues during inventory deduction:

```java
// 1. Pessimistic Lock
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("SELECT p FROM Product p WHERE p.id = :id")
Optional<Product> findByIdWithLock(@Param("id") Long id);

// 2. Optimistic Lock + Retry
@Version
private Long version;
```

</details>

<details>
<summary>Event Handling Hint</summary>

```java
// Publish event after order creation
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void handleOrderCreated(OrderCreatedEvent event) {
    // Handle notification asynchronously
    notificationService.notifySeller(event.getSellerId(), event.getOrderId());
}
```

</details>

<details>
<summary>Multi-Module Structure Hint</summary>

There are two approaches for multi-module:

| Option | Service Location | Repository Handling | Characteristics |
|--------|-----------------|---------------------|-----------------|
| **Option A (Standard)** | domain | Interface/implementation separation | Strict DIP application |
| **Option B (Simplified)** | api | Direct JpaRepository usage | Pragmatic, less code |

**settings.gradle**
```groovy
rootProject.name = 'marketplace'

include 'marketplace-api'
include 'marketplace-domain'
include 'marketplace-infra'
include 'marketplace-common'
```

**Module-specific build.gradle dependencies**
```groovy
// marketplace-common: No dependencies (common utilities, exceptions)

// marketplace-domain
dependencies {
    implementation project(':marketplace-common')
    implementation 'org.springframework.boot:spring-boot-starter-data-jpa'
}

// marketplace-infra
dependencies {
    implementation project(':marketplace-common')
    implementation project(':marketplace-domain')
    implementation 'org.springframework.boot:spring-boot-starter-data-jpa'
    // QueryDSL (optional)
    implementation 'com.querydsl:querydsl-jpa:5.0.0:jakarta'
    runtimeOnly 'com.h2database:h2'
    runtimeOnly 'com.mysql:mysql-connector-j'
}

// marketplace-api (execution module)
dependencies {
    implementation project(':marketplace-common')
    implementation project(':marketplace-domain')
    implementation project(':marketplace-infra')
    implementation 'org.springframework.boot:spring-boot-starter-web'
    implementation 'org.springframework.boot:spring-boot-starter-security'
}
```

**Option A: Repository Interface/Implementation Separation (DIP)**
```java
// marketplace-domain/.../ProductRepository.java (interface)
public interface ProductRepository {
    Product save(Product product);
    Optional<Product> findById(Long id);
}

// marketplace-infra/.../ProductRepositoryImpl.java (implementation)
@Repository
@RequiredArgsConstructor
public class ProductRepositoryImpl implements ProductRepository {
    private final ProductJpaRepository jpaRepository;

    @Override
    public Product save(Product product) {
        return jpaRepository.save(product);
    }
}
```

**Option B: QueryDSL Custom Repository Pattern (Simplified)**
```kotlin
// marketplace-infra/.../ProductJpaRepository.kt
interface ProductJpaRepository : JpaRepository<Product, Long>, ProductJpaRepositoryCustom {
    fun findBySellerId(sellerId: Long, pageable: Pageable): Page<Product>
}

// marketplace-infra/.../ProductJpaRepositoryCustom.kt
interface ProductJpaRepositoryCustom {
    fun search(keyword: String?, categoryId: Long?, pageable: Pageable): Page<Product>
}

// marketplace-infra/.../ProductJpaRepositoryImpl.kt (QueryDSL)
class ProductJpaRepositoryImpl(
    private val queryFactory: JPAQueryFactory
) : ProductJpaRepositoryCustom {
    override fun search(...) = queryFactory.selectFrom(product).where(...).fetch()
}

// marketplace-api/.../ProductService.kt (Service is located in the api module)
@Service
class ProductService(
    private val productJpaRepository: ProductJpaRepository  // Direct injection
) { ... }
```

**Component Scan Configuration**
```java
// Application.java in marketplace-api
@SpringBootApplication(scanBasePackages = "com.example")
public class MarketplaceApplication { }
```

</details>

<details>
<summary>Multi-Module Docker Build Hint</summary>

```dockerfile
FROM gradle:8.5-jdk17 AS builder
WORKDIR /app

# Copy Gradle files first (caching)
COPY build.gradle settings.gradle ./
COPY gradle ./gradle
COPY marketplace-common/build.gradle ./marketplace-common/
COPY marketplace-domain/build.gradle ./marketplace-domain/
COPY marketplace-infra/build.gradle ./marketplace-infra/
COPY marketplace-api/build.gradle ./marketplace-api/

RUN gradle dependencies --no-daemon || true

# Copy source and build
COPY . .
RUN gradle :marketplace-api:bootJar --no-daemon -x test

# Runtime
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY --from=builder /app/marketplace-api/build/libs/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

</details>

---

[View Implementation Code](https://github.com/rhcwlq89/marketplace)

**Good Luck!**

[Previous: Part 7 - Advanced Patterns](/en/blog/spring-boot-pre-interview-guide-7)
[Back to Start: Part 1 - Core Application Layer](/en/blog/spring-boot-pre-interview-guide-1)
