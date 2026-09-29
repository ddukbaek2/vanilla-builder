# 02. 서버와 작업(Job) 큐, API, 현황 페이지

작성일: 2026-09-29
상태: 초안 (기본) — 골격 구현됨
원칙: 기본부터. 순차 큐 하나, 폴링 기반 현황 페이지. 인증 없음.

## 1. 요구사항 (확정)

- 웹 빌드 결과물과 명세가 든 zip 을 받아 작업(Job)을 만든다. API(curl)로도, **웹 페이지에서 파일을 끌어다 놓아서도** 올릴 수 있다. (AI 없이 사람이 수동으로도 쓸 수 있어야 한다)
- 작업은 큐에 쌓이고 **한 번에 하나씩 순차 실행**된다.
- 진행 단계를 **웹 API 로 조회**할 수 있다.
- 서버 주소를 브라우저로 열면 **현황 페이지**가 보인다. (Jenkins 처럼 큐, 진행 중 단계, 로그)
- 대기 중이든 실행 중이든 **취소**할 수 있다.
- 산출물을 다운로드할 수 있다.
- **모든 설정은 Jenkins 처럼 웹 UI 에서 바꾼다.** 항목은 포트와 워크스페이스 둘뿐이다. Jenkins 와 달리 잡/파이프라인 설정은 없다. 이 서버는 자동화 머신이 아니라 수동 빌드를 대신해 주는 원격 빌더라서 특별한 셋팅이 필요 없다.
- 서버는 상시 실행되는 서버 애플리케이션이다. (`04-service-install.md`)

## 2. 작업(Job) 모델

- **번호(id):** 1 부터 증가하는 정수. Jenkins 빌드 번호처럼 서버 재시작 후에도 이어진다. 프로젝트와 무관하게 서버 전체에서 하나의 번호열을 쓴다.
- **상태:** `queued` → `running` → `succeeded` | `failed` | `canceled`
- **단계(steps):** 작업 생성 시 명세의 `targets` 로부터 확정한다. 대상 플랫폼마다 3단계.
  - `<platform>:prepare` 네이티브 프로젝트 생성과 웹 자산 복사
  - `<platform>:build` 실제 빌드 (Electron / Xcode)
  - `<platform>:deliver` 산출물을 `artifacts/` 로 옮기고 파일명을 규칙(01 의 4절)에 맞춤
  - 각 단계 상태: `pending` | `running` | `succeeded` | `failed` | `skipped` | `canceled`
  - 진행률 = 끝난 단계 수 / 전체 단계 수
- **실패 처리:** 한 플랫폼의 단계가 실패하면 그 플랫폼의 남은 단계는 `skipped`, 다른 플랫폼은 계속 진행. 하나라도 실패하면 작업은 `failed`. 성공한 플랫폼의 산출물은 그대로 받을 수 있다.
- **로그:** 작업당 텍스트 파일 하나. 단계 시작/종료 표시와 하위 명령의 출력을 그대로 기록한다.
- **취소:** `queued` 면 즉시 `canceled`. `running` 이면 실행 중인 하위 프로세스(프로세스 그룹)에 종료 신호를 보내고, 남은 단계를 `canceled` 로, 작업을 `canceled` 로 바꾼다.

## 3. 디렉토리 구조

**홈 디렉토리** `~/.vanilla-builder/` 는 고정이다. 설정과 서버 상태가 여기 있다.
**워크스페이스**는 프로젝트별 폴더가 만들어지는 곳이며, 기본값은 홈 디렉토리와 같고 웹 UI 설정에서 바꿀 수 있다.

```
~/.vanilla-builder/                 홈 (고정)
  settings.json                     웹 UI 에서 바꾼 설정 { "port": 8686, "workspaceDir": "..." }
  counter.json                      다음 작업 번호
  tmp/                              업로드 전개 임시 공간

<워크스페이스>/                       기본은 홈과 같음
  <app.id>/                         프로젝트 폴더 (명세의 app.id, 예: com.example.mygame)
    builds/<id>/
      job.json                      상태, 단계, 시각, 명세 사본, 오류 메시지
      log.txt                       로그
      project/                      업로드 zip 전개 결과
      build/<platform>/             서버가 생성한 네이티브 프로젝트와 빌드 중간물
      artifacts/                    산출물
```

