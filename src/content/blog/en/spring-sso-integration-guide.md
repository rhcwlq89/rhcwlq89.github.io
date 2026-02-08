---
title: "Spring Boot SSO Integration Guide: OAuth2/OIDC and SAML in Practice"
description: "A practical guide to SSO integration with IdPs like Keycloak, Okta, and Azure AD using Spring Security"
pubDate: 2026-02-08T15:00:00+09:00
lang: en
tags: ["Spring Boot", "SSO", "OAuth2", "OIDC", "SAML", "Spring Security"]
heroImage: "../../../assets/PracticalGuideSeries.png"
---

## Introduction

When operating multiple systems in an enterprise environment, you frequently encounter **Single Sign-On (SSO)** requirements. Users can access multiple applications with a single login, and development teams can avoid duplicating authentication logic.

This guide covers two primary approaches to implementing SSO in a Spring Boot application:
- **OAuth2/OIDC** - The modern and most widely used approach
- **SAML 2.0** - Still widely used in enterprise environments

### Table of Contents

- [SSO Fundamentals](#1-sso-fundamentals)
- [OAuth2/OIDC-Based SSO](#2-oauth2oidc-based-sso)
- [Keycloak Integration in Practice](#3-keycloak-integration-in-practice)
- [Okta/Azure AD Integration](#4-oktaazure-ad-integration)
- [SAML 2.0-Based SSO](#5-saml-20-based-sso)
- [Session Management and Logout](#6-session-management-and-logout)
- [Practical Tips and Troubleshooting](#7-practical-tips-and-troubleshooting)
- [FAQ](#8-faq)

---

## 1. SSO Fundamentals

### 1.1 What is SSO?

**Single Sign-On (SSO)** is an authentication method that allows users to access multiple applications with a single authentication.

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

SP = Service Provider (the application we develop)
```

### 1.2 Protocol Comparison

| Item | OAuth2/OIDC | SAML 2.0 |
|------|-------------|----------|
| **Token Format** | JWT (JSON) | XML Assertion |
| **Transport Method** | REST API | Browser Redirect/POST |
| **Complexity** | Low | High |
| **Mobile Support** | Excellent | Limited |
| **Use Case** | Modern web/mobile apps | Enterprise legacy |
| **Spring Support** | Very good | Good |

**Recommendation**: For new projects, choose **OAuth2/OIDC**. Consider SAML only when integrating with legacy systems.

### 1.3 Key Terminology

| Term | Description |
|------|-------------|
| **IdP (Identity Provider)** | Responsible for user authentication (Keycloak, Okta, Azure AD) |
| **SP (Service Provider)** | The application providing the service (our app) |
| **Client ID** | Application identifier registered with the IdP |
| **Client Secret** | Secret key for application authentication |
| **Redirect URI** | Callback URL to return to after authentication |
| **Scope** | Requested permission scope (openid, profile, email) |

---

## 2. OAuth2/OIDC-Based SSO

### 2.1 Adding Dependencies

```kotlin
// build.gradle.kts
dependencies {
    implementation("org.springframework.boot:spring-boot-starter-oauth2-client")
    implementation("org.springframework.boot:spring-boot-starter-security")
}
```

### 2.2 Authorization Code Flow

This is the most secure and recommended flow:

```
┌──────┐                              ┌──────┐                              ┌──────┐
│ User │                              │  SP  │                              │ IdP  │
└──┬───┘                              └──┬───┘                              └──┬───┘
   │  1. Access /dashboard                │                                    │
   │─────────────────────────────────▶│                                    │
   │                                    │  2. 302 Redirect to IdP            │
   │◀─────────────────────────────────│                                    │
   │  3. IdP login page                  │                                    │
   │────────────────────────────────────────────────────────────────────▶│
   │                                    │                                    │
   │  4. Login (ID/PW or SSO)            │                                    │
   │────────────────────────────────────────────────────────────────────▶│
   │                                    │  5. 302 Redirect with code         │
   │◀────────────────────────────────────────────────────────────────────│
   │  6. Redirect to SP (/callback)     │                                    │
   │─────────────────────────────────▶│                                    │
   │                                    │  7. Exchange code for token         │
   │                                    │───────────────────────────────────▶│
   │                                    │  8. Access Token + ID Token        │
   │                                    │◀───────────────────────────────────│
   │  9. Create session, redirect to     │                                    │
   │     original page                   │                                    │
   │◀─────────────────────────────────│                                    │
```

### 2.3 Basic Configuration (application.yml)

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          keycloak:  # Registration ID (any name you choose)
            client-id: my-app
            client-secret: ${KEYCLOAK_CLIENT_SECRET}
            scope: openid, profile, email
            authorization-grant-type: authorization_code
            redirect-uri: "{baseUrl}/login/oauth2/code/{registrationId}"
        provider:
          keycloak:
            issuer-uri: https://auth.example.com/realms/my-realm
            # Setting only issuer-uri auto-configures the following:
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
                    .loginPage("/login")  // Custom login page (optional)
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

### 2.5 Accessing User Information

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
            "sub" to oauth2User.getAttribute<String>("sub"),  // Unique ID
            "roles" to oauth2User.authorities.map { it.authority }
        )
    }

    // Using OidcUser provides access to more information
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

## 3. Keycloak Integration in Practice

Keycloak is an open-source IdP widely used in both local development and production environments.

### 3.1 Running Keycloak with Docker

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
# Access http://localhost:8180
```

### 3.2 Keycloak Configuration

1. **Create Realm**: `my-realm`
2. **Create Client**:
   - Client ID: `my-app`
   - Client authentication: ON
   - Valid redirect URIs: `http://localhost:8080/*`
   - Web origins: `http://localhost:8080`
3. **Create User**: Test user

### 3.3 application.yml Configuration

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

### 3.4 Role Mapping

Mapping Keycloak roles to Spring Security authorities:

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
                    // Extract roles from realm_access.roles
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

Now you can use `@PreAuthorize("hasRole('ADMIN')")` for Keycloak role-based access control.

---

## 4. Okta/Azure AD Integration

### 4.1 Okta Configuration

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

### 4.2 Azure AD (Microsoft Entra ID) Configuration

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

### 4.3 Multiple IdP Support

You can support multiple IdPs simultaneously:

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

Selecting an IdP on the login page:

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

## 5. SAML 2.0-Based SSO

This is needed when integrating with legacy systems or IdPs that only support SAML.

### 5.1 Adding Dependencies

```kotlin
// build.gradle.kts
dependencies {
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.security:spring-security-saml2-service-provider")
}
```

### 5.2 SAML Configuration

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

### 5.4 Certificate Generation

Self-signed certificate for development:

```bash
# Generate Private Key
openssl genrsa -out private.key 2048

# Generate Certificate
openssl req -new -x509 -key private.key -out certificate.crt -days 365 \
  -subj "/CN=my-app/O=My Company/C=KR"
```

---

## 6. Session Management and Logout

### 6.1 Single Logout (SLO)

When logging out from the IdP, the user should be logged out from all SPs:

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

### 6.2 Session Timeout Synchronization

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

### 6.3 Automatic Token Renewal

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
            .refreshToken()  // Refresh Token support
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

## 7. Practical Tips and Troubleshooting

### 7.1 Common Issues

#### redirect_uri_mismatch Error

```
OAuth2 Error: redirect_uri_mismatch
```

**Cause**: Mismatch between the Redirect URI registered in the IdP and the request URI

**Solution**:
1. Register the exact URI in the IdP settings: `http://localhost:8080/login/oauth2/code/keycloak`
2. HTTPS is required in production

#### invalid_token Error

**Cause**: Clock skew (server time difference)

**Solution**:
```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          clock-skew: 60s  # Allowed tolerance
```

### 7.2 Production Checklist

```yaml
# Production settings
spring:
  security:
    oauth2:
      client:
        registration:
          keycloak:
            client-secret: ${KEYCLOAK_CLIENT_SECRET}  # Use environment variables
            redirect-uri: https://app.example.com/login/oauth2/code/keycloak  # HTTPS

# Development settings (DO NOT use in production)
# client-secret: my-secret-123  # Hardcoded
# redirect-uri: http://localhost:8080/...  # HTTP
```

### 7.3 Logging Configuration

Useful log settings for debugging issues:

```yaml
logging:
  level:
    org.springframework.security: DEBUG
    org.springframework.security.oauth2: TRACE
    org.springframework.security.saml2: TRACE
```

### 7.4 Test Code

```kotlin
@WebMvcTest(UserController::class)
class UserControllerTest {

    @Autowired
    private lateinit var mockMvc: MockMvc

    @Test
    @WithMockUser  // Basic authentication mocking
    fun `authenticated user can access API`() {
        mockMvc.get("/api/me")
            .andExpect { status { isOk() } }
    }

    @Test
    fun `unauthenticated user is redirected`() {
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
    fun `retrieve OIDC user information`() {
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

### Q1. What is the difference between OAuth2 and OIDC?

**OAuth2** is an authorization framework that deals with "Is this app allowed to access user data?"

**OIDC (OpenID Connect)** adds an authentication layer on top of OAuth2, dealing with "Who is this user?" It provides user information through an ID Token (JWT).

**In practice**: Use OIDC. Spring Security's `oauth2Login()` supports OIDC by default.

### Q2. What is the difference between Access Token and ID Token?

| Item | Access Token | ID Token |
|------|-------------|----------|
| **Purpose** | Proves API access authorization | Proves user identity |
| **Audience** | Resource Server (API) | Client Application |
| **Included Information** | scope, permissions | User info (sub, email, name) |
| **Sent To** | External APIs | Used only by the client |

### Q3. Where should I store the Client Secret?

**Recommended order**:
1. **Vault/AWS Secrets Manager** - Most secure
2. **Environment variables** - Injected via CI/CD
3. **Encrypted configuration files** - Using tools like jasypt

**Strictly prohibited**: Storing in plain text in a Git repository

### Q4. How do I link SSO with an existing user table?

```kotlin
@Service
class CustomOidcUserService(
    private val userRepository: UserRepository
) : OidcUserService() {

    override fun loadUser(userRequest: OidcUserRequest): OidcUser {
        val oidcUser = super.loadUser(userRequest)

        // Unique ID from the IdP (sub claim)
        val providerId = oidcUser.subject
        val email = oidcUser.email

        // Look up existing user or create a new one
        val user = userRepository.findByProviderId(providerId)
            ?: userRepository.save(
                User(
                    providerId = providerId,
                    email = email,
                    name = oidcUser.fullName
                )
            )

        // Return OidcUser with custom information
        return CustomOidcUser(oidcUser, user)
    }
}
```

### Q5. How can I test without an IdP during local development?

**Method 1**: Mock the IdP with WireMock

**Method 2**: Profile-based configuration

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

**Method 3**: Inject a test user

```kotlin
@Component
@Profile("local")
class DevUserInjector : OncePerRequestFilter() {

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain
    ) {
        val devUser = // Create Mock User
        SecurityContextHolder.getContext().authentication = devUser
        filterChain.doFilter(request, response)
    }
}
```

---

## Summary

| Scenario | Recommended Approach |
|----------|---------------------|
| New project | OAuth2/OIDC |
| Legacy IdP integration | SAML 2.0 |
| Building your own IdP | Keycloak |
| Using a SaaS IdP | Okta, Auth0, Azure AD |
| Social login | Spring OAuth2 Client + Google/GitHub |

**Key Points**:
1. Setting only `issuer-uri` auto-configures most settings
2. Manage Client Secret with environment variables
3. Always use HTTPS in production
4. Connect IdP roles to Spring Security authorities through role mapping
5. Strengthen security by implementing Single Logout
