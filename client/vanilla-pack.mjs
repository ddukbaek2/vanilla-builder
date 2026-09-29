#!/usr/bin/env node
//==============================================================================
// vanilla-builder 클라이언트. (docs/07-client.md)
//
// 프로젝트의 웹 빌드 결과물과 build-spec.json 을 zip 으로 묶고(pack),
// 빌드 서버에 보내 끝날 때까지 기다린 뒤 산출물을 내려받는다(send).
// Node.js 18 이상이면 어디서나 이 파일 하나로 동작한다. 외부 패키지 없음.
//
// 사용법:
//   node vanilla-pack.mjs pack [프로젝트경로] [--web build/web] [--out project.zip]
//   node vanilla-pack.mjs send <서버주소> [프로젝트경로] [--web build/web] [--targets macos,ios] [--out-dir dist]
//   node vanilla-pack.mjs init [프로젝트경로]        # build-spec.json 초안 생성
//
// 예:
//   node vanilla-pack.mjs send http://192.168.0.11:8686 . --targets macos
//==============================================================================
const System = globalThis;
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";
import * as NodeZlib from "node:zlib";


const SPEC_FILENAME = "build-spec.json";
const ZIP_WEB_DIRECTORY_NAME = "web";
const POLL_INTERVAL_MILLISECONDS = 3000;


//==============================================================================
// 인자 파싱. 위치 인자와 --키 값 옵션.
//==============================================================================
function parseArguments(argumentList) {
	const positional = [];
	const options = {};
	let index = 0;
	while (index < argumentList.length) {
		const argument = argumentList[index];
		if (argument.startsWith("--")) {
			const key = argument.slice(2);
			const value = argumentList[index + 1];
			options[key] = value;
			index += 2;
			continue;
		}
		positional.push(argument);
		index += 1;
	}
	return { positional: positional, options: options };
}


//==============================================================================
// CRC32. (zip 항목마다 필요)
//==============================================================================
const CRC_TABLE = new System.Uint32Array(256);
for (let tableIndex = 0; tableIndex < 256; tableIndex += 1) {
	let value = tableIndex;
	for (let bit = 0; bit < 8; bit += 1) {
		value = (value & 1) === 1 ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
	}
	CRC_TABLE[tableIndex] = value >>> 0;
}

function crc32(buffer) {
	let crc = 0xFFFFFFFF;
	for (const byte of buffer) {
		crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
	}
	return (crc ^ 0xFFFFFFFF) >>> 0;
}


//==============================================================================
// 파일 목록 수집. (상대 경로, 항상 / 구분자)
//==============================================================================
function collectFiles(rootDirectory, relativeDirectory, collected) {
	const absoluteDirectory = NodePath.join(rootDirectory, relativeDirectory);
	const entries = NodeFs.readdirSync(absoluteDirectory, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name === ".DS_Store" || entry.name === "Thumbs.db") {
			continue;
		}
		const relativePath = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
		if (entry.isDirectory()) {
			collectFiles(rootDirectory, relativePath, collected);
			continue;
		}
		collected.push(relativePath);
	}
}


//==============================================================================
// zip 만들기. 항목은 { name, data } 목록. deflate 로 압축한다.
//==============================================================================
function buildZip(entries) {
	const localParts = [];
	const centralParts = [];
	let offset = 0;
	const now = new System.Date();
	const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
	const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

	for (const entry of entries) {
		const nameBuffer = System.Buffer.from(entry.name, "utf8");
		const compressed = NodeZlib.deflateRawSync(entry.data);
		const checksum = crc32(entry.data);

		const localHeader = System.Buffer.alloc(30);
		localHeader.writeUInt32LE(0x04034B50, 0);
		localHeader.writeUInt16LE(20, 4);
		localHeader.writeUInt16LE(0x0800, 6);
		localHeader.writeUInt16LE(8, 8);
		localHeader.writeUInt16LE(dosTime, 10);
		localHeader.writeUInt16LE(dosDate, 12);
		localHeader.writeUInt32LE(checksum, 14);
		localHeader.writeUInt32LE(compressed.length, 18);
		localHeader.writeUInt32LE(entry.data.length, 22);
		localHeader.writeUInt16LE(nameBuffer.length, 26);
		localHeader.writeUInt16LE(0, 28);

		const centralHeader = System.Buffer.alloc(46);
		centralHeader.writeUInt32LE(0x02014B50, 0);
		centralHeader.writeUInt16LE(20, 4);
		centralHeader.writeUInt16LE(20, 6);
		centralHeader.writeUInt16LE(0x0800, 8);
		centralHeader.writeUInt16LE(8, 10);
		centralHeader.writeUInt16LE(dosTime, 12);
		centralHeader.writeUInt16LE(dosDate, 14);
		centralHeader.writeUInt32LE(checksum, 16);
		centralHeader.writeUInt32LE(compressed.length, 20);
		centralHeader.writeUInt32LE(entry.data.length, 24);
		centralHeader.writeUInt16LE(nameBuffer.length, 28);
		centralHeader.writeUInt16LE(0, 30);
		centralHeader.writeUInt16LE(0, 32);
		centralHeader.writeUInt16LE(0, 34);
		centralHeader.writeUInt16LE(0, 36);
		centralHeader.writeUInt32LE(0, 38);
		centralHeader.writeUInt32LE(offset, 42);

		localParts.push(localHeader, nameBuffer, compressed);
		centralParts.push(centralHeader, nameBuffer);
		offset += localHeader.length + nameBuffer.length + compressed.length;
	}

	const centralDirectory = System.Buffer.concat(centralParts);
	const endRecord = System.Buffer.alloc(22);
	endRecord.writeUInt32LE(0x06054B50, 0);
	endRecord.writeUInt16LE(0, 4);
	endRecord.writeUInt16LE(0, 6);
	endRecord.writeUInt16LE(entries.length, 8);
	endRecord.writeUInt16LE(entries.length, 10);
	endRecord.writeUInt32LE(centralDirectory.length, 12);
	endRecord.writeUInt32LE(offset, 16);
	endRecord.writeUInt16LE(0, 20);

	return System.Buffer.concat([...localParts, centralDirectory, endRecord]);
}


