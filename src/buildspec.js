//==============================================================================
// 포함 모듈 목록.
//==============================================================================
const System = globalThis;
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";


//==============================================================================
// 명세 파일 이름과 지원하는 명세 형식 버전.
//==============================================================================
export const BUILD_SPEC_FILENAME = "build-spec.json";
export const SUPPORTED_SPEC_VERSION = 1;


//==============================================================================
// 필드 형식.
//==============================================================================
const APP_ID_PATTERN = /^[A-Za-z0-9]+(\.[A-Za-z0-9-]+)+$/;
const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/;


//==============================================================================
// 프로젝트 디렉토리의 build-spec.json 을 읽고 검증한다.
//
// 검증 규칙은 docs/01-build-spec.md 6절을 따른다.
// 오류가 하나라도 있으면 spec 은 null 이고 errors 에 이유가 모두 담긴다.
//==============================================================================
/**
 * @param { string } projectDirectory zip 을 전개한 디렉토리
 * @param { string[] } supportedPlatforms 빌더가 등록된 플랫폼 이름 목록
 * @returns { { spec: object | null, errors: string[] } }
 */
export function loadBuildSpec(projectDirectory, supportedPlatforms) {
	const specPath = NodePath.join(projectDirectory, BUILD_SPEC_FILENAME);
	if (!NodeFs.existsSync(specPath)) {
		return { spec: null, errors: [`zip 루트에 ${BUILD_SPEC_FILENAME} 이 없습니다.`] };
	}

	let spec = null;
	try {
		const specText = NodeFs.readFileSync(specPath, "utf8");
		spec = System.JSON.parse(specText);
	}
	catch (parseError) {
		return { spec: null, errors: [`${BUILD_SPEC_FILENAME} 을 JSON 으로 읽을 수 없습니다: ${parseError.message}`] };
	}

	const errors = validateBuildSpec(spec, projectDirectory, supportedPlatforms);
	if (errors.length > 0) {
		return { spec: null, errors: errors };
	}
	return { spec: spec, errors: [] };
}


//==============================================================================
// 명세 검증. 오류 메시지 목록을 돌려준다. (비어 있으면 통과)
//==============================================================================
/**
 * @param { object } spec
 * @param { string } projectDirectory
 * @param { string[] } supportedPlatforms
 * @returns { string[] }
 */
export function validateBuildSpec(spec, projectDirectory, supportedPlatforms) {
	const errors = [];
	if (!isPlainObject(spec)) {
		errors.push("명세는 JSON 객체여야 합니다.");
		return errors;
	}
	if (spec.specVersion !== SUPPORTED_SPEC_VERSION) {
		errors.push(`specVersion 은 ${SUPPORTED_SPEC_VERSION} 이어야 합니다.`);
	}
	validateApp(spec.app, errors);
	validateSource(spec.source, projectDirectory, errors);
	validateTargets(spec.targets, supportedPlatforms, errors);
	return errors;
}


//==============================================================================
// app 항목 검증.
//==============================================================================
function validateApp(app, errors) {
	if (!isPlainObject(app)) {
		errors.push("app 항목이 없습니다.");
		return;
	}
	if (typeof app.id !== "string" || !APP_ID_PATTERN.test(app.id)) {
		errors.push("app.id 는 역도메인 형식(예: com.example.mygame)이어야 합니다.");
	}
	if (typeof app.name !== "string" || app.name.trim() === "") {
		errors.push("app.name 은 비어 있지 않은 문자열이어야 합니다.");
	}
	if (typeof app.version !== "string" || !APP_VERSION_PATTERN.test(app.version)) {
		errors.push("app.version 은 X.Y.Z 형식이어야 합니다.");
	}
}


//==============================================================================
// source 항목 검증. webDir 이 zip 루트 안에 있고 index.html 을 담고 있어야 한다.
//==============================================================================
function validateSource(source, projectDirectory, errors) {
	if (!isPlainObject(source)) {
		errors.push("source 항목이 없습니다.");
		return;
	}
	if (typeof source.webDir !== "string" || source.webDir.trim() === "") {
		errors.push("source.webDir 은 비어 있지 않은 문자열이어야 합니다.");
		return;
	}

	const projectRoot = NodePath.resolve(projectDirectory);
	const webDirectory = NodePath.resolve(projectRoot, source.webDir);
	const insideProject = webDirectory === projectRoot || webDirectory.startsWith(projectRoot + NodePath.sep);
	if (!insideProject) {
		errors.push("source.webDir 은 zip 루트 안을 가리켜야 합니다.");
		return;
	}
	if (!NodeFs.existsSync(webDirectory)) {
		errors.push(`source.webDir 디렉토리가 없습니다: ${source.webDir}`);
		return;
	}
	const webDirectoryStats = NodeFs.statSync(webDirectory);
	if (!webDirectoryStats.isDirectory()) {
		errors.push(`source.webDir 은 디렉토리여야 합니다: ${source.webDir}`);
		return;
	}
	const indexPath = NodePath.join(webDirectory, "index.html");
	if (!NodeFs.existsSync(indexPath)) {
		errors.push(`source.webDir 안에 index.html 이 없습니다: ${source.webDir}`);
	}
}


//==============================================================================
// targets 항목 검증. 빌더가 등록된 플랫폼만 허용한다.
//==============================================================================
function validateTargets(targets, supportedPlatforms, errors) {
	if (!isPlainObject(targets)) {
		errors.push("targets 항목이 없습니다.");
		return;
	}
	const platforms = System.Object.keys(targets);
	if (platforms.length === 0) {
		errors.push("targets 에 플랫폼이 하나 이상 있어야 합니다.");
		return;
	}
	for (const platform of platforms) {
		if (!supportedPlatforms.includes(platform)) {
			errors.push(`지원하지 않는 플랫폼입니다: ${platform}`);
			continue;
		}
		const targetOptions = targets[platform];
		if (!isPlainObject(targetOptions)) {
			errors.push(`targets.${platform} 은 객체여야 합니다.`);
			continue;
		}
		if (platform === "ios") {
			validateIosTarget(targetOptions, errors);
		}
	}
}


//==============================================================================
// targets.ios 검증.
//==============================================================================
function validateIosTarget(targetOptions, errors) {
	if (typeof targetOptions.teamId !== "string" || !TEAM_ID_PATTERN.test(targetOptions.teamId)) {
		errors.push("targets.ios.teamId 는 10자리 Apple Team ID 여야 합니다.");
	}
	if (targetOptions.plugins === undefined) {
		return;
	}
	if (!System.Array.isArray(targetOptions.plugins)) {
		errors.push("targets.ios.plugins 는 문자열 배열이어야 합니다.");
		return;
	}
	for (const plugin of targetOptions.plugins) {
		if (typeof plugin !== "string" || plugin.trim() === "") {
			errors.push("targets.ios.plugins 의 항목은 비어 있지 않은 문자열이어야 합니다.");
			return;
		}
	}
}


//==============================================================================
// 배열이 아닌 객체인지.
//==============================================================================
function isPlainObject(value) {
	return value !== null && typeof value === "object" && !System.Array.isArray(value);
}
