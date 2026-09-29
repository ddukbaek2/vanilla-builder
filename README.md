# vanilla-builder

웹 빌드 결과물과 명세 파일 하나를 보내면 네이티브 앱을 만들어 돌려주는 **원격 빌드 애플리케이션**입니다.

어느 데스크톱 OS 에서나 도는 하나의 앱이고, 이 앱을 실행한 머신이 곧 **빌드 노드**입니다. GitHub Actions 의 플랫폼 빌드 액션과 같은 일을 하되 저장소를 쓰지 않고 파일을 직접 받습니다. Jenkins 같은 중앙 자동화 서버가 아니라, 서로 연결된 빌드 노드들을 지향합니다. 작업은 큐에 쌓여 하나씩 돌고, 브라우저에서 단계와 로그를 보며 중간에 취소할 수 있습니다.

- 랜딩 페이지: https://ddukbaek2.com/publish/vanilla-builder/
- 지금은 **macOS 노드**가 첫 기준입니다. iOS·macOS 빌드에 Xcode 가 필요해서 여기서 시작했을 뿐, macOS 전용이 목적은 아닙니다.
- 클라이언트 도구는 Windows / macOS / Linux 어디서나 (Node.js 18+, 외부 패키지 없음)

## 로드맵

1. **macOS 노드** (현재): macOS·iOS 빌드, 큐, 현황 페이지, 클라이언트 도구
2. **Windows / Linux 노드**: 같은 코드가 그 OS 에서 돌고, 그 OS 가 만들 수 있는 대상을 빌드
3. **노드 연결**: 내 노드가 못 만드는 대상은 접근 가능한 원격 노드에 넘겨 빌드하고 결과를 받아옴
4. **릴레이**: 로컬에서 패키징 → 원격 노드에서 빌드 → 결과를 다시 로컬로

## 대상 플랫폼

| 대상 | 툴체인 | 상태 |
|---|---|---|
| macOS | Electron + electron-builder → `.dmg` | 지원 |
| iOS | Capacitor + Xcode → `.ipa` (자동 서명) | 지원 |
| Android | Capacitor + Gradle | 예정 |
| Windows | Electron (macOS 에서 크로스 빌드) | 예정 |
| Linux | Electron (macOS 에서 크로스 빌드) | 예정 |
| Web | 정적 번들 | 예정 |

프로젝트 쪽에는 Capacitor 나 Electron 설정이 없어도 됩니다. 서버가 명세를 읽어 네이티브 프로젝트를 생성해 빌드합니다.

## 빠른 시작

### 빌드 노드 (현재 macOS)

```sh
git clone https://github.com/ddukbaek2/vanilla-builder.git
cd vanilla-builder
sh scripts/install.sh
```

launchd 사용자 에이전트로 등록되어 로그인할 때마다 자동으로 뜨고, 죽으면 다시 뜹니다. 메뉴 막대에 아이콘이 생깁니다. 현황 페이지는 `http://localhost:8686` 이며 포트와 워크스페이스는 설정 화면에서 바꿉니다. 해제는 `sh scripts/uninstall.sh` 입니다.

요구 사항: macOS 13+, Node.js 22+, Xcode (iOS 빌드 시 Apple Developer 계정과 Xcode 로그인).

### 작업 PC 에서 보내기

프로젝트 루트에 `build-spec.json` 을 두고 `npm run build` 로 `build/web` 을 만든 뒤:

```sh
node vanilla-pack.mjs send http://빌드서버주소:8686 . --targets macos,ios
```

끝나면 산출물이 `dist/` 에 내려옵니다. `vanilla-pack.mjs` 는 `client/` 에 있고 랜딩 페이지에서도 받을 수 있습니다. 명령 한 줄이 싫다면 현황 페이지에 zip 을 끌어다 놓아도 되고, curl 로 보내도 됩니다.

```sh
curl -X POST "http://빌드서버주소:8686/api/jobs?targets=macos" -H "Content-Type: application/zip" --data-binary @project.zip
```

## build-spec.json

```json
{
	"specVersion": 1,
	"app": { "id": "com.example.mygame", "name": "My Game", "version": "1.0.0" },
	"source": { "webDir": "web" },
	"targets": {
		"macos": {},
		"ios": { "teamId": "ABCDE12345", "plugins": ["@capacitor/haptics@^8.0.2"] }
	}
}
```

zip 안에서는 이 파일이 루트에 있고 웹 자산은 `web/` 아래에 있습니다. 옵션이 없는 항목은 고정 기본 동작입니다(macOS 는 1280x720 창에 서명 없는 dmg, iOS 는 Xcode 자동 서명에 App Store Connect 용 ipa). 필드 설명은 [docs/01-build-spec.md](docs/01-build-spec.md) 에 있습니다.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/api/jobs` | zip 본문으로 작업 생성. `?targets=macos,ios`. `201 { "id" }` / `400 { "errors" }` |
| `GET` | `/api/jobs` | 작업 목록 |
| `GET` | `/api/jobs/:id` | 상세 (상태, 단계, 산출물, 오류) |
| `GET` | `/api/jobs/:id/log` | 로그. `?offset=N` |
| `POST` | `/api/jobs/:id/cancel` | 취소 |
| `GET` | `/api/jobs/:id/artifacts/:filename` | 산출물 다운로드 |
| `GET` / `PUT` | `/api/settings` | 설정 `{ "port", "workspaceDir" }` |

작업 상태는 `queued → running → succeeded | failed | canceled`, 단계는 플랫폼마다 `prepare → build → deliver` 입니다.

## 구조

```
src/            서버 (Node.js, 프레임워크 없음)
  main.js         진입점, 설정, 빌더 등록, 종료 처리
  httpserver.js   API 와 현황 페이지
  jobqueue.js     작업 생성, 순차 큐, 취소, 재시작 복원
  job.js          작업 상태·단계·로그
  buildspec.js    명세 검증
  commandrunner.js 외부 명령 실행 (프로세스 그룹)
  settings.js     settings.json
  builders/       macosbuilder.js, iosbuilder.js
public/         현황 페이지 (작업 / 설정 / 도움말)
client/         vanilla-pack.mjs
menubar/        macOS 메뉴 막대 아이콘 (Swift 한 파일)
scripts/        install.sh, uninstall.sh, publish.sh
landing/        랜딩 페이지 원본
tools/          gen_icon.py (Gemini 아이콘 생성)
docs/           기획서
test/           node --test
```

작업 파일은 `~/.vanilla-builder/<app.id>/builds/<번호>/` 에 남습니다. 서버 로그는 `~/Library/Logs/vanilla-builder/server.log` 입니다.

## 개발

```sh
npm test          # 가짜 빌더로 큐·취소·설정·재시작 복원 검증, 빌더 파일 생성 검증
npm start         # 서비스 대신 직접 실행할 때
```

기획서는 `docs/00-project-overview.md` 부터 번호 순으로 있습니다.
