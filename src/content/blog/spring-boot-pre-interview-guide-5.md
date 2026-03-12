---
title: "스프링 사전과제 가이드 5편: Security & Authentication"
description: "인증/인가와 보안 설정 - Spring Security, JWT, 권한 관리"
pubDate: 2026-01-17T10:00:00+09:00
tags: ["Spring Boot", "Spring Security", "JWT", "Backend", "사전과제"]
heroImage: "../../assets/PreinterviewTaskGuide.png"
---

## 시리즈 네비게이션

| 이전 | 현재 | 다음 |
|:---:|:---:|:---:|
| [4편: Performance](/blog/spring-boot-pre-interview-guide-4) | **5편: Security** | [6편: DevOps](/blog/spring-boot-pre-interview-guide-6) |

> 📚 **전체 로드맵**: [스프링 사전과제 가이드 로드맵](/blog/spring-boot-pre-interview-guide-1) 참고

---

## 서론

과제에서 인증/인가가 요구될 때 참고할 수 있는 가이드다. JWT 기반 인증과 Spring Security 설정을 중심으로 정리했다.

**5편에서 다루는 내용:**
- Spring Security 기초
- JWT 인증
- 비밀번호 관리
- API 권한 관리
- CORS 설정

### 목차

- [Spring Security 기초](#spring-security-기초)
- [JWT 인증](#jwt-인증)
- [비밀번호 관리](#비밀번호-관리)
- [API 권한 관리](#api-권한-관리)
- [CORS 설정](#cors-설정)
- [정리](#정리)

---

## Spring Security 기초

### 1. 의존성 추가

```groovy
// build.gradle
implementation 'org.springframework.boot:spring-boot-starter-security'
testImplementation 'org.springframework.security:spring-security-test'
```

### 2. SecurityFilterChain 설정

Spring Security 6.x 기준 설정이다. `@EnableMethodSecurity`를 함께 사용하면 `@PreAuthorize` 등 메서드 수준 보안을 활성화할 수 있다.

```java
@Configuration
@EnableMethodSecurity  // @PreAuthorize, @PostAuthorize 활성화
public class SecurityConfig {

    private final JwtTokenProvider jwtTokenProvider;

    public SecurityConfig(JwtTokenProvider jwtTokenProvider) {
        this.jwtTokenProvider = jwtTokenProvider;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
            .csrf(csrf -> csrf.disable())  // REST API이므로 CSRF 비활성화
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))  // 세션 미사용
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/v1/auth/**").permitAll()  // 인증 API는 허용
                .requestMatchers(HttpMethod.GET, "/api/v1/products/**").permitAll()  // 공개 조회 API
                .requestMatchers("/swagger-ui/**", "/v3/api-docs/**").permitAll()  // Swagger
                .requestMatchers("/h2-console/**").permitAll()  // H2 Console (개발용)
                .anyRequest().authenticated()  // 나머지는 인증 필요
            )
            .headers(headers ->
                headers.frameOptions(frame -> frame.disable()))  // H2 Console iframe 허용
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
<summary>Kotlin 버전</summary>

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

        // H2 Console iframe 허용
        http.headers { it.frameOptions { fo -> fo.disable() } }

        return http.build()
    }
}
```

</details>

> **@EnableWebSecurity vs @EnableMethodSecurity**
> - `@EnableWebSecurity`: Spring Boot 3.x에서는 자동 설정되므로 생략 가능
> - `@EnableMethodSecurity`: `@PreAuthorize`, `@PostAuthorize` 사용을 위해 명시적으로 선언 필요

### 3. 인증 흐름 이해

```
[요청] → [SecurityFilterChain] → [AuthenticationFilter] → [AuthenticationManager]
                                                                    ↓
[응답] ← [SecurityContext에 저장] ← [Authentication 객체 생성] ← [UserDetailsService]
```

1. **SecurityFilterChain**: 요청을 가로채서 보안 처리
2. **AuthenticationFilter**: 인증 정보 추출 (토큰, 세션 등)
3. **AuthenticationManager**: 인증 처리 위임
4. **UserDetailsService**: 사용자 정보 조회
5. **SecurityContext**: 인증된 사용자 정보 저장

---

## JWT 인증

### 1. 의존성 추가

```groovy
// build.gradle
implementation 'io.jsonwebtoken:jjwt-api:0.12.3'
runtimeOnly 'io.jsonwebtoken:jjwt-impl:0.12.3'
runtimeOnly 'io.jsonwebtoken:jjwt-jackson:0.12.3'
```

### 2. JWT 프로퍼티 설정

```yaml
# application.yml
jwt:
  secret: your-256-bit-secret-key-here-must-be-at-least-32-characters
  access-token-validity: 3600000   # 1시간 (밀리초)
  refresh-token-validity: 604800000  # 7일 (밀리초)
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
@ConfigurationPropertiesScan  // 또는 @EnableConfigurationProperties(JwtProperties.class)
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

### 3. JwtTokenProvider 구현

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
     * Access Token 생성
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
     * Refresh Token 생성
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
     * 토큰에서 사용자 ID 추출
     */
    public Long getUserId(String token) {
        return Long.parseLong(getClaims(token).getSubject());
    }

    /**
     * 토큰에서 역할 추출
     */
    public String getRole(String token) {
        return getClaims(token).get("role", String.class);
    }

    /**
     * 토큰 유효성 검증
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
<summary>Kotlin 버전</summary>

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

### 4. JwtAuthenticationFilter 구현

JWT 필터 구현 방식은 두 가지가 있다.

#### 방식 1: userId를 Principal로 직접 사용 (권장)

DB 조회 없이 토큰에서 바로 사용자 정보를 추출하는 방식이다. 더 심플하고 성능상 이점이 있다.

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

                // Principal로 userId(Long)를 직접 설정
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
<summary>Kotlin 버전</summary>

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

이 방식을 사용하면 Controller에서 `@AuthenticationPrincipal Long userId`로 바로 사용자 ID를 받을 수 있다.

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

#### 방식 2: UserDetails 사용 (전통적인 방식)

UserDetailsService를 통해 DB에서 사용자 정보를 조회하는 방식이다. 사용자의 최신 상태(권한 변경, 계정 잠금 등)를 확인해야 할 때 유용하다.

<details>
<summary>UserDetails 방식 코드</summary>

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

이 방식은 `@AuthenticationPrincipal UserDetails userDetails`로 받아서 사용한다.

```java
@GetMapping("/me")
public MemberResponse getMyProfile(@AuthenticationPrincipal UserDetails userDetails) {
    Long userId = Long.parseLong(userDetails.getUsername());
    return memberService.getMember(userId);
}
```

</details>

<details>
<summary>💬 어떤 방식을 선택해야 할까?</summary>

| 구분 | userId 직접 사용 | UserDetails 사용 |
|------|-----------------|-----------------|
| **DB 조회** | 없음 | 매 요청마다 조회 |
| **성능** | 더 좋음 | 상대적으로 느림 |
| **최신 상태 반영** | 토큰 발급 시점 정보 | 실시간 반영 |
| **구현 복잡도** | 단순 | UserDetailsService 필요 |
| **활용** | 대부분의 과제/실무 | 계정 잠금 등 실시간 검증 필요 시 |

**권장**: 대부분의 경우 **방식 1 (userId 직접 사용)**이 적합하다. 단, 권한이 자주 변경되거나 계정 상태를 실시간으로 확인해야 하는 경우에는 방식 2를 고려한다.

</details>

### 5. UserDetailsService 구현 (선택사항)

> **Note**: 앞서 설명한 **방식 1 (userId 직접 사용)**을 선택했다면 UserDetailsService는 필요하지 않다. 방식 2 (UserDetails 사용)를 선택한 경우에만 구현한다.

<details>
<summary>UserDetailsService 구현 (방식 2 사용 시)</summary>

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

### 6. 인증 API 구현

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
<summary>💬 Session vs JWT 논쟁</summary>

| 구분 | Session | JWT |
|------|---------|-----|
| **저장 위치** | 서버 (메모리/Redis) | 클라이언트 |
| **확장성** | 서버 간 세션 공유 필요 | Stateless로 확장 용이 |
| **보안** | 세션 ID만 노출 | 토큰 탈취 시 위험 |
| **로그아웃** | 서버에서 즉시 무효화 | 블랙리스트 관리 필요 |
| **복잡도** | 단순 | 토큰 관리 로직 필요 |

**과제에서 권장**: REST API 과제는 대부분 JWT를 기대한다. 단, README에 선택 이유를 명시하면 좋다.

</details>

<details>
<summary>💬 Access Token 저장 위치 논쟁</summary>

| 저장 위치 | 장점 | 단점 |
|----------|------|------|
| **LocalStorage** | 간단, JavaScript 접근 용이 | XSS 공격에 취약 |
| **SessionStorage** | 탭 닫으면 삭제 | XSS 공격에 취약 |
| **Cookie (HttpOnly)** | XSS 방어 | CSRF 공격에 취약 |
| **메모리** | 가장 안전 | 새로고침 시 사라짐 |

**현업에서의 일반적인 패턴**:
- Access Token: 메모리 (전역 변수/상태 관리)
- Refresh Token: HttpOnly + Secure + SameSite Cookie

**과제에서**: 프론트엔드가 없는 백엔드 과제라면 응답 Body로 반환해도 무방하다.

</details>

---

## 비밀번호 관리

### 1. BCrypt 암호화

```java
@Service
@RequiredArgsConstructor
public class MemberService {

    private final PasswordEncoder passwordEncoder;

    public void changePassword(Long memberId, String currentPassword, String newPassword) {
        Member member = memberRepository.findById(memberId)
            .orElseThrow(() -> new MemberNotFoundException(memberId));

        // 현재 비밀번호 확인
        if (!passwordEncoder.matches(currentPassword, member.getPassword())) {
            throw new InvalidPasswordException();
        }

        // 새 비밀번호 암호화 후 저장
        member.changePassword(passwordEncoder.encode(newPassword));
    }
}
```

### 2. 비밀번호 정책 Validation

```java
public record SignupRequest(
    @NotBlank @Email
    String email,

    @NotBlank
    @Pattern(regexp = "^(?=.*[A-Za-z])(?=.*\\d)(?=.*[@$!%*#?&])[A-Za-z\\d@$!%*#?&]{8,20}$",
             message = "비밀번호는 8~20자, 영문, 숫자, 특수문자를 포함해야 합니다")
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
<summary>💡 비밀번호 보안 팁</summary>

**BCrypt가 안전한 이유**:
1. **Salt 자동 생성**: 같은 비밀번호도 매번 다른 해시값
2. **Work Factor**: 연산 비용 조절 가능 (기본값 10)
3. **느린 해시**: 무차별 대입 공격 방어

**주의사항**:
- 평문 비밀번호를 로그에 출력하지 말 것
- 비밀번호 변경 시 이전 비밀번호와 동일한지 체크
- 비밀번호 찾기는 재설정 링크 발송 (평문 발송 금지)

</details>


> **Argon2 암호화란?**
>
> BCrypt보다 최신의 비밀번호 해싱 알고리즘으로, **2015년 Password Hashing Competition 우승작**이다.
>
> | 알고리즘 | 특징 | 권장 상황 |
> |---------|------|----------|
> | **BCrypt** | 검증된 알고리즘, 널리 사용 | 일반적인 웹 애플리케이션 |
> | **Argon2** | 메모리 사용량 조절 가능, GPU 공격에 강함 | 높은 보안이 필요한 경우 |
>
> Spring Security에서 Argon2 사용:
> ```java
> @Bean
> public PasswordEncoder passwordEncoder() {
>     return new Argon2PasswordEncoder(16, 32, 1, 65536, 3);
>     // saltLength, hashLength, parallelism, memory, iterations
> }
> ```
>
> **과제에서**: BCrypt가 표준이므로 BCrypt 사용을 권장한다. Argon2는 "알고 있다"는 수준이면 충분.

---

## API 권한 관리

### 1. 역할 기반 접근 제어 (RBAC)

과제 요구사항에 따라 적절한 역할을 정의한다.

```java
public enum Role {
    USER,     // 일반 사용자
    SELLER,   // 판매자 (마켓플레이스 등)
    ADMIN     // 관리자
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

### 2. 메서드 수준 보안

> **Note**: `@EnableMethodSecurity`는 앞서 SecurityConfig에서 이미 설정했다. 별도의 Config 클래스가 필요하지 않다.

`@PreAuthorize`를 사용하면 메서드 수준에서 세밀한 권한 제어가 가능하다.

```java
@RestController
@RequestMapping("/api/v1/products")
@RequiredArgsConstructor
public class ProductController {

    private final ProductService productService;

    // 누구나 조회 가능 (SecurityConfig에서 permitAll 설정)
    @GetMapping("/{productId}")
    public ProductResponse getProduct(@PathVariable Long productId) {
        return productService.getProduct(productId);
    }

    // SELLER 권한만 상품 등록 가능
    @PostMapping
    @PreAuthorize("hasRole('SELLER')")
    public ProductResponse createProduct(
        @AuthenticationPrincipal Long sellerId,
        @Valid @RequestBody CreateProductRequest request
    ) {
        return productService.createProduct(sellerId, request);
    }

    // SELLER 권한만 상품 수정 가능
    @PatchMapping("/{productId}")
    @PreAuthorize("hasRole('SELLER')")
    public ProductResponse updateProduct(
        @AuthenticationPrincipal Long sellerId,
        @PathVariable Long productId,
        @RequestBody UpdateProductRequest request
    ) {
        return productService.updateProduct(sellerId, productId, request);
    }

    // ADMIN 권한만 접근 가능
    @GetMapping("/admin/all")
    @PreAuthorize("hasRole('ADMIN')")
    public List<ProductResponse> getAllProductsForAdmin() {
        return productService.getAllProductsForAdmin();
    }
}
```

<details>
<summary>Kotlin 버전</summary>

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

### 3. 리소스 소유자 검증

다른 사용자의 리소스에 접근하지 못하도록 소유자 검증이 필요하다.

#### 방식 1: Service에서 직접 검증 (권장)

가장 직관적이고 간단한 방법이다. Service 메서드에서 소유자 검증 후 예외를 던진다.

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

        // 소유자 검증
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

#### 방식 2: @PreAuthorize + 커스텀 서비스

SpEL을 활용하여 선언적으로 권한을 검증하는 방법이다.

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

    // principal이 Long (userId)인 경우
    public boolean isOwner(Long orderId, Long userId) {
        return orderRepository.findById(orderId)
            .map(order -> order.getBuyerId().equals(userId))
            .orElse(false);
    }
}
```

<details>
<summary>💬 어떤 방식을 선택해야 할까?</summary>

| 구분 | Service 검증 | @PreAuthorize |
|------|-------------|---------------|
| **가독성** | 로직이 명시적 | 어노테이션으로 간결 |
| **테스트** | 단위 테스트 용이 | SpEL 테스트 복잡 |
| **유연성** | 비즈니스 로직과 결합 가능 | 검증 로직 분리 |
| **디버깅** | 직관적 | SpEL 디버깅 어려움 |

**권장**: 과제에서는 **방식 1 (Service 검증)**이 더 직관적이고 테스트하기 쉽다.

</details>

### 4. 현재 사용자 정보 접근

앞서 JwtAuthenticationFilter에서 `principal`로 `userId (Long)`를 직접 설정했기 때문에, Controller에서 `@AuthenticationPrincipal Long`으로 바로 받을 수 있다.

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
<summary>Kotlin 버전</summary>

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
<summary>커스텀 어노테이션 방식 (선택사항)</summary>

`@AuthenticationPrincipal` 대신 더 명시적인 어노테이션을 사용하고 싶다면:

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

        // principal이 Long인 경우
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

> 단, `@AuthenticationPrincipal Long userId`가 충분히 명확하고 간단하므로, 과제에서는 커스텀 어노테이션 없이 사용해도 무방하다.

</details>

<details>
<summary>💬 권한 체크 위치: Filter vs AOP vs Service</summary>

| 위치 | 특징 | 사용 시점 |
|------|------|----------|
| **SecurityFilterChain** | URL 패턴 기반, 가장 먼저 실행 | 전체 API 그룹 권한 (예: /admin/** → ADMIN) |
| **@PreAuthorize** | 메서드 수준, SpEL 지원 | 개별 메서드 권한, 동적 권한 검사 |
| **Service** | 비즈니스 로직과 함께 | 복잡한 권한 로직, 데이터 기반 권한 |

**과제에서 권장**: URL 기반 기본 권한은 SecurityFilterChain, 리소스 소유자 검증은 @PreAuthorize 또는 Service에서 처리

</details>

---

## CORS 설정

> CORS의 동작 원리(SOP, Simple/Preflight/Credentialed 요청, 에러 패턴별 해결법 등)를 자세히 알고 싶다면 [CORS를 이해하기: 브라우저 보안 정책부터 Spring Boot 설정까지](/blog/cors-understanding-guide/) 글을 참고하라.

### 1. 전역 CORS 설정

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
// SecurityConfig에 CORS 설정 추가
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http
        .cors(cors -> cors.configurationSource(corsConfigurationSource()))
        .csrf(csrf -> csrf.disable())
        // ... 나머지 설정
        .build();
}
```

### 2. Controller 수준 CORS

```java
@RestController
@RequestMapping("/api/v1/public")
@CrossOrigin(origins = "http://localhost:3000")
public class PublicController {
    // 특정 컨트롤러에만 CORS 적용
}
```

<details>
<summary>💡 CORS 설정 팁</summary>

**Preflight 요청**:
- 브라우저가 실제 요청 전에 OPTIONS 요청을 보냄
- `Access-Control-*` 헤더로 허용 여부 확인

**흔한 실수**:
- `allowCredentials(true)`와 `allowedOrigins("*")` 동시 사용 불가
- 와일드카드 허용 시 `allowedOriginPatterns("*")` 사용

**과제에서**:
- 프론트엔드가 없으면 CORS 설정 생략 가능
- Swagger UI 사용 시 해당 Origin 허용 필요

</details>

---

## 정리

### 체크리스트

| 항목 | 확인 |
|------|------|
| SecurityFilterChain이 올바르게 설정되어 있는가? | ⬜ |
| `@EnableMethodSecurity`가 선언되어 있는가? | ⬜ |
| JWT 생성/검증 로직이 구현되어 있는가? | ⬜ |
| JwtAuthenticationFilter에서 userId를 principal로 설정하는가? | ⬜ |
| 비밀번호가 BCrypt로 암호화되어 저장되는가? | ⬜ |
| 인증이 필요한 API와 공개 API가 구분되어 있는가? | ⬜ |
| `@PreAuthorize`로 역할 기반 권한 제어가 적용되어 있는가? | ⬜ |
| `@AuthenticationPrincipal Long userId`로 현재 사용자를 받는가? | ⬜ |
| 리소스 소유자 검증이 구현되어 있는가? | ⬜ |
| JWT Secret이 설정 파일로 분리되어 있는가? | ⬜ |

### 핵심 포인트

1. **Spring Security**: SecurityFilterChain + `@EnableMethodSecurity`로 보안 설정, Stateless 세션 정책
2. **JWT**: Access Token + Refresh Token 구조, userId를 principal로 직접 설정
3. **비밀번호**: BCrypt 암호화, 평문 저장/전송 금지
4. **권한 관리**: URL 기반(SecurityFilterChain) + 메서드 수준(`@PreAuthorize`) 보안 조합
5. **현재 사용자**: `@AuthenticationPrincipal Long userId`로 간편하게 접근

<details>
<summary>⚠️ 과제에서 흔한 실수</summary>

1. **JWT Secret 하드코딩**
   - 소스 코드에 Secret 직접 작성
   - 반드시 application.yml 또는 환경변수로 분리

2. **토큰 만료 처리 누락**
   - 토큰 검증 시 만료 여부 확인 필요
   - 만료된 토큰에 대한 적절한 에러 응답 (401)

3. **비밀번호 평문 노출**
   - Response DTO에 비밀번호 필드 포함
   - 로그에 비밀번호 출력

4. **권한 검사 누락**
   - 다른 사용자의 리소스 접근 가능
   - 리소스 소유자 검증 필수

5. **CORS 전체 허용**
   - `allowedOrigins("*")` + `allowCredentials(true)` 조합 불가
   - 프로덕션에서는 특정 Origin만 허용

</details>

<details>
<summary>💡 Refresh Token Rotation</summary>

**Refresh Token Rotation**이란 Refresh Token 사용 시 새로운 Refresh Token도 함께 발급하는 방식이다.

```java
public TokenResponse refresh(String refreshToken) {
    if (!jwtTokenProvider.validateToken(refreshToken)) {
        throw new InvalidTokenException();
    }

    Long userId = jwtTokenProvider.getUserId(refreshToken);
    Member member = memberRepository.findById(userId)
        .orElseThrow(() -> new MemberNotFoundException(userId));

    // 새로운 Access Token과 Refresh Token 모두 발급
    String newAccessToken = jwtTokenProvider.createAccessToken(
        member.getId(), member.getEmail(), member.getRole().name());
    String newRefreshToken = jwtTokenProvider.createRefreshToken(member.getId());

    // 기존 Refresh Token 무효화 (DB에 저장하는 경우)
    // refreshTokenRepository.delete(refreshToken);

    return new TokenResponse(newAccessToken, newRefreshToken);
}
```

**장점**: Refresh Token 탈취 시에도 지속적인 악용 방지

**과제에서**: 구현하면 가산점, 구현하지 않아도 감점은 아님

</details>

<details>
<summary>💼 실무에서의 JWT 관리 팁</summary>

**1. Access Token 만료 시간 설정**

| 환경 | Access Token | Refresh Token |
|------|--------------|---------------|
| 일반 웹 서비스 | 15분 ~ 1시간 | 7일 ~ 30일 |
| 금융/보안 민감 서비스 | 5분 ~ 15분 | 1일 ~ 7일 |
| 모바일 앱 | 1시간 ~ 24시간 | 30일 ~ 90일 |

**2. Token 저장 위치**

| 저장 위치 | 장점 | 단점 |
|----------|------|------|
| **LocalStorage** | 구현 간단 | XSS 취약 |
| **HttpOnly Cookie** | XSS 방지 | CSRF 대응 필요 |
| **메모리 (변수)** | 가장 안전 | 새로고침 시 유실 |

> **실무 권장**: Access Token은 메모리에, Refresh Token은 HttpOnly Cookie에 저장

**3. 토큰 무효화 전략**

JWT는 Stateless하므로 발급 후 서버에서 무효화가 어렵다. 실무에서는 다음 방법을 사용한다:

```java
// 방법 1: 블랙리스트 (Redis 활용)
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

// 방법 2: Token Version (DB에 버전 관리)
@Entity
public class Member {
    // ...
    private int tokenVersion = 0;  // 로그아웃 시 증가

    public void invalidateTokens() {
        this.tokenVersion++;
    }
}
```

**4. 다중 디바이스 로그인 관리**

```java
// 사용자별 활성 세션 관리
@Service
public class SessionService {

    private final StringRedisTemplate redisTemplate;

    public void registerSession(Long userId, String deviceId, String refreshToken) {
        String key = "sessions:" + userId;
        redisTemplate.opsForHash().put(key, deviceId, refreshToken);
    }

    // 특정 디바이스 로그아웃
    public void logoutDevice(Long userId, String deviceId) {
        redisTemplate.opsForHash().delete("sessions:" + userId, deviceId);
    }

    // 모든 디바이스 로그아웃
    public void logoutAllDevices(Long userId) {
        redisTemplate.delete("sessions:" + userId);
    }
}
```

**과제에서**: 기본 JWT 인증만 구현해도 충분. 위 내용은 면접 대비 개념 정리용.

</details>

---

다음 편에서는 **Docker**, **Docker Compose**, **GitHub Actions CI/CD**에 대해 다룹니다.

👉 [이전: 4편 - Performance & Optimization](/blog/spring-boot-pre-interview-guide-4)
👉 [다음: 6편 - DevOps & Deployment](/blog/spring-boot-pre-interview-guide-6)
