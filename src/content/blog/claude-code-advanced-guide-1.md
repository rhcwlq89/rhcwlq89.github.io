---
title: "Claude Code 200% 활용하기 (1) — 메모리, 스킬, 훅"
description: "Claude Code의 메모리 시스템(CLAUDE.md, 자동 메모리), 번들 스킬 5종과 커스텀 스킬, 훅을 활용한 워크플로우 자동화까지 실전 가이드"
pubDate: 2026-03-14T18:00:00+09:00
tags:
  [
    "Claude Code",
    "AI",
    "Coding Agent",
    "Memory",
    "Skills",
    "Hooks",
    "DevOps",
    "Automation",
  ]
heroImage: "../../assets/ClaudeCodeAdvancedGuide.png"
---

## 서론

Claude Code를 설치하고 기본적인 대화로 코딩하는 건 금방 익힌다. 하지만 대부분의 사용자는 여기서 멈춘다. "코드 짜줘", "버그 고쳐줘" 수준에서 머무는 것이다.

실제로 Claude Code에는 **프로젝트별 기억**, **반복 작업 자동화**, **외부 도구 연동** 같은 강력한 기능이 숨어 있다. 이 기능들을 활용하면 Claude Code가 단순 채팅봇이 아니라 **나만의 코딩 파트너**로 변신한다.

이 시리즈에서는 Claude Code를 200% 활용하는 방법을 다룬다:

- **Part 1 (이 글)**: 메모리 + 스킬 + 훅 — Claude가 나를 기억하게 하고, 반복 작업을 자동화
- **Part 2**: 플러그인 + MCP + IDE 연동 — 외부 도구와 연결하고 IDE에서 바로 사용
- **Part 3**: 서브에이전트 + 에이전트 팀 — 복잡한 작업을 분할하고 병렬 처리

---

## 1. 메모리 — Claude가 나를 기억하게 만들기

Claude Code는 매 세션마다 새로운 컨텍스트 윈도우로 시작한다. 어제 대화한 내용을 오늘 기억하지 못한다. **메모리**는 이 문제를 해결한다.

### 1.1 CLAUDE.md — 직접 작성하는 프로젝트 지침서

`CLAUDE.md`는 Claude가 세션 시작 시 자동으로 읽는 마크다운 파일이다. 코딩 규칙, 빌드 명령, 아키텍처 설명 등을 적어두면 매번 반복 설명할 필요가 없다.

#### 어디에 놓느냐에 따라 범위가 달라진다

| 위치 | 범위 | 공유 |
|---|---|---|
| `./CLAUDE.md` | 프로젝트 전체 | 팀원과 공유 (Git 커밋) |
| `~/.claude/CLAUDE.md` | 모든 프로젝트 | 나만 사용 |
| `.claude/rules/*.md` | 특정 파일 타입 | 팀원과 공유 |

#### 빠른 시작: `/init`

처음이라면 Claude Code에서 `/init`을 실행하자. 코드베이스를 분석해서 자동으로 `CLAUDE.md`를 생성해준다.

```bash
# Claude Code 안에서
/init
```

#### 좋은 CLAUDE.md 작성법

```markdown
# 프로젝트 규칙

## 빌드 & 테스트
- `pnpm dev`로 개발 서버 실행
- `pnpm test`로 테스트 실행, 커밋 전에 반드시 실행

## 코딩 규칙
- 들여쓰기 2칸
- TypeScript strict 모드 사용
- API 핸들러는 `src/api/handlers/`에 배치

## 아키텍처
- 프론트엔드: React + Vite
- 백엔드: Express + Prisma
- DB: PostgreSQL
```

**핵심 포인트:**

- **200줄 이하**로 유지하자. 길어지면 Claude의 준수율이 떨어진다
- **구체적으로** 쓰자. "코드 잘 짜" 대신 "들여쓰기 2칸"
- **모순되는 규칙**은 피하자. 두 규칙이 충돌하면 Claude가 임의로 선택한다

#### 다른 파일 임포트

`CLAUDE.md`가 커지면 `@path` 문법으로 외부 파일을 참조할 수 있다:

```markdown
# 프로젝트 규칙
@README.md
@docs/api-conventions.md

## 개인 설정
@~/.claude/my-preferences.md
```

### 1.2 `.claude/rules/` — 파일 타입별 규칙

모든 파일에 적용할 필요 없는 규칙은 `.claude/rules/`에 분리하자. `paths` 프론트매터로 특정 파일에만 적용할 수 있다:

```markdown
---
paths:
  - "src/api/**/*.ts"
---

# API 개발 규칙
- 모든 엔드포인트에 입력 검증 포함
- 표준 에러 응답 포맷 사용
- OpenAPI 문서 주석 포함
```

