# 06. 메뉴 막대 표시 (macOS)

작성일: 2026-09-30
상태: 초안 (기본)

## 1. 요구사항 (확정)

- 백그라운드 서비스이지만 **켜져 있다는 것이 화면에 보여야 한다.** macOS 의 메뉴 막대(오른쪽 위 상태 아이콘 영역)에 아이콘을 둔다.

## 2. 방식

Node.js 만으로는 메뉴 막대 아이콘을 만들 수 없다(네이티브 API 필요). 그래서 **한 파일짜리 Swift 프로그램**을 두어 `NSStatusItem` 으로 아이콘을 띄운다. 별도 Xcode 프로젝트나 앱 번들 없이 `swiftc` 로 컴파일한 실행 파일 하나다. Dock 에는 나타나지 않는다(`.accessory` 정책).

- 소스: `menubar/main.swift`
- 실행 파일: `~/.vanilla-builder/bin/vanilla-builder-menubar` (설치 스크립트가 컴파일)
- launchd: 두 번째 사용자 에이전트 `com.ddukbaek2.vanilla-builder.menubar` (`RunAtLoad`, `KeepAlive`)
- 아이콘: `public/icon.png` 를 18px 로 줄여 사용

## 3. 동작

- 5초마다 `http://localhost:<포트>/api/jobs` 를 읽어 대기/진행 중 수를 센다. 포트는 `~/.vanilla-builder/settings.json` 에서 읽는다(없으면 8686).
- 메뉴 항목
  - 상태 한 줄: "서버 응답 없음" / "대기 N · 진행 중 M"
  - **이 PC 에서 빌드 허용** (체크 항목, 기본 꺼짐). 설정 API 의 `allowBuilds` 를 토글한다. 꺼져 있으면 이 노드는 새 빌드를 받지 않는다.
  - 현황 페이지 열기 (기본 브라우저)
  - 서버 재시작 (`launchctl kickstart -k gui/<uid>/com.ddukbaek2.vanilla-builder`)
  - 종료 (서버와 메뉴 막대 아이콘을 모두 내린다. 다음 로그인이나 `install.sh` 로 다시 올라온다)
- 서버가 응답하지 않으면 아이콘을 반투명으로 표시한다.

## 4. 설치

`scripts/install.sh` 가 서버 에이전트와 함께 처리한다. `swiftc` 가 없으면(Xcode 미설치) 메뉴 막대는 건너뛰고 서버만 등록한다. `scripts/uninstall.sh` 는 둘 다 내린다.

## 5. 추후

- 아이콘에 진행 중 표시(점) 얹기, 완료 알림(Notification Center)