//==============================================================================
// 프로젝트를 zip 버퍼로. build-spec.json 은 zip 루트, 웹 자산은 web/ 아래.
// 명세의 source.webDir 은 zip 안의 이름(web)으로 바꿔 넣는다.
//==============================================================================
function packProject(projectDirectory, webDirectoryRelative) {
	const specPath = NodePath.join(projectDirectory, SPEC_FILENAME);
	if (!NodeFs.existsSync(specPath)) {
		throw new System.Error(`${SPEC_FILENAME} 이 없습니다: ${specPath}\n  'init' 명령으로 초안을 만들 수 있습니다.`);
	}
	const spec = System.JSON.parse(NodeFs.readFileSync(specPath, "utf8"));
	const webDirectory = NodePath.join(projectDirectory, webDirectoryRelative);
	if (!NodeFs.existsSync(NodePath.join(webDirectory, "index.html"))) {
		throw new System.Error(`웹 빌드 결과물에 index.html 이 없습니다: ${webDirectory}\n  먼저 프로젝트에서 npm run build 를 실행하세요.`);
	}

	spec.source = { webDir: ZIP_WEB_DIRECTORY_NAME };
	const entries = [];
	entries.push({ name: SPEC_FILENAME, data: System.Buffer.from(System.JSON.stringify(spec, null, "\t") + "\n", "utf8") });
	const files = [];
	collectFiles(webDirectory, "", files);
	for (const relativePath of files) {
		const data = NodeFs.readFileSync(NodePath.join(webDirectory, relativePath));
		entries.push({ name: `${ZIP_WEB_DIRECTORY_NAME}/${relativePath}`, data: data });
	}
	return { zipBuffer: buildZip(entries), spec: spec, fileCount: files.length };
}


//==============================================================================
// build-spec.json 초안. package.json 의 이름과 버전을 가져온다.
//==============================================================================
function initSpec(projectDirectory) {
	const specPath = NodePath.join(projectDirectory, SPEC_FILENAME);
	if (NodeFs.existsSync(specPath)) {
		console.log(`이미 있습니다: ${specPath}`);
		return;
	}
	let name = NodePath.basename(NodePath.resolve(projectDirectory));
	let version = "1.0.0";
	const packagePath = NodePath.join(projectDirectory, "package.json");
	if (NodeFs.existsSync(packagePath)) {
		const packageRecord = System.JSON.parse(NodeFs.readFileSync(packagePath, "utf8"));
		if (typeof packageRecord.name === "string") {
			name = packageRecord.name;
		}
		if (typeof packageRecord.version === "string" && /^\d+\.\d+\.\d+$/.test(packageRecord.version)) {
			version = packageRecord.version;
		}
	}
	const identifier = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
	const spec = {
		specVersion: 1,
		app: { id: `com.example.${identifier === "" ? "app" : identifier}`, name: name, version: version },
		source: { webDir: "build/web" },
		targets: { macos: {}, ios: { teamId: "ABCDE12345", plugins: [] } },
	};
	NodeFs.writeFileSync(specPath, System.JSON.stringify(spec, null, "\t") + "\n", "utf8");
	console.log(`만들었습니다: ${specPath}`);
	console.log("app.id, app.name, targets.ios.teamId 를 실제 값으로 고친 뒤 pack 또는 send 를 실행하세요.");
}


//==============================================================================
// 잠시 대기.
//==============================================================================
function sleep(milliseconds) {
	return new System.Promise((resolve) => {
		System.setTimeout(resolve, milliseconds);
	});
}


