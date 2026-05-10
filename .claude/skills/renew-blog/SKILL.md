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

**KO**: `pubDate` includes time (`2026-02-03T15:30:00+09:00`); `tags` is multi-line YAML; `heroImage` is `"../../assets/<File>.png"`; no `lang`.

**EN**: `pubDate` quoted with time; `tags` inline array; `heroImage` is `"../../../assets/<File>.png"` (extra `../`); `lang: en`.

**Title** for series posts: `"<Series Title> Part N: <Topic> — <subtitle>"` (EN uses `Part N`, not `N편`). When the renewal carries a stack version (Spring Boot 4 / Kotlin 2.3 / Spring Security 7 / etc.), append the stack to the em-dash subtitle so readers can gauge currency at a glance: `"... — Spring Boot 4 · Kotlin 2.3 ..."`. Update the description to surface what's stack-specific (e.g. "Lombok 없이 data class·val/var로 풀이"), and add the new language/framework as a tag without removing the old ones.

**`pubDate` is never updated by a renewal**, including stack migrations. Authorship date stays put unless the user explicitly says otherwise — accidental rewrites have been flagged before.

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

The most common pre-renewal failure mode is page after page of code with no prose connecting them. Renewal must convert "코드 나열" into a story — <strong>problem → concept → mechanism → code → tradeoffs</strong>, in that order. Code is never the first beat of a section.

Before each code block, establish three things in prose: <strong>what</strong> the code is (one-sentence definition), <strong>why</strong> it exists (the concrete pain it solves), and <strong>where</strong> it fits in the bigger architecture. Each H2/H3 introducing a concept also opens with a framing paragraph that defines the concept, names the problem, and sets up the reader's expectations.

**Smell test**: read only the prose, skipping every code fence. If the prose alone tells you what the section is about and why you'd care, framing is enough. If it collapses into "다음과 같이 구현한다 / The implementation follows" and then a wall of code, add framing. Sub-section starts with a code fence, two code blocks back-to-back without prose, a new term appearing in code without a definition — all signals that the connecting tissue is missing.

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

If `command-args` carries a stack/version hint (e.g. "Spring Boot 4", "Kotlin only", "Spring Security 7", "JJWT → oauth2-resource-server"), the renewal must migrate the code to that stack's standard patterns — not just restructure. The hint is a hard requirement.

**Workflow**: detect hints in args; if unsure of a major-version diff, name the uncertainty to the user before guessing; in your plan separate `[구조]` changes from `[Stack]` changes so the user can approve each; for series posts, check sibling posts and if the migration would leave the series asymmetric, ask the user **A** (this post only), **B** (this post + memory note "migration in progress"), or **C** (migrate siblings in this session); when delegating, embed §11.1–§11.2 patterns directly in the prompt.

#### 11.0 Default verified-compatible versions

When the user is silent about versions, use these defaults — they are mutually verified-compatible on this blog's series renewals.

| Stack | Default | Notes |
|-------|---------|-------|
| <strong>Spring Boot</strong> | <strong>4</strong> | Java 21 recommended; Framework 7 base; Jakarta EE 11 |
| <strong>Spring Security</strong> | <strong>7</strong> | Pairs with Spring Boot 4; `spring-boot-starter-oauth2-resource-server` is the standard JWT path (no JJWT direct impl) |
| <strong>Spring Batch</strong> | <strong>6</strong> | Pairs with Spring Boot 4 / Framework 7; `JobBuilder`/`StepBuilder` style |
| <strong>Kotlin</strong> | <strong>2.3</strong> | K2 stable; binary-compatible across 2.x; verified with Spring Boot 4 |

Pin Kotlin plugins to `"2.3"` (`kotlin("plugin.spring") version "2.3"`, `kotlin("plugin.jpa") version "2.3"`) — never the placeholder `"2.x"`. Follow an explicit user hint over the table; the table is for silence.

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

- Add the `kotlin-spring` and `kotlin-jpa` Gradle plugins (pinned per §11.0); mention them in a §1.1 (or equivalent) setup callout, framed as "Spring Boot 4 + Kotlin 2.3 기준" / "Spring Boot 4 + Kotlin 2.3" with a one-line reassurance that the 2.x line is backward-compatible.
- Drop Lombok entirely from the project — no `compileOnly`, no `annotationProcessor`. Note in prose that Kotlin doesn't use Lombok.
- Use scope functions (`apply`, `let`, `run`) where they shorten code without hiding intent. Don't force them.
- For exhaustive branching, prefer `when` expressions over chained `if/else`.
- In entities, prefer `var` for mutable JPA fields and `val` for the identifier; let the `kotlin-jpa` plugin handle the no-arg requirement instead of writing a manual `protected constructor()`.

#### 11.2 `<details>` fold integration when the main language flips

When the migration flips main language vs. fold language, **promote** the previously-folded blocks to be the main code and **delete** the previously-main blocks entirely. Don't keep both "for completeness" — it just makes the post harder to skim. One exception: a single short `<details>` block titled "Lombok → Kotlin mapping" (or similar) is fine if Lombok-trained readers benefit. Keep it tabular and short.

(`pubDate` and frontmatter rules under stack migration: see §3 — they don't change here.)

## What to commit

- The two restructured `.md` files and the new hero image PNG (if generated).
- **Not** planning docs, scratch files, or this skill itself unless the user asks.

Commit title pattern (the reader of `git log` should tell at a glance whether the commit was a structural pass, a stack migration, or both):

```
docs: <시리즈명> N편 리뉴얼 — 캐노니컬 스켈레톤 적용, <변경 요약>, 히어로 이미지 교체 (한/영)
```

Stack-migration commits add the swap to the title — e.g. `"... + Kotlin-only 전면 교체 — Java N개 → Kotlin, Lombok 제거"` or `"... + Spring Security 7 표준화 — JJWT 제거 후 oauth2-resource-server 전면 교체"`.

## What NOT to do

- Don't change `pubDate` unless the user explicitly asks.
- Don't invent new technical content beyond what's in the original post + the canonical reference. Restructure and enhance prose density / diagrams; do not invent.
- Don't rewrite EN as a literal translation of the new KO — it should read natively (idiom, particle-free phrasing, `§` for section refs).
- Don't add backwards-compat shims, scaffolding comments, or planning documents.
- Don't commit unless the user explicitly asks.
