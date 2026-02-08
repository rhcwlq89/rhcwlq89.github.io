---
title: "Oh My OpenCode 설정 가이드: 터미널 AI 코딩 에이전트 완전 정복"
description: "OpenCode에 Oh My OpenCode 플러그인을 설치하고 멀티 에이전트, LSP/AST 도구, MCP 통합까지 설정하는 실무 가이드"
pubDate: 2026-02-08T20:00:00+09:00
tags: ["OpenCode", "Oh My OpenCode", "AI", "Coding Agent", "Terminal", "DevOps"]
heroImage: "../../assets/OhMyOpenCodeSetupGuide.png"
---

## 서론

터미널 기반 AI 코딩 에이전트가 빠르게 발전하고 있다. Claude Code, Copilot CLI 등 다양한 도구가 있지만, 오픈소스 진영에서 가장 주목받는 것이 **OpenCode**다.

**OpenCode**는 Go 기반의 터미널 AI 코딩 에이전트로, Claude, GPT, Gemini 등 75개 이상의 모델을 지원하며 TUI(Terminal User Interface)를 통해 코딩, 디버깅, 리팩토링을 수행한다.

**Oh My OpenCode**는 이 OpenCode를 위한 올인원 플러그인으로, 다음을 제공한다:

- 멀티 모델 오케스트레이션 (역할별 최적 모델 자동 배정)
- 비동기 병렬 에이전트 실행
- LSP/AST 기반 결정적 리팩토링 도구
- 내장 MCP (웹 검색, 공식 문서 조회, GitHub 코드 검색)
- Claude Code 호환 훅 시스템

이 글에서는 OpenCode 설치부터 Oh My OpenCode 설정, 핵심 기능 활용까지 단계별로 다룬다.

---

## 1. OpenCode 설치

### 1.1 설치 방법

```bash
# macOS (Homebrew)
brew install opencode

# npm
npm install -g opencode

# 직접 다운로드
curl -fsSL https://opencode.ai/install | bash
```

### 1.2 설치 확인

```bash
opencode --version
# 1.0.150 이상 권장
```

> **주의**: Oh My OpenCode는 OpenCode 1.0.132 이상이 필요하다. 이전 버전에서는 구성 파일 손상이 발생할 수 있다.

---

## 2. Oh My OpenCode 설치

### 2.1 대화형 설치 (권장)

가장 간편한 방법은 대화형 설치 CLI를 실행하는 것이다:

```bash
# Bun 사용 (권장)
bunx oh-my-opencode install

# 또는 Node.js 사용
npx oh-my-opencode install
```

### 2.2 에이전트를 통한 설치

OpenCode나 Claude Code 등 AI 에이전트에 다음 프롬프트를 입력하면 자동 설치를 수행한다:

```
Install and configure oh-my-opencode by following the instructions here:
https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/refs/heads/master/docs/guide/installation.md
```

### 2.3 설치 시 구독 플래그

설치 시 보유한 AI 서비스 구독에 따라 플래그를 지정한다:

```bash
bunx oh-my-opencode install --no-tui \
  --claude=yes \
  --openai=yes \
  --gemini=yes \
  --copilot=no
```

| 플래그 | 설명 | 값 |
|--------|------|-----|
| `--claude` | Anthropic Claude 구독 | `yes`, `no`, `max20` (Max 20x 모드) |
| `--openai` | OpenAI/ChatGPT Plus | `yes`, `no` |
| `--gemini` | Google Gemini | `yes`, `no` |
| `--copilot` | GitHub Copilot | `yes`, `no` |
| `--opencode-zen` | OpenCode Zen | `yes`, `no` |
| `--zai-coding-plan` | Z.ai Coding Plan | `yes`, `no` |

**구독 조합 예시:**

```bash
# 모든 구독 보유
--claude=max20 --openai=yes --gemini=yes

# Claude만 사용
--claude=yes --gemini=no --copilot=no

# GitHub Copilot 폴백
--claude=no --gemini=no --copilot=yes
```

> **중요**: Claude 구독이 없으면 핵심 에이전트인 Sisyphus가 제대로 작동하지 않을 수 있다.

### 2.4 설치 확인

```bash
# 플러그인 등록 확인
cat ~/.config/opencode/opencode.json
```

