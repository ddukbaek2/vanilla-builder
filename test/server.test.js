//==============================================================================
// 포함 모듈 목록.
//==============================================================================
const System = globalThis;
import { test } from "node:test";
import * as Assert from "node:assert/strict";
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";
import * as NodeOs from "node:os";
import * as NodeNet from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Job, JobState, StepState } from "../src/job.js";
import { Settings, DEFAULT_PORT } from "../src/settings.js";
import { JobQueue } from "../src/jobqueue.js";
import { HttpServer } from "../src/httpserver.js";


const execFileAsync = promisify(execFile);
const PUBLIC_DIRECTORY = NodePath.resolve(import.meta.dirname, "..", "public");
const WAIT_TIMEOUT_MILLISECONDS = 10000;


//==============================================================================
// 검증을 통과하는 최소 명세.
//==============================================================================
const VALID_SPEC = {
	specVersion: 1,
	app: { id: "com.example.mygame", name: "My Game", version: "1.2.3" },
	source: { webDir: "web" },
	targets: { macos: {} },
};


//==============================================================================
// 가짜 빌더. 단계 호출을 기록하고 deliver 에서 산출물 하나를 만든다.
// slow 면 build 단계에서 sleep 을 띄워 취소 시험에 쓴다.
//==============================================================================
function createFakeBuilder(slow) {
	const calls = [];
	const builder = {
		async prepare(context) {
			calls.push("prepare");
		},
		async build(context) {
			calls.push("build");
			if (slow) {
				await context.runner.run("sleep", ["30"], { cwd: context.buildDirectory });
			}
		},
		async deliver(context) {
			calls.push("deliver");
			const artifactPath = NodePath.join(context.artifactsDirectory, "artifact.txt");
			NodeFs.writeFileSync(artifactPath, "hello", "utf8");
			context.job.addArtifact("artifact.txt");
		},
	};
	return { builder: builder, calls: calls };
}


//==============================================================================
// 명세와 web/index.html 을 담은 zip 을 만든다. (spec 이 null 이면 명세 없이)
//==============================================================================
async function createProjectZip(spec, includeIndex) {
	const projectDirectory = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "vanilla-builder-project-"));
	if (spec !== null) {
		const specText = System.JSON.stringify(spec, null, "\t");
		NodeFs.writeFileSync(NodePath.join(projectDirectory, "build-spec.json"), specText, "utf8");
	}
	if (includeIndex) {
		const webDirectory = NodePath.join(projectDirectory, "web");
		NodeFs.mkdirSync(webDirectory);
		NodeFs.writeFileSync(NodePath.join(webDirectory, "index.html"), "<!DOCTYPE html><title>test</title>", "utf8");
	}
	const zipPath = `${projectDirectory}.zip`;
	await execFileAsync("zip", ["-q", "-r", zipPath, "."], { cwd: projectDirectory });
	NodeFs.rmSync(projectDirectory, { recursive: true, force: true });
	return zipPath;
}


//==============================================================================
// 임시 홈 디렉토리로 서버를 띄운다.
//==============================================================================
async function startTestServer(builders) {
	const homeDirectory = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "vanilla-builder-home-"));
	const settings = new Settings(homeDirectory);
	settings.load();
	settings.update({ allowBuilds: true });
	const jobQueue = new JobQueue(settings, builders);
	jobQueue.restore();
	const httpServer = new HttpServer(0, jobQueue, PUBLIC_DIRECTORY);
	await httpServer.start();
	const port = httpServer.getPort();
	return {
		baseUrl: `http://127.0.0.1:${port}`,
		httpServer: httpServer,
		jobQueue: jobQueue,
		settings: settings,
		homeDirectory: homeDirectory,
	};
}


//==============================================================================
// 서버 정리.
//==============================================================================
async function stopTestServer(testServer) {
	await testServer.httpServer.stop();
	NodeFs.rmSync(testServer.homeDirectory, { recursive: true, force: true });
}


