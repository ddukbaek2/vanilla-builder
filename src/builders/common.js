//==============================================================================
// 포함 모듈 목록.
//==============================================================================
const System = globalThis;
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";


//==============================================================================
// 웹 자산 복사에서 빼는 파일.
//==============================================================================
const IGNORED_FILENAMES = [".DS_Store", "Thumbs.db"];


//==============================================================================
// 웹 자산을 통째로 복사한다. 대상이 이미 있으면 비우고 복사한다.
//==============================================================================
/**
 * @param { string } sourceDirectory
 * @param { string } destinationDirectory
 */
export function copyWebAssets(sourceDirectory, destinationDirectory) {
	NodeFs.rmSync(destinationDirectory, { recursive: true, force: true });
	NodeFs.cpSync(sourceDirectory, destinationDirectory, {
		recursive: true,
		filter: (sourcePath) => {
			const baseName = NodePath.basename(sourcePath);
			return !IGNORED_FILENAMES.includes(baseName);
		},
	});
}


//==============================================================================
// 산출물 파일명. <name>-<version>-<platform>.<ext> (name 의 공백은 - 로)
//==============================================================================
/**
 * @param { object } spec
 * @param { string } platform
 * @param { string } extension 점 없이
 * @returns { string }
 */
export function artifactFilename(spec, platform, extension) {
	const name = spec.app.name.trim().replace(/\s+/g, "-");
	return `${name}-${spec.app.version}-${platform}.${extension}`;
}


//==============================================================================
// 생성하는 네이티브 프로젝트의 package.json 이름. 소문자 케밥케이스, 비면 app.
//==============================================================================
/**
 * @param { object } spec
 * @returns { string }
 */
export function packageNameFor(spec) {
	const kebab = spec.app.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
	return kebab === "" ? "app" : kebab;
}


//==============================================================================
// 디렉토리에서 확장자가 맞는 첫 파일. 없으면 null.
//==============================================================================
/**
 * @param { string } directory
 * @param { string } extension 점 없이
 * @returns { string | null }
 */
export function findFileByExtension(directory, extension) {
	if (!NodeFs.existsSync(directory)) {
		return null;
	}
	const entries = NodeFs.readdirSync(directory);
	for (const entry of entries) {
		if (entry.endsWith(`.${extension}`)) {
			return NodePath.join(directory, entry);
		}
	}
	return null;
}


//==============================================================================
// node_modules/.bin 안의 실행 파일 경로.
//==============================================================================
/**
 * @param { string } buildDirectory
 * @param { string } binaryName
 * @returns { string }
 */
export function localBinaryPath(buildDirectory, binaryName) {
	return NodePath.join(buildDirectory, "node_modules", ".bin", binaryName);
}


//==============================================================================
// JSON 파일 쓰기. (탭 들여쓰기)
//==============================================================================
/**
 * @param { string } filePath
 * @param { object } record
 */
export function writeJsonFile(filePath, record) {
	const recordText = System.JSON.stringify(record, null, "\t");
	NodeFs.writeFileSync(filePath, `${recordText}\n`, "utf8");
}
