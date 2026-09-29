# 08. 랜딩 페이지

작성일: 2026-09-30
상태: 초안

## 1. 요구사항 (확정)

- 소개용 랜딩 페이지를 NAS 의 `\\DS216PLUSII\web\ddukbaek2\publish\vanilla-builder` 에 둔다. (이 Mac 에서는 `/Volumes/web/ddukbaek2/publish/vanilla-builder`, 공개 주소는 `https://ddukbaek2.com/publish/vanilla-builder/`)
- 페이지에서 **macOS 버전을 내려받을 수** 있어야 한다.
- GitHub 주소(`https://github.com/ddukbaek2/vanilla-builder`, 공개 저장소)를 넣는다.

## 2. 구성

- 원본은 이 저장소의 `landing/index.html` 이며, `scripts/publish.sh` 가 아래를 NAS 로 복사한다.

```
publish/vanilla-builder/
  index.html
  images/icon.png, screenshot-jobs.png
  download/vanilla-builder-macos.zip      서버 소스 배포판 (unzip 후 sh scripts/install.sh)
  download/vanilla-pack.mjs               클라이언트 도구
```

- macOS 배포판은 저장소에서 `node_modules`, `.env`, `.logs`, `artwork`(1024 원본은 포함), `.vscode`, `.claude` 를 뺀 zip 이다. 설치는 `sh scripts/install.sh` 한 번이다.
- 페이지는 treenote 랜딩과 같은 톤(시스템 폰트, 밝은/어두운 모드 자동)에 바닐라 캐러멜 강조색을 쓴다. 내용: 소개, 스크린샷, 특징, 동작 방식, 설치 방법, 클라이언트, GitHub.

## 3. 갱신

`sh scripts/publish.sh` 를 다시 실행하면 zip 과 페이지를 새로 복사한다.