//==============================================================================
// 빈 포트 하나 찾기.
//==============================================================================
function findFreePort() {
	return new System.Promise((resolve) => {
		const probe = NodeNet.createServer();
		probe.listen(0, () => {
			const address = probe.address();
			const port = address.port;
			probe.close(() => {
				resolve(port);
			});
		});
	});
}


//==============================================================================
// zip 업로드.
//==============================================================================
async function postZip(baseUrl, zipPath, query) {
	const zipBuffer = NodeFs.readFileSync(zipPath);
	const response = await System.fetch(`${baseUrl}/api/jobs${query}`, {
		method: "POST",
		headers: { "Content-Type": "application/zip" },
		body: zipBuffer,
	});
	const body = await response.json();
	return { status: response.status, body: body };
}


//==============================================================================
// JSON 요청.
//==============================================================================
async function fetchJson(url, options) {
	const response = await System.fetch(url, options);
	const body = await response.json();
	return { status: response.status, body: body };
}


//==============================================================================
// 설정 변경 요청.
//==============================================================================
async function putSettings(baseUrl, record) {
	return await fetchJson(`${baseUrl}/api/settings`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: System.JSON.stringify(record),
	});
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
// 조건을 만족할 때까지 작업 상세를 폴링한다.
//==============================================================================
async function waitForJob(baseUrl, jobId, predicate) {
	const deadline = System.Date.now() + WAIT_TIMEOUT_MILLISECONDS;
	while (System.Date.now() < deadline) {
		const result = await fetchJson(`${baseUrl}/api/jobs/${jobId}`);
		if (predicate(result.body)) {
			return result.body;
		}
		await sleep(50);
	}
	throw new System.Error(`작업 #${jobId} 대기 시간 초과`);
}


//==============================================================================
// 종료 여부.
//==============================================================================
function isFinished(detail) {
	return detail.state === JobState.succeeded || detail.state === JobState.failed || detail.state === JobState.canceled;
}


//==============================================================================
// 단계 상태를 이름 → 상태 객체로.
//==============================================================================
function stepStates(detail) {
	const states = {};
	for (const step of detail.steps) {
		states[step.name] = step.state;
	}
	return states;
}


test("명세가 없거나 잘못된 zip 은 400 과 오류 목록을 돌려준다", async () => {
	const fake = createFakeBuilder(false);
	const testServer = await startTestServer({ macos: fake.builder });
	try {
		const noSpecZip = await createProjectZip(null, true);
		const noSpecResult = await postZip(testServer.baseUrl, noSpecZip, "");
		Assert.equal(noSpecResult.status, 400);
		Assert.ok(noSpecResult.body.errors[0].includes("build-spec.json"));

		const unsupportedSpec = { ...VALID_SPEC, targets: { ios: { teamId: "ABCDE12345" } } };
		const unsupportedZip = await createProjectZip(unsupportedSpec, true);
		const unsupportedResult = await postZip(testServer.baseUrl, unsupportedZip, "");
		Assert.equal(unsupportedResult.status, 400);
		Assert.deepEqual(unsupportedResult.body.errors, ["지원하지 않는 플랫폼입니다: ios"]);

		const noIndexZip = await createProjectZip(VALID_SPEC, false);
		const noIndexResult = await postZip(testServer.baseUrl, noIndexZip, "");
		Assert.equal(noIndexResult.status, 400);
		Assert.ok(noIndexResult.body.errors[0].includes("source.webDir"));

		const validZip = await createProjectZip(VALID_SPEC, true);
		const filterResult = await postZip(testServer.baseUrl, validZip, "?targets=ios");
		Assert.equal(filterResult.status, 400);
		Assert.deepEqual(filterResult.body.errors, ["요청한 플랫폼이 명세에 없습니다: ios"]);

		const emptyResult = await fetchJson(`${testServer.baseUrl}/api/jobs`, { method: "POST" });
		Assert.equal(emptyResult.status, 400);

		const listResult = await fetchJson(`${testServer.baseUrl}/api/jobs`);
		Assert.deepEqual(listResult.body, []);
		Assert.deepEqual(fake.calls, []);
	}
	finally {
		await stopTestServer(testServer);
	}
});


