---
title: "Implementing FCFS with Tokens: From Entry Tickets to Bot Prevention"
description: "Implements a first-come-first-served system that issues entry tokens upfront — only token holders can purchase. Covers JWT-based token design, TTL expiration strategy, and multi-layered bot prevention with Rate Limiting + CAPTCHA."
pubDate: "2026-03-24T20:00:00+09:00"
tags: ["System Design", "First-Come-First-Served", "Token", "JWT", "Spring Boot"]
heroImage: "../../../assets/FcfsTokenImplementation.png"
lang: en
---

## Introduction

In the [previous post](/blog/en/fcfs-queue-implementation), we used queues to absorb traffic in order. Queues greatly improve UX, but they assume **every user eventually reaches the purchase page**.

Tokens work differently. **Issue entry tokens first — only token holders can purchase.** This is the pattern behind concert ticketing, limited-edition sneaker drops, and flash sale events.

The key difference from queues: queues mean "wait and you'll get in," while tokens mean **"no token, no entry."** Splitting traffic into two phases dramatically reduces purchase server load.

---

## 1. Token Architecture

```
[Phase 1: Token Issuance]
10,000 users → [Token Server] → 200 get tokens
                              → 9,800 get "tokens exhausted" response

[Phase 2: Purchase]
200 users (with tokens) → [Purchase Server] → verify token → deduct stock → order
```

**Separating the two servers is the key:**
- **Token server**: handles all traffic (lightweight operations)
- **Purchase server**: only token holders access it (heavy operations)

10,000 requests become 200. The purchase server handles them comfortably.

---

## 2. Token Design: JWT vs Opaque

### 2.1 JWT (JSON Web Token)

```json
{
  "sub": "user-12345",
  "productId": 1,
  "type": "PURCHASE_TOKEN",
  "iat": 1711267200,
  "exp": 1711267500
}
```

Signature prevents tampering, and the token itself carries all needed information — **verification without any store lookup**.

### 2.2 Opaque Token

```
token: "a3f8b2c1-9d4e-4f5a-b6c7-8e9f0a1b2c3d"
```

A random string. Verification requires a Redis lookup. The token carries no information.

### 2.3 Comparison

| Aspect | JWT | Opaque Token |
|--------|-----|-------------|
| Verification | Signature check (server-side) | Redis lookup |
| Network call | Not needed | Required |
| Instant revocation | Difficult (valid until expiry) | Easy (delete from Redis) |
| Token size | Large (~300 bytes) | Small (~36 bytes) |
| Risk if stolen | Usable until expiry | Can be instantly revoked |

**For FCFS systems, JWT + Redis blacklist is practical.** JWT for fast verification, Redis to record used tokens and prevent reuse.

---

## 3. Token Issuance Service

### 3.1 Token Generation

