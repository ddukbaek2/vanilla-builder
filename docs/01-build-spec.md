# 01. 빌드 명세 파일 (build-spec.json)

작성일: 2026-09-29
상태: 초안 (기본 항목만)
원칙: **기본 항목만 두고, 필요할 때 옵션을 하나씩 추가한다.** 모든 플랫폼의 모든 옵션을 미리 정의하지 않는다.
범위: macOS(Electron), iOS(Capacitor + Xcode). 다른 플랫폼은 필요할 때 추가한다.

## 1. 역할

클라이언트(작업 PC 의 AI 또는 사람)가 웹 빌드 결과물과 함께 넘기는 명세 파일이다. 서버는 이 파일을 읽어 **무엇을(app), 어디서(source), 어떤 플랫폼으로(targets)** 빌드할지 결정한다. 산출물은 서버가 보관하고 클라이언트가 URL 로 내려받으므로 목적지 항목은 없다.

## 2. 설계 결정 (확정)

1. **서버가 네이티브 프로젝트를 생성한다.** 클라이언트는 프로젝트의 웹 코드(빌드 결과물)만 보낸다. 서버가 명세를 읽어 Electron 래퍼와 Capacitor iOS 프로젝트를 작업 디렉토리 안에 새로 만들어 빌드한다. 프로젝트 쪽의 기존 `platforms/` 구성은 사용하지 않는다. Electron/Capacitor 버전은 서버가 관리한다.
2. **명세 파일은 zip 루트의 `build-spec.json`** 이다. 클라이언트는 아래 구조로 zip 을 만들어 보낸다.

```
project.zip
├── build-spec.json
└── web/                ← 프로젝트에서 npm run build 로 만든 build/web 의 내용
    ├── index.html
    └── ...
```

## 3. 예시

```json
{
    "specVersion": 1,
    "app": {
        "id": "com.example.mygame",
        "name": "My Game",
        "version": "1.2.3"
    },
    "source": {
        "webDir": "web"
    },
    "targets": {
        "macos": {},
        "ios": {
            "teamId": "ABCDE12345",
            "plugins": ["@capacitor/filesystem@^8.1.2", "@capacitor/haptics@^8.0.2"]
        }
    }
}
```

## 4. 필드

| 필드 | 필수 | 타입 | 설명 | 서버에서의 쓰임 |
|---|---|---|---|---|
| `specVersion` | 필수 | 정수 | 명세 형식 버전. 현재 `1` | 모르는 버전이면 거부 |
| `app.id` | 필수 | 문자열 | 역도메인 형식 식별자. 예: `com.example.mygame` | iOS 번들 ID, Electron `appId` |
| `app.name` | 필수 | 문자열 | 표시 이름 | iOS 표시 이름, Electron `productName`, 산출물 파일명 |
| `app.version` | 필수 | 문자열 | `X.Y.Z` | iOS `MARKETING_VERSION`, Electron `version` |
| `source.webDir` | 필수 | 문자열 | 앱에 담을 정적 웹 자산 디렉토리. zip 루트 기준 상대 경로. `index.html` 필수 | Electron 앱 내용, Capacitor `www` |
| `targets` | 필수 | 객체 | 플랫폼 키 → 설정 객체. 키는 `macos`, `ios`. 최소 1개 | 빌드할 플랫폼 결정 |
| `targets.macos` | 선택 | 객체 | 현재 옵션 없음. `{}` | Electron 빌드 |
| `targets.ios.teamId` | 필수(ios 존재 시) | 문자열 | Apple Developer Team ID (10자) | Xcode 자동 서명 |
| `targets.ios.plugins` | 선택 | 문자열 배열 | 웹 코드가 사용하는 Capacitor 플러그인의 npm 패키지 스펙. 기본값 `[]` | 생성한 iOS 프로젝트에 네이티브 플러그인 설치 |

`targets.ios.plugins` 를 기본 항목에 넣은 이유: my-diabetes-notes 가 `@capacitor/filesystem`, `@capacitor/haptics`, `@capacitor/local-notifications` 를 쓴다. 웹 번들에는 JS 쪽만 들어 있고 네이티브 쪽은 iOS 프로젝트에 설치돼야 동작한다. Android 를 추가하면 공통 항목으로 옮길 수 있다.

산출물 파일명: `<name>-<version>-<platform>.<ext>` (name 의 공백은 `-` 로 치환). 예: `My-Game-1.2.3-macos.dmg`, `My-Game-1.2.3-ios.ipa`

## 5. 옵션 없이 고정된 기본 동작

옵션이 없는 항목은 아래처럼 동작한다. 바꿀 필요가 생기면 그때 옵션을 추가한다.

**macOS (Electron)**
- `webDir` 의 `index.html` 을 여는 창 하나. 1280x720, 크기 조절 가능
- 산출물 `.dmg`, 서버 호스트 아키텍처 기준
- 서명 없음, Electron 기본 아이콘

**iOS (Capacitor + Xcode)**
- Capacitor 8 로 iOS 프로젝트 생성, `webDir` 을 `www` 로 복사
- Xcode 자동 서명 (`-allowProvisioningUpdates`). 서버 Mac 의 Xcode 에 해당 팀의 Apple ID 로그인 필요
- export method `app-store-connect` (기존 my-diabetes-notes 흐름과 동일. TestFlight 업로드용)
- 빌드 번호(`CURRENT_PROJECT_VERSION`)는 `1`. TestFlight 업로드를 붙일 때 옵션으로 추가
- 화면 방향 전체 허용, Capacitor 기본 아이콘과 스플래시

## 6. 검증 규칙

서버는 빌드 시작 전에 아래를 검사하고, 실패하면 작업을 만들지 않고 오류 목록을 돌려준다.

1. JSON 파싱 가능, `specVersion` 이 `1`
2. `app.id`, `app.name`, `app.version` 존재, `app.version` 이 `X.Y.Z`
3. `source.webDir` 가 존재하고 `index.html` 이 있으며 zip 루트를 벗어나지 않음
4. `targets` 가 비어 있지 않고 알 수 없는 키가 없음
5. `targets.ios` 가 있으면 `teamId` 존재, `plugins` 가 있으면 문자열 배열

## 7. 추후 옵션 후보 (필요해질 때 하나씩)

- 공통: `app.buildNumber`, 아이콘/스플래시 이미지, 소스 전체를 받아 서버에서 웹 빌드까지 수행(`source.buildCommand`)
- macOS: 창 크기/전체 화면, `zip` 형식, `universal` 아키텍처, 서명/공증
- iOS: `exportMethod`(development, ad-hoc), 화면 방향, 최소 iOS 버전, 수동 서명, Info.plist 항목, Capacitor 버전 지정, TestFlight 업로드
- 다른 플랫폼: `android`, `windows`, `linux`, `web`
