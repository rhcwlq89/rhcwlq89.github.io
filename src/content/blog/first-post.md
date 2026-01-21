---
title: "Spring Boot Pre-interview Task Guide 1"
description: "Pre-interview 과제에서 자주 나오는 유형과 체크 포인트 정리"
pubDate: 2026-01-16
tags:
  [
    "Spring Boot",
    "REST API",
    "Backend",
    "Interview",
    "사전과제",
    "코드리뷰과제",
  ]
heroImage: "../../assets/PreinterviewTaskGuide.png"
---

## 서론

이 글은 Spring Boot 기반 Pre-interview 과제를 여러 번 제출하고,  
또 리뷰하는 과정에서 반복적으로 언급된 포인트들을 정리한 가이드다.

단순히 “동작하는 코드”가 아니라,  
과제 평가자가 실제로 확인하는 기준(구조, 책임 분리, 예외 처리, 트랜잭션)을  
빠르게 점검할 수 있도록 정리했다.

실제 과제에서 접했던 내용을 바탕으로 작성되었으며,  
그대로 공개할 순 없기 때문에, 적당히 각색해서 일반적인 형태로 작성했다.

---

### REST API (Controller 또는 Presentation Layer)

1. CRUD 와 HttpMethod가 잘 매핑되어 있는지 체크  
   PUT은 전체 수정, PATCH는 부분 수정으로 구분하는 것도 하나의 방법이지만  
   혼용하지 않고 한 가지 방식으로 통일하는 것이 더 좋을 것 같다.
   - Create — POST
   - Read — GET
   - Update — PUT / PATCH
   - Delete — DELETE
   
2. URI가 자원을 명확하게 표현하는지 체크
   - 복수형을 기본으로 사용(예: orders, users, products 등)
   - 소유관계일 때 하위 리소스로 표현(예: /users/{userId}/orders)
   - 행위가 필요한 경우 하위 리소스로 표현(예: /orders/{orderId}/cancel)     
   단, cancel 같은 행위 URI는 도메인 성격에 따라 허용 여부가 갈릴 수 있으므로  
   단순 CRUD 과제에서는 상태 변경(PATCH)으로 표현하는 것도 고려해볼 것
   
3. 반복적으로 하드코딩된 URI가 많으면 static 하게 처리
   - @RequestMapping의 value 들은 ApiPaths 같은 형태로 처리
   - 용도를 나타내는 명확한 네이밍 권장(예: /api, /admin, /internal 등)
   - 버전 관리는 ApiPaths 또는 별도의 Versioning 클래스로 처리

   <details>
   <summary>ApiPaths(kotlin)</summary>
   
   ```kotlin
   object ApiPaths {
      const val API = "/api"
      const val V1 = "/v1"
      const val PRODUCTS = "/products"
   }
   ``` 
   </details>

   <details>
   <summary>ApiPaths(java)</summary>
   
   ```java
   public class ApiPaths {
      public static final String API = "/api";
      public static final String V1 = "/v1";
      public static final String PRODUCTS = "/products";
   }
   ```
   </details>

4. 공통 응답 클래스를 활용하는지 체크
   - 일반적으로 응답코드, 응답메시지, 데이터 영역으로 구성
     - HTTP Status → 프로토콜 의미
     - code → 비즈니스 에러 분류
   - 파일 다운로드나 스트리밍 API, HealthCheck의 경우 공통 응답 클래스를 적용하지 않는 것이 더 적절

    <details>
    <summary>공통 응답 클래스(kotlin)</summary>
   
    ```kotlin
    data class CommonResponse<T>(
        val code: String,
        val message: String,
        val data: T
    ) {
        companion object {
            const val CODE_SUCCESS = "200"
            const val MSG_SUCCESS = "success"
            
            fun <T> success(): CommonResponse<T> {
                return CommonResponse(CODE_SUCCESS, MSG_SUCCESS, null as T)
            }
            
            fun <T> success(data: T): CommonResponse<T> {
                return CommonResponse(CODE_SUCCESS, MSG_SUCCESS, data)
            }
            
            fun <T> error(code: String, message: String): CommonResponse<T> {
                return CommonResponse(code, message, null as T)
            }
            
            fun <T> error(code: String, message: String, data: T): CommonResponse<T> {
                return CommonResponse(code, message, data)
            }
        }
    }
    ```
    </details>
 
   <details>
   <summary>공통 응답 클래스(java)</summary>
   
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
        
        public static <T> CommonResponse<T> error(String code, String message, T data) {
            return new CommonResponse<>(code, message, data);
        }
   }
   ```
   </details>

5. DTO(Data Transfer Object) 클래스는 Validation 처리
   - @Valid , @NotBlank , @Size , @NotNull 등 활용
   - 중첩된 DTO도 @Valid 처리
   - ExceptionHandler 에서 Validation 예외 처리

   <details>
   <summary>DTO 클래스(kotlin)</summary>
   
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
   </details>

   <details>
   <summary>DTO 클래스(java)</summary>
   
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
       FOOD,HOTEL
   }
   ```
   </details>