```java
@Service
@RequiredArgsConstructor
public class PurchaseTokenService {
    private final RedissonClient redissonClient;

    @Value("${jwt.secret}")
    private String jwtSecret;

    private static final long TOKEN_TTL_MINUTES = 5;

    /**
     * Issue a purchase token
     */
    public TokenIssueResult issueToken(Long productId, Long userId) {
        String quotaKey = "token-quota:" + productId;
        String issuedKey = "token-issued:" + productId;

        // 1. Check if already issued
        RSet<String> issued = redissonClient.getSet(issuedKey);
        if (issued.contains(userId.toString())) {
            return TokenIssueResult.alreadyIssued();
        }

        // 2. Check + deduct token quota atomically (Lua script)
        Long remaining = executeQuotaScript(quotaKey, issuedKey, userId.toString());

        if (remaining == null || remaining < 0) {
            return TokenIssueResult.exhausted();
        }

        // 3. Generate JWT
        String token = generateJwt(productId, userId);
        return TokenIssueResult.success(token, TOKEN_TTL_MINUTES);
    }

    private String generateJwt(Long productId, Long userId) {
        return Jwts.builder()
            .setSubject(userId.toString())
            .claim("productId", productId)
            .claim("type", "PURCHASE_TOKEN")
            .setIssuedAt(new Date())
            .setExpiration(new Date(System.currentTimeMillis()
                + TOKEN_TTL_MINUTES * 60 * 1000))
            .signWith(Keys.hmacShaKeyFor(jwtSecret.getBytes()),
                SignatureAlgorithm.HS256)
            .compact();
    }

    /**
     * Atomic: check quota + deduct + record issuance
     */
    private Long executeQuotaScript(String quotaKey, String issuedKey, String userId) {
        RScript script = redissonClient.getScript();

        String lua =
            "if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then " +
            "    return -2 " +
            "end " +
            "local quota = tonumber(redis.call('GET', KEYS[1])) " +
            "if quota == nil or quota <= 0 then " +
            "    return -1 " +
            "end " +
            "redis.call('DECR', KEYS[1]) " +
            "redis.call('SADD', KEYS[2], ARGV[1]) " +
            "return quota - 1";

        return script.eval(
            RScript.Mode.READ_WRITE, lua,
            RScript.ReturnType.INTEGER,
            List.of(quotaKey, issuedKey),
            userId
        );
    }
}
```

Nearly identical to the Redis Lua script from Part 5. The difference: we're deducting **token quota, not stock**. For 200 items, you might issue 200 tokens — or 250 with a buffer for unused ones.

### 3.2 Response Model

```java
public record TokenIssueResult(
    TokenIssueStatus status,
    String token,
    long expiresInMinutes
) {
    public static TokenIssueResult success(String token, long minutes) {
        return new TokenIssueResult(TokenIssueStatus.SUCCESS, token, minutes);
    }

    public static TokenIssueResult exhausted() {
        return new TokenIssueResult(TokenIssueStatus.EXHAUSTED, null, 0);
    }

    public static TokenIssueResult alreadyIssued() {
        return new TokenIssueResult(TokenIssueStatus.ALREADY_ISSUED, null, 0);
    }
}

public enum TokenIssueStatus {
    SUCCESS,
    EXHAUSTED,
    ALREADY_ISSUED
}
```

### 3.3 Quota Initialization

```java
public void initTokenQuota(Long productId, int quota) {
    RAtomicLong quotaCounter = redissonClient
        .getAtomicLong("token-quota:" + productId);
    quotaCounter.set(quota);
    quotaCounter.expire(Duration.ofHours(24));
}
```

> Token quota = stock + α. The buffer (α) accounts for **tokens issued but never used**. Typically 10-30% of stock.

---

## 4. Token Verification and Purchase

### 4.1 Token Verification Service

```java
@Service
@RequiredArgsConstructor
public class TokenVerificationService {
    private final RedissonClient redissonClient;

    @Value("${jwt.secret}")
    private String jwtSecret;

    /**
     * Verify token + ensure single use
     */
    public TokenVerifyResult verify(String token) {
        // 1. JWT signature + expiration check
        Claims claims;
        try {
            claims = Jwts.parserBuilder()
                .setSigningKey(Keys.hmacShaKeyFor(jwtSecret.getBytes()))
                .build()
                .parseClaimsJws(token)
                .getBody();
        } catch (ExpiredJwtException e) {
            return TokenVerifyResult.expired();
        } catch (JwtException e) {
            return TokenVerifyResult.invalid();
        }

        // 2. Check if token already used (Redis blacklist)
        String tokenId = claims.getId();
        String usedKey = "token-used:" + tokenId;
        RBucket<String> used = redissonClient.getBucket(usedKey);

        // setIfAbsent: set if missing → true, exists → false (atomic single-use)
        boolean firstUse = used.setIfAbsent("1", Duration.ofMinutes(10));
        if (!firstUse) {
            return TokenVerifyResult.alreadyUsed();
        }

        Long productId = claims.get("productId", Long.class);
        Long userId = Long.parseLong(claims.getSubject());

        return TokenVerifyResult.valid(productId, userId);
    }
}
```

