#!/bin/sh
#=================================================================================
# vanilla-builder 를 launchd 사용자 에이전트로 등록한다.
# 로그인하면 자동으로 뜨고, 어떤 이유로든 죽으면 다시 뜬다.
# 이미 등록돼 있으면 내렸다가 다시 올리므로, 코드를 바꾼 뒤 재시작 용도로도 쓴다.
#
# 사용법 (어디서 실행해도 된다):
#   sh scripts/install.sh
#=================================================================================
set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.ddukbaek2.vanilla-builder"
LAUNCH_AGENTS_DIRECTORY="${HOME}/Library/LaunchAgents"
PLIST_PATH="${LAUNCH_AGENTS_DIRECTORY}/${LABEL}.plist"
LOG_DIRECTORY="${HOME}/Library/Logs/vanilla-builder"
USER_ID="$(id -u)"

NODE_BINARY="$(command -v node || true)"
if [ -z "${NODE_BINARY}" ]
then
	echo "[설치] node 를 찾을 수 없습니다. Node.js 22 이상을 설치하세요."
	exit 1
fi
NODE_DIRECTORY="$(dirname "${NODE_BINARY}")"

mkdir -p "${LAUNCH_AGENTS_DIRECTORY}" "${LOG_DIRECTORY}"

# 이미 올라가 있으면 내린다. (없으면 조용히 넘어간다)
# bootout 은 비동기라 곧바로 bootstrap 하면 실패할 수 있어, 내려갈 때까지 기다린다.
launchctl bootout "gui/${USER_ID}/${LABEL}" 2>/dev/null || true
WAIT_COUNT=0
while launchctl print "gui/${USER_ID}/${LABEL}" >/dev/null 2>&1
do
	WAIT_COUNT=$((WAIT_COUNT + 1))
	if [ "${WAIT_COUNT}" -ge 20 ]
	then
		echo "[설치] 이전 서비스가 내려가지 않습니다."
		exit 1
	fi
	sleep 0.5
done

cat > "${PLIST_PATH}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${NODE_BINARY}</string>
		<string>${PROJECT_ROOT}/src/main.js</string>
	</array>
	<key>WorkingDirectory</key>
	<string>${PROJECT_ROOT}</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>${NODE_DIRECTORY}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
	</dict>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>${LOG_DIRECTORY}/server.log</string>
	<key>StandardErrorPath</key>
	<string>${LOG_DIRECTORY}/server.log</string>
</dict>
</plist>
PLIST

launchctl bootstrap "gui/${USER_ID}" "${PLIST_PATH}"
echo "[설치] 등록 완료: ${LABEL}"

#=================================================================================
# 메뉴 막대 아이콘. (docs/06-menubar.md) swiftc 가 없으면 건너뛴다.
#=================================================================================
MENUBAR_LABEL="${LABEL}.menubar"
MENUBAR_PLIST_PATH="${LAUNCH_AGENTS_DIRECTORY}/${MENUBAR_LABEL}.plist"
MENUBAR_BINARY="${HOME}/.vanilla-builder/bin/vanilla-builder-menubar"
MENUBAR_ICON="${PROJECT_ROOT}/public/icon.png"

if command -v swiftc >/dev/null 2>&1
then
	mkdir -p "$(dirname "${MENUBAR_BINARY}")"
	echo "[설치] 메뉴 막대 앱 컴파일 중..."
	swiftc -O -o "${MENUBAR_BINARY}" "${PROJECT_ROOT}/menubar/main.swift"

	launchctl bootout "gui/${USER_ID}/${MENUBAR_LABEL}" 2>/dev/null || true
	WAIT_COUNT=0
	while launchctl print "gui/${USER_ID}/${MENUBAR_LABEL}" >/dev/null 2>&1
	do
		WAIT_COUNT=$((WAIT_COUNT + 1))
		if [ "${WAIT_COUNT}" -ge 20 ]
		then
			echo "[설치] 이전 메뉴 막대 앱이 내려가지 않습니다."
			exit 1
		fi
		sleep 0.5
	done

	cat > "${MENUBAR_PLIST_PATH}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${MENUBAR_LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${MENUBAR_BINARY}</string>
		<string>${MENUBAR_ICON}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>${LOG_DIRECTORY}/menubar.log</string>
	<key>StandardErrorPath</key>
	<string>${LOG_DIRECTORY}/menubar.log</string>
</dict>
</plist>
PLIST

	launchctl bootstrap "gui/${USER_ID}" "${MENUBAR_PLIST_PATH}"
	echo "[설치] 메뉴 막대 아이콘 등록 완료: ${MENUBAR_LABEL}"
else
	echo "[설치] swiftc 가 없어 메뉴 막대 아이콘은 건너뜁니다. (Xcode 설치 후 다시 실행)"
fi

echo "[설치] 상태 확인: launchctl print gui/${USER_ID}/${LABEL}"
echo "[설치] 서버 로그: ${LOG_DIRECTORY}/server.log"
echo "[설치] 현황 페이지: http://localhost:<포트> (기본 8686, 설정은 ~/.vanilla-builder/settings.json)"
