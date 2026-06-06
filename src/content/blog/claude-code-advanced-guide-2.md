---
title: "Claude Code 200% 활용하기 (2) — 플러그인, MCP, IDE 연동"
description: "Claude Code 플러그인으로 기능 확장하고, MCP로 외부 도구 연결하고, VS Code·JetBrains에서 바로 사용하는 방법까지 실전 가이드 — 2026년 최신 버전 기준"
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

이번 Part 2에서는 Claude Code의 영역을 <strong>바깥으로 확장</strong>하는 방법을 다룬다:

- Part 1 — [메모리 + 스킬 + 훅](/blog/claude-code-advanced-guide-1)
- <strong>Part 2 — 플러그인 + MCP + IDE 연동 (이 글)</strong>
- Part 3 — [서브에이전트 + 에이전트 팀](/blog/claude-code-advanced-guide-3)
- Part 4 — [워크플로 + Ultrareview + 원격 에이전트](/blog/claude-code-advanced-guide-4)

다룰 내용:

- <strong>플러그인</strong>: 스킬, 에이전트, 훅, MCP 서버를 하나로 묶어 배포
- <strong>MCP</strong>: 외부 도구(GitHub, Sentry, DB 등)를 Claude에 연결
- <strong>IDE 연동</strong>: VS Code·JetBrains에서 Claude Code를 네이티브로 사용

> <strong>참고</strong>: 이 글은 2026년 6월 기준 최신 버전으로 점검했다. 명령어·플래그·MCP 서버 엔드포인트는 자주 바뀌므로, 설치 명령은 항상 각 서비스 공식 문서나 `claude mcp --help`로 최종 확인하자.

---

## TL;DR

- <strong>플러그인은 기능 묶음이다</strong> — 스킬·에이전트·훅·외부 도구 설정을 한 패키지로 묶어 팀·커뮤니티와 공유한다. 혼자 쓰면 `.claude/`에 그냥 두면 된다.
- <strong>MCP로 외부 도구를 연결한다</strong> — GitHub·Sentry·데이터베이스·Slack 등 수백 개 도구를 표준 프로토콜로 붙인다. 대부분 한 줄 명령으로 설치된다.
- <strong>연결 방식은 두 가지다</strong> — 클라우드 서비스는 원격(HTTP), 로컬 도구는 내 컴퓨터에서 도는 프로세스. 원격은 대개 브라우저 로그인(OAuth)으로 인증한다.
- <strong>도구가 많아지면 검색으로 불러온다</strong> — 도구 정의를 미리 다 싣지 않고 필요할 때 찾아 쓰는 기능이 기본으로 켜져 있어, 컨텍스트를 아낀다.
- <strong>에디터 안에서 바로 쓴다</strong> — VS Code는 전용 사이드 패널, JetBrains는 플러그인으로 연동된다. 설치 없이 브라우저에서 도는 클라우드 버전도 생겼다.

---

## 1. 플러그인 — 기능을 묶어서 공유하기

플러그인은 스킬, 에이전트, 훅, MCP 서버를 <strong>하나의 패키지</strong>로 묶는 시스템이다. 직접 만들어 쓸 수도 있고, 마켓플레이스에서 남이 만든 걸 설치할 수도 있다.

### 1.1 플러그인 vs 독립 설정

| 방식 | 스킬 이름 | 적합한 경우 |
|---|---|---|
| <strong>독립 설정</strong> (`.claude/` 디렉토리) | `/hello` | 개인 워크플로우, 프로젝트별 커스텀 |
| <strong>플러그인</strong> (`.claude-plugin/plugin.json`) | `/plugin-name:hello` | 팀 공유, 커뮤니티 배포, 버전 관리 |

> 혼자 쓸 거면 `.claude/`에 직접 넣고, 팀이나 커뮤니티와 공유하려면 플러그인으로 만든다.

### 1.2 플러그인 만들기

#### 디렉토리 구조

```text
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

`name`만 필수이고 `version`은 생략 가능하다(생략 시 git 커밋 SHA가 버전으로 쓰인다). `author`는 문자열이 아니라 `name`/`email`/`url`을 담는 객체다. `name`이 스킬의 네임스페이스가 되어, 이 플러그인의 스킬은 `/my-plugin:code-review` 형태로 호출한다.

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

마켓플레이스에 올리기 전에, 로컬 디렉토리(또는 `.zip`)를 직접 가리켜서 테스트할 수 있다:

```bash
# ./my-plugin 디렉토리를 임시 플러그인으로 로드하면서 Claude Code 시작
claude --plugin-dir ./my-plugin

