#!/bin/sh
#=================================================================================
# 랜딩 페이지와 macOS 배포판을 NAS 에 올린다. (docs/08-landing.md)
#
#   publish/vanilla-builder/index.html, images/, download/vanilla-builder-macos.zip, download/vanilla-pack.mjs
#
# 사용법:
#   sh scripts/publish.sh
#=================================================================================
set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUBLISH_ROOT="/Volumes/web/ddukbaek2/publish"
TARGET_DIRECTORY="${PUBLISH_ROOT}/vanilla-builder"
DISTRIBUTION_NAME="vanilla-builder-macos.zip"
STAGING_DIRECTORY="$(mktemp -d)"

if [ ! -d "${PUBLISH_ROOT}" ]
then
	echo "[publish] NAS 가 마운트돼 있지 않습니다: ${PUBLISH_ROOT}"
	exit 1
fi

# 배포판: 저장소에서 개발/비밀 파일을 뺀 zip. 최상위 폴더 이름은 vanilla-builder.
mkdir -p "${STAGING_DIRECTORY}/vanilla-builder"
rsync -a \
	--exclude "node_modules/" \
	--exclude ".env" \
	--exclude ".logs/" \
	--exclude ".vscode/" \
	--exclude ".claude/" \
	--exclude ".git/" \
	--exclude ".DS_Store" \
	--exclude "artwork/icon-candidate-*.png" \
	"${PROJECT_ROOT}/" "${STAGING_DIRECTORY}/vanilla-builder/"
(cd "${STAGING_DIRECTORY}" && zip -q -r "${DISTRIBUTION_NAME}" vanilla-builder)

mkdir -p "${TARGET_DIRECTORY}/images" "${TARGET_DIRECTORY}/download"
cp "${PROJECT_ROOT}/landing/index.html" "${TARGET_DIRECTORY}/index.html"
cp "${PROJECT_ROOT}/landing/images/"* "${TARGET_DIRECTORY}/images/"
cp "${STAGING_DIRECTORY}/${DISTRIBUTION_NAME}" "${TARGET_DIRECTORY}/download/${DISTRIBUTION_NAME}"
cp "${PROJECT_ROOT}/client/vanilla-pack.mjs" "${TARGET_DIRECTORY}/download/vanilla-pack.mjs"
rm -rf "${STAGING_DIRECTORY}"

echo "[publish] 완료: ${TARGET_DIRECTORY}"
echo "[publish] 공개 주소: https://ddukbaek2.com/publish/vanilla-builder/"
ls -la "${TARGET_DIRECTORY}" "${TARGET_DIRECTORY}/download"
