---
title: "토큰 발급 방식으로 선착순 시스템 구현하기: 입장권부터 봇 방지까지"
description: "입장 토큰을 먼저 발급하고 토큰 보유자만 구매할 수 있는 선착순 시스템을 구현한다. JWT 기반 토큰 설계, TTL 만료 전략, Rate Limiting + CAPTCHA를 조합한 봇 방지까지 다룬다."
pubDate: 2026-03-24T20:00:00+09:00
tags:
  - System Design
  - First-Come-First-Served
  - Token
  - JWT
  - Spring Boot
heroImage: "../../assets/FcfsTokenImplementation.png"
---

## 서론

[이전 글](/blog/fcfs-queue-implementation)에서 대기열로 트래픽을 순서대로 흡수하는 방법을 다뤘다. 대기열은 사용자 경험을 크게 개선하지만, **모든 사용자가 결국 구매 페이지에 도달한다**는 전제가 있다.

토큰 방식은 다르다. **입장 토큰을 먼저 발급하고, 토큰을 가진 사람만 구매할 수 있다.** 콘서트 티켓팅, 한정판 스니커즈, 한정 수량 이벤트에서 많이 쓰는 방식이다.

대기열과의 핵심 차이: 대기열은 "기다리면 결국 들어간다"이고, 토큰은 **"토큰을 받아야만 들어갈 수 있다"**이다. 트래픽을 두 단계로 분리해서 구매 서버의 부하를 극적으로 줄인다.

---

## 1. 토큰 방식의 구조

```
[Phase 1: 토큰 발급]
10,000명 → [토큰 발급 서버] → 200명에게 토큰 발급
                             → 9,800명은 "발급 종료" 응답

[Phase 2: 구매]
200명 (토큰 보유) → [구매 서버] → 토큰 검증 → 재고 차감 → 주문 완료
```

**두 서버를 분리하는 것이 핵심이다:**
- **토큰 발급 서버**: 전체 트래픽을 받는다 (가벼운 연산)
- **구매 서버**: 토큰 보유자만 접근한다 (무거운 연산)

10,000명의 트래픽이 200명으로 줄어든다. 구매 서버는 여유롭게 처리할 수 있다.

---

## 2. 토큰 설계: JWT vs Opaque

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

서명으로 위변조를 방지하고, 토큰 자체에 정보가 담겨 있어서 **별도 저장소 조회 없이 검증**할 수 있다.

### 2.2 Opaque Token

```
token: "a3f8b2c1-9d4e-4f5a-b6c7-8e9f0a1b2c3d"
```

랜덤 문자열이고, 검증할 때 Redis에서 조회해야 한다. 토큰 자체에는 정보가 없다.

### 2.3 비교

| 항목 | JWT | Opaque Token |
|------|-----|-------------|
| 검증 방식 | 서명 검증 (서버 자체) | Redis 조회 |
| 네트워크 호출 | 불필요 | 필요 |
| 즉시 무효화 | 어려움 (만료까지 유효) | 쉬움 (Redis에서 삭제) |
| 토큰 크기 | 큼 (~300 bytes) | 작음 (~36 bytes) |
| 탈취 시 위험 | 만료까지 사용 가능 | 즉시 무효화 가능 |

**선착순 시스템에서는 JWT + Redis 블랙리스트 조합이 실용적이다.** JWT로 빠르게 검증하되, 사용 완료된 토큰은 Redis에 기록해서 재사용을 방지한다.

---

## 3. 토큰 발급 서비스

### 3.1 토큰 생성

```java
@Service
@RequiredArgsConstructor
public class PurchaseTokenService {
    private final RedissonClient redissonClient;

    @Value("${jwt.secret}")
    private String jwtSecret;

    private static final long TOKEN_TTL_MINUTES = 5;

    /**
     * 토큰 발급
     */
    public TokenIssueResult issueToken(Long productId, Long userId) {
        String quotaKey = "token-quota:" + productId;
        String issuedKey = "token-issued:" + productId;

        // 1. 이미 발급받았는지 확인
        RSet<String> issued = redissonClient.getSet(issuedKey);
        if (issued.contains(userId.toString())) {
            return TokenIssueResult.alreadyIssued();
        }

        // 2. 남은 토큰 수량 확인 + 차감 (Lua 스크립트로 원자적 처리)
        Long remaining = executeQuotaScript(quotaKey, issuedKey, userId.toString());

        if (remaining == null || remaining < 0) {
            return TokenIssueResult.exhausted();
        }

        // 3. JWT 생성
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
     * 토큰 수량 확인 + 차감 + 발급 기록을 원자적으로 처리
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

5편의 Redis Lua 스크립트와 거의 동일한 구조다. 차이점은 **재고가 아니라 "토큰 수량"을 차감**한다는 것이다. 재고 200개라면 토큰도 200개 — 또는 여유분을 두고 250개를 발급할 수도 있다.

### 3.2 응답 모델

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

### 3.3 토큰 수량 초기화

```java
public void initTokenQuota(Long productId, int quota) {
    RAtomicLong quotaCounter = redissonClient
        .getAtomicLong("token-quota:" + productId);
    quotaCounter.set(quota);
    quotaCounter.expire(Duration.ofHours(24));
}
```

> 토큰 수량 = 재고 수량 + α. 여유분(α)은 **토큰을 받고 구매하지 않는 비율**을 감안해서 설정한다. 보통 재고의 10~30%를 추가한다.

---

## 4. 토큰 검증과 구매

### 4.1 토큰 검증 서비스

```java
@Service
@RequiredArgsConstructor
public class TokenVerificationService {
    private final RedissonClient redissonClient;

