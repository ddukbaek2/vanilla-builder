//==============================================================================
// 포함 모듈 목록.
//==============================================================================
const System = globalThis;
import { test } from "node:test";
import * as Assert from "node:assert/strict";
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";
import * as NodeOs from "node:os";
import { MacosBuilder } from "../src/builders/macosbuilder.js";
import { IosBuilder } from "../src/builders/iosbuilder.js";
import { artifactFilename, packageNameFor } from "../src/builders/common.js";


//==============================================================================
// 명령을 실행하지 않고 파일 생성과 산출물 전달만 검증할 컨텍스트를 만든다.
//==============================================================================
function createContext(spec, platform) {
	const rootDirectory = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "vanilla-builder-builder-"));
	const webDirectory = NodePath.join(rootDirectory, "web");
	const buildDirectory = NodePath.join(rootDirectory, "build", platform);
	const artifactsDirectory = NodePath.join(rootDirectory, "artifacts");
	NodeFs.mkdirSync(NodePath.join(webDirectory, "images"), { recursive: true });
	NodeFs.mkdirSync(buildDirectory, { recursive: true });
	NodeFs.mkdirSync(artifactsDirectory, { recursive: true });
	NodeFs.writeFileSync(NodePath.join(webDirectory, "index.html"), "<title>x</title>", "utf8");
	NodeFs.writeFileSync(NodePath.join(webDirectory, "images", "a.png"), "png", "utf8");
	NodeFs.writeFileSync(NodePath.join(webDirectory, ".DS_Store"), "junk", "utf8");
	const artifacts = [];
	const context = {
		job: {
			addArtifact(filename) {
				artifacts.push(filename);
			},
		},
		spec: spec,
		platform: platform,
		runner: null,
		projectDirectory: rootDirectory,
		webDirectory: webDirectory,
		buildDirectory: buildDirectory,
		artifactsDirectory: artifactsDirectory,
	};
	return { context: context, artifacts: artifacts, rootDirectory: rootDirectory };
}


function readJson(filePath) {
	const text = NodeFs.readFileSync(filePath, "utf8");
	return System.JSON.parse(text);
}


test("공통: 산출물 파일명과 패키지 이름 규칙", () => {
	const spec = { app: { id: "com.example.x", name: "My  Game", version: "1.2.3" } };
	Assert.equal(artifactFilename(spec, "macos", "dmg"), "My-Game-1.2.3-macos.dmg");
	Assert.equal(packageNameFor(spec), "my-game");
	const koreanSpec = { app: { id: "com.example.y", name: "나의 당뇨일지", version: "0.1.2" } };
	Assert.equal(artifactFilename(koreanSpec, "ios", "ipa"), "나의-당뇨일지-0.1.2-ios.ipa");
	Assert.equal(packageNameFor(koreanSpec), "app");
});