6. Controller 클래스는 가급적 비즈니스 로직을 포함하지 않도록 처리
   - 추가적으로 페이지네이션에서 최대 페이지 수를 설정해두면 좋다.(application.yml)
   
   <details>
   <summary>application.yml</summary>

   ```yaml
   spring:
    data:
      web:
        pageable:
          max-page-size: 100
   ```
   
   </details>
   
   <details>
   <summary>Controller 클래스(kotlin)</summary>
   
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
   
       // 수정시 가능한 반환값은 수정된 리소스 ID 또는 성공 여부(Boolean), Void 등이 있음
       @PutMapping("/{productId}")
       fun modifyProduct(
           @PathVariable productId: Long,
           @Valid @RequestBody modifyProductRequest: ModifyProductRequest,
       ): CommonResponse<Long> {
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
   ```
   
   </details>
   
   <details>
   <summary>Controller 클래스(java)</summary>
   
   ```java
   @RestController
   @RequestMapping(ApiPaths.API + ApiPaths.V1 + ApiPaths.PRODUCTS)
   public class ProductController {
       private final ProductService productService;
   
       public ProductController(ProductService productService) {
           this.productService = productService;
       }
   
       @GetMapping("/{productId}")
       public CommonResponse<FindProductDetailResponse> findProductDetail(
               @PathVariable Long productId) {
           return new CommonResponse<>(
                   CommonResponse.CODE_SUCCESS,
                   CommonResponse.MSG_SUCCESS,
                   productService.findProductDetail(productId)
           );
       }
   
       // ... Other endpoints follow the same pattern
   }
   ```
   
   </details>

---

### Business Logic ( Service 또는 Application Layer )

1. 트랜잭션 처리 확인
   - 조회 트랜잭션을 readonly로 분리하면 불필요한 Dirty Checking을 방지
   - 로깅 설정을 통해 트랜잭션을 확인 가능

   <details>
   <summary>application.yml</summary>
      
   ```yaml
   logging:
     level:
       org.springframework.orm.jpa: TRACE
       org.hibernate.sql: DEBUG
       com.querydsl.sql: DEBUG
       org.springframework.transaction: DEBUG
   ```
   </details>

2. 예상되는 예외사항들을 Custom Exception 으로 처리

   <details>
   <summary>Custom Exception 클래스(kotlin)</summary>

   ```kotlin
   open class CommonException(val statusCode: HttpStatusCode) : RuntimeException() {
       var errorCode: ErrorCode = ErrorCode.ERR000
   }

   open class BadRequestException(errorCode: ErrorCode)
       : CommonException(HttpStatus.BAD_REQUEST) {
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

   </details>

3. 정의한 CustomException 을 `@RestControllerAdvice` 에서 활용

   <details>
   <summary>GlobalExceptionHandler 클래스(kotlin)</summary>

   ```kotlin
   @RestControllerAdvice
   class GlobalExceptionHandler {

       // CommonException 처리 예시
       @ExceptionHandler(CommonException::class)
       fun handleCommonException(e: CommonException): CommonResponse {
           val code = e.errorCode
           return CommonResponse(
               code = code.code,
               message = code.message
           )

       }

       // Validation Exception 처리 예시
       @ExceptionHandler(MethodArgumentNotValidException::class)
       fun handleMethodArgumentNotValidException(e: MethodArgumentNotValidException): ResponseEntity<Any> {
            val fieldError = e.bindingResult.fieldErrors[0]
            val errors = "${fieldError.field}: ${fieldError.defaultMessage}"

            val error = CommonResponse(ErrorCode.ERR001.code, errors)
            return ResponseEntity(error, e.statusCode)
    }
   }
   ```

   </details>

   <details>
   <summary>GlobalExceptionHandler 클래스(java)</summary>

   ```java
   @RestControllerAdvice
   public class GlobalExceptionHandler {

       @ExceptionHandler(CommonException.class)
       public CommonResponse<?> handleCommonException(CommonException e) {
           ErrorCode code = e.getErrorCode();
           return CommonResponse.error(code.getCode(), code.getMessage());
       }

       // ... Other ExceptionHandler follow the same pattern
   }
   ```

   </details>

4. kotlin 에서는 nullable 처리, java 에서는 Optional 객체 처리

   <details>
   <summary>Service 클래스(kotlin)</summary>

   ```kotlin
   @Transactional(readonly = true)
   fun findProductDetail(productId: Long): FindProductDetailResponse {
       val product = productRepository.findById(productId)
                           ?: throw NotFoundProductException()
   }
   ```

   </details>

   <details>
   <summary>Service 클래스(java)</summary>

   ```java
   @Transactional(readonly = true)
   public FindProductDetailResponse findProductDetail(Long productId){
       val product = productRepository.findById(productId)
                            .orElseThrow(() -> new NotFoundProductException());
   }
   ```

   </details>

5. Domain Model을 직접 변환하지 않도록 처리 (응답전용 DTO로 반환)
6. 반복 로직은 Stream을 활용하되, 가독성을 해치지 않는 선에서 사용

   <details>
   <summary>Service 클래스(kotlin)</summary>

   ```kotlin
   @Service
   @Transactional
   open class ProductService(val productRepository: ProductRepository) {
       @Transactional
       fun modifyProduct(
           productId: Long,
           updateProductRequest: UpdateProductRequest
       ): Long {
           val product = productRepository.findById(productId)
                           ?: throw NotFoundProductException()
           val category = updateProductRequest.category
           val name = updateProductRequest.name
           product.modifyDetails(category, name)

           return product.id!!
       }
       //....
   }
   ```

   </details>

   <details>
   <summary>Service 클래스(kotlin)</summary>

   ```java
   @Service
   @Transactional
   public class ProductService {    
     private final ProductRepository productRepository;
        public ProductService(ProductRepository productRepository) {
           this.productRepository = productRepository;
        }
   
        public Boolean modifyProduct(
            Long productId,
            UpdateProductRequest updateProductRequest
        ) {
           val product = productRepository.findById(productId).orElseThrow(
                   () -> new NotFoundProductException()
           );
           val category = updateProductRequest.getCategory();
           val name = updateProductRequest.getName();
           product.modifyDetails(category, name);

           return productId;
       }
       //....
   }
   ```

   </details>

---

### DB/Query ( Repository 또는 Infrastructure Layer)

1. Nullable 처리 (Java — Optional / Kotlin — Nullable)
2. 단순 조회는 JPA Query Method를 활용    
조건이 늘어날 가능성이 있다면 Querydsl로 활용
3. Querydsl 사용시 @Transactional 체크
4. 페이징 처리 시 PageImpl 활용(PageableExecutionUtils.getPage)
    - 실제 페이지 데이터가 마지막 페이지일 경우
      count 쿼리를 생략할 수 있어 성능상 이점이 있다.  

   <details>
   <summary>Repository 클래스(kotlin)</summary>

   ```kotlin
   interface ProductRepository : JpaRepository<Product, Long>, ProductRepositoryCustom {
       fun findById(id: Long): Product?
   }

   interface ProductRepositoryCustom {
       fun findProducts(
           name: String?,
           enabled: Boolean?,
           pageable: Pageable
       ): Page<Product>
   }

   @Transactional
   class ProductRepositoryImpl(
       private val queryFactory: JPAQueryFactory
   ) : ProductRepositoryCustom {

       override fun findProducts(
            name: String?,
            enabled: Boolean?,
            pageable: Pageable
        ) : Page<Product> {
           val query = queryFactory
               .selectFrom(QProduct.product)
               .where(
                   name?.let { QProduct.product.name.containsIgnoreCase(it) },
                   enabled?.let { QProduct.product.enabled.eq(it) }
               )
           .offset(pageable.offset)
           .limit(pageable.pageSize.toLong())
           .fetch()

           val countQuery = queryFactory
               .selectFrom(QProduct.product.count())
               .where(
                   name?.let { QProduct.product.name.containsIgnoreCase(it) },
                   enabled?.let { QProduct.product.enabled.eq(it) }
               )

           return PageableExecutionUtils.getPage(results, pageable) { countQuery.fetchOne()!!  }
       }
   }
   ```

   </details>

   <details>
   <summary>Repository 클래스(java)</summary>

   ```java
   interface ProductRepository extends JpaRepository<Product, Long>, ProductRepositoryCustom {
       Optional<Product> findById(Long id);
   }

   public interface ProductRepositoryCustom {
       Page<Product> findProducts(
           String name,
           Boolean enabled,
           Pageable pageable
       );
   }

   @Transactional
   public class ProductRepositoryImpl implements ProductCustomRepositoryCustom {
       private final JPAQueryFactory queryFactory;

       public ProductRepositoryImpl(JPAQueryFactory queryFactory) {
           this.queryFactory = queryFactory;
       }

       @Override
       public Page<Product> findProducts(String name, Boolean enabled, Pageable pageable) {
           QProduct product = QProduct.product;
           JPAQuery<Product> query = queryFactory
               .selectFrom(product)
               .where(
                   name != null ? product.name.containsIgnoreCase(name) : null,
                   enabled != null ? product.enabled.eq(enabled) : null
               )
           .offset(pageable.offset)
           .limit(pageable.pageSize.toLong())
           .fetch();

           val countQuery = queryFactory
               .selectFrom(QProduct.product.count())
               .where(
                   name != null ? product.name.containsIgnoreCase(name) : null,
                   enabled != null ? product.enabled.eq(enabled) : null
               );

           return PageableExecutionUtils.getPage(results, pageable, () -> countQuery.fetchOne());
       }
   }
   ```

   </details>

---

### Domain (Entity 또는 Domain Layer)

1. 단순 Setter 대신 비즈니스 로직에 맞게 method 만들기
2. 하위 Entity가 필요하다면 연관 Entity 분리   
   고정된 값이 필요하다면 Enum 활용
3. 기본생성자는 protected로 설정   
   JPA 스펙을 만족하면서   
   외부에서 무분별한 객체 생성을 방지하기 위함   
4. 공통인 영역 (생성일시, 수정일시 등)은 BaseEntity 또는 ExtendedBaseEntity로 분리

   <details>
   <summary>BaseEntity 클래스(kotlin)</summary>

   ```kotlin
   @MappedSuperclass
   @EntityListeners(AuditingEntityListener::class)
   class BaseEntity {
       @CreatedDate
       @Column(updatable = false)
       var createdAt: LocalDateTime? = null

       @LastModifiedDate
       @Column
       var updatedAt: LocalDateTime? = null
   }

   @MappedSuperclass
   @EntityListeners(AuditingEntityListener::class)
   class ExtendedBaseEntity : BaseEntity() {
      @CreatedBy
      @Column
      var createdId: Long? = null

      @LastModifiedBy
      @Column
      var updatedId: Long? = null
   }
   ```

   </details>

   <details>
   <summary>BaseEntity 클래스(java)</summary>

   ```java
   @MappedSuperclass
   @EntityListeners(value = { AuditingEntityListener.class })
   @Getter
   @Setter
   public class BaseRegEntity {

       @Column(name = "reg_id")
       private Integer regId;

       @CreatedDate
       @Column(name = "reg_dt")
       private LocalDateTime regDt;

   }
   ```

   ```java
   @MappedSuperclass
   @EntityListeners(value = { AuditingEntityListener.class })
   @Getter
   @Setter
   public class BaseModEntity extends BaseRegEntity{

      @Column(name = "mod_id")
      private Integer modId;

      @LastModifiedDate
      @Column(name = "mod_dt")
      private LocalDateTime modDt;

   }
   ```

   </details>

   <details>
   <summary>Entity 클래스(kotlin)</summary>

   ```kotlin
   @Entity
   class Product(
   @Id
   @GeneratedValue(strategy = GenerationType.IDENTITY)
   var id: Long? = null,

       @Column
       var enabled: Boolean,

       @Column
       var name: String,
   ) : ExtendedBaseEntity() {

       fun updateEnabled(enabled: Boolean) {
           this.enabled = enabled
       }

       fun updateName(productName: String) {
           this.name = productName
       }

       fun isEnabled(): Boolean {
           return enabled
       }
   }
   ```

   </details>

   <details>
   <summary>Entity 클래스(java)</summary>

   ```java
   @Entity
   public class Product extends ExtendedBaseEntity {
       @Id
       @GeneratedValue(strategy = GenerationType.IDENTITY)
       private Long id;

       @Column
       private Boolean enabled;

       @Column
       private String name;

       protected Product() {
           // Default constructor for JPA
       }

       public Product(Boolean enabled, String name) {
           this.enabled = enabled;
           this.name = name;
       }

       public void updateEnabled(Boolean enabled) {
           this.enabled = enabled;
       }

       public void updateName(String productName) {
           this.name = productName;
       }

       public Boolean isEnabled() {
           return enabled;
       }
   }
   ```

</details>
