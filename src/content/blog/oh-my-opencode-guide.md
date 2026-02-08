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

> 아래 2.1 ~ 2.2는 **택 1**이다. 하나만 수행하면 된다.

### 2.1 대화형 설치 (권장)

가장 간편한 방법은 대화형 설치 CLI를 실행하는 것이다:

```bash
# Bun 사용 (권장)
bunx oh-my-opencode install

# 또는 Node.js 사용
npx oh-my-opencode install
```

> **bunx / npx란?** 패키지를 설치하지 않고 바로 실행할 수 있는 CLI 도구다. `bunx`는 [Bun](https://bun.sh) 런타임에 포함된 패키지 러너이고, `npx`는 Node.js에 포함된 패키지 러너다. 둘 다 npm 레지스트리에서 패키지를 다운로드하여 실행하므로 현재 디렉토리와 무관하게 어디서든 동일하게 동작한다. `bunx`가 실행 속도가 더 빠르기 때문에 권장된다.

### 2.2 에이전트를 통한 설치

OpenCode나 Claude Code 등 AI 에이전트에 다음 프롬프트를 입력하면 자동 설치를 수행한다:

```
Install and configure oh-my-opencode by following the instructions here:
https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/refs/heads/master/docs/guide/installation.md
```

#### 구독 플래그 (선택)

2.1의 설치 명령에 보유한 AI 서비스 구독에 따라 플래그를 추가할 수 있다:

```bash
# bunx 사용
bunx oh-my-opencode install --no-tui \
  --claude=yes \
  --openai=yes \
  --gemini=yes \
  --copilot=no

# npx 사용
npx oh-my-opencode install --no-tui \
  --claude=yes \
  --openai=yes \
  --gemini=yes \
  --copilot=no
```

| 플래그 | 설명 | 값 |
|--------|------|-----|
| `--claude` | Anthropic Claude 구독 | `yes` (Pro / Max 5x), `no`, `max20` (Max 20x) |
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

### 2.3 설치 확인

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

### 3.1 인증 흐름

모든 프로바이더는 동일한 명령어로 인증한다:

```bash
opencode auth login
```

실행하면 프로바이더 선택 화면이 나타난다:

```
◆  Select provider

│  ● OpenCode Zen (recommended)
│  ○ Anthropic
│  ○ GitHub Copilot
│  ○ OpenAI
│  ○ Google
│  ...
```

각 프로바이더의 의미는 다음과 같다:

| 프로바이더 | 설명 | 필요한 구독 |
|-----------|------|------------|
| **OpenCode Zen** | OpenCode 팀이 운영하는 종량제 모델 게이트웨이. 별도 AI 구독 없이 사용 가능 | 없음 (종량제) |
| **Anthropic** | Claude 모델 직접 사용 (⚠️ 현재 제한, 9.1 참고) | Anthropic API 키 (별도 발급) |
| **GitHub Copilot** | GitHub Copilot을 통한 모델 접근 | Copilot Pro / Pro+ / Business / Enterprise |
| **OpenAI** | GPT 모델 직접 사용 | ChatGPT Plus / Pro |
| **Google** | Gemini 모델 사용 (별도 플러그인 필요) | Gemini Advanced |

> **주의**: Claude Pro/Max 구독은 **Claude Code(Anthropic 공식 도구) 전용**이며, OpenCode에서는 사용할 수 없다 (9.1 참고). OpenCode에서 Claude를 쓰려면 별도 Anthropic API 키가 필요하다. Claude 구독만 보유한 경우 OpenCode Zen이나 GitHub Copilot 등 다른 프로바이더를 선택하는 것을 권장한다.

화살표 키(↑/↓)로 원하는 프로바이더를 선택하고 `Enter`를 누르면 브라우저가 열리며 OAuth 인증이 진행된다. 인증할 프로바이더마다 `opencode auth login`을 반복 실행하면 된다.

### 3.2 프로바이더별 참고 사항

**Google Gemini**
- Gemini를 사용하려면 먼저 `opencode-antigravity-auth` 플러그인을 추가해야 한다:

```json
{
  "plugin": ["oh-my-opencode", "opencode-antigravity-auth@latest"]
}
```

- `Google`을 선택 → OAuth with Google (Antigravity)로 인증
- 최대 10개 Google 계정을 등록할 수 있으며, Rate Limit 발생 시 자동으로 계정을 전환한다.

**GitHub Copilot**
- 2026년 1월부터 GitHub가 OpenCode와 공식 제휴하여, Copilot 구독자(Pro, Pro+, Business, Enterprise)는 추가 라이선스 없이 인증할 수 있다.

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

아래는 모든 AI 서비스를 구독했을 때의 **기본 모델 배정**이다. 모든 서비스를 구독할 필요는 없으며, 설치 시 지정한 구독 플래그(2.1 참고)에 따라 사용 가능한 모델로 자동 조정된다. 모델을 직접 변경하고 싶다면 5.2를 참고한다.

| 에이전트 | 기본 모델 | 역할 |
|----------|-----------|------|
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

```bash
# 전역 설정 파일 열기 (없으면 생성)
mkdir -p ~/.config/opencode
vim ~/.config/opencode/oh-my-opencode.json

# 프로젝트 로컬 설정 파일 열기 (없으면 생성)
mkdir -p .opencode
vim .opencode/oh-my-opencode.json

# 현재 설정 내용 확인
cat ~/.config/opencode/oh-my-opencode.json
```

### 5.2 에이전트 모델 변경

기본 모델이 아닌 다른 모델을 사용하고 싶을 때, 설정 파일에 다음 내용을 추가한다:

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

### 5.3 에이전트 페르소나 (프롬프트 커스터마이징)

에이전트의 행동 방식을 프롬프트로 제어할 수 있다. 두 가지 방식이 있다:

- **`prompt`** — 기본 시스템 프롬프트를 **완전히 교체**한다. 에이전트의 기본 역할 정의까지 덮어쓰므로 주의가 필요하다.
- **`prompt_append`** — 기본 프롬프트를 **유지하면서 추가 지시만 덧붙인다**. 대부분의 경우 이쪽을 권장한다.

```jsonc
{
  "agents": {
    "sisyphus": {
      // 기본 프롬프트 유지 + 추가 지시
      "prompt_append": "항상 한국어로 응답하고, 코드 주석은 영어로 작성해줘."
    },
    "hephaestus": {
      "prompt_append": "구현 완료 후 반드시 유닛 테스트를 함께 작성해줘."
    },
    "explore": {
      "prompt_append": "탐색 결과를 마크다운 표 형식으로 정리해줘."
    }
  }
}
```

`temperature` 값으로 응답의 창의성 수준도 조절할 수 있다:

| temperature | 특성 | 추천 용도 |
|-------------|------|-----------|
| **0.0 ~ 0.3** | 보수적, 일관성 높음 | 코드 생성, 리팩토링 |
| **0.4 ~ 0.7** | 균형 잡힌 창의성 | 일반 작업, 설계 |
| **0.8 ~ 1.0** | 창의적, 다양한 응답 | 브레인스토밍, 문서 작성 |

```jsonc
{
  "agents": {
    "oracle": {
      "temperature": 0.3,
      "prompt_append": "코드 리뷰 시 보안 취약점을 최우선으로 점검해줘."
    }
  }
}
```

> **팁**: `prompt`로 완전히 교체하면 에이전트 고유의 역할 정의(Todo 강제 모드, 병렬 탐색 등)가 사라질 수 있다. 특별한 이유가 없다면 `prompt_append`를 사용하자.

#### 멀티 에이전트 회의 활용법

Oh My OpenCode의 에이전트 시스템은 단순한 작업 분배를 넘어, **여러 에이전트가 서로 다른 관점으로 토론하는 회의 구조**로 활용할 수 있다. `prompt_append`로 각 에이전트에 뚜렷한 전문가 관점을 부여하면 된다.

**예시: 코드 리뷰 회의 구성**

```jsonc
{
  "agents": {
    "oracle": {
      "temperature": 0.3,
      "prompt_append": "보안 전문가 관점에서 리뷰해줘. 취약점, 인젝션, 인증 문제를 최우선으로 점검하고, 반드시 반대 의견을 먼저 제시해줘."
    },
    "hephaestus": {
      "prompt_append": "성능 전문가 관점에서 구현해줘. 시간 복잡도, 메모리 사용량, 불필요한 연산을 항상 체크해줘."
    },
    "frontend": {
      "prompt_append": "UX 전문가 관점에서 작업해줘. 사용자 경험, 접근성(a11y), 반응형 디자인을 최우선으로 고려해줘."
    }
  }
}
```

이렇게 설정하면 Sisyphus가 작업을 분배할 때 각 에이전트가 자신의 전문 관점에서 피드백하게 된다. 결과적으로 한 명의 개발자가 보안/성능/UX 전문가로 구성된 **가상 리뷰 팀**의 피드백을 받는 효과를 얻을 수 있다.

> [CrewAI](https://github.com/crewAIInc/crewAI)나 [AutoGen](https://github.com/microsoft/autogen) 같은 전문 멀티 에이전트 프레임워크도 비슷한 토론 구조를 제공한다. 더 복잡한 에이전트 간 토론이나 투표 기반 의사결정이 필요하다면 이러한 도구도 참고하자.

### 5.4 백그라운드 작업 동시성 제한

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

### 5.5 카테고리 기반 작업 위임

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

### 5.6 특정 기능 비활성화

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

프롬프트에 `ultrawork` 또는 `ulw`를 포함하면 모든 고급 기능이 자동으로 활성화된다. OpenCode를 실행한 뒤 입력창에 다음과 같이 입력한다:

```bash
# 먼저 프로젝트 디렉토리에서 OpenCode 실행
opencode

# OpenCode 입력창에서 ulw 키워드와 함께 요청
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

```bash
# 룰 디렉토리 생성
mkdir -p .opencode/rules/auth .opencode/rules/api

# 전역 규칙 파일 생성
vim .opencode/rules/general.md

# 디렉토리별 규칙 파일 생성
vim .opencode/rules/auth/rules.md
vim .opencode/rules/api/rules.md
```

생성된 구조는 다음과 같다:

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

2026년 1월 9일, Anthropic은 서드파티 도구에서 Claude OAuth 토큰을 사용하는 것을 차단했다.

**배경**: 많은 개발자들이 Claude Max 구독으로 발급받은 OAuth 토큰을 OpenCode 등 서드파티 도구에서 사용했다. 정가 API 대비 저렴하게 Claude를 대량 사용할 수 있었기 때문이다.

**차단 이후 에러 메시지:**

```
This credential is only authorized for use with Claude Code
and cannot be used for other API requests.
```

**Anthropic의 입장:**

- 서드파티 도구가 Claude Code를 위장(스푸핑)하여 접근하는 것은 **ToS(이용약관) 위반**
- 텔레메트리 없는 비정상 트래픽이 디버깅과 레이트 리밋 관리를 어렵게 만듦
- 공식 통합 방법은 API 키 사용뿐이라는 입장

**계정 밴 위험은?**

초기(2026년 1월)에는 일부 계정이 일시 정지된 사례가 있었으나, Anthropic이 해당 밴을 모두 해제했다고 밝혔다. 현재는 계정 밴이 아닌 **토큰 거부** 방식으로 처리되어, 시도해도 인증이 실패할 뿐 계정이 정지되지는 않는다.

**현재 대응 방법:**

- OpenCode Zen, GitHub Copilot, OpenAI 등 **다른 프로바이더를 사용**하는 것이 가장 안전하다
- Anthropic API 키를 직접 발급받아 사용하는 방법도 있다
- Oh My OpenCode 자체는 공식 OAuth 구현을 포함하지 않지만, 이 제한 사항을 인지하고 사용해야 한다

### 9.2 사칭 사이트 주의

`ohmyopencode.com`은 공식 프로젝트와 무관한 사칭 사이트다. 공식 다운로드는 반드시 GitHub 릴리스 페이지에서 해야 한다.

### 9.3 EACCES 권한 오류 (`~/.local/share`)

`opencode --version` 실행 시 다음과 같은 에러가 발생할 수 있다:

```
EACCES: permission denied, mkdir '/Users/username/.local/share'
```

이는 `~/.local` 디렉토리의 소유자가 `root`로 되어 있어 일반 사용자 권한으로 하위 디렉토리를 생성할 수 없기 때문이다. 과거에 `sudo`로 다른 도구를 설치하면서 root 소유로 생성된 경우가 많다.

**해결 방법:**

```bash
sudo chown -R $(whoami):staff ~/.local
```

실행 후 `opencode --version`이 정상적으로 출력되는지 확인한다.

### 9.4 버전 호환성

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
