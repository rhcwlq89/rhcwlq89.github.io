---
title: "Claude Code 200% 활용하기 (2) — 플러그인, MCP, IDE 연동"
description: "Claude Code 플러그인으로 기능 확장하고, MCP로 외부 도구 연결하고, VS Code에서 바로 사용하는 방법까지 실전 가이드"
pubDate: 2026-03-14T19:00:00+09:00
tags:
  [
    "Claude Code",
    "AI",
    "Coding Agent",
    "Plugin",
    "MCP",
    "IDE",
    "VS Code",
    "Automation",
  ]
heroImage: "../../assets/ClaudeCodeAdvancedGuide.png"
---

## 서론

[Part 1](/blog/claude-code-advanced-guide-1)에서는 메모리, 스킬, 훅을 다뤘다. Claude가 나를 기억하게 하고, 반복 작업을 자동화하는 방법이었다.

이번 Part 2에서는 Claude Code의 영역을 **바깥으로 확장**하는 방법을 다룬다:

- **플러그인**: 스킬, 에이전트, 훅, MCP 서버를 하나로 묶어 배포
- **MCP**: 외부 도구(GitHub, Sentry, DB 등)를 Claude에 연결
- **IDE 연동**: VS Code에서 Claude Code를 네이티브로 사용

---

## 1. 플러그인 — 기능을 묶어서 공유하기

플러그인은 스킬, 에이전트, 훅, MCP 서버를 **하나의 패키지**로 묶는 시스템이다. 직접 만들어 쓸 수도 있고, 마켓플레이스에서 남이 만든 걸 설치할 수도 있다.

### 1.1 플러그인 vs 독립 설정

| 방식 | 스킬 이름 | 적합한 경우 |
|---|---|---|
| **독립 설정** (`.claude/` 디렉토리) | `/hello` | 개인 워크플로우, 프로젝트별 커스텀 |
| **플러그인** (`.claude-plugin/plugin.json`) | `/plugin-name:hello` | 팀 공유, 커뮤니티 배포, 버전 관리 |

> 혼자 쓸 거면 `.claude/`에 직접 넣고, 팀이나 커뮤니티와 공유하려면 플러그인으로 만든다.

### 1.2 플러그인 만들기

#### 디렉토리 구조

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json          # 매니페스트 (필수)
├── commands/                # 슬래시 커맨드
├── skills/                  # 에이전트 스킬
│   └── code-review/
│       └── SKILL.md
├── agents/                  # 커스텀 에이전트
├── hooks/
│   └── hooks.json           # 훅 설정
├── .mcp.json                # MCP 서버 설정
└── settings.json            # 기본 설정
```

#### plugin.json 작성

```json
{
  "name": "my-plugin",
  "description": "코드 리뷰 자동화 플러그인",
  "version": "1.0.0",
  "author": {
    "name": "Your Name"
  }
}
```

`name`이 스킬의 네임스페이스가 된다. 이 플러그인의 스킬은 `/my-plugin:code-review` 형태로 호출한다.

#### 스킬 추가

`skills/code-review/SKILL.md`:

```markdown
---
name: code-review
description: 코드 품질과 보안을 점검한다
---

코드를 리뷰할 때 다음을 확인한다:
1. 코드 구조와 가독성
2. 에러 핸들링
3. 보안 취약점
4. 테스트 커버리지
```

#### 로컬 테스트

마켓플레이스에 올리거나 `claude plugin install`로 설치하기 전에, 로컬 디렉토리를 직접 가리켜서 테스트할 수 있다:

```bash
# ./my-plugin 디렉토리를 임시 플러그인으로 로드하면서 Claude Code 시작
claude --plugin-dir ./my-plugin