워크스페이스를 바꾸면 그 뒤에 만드는 작업부터 새 위치에 생긴다. 이미 있던 작업은 서버가 재시작할 때 새 워크스페이스에서만 찾으므로 목록에서 사라진다. (파일은 옛 위치에 남는다)

## 4. HTTP API

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/api/jobs` | 본문은 zip 바이너리 그대로 (`Content-Type: application/zip`). 선택 쿼리 `?targets=macos,ios` 로 명세의 일부 대상만 빌드. 응답 `201 { "id": 12 }`. 명세 검증 실패 시 `400 { "errors": [...] }` |
| `GET` | `/api/jobs` | 작업 목록 (최신순). 항목: `id`, `state`, `appId`, `appName`, `appVersion`, `targets`, `createdAt`, `startedAt`, `finishedAt` |
| `GET` | `/api/jobs/:id` | 상세: 목록 항목 + 단계 목록과 각 상태, 산출물 목록, 오류 메시지 |
| `GET` | `/api/jobs/:id/log` | `text/plain` 로그. `?offset=N` 이면 N 바이트 이후만 (현황 페이지 이어받기용) |
| `POST` | `/api/jobs/:id/cancel` | 취소. 이미 끝난 작업이면 `409` |
| `GET` | `/api/jobs/:id/artifacts/:filename` | 산출물 다운로드 |
| `GET` | `/api/settings` | 설정 `{ "port": 8686, "workspaceDir": "..." }` |
| `PUT` | `/api/settings` | 설정 변경. 본문 JSON `{ "port"?, "workspaceDir"? }`. 워크스페이스는 절대 경로(또는 `~/` 시작)여야 하고 없으면 만든다. 포트가 바뀌면 새 포트를 먼저 열어 보고 성공했을 때만 저장한 뒤 응답 후 옛 포트를 닫는다. 새 포트를 못 열면(사용 중 등) 설정을 되돌리고 `400`. 실패 시 `400 { "errors": [...] }` |
| `GET` | `/` | 현황 페이지 |

zip 을 본문으로 그대로 보내는 이유: multipart 파서 없이 내장 모듈만으로 받을 수 있고, 클라이언트도 한 줄이면 된다.

```
curl -X POST "http://mac:8686/api/jobs?targets=macos" -H "Content-Type: application/zip" --data-binary @project.zip
```

zip 전개는 macOS 내장 `unzip` 명령을 사용한다. (서버는 macOS 전용이므로 외부 의존성 없음)

### `GET /api/jobs/:id` 응답 예

```json
{
    "id": 12,
    "state": "running",
    "appId": "com.example.mygame",
    "appName": "My Game",
    "appVersion": "1.2.3",
    "targets": ["macos", "ios"],
    "steps": [
        { "name": "macos:prepare", "state": "succeeded" },
        { "name": "macos:build", "state": "running" },
        { "name": "macos:deliver", "state": "pending" },
        { "name": "ios:prepare", "state": "pending" },
        { "name": "ios:build", "state": "pending" },
        { "name": "ios:deliver", "state": "pending" }
    ],
    "artifacts": [],
    "error": null,
    "createdAt": "2026-09-29T09:00:00.000Z",
    "startedAt": "2026-09-29T09:00:05.000Z",
    "finishedAt": null
}
```

## 5. 현황 페이지 (`/`)

바닐라 계열 다크 테마(다크 초콜릿 바탕, 크림 글자, 캐러멜 강조, 민트 성공색) 한 벌로 고정한다. 상단 바에는 로고와 탭만 두고, 탭으로 **작업 / 설정 / 도움말** 세 화면을 전환한다. (주소 해시 `#jobs`, `#settings`, `#help`) 대기/진행 중/전체 수는 작업 목록 제목 옆에 표시한다.

**작업 화면**
- 왼쪽 열: 업로드 드롭존(`build-spec.json` 과 웹 자산이 든 zip 을 끌어다 놓거나 클릭), **샘플 `build-spec.json` 내려받기** 링크(`GET /build-spec.sample.json`), 작업 목록.
- 오른쪽: 선택한 작업의 제목·상태·시각, 단계 배지와 진행률, 취소 버튼, 산출물 링크, 그리고 **로그가 남는 화면 공간 전체**를 차지한다. (화면 높이에 맞춰 늘어나고 안에서 스크롤)
- 2초 간격 폴링 (`/api/jobs`, `/api/jobs/:id`, `/api/jobs/:id/log?offset=`). SSE/WebSocket 은 추후.

