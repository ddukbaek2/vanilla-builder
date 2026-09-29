# 03. 빌드 실행기 — iOS(Capacitor + Xcode), macOS(Electron)

작성일: 2026-09-29
상태: 초안 (기본) — 구현됨
근거: iOS 절차는 my-diabetes-notes 의 `platforms/appstore/tools/buildipa.cjs` 와 `stage.cjs` 에서 실제로 동작하던 명령 순서와 서명 옵션을 옮긴 것이다. 프로젝트 쪽 구조는 재현하지 않고 명령 지식만 가져온다.

## 1. 입력은 웹 빌드 결과물 (결정, 확인 요청)

서버가 받는 것은 프로젝트에서 `npm run build` 로 만든 `build/web` 의 내용(정적 웹 자산)이다. 소스 전체와 `npm install` / 웹 빌드를 서버에서 수행하지 않는다.

이유:
- 두 프로젝트의 웹 빌드는 Windows 에서도 되므로 Mac 이 할 필요가 없다. Mac 이 꼭 해야 하는 일(Xcode, Electron 패키징)만 서버가 맡는다.
- 두 프로젝트의 `npm install` 은 git 서브모듈 갱신(`postinstall`), `canvas` 네이티브 모듈, `ffmpeg-static`, `puppeteer-core` 등 무거운 의존성을 끌고 온다. 서버가 이를 재현하면 실패 지점만 늘어난다.
- my-diabetes-notes 의 `npm run build` 는 웹 배포(`deploy:web`)까지 묶여 있어 서버에서 돌리기에 부적절하다.

소스 전체를 받아 서버에서 웹 빌드까지 하는 방식은 추후 옵션(`source.buildCommand`)으로 남긴다.

## 2. 공통 규칙

- 각 플랫폼은 작업 디렉토리의 `build/<platform>/` 안에서 독립적으로 진행한다. 다른 플랫폼의 실패에 영향받지 않는다.
- 외부 명령은 `child_process.spawn` 으로 실행한다. `stdout`/`stderr` 를 작업 로그에 그대로 기록한다. 프로세스 그룹(`detached: true`)으로 띄워 취소 시 하위 프로세스까지 함께 종료한다.
- 서버가 관리하는 도구 버전은 `src/builders/toolversions.js` 에 상수로 둔다. 현재: Electron ^44.4.5, electron-builder ^26.15.3, Capacitor ^8.5.2.
- 단계 구분은 `02-server-and-api.md` 의 `prepare` / `build` / `deliver` 를 따른다.

## 3. iOS 절차

서버 Mac 사전 조건: Xcode (이 Mac 은 26.6 확인), 해당 팀의 Apple ID 가 Xcode 에 로그인됨, `xcode-select` 가 Xcode 를 가리킴. Capacitor 8 은 Swift Package Manager 를 쓰므로 CocoaPods 는 필요 없다.

### `ios:prepare` — Capacitor iOS 프로젝트 생성

1. `build/ios/` 생성
2. `package.json` 작성
   - `dependencies`: `@capacitor/core@^8`, `@capacitor/ios@^8`, 명세의 `targets.ios.plugins`
   - `devDependencies`: `@capacitor/cli@^8`
3. `capacitor.config.json` 작성
   ```json
   { "appId": "<app.id>", "appName": "<app.name>", "webDir": "www", "ios": { "contentInset": "never", "scrollEnabled": false } }
   ```
   `ios` 항목은 my-diabetes-notes 에서 쓰던 값을 고정 기본값으로 둔다. (전체 화면 웹 앱과 게임에 공통으로 필요한 설정)
4. `www/` ← `source.webDir` 복사 (`.DS_Store`, `Thumbs.db` 제외)
5. `npm install`
6. `cap add ios --packagemanager SPM` → `ios/App/App.xcodeproj` 생성 (CocoaPods 대신 Swift Package Manager. my-diabetes-notes 와 같은 방식)
7. `cap sync ios` → `www` 복사와 플러그인 네이티브 의존성 동기화

### `ios:build` — 아카이브와 IPA 추출

8. `ExportOptions.plist` 작성
   ```xml
   method            app-store-connect
   teamID            <targets.ios.teamId>
   signingStyle      automatic
   destination       export
   stripSwiftSymbols true
   uploadSymbols     true
   ```
9. 아카이브
   ```
   xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release
              -destination generic/platform=iOS -archivePath out/App.xcarchive
              -derivedDataPath out/DerivedData
              clean archive -allowProvisioningUpdates
              DEVELOPMENT_TEAM=<teamId> CODE_SIGN_STYLE=Automatic MARKETING_VERSION=<app.version>
   ```
   팀 ID 를 반드시 함께 넘긴다. (기존 스크립트 주석: 개인 팀이 선점되는 사고 방지)
