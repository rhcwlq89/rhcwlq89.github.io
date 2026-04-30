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

### 5. `<details>` discipline

Fold:
- Advanced edge cases, long derivations, reinforcing examples a first-time reader can skip
- "더 자세히 / More detail" branches of an aside

Do **not** fold:
- TL;DR, tables, diagrams that are part of the main argument, the main thesis, anything a first-time reader must see

Summary text should preview content and invite the click:
- ✅ `<summary><strong>More detail — AZ failure behavior, why not one ALB per AZ</strong></summary>`
- ❌ `<summary>More info</summary>`

### 6. Diagrams — always Mermaid

If the original post has ASCII art topology/flow in ` ```text ` blocks, **convert to Mermaid**. Common patterns:

- Architecture: `flowchart TB` with `subgraph` for grouping
- Request flow: `sequenceDiagram`
- State machine: `stateDiagram-v2`
- Decision tree: `flowchart TD` with diamond `{...}` for decisions

`\`\`\`text` is fine for CLI output, file trees, log snippets, config — anything that is real monospaced text rather than hand-drawn art.

### 7. Pre-publish self-check (run on both KO and EN before reporting done)

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

### 8. Hero image (when requested)

A new hero image deserves a new asset and a new prompt. Per CLAUDE.md's hero image style guide:

- Save asset as `src/assets/<PascalCaseSlug>.png` (mirror existing names like `SpringBootPreInterviewGuide1.png`)
- Update `heroImage` paths in **both** KO (`../../assets/...`) and EN (`../../../assets/...`)
- Prompt requirements: ≥5 lines, dark navy isometric, blue/cyan glow, no text, ends with `Isometric 2.5D style, dark navy background, blue/cyan glow effects, no text. Aspect ratio 3:2 (1536x1024).`
- If the user pushes back that the image looks "휑하다 / sparse / empty", **densify**: add more floating UI panels (result cards, query snippets, console lines), more accent objects (gears, shields, code brackets), richer connection web, secondary glow accents — but keep the dominant element clearly dominant. Don't crowd the center.

### 9. Delegation

For posts > 800 lines, delegate the actual rewrite to an `executor` subagent with:
- Both target file paths
- Both reference file paths
- The agreed structure plan
- Explicit "do not change pubDate" and "do not commit" instructions
- The pre-publish self-check command

Then verify the executor's output yourself before reporting back to the user.

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
