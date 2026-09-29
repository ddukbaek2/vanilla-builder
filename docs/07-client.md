# 07. 클라이언트 도구 (vanilla-pack)

작성일: 2026-09-30
상태: 초안 (기본)

## 1. 요구사항 (확정)

- 작업 PC(주로 Windows)에서 프로젝트를 빌드용으로 **아카이빙**하는 심플한 도구. `build-spec.json` 을 포함해 서버가 받는 zip 형식으로 묶는다.
- AI 가 curl 로 하던 일을 사람도 명령 한 줄로 할 수 있어야 한다.

## 2. 형태

`client/vanilla-pack.mjs` 파일 하나. Node.js 18 이상이면 어디서나 실행되고 외부 패키지가 없다. zip 은 Node 내장 zlib 로 직접 만든다(Windows 에 zip 명령이 없어도 된다). GUI 앱은 추후.

## 3. 명령

| 명령 | 하는 일 |
|---|---|
| `node vanilla-pack.mjs init [프로젝트]` | `build-spec.json` 초안을 만든다. `package.json` 의 이름/버전을 가져오고 `app.id`, `teamId` 는 자리표시자다. |
| `node vanilla-pack.mjs pack [프로젝트] [--web build/web] [--out project.zip]` | `build-spec.json` + 웹 빌드 결과물을 zip 으로 묶는다. zip 안에서는 웹 자산이 `web/` 이 되고 명세의 `source.webDir` 도 `web` 으로 맞춰 넣는다. |
| `node vanilla-pack.mjs send <서버주소> [프로젝트] [--targets macos,ios] [--out-dir dist]` | pack 한 뒤 서버에 보내고, 단계가 바뀔 때마다 출력하며 끝나면 산출물을 `dist/` 에 받는다. 실패하면 로그 마지막 40줄을 보여 준다. |

## 4. 전제

- 프로젝트에서 먼저 `npm run build` 로 `build/web` 을 만들어 둔다. (다른 위치면 `--web`)
- 프로젝트 루트에 `build-spec.json` 이 있어야 한다. 이 파일은 프로젝트와 함께 저장소에 두면 다음부터 명령 한 줄로 끝난다.

## 5. 추후

- 폴더를 끌어다 놓는 GUI(Electron 또는 웹 페이지에서 폴더 드롭 + 명세 폼)
