//==============================================================================
// 포함 모듈 목록.
//==============================================================================
const System = globalThis;
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";


//==============================================================================
// 작업 상태.
//==============================================================================
export const JobState = System.Object.freeze({
	queued: "queued",
	running: "running",
	succeeded: "succeeded",
	failed: "failed",
	canceled: "canceled",
});


//==============================================================================
// 단계 상태.
//==============================================================================
export const StepState = System.Object.freeze({
	pending: "pending",
	running: "running",
	succeeded: "succeeded",
	failed: "failed",
	skipped: "skipped",
	canceled: "canceled",
});


//==============================================================================
// 플랫폼마다 순서대로 밟는 단계 종류.
//==============================================================================
export const STEP_KINDS = System.Object.freeze(["prepare", "build", "deliver"]);


//==============================================================================
// 작업 디렉토리 안의 파일과 하위 디렉토리 이름.
//==============================================================================
const JOB_FILENAME = "job.json";
const LOG_FILENAME = "log.txt";
const PROJECT_DIRECTORY_NAME = "project";
const BUILD_DIRECTORY_NAME = "build";
const ARTIFACTS_DIRECTORY_NAME = "artifacts";


//==============================================================================
// 작업. (업로드 한 번에 대한 빌드 요청 하나)
//
// 상태와 단계를 들고 있고, 바뀔 때마다 job.json 에 저장한다.
// 서버가 재시작해도 job.json 으로 복원할 수 있다.
//==============================================================================
export class Job {
	//==============================================================================
	// 멤버 변수 목록.
	//==============================================================================
	/** @private @type { number } */ #id;
	/** @private @type { string } */ #directory;
	/** @private @type { object } */ #spec;
	/** @private @type { string[] } */ #targets;
	/** @private @type { string } */ #state;
	/** @private @type { object[] } */ #steps;
	/** @private @type { string[] } */ #artifacts;
	/** @private @type { string | null } */ #error;
	/** @private @type { string } */ #createdAt;
	/** @private @type { string | null } */ #startedAt;
	/** @private @type { string | null } */ #finishedAt;
	/** @private @type { boolean } */ #cancelRequested;
	/** @private @type { object | null } */ #logStream;

	//==============================================================================
	// 생성.
	//==============================================================================
	/**
	 * @param { number } id 작업 번호
	 * @param { string } directory 작업 디렉토리 (data/jobs/<id>)
	 * @param { object } spec 검증을 통과한 빌드 명세
	 * @param { string[] } targets 빌드할 플랫폼 목록 (명세 순서)
	 */
	constructor(id, directory, spec, targets) {
		this.#id = id;
		this.#directory = directory;
		this.#spec = spec;
		this.#targets = targets;
		this.#state = JobState.queued;
		this.#steps = [];
		for (const platform of targets) {
			for (const stepKind of STEP_KINDS) {
				this.#steps.push({ name: `${platform}:${stepKind}`, state: StepState.pending });
			}
		}
		this.#artifacts = [];
		this.#error = null;
		this.#createdAt = new System.Date().toISOString();
		this.#startedAt = null;
		this.#finishedAt = null;
		this.#cancelRequested = false;
		this.#logStream = null;
	}

	//==============================================================================
	// job.json 으로부터 복원.
	//==============================================================================
	/**
	 * @param { string } directory
	 * @returns { Job }
	 */
	static load(directory) {
		const recordPath = NodePath.join(directory, JOB_FILENAME);
		const recordText = NodeFs.readFileSync(recordPath, "utf8");
		const record = System.JSON.parse(recordText);
		const job = new Job(record.id, directory, record.spec, record.targets);
		job.applyRecord(record);
		return job;
	}

	//==============================================================================
	// 저장된 레코드의 진행 정보를 덮어쓴다.
	//==============================================================================
	/**
	 * @param { object } record
	 */
	applyRecord(record) {
		this.#state = record.state;
		this.#steps = record.steps;
		this.#artifacts = record.artifacts;
		this.#error = record.error;
		this.#createdAt = record.createdAt;
		this.#startedAt = record.startedAt;
		this.#finishedAt = record.finishedAt;
	}

	//==============================================================================
	// 작업 번호 반환.
	//==============================================================================
	/**
	 * @returns { number }
	 */
	getId() {
		return this.#id;
	}

	//==============================================================================
	// 작업 디렉토리 반환.
	//==============================================================================
	/**
	 * @returns { string }
	 */
	getDirectory() {
		return this.#directory;
	}

