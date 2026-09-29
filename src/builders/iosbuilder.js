//==============================================================================
// 포함 모듈 목록.
//==============================================================================
const System = globalThis;
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";
import { CAPACITOR_VERSION } from "./toolversions.js";
import { copyWebAssets, artifactFilename, packageNameFor, findFileByExtension, localBinaryPath, writeJsonFile } from "./common.js";


//==============================================================================
// 고정 기본 동작. (docs/01-build-spec.md 5절) 바꿀 필요가 생기면 명세 옵션으로 뺀다.
//==============================================================================
const EXPORT_METHOD = "app-store-connect";
const OUTPUT_DIRECTORY_NAME = "out";
const WWW_DIRECTORY_NAME = "www";
const XCODE_PROJECT_RELATIVE_PATH = NodePath.join("ios", "App", "App.xcodeproj");
const XCODE_SCHEME = "App";


//==============================================================================
// iOS 빌더. (Capacitor + Xcode → .ipa)
//
// prepare: Capacitor 프로젝트 생성(SPM), 웹 자산 복사, npm install, cap add ios, cap sync ios
// build:   xcodebuild archive (자동 서명, 팀 ID 필수) → exportArchive
// deliver: out/*.ipa → artifacts/
// 명령 순서와 서명 옵션은 my-diabetes-notes 의 buildipa.cjs 에서 검증된 것을 옮겼다.
//==============================================================================
export class IosBuilder {
	//==============================================================================
	// 프로젝트 파일 생성. (package.json, capacitor.config.json, www/) 명령은 실행하지 않는다.
	//==============================================================================
	/**
	 * @param { object } context
	 */
	writeProject(context) {
		const spec = context.spec;
		const buildDirectory = context.buildDirectory;
		const iosOptions = spec.targets.ios;
		const packageName = packageNameFor(spec);

		const dependencies = {
			"@capacitor/core": CAPACITOR_VERSION,
			"@capacitor/ios": CAPACITOR_VERSION,
		};
		const plugins = iosOptions.plugins === undefined ? [] : iosOptions.plugins;
		for (const plugin of plugins) {
			const parsed = parsePluginSpec(plugin);
			dependencies[parsed.name] = parsed.version;
		}
		const packageRecord = {
			name: packageName,
			version: spec.app.version,
			private: true,
			dependencies: dependencies,
			devDependencies: {
				"@capacitor/cli": CAPACITOR_VERSION,
			},
		};
		writeJsonFile(NodePath.join(buildDirectory, "package.json"), packageRecord);

		const capacitorConfig = {
			appId: spec.app.id,
			appName: spec.app.name,
			webDir: WWW_DIRECTORY_NAME,
			ios: {
				contentInset: "never",
				scrollEnabled: false,
			},
		};
		writeJsonFile(NodePath.join(buildDirectory, "capacitor.config.json"), capacitorConfig);
		copyWebAssets(context.webDirectory, NodePath.join(buildDirectory, WWW_DIRECTORY_NAME));
	}