# 여러 플러그인을 동시에 테스트
claude --plugin-dir ./plugin-one --plugin-dir ./plugin-two

# 원격 .zip URL에서 이번 세션만 로드
claude --plugin-url https://example.com/my-plugin.zip
```

이 명령은 <strong>Claude Code를 새로 시작하면서</strong> 해당 폴더를 플러그인으로 인식시킨다. 해당 세션 동안만 유효하고, 세션이 끝나면 사라진다.

테스트할 것들:

- 스킬이 `/` 명령 목록에 나타나는지 (`/my-plugin:code-review`)
- 에이전트가 `/agents`에 보이는지
- 훅이 이벤트 발생 시 트리거되는지
- MCP 서버가 `/mcp`에서 연결되는지

개발 중 파일을 수정하면 Claude Code를 재시작할 필요 없이 `/reload-plugins`로 바로 반영할 수 있다.

### 1.3 플러그인 설치 & 마켓플레이스

```bash
# Claude Code 안에서
/plugin  # 플러그인 관리 화면 열기 (Discover / Installed / Marketplaces / Errors 탭)
```

> <strong>참고</strong>: 정식 명령은 `/plugin`(단수)이다. 일부 환경에서 `/plugins`도 동작하지만, 문서 표준은 `/plugin`이다.

설치 범위 선택:

| 범위 | 설명 |
|---|---|
| <strong>Install for you</strong> | 모든 프로젝트에서 사용 (user) |
| <strong>Install for this project</strong> | 이 프로젝트만, 팀과 공유 (project) |
| <strong>Install locally</strong> | 이 프로젝트만, 나만 사용 (local) |

마켓플레이스는 GitHub 저장소(`owner/repo`), Git URL, 로컬 경로, `marketplace.json` URL로 추가할 수 있다. 공식 마켓플레이스도 있고, 팀 전용 마켓플레이스를 만들 수도 있다.

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

MCP(Model Context Protocol)는 Claude Code를 외부 도구와 연결하는 <strong>오픈 소스 표준 프로토콜</strong>이다. GitHub, Sentry, 데이터베이스, Slack 등 수백 개의 도구를 연결할 수 있다.

```mermaid
flowchart LR
    cc["Claude Code"]
    subgraph servers["MCP 서버"]
      gh["GitHub"]
      sentry["Sentry"]
      db["DB (DBHub)"]
    end
    ext["외부 서비스 API"]

    cc <-->|MCP 프로토콜| servers
    servers <-->|각 서비스 API| ext
```

### 2.1 MCP로 할 수 있는 것

MCP 서버를 연결하면 이런 식으로 쓸 수 있다:

```text
JIRA ENG-4521 이슈에 설명된 기능 구현하고 GitHub PR 만들어줘
```

```text
Sentry에서 최근 24시간 에러 확인하고, 어떤 배포에서 시작됐는지 분석해줘
```

```text
PostgreSQL에서 이번 달 매출 데이터 조회해줘
```

### 2.2 추천 MCP 서버

카테고리별로 유용한 MCP 서버를 정리했다. 대부분 한 줄 명령으로 설치할 수 있다. 엔드포인트는 변경될 수 있으니 설치 전 각 서비스 공식 문서를 확인하자.

#### 개발 & 코드 관리

| 서버 | 전송 | 설치 명령 |
|---|---|---|
| <strong>GitHub</strong> | HTTP | `claude mcp add --transport http github https://api.githubcopilot.com/mcp/` |
| <strong>Sentry</strong> | HTTP | `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp` |
| <strong>Context7</strong> | stdio | `claude mcp add --transport stdio context7 -- npx -y @upstash/context7-mcp` |
| <strong>Stripe</strong> | HTTP | `claude mcp add --transport http stripe https://mcp.stripe.com` |

#### 데이터베이스

| 서버 | 전송 | 설치 명령 |
|---|---|---|
| <strong>Supabase</strong> | HTTP | `claude mcp add --transport http supabase https://mcp.supabase.com/mcp` |
| <strong>DBHub</strong> | stdio | `claude mcp add --transport stdio db -- npx -y @bytebase/dbhub --dsn "연결문자열"` |

> DBHub은 DSN 문자열 하나로 PostgreSQL, MySQL, MariaDB, <strong>SQL Server</strong>, SQLite를 모두 연결할 수 있다. 읽기 전용 계정 사용을 권장한다.
>
> <strong>DSN 예시:</strong>
> - PostgreSQL: `postgresql://user:pass@host:5432/db`
> - MySQL: `mysql://user:pass@host:3306/db`
> - SQL Server: `sqlserver://user:pass@host:1433/db`
> - SQLite: `sqlite:///path/to/db.sqlite`