//==============================================================================
// 서버에 보내고 끝날 때까지 기다린 뒤 산출물을 받는다.
//==============================================================================
async function sendProject(serverUrl, projectDirectory, webDirectoryRelative, targets, outputDirectory) {
	const packed = packProject(projectDirectory, webDirectoryRelative);
	const baseUrl = serverUrl.replace(/\/+$/, "");
	const query = targets === undefined ? "" : `?targets=${System.encodeURIComponent(targets)}`;
	console.log(`[send] ${packed.spec.app.name} ${packed.spec.app.version} — 파일 ${packed.fileCount}개, ${(packed.zipBuffer.length / 1024 / 1024).toFixed(1)} MB 전송 중...`);

	const createResponse = await System.fetch(`${baseUrl}/api/jobs${query}`, {
		method: "POST",
		headers: { "Content-Type": "application/zip" },
		body: packed.zipBuffer,
	});
	const createResult = await createResponse.json();
	if (createResponse.status !== 201) {
		const errors = createResult.errors === undefined ? [createResult.error] : createResult.errors;
		throw new System.Error(`서버가 거부했습니다:\n  ${errors.join("\n  ")}`);
	}
	const jobId = createResult.id;
	console.log(`[send] 작업 #${jobId} 생성. 현황: ${baseUrl}/`);

	const seenSteps = {};
	let detail = null;
	while (true) {
		const detailResponse = await System.fetch(`${baseUrl}/api/jobs/${jobId}`);
		detail = await detailResponse.json();
		for (const step of detail.steps) {
			if (seenSteps[step.name] !== step.state) {
				seenSteps[step.name] = step.state;
				if (step.state !== "pending") {
					console.log(`[#${jobId}] ${step.name}: ${step.state}`);
				}
			}
		}
		if (detail.state !== "queued" && detail.state !== "running") {
			break;
		}
		await sleep(POLL_INTERVAL_MILLISECONDS);
	}

	console.log(`[#${jobId}] 종료: ${detail.state}${detail.error === null ? "" : ` (${detail.error})`}`);
	if (detail.artifacts.length === 0) {
		const logResponse = await System.fetch(`${baseUrl}/api/jobs/${jobId}/log`);
		const logText = await logResponse.text();
		const logLines = logText.split("\n");
		console.log("--- 로그 마지막 40줄 ---");
		console.log(logLines.slice(-40).join("\n"));
		System.process.exitCode = 1;
		return;
	}

	NodeFs.mkdirSync(outputDirectory, { recursive: true });
	for (const filename of detail.artifacts) {
		const artifactResponse = await System.fetch(`${baseUrl}/api/jobs/${jobId}/artifacts/${System.encodeURIComponent(filename)}`);
		const artifactBuffer = System.Buffer.from(await artifactResponse.arrayBuffer());
		const artifactPath = NodePath.join(outputDirectory, filename);
		NodeFs.writeFileSync(artifactPath, artifactBuffer);
		console.log(`[#${jobId}] 받음: ${artifactPath} (${(artifactBuffer.length / 1024 / 1024).toFixed(1)} MB)`);
	}
	if (detail.state !== "succeeded") {
		System.process.exitCode = 1;
	}
}


//==============================================================================
// 진입점.
//==============================================================================
async function main() {
	const parsed = parseArguments(System.process.argv.slice(2));
	const command = parsed.positional[0];
	const webDirectoryRelative = parsed.options.web === undefined ? "build/web" : parsed.options.web;

	if (command === "init") {
		const projectDirectory = parsed.positional[1] === undefined ? "." : parsed.positional[1];
		initSpec(projectDirectory);
		return;
	}
	if (command === "pack") {
		const projectDirectory = parsed.positional[1] === undefined ? "." : parsed.positional[1];
		const outputPath = parsed.options.out === undefined ? "project.zip" : parsed.options.out;
		const packed = packProject(projectDirectory, webDirectoryRelative);
		NodeFs.writeFileSync(outputPath, packed.zipBuffer);
		console.log(`[pack] ${outputPath} — 파일 ${packed.fileCount}개, ${(packed.zipBuffer.length / 1024 / 1024).toFixed(1)} MB`);
		return;
	}
	if (command === "send") {
		const serverUrl = parsed.positional[1];
		if (serverUrl === undefined) {
			throw new System.Error("서버 주소가 필요합니다. 예: node vanilla-pack.mjs send http://192.168.0.11:8686");
		}
		const projectDirectory = parsed.positional[2] === undefined ? "." : parsed.positional[2];
		const outputDirectory = parsed.options["out-dir"] === undefined ? "dist" : parsed.options["out-dir"];
		await sendProject(serverUrl, projectDirectory, webDirectoryRelative, parsed.options.targets, outputDirectory);
		return;
	}
	console.log("사용법:");
	console.log("  node vanilla-pack.mjs init [프로젝트경로]");
	console.log("  node vanilla-pack.mjs pack [프로젝트경로] [--web build/web] [--out project.zip]");
	console.log("  node vanilla-pack.mjs send <서버주소> [프로젝트경로] [--web build/web] [--targets macos,ios] [--out-dir dist]");
	System.process.exitCode = 1;
}


main().catch((error) => {
	console.error(`오류: ${error.message}`);
	System.process.exitCode = 1;
});