	//==============================================================================
	// ExportOptions.plist 생성.
	//==============================================================================
	/**
	 * @param { string } buildDirectory
	 * @param { string } teamId
	 * @returns { string } 생성한 파일 경로
	 */
	writeExportOptions(buildDirectory, teamId) {
		const exportOptionsPath = NodePath.join(buildDirectory, "ExportOptions.plist");
		const exportOptionsContent = [
			`<?xml version="1.0" encoding="UTF-8"?>`,
			`<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
			`<plist version="1.0">`,
			`<dict>`,
			`	<key>method</key>`,
			`	<string>${EXPORT_METHOD}</string>`,
			`	<key>teamID</key>`,
			`	<string>${teamId}</string>`,
			`	<key>signingStyle</key>`,
			`	<string>automatic</string>`,
			`	<key>destination</key>`,
			`	<string>export</string>`,
			`	<key>stripSwiftSymbols</key>`,
			`	<true/>`,
			`	<key>uploadSymbols</key>`,
			`	<true/>`,
			`</dict>`,
			`</plist>`,
			``,
		].join("\n");
		NodeFs.writeFileSync(exportOptionsPath, exportOptionsContent, "utf8");
		return exportOptionsPath;
	}

	//==============================================================================
	// prepare 단계.
	//==============================================================================
	/**
	 * @param { object } context
	 */
	async prepare(context) {
		const buildDirectory = context.buildDirectory;
		this.writeProject(context);
		await context.runner.run("npm", ["install", "--no-audit", "--no-fund"], { cwd: buildDirectory });
		const capacitorCli = localBinaryPath(buildDirectory, "cap");
		await context.runner.run(capacitorCli, ["add", "ios", "--packagemanager", "SPM"], { cwd: buildDirectory });
		await context.runner.run(capacitorCli, ["sync", "ios"], { cwd: buildDirectory });
	}

	//==============================================================================
	// build 단계. 팀 ID 를 반드시 함께 넘긴다. (개인 팀이 선점되는 사고 방지)
	//==============================================================================
	/**
	 * @param { object } context
	 */
	async build(context) {
		const buildDirectory = context.buildDirectory;
		const spec = context.spec;
		const teamId = spec.targets.ios.teamId;
		const xcodeProjectPath = NodePath.join(buildDirectory, XCODE_PROJECT_RELATIVE_PATH);
		const outputDirectory = NodePath.join(buildDirectory, OUTPUT_DIRECTORY_NAME);
		const archivePath = NodePath.join(outputDirectory, "App.xcarchive");
		const derivedDataPath = NodePath.join(outputDirectory, "DerivedData");
		const exportOptionsPath = this.writeExportOptions(buildDirectory, teamId);

		await context.runner.run("xcodebuild", [
			"-project", xcodeProjectPath,
			"-scheme", XCODE_SCHEME,
			"-configuration", "Release",
			"-destination", "generic/platform=iOS",
			"-archivePath", archivePath,
			"-derivedDataPath", derivedDataPath,
			"clean", "archive",
			"-allowProvisioningUpdates",
			`DEVELOPMENT_TEAM=${teamId}`,
			"CODE_SIGN_STYLE=Automatic",
			`MARKETING_VERSION=${spec.app.version}`,
		], { cwd: buildDirectory });

		await context.runner.run("xcodebuild", [
			"-exportArchive",
			"-archivePath", archivePath,
			"-exportPath", outputDirectory,
			"-exportOptionsPlist", exportOptionsPath,
			"-allowProvisioningUpdates",
		], { cwd: buildDirectory });
	}

	//==============================================================================
	// deliver 단계.
	//==============================================================================
	/**
	 * @param { object } context
	 */
	async deliver(context) {
		const outputDirectory = NodePath.join(context.buildDirectory, OUTPUT_DIRECTORY_NAME);
		const ipaPath = findFileByExtension(outputDirectory, "ipa");
		if (ipaPath === null) {
			throw new System.Error(`${OUTPUT_DIRECTORY_NAME}/ 에 .ipa 가 없습니다.`);
		}
		const filename = artifactFilename(context.spec, context.platform, "ipa");
		NodeFs.copyFileSync(ipaPath, NodePath.join(context.artifactsDirectory, filename));
		context.job.addArtifact(filename);
	}
}


//==============================================================================
// "@capacitor/haptics@^8.0.2" → { name, version }. 버전이 없으면 latest.
//==============================================================================
/**
 * @param { string } pluginSpec
 * @returns { { name: string, version: string } }
 */
function parsePluginSpec(pluginSpec) {
	const atIndex = pluginSpec.lastIndexOf("@");
	if (atIndex > 0) {
		return { name: pluginSpec.slice(0, atIndex), version: pluginSpec.slice(atIndex + 1) };
	}
	return { name: pluginSpec, version: "latest" };
}
