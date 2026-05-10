---
name: renew-blog
description: Restructure an existing blog post (KO + EN pair) to the canonical skeleton defined in CLAUDE.md, matching the renewed pattern of spring-boot-pre-interview-guide-1. Use when the user asks to "리뉴얼" / "renew" / "rework" a specific post, or when a post predates the canonical skeleton and needs to be brought up to standard. The skill enforces structure (서론 → TL;DR → numbered sections → 정리 → 부록), Mermaid diagrams, frontmatter conventions, and the pre-publish self-check.
---

# Renew Blog Post

## When to use

The user asks to "리뉴얼" / "renew" / "rework" a specific post, OR a post predates the canonical skeleton (no TL;DR, flat sections, ASCII diagrams, table-based series nav). Always apply to KO **and** EN together — they must stay in lockstep.

## Inputs you need

1. The target post slug (e.g., `spring-boot-pre-interview-guide-2`).
2. Whether the user wants a new hero image — if yes, generate the prompt at the end.

## Process

### 1. Read first, plan second

Always read these before writing anything:

- **Target KO**: `src/content/blog/<slug>.md`
- **Target EN**: `src/content/blog/en/<slug>.md`
- **Reference KO**: `src/content/blog/spring-boot-pre-interview-guide-1.md` (the canonical renewed example)
- **Reference EN**: `src/content/blog/en/spring-boot-pre-interview-guide-1.md`
- `CLAUDE.md` at the project root (rules are non-negotiable)

Show the user a structure plan before executing:
- What H2 sections will exist after (numbered 1..N)
- Which Mermaid diagrams will be added (and where)
- Frontmatter changes (title, description, tags form, heroImage)
- Get explicit approval before rewriting.

### 2. Apply the canonical skeleton

Per `CLAUDE.md`, every post must follow this structure:

```
---
frontmatter
---

## 서론 / Introduction
  - 3–5 short paragraphs (hook, context, target reader)
  - Series posts: full nav as a bullet list with current part bolded:
    `<strong>N편 — <Topic> (이 글)</strong>`
  - Part 2+: link to the previous post

---

## TL;DR
  - 4–5 bullets, each leading with `<strong>core idea</strong>` then a one-line elaboration
  - A reader who reads only this should walk away with the gist

---

## 1. <First major H2 — meaningful, em-dash subtitle ok>
  ### 1.1 ...
  ### 1.2 ...
  ### 1.X 참고: ... / ### 1.X Aside: ...   (placed after the H2 where the concept first appears)

---

## 2. <…>
## 3. <…>
…

---

## 정리 / Recap
  - 3–5 takeaway bullets, mirror the TL;DR but as conclusions
  - End with a teaser paragraph for the next post in a series

---

## 부록 / Appendix (optional)
  - Glossary, references, advanced edge cases — content the reader consults after, not while reading
```

### 3. Frontmatter rules

**KO**:
- `pubDate`: must include time (`2026-02-03T15:30:00+09:00`). **Never silently change the existing pubDate** — the user has explicitly flagged accidental pubDate rewrites as a regression.
- `tags`: multi-line YAML list form
- `heroImage`: `"../../assets/<File>.png"`
- No `lang` field

**EN**:
- `pubDate`: quoted, includes time
- `tags`: inline array form
- `heroImage`: `"../../../assets/<File>.png"` (extra `../`)
- `lang: en`

Title pattern for series posts: `"<Series Title> Part N: <Topic> — <subtitle>"`. EN matches with `Part N` not `N편`.

### 4. Style rules (non-negotiable, from CLAUDE.md)