이러면 Claude가 `src/api/` 아래 TypeScript 파일을 작업할 때만 이 규칙이 로드된다. 컨텍스트를 절약할 수 있다.

### 1.3 자동 메모리 — Claude가 스스로 기록

자동 메모리는 사용자가 아무것도 안 해도 Claude가 알아서 기록하는 시스템이다. 빌드 명령, 디버깅 팁, 코드 스타일 선호도 등을 세션 중에 학습하고 저장한다.

#### 저장 위치

```
~/.claude/projects/<프로젝트>/memory/
├── MEMORY.md          # 인덱스 (매 세션 시작 시 로드)
├── debugging.md       # 디버깅 패턴
├── api-conventions.md # API 설계 결정
└── ...
```

#### 활성화/비활성화

```bash
# Claude Code 안에서
/memory  # 자동 메모리 토글 + 메모리 파일 열기

# 또는 settings.json으로
{
  "autoMemoryEnabled": false
}
```

#### 직접 기억시키기

Claude에게 "이거 기억해"라고 말하면 자동 메모리에 저장된다:

```
항상 pnpm을 써, npm 말고. 이거 기억해.
```

`/memory` 명령으로 저장된 내용을 확인하고 편집할 수 있다. 일반 마크다운 파일이라 직접 수정해도 된다.

### 1.4 CLAUDE.md vs 자동 메모리 — 언제 뭘 쓰나

| | CLAUDE.md | 자동 메모리 |
|---|---|---|
| **누가 쓰나** | 내가 직접 | Claude가 자동 |
| **내용** | 규칙, 지침 | 학습한 패턴 |
| **범위** | 프로젝트/사용자/조직 | 프로젝트별 |
| **용도** | 코딩 표준, 워크플로우 | 빌드 명령, 디버깅 팁, 선호도 |

> **정리**: 팀과 공유할 규칙은 `CLAUDE.md`에, Claude가 내 습관을 배우게 하려면 자동 메모리를 활용하자.

---

## 2. 스킬 — Claude에게 새로운 능력 부여

스킬은 Claude에게 **특정 작업을 수행하는 방법**을 가르치는 기능이다. `SKILL.md` 파일 하나로 Claude가 새로운 명령어를 배운다.

### 2.1 번들 스킬 — 바로 쓸 수 있는 5가지

Claude Code에는 기본 탑재된 스킬이 있다. 설치 없이 `/` 뒤에 이름을 입력하면 바로 사용 가능하다.

#### `/batch` — 대규모 코드베이스 병렬 변경

코드베이스 전반에 걸친 대규모 변경을 병렬로 처리한다. 코드베이스를 조사하고, 작업을 5~30개 독립 단위로 분해한 뒤, 승인하면 **각 단위마다 별도의 에이전트**를 생성하여 격리된 git worktree에서 작업한다. 각 에이전트가 구현, 테스트, PR 생성까지 수행한다.

```bash
# 사용 예시
/batch src/ 전체를 Solid에서 React로 마이그레이션
/batch 모든 API 핸들러에 입력 검증 추가
/batch 모든 console.log를 구조화된 로거로 교체
```

> 이 스킬의 핵심은 **병렬 처리**다. 30개 파일을 순차적으로 수정하는 대신, 30개 에이전트가 동시에 작업한다.

#### `/simplify` — 코드 품질 자동 리뷰 & 수정

최근 변경한 파일의 코드 재사용, 품질, 효율성 문제를 검토하고 수정한다. **세 개의 리뷰 에이전트**를 병렬로 생성하여 각각 다른 관점에서 분석한 뒤, 발견 사항을 종합하고 수정을 적용한다.

```bash
/simplify                          # 최근 변경 파일 전체 리뷰
/simplify 메모리 효율성에 집중해서  # 특정 관점으로 리뷰
```

#### `/debug` — 세션 디버그 로그 분석

현재 Claude Code 세션의 디버그 로그를 읽어서 문제를 진단한다. "왜 방금 그렇게 동작했지?" 싶을 때 유용하다.

```bash
/debug                  # 전체 세션 분석
/debug MCP 연결 문제    # 특정 문제에 포커스
```

#### `/loop` — 반복 실행 스케줄러

프롬프트나 슬래시 명령을 정해진 간격으로 반복 실행한다. 배포 상태 모니터링, PR 관리 등에 유용하다.

```bash
/loop 5m 배포 상태 확인해줘
/loop 10m /simplify
```

#### `/claude-api` — Claude API 레퍼런스 로드