test("macOS 빌더: 래퍼 파일을 만들고 웹 자산을 복사하며 dmg 를 산출물로 넘긴다", async () => {
	const spec = {
		specVersion: 1,
		app: { id: "com.example.mygame", name: "My Game", version: "1.2.3" },
		source: { webDir: "web" },
		targets: { macos: {} },
	};
	const fixture = createContext(spec, "macos");
	try {
		const builder = new MacosBuilder();
		builder.writeProject(fixture.context);

		const buildDirectory = fixture.context.buildDirectory;
		const packageRecord = readJson(NodePath.join(buildDirectory, "package.json"));
		Assert.equal(packageRecord.name, "my-game");
		Assert.equal(packageRecord.version, "1.2.3");
		Assert.equal(packageRecord.main, "main.js");
		Assert.ok(packageRecord.devDependencies.electron);
		Assert.ok(packageRecord.devDependencies["electron-builder"]);
		Assert.equal(packageRecord.build.appId, "com.example.mygame");
		Assert.equal(packageRecord.build.productName, "My Game");
		Assert.equal(packageRecord.build.mac.identity, null);
		Assert.deepEqual(packageRecord.build.mac.target[0].arch, [System.process.arch]);
		const mainJs = NodeFs.readFileSync(NodePath.join(buildDirectory, "main.js"), "utf8");
		Assert.ok(mainJs.includes("loadFile(\"app/index.html\")"));
		Assert.ok(NodeFs.existsSync(NodePath.join(buildDirectory, "app", "index.html")));
		Assert.ok(NodeFs.existsSync(NodePath.join(buildDirectory, "app", "images", "a.png")));
		Assert.ok(!NodeFs.existsSync(NodePath.join(buildDirectory, "app", ".DS_Store")), ".DS_Store 는 복사하지 않는다");

		await Assert.rejects(builder.deliver(fixture.context), /\.dmg 가 없습니다/);
		const outputDirectory = NodePath.join(buildDirectory, "out");
		NodeFs.mkdirSync(outputDirectory, { recursive: true });
		NodeFs.writeFileSync(NodePath.join(outputDirectory, "My Game-1.2.3-arm64.dmg"), "dmg", "utf8");
		await builder.deliver(fixture.context);
		Assert.deepEqual(fixture.artifacts, ["My-Game-1.2.3-macos.dmg"]);
		Assert.ok(NodeFs.existsSync(NodePath.join(fixture.context.artifactsDirectory, "My-Game-1.2.3-macos.dmg")));
	}
	finally {
		NodeFs.rmSync(fixture.rootDirectory, { recursive: true, force: true });
	}
});


test("iOS 빌더: Capacitor 프로젝트 파일과 플러그인 의존성, ExportOptions 를 만들고 ipa 를 산출물로 넘긴다", async () => {
	const spec = {
		specVersion: 1,
		app: { id: "com.example.notes", name: "나의 당뇨일지", version: "0.1.2" },
		source: { webDir: "web" },
		targets: { ios: { teamId: "ABCDE12345", plugins: ["@capacitor/haptics@^8.0.2", "@capacitor/filesystem"] } },
	};
	const fixture = createContext(spec, "ios");
	try {
		const builder = new IosBuilder();
		builder.writeProject(fixture.context);

		const buildDirectory = fixture.context.buildDirectory;
		const packageRecord = readJson(NodePath.join(buildDirectory, "package.json"));
		Assert.equal(packageRecord.name, "app");
		Assert.ok(packageRecord.dependencies["@capacitor/core"]);
		Assert.ok(packageRecord.dependencies["@capacitor/ios"]);
		Assert.equal(packageRecord.dependencies["@capacitor/haptics"], "^8.0.2");
		Assert.equal(packageRecord.dependencies["@capacitor/filesystem"], "latest");
		Assert.ok(packageRecord.devDependencies["@capacitor/cli"]);
		const capacitorConfig = readJson(NodePath.join(buildDirectory, "capacitor.config.json"));
		Assert.deepEqual(capacitorConfig, {
			appId: "com.example.notes",
			appName: "나의 당뇨일지",
			webDir: "www",
			ios: { contentInset: "never", scrollEnabled: false },
		});
		Assert.ok(NodeFs.existsSync(NodePath.join(buildDirectory, "www", "index.html")));

		const exportOptionsPath = builder.writeExportOptions(buildDirectory, "ABCDE12345");
		const exportOptions = NodeFs.readFileSync(exportOptionsPath, "utf8");
		Assert.ok(exportOptions.includes("<string>ABCDE12345</string>"));
		Assert.ok(exportOptions.includes("<string>app-store-connect</string>"));
		Assert.ok(exportOptions.includes("<string>automatic</string>"));

		await Assert.rejects(builder.deliver(fixture.context), /\.ipa 가 없습니다/);
		const outputDirectory = NodePath.join(buildDirectory, "out");
		NodeFs.mkdirSync(outputDirectory, { recursive: true });
		NodeFs.writeFileSync(NodePath.join(outputDirectory, "App.ipa"), "ipa", "utf8");
		await builder.deliver(fixture.context);
		Assert.deepEqual(fixture.artifacts, ["나의-당뇨일지-0.1.2-ios.ipa"]);
	}
	finally {
		NodeFs.rmSync(fixture.rootDirectory, { recursive: true, force: true });
	}
});