10. IPA 추출
    ```
    xcodebuild -exportArchive -archivePath out/App.xcarchive -exportPath out
               -exportOptionsPlist ExportOptions.plist -allowProvisioningUpdates
    ```
    결과: `out/App.ipa`

기존 스크립트의 Xcode Organizer 사본 생성 단계는 서버에서는 하지 않는다.

### `ios:deliver`

11. `out/App.ipa` → `artifacts/<name>-<version>-ios.ipa`

## 4. macOS 절차 (Electron)

서버 Mac 사전 조건: Node.js. electron-builder 가 첫 실행 때 Electron 바이너리를 내려받아 `~/Library/Caches/electron` 에 보관하므로 네트워크가 필요하다.

### `macos:prepare` — Electron 래퍼 생성

1. `build/macos/` 생성
2. `package.json` 작성
   - `name`: `app.name` 을 소문자 케밥케이스로 변환, `version`: `app.version`, `main`: `main.js`
   - `devDependencies`: `electron`, `electron-builder`
   - `build`: `{ "appId": "<app.id>", "productName": "<app.name>", "mac": { "target": [{ "target": "dmg", "arch": [<호스트 arch>] }], "identity": null }, "files": ["main.js", "app/**"], "directories": { "output": "out" } }` (`identity: null` 로 서명 안 함)
3. `main.js` 작성 (고정 템플릿)
   - `app.whenReady()` 후 `BrowserWindow` 1280x720 생성, `app/index.html` 로드
   - 모든 창이 닫히면 종료
4. `app/` ← `source.webDir` 복사
5. `npm install`

### `macos:build`

6. `node_modules/.bin/electron-builder --mac --publish never`
   - 환경 변수 `CSC_IDENTITY_AUTO_DISCOVERY=false` 로 실행해 Keychain 의 인증서를 자동으로 집어 서명하려는 동작을 막는다. (서명 없음이 기본)
   - 아키텍처는 호스트 기준
   결과: `out/<productName>-<version>[-arch].dmg`

### `macos:deliver`

7. `out/*.dmg` → `artifacts/<name>-<version>-macos.dmg`

## 5. 확인 필요와 리스크

- **iPhone 설치 경로.** `app-store-connect` 방식의 `.ipa` 는 TestFlight 를 거쳐야 기기에 들어간다. 작업 PC 가 Windows 라 `.ipa` 를 직접 설치하기 어렵다. 기존 흐름(`uploadipa.cjs`, `assignbuild.cjs`)처럼 App Store Connect 업로드 단계를 다음 단계로 붙일지 결정이 필요하다. 붙인다면 `app.buildNumber` 와 서버 `.env` 의 App Store Connect API 키가 필요하다.
- **scramble-heroes 의 Capacitor 버전.** 루트 `package.json` 이 `@capacitor/app@^6` 을 쓴다. 서버가 Capacitor 8 로 iOS 프로젝트를 만들면 웹 번들의 Capacitor 6 브리지와 맞지 않을 수 있다. 프로젝트 쪽을 8 로 올리거나, 명세에 Capacitor 버전 옵션을 추가해야 한다. 실제 빌드 때 확인한다.
- **첫 아카이브의 상호작용.** 새 번들 ID 의 첫 자동 서명은 `-allowProvisioningUpdates` 로 App ID 를 등록한다. Keychain 접근 허용 창이 뜨면 서버 Mac 에서 한 번 수동으로 허용해야 할 수 있다.
- **처리 시간.** 매 작업마다 `npm install` 을 하므로 첫 실행은 수 분 걸린다. npm 캐시와 Electron 캐시로 두 번째부터는 빨라진다. 템플릿 디렉토리에 미리 설치해 두는 최적화는 추후.

## 6. 모듈 구성 (구현됨)

- `src/commandrunner.js`: spawn, 로그 기록, 프로세스 그룹 종료
- `src/builders/iosbuilder.js`: 3절의 prepare / build / deliver. 파일 생성은 `writeProject`, plist 는 `writeExportOptions` 로 분리해 명령 없이 테스트한다
- `src/builders/macosbuilder.js`: 4절의 prepare / build / deliver. 파일 생성은 `writeProject`
- `src/builders/common.js`: 웹 자산 복사, 산출물 파일명, 패키지 이름, node_modules/.bin 경로, JSON 쓰기
- `src/builders/toolversions.js`: Electron / electron-builder / Capacitor 버전 상수
- `test/builders.test.js`: 생성 파일 내용과 deliver 검증 (실제 npm/xcodebuild 는 실행하지 않음)
