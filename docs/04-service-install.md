# 04. 상시 서비스 등록 (launchd)

작성일: 2026-09-29
상태: 초안 (기본)

## 1. 요구사항 (확정)

- 이 프로그램은 손으로 `npm start` 하는 것이 아니라, Mac 에서 **백그라운드로 상시 도는 서버 애플리케이션**이다.
- 로그인하면 자동으로 뜨고, 죽으면 다시 살아난다.

## 2. 방식: launchd 사용자 에이전트 (LaunchAgent)

macOS 의 표준 서비스 관리자인 launchd 에 **사용자 에이전트**로 등록한다. 시스템 데몬(LaunchDaemon)이 아닌 이유는 iOS 빌드의 Xcode 자동 서명이 **로그인 키체인**과 사용자 세션을 필요로 하기 때문이다. 사용자 에이전트는 로그인한 사용자 권한으로 돌아서 이 조건을 만족한다.

- 라벨: `com.ddukbaek2.vanilla-builder`
- plist: `~/Library/LaunchAgents/com.ddukbaek2.vanilla-builder.plist`
- 실행: `<node 절대 경로> <프로젝트 루트>/src/main.js` (launchd 는 셸 PATH 를 모르므로 절대 경로를 쓴다)
- 작업 디렉토리: 프로젝트 루트
- `RunAtLoad`: 등록 즉시와 로그인 때 시작
- `KeepAlive`: 어떤 이유로든 종료되면 다시 시작 (기동 실패도 약 10초 간격으로 재시도)
- `PATH`: node 디렉토리 + `/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin` (unzip, xcodebuild, npm, npx 를 찾기 위해)
- 표준 출력/오류: `~/Library/Logs/vanilla-builder/server.log`

## 3. 스크립트

| 명령 | 하는 일 |
|---|---|
| `sh scripts/install.sh` | plist 를 만들고 등록한다. 이미 등록돼 있으면 내렸다가 다시 올린다. 코드를 바꾼 뒤에도 이걸 다시 실행하면 된다. |
| `sh scripts/uninstall.sh` | 등록을 해제하고 plist 를 지운다. 워크스페이스와 로그는 남긴다. |

자주 쓰는 launchctl 명령:

```
launchctl print gui/$(id -u)/com.ddukbaek2.vanilla-builder      # 상태
launchctl kickstart -k gui/$(id -u)/com.ddukbaek2.vanilla-builder # 재시작
tail -f ~/Library/Logs/vanilla-builder/server.log                 # 서버 로그
```

## 4. 종료 처리

launchd 가 서비스를 내릴 때 SIGTERM 을 보낸다. 서버는 이때 실행 중인 빌드 명령(프로세스 그룹)을 끊고, 진행 중이던 작업을 취소 상태로 기록한 뒤 HTTP 서버를 닫고 종료한다. 대기 중이던 작업은 그대로 남아 다음 기동 때 큐로 복원된다. (`02-server-and-api.md` 7절)

## 5. 주의

- Mac 이 로그인 상태여야 한다. 잠자기에 들어가면 빌드가 멈추므로 시스템 설정에서 잠자기를 끄거나 전원을 연결해 둔다.
- 새 번들 ID 의 첫 iOS 서명은 키체인 접근 허용 창이 뜰 수 있다. 그때는 Mac 화면에서 한 번 허용해야 한다.
- 포트는 웹 UI 설정에서 바꾼다 (기본 8686, `~/.vanilla-builder/settings.json`). 8080 은 이 Mac 의 Jenkins 가 쓰고 있다.
