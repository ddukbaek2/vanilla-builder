# 05. 아이콘

작성일: 2026-09-30
상태: 초안 (웹 버전부터)

## 1. 목적

vanilla-builder 자체의 아이콘을 만든다. 먼저 **웹 버전**(현황 페이지의 파비콘과 머리말 로고)에 쓰고, 이후 같은 원본을 macOS/iOS 앱 아이콘에도 쓸 수 있게 1024x1024 원본을 남긴다.

## 2. 만드는 방법

- Gemini 이미지 생성 API(`gemini-2.5-flash-image`)를 REST 로 호출한다. scramble-heroes 의 `tools/gen_assets_gemini.py` 와 같은 방식이다.
- API 키는 프로젝트 루트 `.env` 의 `GOOGLE_GEMINI_V3_KEY` 에서 읽는다. (서버는 `.env` 를 읽지 않으며 이 스크립트만 읽는다)
- 스크립트: `python3 tools/gen_icon.py [--count N]`. 후보를 N 장(기본 3) 만들어 `artwork/icon-candidate-<n>.png` 에 두고, 1번 후보를 `artwork/icon-1024.png` 와 `public/icon.png`(256px) 로 저장한다. 다른 후보를 고르면 `--pick <n>` 으로 다시 저장한다.
- 후처리: 정사각형으로 맞추고 LANCZOS 로 리사이즈한다. 픽셀화나 투명화는 하지 않는다. (플랫 아이콘)

## 3. 컨셉

2026-09-30 두 번째 시안: 첫 플랫 시안이 허접하다는 평가라 macOS Big Sur 풍의 입체 렌더로 바꿨다. 크림색 광택 큐브에 민트 리본이 사선으로 감기고 황동 렌치가 기대어 있으며, 캐러멜에서 다크 초콜릿으로 떨어지는 배경이다. (후보 3번 채택)

첫 시안의 방향:

- 이름 그대로 "바닐라"와 "빌더". 바닐라 크림색 바탕에 조립 중인 블록(큐브)과 렌치 같은 단순한 도구 실루엣.
- 플랫 디자인, 굵은 실루엣, 글자 없음, 작은 크기(32px)에서도 읽히는 형태.
- 둥근 사각형 앱 아이콘 형태로 프레임을 가득 채운다.

## 4. 웹 적용

- `public/icon.png` 를 `GET /icon.png` 로 제공한다. (현황 페이지의 정적 파일 제공은 `public/` 안의 파일만, 하위 경로 없이)
- `index.html` 의 `<link rel="icon">` 과 머리말 로고 `<img>` 에 쓴다.

## 5. 추후

- macOS: `artwork/icon-1024.png` 를 Electron 빌드의 `icon` 으로 (명세 옵션 `targets.macos.icon`)
- iOS: 같은 원본을 `sips` 로 리사이즈해 Capacitor 아이콘 세트로 (명세 옵션 `targets.ios.icon`)