# 여러 플러그인을 동시에 테스트
claude --plugin-dir ./plugin-one --plugin-dir ./plugin-two
```

이 명령은 **Claude Code를 새로 시작하면서** 해당 폴더를 플러그인으로 인식시킨다. 해당 세션 동안만 유효하고, 세션이 끝나면 사라진다.

테스트할 것들:

- 스킬이 `/` 명령 목록에 나타나는지 (`/my-plugin:code-review`)
- 에이전트가 `/agents`에 보이는지
- 훅이 이벤트 발생 시 트리거되는지
- MCP 서버가 `/mcp`에서 연결되는지

개발 중 파일을 수정하면 Claude Code를 재시작할 필요 없이 `/reload-plugins`로 바로 반영할 수 있다. 단, LSP 서버 설정 변경은 전체 재시작이 필요하다.

### 1.3 플러그인 설치 & 마켓플레이스

```bash
# Claude Code 안에서
/plugins  # 플러그인 관리 화면 열기
```

설치 범위 선택:

| 범위 | 설명 |
|---|---|
| **Install for you** | 모든 프로젝트에서 사용 (user) |
| **Install for this project** | 이 프로젝트만, 팀과 공유 (project) |
| **Install locally** | 이 프로젝트만, 나만 사용 (local) |

마켓플레이스는 GitHub 저장소, URL, 로컬 경로로 추가할 수 있다. 공식 마켓플레이스도 있고, 팀 전용 마켓플레이스를 만들 수도 있다.

### 1.4 기존 설정을 플러그인으로 변환

이미 `.claude/` 디렉토리에 스킬이나 훅이 있다면, 그대로 플러그인 구조로 옮기면 된다:

```bash
mkdir -p my-plugin/.claude-plugin
# plugin.json 생성 후
cp -r .claude/commands my-plugin/
cp -r .claude/skills my-plugin/
cp -r .claude/agents my-plugin/
```

---

## 2. MCP — 외부 도구 연결하기

MCP(Model Context Protocol)는 Claude Code를 외부 도구와 연결하는 **오픈 소스 표준 프로토콜**이다. GitHub, Sentry, 데이터베이스, Slack 등 수백 개의 도구를 연결할 수 있다.

### 2.1 MCP로 할 수 있는 것

MCP 서버를 연결하면 이런 식으로 쓸 수 있다:

```
JIRA ENG-4521 이슈에 설명된 기능 구현하고 GitHub PR 만들어줘
```

```
Sentry에서 최근 24시간 에러 확인하고, 어떤 배포에서 시작됐는지 분석해줘
```

```
PostgreSQL에서 이번 달 매출 데이터 조회해줘
```

### 2.2 MCP 서버 설치하기

#### HTTP 서버 (권장)

```bash
# GitHub 연결
claude mcp add --transport http github https://api.githubcopilot.com/mcp/

# Notion 연결
claude mcp add --transport http notion https://mcp.notion.com/mcp

# 인증 헤더 포함
claude mcp add --transport http secure-api https://api.example.com/mcp \
  --header "Authorization: Bearer your-token"
```

#### stdio 서버 (로컬 프로세스)

```bash
# PostgreSQL 연결
claude mcp add --transport stdio db -- npx -y @bytebase/dbhub \
  --dsn "postgresql://readonly:pass@prod.db.com:5432/analytics"

# Airtable 연결
claude mcp add --transport stdio --env AIRTABLE_API_KEY=YOUR_KEY airtable \
  -- npx -y airtable-mcp-server
```

#### 서버 관리

```bash
claude mcp list              # 목록 보기
claude mcp get github        # 상세 정보
claude mcp remove github     # 삭제
/mcp                         # Claude Code 안에서 상태 확인
```

### 2.3 MCP 설치 범위

| 범위 | 저장 위치 | 용도 |
|---|---|---|
| **local** (기본) | `~/.claude.json` | 이 프로젝트, 나만 사용 |
| **project** | `.mcp.json` | 팀과 공유 (Git 커밋) |
| **user** | `~/.claude.json` | 모든 프로젝트에서 사용 |

```bash
# 팀 공유용으로 설치
claude mcp add --transport http github --scope project \
  https://api.githubcopilot.com/mcp/
```

프로젝트 범위로 설치하면 `.mcp.json` 파일이 생성되고, Git에 커밋하면 팀원 모두 같은 MCP 서버를 사용할 수 있다.

### 2.4 OAuth 인증

많은 클라우드 MCP 서버는 OAuth 인증이 필요하다:

```bash
# 서버 추가
claude mcp add --transport http sentry https://mcp.sentry.dev/mcp

# Claude Code 안에서 인증
/mcp
# 브라우저에서 로그인 후 자동 연결
```

인증 토큰은 안전하게 저장되고, 자동 갱신된다.

### 2.5 .mcp.json으로 팀 설정 공유

프로젝트 루트에 `.mcp.json`을 만들어 Git에 커밋하면, 팀원 모두가 동일한 MCP 설정을 사용할 수 있다. 환경 변수 치환도 지원한다:

```json
{
  "mcpServers": {
    "api-server": {
      "type": "http",
      "url": "${API_BASE_URL:-https://api.example.com}/mcp",
      "headers": {
        "Authorization": "Bearer ${API_KEY}"
      }
    }
  }
}
```

`${VAR:-default}` 구문으로 기본값을 지정할 수 있고, API 키 같은 민감한 값은 환경 변수로 분리한다.

### 2.6 Claude Code를 MCP 서버로 사용

Claude Code 자체를 MCP 서버로 만들 수도 있다:

```bash
claude mcp serve
```

Claude Desktop에 연결하면 Claude Code의 도구(파일 읽기, 편집 등)를 Claude Desktop에서 사용할 수 있다:

```json
{
  "mcpServers": {
    "claude-code": {
      "type": "stdio",
      "command": "claude",
      "args": ["mcp", "serve"]
    }
  }
}
```

### 2.7 MCP Tool Search

MCP 서버가 많아지면 도구 정의가 컨텍스트 윈도우를 압박한다. **Tool Search**는 도구를 미리 로드하지 않고 필요할 때 동적으로 검색해서 로드한다.

MCP 도구 설명이 컨텍스트 윈도우의 10% 이상 차지하면 자동 활성화된다. 임계값을 조정하거나 끌 수 있다:

```bash
# 5%로 낮추기
ENABLE_TOOL_SEARCH=auto:5 claude