`opencode.json`의 `plugin` 배열에 `"oh-my-opencode"`가 포함되어 있으면 성공이다:

```json
{
  "plugin": ["oh-my-opencode"]
}
```

---

## 3. 인증 설정

### 3.1 Anthropic (Claude)

```bash
opencode auth login
# Anthropic → Claude Pro/Max → OAuth 인증 완료
```

### 3.2 Google Gemini (Antigravity OAuth)

Gemini를 사용하려면 `opencode-antigravity-auth` 플러그인을 추가해야 한다:

```json
{
  "plugin": ["oh-my-opencode", "opencode-antigravity-auth@latest"]
}
```

```bash
opencode auth login
# Google → OAuth with Google (Antigravity)
```

> 최대 10개 Google 계정을 등록할 수 있으며, Rate Limit 발생 시 자동으로 계정을 전환한다.

### 3.3 GitHub Copilot

2026년 1월부터 GitHub가 OpenCode와 공식 제휴하여, Copilot 구독자(Pro, Pro+, Business, Enterprise)는 추가 라이선스 없이 인증할 수 있다:

```bash
opencode auth login
# GitHub → OAuth 인증
```

### 3.4 프로바이더 우선순위

인증된 프로바이더가 여러 개일 때 다음 순서로 우선 사용된다:

```
네이티브 (anthropic, openai, google)
  > GitHub Copilot
    > OpenCode Zen
      > Z.ai Coding Plan
```

---

## 4. 에이전트 시스템 이해

Oh My OpenCode의 핵심은 **역할별 전문 에이전트 시스템**이다. 각 에이전트는 고유한 모델과 역할을 가진다.

### 4.1 주요 에이전트

| 에이전트 | 모델 | 역할 |
|----------|------|------|
| **Sisyphus** | Claude Opus 4.5 High | 팀 리더 — 작업 조율, 병렬 에이전트 관리 |
| **Hephaestus** | GPT 5.2 Codex Medium | 자율적 딥 워커 — 목표 지향 실행 |
| **Oracle** | GPT 5.2 Medium | 설계 컨설팅, 디버깅, 아키텍처 |
| **Frontend** | Gemini 3 Pro | 프론트엔드 UI/UX 개발 |
| **Librarian** | Claude Sonnet 4.5 | 공식 문서 조회, 오픈소스 구현 탐색 |
| **Explore** | Claude Haiku 4.5 | 초고속 코드베이스 탐색 |
| **Prometheus** | - | 계획 수립 및 작업 분해 |
| **Metis** | - | 계획 컨설팅 및 전략 자문 |

### 4.2 에이전트 작동 흐름

```
사용자 요청
    │
    ▼
  Sisyphus (팀 리더)
    │
    ├─→ Explore (코드 탐색)          ← 병렬 실행
    ├─→ Librarian (문서 조회)        ← 병렬 실행
    │
    ├─→ Hephaestus (구현)           ← 순차 실행
    │     └─→ 2~5개 탐색 에이전트    ← 자체 병렬 탐색
    │
    └─→ Oracle (코드 리뷰)          ← 필요 시
```

### 4.3 Sisyphus — 끈질긴 완료

그리스 신화의 시시포스에서 이름을 따온 핵심 에이전트다. **Todo 강제 모드**를 통해 작업이 중간에 멈추지 않도록 보장한다:

- 작업 목록(Todo)을 추적하며 미완료 항목이 있으면 자동으로 재개
- 병렬 에이전트를 활용해 메인 컨텍스트 윈도우를 깔끔하게 유지
- 과도한 AI 생성 주석을 자동 감지하고 제거

### 4.4 Hephaestus — 자율적 장인

목표만 주면 스스로 탐색하고 구현하는 자율적 에이전트다:

- 행동 전 2~5개 백그라운드 탐색 에이전트를 병렬 실행
- 기존 코드베이스의 패턴을 학습하여 일관성 유지
- 100% 완료를 목표로 끝까지 실행

---

## 5. 설정 파일 커스터마이징

### 5.1 설정 파일 위치

| 범위 | 경로 |
|------|------|
| 사용자 전역 | `~/.config/opencode/oh-my-opencode.json` |
| 프로젝트 로컬 | `.opencode/oh-my-opencode.json` |

