---
title: "Spring Boot Pre-interview Task Guide 2"
description: "Pre-interview 과제에서 자주 나오는 유형과 체크 포인트 정리"
pubDate: 2026-01-19
tags: ["Spring Boot", "REST API", "Backend", "Interview"]
heroImage: "../../assets/PreinterviewTaskGuide.png"
---

## 서론

2편은 Config 외 기타 설정입니다.

---


### Config 설정

1. CRUD 와 HttpMethod가 잘 매핑되어 있는지 체크
2. URI가 자원의 위치를 명확하게 표현하는지 체크
3. @RequestBody, @ModelAttribute, @RequestParam, Pageable 이 정확하게 사용되어있는지 체크
4. @RequestMapping의 value들은 ApiPaths같은 형태로 처리

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

5. 공통 응답 클래스를 활용하는지 체크
    <details>
    <summary>공통 클래스(kotlin)</summary>

    ```kotlin
    data class CommonResponse<T>(
        val code: String = "200", 
        val message: String = "success",
        val data: T
    )
    ```

    </details>

    <details>
    <summary>공통 클래스(java)</summary>

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

    </details>

6. DTO(Data Transfer Object) 클래스는 Validation 처리
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
1. 트랜잭션 처리 확인 ( `@Transactional` , `@Transactional(readonly = true)` )
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

5. Domain Model을 직접 변환하지 않도록 처리
6. Data를 처리할 때 Stream을 최대한 활용

   <details>
   <summary>Service 클래스(kotlin)</summary>

   ```kotlin
       @Transactional
       fun modifyProduct(
           productId: Long,
           updateProductRequest: UpdateProductRequest
       ): Boolean {
           val product = productRepository.findById(productId) 
                           ?: throw NotFoundProductException()
           val category = updateProductRequest.category
           val name = updateProductRequest.name
           product.modifyDetails(category, name)
           
           return true
       }
   ```
   </details>

   <details>
   <summary>Service 클래스(kotlin)</summary>

   ```java
       @Transactional
       public Boolean modifyProduct(UpdateProductRequest updateProductRequest) {
           val product = productRepository.findById(productId).orElseThrow(
                   () -> new NotFoundProductException()
           );
           val category = updateProductRequest.getCategory();
           val name = updateProductRequest.getName();
           product.modifyDetails(category, name);
           
           return true;
       }
   ```
   </details>


---

### DB/Query ( Repository 또는 Infrastructure Layer)
1. Nullable 처리 (Java — Optional / Kotlin — Nullable)
2. JPA Query Method를 활용하거나, 활용이 어렵다면 Querydsl로 처리
3. Querydsl 사용시 @Transactional 체크
4. 페이징 처리 시 PageImpl 활용(PageableExecutionUtils.getPage)

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
2. enum 활용 또는 연관 Entity 분리
3. 기본생성자는 protected로 설정
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
