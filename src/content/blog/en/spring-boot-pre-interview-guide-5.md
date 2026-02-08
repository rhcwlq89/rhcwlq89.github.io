---
title: "Spring Boot Pre-Interview Guide Part 5: Security & Authentication"
description: "Authentication/authorization and security configuration — Spring Security, JWT, and role management"
pubDate: 2026-02-08T13:40:00+09:00
lang: en
tags: ["Spring Boot", "Spring Security", "JWT", "Authentication", "Interview", "Practical Guide"]
heroImage: "../../../assets/PreinterviewTaskGuide.png"
---

## Series Navigation

| Previous | Current | Next |
|:---:|:---:|:---:|
| [Part 4: Performance](/en/blog/spring-boot-pre-interview-guide-4) | **Part 5: Security** | [Part 6: DevOps](/en/blog/spring-boot-pre-interview-guide-6) |

> **Full Roadmap**: See [Spring Boot Pre-Interview Guide Roadmap](/en/blog/spring-boot-pre-interview-guide-1)

---

## Introduction

This guide serves as a reference when authentication/authorization is required in your assignment. It focuses on JWT-based authentication and Spring Security configuration.

**Topics covered in Part 5:**
- Spring Security basics
- JWT authentication
- Password management
- API authorization management
- CORS configuration

### Table of Contents