test("정상 zip 은 프로젝트 폴더 아래 작업이 되어 순서대로 실행되고 산출물과 로그를 받을 수 있다", async () => {
	const fake = createFakeBuilder(false);
	const testServer = await startTestServer({ macos: fake.builder });
	try {
		const zipPath = await createProjectZip(VALID_SPEC, true);
		const firstResult = await postZip(testServer.baseUrl, zipPath, "");
		Assert.equal(firstResult.status, 201);
		Assert.equal(firstResult.body.id, 1);
		const secondResult = await postZip(testServer.baseUrl, zipPath, "?targets=macos");
		Assert.equal(secondResult.status, 201);
		Assert.equal(secondResult.body.id, 2);

		const firstDetail = await waitForJob(testServer.baseUrl, 1, isFinished);
		const secondDetail = await waitForJob(testServer.baseUrl, 2, isFinished);
		Assert.equal(firstDetail.state, JobState.succeeded);
		Assert.equal(secondDetail.state, JobState.succeeded);
		Assert.deepEqual(stepStates(firstDetail), {
			"macos:prepare": StepState.succeeded,
			"macos:build": StepState.succeeded,
			"macos:deliver": StepState.succeeded,
		});
		Assert.ok(secondDetail.startedAt >= firstDetail.finishedAt, "두 번째 작업은 첫 번째가 끝난 뒤 시작해야 한다");
		Assert.deepEqual(fake.calls, ["prepare", "build", "deliver", "prepare", "build", "deliver"]);
		Assert.deepEqual(firstDetail.artifacts, ["artifact.txt"]);
		Assert.equal(firstDetail.appName, "My Game");

		const jobDirectory = NodePath.join(testServer.homeDirectory, "com.example.mygame", "builds", "1");
		Assert.ok(NodeFs.existsSync(NodePath.join(jobDirectory, "job.json")), "작업은 <워크스페이스>/<app.id>/builds/<id> 에 있어야 한다");
		Assert.ok(NodeFs.existsSync(NodePath.join(jobDirectory, "project", "build-spec.json")));
		Assert.ok(NodeFs.existsSync(NodePath.join(testServer.homeDirectory, "counter.json")));

		const listResult = await fetchJson(`${testServer.baseUrl}/api/jobs`);
		Assert.deepEqual(listResult.body.map((summary) => summary.id), [2, 1]);

		const artifactResponse = await System.fetch(`${testServer.baseUrl}/api/jobs/1/artifacts/artifact.txt`);
		Assert.equal(artifactResponse.status, 200);
		const artifactText = await artifactResponse.text();
		Assert.equal(artifactText, "hello");
		const missingArtifact = await fetchJson(`${testServer.baseUrl}/api/jobs/1/artifacts/other.txt`);
		Assert.equal(missingArtifact.status, 404);

		const logResponse = await System.fetch(`${testServer.baseUrl}/api/jobs/1/log`);
		const logText = await logResponse.text();
		Assert.ok(logText.includes("[job] #1 시작"));
		Assert.ok(logText.includes("[macos:deliver] 성공"));
		const logByteLength = System.Buffer.byteLength(logText, "utf8");
		const tailResponse = await System.fetch(`${testServer.baseUrl}/api/jobs/1/log?offset=${logByteLength}`);
		const tailText = await tailResponse.text();
		Assert.equal(tailText, "");

		const cancelResult = await fetchJson(`${testServer.baseUrl}/api/jobs/1/cancel`, { method: "POST" });
		Assert.equal(cancelResult.status, 409);
		const missingJob = await fetchJson(`${testServer.baseUrl}/api/jobs/99`);
		Assert.equal(missingJob.status, 404);

		const pageResponse = await System.fetch(`${testServer.baseUrl}/`);
		Assert.equal(pageResponse.status, 200);
		const pageText = await pageResponse.text();
		Assert.ok(pageText.includes("vanilla-builder"));
	}
	finally {
		await stopTestServer(testServer);
	}
});


