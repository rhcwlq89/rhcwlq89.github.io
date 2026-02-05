---
title: "Spring Boot SSO 연동 가이드: OAuth2/OIDC와 SAML 실무 구현"
description: "Spring Security로 Keycloak, Okta, Azure AD 등 IdP와 SSO 연동하는 실무 가이드"
pubDate: 2026-02-05T15:00:00+09:00
tags: ["Spring Boot", "Spring Security", "SSO", "OAuth2", "OIDC", "SAML", "Keycloak"]
heroImage: "../../assets/PracticalGuideSeries.png"
---

## 서론

기업 환경에서 여러 시스템을 운영하다 보면 **Single Sign-On(SSO)** 요구사항을 자주 마주친다. 사용자는 한 번 로그인으로 여러 애플리케이션에 접근하고, 개발팀은 인증 로직 중복을 피할 수 있다.

이 가이드에서는 Spring Boot 애플리케이션에서 SSO를 구현하는 두 가지 주요 방식을 다룬다:
- **OAuth2/OIDC** - 현대적이고 가장 널리 사용되는 방식
- **SAML 2.0** - 엔터프라이즈 환경에서 여전히 많이 사용

### 목차

- [SSO 기본 개념](#1-sso-기본-개념)
- [OAuth2/OIDC 기반 SSO](#2-oauth2oidc-기반-sso)
- [Keycloak 연동 실습](#3-keycloak-연동-실습)
- [Okta/Azure AD 연동](#4-oktaazure-ad-연동)
- [SAML 2.0 기반 SSO](#5-saml-20-기반-sso)
- [세션 관리와 로그아웃](#6-세션-관리와-로그아웃)
- [실무 팁과 트러블슈팅](#7-실무-팁과-트러블슈팅)
- [FAQ](#8-faq)

---

## 1. SSO 기본 개념

### 1.1 SSO란?

**Single Sign-On(SSO)**은 한 번의 인증으로 여러 애플리케이션에 접근할 수 있게 하는 인증 방식이다.

```
┌─────────────────────────────────────────────────────────────┐
│                    Identity Provider (IdP)                   │
│                  (Keycloak, Okta, Azure AD)                  │
└─────────────────────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
    ┌─────────┐   ┌─────────┐   ┌─────────┐
    │  App A  │   │  App B  │   │  App C  │
    │  (SP)   │   │  (SP)   │   │  (SP)   │
    └─────────┘   └─────────┘   └─────────┘

SP = Service Provider (우리가 개발하는 애플리케이션)
```

### 1.2 프로토콜 비교

| 항목 | OAuth2/OIDC | SAML 2.0 |
|------|-------------|----------|
| **토큰 형식** | JWT (JSON) | XML Assertion |
| **전송 방식** | REST API | Browser Redirect/POST |
| **복잡도** | 낮음 | 높음 |
| **모바일 지원** | 우수 | 제한적 |
| **사용처** | 현대 웹/모바일 앱 | 엔터프라이즈 레거시 |
| **Spring 지원** | 매우 좋음 | 좋음 |

**권장사항**: 신규 프로젝트는 **OAuth2/OIDC**를 선택하라. SAML은 레거시 시스템 연동 시에만 고려한다.

### 1.3 주요 용어

| 용어 | 설명 |
|------|------|
| **IdP (Identity Provider)** | 사용자 인증을 담당 (Keycloak, Okta, Azure AD) |
| **SP (Service Provider)** | 서비스를 제공하는 애플리케이션 (우리 앱) |
| **Client ID** | IdP에 등록된 애플리케이션 식별자 |
| **Client Secret** | 애플리케이션 인증용 비밀키 |
| **Redirect URI** | 인증 후 돌아올 콜백 URL |
| **Scope** | 요청하는 권한 범위 (openid, profile, email) |

---

## 2. OAuth2/OIDC 기반 SSO

### 2.1 의존성 추가

```kotlin
// build.gradle.kts
dependencies {
    implementation("org.springframework.boot:spring-boot-starter-oauth2-client")
    implementation("org.springframework.boot:spring-boot-starter-security")
}
```

### 2.2 Authorization Code Flow

가장 안전하고 권장되는 흐름이다:

```
┌──────┐                              ┌──────┐                              ┌──────┐
│ User │                              │  SP  │                              │ IdP  │
└──┬───┘                              └──┬───┘                              └──┬───┘
   │  1. /dashboard 접근                 │                                    │
   │─────────────────────────────────▶│                                    │
   │                                    │  2. 302 Redirect to IdP            │
   │◀─────────────────────────────────│                                    │
   │  3. IdP 로그인 페이지               │                                    │
   │────────────────────────────────────────────────────────────────────▶│
   │                                    │                                    │
   │  4. 로그인 (ID/PW 또는 SSO)         │                                    │
   │────────────────────────────────────────────────────────────────────▶│
   │                                    │  5. 302 Redirect with code         │
   │◀────────────────────────────────────────────────────────────────────│
   │  6. Redirect to SP (/callback)     │                                    │
   │─────────────────────────────────▶│                                    │
   │                                    │  7. code → token 교환               │
   │                                    │───────────────────────────────────▶│
   │                                    │  8. Access Token + ID Token        │
   │                                    │◀───────────────────────────────────│
   │  9. 세션 생성, 원래 페이지 이동      │                                    │
   │◀─────────────────────────────────│                                    │
```

### 2.3 기본 설정 (application.yml)

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          keycloak:  # 등록 ID (원하는 이름)
            client-id: my-app
            client-secret: ${KEYCLOAK_CLIENT_SECRET}
            scope: openid, profile, email
            authorization-grant-type: authorization_code
            redirect-uri: "{baseUrl}/login/oauth2/code/{registrationId}"
        provider:
          keycloak:
            issuer-uri: https://auth.example.com/realms/my-realm
            # issuer-uri만 설정하면 아래는 자동 설정됨
            # authorization-uri, token-uri, user-info-uri, jwk-set-uri
```

### 2.4 Security Config

```kotlin
@Configuration
@EnableWebSecurity
class SecurityConfig {

    @Bean
    fun securityFilterChain(http: HttpSecurity): SecurityFilterChain {
        return http
            .authorizeHttpRequests { auth ->
                auth
                    .requestMatchers("/", "/public/**", "/health").permitAll()
                    .anyRequest().authenticated()
            }
            .oauth2Login { oauth2 ->
                oauth2
                    .loginPage("/login")  // 커스텀 로그인 페이지 (선택)
                    .defaultSuccessUrl("/dashboard", true)
                    .failureUrl("/login?error=true")
            }
            .logout { logout ->
                logout
                    .logoutSuccessUrl("/")
                    .invalidateHttpSession(true)
                    .clearAuthentication(true)
            }
            .build()
    }
}
```

### 2.5 사용자 정보 접근

```kotlin
@RestController
@RequestMapping("/api")
class UserController {

    @GetMapping("/me")
    fun getCurrentUser(
        @AuthenticationPrincipal oauth2User: OAuth2User
    ): Map<String, Any?> {
        return mapOf(
            "name" to oauth2User.getAttribute<String>("name"),
            "email" to oauth2User.getAttribute<String>("email"),
            "sub" to oauth2User.getAttribute<String>("sub"),  // 고유 ID
            "roles" to oauth2User.authorities.map { it.authority }
        )
    }

    // OidcUser 사용 시 더 많은 정보 접근 가능
    @GetMapping("/me/detailed")
    fun getDetailedUser(
        @AuthenticationPrincipal oidcUser: OidcUser
    ): Map<String, Any?> {
        return mapOf(
            "claims" to oidcUser.claims,
            "idToken" to oidcUser.idToken.tokenValue,
            "userInfo" to oidcUser.userInfo?.claims
        )
    }
}
```

---

## 3. Keycloak 연동 실습

Keycloak은 오픈소스 IdP로, 로컬 개발과 프로덕션 모두에서 많이 사용된다.

### 3.1 Docker로 Keycloak 실행

```yaml
# docker-compose.yml
services:
  keycloak:
    image: quay.io/keycloak/keycloak:24.0
    command: start-dev
    environment:
      KEYCLOAK_ADMIN: admin
      KEYCLOAK_ADMIN_PASSWORD: admin
    ports:
      - "8180:8080"
```

```bash
docker-compose up -d
# http://localhost:8180 접속
```

### 3.2 Keycloak 설정

1. **Realm 생성**: `my-realm`
2. **Client 생성**:
   - Client ID: `my-app`
   - Client authentication: ON
   - Valid redirect URIs: `http://localhost:8080/*`
   - Web origins: `http://localhost:8080`
3. **User 생성**: 테스트용 사용자

### 3.3 application.yml 설정

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          keycloak:
            client-id: my-app
            client-secret: ${KEYCLOAK_CLIENT_SECRET}
            scope: openid, profile, email
        provider:
          keycloak:
            issuer-uri: http://localhost:8180/realms/my-realm
```

### 3.4 역할(Role) 매핑

Keycloak의 역할을 Spring Security 권한으로 매핑:

```kotlin
@Configuration
class OAuth2Config {

    @Bean
    fun keycloakGrantedAuthoritiesMapper(): GrantedAuthoritiesMapper {
        return GrantedAuthoritiesMapper { authorities ->
            val mappedAuthorities = mutableSetOf<GrantedAuthority>()

            authorities.forEach { authority ->
                mappedAuthorities.add(authority)

                if (authority is OidcUserAuthority) {
                    // realm_access.roles에서 역할 추출
                    val realmAccess = authority.idToken
                        .getClaim<Map<String, Any>>("realm_access")

                    val roles = realmAccess?.get("roles") as? List<*>
                    roles?.forEach { role ->
                        mappedAuthorities.add(
                            SimpleGrantedAuthority("ROLE_${role.toString().uppercase()}")
                        )
                    }
                }
            }

            mappedAuthorities
        }
    }
}
```

이제 `@PreAuthorize("hasRole('ADMIN')")`으로 Keycloak 역할 기반 접근 제어가 가능하다.

---

## 4. Okta/Azure AD 연동

### 4.1 Okta 설정

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          okta:
            client-id: ${OKTA_CLIENT_ID}
            client-secret: ${OKTA_CLIENT_SECRET}
            scope: openid, profile, email
        provider:
          okta:
            issuer-uri: https://${OKTA_DOMAIN}/oauth2/default
```

### 4.2 Azure AD (Microsoft Entra ID) 설정

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          azure:
            client-id: ${AZURE_CLIENT_ID}
            client-secret: ${AZURE_CLIENT_SECRET}
            scope: openid, profile, email
        provider:
          azure:
            issuer-uri: https://login.microsoftonline.com/${AZURE_TENANT_ID}/v2.0
```

### 4.3 다중 IdP 지원

여러 IdP를 동시에 지원할 수 있다:

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          keycloak:
            client-id: ${KEYCLOAK_CLIENT_ID}
            client-secret: ${KEYCLOAK_CLIENT_SECRET}
            scope: openid, profile, email
          google:
            client-id: ${GOOGLE_CLIENT_ID}
            client-secret: ${GOOGLE_CLIENT_SECRET}
            scope: openid, profile, email
          azure:
            client-id: ${AZURE_CLIENT_ID}
            client-secret: ${AZURE_CLIENT_SECRET}
            scope: openid, profile, email
        provider:
          keycloak:
            issuer-uri: https://auth.example.com/realms/my-realm
```

로그인 페이지에서 IdP 선택:

```kotlin
@Controller
class LoginController {

    @GetMapping("/login")
    fun login(
        model: Model,
        clientRegistrationRepository: ClientRegistrationRepository
    ): String {
        val registrations = (clientRegistrationRepository as InMemoryClientRegistrationRepository)
            .map { registration ->
                mapOf(
                    "id" to registration.registrationId,
                    "name" to registration.clientName,
                    "url" to "/oauth2/authorization/${registration.registrationId}"
                )
            }

        model.addAttribute("registrations", registrations)
        return "login"
    }
}
```

```html
<!-- templates/login.html -->
<div th:each="registration : ${registrations}">
    <a th:href="${registration.url}" th:text="${registration.name}">Login</a>
</div>
```

---

## 5. SAML 2.0 기반 SSO

레거시 시스템이나 SAML만 지원하는 IdP 연동 시 필요하다.

### 5.1 의존성 추가

```kotlin
// build.gradle.kts
dependencies {
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.security:spring-security-saml2-service-provider")
}
```

### 5.2 SAML 설정

```yaml
spring:
  security:
    saml2:
      relyingparty:
        registration:
          my-idp:
            signing:
              credentials:
                - private-key-location: classpath:saml/private.key
                  certificate-location: classpath:saml/certificate.crt
            assertingparty:
              metadata-uri: https://idp.example.com/metadata.xml
            singlelogout:
              binding: POST
              url: "{baseUrl}/logout/saml2/slo"
```

### 5.3 Security Config (SAML)

```kotlin
@Configuration
@EnableWebSecurity
class SamlSecurityConfig {

    @Bean
    fun securityFilterChain(http: HttpSecurity): SecurityFilterChain {
        return http
            .authorizeHttpRequests { auth ->
                auth
                    .requestMatchers("/", "/public/**").permitAll()
                    .anyRequest().authenticated()
            }
            .saml2Login { saml2 ->
                saml2
                    .defaultSuccessUrl("/dashboard", true)
            }
            .saml2Logout { }
            .build()
    }
}
```

### 5.4 인증서 생성

개발용 자체 서명 인증서:

```bash
# Private Key 생성
openssl genrsa -out private.key 2048

# 인증서 생성
openssl req -new -x509 -key private.key -out certificate.crt -days 365 \
  -subj "/CN=my-app/O=My Company/C=KR"
```

---

## 6. 세션 관리와 로그아웃

### 6.1 Single Logout (SLO)

IdP에서 로그아웃하면 모든 SP에서 로그아웃되어야 한다:

```kotlin
@Configuration
class OAuth2LogoutConfig {

    @Bean
    fun securityFilterChain(http: HttpSecurity): SecurityFilterChain {
        return http
            .oauth2Login { }
            .logout { logout ->
                logout.logoutSuccessHandler(oidcLogoutSuccessHandler())
            }
            .build()
    }

    @Bean
    fun oidcLogoutSuccessHandler(): LogoutSuccessHandler {
        val handler = OidcClientInitiatedLogoutSuccessHandler(
            clientRegistrationRepository
        )
        handler.setPostLogoutRedirectUri("{baseUrl}/")
        return handler
    }
}
```

### 6.2 세션 타임아웃 동기화

```kotlin
@Component
class SessionExpirationChecker(
    private val authorizedClientService: OAuth2AuthorizedClientService
) {

    fun isTokenExpired(authentication: Authentication): Boolean {
        if (authentication !is OAuth2AuthenticationToken) return false

        val client = authorizedClientService.loadAuthorizedClient<OAuth2AuthorizedClient>(
            authentication.authorizedClientRegistrationId,
            authentication.name
        )

        val accessToken = client?.accessToken ?: return true
        return accessToken.expiresAt?.isBefore(Instant.now()) ?: false
    }
}
```

### 6.3 토큰 자동 갱신

```kotlin
@Configuration
class OAuth2ClientConfig {

    @Bean
    fun authorizedClientManager(
        clientRegistrationRepository: ClientRegistrationRepository,
        authorizedClientRepository: OAuth2AuthorizedClientRepository
    ): OAuth2AuthorizedClientManager {
        val authorizedClientProvider = OAuth2AuthorizedClientProviderBuilder.builder()
            .authorizationCode()
            .refreshToken()  // Refresh Token 지원
            .build()

        val authorizedClientManager = DefaultOAuth2AuthorizedClientManager(
            clientRegistrationRepository,
            authorizedClientRepository
        )
        authorizedClientManager.setAuthorizedClientProvider(authorizedClientProvider)

        return authorizedClientManager
    }
}
```

---

## 7. 실무 팁과 트러블슈팅

### 7.1 흔한 문제들

#### redirect_uri_mismatch 오류

```
OAuth2 Error: redirect_uri_mismatch
```

**원인**: IdP에 등록된 Redirect URI와 요청 URI 불일치

**해결**:
1. IdP 설정에서 정확한 URI 등록: `http://localhost:8080/login/oauth2/code/keycloak`
2. 프로덕션에서는 HTTPS 필수

#### invalid_token 오류

**원인**: Clock skew (서버 시간 차이)

**해결**:
```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          clock-skew: 60s  # 허용 오차
```

### 7.2 프로덕션 체크리스트

```yaml
# ✅ 프로덕션 설정
spring:
  security:
    oauth2:
      client:
        registration:
          keycloak:
            client-secret: ${KEYCLOAK_CLIENT_SECRET}  # 환경변수 사용
            redirect-uri: https://app.example.com/login/oauth2/code/keycloak  # HTTPS

# ❌ 개발용 설정 (프로덕션 금지)
# client-secret: my-secret-123  # 하드코딩
# redirect-uri: http://localhost:8080/...  # HTTP
```

### 7.3 로깅 설정

문제 디버깅 시 유용한 로그 설정:

```yaml
logging:
  level:
    org.springframework.security: DEBUG
    org.springframework.security.oauth2: TRACE
    org.springframework.security.saml2: TRACE
```

### 7.4 테스트 코드

```kotlin
@WebMvcTest(UserController::class)
class UserControllerTest {

    @Autowired
    private lateinit var mockMvc: MockMvc

    @Test
    @WithMockUser  // 기본 인증 모킹
    fun `인증된 사용자는 API 접근 가능`() {
        mockMvc.get("/api/me")
            .andExpect { status { isOk() } }
    }

    @Test
    fun `미인증 사용자는 리다이렉트`() {
        mockMvc.get("/api/me")
            .andExpect { status { is3xxRedirection() } }
    }

    @Test
    @WithMockOidcUser(
        claims = [
            OidcIdTokenClaim(name = "sub", value = "user-123"),
            OidcIdTokenClaim(name = "email", value = "test@example.com")
        ]
    )
    fun `OIDC 사용자 정보 조회`() {
        mockMvc.get("/api/me")
            .andExpect {
                status { isOk() }
                jsonPath("$.email") { value("test@example.com") }
            }
    }
}
```

---

## 8. FAQ

### Q1. OAuth2와 OIDC의 차이점은?

**OAuth2**는 인가(Authorization) 프레임워크로, "이 앱이 사용자 데이터에 접근해도 되는가?"를 다룬다.

**OIDC (OpenID Connect)**는 OAuth2 위에 인증(Authentication) 레이어를 추가한 것으로, "이 사용자가 누구인가?"를 다룬다. ID Token(JWT)을 통해 사용자 정보를 제공한다.

**실무에서는**: OIDC를 사용하라. Spring Security의 `oauth2Login()`은 기본적으로 OIDC를 지원한다.

### Q2. Access Token과 ID Token의 차이는?

| 항목 | Access Token | ID Token |
|------|-------------|----------|
| **용도** | API 접근 권한 증명 | 사용자 신원 증명 |
| **대상** | Resource Server (API) | Client Application |
| **포함 정보** | scope, 권한 | 사용자 정보 (sub, email, name) |
| **전송 대상** | 외부 API에 전송 | 클라이언트에서만 사용 |

### Q3. Client Secret은 어디에 저장해야 하나?

**권장 순서**:
1. **Vault/AWS Secrets Manager** - 가장 안전
2. **환경 변수** - CI/CD에서 주입
3. **암호화된 설정 파일** - jasypt 등 사용

**절대 금지**: Git 저장소에 평문 저장

### Q4. SSO 연동 시 기존 사용자 테이블과 어떻게 연결하나?

```kotlin
@Service
class CustomOidcUserService(
    private val userRepository: UserRepository
) : OidcUserService() {

    override fun loadUser(userRequest: OidcUserRequest): OidcUser {
        val oidcUser = super.loadUser(userRequest)

        // IdP의 고유 ID (sub claim)
        val providerId = oidcUser.subject
        val email = oidcUser.email

        // 기존 사용자 조회 또는 생성
        val user = userRepository.findByProviderId(providerId)
            ?: userRepository.save(
                User(
                    providerId = providerId,
                    email = email,
                    name = oidcUser.fullName
                )
            )

        // 커스텀 정보를 포함한 OidcUser 반환
        return CustomOidcUser(oidcUser, user)
    }
}
```

### Q5. 로컬 개발 시 IdP 없이 테스트하려면?

**방법 1**: WireMock으로 IdP 모킹

**방법 2**: 프로필 기반 설정

```kotlin
@Configuration
@Profile("local")
class LocalSecurityConfig {

    @Bean
    fun securityFilterChain(http: HttpSecurity): SecurityFilterChain {
        return http
            .authorizeHttpRequests { it.anyRequest().permitAll() }
            .build()
    }
}
```

**방법 3**: 테스트용 사용자 주입

```kotlin
@Component
@Profile("local")
class DevUserInjector : OncePerRequestFilter() {

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain
    ) {
        val devUser = // Mock User 생성
        SecurityContextHolder.getContext().authentication = devUser
        filterChain.doFilter(request, response)
    }
}
```

---

## 정리

| 상황 | 권장 방식 |
|------|----------|
| 신규 프로젝트 | OAuth2/OIDC |
| 레거시 IdP 연동 | SAML 2.0 |
| 자체 IdP 구축 | Keycloak |
| SaaS IdP 사용 | Okta, Auth0, Azure AD |
| 소셜 로그인 | Spring OAuth2 Client + Google/GitHub |

**핵심 포인트**:
1. `issuer-uri`만 설정하면 대부분 자동 설정됨
2. Client Secret은 환경 변수로 관리
3. 프로덕션에서는 반드시 HTTPS 사용
4. 역할 매핑으로 Spring Security 권한과 연결
5. Single Logout 구현으로 보안 강화