# 완전히 끄기
ENABLE_TOOL_SEARCH=false claude
```

---

## 3. IDE 연동 — VS Code에서 바로 쓰기

Claude Code는 터미널뿐 아니라 **VS Code 안에서** 네이티브로 사용할 수 있다. 확장 프로그램을 설치하면 에디터를 벗어나지 않고 Claude와 대화할 수 있다.

### 3.1 설치

VS Code 1.98.0 이상 필요.

1. `Cmd+Shift+X`로 확장 프로그램 검색
2. "Claude Code" 검색 후 **Install**
3. Spark 아이콘(✱)이 에디터 우상단에 나타나면 성공

또는 [직접 설치 링크](vscode:extension/anthropic.claude-code)를 클릭.

### 3.2 핵심 기능

#### 코드 선택 → 질문

코드를 선택하면 Claude가 자동으로 선택한 부분을 인식한다. `Option+K` (Mac) / `Alt+K` (Windows/Linux)를 누르면 `@file.ts#5-10` 형태로 참조를 삽입할 수 있다.

#### 변경사항 리뷰

Claude가 파일을 수정하면 side-by-side diff를 보여주고, 수락/거부/수정 요청을 할 수 있다.

#### @멘션으로 컨텍스트 지정

```
@auth.js 이 파일의 인증 로직을 설명해줘
@src/components/ 이 폴더 구조를 분석해줘
```

파일명을 퍼지 매칭하므로 전체 경로를 적을 필요 없다.

#### 권한 모드

프롬프트 박스 하단에서 권한 모드를 전환할 수 있다:

| 모드 | 동작 |
|---|---|
| **Normal** | 매 작업마다 허가 요청 |
| **Plan** | 계획을 보여주고 승인 후 실행 |
| **Auto-accept** | 편집을 허가 없이 적용 |

### 3.3 대화 기록 & 여러 탭

- 상단 드롭다운으로 **이전 대화 검색/재개** 가능
- `Cmd+Shift+Esc`로 새 탭에서 **별도 대화** 시작
- 여러 탭/창에서 동시에 다른 작업 가능

### 3.4 Chrome 연동

Chrome 확장 프로그램을 설치하면 브라우저 자동화도 가능하다:

```
@browser localhost:3000 가서 콘솔 에러 확인해줘
```

### 3.5 VS Code 단축키

| 명령 | 단축키 (Mac) | 설명 |
|---|---|---|
| Focus Input | `Cmd+Esc` | 에디터 ↔ Claude 토글 |
| New Tab | `Cmd+Shift+Esc` | 새 대화 탭 |
| New Conversation | `Cmd+N` | 새 대화 (Claude 포커스 시) |
| @-Mention | `Option+K` | 현재 파일/선택 참조 삽입 |

### 3.6 JetBrains IDE 연동

IntelliJ IDEA, WebStorm 등 JetBrains IDE에서도 Claude Code를 사용할 수 있다. 터미널에서 `claude`를 실행하고 `/ide` 명령으로 IDE에 연결하면 된다.

---

## 마무리 — 외부와 연결하면 진짜 파워가 나온다

Part 1이 Claude Code를 **안에서** 강화하는 방법이었다면, Part 2는 **밖으로 확장**하는 방법이다:

1. **플러그인**으로 기능을 패키징하고 팀과 공유
2. **MCP**로 GitHub, Sentry, DB 등 외부 도구를 연결
3. **VS Code 확장**으로 에디터를 벗어나지 않고 사용

다음 Part 3에서는 **서브에이전트와 에이전트 팀**을 다룬다. 복잡한 작업을 여러 에이전트에게 분할하고, 병렬로 처리하는 방법을 알아본다.

---

## 참고 자료

- [Claude Code Docs — Plugins](https://docs.anthropic.com/en/docs/claude-code/plugins)
- [Claude Code Docs — MCP](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [Claude Code Docs — VS Code Extension](https://docs.anthropic.com/en/docs/claude-code/ide-integrations)
- [MCP 공식 사이트](https://modelcontextprotocol.io/)
