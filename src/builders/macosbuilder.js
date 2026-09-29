//==============================================================================
// 포함 모듈 목록.
//==============================================================================
const System = globalThis;
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";
import { ELECTRON_VERSION, ELECTRON_BUILDER_VERSION } from "./toolversions.js";
import { copyWebAssets, artifactFilename, packageNameFor, findFileByExtension, localBinaryPath, writeJsonFile } from "./common.js";


//==============================================================================
// 고정 기본 동작. (docs/01-build-spec.md 5절) 바꿀 필요가 생기면 명세 옵션으로 뺀다.
//==============================================================================
const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 720;
const OUTPUT_DIRECTORY_NAME = "out";
const APP_DIRECTORY_NAME = "app";


//==============================================================================
// Electron 진입점 템플릿. webDir 의 index.html 을 여는 창 하나.
//==============================================================================
const MAIN_JS_TEMPLATE = `const { app, BrowserWindow } = require("electron");

function createWindow() {
	const mainWindow = new BrowserWindow({
		width: ${WINDOW_WIDTH},
		height: ${WINDOW_HEIGHT},
		resizable: true,
	});
	mainWindow.loadFile("${APP_DIRECTORY_NAME}/index.html");
}

app.whenReady().then(() => {
	createWindow();
});

app.on("window-all-closed", () => {
	app.quit();
});
`;


//==============================================================================
// macOS 빌더. (Electron + electron-builder → .dmg)
//
// prepare: 래퍼 생성, 웹 자산 복사, npm install
// build:   electron-builder --mac (서명 없음, 호스트 아키텍처)
// deliver: out/*.dmg → artifacts/
//==============================================================================
export class MacosBuilder {
	//==============================================================================
	// 래퍼 파일 생성. (package.json, main.js, app/) 명령은 실행하지 않는다.
	//==============================================================================
	/**
	 * @param { object } context
	 */
	writeProject(context) {
		const spec = context.spec;
		const buildDirectory = context.buildDirectory;
		const packageName = packageNameFor(spec);
		const packageRecord = {
			name: packageName,
			version: spec.app.version,
			private: true,
			main: "main.js",
			devDependencies: {
				"electron": ELECTRON_VERSION,
				"electron-builder": ELECTRON_BUILDER_VERSION,
			},
			build: {
				appId: spec.app.id,
				productName: spec.app.name,
				mac: {
					target: [{ target: "dmg", arch: [System.process.arch] }],
					identity: null,
				},
				files: ["main.js", `${APP_DIRECTORY_NAME}/**`],
				directories: { output: OUTPUT_DIRECTORY_NAME },
			},
		};
		writeJsonFile(NodePath.join(buildDirectory, "package.json"), packageRecord);
		NodeFs.writeFileSync(NodePath.join(buildDirectory, "main.js"), MAIN_JS_TEMPLATE, "utf8");
		copyWebAssets(context.webDirectory, NodePath.join(buildDirectory, APP_DIRECTORY_NAME));
	}

	//==============================================================================
	// prepare 단계.
	//==============================================================================
	/**
	 * @param { object } context
	 */
	async prepare(context) {
		this.writeProject(context);
		await context.runner.run("npm", ["install", "--no-audit", "--no-fund"], { cwd: context.buildDirectory });
	}

	//==============================================================================
	// build 단계. Keychain 인증서를 자동으로 집어 서명하려는 동작을 막는다.
	//==============================================================================
	/**
	 * @param { object } context
	 */
	async build(context) {
		const electronBuilder = localBinaryPath(context.buildDirectory, "electron-builder");
		const environment = { ...System.process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" };
		await context.runner.run(electronBuilder, ["--mac", "--publish", "never"], { cwd: context.buildDirectory, env: environment });
	}

	//==============================================================================
	// deliver 단계.
	//==============================================================================
	/**
	 * @param { object } context
	 */
	async deliver(context) {
		const outputDirectory = NodePath.join(context.buildDirectory, OUTPUT_DIRECTORY_NAME);
		const dmgPath = findFileByExtension(outputDirectory, "dmg");
		if (dmgPath === null) {
			throw new System.Error(`${OUTPUT_DIRECTORY_NAME}/ 에 .dmg 가 없습니다.`);
		}
		const filename = artifactFilename(context.spec, context.platform, "dmg");
		NodeFs.copyFileSync(dmgPath, NodePath.join(context.artifactsDirectory, filename));
		context.job.addArtifact(filename);
	}
}