**Three-stage verification:**
1. JWT signature + expiration — blocks tampered and expired tokens
2. Redis blacklist — blocks already-used tokens
3. `setIfAbsent` — even simultaneous requests with the same token, only one passes (atomic)

### 4.2 Purchase Service

```java
@Service
@RequiredArgsConstructor
public class TokenBasedOrderService {
    private final TokenVerificationService tokenService;
    private final RedisLuaStockService stockService;
    private final OrderRepository orderRepository;

    @Transactional
    public OrderResult purchase(String token) {
        // 1. Verify token
        TokenVerifyResult verify = tokenService.verify(token);
        if (!verify.isValid()) {
            return OrderResult.fromTokenError(verify.status());
        }

        // 2. Redis stock deduction
        PurchaseResult stockResult = stockService.tryPurchase(
            verify.productId(), verify.userId()
        );
        if (stockResult != PurchaseResult.SUCCESS) {
            return OrderResult.soldOut();
        }

        // 3. Save order to DB
        Order order = Order.create(verify.productId(), verify.userId(), 1);
        orderRepository.save(order);

        return OrderResult.success(order.getId());
    }
}
```

---

## 5. Bot Prevention

The biggest enemy of FCFS systems is **bots**. Automated scripts calling the token API in milliseconds leave real users with no chance.

### 5.1 Rate Limiting

Limit request frequency per IP/user.

```java
@Component
@RequiredArgsConstructor
public class RateLimiter {
    private final RedissonClient redissonClient;

    /**
     * Sliding window: max 3 requests per 10 seconds
     */
    public boolean isAllowed(String key, int maxRequests, Duration window) {
        String rateLimitKey = "rate:" + key;
        RScoredSortedSet<String> requests = redissonClient
            .getScoredSortedSet(rateLimitKey);

        long now = System.currentTimeMillis();
        long windowStart = now - window.toMillis();

        // Remove requests outside the window
        requests.removeRangeByScore(0, true, windowStart, true);

        // Check request count in current window
        if (requests.size() >= maxRequests) {
            return false;
        }

        // Record current request
        requests.add(now, UUID.randomUUID().toString());
        requests.expire(window.plusSeconds(1));

        return true;
    }
}
```

```java
@RestController
@RequiredArgsConstructor
public class TokenController {
    private final PurchaseTokenService tokenService;
    private final RateLimiter rateLimiter;

    @PostMapping("/api/tokens/issue")
    public ResponseEntity<?> issueToken(
            @RequestParam Long productId,
            @AuthenticationPrincipal UserDetails user,
            HttpServletRequest request) {

        // Rate limit by IP + user ID
        String rateLimitKey = request.getRemoteAddr() + ":" + user.getUsername();
        if (!rateLimiter.isAllowed(rateLimitKey, 3, Duration.ofSeconds(10))) {
            return ResponseEntity.status(429)
                .body("Too many requests. Please try again shortly.");
        }

        TokenIssueResult result = tokenService.issueToken(
            productId, Long.parseLong(user.getUsername())
        );
        return ResponseEntity.ok(result);
    }
}
```

### 5.2 CAPTCHA Integration

Requiring CAPTCHA before token issuance effectively blocks bots.

```
[User] → [Pass CAPTCHA] → [Token request] → [Token issued]
[Bot]  → [Fail CAPTCHA] → Blocked
```

```java
@PostMapping("/api/tokens/issue")
public ResponseEntity<?> issueToken(
        @RequestParam Long productId,
        @RequestParam String captchaToken,
        @AuthenticationPrincipal UserDetails user) {

    // 1. Verify CAPTCHA
    if (!captchaService.verify(captchaToken)) {
        return ResponseEntity.badRequest().body("CAPTCHA verification failed");
    }

    // 2. Rate Limiting
    // ...

    // 3. Issue token
    // ...
}
```