Claude API나 Anthropic SDK를 사용하는 코드를 작성할 때, 프로젝트 언어(Python, TypeScript, Java 등)에 맞는 API 레퍼런스를 로드한다. 코드에서 `anthropic`이나 `@anthropic-ai/sdk`를 import하면 자동 활성화되기도 한다.

```bash
/claude-api  # API 레퍼런스 수동 로드
```

### 2.2 커스텀 스킬 만들기

번들 스킬 외에 **나만의 스킬**을 만들 수 있다. `SKILL.md` 파일 하나면 된다.

#### 스킬 저장 위치

| 위치 | 범위 |
|---|---|
| `~/.claude/skills/<이름>/SKILL.md` | 내 모든 프로젝트 |
| `.claude/skills/<이름>/SKILL.md` | 이 프로젝트만 |

#### 예시: 블로그 포스트 생성 스킬

```yaml
---
name: blog-post
description: 블로그 포스트 초안을 생성한다. 한국어와 영어 두 버전을 동시에 만든다.
disable-model-invocation: true
---

블로그 포스트를 작성한다:

1. $ARGUMENTS 주제에 대한 블로그 포스트를 작성
2. 한국어 버전을 `src/content/blog/` 에 생성
3. 영어 버전을 `src/content/blog/en/` 에 생성
4. pubDate에 현재 시간 포함 (예: 2026-03-14T18:00:00+09:00)
5. 한국어는 반말 체(~다, ~이다), 영어는 practical tone
6. heroImage 경로: 한국어 `../../assets/`, 영어 `../../../assets/`
```

사용법:

```bash
/blog-post Terraform 모듈 작성법
```

#### 예시: 코드 설명 스킬

```yaml
---
name: explain-code
description: 코드를 비유와 다이어그램으로 설명한다
---

코드를 설명할 때:

1. **비유부터 시작**: 일상 생활의 무언가와 비교
2. **다이어그램 그리기**: ASCII 아트로 흐름/구조/관계 표현
3. **코드 워크스루**: 단계별로 무슨 일이 일어나는지 설명
4. **함정 하이라이트**: 흔한 실수나 오해 지적
```

이 스킬은 `disable-model-invocation`이 없으므로 Claude가 "이 코드 어떻게 동작해?" 같은 질문에 자동으로 활성화한다.

#### 스킬 호출 제어

| 설정 | 사용자 호출 | Claude 자동 호출 |
|---|---|---|
| (기본값) | O | O |
| `disable-model-invocation: true` | O | X |
| `user-invocable: false` | X | O |

- **`disable-model-invocation: true`**: 배포, 커밋 같은 부작용이 있는 작업에 사용. Claude가 "코드 준비된 것 같으니 배포할게"라고 자동으로 실행하면 곤란하다.
- **`user-invocable: false`**: 레거시 시스템 컨텍스트 같은 배경 지식에 사용. 사용자가 `/legacy-context`를 직접 호출할 일은 없지만, Claude가 관련 작업 시 자동으로 참조하면 유용하다.

#### 동적 컨텍스트 주입

`` !`command` `` 문법으로 스킬 실행 전에 셸 명령의 출력을 주입할 수 있다:

```yaml
---
name: pr-summary
description: PR 요약
context: fork
agent: Explore
---

## PR 컨텍스트
- PR diff: !`gh pr diff`
- PR 코멘트: !`gh pr view --comments`
- 변경 파일: !`gh pr diff --name-only`

## 작업
이 PR을 요약해...
```

`!`gh pr diff``는 스킬이 실행되기 전에 먼저 실행되고, 그 출력이 Claude에게 전달된다.

---

## 3. 훅 — 워크플로우 자동화

훅은 Claude Code의 특정 시점에 **자동으로 실행되는 명령**이다. 스킬이 "Claude에게 방법을 가르치는 것"이라면, 훅은 "특정 이벤트에 코드를 자동 실행하는 것"이다.

### 3.1 훅이 뭔가

- **파일 수정 후** → 자동으로 Prettier 실행
- **위험한 명령 실행 전** → 차단
- **Claude가 입력을 기다릴 때** → 데스크톱 알림
- **세션 시작 시** → 환경 변수 로드

이런 자동화를 훅으로 구현한다.

### 3.2 첫 번째 훅 만들기

Claude가 입력을 기다릴 때 데스크톱 알림을 받아보자.

`~/.claude/settings.json`에 추가:

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "osascript -e 'display notification \"Claude Code needs your attention\" with title \"Claude Code\"'"
          }
        ]
      }
    ]
  }
}
```

> Linux에서는 `notify-send 'Claude Code' 'Claude Code needs your attention'`을 사용하자.

`/hooks`를 입력하면 등록된 훅을 확인할 수 있다.

### 3.3 실전 훅 레시피

#### 파일 수정 후 자동 포맷팅

`.claude/settings.json` (프로젝트 레벨):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path' | xargs npx prettier --write"
          }
        ]
      }
    ]
  }
}
```