    @Value("${jwt.secret}")
    private String jwtSecret;

    /**
     * 토큰 검증 + 1회 사용 보장
     */
    public TokenVerifyResult verify(String token) {
        // 1. JWT 서명 검증 + 만료 확인
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

        // 2. 이미 사용된 토큰인지 확인 (Redis 블랙리스트)
        String tokenId = claims.getId();
        String usedKey = "token-used:" + tokenId;
        RBucket<String> used = redissonClient.getBucket(usedKey);

        // setIfAbsent: 없으면 set하고 true, 있으면 false → 원자적 1회 사용 보장
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

**3단계 검증:**
1. JWT 서명 + 만료 검증 — 위변조, 만료된 토큰 차단
2. Redis 블랙리스트 — 이미 사용된 토큰 차단
3. `setIfAbsent` — 동시에 같은 토큰으로 요청해도 1명만 통과 (원자적)

### 4.2 구매 서비스

```java
@Service
@RequiredArgsConstructor
public class TokenBasedOrderService {
    private final TokenVerificationService tokenService;
    private final RedisLuaStockService stockService;
    private final OrderRepository orderRepository;

    @Transactional
    public OrderResult purchase(String token) {
        // 1. 토큰 검증
        TokenVerifyResult verify = tokenService.verify(token);
        if (!verify.isValid()) {
            return OrderResult.fromTokenError(verify.status());
        }

        // 2. Redis 재고 차감
        PurchaseResult stockResult = stockService.tryPurchase(
            verify.productId(), verify.userId()
        );
        if (stockResult != PurchaseResult.SUCCESS) {
            return OrderResult.soldOut();
        }

        // 3. DB 주문 저장
        Order order = Order.create(verify.productId(), verify.userId(), 1);
        orderRepository.save(order);

        return OrderResult.success(order.getId());
    }
}
```

---

## 5. 봇 방지

선착순 시스템의 가장 큰 적은 **봇**이다. 자동화 스크립트가 밀리초 단위로 토큰 발급 API를 호출하면, 실제 사용자는 기회조차 얻지 못한다.

### 5.1 Rate Limiting

IP/사용자 단위로 요청 횟수를 제한한다.

```java
@Component
@RequiredArgsConstructor
public class RateLimiter {
    private final RedissonClient redissonClient;

    /**
     * 슬라이딩 윈도우 방식: 10초 내 3회까지 허용
     */
    public boolean isAllowed(String key, int maxRequests, Duration window) {
        String rateLimitKey = "rate:" + key;
        RScoredSortedSet<String> requests = redissonClient
            .getScoredSortedSet(rateLimitKey);

        long now = System.currentTimeMillis();
        long windowStart = now - window.toMillis();

        // 윈도우 밖의 요청 제거
        requests.removeRangeByScore(0, true, windowStart, true);

        // 현재 윈도우 내 요청 수 확인
        if (requests.size() >= maxRequests) {
            return false;
        }

        // 현재 요청 기록
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

        // IP + 사용자 ID 기반 Rate Limiting
        String rateLimitKey = request.getRemoteAddr() + ":" + user.getUsername();
        if (!rateLimiter.isAllowed(rateLimitKey, 3, Duration.ofSeconds(10))) {
            return ResponseEntity.status(429)
                .body("요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");
        }

        TokenIssueResult result = tokenService.issueToken(
            productId, Long.parseLong(user.getUsername())
        );
        return ResponseEntity.ok(result);
    }
}
```

### 5.2 CAPTCHA 조합

토큰 발급 전에 CAPTCHA를 요구하면 봇을 효과적으로 차단할 수 있다.

```
[사용자] → [CAPTCHA 통과] → [토큰 발급 요청] → [토큰 발급]
[봇]    → [CAPTCHA 실패] → 차단
```

```java
@PostMapping("/api/tokens/issue")
public ResponseEntity<?> issueToken(
        @RequestParam Long productId,
        @RequestParam String captchaToken,
        @AuthenticationPrincipal UserDetails user) {

    // 1. CAPTCHA 검증
    if (!captchaService.verify(captchaToken)) {
        return ResponseEntity.badRequest().body("CAPTCHA 검증 실패");
    }

    // 2. Rate Limiting
    // ...

    // 3. 토큰 발급
    // ...
}
```

### 5.3 다층 방어

| 계층 | 방어 수단 | 차단 대상 |
|------|----------|----------|
| 1 | CAPTCHA | 자동화 스크립트 |
| 2 | Rate Limiting | 고속 반복 요청 |
| 3 | 중복 발급 방지 (Lua) | 1인 다중 토큰 |
| 4 | JWT 서명 | 토큰 위조 |
| 5 | 1회 사용 (Redis) | 토큰 재사용 |

---

## 6. 토큰 만료와 재발급

### 6.1 만료 정책

```
토큰 발급 → 5분 TTL → 미사용 시 자동 만료
                    → 만료된 토큰 수량 → 다음 사용자에게 재발급 가능
```

```java
/**
 * 만료된 토큰 수량만큼 재발급 풀에 복귀
 */
@Scheduled(fixedRate = 30000) // 30초마다
public void reclaimExpiredTokens() {
    for (Long productId : getActiveProductIds()) {
        int expired = countExpiredTokens(productId);
        if (expired > 0) {
            RAtomicLong quota = redissonClient
                .getAtomicLong("token-quota:" + productId);
            quota.addAndGet(expired);
            log.info("상품 {}: 만료 토큰 {}개 회수 → 재발급 가능", productId, expired);
        }
    }
}
```

### 6.2 토큰 수량 전략

| 전략 | 토큰 수량 | 특징 |
|------|----------|------|
| 보수적 | 재고 = 토큰 | 정확하지만 미사용 토큰 낭비 |
| 여유분 | 재고 × 1.2 | 미사용 감안, 가장 보편적 |
| 공격적 | 재고 × 1.5 | 토큰 소진 빠름, 재발급 의존 |

> 실무에서는 **재고 × 1.2 + 만료 회수 스케줄러** 조합이 가장 안정적이다.

---

## 7. 대기열 vs 토큰: 언제 무엇을 쓸까?

| 항목 | 대기열 (6편) | 토큰 (이번 글) |
|------|------------|--------------|
| 사용자 경험 | "대기 중 (342번째)" | "토큰 발급 성공/실패" |
| 진입 방식 | 순서대로 진입 | 토큰 보유자만 진입 |
| 공정성 | 순서 보장 (선착순) | 먼저 발급받은 사람 (선착순) |
| 서버 분리 | 대기열 + 구매 | 토큰 발급 + 구매 |
| 봇 방지 | 대기열 진입 자체가 방어 | CAPTCHA + Rate Limiting 필요 |
| 적합한 상황 | 콘서트 예매 (순서 중요) | 한정판 판매 (속도 중요) |
| 구현 복잡도 | 높음 (폴링/웹소켓) | 중간 (JWT + Redis) |

**실무에서는 둘을 조합하기도 한다:**
1. 대기열로 사용자를 순서대로 세운다
2. 순서가 되면 토큰을 발급한다
3. 토큰으로 구매한다

이 조합이 **네이버 예매, 인터파크 티켓**에서 사용하는 방식이다.

---

## 8. 전체 흐름

```
[1] 사용자 → CAPTCHA 통과
    → POST /api/tokens/issue?productId=1
    → Rate Limiting 통과
    → Lua: 토큰 수량 확인 + 차감 + 발급 기록
    → JWT 생성 → 응답: { token: "eyJ...", expiresIn: 300 }

[2] 사용자 → POST /api/orders (Authorization: Bearer eyJ...)
    → JWT 서명 검증 + 만료 확인
    → Redis: 이미 사용된 토큰? (setIfAbsent로 원자적 확인)
    → Redis Lua: 재고 차감
    → DB: 주문 저장
    → 응답: { orderId: 12345, status: "SUCCESS" }

[3] 스케줄러 → 30초마다 만료 토큰 회수 → 재발급 풀 복귀
```

---

## 정리

| 핵심 포인트 | 내용 |
|------------|------|
| **토큰의 본질** | 트래픽을 두 단계로 분리 — 발급(가벼움)과 구매(무거움) |
| **JWT + Redis** | JWT로 빠른 검증, Redis 블랙리스트로 1회 사용 보장 |
| **Lua 스크립트** | 수량 확인 + 차감 + 중복 방지를 원자적 처리 |
| **봇 방지** | CAPTCHA + Rate Limiting + 중복 방지의 다층 방어 |
| **만료 전략** | 5분 TTL + 스케줄러로 미사용 토큰 회수 |
| **대기열과의 조합** | 대기열 → 토큰 발급 → 구매의 3단계가 실무 표준 |

토큰 방식은 **"누가 구매할 수 있는가"를 사전에 결정**한다. 구매 서버 입장에서는 소수의 검증된 사용자만 오기 때문에 안정적으로 운영할 수 있다.

다음 글에서는 **k6 부하 테스트로 전체 방식의 성능을 직접 비교**한다. DB 락, Redis, 대기열, 토큰 — 동일 조건에서 누가 가장 빠르고, 어떤 상황에 어떤 방식이 적합한지 숫자로 확인한다.