	//==============================================================================
	// 업로드가 전개된 프로젝트 디렉토리 반환.
	//==============================================================================
	/**
	 * @returns { string }
	 */
	getProjectDirectory() {
		return NodePath.join(this.#directory, PROJECT_DIRECTORY_NAME);
	}

	//==============================================================================
	// 플랫폼별 빌드 디렉토리 반환.
	//==============================================================================
	/**
	 * @param { string } platform
	 * @returns { string }
	 */
	getBuildDirectory(platform) {
		return NodePath.join(this.#directory, BUILD_DIRECTORY_NAME, platform);
	}

	//==============================================================================
	// 산출물 디렉토리 반환.
	//==============================================================================
	/**
	 * @returns { string }
	 */
	getArtifactsDirectory() {
		return NodePath.join(this.#directory, ARTIFACTS_DIRECTORY_NAME);
	}

	//==============================================================================
	// 로그 파일 경로 반환.
	//==============================================================================
	/**
	 * @returns { string }
	 */
	getLogPath() {
		return NodePath.join(this.#directory, LOG_FILENAME);
	}

	//==============================================================================
	// 빌드 명세 반환.
	//==============================================================================
	/**
	 * @returns { object }
	 */
	getSpec() {
		return this.#spec;
	}

	//==============================================================================
	// 대상 플랫폼 목록 반환.
	//==============================================================================
	/**
	 * @returns { string[] }
	 */
	getTargets() {
		return this.#targets;
	}

	//==============================================================================
	// 상태 반환.
	//==============================================================================
	/**
	 * @returns { string }
	 */
	getState() {
		return this.#state;
	}

	//==============================================================================
	// 단계 목록 반환. (사본)
	//==============================================================================
	/**
	 * @returns { object[] }
	 */
	getSteps() {
		return this.#steps.map((step) => {
			return { name: step.name, state: step.state };
		});
	}

	//==============================================================================
	// 산출물 파일명 목록 반환. (사본)
	//==============================================================================
	/**
	 * @returns { string[] }
	 */
	getArtifacts() {
		return this.#artifacts.slice();
	}

	//==============================================================================
	// 오류 메시지 반환.
	//==============================================================================
	/**
	 * @returns { string | null }
	 */
	getError() {
		return this.#error;
	}

	//==============================================================================
	// 종료 여부.
	//==============================================================================
	/**
	 * @returns { boolean }
	 */
	isFinished() {
		return this.#state === JobState.succeeded || this.#state === JobState.failed || this.#state === JobState.canceled;
	}

	//==============================================================================
	// 취소 요청 여부.
	//==============================================================================
	/**
	 * @returns { boolean }
	 */
	isCancelRequested() {
		return this.#cancelRequested;
	}

	//==============================================================================
	// 취소 요청. 실제 중단은 큐가 실행 중인 명령을 끊으면서 이루어진다.
	//==============================================================================
	requestCancel() {
		this.#cancelRequested = true;
	}

	//==============================================================================
	// 시작.
	//==============================================================================
	start() {
		this.#state = JobState.running;
		this.#startedAt = new System.Date().toISOString();
		this.save();
	}

	//==============================================================================
	// 종료. (성공 / 실패 / 취소)
	//==============================================================================
	/**
	 * @param { string } state
	 * @param { string | null } error
	 */
	finish(state, error) {
		this.#state = state;
		this.#error = error;
		this.#finishedAt = new System.Date().toISOString();
		this.save();
		this.closeLog();
	}

	//==============================================================================
	// 단계 상태 변경.
	//==============================================================================
	/**
	 * @param { string } stepName
	 * @param { string } state
	 */
	setStepState(stepName, state) {
		for (const step of this.#steps) {
			if (step.name === stepName) {
				step.state = state;
			}
		}
		this.save();
	}

	//==============================================================================
	// 산출물 등록. (artifacts/ 안의 파일명)
	//==============================================================================
	/**
	 * @param { string } filename
	 */
	addArtifact(filename) {
		this.#artifacts.push(filename);
		this.save();
	}

	//==============================================================================
	// 로그 기록. 첫 기록 때 파일을 열고 종료 때 닫는다.
	//==============================================================================
	/**
	 * @param { string | Buffer } text
	 */
	appendLog(text) {
		if (this.#logStream === null) {
			const logPath = this.getLogPath();
			this.#logStream = NodeFs.createWriteStream(logPath, { flags: "a" });
		}
		this.#logStream.write(text);
	}

	//==============================================================================
	// 로그 파일 닫기.
	//==============================================================================
	closeLog() {
		if (this.#logStream === null) {
			return;
		}
		this.#logStream.end();
		this.#logStream = null;
	}

	//==============================================================================
	// job.json 저장.
	//==============================================================================
	save() {
		const record = {
			id: this.#id,
			state: this.#state,
			targets: this.#targets,
			steps: this.#steps,
			artifacts: this.#artifacts,
			error: this.#error,
			createdAt: this.#createdAt,
			startedAt: this.#startedAt,
			finishedAt: this.#finishedAt,
			spec: this.#spec,
		};
		const recordText = System.JSON.stringify(record, null, "\t");
		const recordPath = NodePath.join(this.#directory, JOB_FILENAME);
		NodeFs.writeFileSync(recordPath, recordText, "utf8");
	}

	//==============================================================================
	// 목록용 요약.
	//==============================================================================
	/**
	 * @returns { object }
	 */
	toSummary() {
		return {
			id: this.#id,
			state: this.#state,
			appId: this.#spec.app.id,
			appName: this.#spec.app.name,
			appVersion: this.#spec.app.version,
			targets: this.#targets.slice(),
			createdAt: this.#createdAt,
			startedAt: this.#startedAt,
			finishedAt: this.#finishedAt,
		};
	}

	//==============================================================================
	// 상세.
	//==============================================================================
	/**
	 * @returns { object }
	 */
	toDetail() {
		const detail = this.toSummary();
		detail.steps = this.getSteps();
		detail.artifacts = this.getArtifacts();
		detail.error = this.#error;
		return detail;
	}
}
