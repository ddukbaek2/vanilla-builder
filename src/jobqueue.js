//==============================================================================
// 포함 모듈 목록.
//==============================================================================
const System = globalThis;
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { Job, JobState, StepState, STEP_KINDS } from "./job.js";
import { loadBuildSpec } from "./buildspec.js";
import { CommandRunner } from "./commandrunner.js";


const execFileAsync = promisify(execFile);


//==============================================================================
// 데이터 디렉토리 안의 이름.
//==============================================================================
const BUILDS_DIRECTORY_NAME = "builds";
const TEMP_DIRECTORY_NAME = "tmp";
const COUNTER_FILENAME = "counter.json";


//==============================================================================
// 명세 검증 실패. (HTTP 400 으로 이어진다)
//==============================================================================
export class BuildSpecError extends System.Error {
	//==============================================================================
	// 멤버 변수 목록.
	//==============================================================================
	/** @private @type { string[] } */ #errors;

	//==============================================================================
	// 생성.
	//==============================================================================
	/**
	 * @param { string[] } errors
	 */
	constructor(errors) {
		super("빌드 명세가 올바르지 않습니다.");
		this.#errors = errors;
	}

	//==============================================================================
	// 오류 목록 반환.
	//==============================================================================
	/**
	 * @returns { string[] }
	 */
	getErrors() {
		return this.#errors;
	}
}


//==============================================================================
// 작업 큐. (작업 생성, 순차 실행, 취소, 재시작 복원, 종료)
//
// 작업 디렉토리는 <워크스페이스>/<app.id>/builds/<id> 다. 워크스페이스는 설정에서 읽는다.
// 작업 번호 카운터와 임시 공간은 워크스페이스가 바뀌어도 이어지도록 홈 디렉토리에 둔다.
//
// 빌더는 플랫폼 이름 → { prepare, build, deliver } 객체다. 각 메서드는 컨텍스트를 받아
// 비동기로 끝나며, 던지면 그 단계가 실패한 것으로 본다.
// 컨텍스트: { job, spec, platform, runner, projectDirectory, webDirectory, buildDirectory, artifactsDirectory }
//==============================================================================
export class JobQueue {
	//==============================================================================
	// 멤버 변수 목록.
	//==============================================================================
	/** @private @type { object } */ #settings;
	/** @private @type { object } */ #builders;
	/** @private @type { Map } */ #jobs;
	/** @private @type { Job[] } */ #waiting;
	/** @private @type { Job | null } */ #runningJob;
	/** @private @type { Promise | null } */ #runningPromise;
	/** @private @type { CommandRunner | null } */ #runner;
	/** @private @type { boolean } */ #processing;
	/** @private @type { boolean } */ #stopped;

	//==============================================================================
	// 생성.
	//==============================================================================
	/**
	 * @param { object } settings 서버 설정 (홈, 워크스페이스)
	 * @param { object } builders 플랫폼 이름 → 빌더
	 */
	constructor(settings, builders) {
		this.#settings = settings;
		this.#builders = builders;
		this.#jobs = new System.Map();
		this.#waiting = [];
		this.#runningJob = null;
		this.#runningPromise = null;
		this.#runner = null;
		this.#processing = false;
		this.#stopped = false;
	}

	//==============================================================================
	// 서버 설정 반환.
	//==============================================================================
	/**
	 * @returns { object }
	 */
	getSettings() {
		return this.#settings;
	}