> 두 파일 모두 JSONC 형식을 지원한다 (주석, 후행 쉼표 허용).

### 5.2 에이전트 모델 변경

기본 모델이 아닌 다른 모델을 사용하고 싶을 때:

```jsonc
{
  // 에이전트별 모델 재정의
  "agents": {
    "sisyphus": {
      "model": "claude-opus-4-5-20250929",
      "temperature": 0.7
    },
    "hephaestus": {
      "model": "gpt-5.2-codex",
      "temperature": 0.5
    },
    "explore": {
      "model": "claude-haiku-4-5-20251001"
    }
  }
}
```

### 5.3 백그라운드 작업 동시성 제한

프로바이더별로 동시 실행 가능한 백그라운드 에이전트 수를 제한할 수 있다:

```jsonc
{
  "background_tasks": {
    "limits": [
      { "provider": "anthropic", "max_concurrent": 3 },
      { "provider": "openai", "max_concurrent": 5 },
      { "provider": "google", "max_concurrent": 4 }
    ]
  }
}
```

### 5.4 카테고리 기반 작업 위임

작업 유형별로 어떤 에이전트에게 위임할지 정의한다:

```jsonc
{
  "categories": {
    "visual": {
      "agent": "frontend",
      "description": "UI/UX, CSS, 컴포넌트 스타일링"
    },
    "business-logic": {
      "agent": "hephaestus",
      "description": "비즈니스 로직, API, 데이터 처리"
    }
  }
}
```

### 5.5 특정 기능 비활성화

불필요한 훅이나 에이전트를 끌 수 있다:

```jsonc
{
  "disabled_hooks": ["comment-checker"],
  "disabled_agents": ["frontend"],
  "disabled_mcps": ["exa"]
}
```

---

## 6. 핵심 기능 활용

### 6.1 Ultrawork 모드

프롬프트에 `ultrawork` 또는 `ulw`를 포함하면 모든 고급 기능이 자동으로 활성화된다:

```
ulw 이 프로젝트의 인증 시스템을 리팩토링해줘
```

활성화되는 기능:
- 병렬 에이전트 자동 실행
- 백그라운드 탐색 작업
- 깊은 코드베이스 분석
- 완료까지 끈질긴 실행

### 6.2 Prometheus 모드 (계획 수립)

복잡한 작업은 계획을 먼저 세우는 것이 효과적이다:

1. `Tab` 키를 눌러 Prometheus 모드 진입
2. 인터뷰 형식으로 요구사항을 정리
3. 작업 계획서가 자동 생성됨
4. `/start-work` 명령으로 실행 시작

### 6.3 내장 MCP (Model Context Protocol)

별도 설정 없이 바로 사용할 수 있는 3가지 MCP가 포함되어 있다:

| MCP | 기능 | 용도 |
|-----|------|------|
| **Exa** | 웹 검색 | 최신 정보, 라이브러리 사용법 조회 |
| **Context7** | 공식 문서 접근 | 프레임워크/라이브러리 공식 문서 참조 |
| **grep_app** | GitHub 코드 검색 | 오픈소스 구현 패턴 참조 |

### 6.4 LSP/AST 도구

코드 수정에 결정적(deterministic) 도구를 사용하여 안정성을 높인다:

- **리팩토링**: AST 기반으로 안전하게 코드 구조 변경
- **이름 변경**: 프로젝트 전체에서 심볼 일괄 변경
- **진단**: 린터/포맷터 자동 실행 및 결과 반영
- **AST 검색**: 구문 구조를 이해하는 지능형 코드 검색

### 6.5 내장 스킬

| 스킬 | 기능 |
|------|------|
| **playwright** | 브라우저 자동화 (E2E 테스트, 스크린샷) |
| **git-master** | 원자적이고 의미 있는 Git 커밋 생성 |

### 6.6 세션 도구

이전 작업 세션을 활용할 수 있다:

- 세션 목록 조회
- 이전 세션 내용 읽기
- 키워드로 세션 검색
- 세션 분석 및 컨텍스트 복원

---

## 7. 룰 시스템

Oh My OpenCode의 룰 시스템을 통해 AI가 프로젝트의 원칙과 관례를 자동으로 학습한다.

### 7.1 룰 파일 구조