- [Spring Security Basics](#spring-security-basics)
- [JWT Authentication](#jwt-authentication)
- [Password Management](#password-management)
- [API Authorization Management](#api-authorization-management)
- [CORS Configuration](#cors-configuration)
- [Summary](#summary)

---

## Spring Security Basics

### 1. Adding Dependencies

```groovy
// build.gradle
implementation 'org.springframework.boot:spring-boot-starter-security'
testImplementation 'org.springframework.security:spring-security-test'
```

### 2. SecurityFilterChain Configuration

This configuration is based on Spring Security 6.x. Using `@EnableMethodSecurity` together enables method-level security such as `@PreAuthorize`.

```java
@Configuration
@EnableMethodSecurity  // Enables @PreAuthorize, @PostAuthorize
public class SecurityConfig {

    private final JwtTokenProvider jwtTokenProvider;

    public SecurityConfig(JwtTokenProvider jwtTokenProvider) {
        this.jwtTokenProvider = jwtTokenProvider;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
            .csrf(csrf -> csrf.disable())  // Disable CSRF for REST API
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))  // No session usage
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/v1/auth/**").permitAll()  // Allow auth APIs
                .requestMatchers(HttpMethod.GET, "/api/v1/products/**").permitAll()  // Public read APIs
                .requestMatchers("/swagger-ui/**", "/v3/api-docs/**").permitAll()  // Swagger
                .requestMatchers("/h2-console/**").permitAll()  // H2 Console (dev only)
                .anyRequest().authenticated()  // All other requests require authentication
            )
            .headers(headers ->
                headers.frameOptions(frame -> frame.disable()))  // Allow H2 Console iframe
            .addFilterBefore(new JwtAuthenticationFilter(jwtTokenProvider),
                UsernamePasswordAuthenticationFilter.class)
            .build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
```

<details>
<summary>Kotlin version</summary>

```kotlin
@Configuration
@EnableMethodSecurity
class SecurityConfig(private val jwtTokenProvider: JwtTokenProvider) {

    @Bean
    fun passwordEncoder(): PasswordEncoder = BCryptPasswordEncoder()

    @Bean
    fun filterChain(http: HttpSecurity): SecurityFilterChain {
        http.csrf { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .authorizeHttpRequests { authz ->
                authz
                    .requestMatchers("/api/v1/auth/**").permitAll()
                    .requestMatchers(HttpMethod.GET, "/api/v1/products/**").permitAll()
                    .requestMatchers(
                        "/swagger-ui/**",
                        "/swagger-ui.html",
                        "/v3/api-docs/**"
                    ).permitAll()
                    .requestMatchers("/h2-console/**").permitAll()
                    .anyRequest().authenticated()
            }

        http.addFilterBefore(
            JwtAuthenticationFilter(jwtTokenProvider),
            UsernamePasswordAuthenticationFilter::class.java
        )

        // Allow H2 Console iframe
        http.headers { it.frameOptions { fo -> fo.disable() } }

        return http.build()
    }
}
```

</details>

> **@EnableWebSecurity vs @EnableMethodSecurity**
> - `@EnableWebSecurity`: Auto-configured in Spring Boot 3.x, so it can be omitted
> - `@EnableMethodSecurity`: Must be explicitly declared to use `@PreAuthorize` and `@PostAuthorize`

### 3. Understanding the Authentication Flow

```
[Request] -> [SecurityFilterChain] -> [AuthenticationFilter] -> [AuthenticationManager]
                                                                        |
[Response] <- [Stored in SecurityContext] <- [Authentication object created] <- [UserDetailsService]
```

1. **SecurityFilterChain**: Intercepts requests for security processing
2. **AuthenticationFilter**: Extracts authentication information (token, session, etc.)
3. **AuthenticationManager**: Delegates authentication processing
4. **UserDetailsService**: Looks up user information
5. **SecurityContext**: Stores authenticated user information

---

## JWT Authentication

### 1. Adding Dependencies

```groovy
// build.gradle
implementation 'io.jsonwebtoken:jjwt-api:0.12.3'
runtimeOnly 'io.jsonwebtoken:jjwt-impl:0.12.3'
runtimeOnly 'io.jsonwebtoken:jjwt-jackson:0.12.3'
```

### 2. JWT Property Configuration

```yaml
# application.yml
jwt:
  secret: your-256-bit-secret-key-here-must-be-at-least-32-characters
  access-token-validity: 3600000   # 1 hour (milliseconds)
  refresh-token-validity: 604800000  # 7 days (milliseconds)
```

```java
@Getter
@ConfigurationProperties(prefix = "jwt")
public class JwtProperties {
    private final String secret;
    private final long accessTokenValidity;
    private final long refreshTokenValidity;

    public JwtProperties(String secret, long accessTokenValidity, long refreshTokenValidity) {
        this.secret = secret;
        this.accessTokenValidity = accessTokenValidity;
        this.refreshTokenValidity = refreshTokenValidity;
    }
}
```

```java
@SpringBootApplication
@ConfigurationPropertiesScan  // Or @EnableConfigurationProperties(JwtProperties.class)
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

### 3. JwtTokenProvider Implementation

```java
@Component
@RequiredArgsConstructor
public class JwtTokenProvider {

    private final JwtProperties jwtProperties;
    private SecretKey secretKey;

    @PostConstruct
    protected void init() {
        this.secretKey = Keys.hmacShaKeyFor(
            jwtProperties.getSecret().getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Create Access Token
     */
    public String createAccessToken(Long userId, String email, String role) {
        Date now = new Date();
        Date validity = new Date(now.getTime() + jwtProperties.getAccessTokenValidity());

        return Jwts.builder()
            .subject(String.valueOf(userId))
            .claim("email", email)
            .claim("role", role)
            .issuedAt(now)
            .expiration(validity)
            .signWith(secretKey)
            .compact();
    }

    /**
     * Create Refresh Token
     */
    public String createRefreshToken(Long userId) {
        Date now = new Date();
        Date validity = new Date(now.getTime() + jwtProperties.getRefreshTokenValidity());

        return Jwts.builder()
            .subject(String.valueOf(userId))
            .issuedAt(now)
            .expiration(validity)
            .signWith(secretKey)
            .compact();
    }

    /**
     * Extract user ID from token
     */
    public Long getUserId(String token) {
        return Long.parseLong(getClaims(token).getSubject());
    }

    /**
     * Extract role from token
     */
    public String getRole(String token) {
        return getClaims(token).get("role", String.class);
    }

    /**
     * Validate token
     */
    public boolean validateToken(String token) {
        try {
            getClaims(token);
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            return false;
        }
    }

    private Claims getClaims(String token) {
        return Jwts.parser()
            .verifyWith(secretKey)
            .build()
            .parseSignedClaims(token)
            .getPayload();
    }
}
```

<details>
<summary>Kotlin version</summary>

```kotlin
@Component
class JwtTokenProvider(
    private val jwtProperties: JwtProperties
) {
    private lateinit var secretKey: SecretKey

    @PostConstruct
    fun init() {
        secretKey = Keys.hmacShaKeyFor(jwtProperties.secret.toByteArray(Charsets.UTF_8))
    }

    fun createAccessToken(userId: Long, email: String, role: String): String {
        val now = Date()
        val validity = Date(now.time + jwtProperties.accessTokenValidity)

        return Jwts.builder()
            .subject(userId.toString())
            .claim("email", email)
            .claim("role", role)
            .issuedAt(now)
            .expiration(validity)
            .signWith(secretKey)
            .compact()
    }

    fun createRefreshToken(userId: Long): String {
        val now = Date()
        val validity = Date(now.time + jwtProperties.refreshTokenValidity)

        return Jwts.builder()
            .subject(userId.toString())
            .issuedAt(now)
            .expiration(validity)
            .signWith(secretKey)
            .compact()
    }

    fun getUserId(token: String): Long = getClaims(token).subject.toLong()

    fun getRole(token: String): String = getClaims(token).get("role", String::class.java)

    fun validateToken(token: String): Boolean {
        return runCatching { getClaims(token) }.isSuccess
    }

    private fun getClaims(token: String): Claims {
        return Jwts.parser()
            .verifyWith(secretKey)
            .build()
            .parseSignedClaims(token)
            .payload
    }
}
```

</details>

### 4. JwtAuthenticationFilter Implementation

There are two approaches for implementing the JWT filter.

#### Approach 1: Using userId Directly as Principal (Recommended)

This approach extracts user information directly from the token without a DB query. It is simpler and has performance advantages.

```java
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtTokenProvider jwtTokenProvider;

    public JwtAuthenticationFilter(JwtTokenProvider jwtTokenProvider) {
        this.jwtTokenProvider = jwtTokenProvider;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {

        String header = request.getHeader("Authorization");

        if (header != null && header.startsWith("Bearer ")) {
            String token = header.substring(7);

            if (jwtTokenProvider.validateToken(token)) {
                Long userId = jwtTokenProvider.getUserId(token);
                String role = jwtTokenProvider.getRole(token);

                // Set userId (Long) directly as the principal
                UsernamePasswordAuthenticationToken authentication =
                    new UsernamePasswordAuthenticationToken(
                        userId,
                        null,
                        List.of(new SimpleGrantedAuthority("ROLE_" + role))
                    );

                authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                SecurityContextHolder.getContext().setAuthentication(authentication);
            }
        }

        filterChain.doFilter(request, response);
    }
}
```

<details>
<summary>Kotlin version</summary>

```kotlin
class JwtAuthenticationFilter(
    private val jwtTokenProvider: JwtTokenProvider
) : OncePerRequestFilter() {

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain
    ) {
        val header = request.getHeader("Authorization")

        if (header != null && header.startsWith("Bearer ")) {
            val token = header.substring(7)

            if (jwtTokenProvider.validateToken(token)) {
                val userId = jwtTokenProvider.getUserId(token)
                val role = jwtTokenProvider.getRole(token)

                val auth = UsernamePasswordAuthenticationToken(
                    userId,
                    null,
                    listOf(SimpleGrantedAuthority("ROLE_$role"))
                )
                auth.details = WebAuthenticationDetailsSource().buildDetails(request)
                SecurityContextHolder.getContext().authentication = auth
            }
        }

        filterChain.doFilter(request, response)
    }
}
```

</details>

With this approach, you can directly receive the user ID in the Controller using `@AuthenticationPrincipal Long userId`.

```java
@GetMapping("/me")
public MemberResponse getMyProfile(@AuthenticationPrincipal Long userId) {
    return memberService.getMember(userId);
}

@PostMapping
@PreAuthorize("hasRole('SELLER')")
public ProductResponse createProduct(
    @AuthenticationPrincipal Long sellerId,
    @Valid @RequestBody CreateProductRequest request
) {
    return productService.createProduct(sellerId, request);
}
```

#### Approach 2: Using UserDetails (Traditional Approach)

This approach loads user information from the DB via UserDetailsService. It is useful when you need to check the user's latest state (permission changes, account locking, etc.).

<details>
<summary>UserDetails approach code</summary>

```java
@Component
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtTokenProvider jwtTokenProvider;
    private final UserDetailsService userDetailsService;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {

        String token = resolveToken(request);

        if (token != null && jwtTokenProvider.validateToken(token)) {
            Long userId = jwtTokenProvider.getUserId(token);
            UserDetails userDetails = userDetailsService.loadUserByUsername(String.valueOf(userId));

            UsernamePasswordAuthenticationToken authentication =
                new UsernamePasswordAuthenticationToken(userDetails, null, userDetails.getAuthorities());

            authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
            SecurityContextHolder.getContext().setAuthentication(authentication);
        }

        filterChain.doFilter(request, response);
    }

    private String resolveToken(HttpServletRequest request) {
        String bearerToken = request.getHeader("Authorization");
        if (bearerToken != null && bearerToken.startsWith("Bearer ")) {
            return bearerToken.substring(7);
        }
        return null;
    }
}
```

With this approach, you use `@AuthenticationPrincipal UserDetails userDetails` to receive the user details.

```java
@GetMapping("/me")
public MemberResponse getMyProfile(@AuthenticationPrincipal UserDetails userDetails) {
    Long userId = Long.parseLong(userDetails.getUsername());
    return memberService.getMember(userId);
}
```

</details>

<details>
<summary>Which approach should you choose?</summary>

| Criteria | Direct userId | UserDetails |
|------|-----------------|-----------------|
| **DB Query** | None | Query on every request |
| **Performance** | Better | Relatively slower |
| **Real-time State** | Info from token issuance time | Reflected in real-time |
| **Implementation Complexity** | Simple | Requires UserDetailsService |
| **Use Cases** | Most assignments/production | When real-time verification like account locking is needed |

**Recommendation**: In most cases, **Approach 1 (direct userId)** is suitable. However, consider Approach 2 when permissions change frequently or account status must be verified in real-time.

</details>

### 5. UserDetailsService Implementation (Optional)

> **Note**: If you chose **Approach 1 (direct userId)** described above, UserDetailsService is not needed. Only implement this if you chose Approach 2 (UserDetails).

<details>
<summary>UserDetailsService implementation (for Approach 2)</summary>

```java
@Service
@RequiredArgsConstructor
public class CustomUserDetailsService implements UserDetailsService {

    private final MemberRepository memberRepository;

    @Override
    public UserDetails loadUserByUsername(String userId) throws UsernameNotFoundException {
        Member member = memberRepository.findById(Long.parseLong(userId))
            .orElseThrow(() -> new UsernameNotFoundException("User not found: " + userId));

        return User.builder()
            .username(String.valueOf(member.getId()))
            .password(member.getPassword())
            .roles(member.getRole().name())
            .build();
    }
}
```

</details>

### 6. Authentication API Implementation

```java
@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/signup")
    public ResponseEntity<Void> signup(@Valid @RequestBody SignupRequest request) {
        authService.signup(request.toCommand());
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @PostMapping("/login")
    public ResponseEntity<TokenResponse> login(@Valid @RequestBody LoginRequest request) {
        TokenResponse response = authService.login(request.toCommand());
        return ResponseEntity.ok(response);
    }

    @PostMapping("/refresh")
    public ResponseEntity<TokenResponse> refresh(@RequestBody RefreshTokenRequest request) {
        TokenResponse response = authService.refresh(request.getRefreshToken());
        return ResponseEntity.ok(response);
    }
}
```

```java
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class AuthService {

    private final MemberRepository memberRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;

    @Transactional
    public void signup(SignupCommand command) {
        if (memberRepository.existsByEmail(command.getEmail())) {
            throw new DuplicateEmailException(command.getEmail());
        }

        Member member = Member.builder()
            .email(command.getEmail())
            .password(passwordEncoder.encode(command.getPassword()))
            .name(command.getName())
            .role(MemberRole.USER)
            .build();

        memberRepository.save(member);
    }

    public TokenResponse login(LoginCommand command) {
        Member member = memberRepository.findByEmail(command.getEmail())
            .orElseThrow(() -> new InvalidCredentialsException());

        if (!passwordEncoder.matches(command.getPassword(), member.getPassword())) {
            throw new InvalidCredentialsException();
        }

        String accessToken = jwtTokenProvider.createAccessToken(
            member.getId(), member.getEmail(), member.getRole().name());
        String refreshToken = jwtTokenProvider.createRefreshToken(member.getId());

        return new TokenResponse(accessToken, refreshToken);
    }

    public TokenResponse refresh(String refreshToken) {
        if (!jwtTokenProvider.validateToken(refreshToken)) {
            throw new InvalidTokenException();
        }

        Long userId = jwtTokenProvider.getUserId(refreshToken);
        Member member = memberRepository.findById(userId)
            .orElseThrow(() -> new MemberNotFoundException(userId));

        String newAccessToken = jwtTokenProvider.createAccessToken(
            member.getId(), member.getEmail(), member.getRole().name());

        return new TokenResponse(newAccessToken, refreshToken);
    }
}
```

<details>
<summary>Session vs JWT Debate</summary>

| Criteria | Session | JWT |
|------|---------|-----|
| **Storage Location** | Server (memory/Redis) | Client |
| **Scalability** | Requires session sharing between servers | Easily scalable as stateless |
| **Security** | Only session ID exposed | Risk if token is stolen |
| **Logout** | Immediately invalidated on server | Requires blacklist management |
| **Complexity** | Simple | Requires token management logic |

**Recommended for assignments**: REST API assignments mostly expect JWT. However, it is good to explain your reasoning in the README.

</details>

<details>
<summary>Access Token Storage Location Debate</summary>

| Storage Location | Pros | Cons |
|----------|------|------|
| **LocalStorage** | Simple, easy JavaScript access | Vulnerable to XSS attacks |
| **SessionStorage** | Deleted when tab closes | Vulnerable to XSS attacks |
| **Cookie (HttpOnly)** | XSS protection | Vulnerable to CSRF attacks |
| **Memory** | Most secure | Lost on page refresh |

**Common pattern in production**:
- Access Token: Memory (global variable/state management)
- Refresh Token: HttpOnly + Secure + SameSite Cookie

**For assignments**: If it is a backend-only assignment without a frontend, returning tokens in the response body is acceptable.

</details>

---

## Password Management

### 1. BCrypt Encryption

```java
@Service
@RequiredArgsConstructor
public class MemberService {

    private final PasswordEncoder passwordEncoder;

    public void changePassword(Long memberId, String currentPassword, String newPassword) {
        Member member = memberRepository.findById(memberId)
            .orElseThrow(() -> new MemberNotFoundException(memberId));

        // Verify current password
        if (!passwordEncoder.matches(currentPassword, member.getPassword())) {
            throw new InvalidPasswordException();
        }

        // Encrypt and save new password
        member.changePassword(passwordEncoder.encode(newPassword));
    }
}
```

### 2. Password Policy Validation

```java
public record SignupRequest(
    @NotBlank @Email
    String email,

    @NotBlank
    @Pattern(regexp = "^(?=.*[A-Za-z])(?=.*\\d)(?=.*[@$!%*#?&])[A-Za-z\\d@$!%*#?&]{8,20}$",
             message = "Password must be 8-20 characters and include letters, numbers, and special characters")
    String password,

    @NotBlank @Size(min = 2, max = 20)
    String name
) {
    public SignupCommand toCommand() {
        return new SignupCommand(email, password, name);
    }
}
```

<details>
<summary>Password Security Tips</summary>

**Why BCrypt is secure**:
1. **Automatic salt generation**: Same password produces different hashes every time
2. **Work Factor**: Adjustable computation cost (default 10)
3. **Slow hashing**: Defends against brute-force attacks

**Precautions**:
- Never log plaintext passwords
- Check that the new password is different from the previous one when changing passwords
- For password recovery, send a reset link (never send plaintext passwords)

</details>


> **What is Argon2 encryption?**
>
> Argon2 is a more modern password hashing algorithm than BCrypt, and was the **winner of the 2015 Password Hashing Competition**.
>
> | Algorithm | Features | Recommended For |
> |---------|------|----------|
> | **BCrypt** | Proven algorithm, widely used | General web applications |
> | **Argon2** | Configurable memory usage, strong against GPU attacks | Cases requiring high security |
>
> Using Argon2 in Spring Security:
> ```java
> @Bean
> public PasswordEncoder passwordEncoder() {
>     return new Argon2PasswordEncoder(16, 32, 1, 65536, 3);
>     // saltLength, hashLength, parallelism, memory, iterations
> }
> ```
>
> **For assignments**: BCrypt is the standard, so using BCrypt is recommended. Knowing about Argon2 is sufficient.

---

## API Authorization Management

### 1. Role-Based Access Control (RBAC)

Define appropriate roles based on the assignment requirements.

```java
public enum Role {
    USER,     // Regular user
    SELLER,   // Seller (for marketplaces, etc.)
    ADMIN     // Administrator
}
```

```java
@Entity
public class Member {

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private MemberRole role;
}
```

### 2. Method-Level Security

> **Note**: `@EnableMethodSecurity` was already configured in the SecurityConfig above. No separate Config class is needed.

Using `@PreAuthorize` enables fine-grained authorization control at the method level.

```java
@RestController
@RequestMapping("/api/v1/products")
@RequiredArgsConstructor
public class ProductController {

    private final ProductService productService;

    // Anyone can view (permitAll configured in SecurityConfig)
    @GetMapping("/{productId}")
    public ProductResponse getProduct(@PathVariable Long productId) {
        return productService.getProduct(productId);
    }

    // Only SELLER role can create products
    @PostMapping
    @PreAuthorize("hasRole('SELLER')")
    public ProductResponse createProduct(
        @AuthenticationPrincipal Long sellerId,
        @Valid @RequestBody CreateProductRequest request
    ) {
        return productService.createProduct(sellerId, request);
    }

    // Only SELLER role can update products
    @PatchMapping("/{productId}")
    @PreAuthorize("hasRole('SELLER')")
    public ProductResponse updateProduct(
        @AuthenticationPrincipal Long sellerId,
        @PathVariable Long productId,
        @RequestBody UpdateProductRequest request
    ) {
        return productService.updateProduct(sellerId, productId, request);
    }

    // Only ADMIN role can access
    @GetMapping("/admin/all")
    @PreAuthorize("hasRole('ADMIN')")
    public List<ProductResponse> getAllProductsForAdmin() {
        return productService.getAllProductsForAdmin();
    }
}
```

<details>
<summary>Kotlin version</summary>

```kotlin
@RestController
@RequestMapping("/api/v1/products")
class ProductController(private val productService: ProductService) {

    @GetMapping("/{productId}")
    fun getProduct(@PathVariable productId: Long): ProductResponse {
        return productService.getProduct(productId)
    }

    @PostMapping
    @PreAuthorize("hasRole('SELLER')")
    fun createProduct(
        @AuthenticationPrincipal sellerId: Long,
        @Valid @RequestBody request: CreateProductRequest
    ): ProductResponse {
        return productService.createProduct(sellerId, request)
    }

    @PatchMapping("/{productId}")
    @PreAuthorize("hasRole('SELLER')")
    fun updateProduct(
        @AuthenticationPrincipal sellerId: Long,
        @PathVariable productId: Long,
        @RequestBody request: UpdateProductRequest
    ): ProductResponse {
        return productService.updateProduct(sellerId, productId, request)
    }
}
```

</details>

### 3. Resource Owner Verification

Owner verification is needed to prevent access to other users' resources.

#### Approach 1: Direct Verification in Service (Recommended)

The most intuitive and simple method. Verify ownership in the service method and throw an exception if it fails.

```java
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ProductService {

    private final ProductRepository productRepository;

    @Transactional
    public ProductResponse updateProduct(Long sellerId, Long productId, UpdateProductRequest request) {
        Product product = productRepository.findById(productId)
            .orElseThrow(() -> new BusinessException(ErrorCode.PRODUCT_NOT_FOUND));

        // Owner verification
        if (!product.getSellerId().equals(sellerId)) {
            throw new BusinessException(ErrorCode.PRODUCT_NOT_OWNED);
        }

        product.update(request.getName(), request.getPrice());
        return ProductResponse.from(product);
    }

    @Transactional
    public void deleteProduct(Long sellerId, Long productId) {
        Product product = productRepository.findById(productId)
            .orElseThrow(() -> new BusinessException(ErrorCode.PRODUCT_NOT_FOUND));

        if (!product.getSellerId().equals(sellerId)) {
            throw new BusinessException(ErrorCode.PRODUCT_NOT_OWNED);
        }

        productRepository.delete(product);
    }
}
```

#### Approach 2: @PreAuthorize + Custom Service

A declarative approach to authorization verification using SpEL.

```java
@RestController
@RequestMapping("/api/v1/orders")
@RequiredArgsConstructor
public class OrderController {

    private final OrderService orderService;

    @GetMapping("/{orderId}")
    @PreAuthorize("@orderAuthorizationService.isOwner(#orderId, authentication.principal)")
    public OrderResponse getOrder(@PathVariable Long orderId) {
        return orderService.getOrder(orderId);
    }
}
```

```java
@Service
@RequiredArgsConstructor
public class OrderAuthorizationService {

    private final OrderRepository orderRepository;

    // When principal is Long (userId)
    public boolean isOwner(Long orderId, Long userId) {
        return orderRepository.findById(orderId)
            .map(order -> order.getBuyerId().equals(userId))
            .orElse(false);
    }
}
```

<details>
<summary>Which approach should you choose?</summary>

| Criteria | Service Verification | @PreAuthorize |
|------|-------------|---------------|
| **Readability** | Logic is explicit | Concise with annotations |
| **Testing** | Easy to unit test | SpEL testing is complex |
| **Flexibility** | Can be combined with business logic | Verification logic is separated |
| **Debugging** | Intuitive | SpEL debugging is difficult |

**Recommendation**: For assignments, **Approach 1 (Service verification)** is more intuitive and easier to test.

</details>

### 4. Accessing Current User Information

Since we set `userId (Long)` as the `principal` in JwtAuthenticationFilter earlier, you can receive it directly in the Controller with `@AuthenticationPrincipal Long`.

```java
@RestController
@RequestMapping("/api/v1/members")
@RequiredArgsConstructor
public class MemberController {

    private final MemberService memberService;

    @GetMapping("/me")
    public MemberResponse getCurrentMember(@AuthenticationPrincipal Long userId) {
        return memberService.getMember(userId);
    }

    @PatchMapping("/me")
    public MemberResponse updateProfile(
        @AuthenticationPrincipal Long userId,
        @Valid @RequestBody UpdateMemberRequest request
    ) {
        return memberService.updateMember(userId, request);
    }
}
```

<details>
<summary>Kotlin version</summary>

```kotlin
@RestController
@RequestMapping("/api/v1/members")
class MemberController(private val memberService: MemberService) {

    @GetMapping("/me")
    fun getCurrentMember(@AuthenticationPrincipal userId: Long): MemberResponse {
        return memberService.getMember(userId)
    }

    @PatchMapping("/me")
    fun updateProfile(
        @AuthenticationPrincipal userId: Long,
        @Valid @RequestBody request: UpdateMemberRequest
    ): MemberResponse {
        return memberService.updateMember(userId, request)
    }
}
```

</details>

<details>
<summary>Custom Annotation Approach (Optional)</summary>

If you want a more explicit annotation instead of `@AuthenticationPrincipal`:

```java
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
public @interface CurrentUser {
}

@Component
public class CurrentUserArgumentResolver implements HandlerMethodArgumentResolver {

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.hasParameterAnnotation(CurrentUser.class)
            && parameter.getParameterType().equals(Long.class);
    }

    @Override
    public Object resolveArgument(MethodParameter parameter,
                                  ModelAndViewContainer mavContainer,
                                  NativeWebRequest webRequest,
                                  WebDataBinderFactory binderFactory) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            return null;
        }

        // When principal is Long
        return (Long) authentication.getPrincipal();
    }
}
```

```java
@GetMapping("/me")
public MemberResponse getCurrentMember(@CurrentUser Long userId) {
    return memberService.getMember(userId);
}
```

> However, since `@AuthenticationPrincipal Long userId` is sufficiently clear and simple, using it without a custom annotation is perfectly fine for assignments.

</details>

<details>
<summary>Authorization Check Location: Filter vs AOP vs Service</summary>

| Location | Characteristics | When to Use |
|------|------|----------|
| **SecurityFilterChain** | URL pattern-based, executed first | API group-level permissions (e.g., /admin/** -> ADMIN) |
| **@PreAuthorize** | Method-level, supports SpEL | Individual method permissions, dynamic authorization checks |
| **Service** | Combined with business logic | Complex authorization logic, data-based permissions |

**Recommended for assignments**: Use SecurityFilterChain for URL-based basic permissions, and @PreAuthorize or Service for resource owner verification.

</details>

---

## CORS Configuration

### 1. Global CORS Configuration

```java
@Configuration
public class CorsConfig {

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();

        configuration.setAllowedOrigins(List.of(
            "http://localhost:3000",
            "https://your-frontend-domain.com"
        ));
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("*"));
        configuration.setExposedHeaders(List.of("Authorization"));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
```

```java
// Add CORS configuration to SecurityConfig
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http
        .cors(cors -> cors.configurationSource(corsConfigurationSource()))
        .csrf(csrf -> csrf.disable())
        // ... remaining configuration
        .build();
}
```

### 2. Controller-Level CORS

```java
@RestController
@RequestMapping("/api/v1/public")
@CrossOrigin(origins = "http://localhost:3000")
public class PublicController {
    // Apply CORS to a specific controller only
}
```

<details>
<summary>CORS Configuration Tips</summary>

**Preflight Requests**:
- The browser sends an OPTIONS request before the actual request
- `Access-Control-*` headers are used to confirm whether the request is allowed

**Common Mistakes**:
- `allowCredentials(true)` and `allowedOrigins("*")` cannot be used together
- Use `allowedOriginPatterns("*")` when allowing wildcards

**For assignments**:
- CORS configuration can be omitted if there is no frontend
- If using Swagger UI, the corresponding origin must be allowed

</details>

---

## Summary

### Checklist

| Item | Check |
|------|------|
| Is SecurityFilterChain properly configured? | ⬜ |
| Is `@EnableMethodSecurity` declared? | ⬜ |
| Is JWT creation/validation logic implemented? | ⬜ |
| Does JwtAuthenticationFilter set userId as the principal? | ⬜ |
| Are passwords encrypted with BCrypt before storage? | ⬜ |
| Are authenticated and public APIs properly separated? | ⬜ |
| Is role-based access control applied with `@PreAuthorize`? | ⬜ |
| Is the current user retrieved via `@AuthenticationPrincipal Long userId`? | ⬜ |
| Is resource owner verification implemented? | ⬜ |
| Is the JWT secret externalized to a configuration file? | ⬜ |

### Key Points

1. **Spring Security**: Security configuration with SecurityFilterChain + `@EnableMethodSecurity`, stateless session policy
2. **JWT**: Access Token + Refresh Token structure, setting userId directly as the principal
3. **Password**: BCrypt encryption, never store or transmit in plaintext
4. **Authorization Management**: Combination of URL-based (SecurityFilterChain) + method-level (`@PreAuthorize`) security
5. **Current User**: Convenient access via `@AuthenticationPrincipal Long userId`

<details>
<summary>Common Mistakes in Assignments</summary>

1. **Hardcoding JWT Secret**
   - Writing the secret directly in source code
   - Always externalize to application.yml or environment variables

2. **Missing Token Expiration Handling**
   - Token validation must check for expiration
   - Appropriate error response (401) for expired tokens

3. **Exposing Plaintext Passwords**
   - Including the password field in response DTOs
   - Logging passwords

4. **Missing Authorization Checks**
   - Allowing access to other users' resources
   - Resource owner verification is essential

5. **Allowing All CORS Origins**
   - `allowedOrigins("*")` + `allowCredentials(true)` combination is not allowed
   - In production, only allow specific origins

</details>

<details>
<summary>Refresh Token Rotation</summary>

**Refresh Token Rotation** is a pattern where a new Refresh Token is also issued when a Refresh Token is used.

```java
public TokenResponse refresh(String refreshToken) {
    if (!jwtTokenProvider.validateToken(refreshToken)) {
        throw new InvalidTokenException();
    }

    Long userId = jwtTokenProvider.getUserId(refreshToken);
    Member member = memberRepository.findById(userId)
        .orElseThrow(() -> new MemberNotFoundException(userId));

    // Issue both new Access Token and Refresh Token
    String newAccessToken = jwtTokenProvider.createAccessToken(
        member.getId(), member.getEmail(), member.getRole().name());
    String newRefreshToken = jwtTokenProvider.createRefreshToken(member.getId());

    // Invalidate the old Refresh Token (if stored in DB)
    // refreshTokenRepository.delete(refreshToken);

    return new TokenResponse(newAccessToken, newRefreshToken);
}
```

**Advantage**: Prevents continued misuse even if a Refresh Token is stolen

**For assignments**: Implementing this earns bonus points, but not implementing it does not incur penalties

</details>

<details>
<summary>JWT Management Tips for Production</summary>

**1. Access Token Expiration Time Settings**

| Environment | Access Token | Refresh Token |
|------|--------------|---------------|
| General web services | 15 min ~ 1 hour | 7 days ~ 30 days |
| Financial/security-sensitive services | 5 min ~ 15 min | 1 day ~ 7 days |
| Mobile apps | 1 hour ~ 24 hours | 30 days ~ 90 days |

**2. Token Storage Location**

| Storage Location | Pros | Cons |
|----------|------|------|
| **LocalStorage** | Easy to implement | Vulnerable to XSS |
| **HttpOnly Cookie** | Prevents XSS | Requires CSRF protection |
| **Memory (variable)** | Most secure | Lost on page refresh |

> **Production recommendation**: Store Access Token in memory, Refresh Token in an HttpOnly Cookie

**3. Token Invalidation Strategies**

Since JWT is stateless, it is difficult to invalidate on the server after issuance. In production, the following methods are used:

```java
// Method 1: Blacklist (using Redis)
@Service
@RequiredArgsConstructor
public class TokenBlacklistService {

    private final StringRedisTemplate redisTemplate;

    public void addToBlacklist(String token, long expirationMs) {
        redisTemplate.opsForValue().set(
            "blacklist:" + token,
            "true",
            expirationMs,
            TimeUnit.MILLISECONDS
        );
    }

    public boolean isBlacklisted(String token) {
        return Boolean.TRUE.equals(redisTemplate.hasKey("blacklist:" + token));
    }
}

// Method 2: Token Version (version management in DB)
@Entity
public class Member {
    // ...
    private int tokenVersion = 0;  // Incremented on logout

    public void invalidateTokens() {
        this.tokenVersion++;
    }
}
```

**4. Multi-Device Login Management**

```java
// Managing active sessions per user
@Service
public class SessionService {

    private final StringRedisTemplate redisTemplate;

    public void registerSession(Long userId, String deviceId, String refreshToken) {
        String key = "sessions:" + userId;
        redisTemplate.opsForHash().put(key, deviceId, refreshToken);
    }

    // Logout from a specific device
    public void logoutDevice(Long userId, String deviceId) {
        redisTemplate.opsForHash().delete("sessions:" + userId, deviceId);
    }

    // Logout from all devices
    public void logoutAllDevices(Long userId) {
        redisTemplate.delete("sessions:" + userId);
    }
}
```

**For assignments**: Implementing basic JWT authentication is sufficient. The above content is for interview preparation and concept review.

</details>

---

The next part covers **Docker**, **Docker Compose**, and **GitHub Actions CI/CD**.

-> [Previous: Part 4 - Performance & Optimization](/en/blog/spring-boot-pre-interview-guide-4)
-> [Next: Part 6 - DevOps & Deployment](/en/blog/spring-boot-pre-interview-guide-6)