	//==============================================================================
	// 빌더가 등록된 플랫폼 이름 목록 반환.
	//==============================================================================
	/**
	 * @returns { string[] }
	 */
	getSupportedPlatforms() {
		return System.Object.keys(this.#builders);
	}

	//==============================================================================
	// 실행 중인 작업 반환.
	//==============================================================================
	/**
	 * @returns { Job | null }
	 */
	getRunningJob() {
		return this.#runningJob;
	}

	//==============================================================================
	// 작업 하나 반환.
	//==============================================================================
	/**
	 * @param { number } jobId
	 * @returns { Job | undefined }
	 */
	getJob(jobId) {
		return this.#jobs.get(jobId);
	}

	//==============================================================================
	// 작업 목록 반환. (최신순)
	//==============================================================================
	/**
	 * @returns { Job[] }
	 */
	listJobs() {
		const jobs = System.Array.from(this.#jobs.values());
		jobs.sort((left, right) => {
			const leftId = left.getId();
			const rightId = right.getId();
			return rightId - leftId;
		});
		return jobs;
	}

	//==============================================================================
	// 재시작 복원. 워크스페이스의 */builds/*/job.json 을 모두 읽는다.
	// 실행 중이던 작업은 실패로, 대기 중이던 작업은 번호 순으로 큐에 되돌린다.
	//==============================================================================
	restore() {
		const homeDirectory = this.#settings.getHomeDirectory();
		const workspaceDirectory = this.#settings.getWorkspaceDirectory();
		const tempDirectory = NodePath.join(homeDirectory, TEMP_DIRECTORY_NAME);
		NodeFs.rmSync(tempDirectory, { recursive: true, force: true });
		NodeFs.mkdirSync(workspaceDirectory, { recursive: true });

		const restoredJobs = [];
		const projectEntries = NodeFs.readdirSync(workspaceDirectory, { withFileTypes: true });
		for (const projectEntry of projectEntries) {
			if (!projectEntry.isDirectory()) {
				continue;
			}
			const buildsDirectory = NodePath.join(workspaceDirectory, projectEntry.name, BUILDS_DIRECTORY_NAME);
			if (!NodeFs.existsSync(buildsDirectory)) {
				continue;
			}
			const buildEntries = NodeFs.readdirSync(buildsDirectory, { withFileTypes: true });
			for (const buildEntry of buildEntries) {
				if (!buildEntry.isDirectory() || !/^\d+$/.test(buildEntry.name)) {
					continue;
				}
				const jobDirectory = NodePath.join(buildsDirectory, buildEntry.name);
				try {
					const job = Job.load(jobDirectory);
					restoredJobs.push(job);
				}
				catch (loadError) {
					console.error(`[queue] 작업 복원 실패 (${jobDirectory}): ${loadError.message}`);
				}
			}
		}
		restoredJobs.sort((left, right) => {
			const leftId = left.getId();
			const rightId = right.getId();
			return leftId - rightId;
		});

		for (const job of restoredJobs) {
			const jobId = job.getId();
			this.#jobs.set(jobId, job);
			const jobState = job.getState();
			if (jobState === JobState.running) {
				for (const step of job.getSteps()) {
					if (step.state === StepState.running || step.state === StepState.pending) {
						job.setStepState(step.name, StepState.canceled);
					}
				}
				job.finish(JobState.failed, "서버 재시작으로 중단되었습니다.");
			}
			else if (jobState === JobState.queued) {
				this.#waiting.push(job);
			}
		}
		this.processQueue();
	}

	//==============================================================================
	// 작업 생성. zip 을 전개하고 명세를 검증한 뒤 큐에 넣는다.
	// 검증에 실패하면 작업을 만들지 않고 BuildSpecError 를 던진다.
	//==============================================================================
	/**
	 * @param { string } zipPath 업로드된 zip 파일 경로 (호출자가 정리한다)
	 * @param { string[] | null } targetsFilter 명세의 일부 플랫폼만 빌드할 때
	 * @returns { Promise<Job> }
	 */
	async createJob(zipPath, targetsFilter) {
		const homeDirectory = this.#settings.getHomeDirectory();
		const tempDirectory = NodePath.join(homeDirectory, TEMP_DIRECTORY_NAME, randomUUID());
		const projectDirectory = NodePath.join(tempDirectory, "project");
		NodeFs.mkdirSync(projectDirectory, { recursive: true });

		try {
			try {
				await execFileAsync("unzip", ["-q", "-o", zipPath, "-d", projectDirectory]);
			}
			catch (unzipError) {
				throw new BuildSpecError([`zip 전개 실패: ${unzipError.message}`]);
			}

			const supportedPlatforms = this.getSupportedPlatforms();
			const loadResult = loadBuildSpec(projectDirectory, supportedPlatforms);
			if (loadResult.errors.length > 0) {
				throw new BuildSpecError(loadResult.errors);
			}
			const spec = loadResult.spec;
			const targets = this.selectTargets(spec, targetsFilter);

			const jobId = this.allocateJobId();
			const workspaceDirectory = this.#settings.getWorkspaceDirectory();
			const jobDirectory = NodePath.join(workspaceDirectory, spec.app.id, BUILDS_DIRECTORY_NAME, System.String(jobId));
			NodeFs.mkdirSync(jobDirectory, { recursive: true });
			const finalProjectDirectory = NodePath.join(jobDirectory, "project");
			NodeFs.renameSync(projectDirectory, finalProjectDirectory);

			const job = new Job(jobId, jobDirectory, spec, targets);
			job.save();
			this.#jobs.set(jobId, job);
			this.#waiting.push(job);
			this.processQueue();
			return job;
		}
		finally {
			NodeFs.rmSync(tempDirectory, { recursive: true, force: true });
		}
	}

	//==============================================================================
	// 빌드할 플랫폼 결정. 필터가 있으면 명세의 플랫폼 중 요청된 것만 (명세 순서 유지).
	//==============================================================================
	/**
	 * @param { object } spec
	 * @param { string[] | null } targetsFilter
	 * @returns { string[] }
	 */
	selectTargets(spec, targetsFilter) {
		const specPlatforms = System.Object.keys(spec.targets);
		if (targetsFilter === null) {
			return specPlatforms;
		}
		const errors = [];
		for (const platform of targetsFilter) {
			if (!specPlatforms.includes(platform)) {
				errors.push(`요청한 플랫폼이 명세에 없습니다: ${platform}`);
			}
		}
		if (errors.length > 0) {
			throw new BuildSpecError(errors);
		}
		return specPlatforms.filter((platform) => {
			return targetsFilter.includes(platform);
		});
	}

	//==============================================================================
	// 작업 번호 발급. counter.json 에 다음 번호를 보관한다.
	//==============================================================================
	/**
	 * @returns { number }
	 */
	allocateJobId() {
		const homeDirectory = this.#settings.getHomeDirectory();
		NodeFs.mkdirSync(homeDirectory, { recursive: true });
		const counterPath = NodePath.join(homeDirectory, COUNTER_FILENAME);
		let nextId = 1;
		if (NodeFs.existsSync(counterPath)) {
			const counterText = NodeFs.readFileSync(counterPath, "utf8");
			const counter = System.JSON.parse(counterText);
			nextId = counter.nextId;
		}
		const counterText = System.JSON.stringify({ nextId: nextId + 1 }, null, "\t");
		NodeFs.writeFileSync(counterPath, counterText, "utf8");
		return nextId;
	}

	//==============================================================================
	// 취소. 대기 중이면 바로 끝내고, 실행 중이면 실행 중인 명령을 끊는다.
	// 이미 끝난 작업이면 false.
	//==============================================================================
	/**
	 * @param { number } jobId
	 * @returns { boolean }
	 */
	cancelJob(jobId) {
		const job = this.#jobs.get(jobId);
		if (job === undefined || job.isFinished()) {
			return false;
		}
		job.requestCancel();

		const waitingIndex = this.#waiting.indexOf(job);
		if (waitingIndex >= 0) {
			this.#waiting.splice(waitingIndex, 1);
			for (const step of job.getSteps()) {
				job.setStepState(step.name, StepState.canceled);
			}
			job.finish(JobState.canceled, "대기 중 취소되었습니다.");
			return true;
		}

		if (this.#runningJob === job && this.#runner !== null) {
			this.#runner.cancel();
		}
		return true;
	}

	//==============================================================================
	// 종료. 실행 중인 명령을 끊고 그 작업이 취소로 기록될 때까지 기다린다.
	// 대기 작업은 손대지 않는다. (다음 기동 때 큐로 복원된다)
	//==============================================================================
	/**
	 * @returns { Promise<void> }
	 */
	async shutdown() {
		this.#stopped = true;
		if (this.#runningJob !== null) {
			this.#runningJob.requestCancel();
		}
		if (this.#runner !== null) {
			this.#runner.cancel();
		}
		if (this.#runningPromise !== null) {
			await this.#runningPromise;
		}
	}

	//==============================================================================
	// 큐 처리. 대기 작업을 하나씩 순서대로 실행한다. 이미 돌고 있으면 아무것도 하지 않는다.
	//==============================================================================
	processQueue() {
		if (this.#processing) {
			return;
		}
		this.#processing = true;
		const processLoop = async () => {
			while (this.#waiting.length > 0 && !this.#stopped) {
				const job = this.#waiting.shift();
				this.#runningPromise = this.runJob(job);
				await this.#runningPromise;
				this.#runningPromise = null;
			}
			this.#processing = false;
		};
		processLoop().catch((loopError) => {
			console.error(`[queue] 처리 중 예외: ${loopError.message}`);
			this.#processing = false;
		});
	}

	//==============================================================================
	// 작업 하나 실행. 플랫폼 순서대로 prepare → build → deliver.
	// 한 플랫폼이 실패하면 그 플랫폼의 남은 단계는 건너뛰고 다음 플랫폼으로 간다.
	//==============================================================================
	/**
	 * @param { Job } job
	 * @returns { Promise<void> }
	 */
	async runJob(job) {
		this.#runningJob = job;
		this.#runner = new CommandRunner(job);

		const jobId = job.getId();
		const spec = job.getSpec();
		const targets = job.getTargets();
		const projectDirectory = job.getProjectDirectory();
		const artifactsDirectory = job.getArtifactsDirectory();
		const webDirectory = NodePath.resolve(projectDirectory, spec.source.webDir);

		try {
			NodeFs.mkdirSync(artifactsDirectory, { recursive: true });
			job.start();
			job.appendLog(`[job] #${jobId} 시작. 대상: ${targets.join(", ")}\n`);

			const failedSteps = [];
			for (const platform of targets) {
				const builder = this.#builders[platform];
				const buildDirectory = job.getBuildDirectory(platform);
				NodeFs.mkdirSync(buildDirectory, { recursive: true });
				const context = {
					job: job,
					spec: spec,
					platform: platform,
					runner: this.#runner,
					projectDirectory: projectDirectory,
					webDirectory: webDirectory,
					buildDirectory: buildDirectory,
					artifactsDirectory: artifactsDirectory,
				};

				let platformFailed = false;
				for (const stepKind of STEP_KINDS) {
					const stepName = `${platform}:${stepKind}`;
					if (job.isCancelRequested()) {
						job.setStepState(stepName, StepState.canceled);
						continue;
					}
					if (platformFailed) {
						job.setStepState(stepName, StepState.skipped);
						continue;
					}

					job.setStepState(stepName, StepState.running);
					job.appendLog(`[${stepName}] 시작\n`);
					try {
						await builder[stepKind](context);
						job.setStepState(stepName, StepState.succeeded);
						job.appendLog(`[${stepName}] 성공\n`);
					}
					catch (stepError) {
						if (job.isCancelRequested()) {
							job.setStepState(stepName, StepState.canceled);
							job.appendLog(`[${stepName}] 취소\n`);
						}
						else {
							job.setStepState(stepName, StepState.failed);
							job.appendLog(`[${stepName}] 실패: ${stepError.message}\n`);
							platformFailed = true;
							failedSteps.push(stepName);
						}
					}
				}
			}

			let finalState = JobState.succeeded;
			let finalError = null;
			if (job.isCancelRequested()) {
				finalState = JobState.canceled;
				finalError = "취소되었습니다.";
			}
			else if (failedSteps.length > 0) {
				finalState = JobState.failed;
				finalError = `실패한 단계: ${failedSteps.join(", ")}`;
			}
			job.appendLog(`[job] 종료: ${finalState}\n`);
			job.finish(finalState, finalError);
		}
		catch (unexpectedError) {
			job.appendLog(`[job] 예기치 않은 오류: ${unexpectedError.message}\n`);
			job.finish(JobState.failed, unexpectedError.message);
		}
		finally {
			this.#runningJob = null;
			this.#runner = null;
		}
	}
}