```
.opencode/
├── oh-my-opencode.json      # 프로젝트 설정
└── rules/
    ├── general.md            # 전역 규칙
    ├── auth/
    │   └── rules.md          # auth/ 디렉토리 전용 규칙
    └── api/
        └── rules.md          # api/ 디렉토리 전용 규칙
```

### 7.2 규칙 자동 적용

AI가 `auth/` 디렉토리 하위 파일과 상호작용하면, 해당 디렉토리의 `rules.md`가 자동으로 참조된다. 예를 들어:

```markdown
<!-- .opencode/rules/auth/rules.md -->
## 인증 모듈 규칙

- 모든 인증 로직은 Spring Security 기반으로 구현
- JWT 토큰 만료 시간은 환경변수로 관리
- 비밀번호는 반드시 BCrypt로 해싱
- 테스트 시 MockUser 어노테이션 활용
```

---

## 8. 훅 시스템

Claude Code와 호환되는 25개 이상의 훅을 제공한다:

| 훅 | 시점 | 활용 예 |
|----|------|---------|
| `PreToolUse` | 도구 사용 전 | 위험한 파일 수정 방지 |
| `PostToolUse` | 도구 사용 후 | 린트 자동 실행 |
| `UserPromptSubmit` | 프롬프트 제출 시 | 입력 검증, 키워드 감지 |
| `Stop` | 에이전트 중지 시 | 정리 작업 수행 |

---

## 9. 주의사항

### 9.1 Anthropic OAuth 제한

2026년 1월 현재, Anthropic은 ToS 위반을 이유로 제3자 OAuth 접근을 제한했다. Oh My OpenCode 자체는 공식 OAuth 구현을 포함하지 않지만, 관련 제한 사항을 인지하고 사용해야 한다.

### 9.2 사칭 사이트 주의

`ohmyopencode.com`은 공식 프로젝트와 무관한 사칭 사이트다. 공식 다운로드는 반드시 GitHub 릴리스 페이지에서 해야 한다.

### 9.3 버전 호환성

OpenCode **1.0.132 이전 버전**에서는 구성 파일 손상 문제가 있었다 (PR#5040 이후 수정). 반드시 1.0.150 이상으로 업데이트한 후 사용하자.

---

## 10. 제거 방법

더 이상 사용하지 않을 때:

```bash
# 1. 플러그인 제거
jq '.plugin = [.plugin[] | select(. != "oh-my-opencode")]' \
    ~/.config/opencode/opencode.json > /tmp/oc.json && \
    mv /tmp/oc.json ~/.config/opencode/opencode.json

# 2. 설정 파일 제거 (선택)
rm -f ~/.config/opencode/oh-my-opencode.json
rm -f .opencode/oh-my-opencode.json
```

---

## 요약

| 항목 | 내용 |
|------|------|
| **OpenCode** | Go 기반 터미널 AI 코딩 에이전트 (75+ 모델 지원) |
| **Oh My OpenCode** | OpenCode용 올인원 플러그인 |
| **핵심 에이전트** | Sisyphus (조율), Hephaestus (구현), Oracle (설계), Librarian (문서) |
| **설치** | `bunx oh-my-opencode install` |
| **설정 파일** | `~/.config/opencode/oh-my-opencode.json` (JSONC) |
| **마법 키워드** | `ultrawork` / `ulw` — 모든 고급 기능 자동 활성화 |
| **내장 MCP** | Exa (웹 검색), Context7 (공식 문서), grep_app (GitHub 검색) |
| **계획 모드** | `Tab` → Prometheus 모드 → `/start-work` |

Oh My OpenCode는 단순히 AI 챗봇을 터미널에 가져오는 것이 아니라, 역할별 전문 에이전트가 팀처럼 협업하는 개발 환경을 구축한다. 적절한 구독과 설정만 갖추면, 복잡한 프로젝트도 `ulw` 한 마디로 시작할 수 있다.

---

## 참고 자료

- [OpenCode 공식 사이트](https://opencode.ai/)
- [Oh My OpenCode GitHub](https://github.com/code-yeongyu/oh-my-opencode)
- [Oh My OpenCode 설치 가이드](https://github.com/code-yeongyu/oh-my-opencode/blob/dev/docs/guide/installation.md)