test("실행 중인 작업은 취소하면 명령이 끊기고 남은 단계가 취소 처리된다", async () => {
	const fake = createFakeBuilder(true);
	const testServer = await startTestServer({ macos: fake.builder });
	try {
		const zipPath = await createProjectZip(VALID_SPEC, true);
		const createResult = await postZip(testServer.baseUrl, zipPath, "");
		Assert.equal(createResult.status, 201);
		await waitForJob(testServer.baseUrl, 1, (detail) => {
			const states = stepStates(detail);
			return states["macos:build"] === StepState.running;
		});
		await sleep(100);

		const cancelStartedAt = System.Date.now();
		const cancelResult = await fetchJson(`${testServer.baseUrl}/api/jobs/1/cancel`, { method: "POST" });
		Assert.equal(cancelResult.status, 200);
		const detail = await waitForJob(testServer.baseUrl, 1, isFinished);
		const cancelElapsed = System.Date.now() - cancelStartedAt;
		Assert.equal(detail.state, JobState.canceled);
		Assert.deepEqual(stepStates(detail), {
			"macos:prepare": StepState.succeeded,
			"macos:build": StepState.canceled,
			"macos:deliver": StepState.canceled,
		});
		Assert.ok(cancelElapsed < 5000, `취소가 ${cancelElapsed}ms 걸렸다`);
		Assert.deepEqual(fake.calls, ["prepare", "build"]);
	}
	finally {
		await stopTestServer(testServer);
	}
});


test("대기 중인 작업은 취소하면 바로 끝나고 실행 중인 작업은 계속된다", async () => {
	const fake = createFakeBuilder(true);
	const testServer = await startTestServer({ macos: fake.builder });
	try {
		const zipPath = await createProjectZip(VALID_SPEC, true);
		await postZip(testServer.baseUrl, zipPath, "");
		await postZip(testServer.baseUrl, zipPath, "");
		await waitForJob(testServer.baseUrl, 1, (detail) => {
			return detail.state === JobState.running;
		});
		const queuedDetail = await fetchJson(`${testServer.baseUrl}/api/jobs/2`);
		Assert.equal(queuedDetail.body.state, JobState.queued);

		const cancelResult = await fetchJson(`${testServer.baseUrl}/api/jobs/2/cancel`, { method: "POST" });
		Assert.equal(cancelResult.status, 200);
		const canceledDetail = await fetchJson(`${testServer.baseUrl}/api/jobs/2`);
		Assert.equal(canceledDetail.body.state, JobState.canceled);
		Assert.deepEqual(stepStates(canceledDetail.body), {
			"macos:prepare": StepState.canceled,
			"macos:build": StepState.canceled,
			"macos:deliver": StepState.canceled,
		});
		const runningDetail = await fetchJson(`${testServer.baseUrl}/api/jobs/1`);
		Assert.equal(runningDetail.body.state, JobState.running);

		await fetchJson(`${testServer.baseUrl}/api/jobs/1/cancel`, { method: "POST" });
		await waitForJob(testServer.baseUrl, 1, isFinished);
	}
	finally {
		await stopTestServer(testServer);
	}
});


test("종료하면 실행 중인 작업은 취소로 기록되고 대기 작업은 그대로 남는다", async () => {
	const fake = createFakeBuilder(true);
	const testServer = await startTestServer({ macos: fake.builder });
	try {
		const zipPath = await createProjectZip(VALID_SPEC, true);
		await postZip(testServer.baseUrl, zipPath, "");
		await postZip(testServer.baseUrl, zipPath, "");
		await waitForJob(testServer.baseUrl, 1, (detail) => {
			const states = stepStates(detail);
			return states["macos:build"] === StepState.running;
		});
		await sleep(100);

		await testServer.jobQueue.shutdown();

		const runningJob = testServer.jobQueue.getJob(1);
		Assert.equal(runningJob.getState(), JobState.canceled);
		const queuedJob = testServer.jobQueue.getJob(2);
		Assert.equal(queuedJob.getState(), JobState.queued);
		Assert.equal(testServer.jobQueue.getRunningJob(), null);
	}
	finally {
		await stopTestServer(testServer);
	}
});