### 5.3 Defense in Depth

| Layer | Defense | Blocks |
|-------|---------|--------|
| 1 | CAPTCHA | Automated scripts |
| 2 | Rate Limiting | High-frequency repeated requests |
| 3 | Duplicate prevention (Lua) | Multiple tokens per user |
| 4 | JWT signature | Token forgery |
| 5 | Single-use (Redis) | Token reuse |

---

## 6. Token Expiration and Reissuance

### 6.1 Expiration Policy

```
Token issued → 5-minute TTL → auto-expires if unused
                             → expired quota → available for reissuance
```

```java
/**
 * Reclaim expired token quota
 */
@Scheduled(fixedRate = 30000) // every 30 seconds
public void reclaimExpiredTokens() {
    for (Long productId : getActiveProductIds()) {
        int expired = countExpiredTokens(productId);
        if (expired > 0) {
            RAtomicLong quota = redissonClient
                .getAtomicLong("token-quota:" + productId);
            quota.addAndGet(expired);
            log.info("Product {}: {} expired tokens reclaimed", productId, expired);
        }
    }
}
```

### 6.2 Quota Strategy

| Strategy | Token Quota | Characteristics |
|----------|------------|-----------------|
| Conservative | stock = tokens | Precise but wastes unused tokens |
| Buffered | stock × 1.2 | Accounts for non-use, most common |
| Aggressive | stock × 1.5 | Tokens deplete fast, relies on reclaim |

> In practice, **stock × 1.2 + expiration reclaim scheduler** is the most reliable combination.

---

## 7. Queue vs Token: When to Use Which?

| Aspect | Queue (Part 6) | Token (this post) |
|--------|---------------|------------------|
| User experience | "Waiting (position #342)" | "Token issued/exhausted" |
| Entry method | Sequential entry | Token holders only |
| Fairness | Order guaranteed (FCFS) | First to get token (FCFS) |
| Server separation | Queue + purchase | Token issuance + purchase |
| Bot prevention | Queue entry itself is a barrier | CAPTCHA + Rate Limiting needed |
| Best for | Concert booking (order matters) | Limited drops (speed matters) |
| Complexity | High (polling/WebSocket) | Medium (JWT + Redis) |

**In practice, both are often combined:**
1. Queue lines users up in order
2. When their turn comes, issue a token
3. Use the token to purchase

This is the pattern used by **Naver Ticketing and Interpark Tickets**.

---

## 8. End-to-End Flow

```
[1] User → Pass CAPTCHA
    → POST /api/tokens/issue?productId=1
    → Rate Limiting check
    → Lua: check quota + deduct + record issuance
    → Generate JWT → Response: { token: "eyJ...", expiresIn: 300 }

[2] User → POST /api/orders (Authorization: Bearer eyJ...)
    → JWT signature + expiration check
    → Redis: already used? (atomic check via setIfAbsent)
    → Redis Lua: stock deduction
    → DB: save order
    → Response: { orderId: 12345, status: "SUCCESS" }

[3] Scheduler → every 30s reclaim expired tokens → return to quota pool
```

---

## Summary

| Key Point | Details |
|-----------|---------|
| **Token essence** | Split traffic into two phases — issuance (light) and purchase (heavy) |
| **JWT + Redis** | JWT for fast verification, Redis blacklist for single-use guarantee |
| **Lua script** | Atomic quota check + deduct + duplicate prevention |
| **Bot prevention** | CAPTCHA + Rate Limiting + duplicate prevention (defense in depth) |
| **Expiration strategy** | 5-min TTL + scheduler for unused token reclamation |
| **Queue + token combo** | Queue → token issuance → purchase is the production standard |

The token approach **predetermines who can purchase**. From the purchase server's perspective, only a small number of verified users arrive — making operations stable.

The next post **compares all approaches head-to-head with k6 load testing**. DB locks, Redis, queues, tokens — under identical conditions, we'll see the numbers: which is fastest, and which fits which scenario.
