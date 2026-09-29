#!/bin/sh
#=================================================================================
# vanilla-builder 의 launchd 등록을 해제한다. 워크스페이스와 로그는 남긴다.
#
# 사용법:
#   sh scripts/uninstall.sh
#=================================================================================
LABEL="com.ddukbaek2.vanilla-builder"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
USER_ID="$(id -u)"

MENUBAR_LABEL="${LABEL}.menubar"
MENUBAR_PLIST_PATH="${HOME}/Library/LaunchAgents/${MENUBAR_LABEL}.plist"

launchctl bootout "gui/${USER_ID}/${MENUBAR_LABEL}" 2>/dev/null || true
rm -f "${MENUBAR_PLIST_PATH}"
launchctl bootout "gui/${USER_ID}/${LABEL}" 2>/dev/null || true
rm -f "${PLIST_PATH}"

echo "[제거] 완료: ${LABEL}"