test("설정은 조회와 변경이 되고 워크스페이스를 바꾸면 새 작업이 그곳에 생긴다", async () => {
	const fake = createFakeBuilder(false);
	const testServer = await startTestServer({ macos: fake.builder });
	const otherWorkspace = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "vanilla-builder-workspace-"));
	try {
		const initialResult = await fetchJson(`${testServer.baseUrl}/api/settings`);
		Assert.equal(initialResult.status, 200);
		Assert.deepEqual(initialResult.body, { port: DEFAULT_PORT, workspaceDir: testServer.homeDirectory, allowBuilds: true });

		const badResult = await putSettings(testServer.baseUrl, { port: 70000, workspaceDir: "relative/path" });
		Assert.equal(badResult.status, 400);
		Assert.equal(badResult.body.errors.length, 2);
		const unchangedResult = await fetchJson(`${testServer.baseUrl}/api/settings`);
		Assert.deepEqual(unchangedResult.body, initialResult.body);

		const notJsonResponse = await System.fetch(`${testServer.baseUrl}/api/settings`, { method: "PUT", body: "not json" });
		Assert.equal(notJsonResponse.status, 400);

		const changeResult = await putSettings(testServer.baseUrl, { workspaceDir: otherWorkspace });
		Assert.equal(changeResult.status, 200);
		Assert.equal(changeResult.body.workspaceDir, otherWorkspace);
		const settingsPath = NodePath.join(testServer.homeDirectory, "settings.json");
		const savedRecord = System.JSON.parse(NodeFs.readFileSync(settingsPath, "utf8"));
		Assert.equal(savedRecord.workspaceDir, otherWorkspace);

		const zipPath = await createProjectZip(VALID_SPEC, true);
		const createResult = await postZip(testServer.baseUrl, zipPath, "");
		Assert.equal(createResult.status, 201);
		await waitForJob(testServer.baseUrl, 1, isFinished);
		const movedJobPath = NodePath.join(otherWorkspace, "com.example.mygame", "builds", "1", "job.json");
		Assert.ok(NodeFs.existsSync(movedJobPath), "새 작업은 바뀐 워크스페이스에 생겨야 한다");
		Assert.ok(NodeFs.existsSync(NodePath.join(testServer.homeDirectory, "counter.json")), "카운터는 홈에 남아야 한다");
	}
	finally {
		await stopTestServer(testServer);
		NodeFs.rmSync(otherWorkspace, { recursive: true, force: true });
	}
});


test("빌드 허용이 꺼져 있으면 업로드를 403 으로 거부하고, 기본값은 꺼짐이다", async () => {
	const fake = createFakeBuilder(false);
	const testServer = await startTestServer({ macos: fake.builder });
	try {
		const freshSettings = new Settings(NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "vanilla-builder-fresh-")));
		Assert.equal(freshSettings.isBuildAllowed(), false, "기본값은 꺼짐");

		const offResult = await putSettings(testServer.baseUrl, { allowBuilds: false });
		Assert.equal(offResult.status, 200);
		Assert.equal(offResult.body.allowBuilds, false);
		const zipPath = await createProjectZip(VALID_SPEC, true);
		const rejected = await postZip(testServer.baseUrl, zipPath, "");
		Assert.equal(rejected.status, 403);
		Assert.ok(rejected.body.errors[0].includes("빌드를 허용하지 않습니다"));
		const listResult = await fetchJson(`${testServer.baseUrl}/api/jobs`);
		Assert.deepEqual(listResult.body, []);

		const badResult = await putSettings(testServer.baseUrl, { allowBuilds: "yes" });
		Assert.equal(badResult.status, 400);

		const onResult = await putSettings(testServer.baseUrl, { allowBuilds: true });
		Assert.equal(onResult.body.allowBuilds, true);
		const accepted = await postZip(testServer.baseUrl, zipPath, "");
		Assert.equal(accepted.status, 201);
		await waitForJob(testServer.baseUrl, accepted.body.id, isFinished);
	}
	finally {
		await stopTestServer(testServer);
	}
});