`Edit`이나 `Write` 도구가 실행된 후에만 Prettier가 동작한다. `Bash`나 `Read` 등 다른 도구에는 반응하지 않는다.

#### 보호 파일 수정 차단

`.env`, `package-lock.json`, `.git/` 같은 민감한 파일의 수정을 차단하는 훅이다.

`.claude/hooks/protect-files.sh`:

```bash
#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

PROTECTED_PATTERNS=(".env" "package-lock.json" ".git/")

for pattern in "${PROTECTED_PATTERNS[@]}"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    echo "Blocked: $FILE_PATH matches protected pattern '$pattern'" >&2
    exit 2  # exit 2 = 차단
  fi
done

exit 0
```

```bash
chmod +x .claude/hooks/protect-files.sh
```

`.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/protect-files.sh"
          }
        ]
      }
    ]
  }
}
```

#### 컨텍스트 압축 후 리마인더 주입

긴 대화 후 컨텍스트가 압축(`/compact`)되면 중요한 정보가 사라질 수 있다. 압축 후 자동으로 리마인더를 주입하자:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "compact",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Reminder: pnpm 사용, npm 아님. 커밋 전 pnpm test 실행. 현재 스프린트: 인증 리팩토링.'"
          }
        ]
      }
    ]
  }
}
```

#### Bash 명령 로깅

Claude가 실행한 모든 Bash 명령을 로그 파일에 기록:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.command' >> ~/.claude/command-log.txt"
          }
        ]
      }
    ]
  }
}
```

### 3.4 프롬프트 기반 훅 — AI가 판단하는 훅

규칙 기반(exit 0/2)이 아니라 **AI가 판단**하는 훅도 있다. Claude가 작업을 끝냈는데, 정말 끝난 건지 확인하고 싶을 때:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "모든 요청된 작업이 완료되었는지 확인해. 완료되지 않았다면 {\"ok\": false, \"reason\": \"남은 작업 설명\"} 으로 응답해."
          }
        ]
      }
    ]
  }
}
```

`"ok": false`를 반환하면 Claude가 멈추지 않고 계속 작업한다.

### 3.5 훅 이벤트 요약

| 이벤트 | 발생 시점 | 활용 예시 |
|---|---|---|
| `SessionStart` | 세션 시작/재개 | 환경 변수 로드, 컨텍스트 주입 |
| `UserPromptSubmit` | 사용자 프롬프트 제출 | 입력 검증, 컨텍스트 추가 |
| `PreToolUse` | 도구 실행 전 | 위험한 명령 차단, 파일 보호 |
| `PostToolUse` | 도구 실행 후 | 자동 포맷팅, 로깅 |
| `Notification` | 알림 발생 | 데스크톱 알림 |
| `Stop` | Claude 응답 완료 | 완료 검증 |
| `SessionEnd` | 세션 종료 | 정리 작업 |

### 3.6 훅 설정 위치

| 위치 | 범위 |
|---|---|
| `~/.claude/settings.json` | 내 모든 프로젝트 |
| `.claude/settings.json` | 이 프로젝트 (팀 공유) |
| `.claude/settings.local.json` | 이 프로젝트 (나만) |

---

## 마무리 — 세 기능의 조합

메모리, 스킬, 훅은 각각 강력하지만, **조합하면 진짜 위력**을 발휘한다:

1. **CLAUDE.md**에 프로젝트 규칙을 정의하고
2. **커스텀 스킬**로 반복 작업(배포, 블로그 작성, 코드 리뷰)을 자동화하고
3. **훅**으로 파일 보호, 자동 포맷팅, 알림을 걸어두면

Claude Code가 단순한 AI 채팅이 아니라 **프로젝트에 맞춤화된 개발 파트너**가 된다.

다음 Part 2에서는 **플러그인, MCP, IDE 연동**을 다룬다. 마켓플레이스에서 유용한 플러그인을 설치하고, MCP로 외부 서비스를 연결하고, IntelliJ IDEA에서 Claude Code를 바로 사용하는 방법을 알아보자.

---

## 참고 자료

- [Claude Code 공식 문서 — 메모리](https://docs.anthropic.com/en/docs/claude-code/memory)
- [Claude Code 공식 문서 — 스킬](https://docs.anthropic.com/en/docs/claude-code/skills)
- [Claude Code 공식 문서 — 훅 가이드](https://docs.anthropic.com/en/docs/claude-code/hooks-guide)
- [Claude Code 공식 문서 — 훅 레퍼런스](https://docs.anthropic.com/en/docs/claude-code/hooks)