#### 프로젝트 관리 & 커뮤니케이션

| 서버 | 전송 | 설치 명령 |
|---|---|---|
| <strong>Notion</strong> | HTTP | `claude mcp add --transport http notion https://mcp.notion.com/mcp` |
| <strong>Linear</strong> | HTTP | `claude mcp add --transport http linear https://mcp.linear.app/mcp` |
| <strong>Atlassian</strong> | HTTP | `claude mcp add --transport http atlassian https://mcp.atlassian.com/v1/mcp` |
| <strong>Asana</strong> | SSE | `claude mcp add --transport sse asana https://mcp.asana.com/sse` |
| <strong>Slack</strong> | HTTP | `claude mcp add --transport http slack https://mcp.slack.com/mcp` |

> <strong>주의 — 전송 방식</strong>: Asana는 현재 SSE 엔드포인트를 쓴다. 다만 <strong>SSE 전송은 deprecated</strong> 상태이므로, 같은 서비스가 HTTP 엔드포인트를 제공하면 HTTP를 우선하자. Slack은 동적 클라이언트 등록을 지원하지 않아 사전 발급한 OAuth 자격증명이 필요하다.
>
> 전체 목록은 [MCP 서버 레지스트리](https://github.com/modelcontextprotocol/servers)에서 확인할 수 있다. 써드파티 MCP 서버는 Anthropic이 검증하지 않았으므로 신뢰할 수 있는 서버만 설치하자.

### 2.3 MCP 서버 설치하기

#### HTTP 서버 (권장)

```bash
# GitHub 연결
claude mcp add --transport http github https://api.githubcopilot.com/mcp/

# 인증 헤더 포함
claude mcp add --transport http secure-api https://api.example.com/mcp \
  --header "Authorization: Bearer your-token"
```

#### stdio 서버 (로컬 프로세스)

```bash
# PostgreSQL 연결
claude mcp add --transport stdio db -- npx -y @bytebase/dbhub \
  --dsn "postgresql://readonly:pass@prod.db.com:5432/analytics"

# Airtable 연결 (환경변수 주입)
claude mcp add --transport stdio --env AIRTABLE_API_KEY=YOUR_KEY airtable \
  -- npx -y airtable-mcp-server
```

#### 서버 관리

```bash
claude mcp list              # 목록 보기
claude mcp get github        # 상세 정보
claude mcp remove github     # 삭제
/mcp                         # Claude Code 안에서 상태 확인 / 인증
```

### 2.4 MCP 설치 범위

| 범위 | 저장 위치 | 용도 |
|---|---|---|
| <strong>local</strong> (기본) | `~/.claude.json` | 이 프로젝트, 나만 사용 |
| <strong>project</strong> | `.mcp.json` | 팀과 공유 (Git 커밋) |
| <strong>user</strong> | `~/.claude.json` | 모든 프로젝트에서 사용 |

```bash
# 팀 공유용으로 설치
claude mcp add --transport http github --scope project \
  https://api.githubcopilot.com/mcp/
```

`--scope project`로 설치하면 `.mcp.json` 파일이 생성되고, Git에 커밋하면 팀원 모두 같은 MCP 서버를 사용할 수 있다. 기본값은 `local`(나만, 현재 프로젝트)이다.

> <strong>참고</strong>: MCP의 `local` 범위 저장소(`~/.claude.json`)와 Claude Code 일반 설정의 로컬 파일(`.claude/settings.local.json`)은 서로 다른 파일이다. 헷갈리지 말자.

### 2.5 OAuth 인증

많은 클라우드 MCP 서버는 OAuth 인증이 필요하다:

```bash
# 서버 추가
claude mcp add --transport http sentry https://mcp.sentry.dev/mcp

# Claude Code 안에서 인증
/mcp
# 브라우저에서 로그인 후 자동 연결
```

인증 토큰은 안전하게 저장되고, 자동 갱신된다.

### 2.6 .mcp.json으로 팀 설정 공유

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

### 2.7 Claude Code를 MCP 서버로 사용

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

### 2.8 MCP Tool Search — 도구를 지연 로딩

MCP 서버가 많아지면 도구 정의가 컨텍스트 윈도우를 압박한다. <strong>Tool Search</strong>는 도구를 미리 다 싣지 않고, 필요할 때 동적으로 검색해서 로드한다. 컨텍스트와 프롬프트 캐시를 아껴준다.

지원 모델(Sonnet 4+/Opus 4+)에서는 <strong>기본으로 켜져 있다</strong>(모든 MCP 도구를 필요 시 로드). `ENABLE_TOOL_SEARCH` 환경변수로 동작을 조절한다:

```bash
# 임계 모드: 도구 설명이 컨텍스트의 10% 이내면 미리 싣고, 넘치는 것만 지연 로딩
ENABLE_TOOL_SEARCH=auto claude

# 임계값을 5%로
ENABLE_TOOL_SEARCH=auto:5 claude

# 끄기 (모든 도구를 미리 로드)
ENABLE_TOOL_SEARCH=false claude
```

> <strong>주의 — 과거와 달라진 점</strong>: 예전에는 "도구 설명이 10%를 넘으면 자동 활성화"가 기본이었지만, 현재는 <strong>기본이 항상 지연 로딩</strong>이다. `auto`는 옛 임계 모드를 다시 켜는 옵트인이다. 특정 서버는 `alwaysLoad`로 항상 미리 싣게 예외 처리할 수 있다.

---

## 3. IDE 연동 — 에디터 안에서 바로 쓰기

Claude Code는 터미널뿐 아니라 <strong>VS Code, JetBrains IDE 안에서</strong> 네이티브로 사용할 수 있다. 에디터를 벗어나지 않고 Claude와 대화할 수 있다.

### 3.1 VS Code

#### 설치

VS Code 1.98.0 이상 필요.

1. `Cmd+Shift+X`로 확장 프로그램 검색
2. "Claude Code" 검색 후 <strong>Install</strong>
3. 에디터 우상단에 Spark 아이콘(✱)이 나타나면 성공

#### 전용 패널 (핵심 변화)

이제 VS Code 연동은 단순 터미널 실행을 넘어 <strong>전용 그래픽 사이드 패널</strong>이 주 인터페이스다. 패널 안에서:

- <strong>세션 기록</strong>: 이전 대화 검색·재개, claude.ai 웹 세션을 로컬에서 이어받기(Remote 탭)
- <strong>인라인 diff 리뷰</strong>: 변경을 side-by-side로 보고 수락/거부/수정 요청
- <strong>계획 모드</strong>: 계획을 마크다운 문서로 검토
- <strong>체크포인트 되감기</strong>: 특정 시점으로 rewind / fork

#### 핵심 조작

- <strong>코드 선택 → 질문</strong>: 코드를 선택하면 Claude가 자동 인식. `Option+K`(Mac) / `Alt+K`로 `@file.ts#5-10` 참조 삽입.
- <strong>@멘션</strong>: `@auth.js 이 파일의 인증 로직 설명해줘`. 퍼지 매칭이라 전체 경로 불필요. `@terminal`로 터미널 출력도 참조.
- <strong>권한 모드</strong>: `default`(매번 허가) / `plan`(계획 승인 후) / `acceptEdits`(자동 수락) / `bypassPermissions`.
- <strong>Chrome 연동</strong>: 확장 설치 시 `@browser localhost:3000 가서 콘솔 에러 확인해줘`처럼 브라우저 자동화.

#### 단축키

| 명령 | 단축키 (Mac) | 설명 |
|---|---|---|
| Focus Input | `Cmd+Esc` | 에디터 ↔ Claude 토글 |
| New Tab | `Cmd+Shift+Esc` | 새 대화 탭 |
| Reopen Tab | `Cmd+Shift+T` | 닫은 세션 탭 다시 열기 |
| @-Mention | `Option+K` | 현재 파일/선택 참조 삽입 |

> <strong>주의 (macOS Tahoe 이상)</strong>: `Cmd+Esc`가 시스템 게임 오버레이 단축키와 겹쳐 동작하지 않을 수 있다. 시스템 설정 → 키보드 → 게임 컨트롤러에서 해제하면 된다.

### 3.2 JetBrains IDE

IntelliJ IDEA, PyCharm, WebStorm, GoLand, PhpStorm, Android Studio 등 대부분의 JetBrains IDE에서 사용할 수 있다.

#### 설치

1. JetBrains 마켓플레이스에서 [Claude Code 플러그인](https://plugins.jetbrains.com/plugin/27310-claude-code-beta-)을 설치 (현재 Beta)
2. IDE 재시작

#### 사용법

```bash
# IDE 내장 터미널에서
claude          # 자동으로 IDE와 연동

# 외부 터미널에서
claude
/ide            # IDE에 연결
```

#### 주요 기능

| 기능 | 설명 |
|---|---|
| Diff 뷰어 | 코드 변경을 IDE diff 뷰어에 표시 |
| 선택 컨텍스트 | 에디터 선택 코드가 자동으로 Claude에 공유 |
| 파일 참조 | `Cmd+Option+K`(Mac) / `Alt+Ctrl+K`로 `@File#L1-99` 삽입 |
| 진단 공유 | IDE의 lint·문법 에러가 자동 전달 |
| 빠른 실행 | `Cmd+Esc`(Mac) / `Ctrl+Esc`로 Claude Code 열기 |

설정은 <strong>Settings → Tools → Claude Code [Beta]</strong>에서 한다. ESC 키가 중단에 동작하지 않으면 Settings → Tools → Terminal에서 "Move focus to the editor with Escape" 체크를 해제한다.

### 3.3 Claude Code on Web — 설치 없이 브라우저에서

별도 설치 없이 [claude.ai/code](https://claude.ai/code)에서 GitHub 저장소를 연결해 Claude Code 세션을 바로 띄울 수 있다(리서치 프리뷰, Pro·Max·Team·Enterprise). Anthropic이 관리하는 클라우드 인프라에서 실행되며:

- 브라우저를 닫아도 세션이 계속 돌아간다
- Claude 모바일 앱에서 진행 상황을 모니터링
- GitHub PR 자동 수정 기능 포함
- VS Code 세션 기록의 Remote 탭에서 웹 세션을 로컬로 이어받기 가능

---

## 정리

Part 1이 Claude Code를 <strong>안에서</strong> 강화하는 방법이었다면, Part 2는 <strong>밖으로 확장</strong>하는 방법이다:

| 기능 | 핵심 |
|---|---|
| <strong>플러그인</strong> | 스킬·에이전트·훅·MCP를 묶어 팀과 공유 |
| <strong>MCP</strong> | GitHub·Sentry·DB 등 외부 도구 연결 (HTTP/stdio) |
| <strong>Tool Search</strong> | 도구를 지연 로딩해 컨텍스트 절약 (기본 켜짐) |
| <strong>IDE 연동</strong> | VS Code 전용 패널, JetBrains 플러그인, 웹 버전 |

다음 [Part 3](/blog/claude-code-advanced-guide-3)에서는 <strong>서브에이전트와 에이전트 팀</strong>을 다룬다. 복잡한 작업을 여러 에이전트에게 분할하고, 병렬로 처리하는 방법을 알아본다.

---

## 부록

### A. 용어집

| 용어 | 설명 |
|---|---|
| 플러그인 | 스킬·에이전트·훅·MCP를 묶은 배포 단위 (`.claude-plugin/plugin.json`) |
| 마켓플레이스 | 플러그인을 검색·설치하는 저장소 (GitHub·URL·로컬) |
| MCP | Model Context Protocol. 외부 도구 연결 표준 프로토콜 |
| HTTP 전송 | 원격 클라우드 MCP 서버 연결 방식 (권장) |
| stdio 전송 | 내 컴퓨터에서 도는 로컬 MCP 프로세스 연결 방식 |
| SSE 전송 | 구형 원격 연결 방식 (deprecated, HTTP 우선) |
| Tool Search | MCP 도구를 미리 싣지 않고 필요 시 검색·로드하는 기능 |

### B. 명령어 치트시트

```bash
# 플러그인
/plugin                        # 관리 화면 (Discover/Installed/Marketplaces/Errors)
claude --plugin-dir ./plugin   # 로컬 플러그인 테스트
/reload-plugins                # 개발 중 핫 리로드

# MCP
claude mcp add --transport http <name> <url>     # HTTP 서버 추가
claude mcp add --transport stdio <name> -- <cmd> # 로컬 서버 추가
claude mcp add ... --scope project               # 팀 공유(.mcp.json)
claude mcp list / get <name> / remove <name>
claude mcp serve                                 # Claude Code를 MCP 서버로
/mcp                                             # 상태 확인 / OAuth 인증

# IDE
/ide                           # 외부 터미널에서 IDE 연결
```

### C. 참고 자료

- [Claude Code Docs — Plugins](https://docs.claude.com/en/docs/claude-code/plugins)
- [Claude Code Docs — MCP](https://docs.claude.com/en/docs/claude-code/mcp)
- [Claude Code Docs — IDE Integrations](https://docs.claude.com/en/docs/claude-code/ide-integrations)
- [Claude Code Docs — Claude Code on the web](https://docs.claude.com/en/docs/claude-code/claude-code-on-the-web)
- [MCP 공식 사이트](https://modelcontextprotocol.io/)
