---
title: "SAML 2.0 Authentication Complete Guide: From Concepts to Microsoft Entra ID Integration"
description: "A practical guide to SAML 2.0 protocol core concepts and implementing Microsoft Entra ID (Azure AD) SAML integration with Spring Boot"
pubDate: 2026-03-12T10:00:00+09:00
tags: ["SAML", "Spring Boot", "Spring Security", "Microsoft Entra ID", "Azure AD", "SSO", "Authentication"]
heroImage: "../../../assets/SamlAuthenticationGuide.png"
---

## Introduction

In enterprise environments, SAML 2.0 remains one of the most widely used authentication protocols. Especially for integrations with SaaS applications like Microsoft 365, Salesforce, and ServiceNow, SAML is the de facto standard.

This guide covers the core concepts of SAML 2.0 and walks through implementing **Microsoft Entra ID (formerly Azure AD)** SAML integration in a Spring Boot application.

### Table of Contents

- [SAML 2.0 Core Concepts](#1-saml-20-core-concepts)
- [SAML Authentication Flow Details](#2-saml-authentication-flow-details)
- [Microsoft Entra ID SAML Configuration](#3-microsoft-entra-id-saml-configuration)
- [Spring Boot SAML Integration](#4-spring-boot-saml-integration)
- [SAML Assertion Processing and User Mapping](#5-saml-assertion-processing-and-user-mapping)
- [Logout Handling (SLO)](#6-logout-handling-slo)
- [Troubleshooting and Debugging](#7-troubleshooting-and-debugging)
- [Security Checklist](#8-security-checklist)
- [FAQ](#9-faq)

---

## 1. SAML 2.0 Core Concepts

### 1.1 What is SAML?

**SAML (Security Assertion Markup Language) 2.0** is a standard protocol for exchanging authentication and authorization data in XML format. Established by OASIS in 2005, it has become a cornerstone technology for enterprise SSO.

```mermaid
flowchart TB
    subgraph IdP["Identity Provider (IdP) — Microsoft Entra ID, Okta, ADFS, etc."]
        US["User Store\n(Directory)"]
        CM["Certificate\nMgmt (X.509)"]
        AG["SAML Assertion\nGeneration/Sign"]
    end

    IdP -->|"SAML Response\n(XML + Signature)"| AppA["App A\n(SP)"]
    IdP -->|"SAML Response\n(XML + Signature)"| AppB["App B\n(SP)"]
```

### 1.2 Key Terminology

| Term | Description |
|------|-------------|
| **IdP (Identity Provider)** | System that performs user authentication and issues SAML Assertions |
| **SP (Service Provider)** | Application that provides services to users (our app) |
| **SAML Assertion** | XML document containing authentication information sent from IdP to SP |
| **Metadata** | XML containing IdP and SP configuration (endpoints, certificates, etc.) |
| **ACS URL** | Assertion Consumer Service URL. SP endpoint that receives SAML Responses |
| **Entity ID** | URI that uniquely identifies an IdP or SP |
| **RelayState** | Original URL to redirect to after authentication |
| **Name ID** | Value that identifies the user (email, UPN, etc.) |

### 1.3 SAML Assertion Structure

A SAML Assertion consists of three types of Statements:

```xml
<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
                ID="_abc123" Version="2.0"
                IssueInstant="2026-03-12T01:00:00Z">

  <!-- 1. Authentication Statement: When and how was the user authenticated -->
  <saml:AuthnStatement AuthnInstant="2026-03-12T01:00:00Z"
                       SessionIndex="_session_abc123">
    <saml:AuthnContext>
      <saml:AuthnContextClassRef>
        urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport
      </saml:AuthnContextClassRef>
    </saml:AuthnContext>
  </saml:AuthnStatement>

  <!-- 2. Attribute Statement: User attribute information -->
  <saml:AttributeStatement>
    <saml:Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress">
      <saml:AttributeValue>user@company.com</saml:AttributeValue>
    </saml:Attribute>
    <saml:Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname">
      <saml:AttributeValue>John</saml:AttributeValue>
    </saml:Attribute>
    <saml:Attribute Name="http://schemas.microsoft.com/ws/2008/06/identity/claims/groups">
      <saml:AttributeValue>admin-group-id</saml:AttributeValue>
    </saml:Attribute>
  </saml:AttributeStatement>

  <!-- 3. Authorization Decision Statement (optional): Authorization info -->
  <!-- Rarely used in practice -->
</saml:Assertion>
```

### 1.4 SAML vs OAuth2/OIDC Comparison

| Aspect | SAML 2.0 | OAuth2/OIDC |
|--------|----------|-------------|
| **Token Format** | XML Assertion | JWT (JSON) |
| **Transport** | Browser Redirect/POST | REST API |
| **Signing** | XML Signature (X.509) | JWS (JSON Web Signature) |
| **Metadata** | XML Metadata | Well-Known Endpoint (JSON) |
| **Mobile Support** | Limited (requires browser) | Excellent (native support) |
| **Complexity** | High (XML parsing, cert management) | Low |
| **Enterprise Adoption** | Very high | Growing |
| **Use Cases** | B2B, legacy, government/finance | B2C, mobile, new projects |

> **When should you choose SAML?**
> - The client's IdP only supports SAML
> - Integration with existing SAML infrastructure is required
> - Government/finance regulations mandate SAML
> - Registration as a Microsoft Entra ID Enterprise Application is needed

---

## 2. SAML Authentication Flow Details

### 2.1 SP-Initiated SSO (Most Common)

The user first accesses the SP (our application):

```mermaid
sequenceDiagram
    participant User
    participant SP as SP (Our App)
    participant IdP as IdP (Entra ID)

    User->>SP: 1. Access /dashboard
    SP-->>User: 2. 302 Redirect + SAMLRequest (Base64)
    User->>IdP: 3. Redirect to IdP login page
    IdP-->>User: 4. User authenticates (ID/PW, MFA, etc.)
    User->>SP: 5. SAMLResponse (POST) + Signed Assertion
    Note right of SP: 6. Assertion validation<br/>- XML signature verify<br/>- Expiration check<br/>- Audience check
    SP-->>User: 7. Session created + redirect
    SP-->>User: 8. /dashboard access granted
```

### 2.2 IdP-Initiated SSO

The user clicks the application from the IdP portal (e.g., Microsoft My Apps):

```mermaid
sequenceDiagram
    participant User
    participant IdP
    participant SP

    User->>IdP: 1. Click app in IdP portal
    Note right of IdP: 2. Generate SAMLResponse<br/>(without AuthnRequest)
    IdP-->>User: 3. SAMLResponse (POST)<br/>sent to SP's ACS URL
    User->>SP: SAMLResponse forwarded
    Note right of SP: 4. Validate Assertion + Create session
    SP-->>User: 5. Redirect to main page
```

> **Note**: IdP-Initiated SSO can be vulnerable to CSRF attacks. Prefer SP-Initiated whenever possible.

### 2.3 SAML Binding Methods

| Binding | Description | Usage |
|---------|-------------|-------|
| **HTTP-Redirect** | Sent via URL query parameters (GET) | AuthnRequest delivery |
| **HTTP-POST** | Sent via HTML Form hidden fields (POST) | SAMLResponse delivery |
| **HTTP-Artifact** | Only reference token is passed; actual data via back-channel | Large Assertions |

---

## 3. Microsoft Entra ID SAML Configuration

### 3.1 Register Enterprise Application

The procedure for registering a SAML application in the Microsoft Entra ID (formerly Azure AD) admin center.

**Step 1: Create Application**

```
Microsoft Entra admin center
  └─ Enterprise Applications
       └─ + New Application
            └─ Create your own application
                 └─ "My Spring Boot App"
                 └─ "Integrate any other application you don't find in the gallery"
```

**Step 2: Configure SAML SSO**

Select Single sign-on → SAML and configure the following:

| Setting | Value | Description |
|---------|-------|-------------|
| **Identifier (Entity ID)** | `https://myapp.example.com/saml/metadata` | SP's unique identifier |
| **Reply URL (ACS URL)** | `https://myapp.example.com/login/saml2/sso/azure` | URL to receive SAML Response |
| **Sign on URL** | `https://myapp.example.com/` | SP-Initiated SSO start URL |
| **Relay State** | (leave empty) | Post-authentication redirect URL |
| **Logout URL** | `https://myapp.example.com/logout/saml2/slo` | Single Logout URL |

**Step 3: Attributes & Claims Configuration**

Add required user attributes beyond the default claims:

| Claim Name | Source Attribute | Description |
|------------|-----------------|-------------|
| `emailaddress` | user.mail | User email |
| `givenname` | user.givenname | First name |
| `surname` | user.surname | Last name |
| `name` | user.displayname | Display name |
| `groups` | user.groups | Group membership |

**Step 4: Download Certificates**

- **Certificate (Base64)**: Download `.cer` file → Register in SP's trust store
- **Federation Metadata XML**: IdP metadata → Use in SP configuration
- **Login URL**: `https://login.microsoftonline.com/{tenant-id}/saml2`
- **Microsoft Entra Identifier**: `https://sts.windows.net/{tenant-id}/`

### 3.2 User/Group Assignment

```
Enterprise Application
  └─ Users and groups
       └─ + Add user/group
            └─ Select users or groups to grant access
```

> **Important**: SAML authentication will fail if users/groups are not assigned. You'll get an `AADSTS50105` error.

---

## 4. Spring Boot SAML Integration

### 4.1 Dependencies

```kotlin
// build.gradle.kts
plugins {
    id("org.springframework.boot") version "3.4.3"
    id("io.spring.dependency-management") version "1.1.7"
    kotlin("jvm") version "2.1.10"
    kotlin("plugin.spring") version "2.1.10"
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-thymeleaf")

    // SAML 2.0 core dependency
    implementation("org.springframework.security:spring-security-saml2-service-provider")

    // Development convenience
    developmentOnly("org.springframework.boot:spring-boot-devtools")
}
```

For Maven:

```xml
<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-security</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.security</groupId>
        <artifactId>spring-security-saml2-service-provider</artifactId>
    </dependency>
</dependencies>
```

### 4.2 application.yml Configuration

```yaml
spring:
  security:
    saml2:
      relyingparty:
        registration:
          azure:  # Registration ID (used in URL paths)
            entity-id: https://myapp.example.com/saml/metadata

            # ACS configuration
            acs:
              location: "{baseUrl}/login/saml2/sso/{registrationId}"
              binding: POST

            # SP signing key (optional: needed for signing AuthnRequest)
            signing:
              credentials:
                - private-key-location: classpath:credentials/sp-private.key
                  certificate-location: classpath:credentials/sp-certificate.crt

            # IdP configuration - use metadata URL (recommended)
            assertingparty:
              metadata-uri: https://login.microsoftonline.com/{tenant-id}/federationmetadata/2007-06/federationmetadata.xml?appid={app-id}

# Logging (for development)
logging:
  level:
    org.springframework.security.saml2: DEBUG
    org.opensaml: DEBUG
```

**Manual configuration instead of metadata URL:**

```yaml
spring:
  security:
    saml2:
      relyingparty:
        registration:
          azure:
            entity-id: https://myapp.example.com/saml/metadata
            acs:
              location: "{baseUrl}/login/saml2/sso/{registrationId}"
              binding: POST
            assertingparty:
              entity-id: https://sts.windows.net/{tenant-id}/
              single-sign-on:
                url: https://login.microsoftonline.com/{tenant-id}/saml2
                binding: POST
                sign-request: false
              verification:
                credentials:
                  - certificate-location: classpath:credentials/azure-idp.cer
```

### 4.3 Security Configuration

```kotlin
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
import org.springframework.security.web.SecurityFilterChain

@Configuration
@EnableWebSecurity
class SecurityConfig {

    @Bean
    fun securityFilterChain(http: HttpSecurity): SecurityFilterChain {
        http
            .authorizeHttpRequests { auth ->
                auth
                    .requestMatchers("/", "/health", "/error").permitAll()
                    .requestMatchers("/admin/**").hasRole("ADMIN")
                    .anyRequest().authenticated()
            }
            .saml2Login { saml2 ->
                saml2
                    .loginPage("/")  // Custom login page
                    .defaultSuccessUrl("/dashboard", true)
                    .failureUrl("/login?error=true")
            }
            .saml2Logout { logout ->
                logout
                    .logoutUrl("/logout")
                    .logoutSuccessUrl("/")
            }
            .saml2Metadata { }  // Enable SP metadata endpoint

        return http.build()
    }
}
```

### 4.4 Custom SAML Response Processing

To extract user information more granularly from the Assertion instead of using the default `OpenSaml4AuthenticationProvider`, use a custom converter:

```kotlin
import org.opensaml.saml.saml2.core.Assertion
import org.opensaml.saml.saml2.core.Attribute
import org.springframework.core.convert.converter.Converter
import org.springframework.security.authentication.AbstractAuthenticationToken
import org.springframework.security.core.GrantedAuthority
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.saml2.provider.service.authentication.OpenSaml4AuthenticationProvider
import org.springframework.security.saml2.provider.service.authentication.OpenSaml4AuthenticationProvider.ResponseToken
import org.springframework.security.saml2.provider.service.authentication.Saml2Authentication
import org.springframework.stereotype.Component

@Component
class SamlResponseAuthenticationConverter : Converter<ResponseToken, AbstractAuthenticationToken> {

    companion object {
        // Microsoft Entra ID standard claim URIs
        private const val CLAIM_EMAIL =
            "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
        private const val CLAIM_GIVEN_NAME =
            "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"
        private const val CLAIM_SURNAME =
            "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname"
        private const val CLAIM_DISPLAY_NAME =
            "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"
        private const val CLAIM_GROUPS =
            "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"
        private const val CLAIM_ROLES =
            "http://schemas.microsoft.com/ws/2008/06/identity/claims/role"
    }

    override fun convert(responseToken: ResponseToken): AbstractAuthenticationToken {
        val response = responseToken.response
        val assertion = response.assertions.firstOrNull()
            ?: throw IllegalArgumentException("No Assertion found in SAML Response")

        val attributes = extractAttributes(assertion)
        val authorities = extractAuthorities(assertion)

        val email = attributes[CLAIM_EMAIL] ?: assertion.subject?.nameID?.value ?: "unknown"
        val displayName = attributes[CLAIM_DISPLAY_NAME] ?: email

        val principal = SamlUserPrincipal(
            nameId = assertion.subject?.nameID?.value ?: "",
            email = email,
            displayName = displayName,
            givenName = attributes[CLAIM_GIVEN_NAME],
            surname = attributes[CLAIM_SURNAME],
            groups = extractMultiValueAttribute(assertion, CLAIM_GROUPS),
            attributes = attributes
        )

        return Saml2Authentication(
            principal,
            responseToken.token.samlResponse,
            authorities
        )
    }

    private fun extractAttributes(assertion: Assertion): Map<String, String> {
        return assertion.attributeStatements
            .flatMap { it.attributes }
            .associate { attr ->
                attr.name to (attr.attributeValues.firstOrNull()?.dom?.textContent ?: "")
            }
    }

    private fun extractMultiValueAttribute(assertion: Assertion, claimUri: String): List<String> {
        return assertion.attributeStatements
            .flatMap { it.attributes }
            .filter { it.name == claimUri }
            .flatMap { it.attributeValues }
            .mapNotNull { it.dom?.textContent }
    }

    private fun extractAuthorities(assertion: Assertion): List<GrantedAuthority> {
        val authorities = mutableListOf<GrantedAuthority>()

        // Extract authorities from Role claims
        val roles = extractMultiValueAttribute(assertion, CLAIM_ROLES)
        roles.forEach { role ->
            authorities.add(SimpleGrantedAuthority("ROLE_${role.uppercase()}"))
        }

        // Extract authorities from Group claims (group ID → role mapping)
        val groups = extractMultiValueAttribute(assertion, CLAIM_GROUPS)
        authorities.addAll(mapGroupsToAuthorities(groups))

        // Grant default ROLE_USER
        if (authorities.isEmpty()) {
            authorities.add(SimpleGrantedAuthority("ROLE_USER"))
        }

        return authorities
    }

    private fun mapGroupsToAuthorities(groupIds: List<String>): List<GrantedAuthority> {
        // Entra ID Group Object ID → Application role mapping
        val groupRoleMapping = mapOf(
            "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" to "ROLE_ADMIN",
            "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy" to "ROLE_MANAGER"
        )

        return groupIds
            .mapNotNull { groupRoleMapping[it] }
            .map { SimpleGrantedAuthority(it) }
    }
}
```

### 4.5 User Principal Class

```kotlin
import org.springframework.security.saml2.provider.service.authentication.Saml2AuthenticatedPrincipal
import java.io.Serializable

data class SamlUserPrincipal(
    val nameId: String,
    val email: String,
    val displayName: String,
    val givenName: String? = null,
    val surname: String? = null,
    val groups: List<String> = emptyList(),
    private val attributes: Map<String, String> = emptyMap()
) : Saml2AuthenticatedPrincipal, Serializable {

    override fun getName(): String = email

    override fun getFirstAttribute(name: String): String? = attributes[name]

    override fun getAttributes(): Map<String, List<Any>> {
        return attributes.mapValues { listOf(it.value as Any) }
    }

    override fun getSessionIndexes(): List<String> = emptyList()

    override fun getRelyingPartyRegistrationId(): String = ""
}
```

### 4.6 Applying Custom Converter to Security Config

```kotlin
@Configuration
@EnableWebSecurity
class SecurityConfig(
    private val samlResponseConverter: SamlResponseAuthenticationConverter
) {

    @Bean
    fun securityFilterChain(http: HttpSecurity): SecurityFilterChain {
        val authProvider = OpenSaml4AuthenticationProvider().apply {
            setResponseAuthenticationConverter(samlResponseConverter)
        }

        http
            .authorizeHttpRequests { auth ->
                auth
                    .requestMatchers("/", "/health", "/error").permitAll()
                    .requestMatchers("/admin/**").hasRole("ADMIN")
                    .anyRequest().authenticated()
            }
            .saml2Login { saml2 ->
                saml2
                    .authenticationManager { authentication ->
                        authProvider.authenticate(authentication)
                    }
                    .defaultSuccessUrl("/dashboard", true)
            }
            .saml2Logout { logout ->
                logout
                    .logoutUrl("/logout")
                    .logoutSuccessUrl("/")
            }
            .saml2Metadata { }

        return http.build()
    }
}
```

---

## 5. SAML Assertion Processing and User Mapping

### 5.1 Using User Information in Controllers

```kotlin
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.GetMapping

@Controller
class DashboardController {

    @GetMapping("/dashboard")
    fun dashboard(
        @AuthenticationPrincipal principal: SamlUserPrincipal,
        model: Model
    ): String {
        model.addAttribute("user", principal)
        model.addAttribute("email", principal.email)
        model.addAttribute("displayName", principal.displayName)
        model.addAttribute("groups", principal.groups)
        return "dashboard"
    }

    @GetMapping("/admin")
    fun admin(
        @AuthenticationPrincipal principal: SamlUserPrincipal,
        model: Model
    ): String {
        model.addAttribute("user", principal)
        return "admin"
    }
}
```

### 5.2 Automatic User Provisioning (JIT Provisioning)

A pattern for automatically creating/updating local users during SAML authentication:

```kotlin
import org.springframework.context.event.EventListener
import org.springframework.security.authentication.event.AuthenticationSuccessEvent
import org.springframework.security.saml2.provider.service.authentication.Saml2Authentication
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional

@Component
class SamlUserProvisioningListener(
    private val userRepository: UserRepository
) {

    @EventListener
    @Transactional
    fun onAuthenticationSuccess(event: AuthenticationSuccessEvent) {
        val authentication = event.authentication as? Saml2Authentication ?: return
        val principal = authentication.principal as? SamlUserPrincipal ?: return

        val user = userRepository.findByEmail(principal.email)

        if (user != null) {
            // Update existing user info
            user.apply {
                displayName = principal.displayName
                givenName = principal.givenName
                surname = principal.surname
                lastLoginAt = java.time.Instant.now()
            }
            userRepository.save(user)
        } else {
            // Auto-create new user
            val newUser = User(
                email = principal.email,
                nameId = principal.nameId,
                displayName = principal.displayName,
                givenName = principal.givenName,
                surname = principal.surname,
                lastLoginAt = java.time.Instant.now()
            )
            userRepository.save(newUser)
        }
    }
}
```

---

## 6. Logout Handling (SLO)

### 6.1 Single Logout Flow

```mermaid
sequenceDiagram
    participant User
    participant SP
    participant IdP

    User->>SP: 1. Click /logout
    SP->>IdP: 2. Generate LogoutRequest
    Note right of IdP: 3. IdP sends LogoutRequest<br/>to other SPs
    IdP-->>SP: 4. LogoutResponse
    SP-->>User: 5. Logout complete page
```

### 6.2 SLO Configuration

```yaml
# Add to application.yml
spring:
  security:
    saml2:
      relyingparty:
        registration:
          azure:
            singlelogout:
              url: https://login.microsoftonline.com/{tenant-id}/saml2
              binding: POST
              response-url: "{baseUrl}/logout/saml2/slo/{registrationId}"
```

### 6.3 Custom Logout Handler

```kotlin
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.security.core.Authentication
import org.springframework.security.web.authentication.logout.LogoutSuccessHandler
import org.springframework.stereotype.Component

@Component
class SamlLogoutSuccessHandler : LogoutSuccessHandler {

    override fun onLogoutSuccess(
        request: HttpServletRequest,
        response: HttpServletResponse,
        authentication: Authentication?
    ) {
        // Clean up local session
        request.session?.invalidate()

        // Redirect to logout complete page
        response.sendRedirect("/?logout=true")
    }
}
```

---

## 7. Troubleshooting and Debugging

### 7.1 Debugging SAML Responses

How to inspect SAML Responses in browser developer tools:

```
1. Browser Developer Tools (F12) → Network tab
2. Check "Preserve log"
3. Perform SAML login
4. Find the POST request to the ACS URL
5. Copy the SAMLResponse value from Form Data
6. Base64 decode to view the XML
```

**SAML Decoding Utility:**

```kotlin
import java.util.Base64
import java.io.ByteArrayInputStream
import java.util.zip.Inflater
import java.util.zip.InflaterInputStream

object SamlDebugUtil {

    /**
     * Decodes a Base64-encoded SAML Response.
     * Use only in development environments.
     */
    fun decodeSamlResponse(encoded: String): String {
        val decoded = Base64.getDecoder().decode(encoded)
        return String(decoded, Charsets.UTF_8)
    }

    /**
     * Decodes the Deflate + Base64 encoding used in HTTP-Redirect Binding.
     */
    fun decodeSamlRequest(encoded: String): String {
        val decoded = Base64.getDecoder().decode(encoded)
        val inflater = Inflater(true)
        val inputStream = InflaterInputStream(ByteArrayInputStream(decoded), inflater)
        return inputStream.bufferedReader().readText()
    }
}
```

### 7.2 Common Errors and Solutions

#### AADSTS50105: User not assigned to application

```
Cause: User is not assigned to the Entra ID Enterprise Application
Fix: Enterprise Application → Users and groups → Add user/group
```

#### AADSTS700016: Application not found in the directory

```
Cause: Entity ID doesn't match what's registered in Entra ID
Fix: Ensure entity-id in application.yml matches the Identifier (Entity ID) in Entra ID
```

#### Signature validation failed

```
Cause: IdP certificate is expired or incorrect certificate is being used
Fix:
  1. Download the latest certificate from Entra ID
  2. Replace the certificate file in classpath
  3. When using metadata URL, restart the application
```

#### Invalid destination

```
Cause: SAMLResponse Destination doesn't match SP's ACS URL
Fix:
  1. Verify Reply URL in Entra ID
  2. Check acs.location in application.yml
  3. When behind a proxy/load balancer, configure X-Forwarded headers:

server:
  forward-headers-strategy: framework
```

#### Clock skew error

```
Cause: Time difference between IdP and SP servers exceeds the allowed range (default 60 seconds)
Fix:
  1. Verify server NTP synchronization
  2. Adjust allowed range (not recommended):
```

```kotlin
@Bean
fun authenticationProvider(): OpenSaml4AuthenticationProvider {
    return OpenSaml4AuthenticationProvider().apply {
        setAssertionValidator { assertionToken ->
            val assertion = assertionToken.assertion
            val conditions = assertion.conditions

            // Adjust clock skew tolerance to 5 minutes
            val notBefore = conditions?.notBefore?.minus(java.time.Duration.ofMinutes(5))
            val notOnOrAfter = conditions?.notOnOrAfter?.plus(java.time.Duration.ofMinutes(5))

            // Validation logic
            Saml2ResponseValidatorResult.success()
        }
    }
}
```

### 7.3 Useful Logging Configuration

```yaml
logging:
  level:
    # Detailed SAML logs
    org.springframework.security.saml2: TRACE
    org.opensaml: DEBUG

    # HTTP request/response inspection
    org.springframework.web.filter.CommonsRequestLoggingFilter: DEBUG

    # Authentication events
    org.springframework.security.authentication: DEBUG
```

---

## 8. Security Checklist

### 8.1 Required Security Settings

```
✅ Use HTTPS (SAML Response must always be transmitted over TLS)
✅ Enable XML Signature verification
✅ Validate Assertion expiration (NotBefore/NotOnOrAfter)
✅ Validate Audience Restriction (Entity ID match)
✅ Validate InResponseTo (Replay Attack prevention)
✅ Monitor certificate expiration and automate renewal
✅ Disable IdP-Initiated SSO or add CSRF protection
✅ Prevent SAML internal information leakage in error messages
```

### 8.2 Certificate Management

```kotlin
import java.security.cert.X509Certificate
import java.security.cert.CertificateFactory
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * Health check that verifies IdP certificate expiration.
 * Triggers warnings 30 days before expiration.
 */
@Component
class SamlCertificateHealthIndicator(
    private val relyingPartyRegistrationRepository: RelyingPartyRegistrationRepository
) : HealthIndicator {

    override fun health(): Health {
        val registration = relyingPartyRegistrationRepository
            .findByRegistrationId("azure") ?: return Health.unknown().build()

        val credentials = registration.assertingPartyDetails
            .verificationX509Credentials

        for (credential in credentials) {
            val cert = credential.certificate
            val expiresAt = cert.notAfter.toInstant()
            val daysUntilExpiry = ChronoUnit.DAYS.between(Instant.now(), expiresAt)

            if (daysUntilExpiry < 0) {
                return Health.down()
                    .withDetail("certificate", "EXPIRED")
                    .withDetail("expiredAt", expiresAt.toString())
                    .build()
            }

            if (daysUntilExpiry < 30) {
                return Health.status("WARNING")
                    .withDetail("certificate", "EXPIRING_SOON")
                    .withDetail("daysUntilExpiry", daysUntilExpiry)
                    .withDetail("expiresAt", expiresAt.toString())
                    .build()
            }
        }

        return Health.up().build()
    }
}
```

### 8.3 Production Deployment Considerations

```yaml
# Production application-prod.yml
spring:
  security:
    saml2:
      relyingparty:
        registration:
          azure:
            # Use metadata URL (recommended for automatic certificate renewal)
            assertingparty:
              metadata-uri: https://login.microsoftonline.com/{tenant-id}/federationmetadata/2007-06/federationmetadata.xml?appid={app-id}

server:
  # Required when behind a load balancer/proxy
  forward-headers-strategy: framework
  servlet:
    session:
      cookie:
        secure: true
        http-only: true
        same-site: lax

# Disable SAML debug logs in production
logging:
  level:
    org.springframework.security.saml2: WARN
    org.opensaml: WARN
```

---

## 9. FAQ

### Q1. Should I choose SAML or OIDC?

For new projects, consider **OIDC** first. However, SAML is the right choice when:
- The client's IdP only supports SAML
- Government/finance regulatory requirements
- Integration with existing SAML infrastructure

### Q2. Is an SP certificate (signing key) mandatory?

It's needed to sign the AuthnRequest in SP-Initiated SSO. Microsoft Entra ID treats signed AuthnRequests as **optional**, so initial integration works without it. However, configuring it is recommended in production for enhanced security.

### Q3. How do I handle multi-tenant (multiple IdP) integration?

```yaml
spring:
  security:
    saml2:
      relyingparty:
        registration:
          # Tenant A
          tenant-a:
            entity-id: https://myapp.example.com/saml/metadata/tenant-a
            assertingparty:
              metadata-uri: https://login.microsoftonline.com/{tenant-a-id}/federationmetadata/...
          # Tenant B
          tenant-b:
            entity-id: https://myapp.example.com/saml/metadata/tenant-b
            assertingparty:
              metadata-uri: https://login.microsoftonline.com/{tenant-b-id}/federationmetadata/...
```

Implement a custom login page so users can select their tenant:

```kotlin
@Controller
class LoginController(
    private val registrationRepository: RelyingPartyRegistrationRepository
) {

    @GetMapping("/")
    fun loginPage(model: Model): String {
        // Pass list of all registered IdPs to the login page
        val idpList = listOf("tenant-a", "tenant-b").map { id ->
            val reg = registrationRepository.findByRegistrationId(id)
            IdpInfo(id, reg?.entityId ?: id)
        }
        model.addAttribute("idpList", idpList)
        return "login"
    }

    data class IdpInfo(val registrationId: String, val name: String)
}
```

### Q4. What happens when the SAML certificate expires?

When the IdP certificate expires, **all SAML authentication fails**. Response plan:
1. When using metadata URL: Restart application for automatic renewal
2. When using manual certificate: Download new certificate → Replace → Deploy
3. **Prevention**: Set up alerts 30 days before expiration (use the HealthIndicator above)

### Q5. How do I test SAML in a local development environment?

```
1. Set up a local IdP with a Keycloak Docker container
2. Use a test IdP like MockIdP (samltest.id)
3. Use Spring Security Test's SAML support:
```

```kotlin
@SpringBootTest
@AutoConfigureMockMvc
class SamlAuthTest {

    @Autowired
    lateinit var mockMvc: MockMvc

    @Test
    fun `access dashboard after SAML authentication succeeds`() {
        mockMvc.perform(
            get("/dashboard")
                .with(saml2Login()
                    .nameId("user@company.com")
                    .authorities(SimpleGrantedAuthority("ROLE_USER"))
                )
        )
            .andExpect(status().isOk)
            .andExpect(view().name("dashboard"))
    }

    @Test
    fun `unauthenticated user is redirected to SAML login`() {
        mockMvc.perform(get("/dashboard"))
            .andExpect(status().is3xxRedirection)
    }
}
```

---

## Conclusion

SAML 2.0 may look complex, but Spring Security's `spring-security-saml2-service-provider` module handles most of the heavy lifting. The key takeaways are:

1. **Use metadata URLs** — More reliable than manual configuration and simplifies certificate renewal
2. **Custom Authentication Converter** — Map Entra ID claims to application roles
3. **Certificate expiration monitoring** — The most common cause of production outages
4. **Test code** — Verify authentication flows using `saml2Login()` MockMvc support

Integration with Microsoft Entra ID is relatively straightforward on the Spring Boot side once the Enterprise Application is configured correctly. Start with the metadata URL approach and customize as requirements evolve.