| Rule | Right | Wrong |
|---|---|---|
| Bold | `<strong>락(lock)</strong>이다` | `**락(lock)**이다` (parser bug), `**락(lock)이다**` (emphasis drifts) |
| Callouts | `> <strong>참고</strong>: body` | `> [!NOTE]` (Astro doesn't render GFM alerts) |
| Diagrams | ` ```mermaid ` blocks | ` ```text ` ASCII box art (`┌─┐│└┘`) |
| KO sentences | ≤ ~200 chars; split if over | Wall of text |
| Consecutive prose paragraphs | ≤ 3, then break with table/list/diagram/callout/`<details>` | 5+ in a row |
| 3+ item comparison | Always a table | `<strong>Label</strong>: …` paragraph wall |
| Term introduction | Lead with one-sentence definition (`<strong>X = Y</strong>`) | Definition buried at end |
| Cross-section refs (KO) | `4.3절`, `2편 6.1절` | `§4.3`, `§2.6.1` |
| Cross-section refs (EN) | `§4.3` | `Section 4.3` |
| Diagrams allowed | `flowchart TB/LR/TD`, `sequenceDiagram`, `classDiagram`, `erDiagram`, `stateDiagram`, `gantt` | Anything else |

### 5. Tell a story, don't dump code

This is the most common failure mode of pre-renewed posts and the easiest to recreate by accident: page after page of code blocks with no narrative connecting them. A reader who can copy-paste your snippets but can't tell *why* they exist has not been served. Renewal must convert "코드 나열" into "스토리".

**For every code block, the post must establish — *before* the code:**
- <strong>What</strong> the code is (one-sentence definition).
- <strong>Why</strong> it exists — what concrete pain or requirement makes this code worth writing.
- <strong>Where</strong> it sits in the bigger picture — how it connects to the surrounding architecture or the problem flow.

**For every H2/H3 section that introduces a concept**, the section opens with a framing paragraph (or short bullet block) that defines the concept, names the problem it solves, and sets up the reader's expectations — *before* the first code block, table, or diagram.

**Concrete checks during a pass:**
- If a subsection starts with a code fence (` ``` `), that's almost always a code-dump signal. Insert framing prose first.
- If two or more code blocks appear back-to-back with no prose between, ask whether the second block needs its own framing sentence ("그럼 …는 어떻게 다루나" / "Now, the wiring side …").
- If a new term (e.g., `Aspect`, `Pointcut`, `MDC`, `JoinPoint`) appears in code without ever being defined in prose, add a short glossary or one-line definition at the section's first mention.
- If the section's main claim is implicit ("here's a Filter" — but *why*?), surface it as a one-sentence thesis at the top.
- Section order should follow a story arc: <strong>problem → concept → mechanism → code → tradeoffs</strong>. Code is the third or fourth beat, never the first.

**Smell test for an entire section**: read only the prose, skipping every fenced block. If the prose alone leaves the reader knowing what the section is about and why they'd care, you're good. If the prose collapses into "다음과 같이 구현한다 / The implementation follows" and then a wall of code, framing is missing.

### 6. `<details>` discipline

Fold:
- Advanced edge cases, long derivations, reinforcing examples a first-time reader can skip
- "더 자세히 / More detail" branches of an aside

Do **not** fold:
- TL;DR, tables, diagrams that are part of the main argument, the main thesis, anything a first-time reader must see

Summary text should preview content and invite the click:
- ✅ `<summary><strong>More detail — AZ failure behavior, why not one ALB per AZ</strong></summary>`
- ❌ `<summary>More info</summary>`

### 7. Diagrams — always Mermaid

If the original post has ASCII art topology/flow in ` ```text ` blocks, **convert to Mermaid**. Common patterns:

- Architecture: `flowchart TB` with `subgraph` for grouping
- Request flow: `sequenceDiagram`
- State machine: `stateDiagram-v2`
- Decision tree: `flowchart TD` with diamond `{...}` for decisions

`\`\`\`text` is fine for CLI output, file trees, log snippets, config — anything that is real monospaced text rather than hand-drawn art.

### 8. Pre-publish self-check (run on both KO and EN before reporting done)

```bash
for FILE in src/content/blog/<slug>.md src/content/blog/en/<slug>.md; do
  echo "=== $FILE ==="
  echo "--- 1. Bold parser bug (closing ** + Korean particle) ---"
  rg '\)\*\*[가-힣]' "$FILE" || echo "OK"
  echo "--- 2. GFM alert leakage ---"
  rg '\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]' "$FILE" || echo "OK"
  echo "--- 3. ASCII box art in text blocks ---"
  awk '/^```text/{t=1; next} /^```/{t=0} t && /[┌└│─┐┘]/{print NR": "$0}' "$FILE"
  echo "--- 4. Overlong KO sentences (>200 chars) ---"
  awk 'length > 200 {print NR": "length" chars"}' "$FILE"
  echo "--- 5. TL;DR section present ---"
  rg -q '^## TL;DR' "$FILE" && echo "OK" || echo "MISSING: TL;DR"
  echo "--- 6. Stray § in KO ---"
  case "$FILE" in *en/*) echo "skip (EN)";; *) rg '§[0-9]' "$FILE" || echo "OK";; esac
done
```

For check 4, `description` and `title` lines in frontmatter, and bullet lines that contain inline code (with backticks), are allowed to exceed 200 chars. Only narrative prose paragraphs should be flagged.

Then run:

```bash
npm run build
```

Build must complete without errors.

### 9. Hero image (when requested)

A new hero image deserves a new asset and a new prompt. Per CLAUDE.md's hero image style guide:

- Save asset as `src/assets/<PascalCaseSlug>.png` (mirror existing names like `SpringBootPreInterviewGuide1.png`)
- Update `heroImage` paths in **both** KO (`../../assets/...`) and EN (`../../../assets/...`)
- Prompt requirements: ≥5 lines, dark navy isometric, blue/cyan glow, no text, ends with `Isometric 2.5D style, dark navy background, blue/cyan glow effects, no text. Aspect ratio 3:2 (1536x1024).`
- If the user pushes back that the image looks "휑하다 / sparse / empty", **densify**: add more floating UI panels (result cards, query snippets, console lines), more accent objects (gears, shields, code brackets), richer connection web, secondary glow accents — but keep the dominant element clearly dominant. Don't crowd the center.

### 10. Delegation

For posts > 800 lines, delegate the actual rewrite to an `executor` subagent with:
- Both target file paths
- Both reference file paths
- The agreed structure plan
- Explicit "do not change pubDate" and "do not commit" instructions
- The pre-publish self-check command

Then verify the executor's output yourself before reporting back to the user.

### 11. Stack/Version migrations (when args carry a stack hint)

If the user's `command-args` includes a stack/version hint (e.g. "Spring Boot 4", "Kotlin only", "Spring Security 7", "Spring Security 7 버전 기준", "JJWT → oauth2-resource-server", "Java 21"), the renewal is more than a structural pass — it must also migrate the code to that stack's standard patterns. Treat the hint as a hard requirement, not a suggestion.

**Workflow when a stack hint is present:**

1. **Detect** — read the args carefully. Stack hints commonly look like "Spring Boot N", "Spring Security N", "Kotlin only / Kotlin으로만", "Java N", or library swaps like "X로 교체" / "X → Y".
2. **Verify versions** — confirm the named stack/library exists at that version and identify what changed from the previous major. If you're unsure of a 7-vs-6 difference, name it explicitly to the user before guessing.
3. **Plan-stage disclosure** — in your structure plan to the user, **call out the stack-driven changes separately** from the structural changes. Example: "[구조] H2 8개 그대로 유지 / [Stack] Java 30 블록 → Kotlin, Lombok 제거, record → data class". The user should be able to approve the stack migration distinctly.
4. **Series consistency check** — if the target post is part of a series, scan sibling posts for the existing language/library. If the migration would leave the series asymmetric (e.g. "1편만 Kotlin, 2~5편은 Java"), surface that to the user with three options before proceeding:
   - **A**: this post only (asymmetric series, defer the rest)
   - **B**: this post + a memory note "series migration in progress" (defer siblings explicitly)
   - **C**: migrate all sibling posts in this session (large work)
5. **Executor brief** — when delegating, embed the stack patterns from §11.1–§11.3 directly in the prompt. Don't make the executor reinvent the conversion.

#### 11.1 Java → Kotlin migration patterns (the most common stack swap)

Use these mappings as the source of truth when an args hint is "Kotlin only" or equivalent:

| Java | Kotlin |
|------|--------|
| `@Getter` / `@Setter` | `val` / `var` (auto accessors) |
| `@RequiredArgsConstructor` | primary constructor with `val` |
| `@AllArgsConstructor` | primary constructor (all fields) |
| `@NoArgsConstructor` | the `kotlin-jpa` plugin synthesizes it for entities |
| `@Builder` | named arguments + default values (Builder is rarely needed) |
| `@Data` / `record` | `data class` |
| `@Slf4j` | `private val log = LoggerFactory.getLogger(this::class.java)` |
| `Optional<T>.orElseThrow()` | Elvis `?: throw` |
| `Optional<T>.map(...)` | `?.let { ... }` |
| `@Valid @RequestBody Foo dto` | `@Valid @RequestBody dto: Foo` |
| Bean Validation `@NotBlank String name` | `@field:NotBlank val name: String` (primary-constructor `val` is a property by default — annotations need the `field:` site target to land on the underlying field) |

**Other Kotlin-specific moves:**

- **Pin the Kotlin version to `2.3`** in any `build.gradle.kts` snippet you write. Spring Boot 4 + Kotlin 2.3 is the verified-compatible pair (K2 compiler stable; `kotlin-spring`/`kotlin-jpa` plugins work normally; binary-compatible with the rest of the 2.x line). Use `kotlin("plugin.spring") version "2.3"` and `kotlin("plugin.jpa") version "2.3"`, never the placeholder `"2.x"`. If the user explicitly asks for a different Kotlin minor (2.0/2.1/2.2/2.4+), follow that — but the default is `2.3`.
- In the §1.1 setup callout, frame the post as "Spring Boot 4 + Kotlin 2.3 기준" / "Spring Boot 4 + Kotlin 2.3" (KO/EN). Add a short reassurance that the 2.x series is backward-compatible so the same code runs on 2.0–2.3 — this protects readers stuck on slightly older minors.
- Add the `kotlin-spring` and `kotlin-jpa` Gradle plugins; mention them in a §1.1 (or equivalent) callout. Don't assume the reader has them.
- Drop Lombok entirely from the project — no `compileOnly 'org.projectlombok:lombok'`, no `annotationProcessor`. Note in prose that Kotlin doesn't use Lombok.
- Use scope functions (`apply`, `let`, `run`) where they shorten code without hiding intent. Don't force them.
- For exception handlers and similar branching, `when` expressions read more naturally than chained `if/else` — use them when the mapping is exhaustive.
- In an entity, prefer `var` for mutable JPA fields and `val` for immutable identifiers; surround the no-arg requirement with the plugin instead of a manual `protected constructor()`.

#### 11.2 `<details>` fold integration when the main language changes

If the previous version of the post had Java as the main code and Kotlin in `<details>` blocks (or vice versa), and the migration flips that:

- **Promote** the previously-folded language's blocks to be the main code.
- **Delete** the previously-main language's blocks entirely. Do not keep them as a new fold "for completeness" — the post becomes harder to skim and longer for no reader benefit.
- **One exception**: a single `<details>` block titled "Lombok → Kotlin mapping" (or similar) is fine if it helps Lombok-trained readers ramp up. Keep it short and tabular.

#### 11.3 What `pubDate` does NOT change

A stack migration is **not** an update event for the post's authorship date. The `pubDate` stays at its original value. If the user genuinely wants a new published date, they will say so explicitly. This rule has been broken before — re-read §3.

#### 11.4 Frontmatter changes for stack migrations

- **title**: append the stack to the em-dash subtitle when the migration is significant. Example: `"... — Spring Boot 4 · Kotlin 4계층 설계"` (KO) / `"... — Spring Boot 4 · Kotlin Four-Layer Design"` (EN).
- **description**: surface the stack and what makes it different (e.g. "Lombok 없이 data class·val/var로 자연스럽게 풀이").
- **tags**: add the new language/framework as a tag. Don't remove the old one if the post still references it for comparison purposes.

#### 11.5 Commit message addendum

In addition to the standard "캐노니컬 스켈레톤 적용" phrasing, mention the stack swap explicitly. Example fragments:

```
... + Kotlin-only 전면 교체 — Java N개 → Kotlin, Lombok 제거, record → data class, details fold 통합
... + Spring Security 7 표준화 — JJWT 제거 후 oauth2-resource-server 전면 교체, JwtDecoder/JwtEncoder Bean 한 짝
```

The reader of the git log should be able to tell from the title alone whether this commit was a structural pass, a stack migration, or both.

## What to commit

- The two restructured `.md` files
- The new hero image PNG (if generated)
- **NOT** any planning docs, intermediate scratch files, or this skill itself unless the user asks

Commit message pattern (matches existing style):

```
docs: <시리즈명> N편 리뉴얼 — 캐노니컬 스켈레톤 적용, <섹션 재구성 요약>, <추가된 다이어그램 요약>, 히어로 이미지 교체 (한/영)
```

## What NOT to do

- Don't change `pubDate` unless the user explicitly asks.
- Don't invent new technical content beyond what's in the original post + the canonical reference. Restructure and enhance prose density / diagrams; do not invent.
- Don't rewrite EN as a literal translation of the new KO — it should read natively (idiom, particle-free phrasing, `§` for section refs).
- Don't add backwards-compat shims, scaffolding comments, or planning documents.
- Don't commit unless the user explicitly asks.
