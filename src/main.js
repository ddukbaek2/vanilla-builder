//==============================================================================
// 포함 모듈 목록.
//==============================================================================
const System = globalThis;
import * as NodePath from "node:path";
import * as NodeOs from "node:os";
import { Settings } from "./settings.js";
import { JobQueue } from "./jobqueue.js";
import { HttpServer } from "./httpserver.js";
import { MacosBuilder } from "./builders/macosbuilder.js";
import { IosBuilder } from "./builders/iosbuilder.js";


//==============================================================================
// 홈 디렉토리(설정과 서버 상태, 고정)와 현황 페이지 위치.
//==============================================================================
const homeDirectory = NodePath.join(NodeOs.homedir(), ".vanilla-builder");
const publicDirectory = NodePath.resolve(import.meta.dirname, "..", "public");


//==============================================================================
// 플랫폼별 빌더. 키가 명세 targets 에서 허용되는 플랫폼 이름이다. (docs/03-build-runner.md)
//==============================================================================
const builders = {
	macos: new MacosBuilder(),
	ios: new IosBuilder(),
};


//==============================================================================
// 진입점.
//==============================================================================
async function main() {
	const settings = new Settings(homeDirectory);
	settings.load();
	const jobQueue = new JobQueue(settings, builders);
	jobQueue.restore();
	const port = settings.getPort();
	const httpServer = new HttpServer(port, jobQueue, publicDirectory);
	await httpServer.start();
	const workspaceDirectory = settings.getWorkspaceDirectory();
	console.log(`[server] 홈: ${homeDirectory}`);
	console.log(`[server] 워크스페이스: ${workspaceDirectory}`);

	let shuttingDown = false;
	const shutdown = async (signalName) => {
		if (shuttingDown) {
			return;
		}
		shuttingDown = true;
		console.log(`[server] ${signalName} 수신. 실행 중인 빌드를 끊고 종료합니다.`);
		await jobQueue.shutdown();
		await httpServer.stop();
		System.process.exit(0);
	};
	System.process.on("SIGTERM", () => {
		shutdown("SIGTERM");
	});
	System.process.on("SIGINT", () => {
		shutdown("SIGINT");
	});
}


main().catch((startError) => {
	console.error(`[server] 기동 실패: ${startError.message}`);
	System.process.exit(1);
});