**설정 화면**
- 포트와 워크스페이스 디렉토리를 보여주고 바꿔 저장한다. 포트가 바뀌면 새 포트 주소로 이동한다.

**도움말 화면**
- 업로드 방법(zip 구조, 명세 필드 요약, 웹 드롭과 curl), API 목록, 설정과 서비스 명령을 페이지 안에 정적으로 적는다.

구현: 프레임워크 없는 정적 파일 `public/index.html` 하나. 정적 파일 제공은 `public/` 안의 `png/svg/ico/json` 만, 하위 경로 없이.
추후: 명세를 폼으로 입력하고 웹 폴더만 올리는 방식 (지금은 zip 안에 명세를 넣어야 한다)

## 6. 작업 실행 순서

1. `POST /api/jobs` → zip 저장, 전개, `build-spec.json` 검증(01 의 6절). 통과하면 작업 생성, `queued`
2. 앞 작업이 끝나면 `running`. 대상 플랫폼 순서대로 `prepare` → `build` → `deliver`
3. 모든 단계 종료 후 최종 상태 기록, 다음 작업으로

## 7. 종료와 재시작

- **종료(SIGTERM/SIGINT):** 실행 중인 명령을 끊고 진행 중 작업을 `canceled` 로 기록한 뒤 HTTP 서버를 닫는다. 대기 작업은 손대지 않는다.
- **재시작:** 시작 시 워크스페이스의 `*/builds/*/job.json` 을 읽어 목록을 복원한다. 그래도 `running` 으로 남아 있는 작업(강제 종료 등)은 `failed` (오류: 서버 재시작으로 중단), `queued` 작업은 번호 순으로 큐에 복원한다.

## 8. 서버 설정

모두 웹 UI 에서 바꾸며 `~/.vanilla-builder/settings.json` 에 저장된다. `.env` 나 환경 변수는 쓰지 않는다.

| 키 | 기본값 | 설명 |
|---|---|---|
| `port` | `8686` | HTTP 포트. (8080 은 이 Mac 의 Jenkins 가 사용) |
| `workspaceDir` | `~/.vanilla-builder` | 프로젝트 폴더가 만들어지는 곳 |

## 9. 모듈 구성 (구현됨)

- `src/main.js`: 진입점. 설정 읽기, 빌더 등록, 서버 시작, 재시작 복원, 종료 신호 처리
- `src/settings.js`: `settings.json` 읽기/저장, 포트와 워크스페이스 변경 검증
- `src/httpserver.js`: 라우팅, zip 수신(임시 파일), 설정 API(포트 변경 시 리스너 교체), 현황 페이지 제공, 산출물 다운로드
- `src/jobqueue.js`: 작업 생성(zip 전개 + 명세 검증), 순차 큐, 취소, 재시작 복원, 종료
- `src/job.js`: 상태/단계/산출물/로그, `job.json` 저장과 복원
- `src/buildspec.js`: `build-spec.json` 읽기와 검증 (01 의 6절)
- `src/commandrunner.js`: 외부 명령 실행, 출력을 작업 로그로, 프로세스 그룹 종료
- `src/builders/`: 플랫폼별 빌더 (`03-build-runner.md`, 미구현)
- `public/index.html`: 현황 페이지 (업로드, 목록/상세/로그, 설정)
- `scripts/install.sh`, `scripts/uninstall.sh`: launchd 등록/해제 (`04-service-install.md`)
- `test/server.test.js`: 가짜 빌더로 업로드 → 큐 → 취소 → 산출물/로그 → 설정 → 종료 → 재시작 복원까지 검증

빌더 인터페이스: 플랫폼 이름 → `{ prepare(context), build(context), deliver(context) }`. 각 메서드는 비동기이며 던지면 그 단계가 실패한다. 컨텍스트는 `{ job, spec, platform, runner, projectDirectory, webDirectory, buildDirectory, artifactsDirectory }`. 지원 플랫폼 목록은 등록된 빌더의 키에서 나오므로, 빌더가 없는 플랫폼을 명세에 적으면 400 으로 거부된다.

## 10. 추후

- 인증, SSE 실시간 갱신, 병렬 빌드, 오래된 작업 자동 삭제, 완료 알림(webhook), 개별 파일 업로드, 명세 입력 폼