test("포트를 바꾸면 새 포트로 응답하고 옛 포트는 닫힌다. 열 수 없는 포트면 되돌린다", async () => {
	const fake = createFakeBuilder(false);
	const testServer = await startTestServer({ macos: fake.builder });
	const blocker = NodeNet.createServer();
	try {
		const blockedPort = await findFreePort();
		await new System.Promise((resolve) => {
			blocker.listen(blockedPort, resolve);
		});
		const blockedResult = await putSettings(testServer.baseUrl, { port: blockedPort });
		Assert.equal(blockedResult.status, 400);
		Assert.ok(blockedResult.body.errors[0].includes("열 수 없습니다"));
		const stillAlive = await fetchJson(`${testServer.baseUrl}/api/settings`);
		Assert.equal(stillAlive.status, 200);
		Assert.equal(stillAlive.body.port, DEFAULT_PORT);

		const freePort = await findFreePort();
		const changeResult = await putSettings(testServer.baseUrl, { port: freePort });
		Assert.equal(changeResult.status, 200);
		Assert.equal(changeResult.body.port, freePort);
		await sleep(100);

		const newBaseUrl = `http://127.0.0.1:${freePort}`;
		const newResult = await fetchJson(`${newBaseUrl}/api/settings`);
		Assert.equal(newResult.status, 200);
		Assert.equal(newResult.body.port, freePort);
		Assert.equal(testServer.httpServer.getPort(), freePort);
		await Assert.rejects(System.fetch(`${testServer.baseUrl}/api/settings`), "옛 포트는 닫혀야 한다");
	}
	finally {
		await new System.Promise((resolve) => {
			blocker.close(resolve);
		});
		await stopTestServer(testServer);
	}
});


test("재시작하면 실행 중이던 작업은 실패로, 대기 중이던 작업은 큐로 돌아온다", async () => {
	const homeDirectory = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "vanilla-builder-home-"));
	try {
		const buildsDirectory = NodePath.join(homeDirectory, "com.example.mygame", "builds");
		const runningDirectory = NodePath.join(buildsDirectory, "3");
		const queuedDirectory = NodePath.join(buildsDirectory, "4");
		NodeFs.mkdirSync(runningDirectory, { recursive: true });
		NodeFs.mkdirSync(queuedDirectory, { recursive: true });
		const runningJob = new Job(3, runningDirectory, VALID_SPEC, ["macos"]);
		runningJob.start();
		runningJob.setStepState("macos:prepare", StepState.succeeded);
		runningJob.setStepState("macos:build", StepState.running);
		const queuedJob = new Job(4, queuedDirectory, VALID_SPEC, ["macos"]);
		queuedJob.save();

		const fake = createFakeBuilder(false);
		const settings = new Settings(homeDirectory);
		settings.load();
		const jobQueue = new JobQueue(settings, { macos: fake.builder });
		jobQueue.restore();

		const restoredRunning = jobQueue.getJob(3);
		Assert.equal(restoredRunning.getState(), JobState.failed);
		Assert.ok(restoredRunning.getError().includes("재시작"));
		Assert.deepEqual(stepStates(restoredRunning.toDetail()), {
			"macos:prepare": StepState.succeeded,
			"macos:build": StepState.canceled,
			"macos:deliver": StepState.canceled,
		});

		const deadline = System.Date.now() + WAIT_TIMEOUT_MILLISECONDS;
		const restoredQueued = jobQueue.getJob(4);
		while (!restoredQueued.isFinished() && System.Date.now() < deadline) {
			await sleep(50);
		}
		Assert.equal(restoredQueued.getState(), JobState.succeeded);
		Assert.deepEqual(fake.calls, ["prepare", "build", "deliver"]);
		Assert.deepEqual(jobQueue.listJobs().map((job) => job.getId()), [4, 3]);
	}
	finally {
		NodeFs.rmSync(homeDirectory, { recursive: true, force: true });
	}
});
