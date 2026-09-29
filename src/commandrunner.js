//==============================================================================
// 포함 모듈 목록.
//==============================================================================
const System = globalThis;
import { spawn } from "node:child_process";


//==============================================================================
// 명령 실행기. (작업 하나에 하나)
//
// 외부 명령을 띄우고 출력을 작업 로그에 그대로 흘려보낸다.
// 프로세스 그룹으로 띄우므로 취소 때 하위 프로세스까지 함께 끊는다.
//==============================================================================
export class CommandRunner {
	//==============================================================================
	// 멤버 변수 목록.
	//==============================================================================
	/** @private @type { object } */ #job;
	/** @private @type { object | null } */ #child;
	/** @private @type { boolean } */ #canceled;

	//==============================================================================
	// 생성.
	//==============================================================================
	/**
	 * @param { object } job 출력을 기록할 작업
	 */
	constructor(job) {
		this.#job = job;
		this.#child = null;
		this.#canceled = false;
	}

	//==============================================================================
	// 취소 여부.
	//==============================================================================
	/**
	 * @returns { boolean }
	 */
	isCanceled() {
		return this.#canceled;
	}

	//==============================================================================
	// 명령 실행. 종료 코드가 0 이 아니거나 취소되면 거부한다.
	//==============================================================================
	/**
	 * @param { string } command
	 * @param { string[] } commandArguments
	 * @param { { cwd: string, env?: object } } options
	 * @returns { Promise<void> }
	 */
	run(command, commandArguments, options) {
		return new System.Promise((resolve, reject) => {
			if (this.#canceled) {
				reject(new System.Error("취소된 작업입니다."));
				return;
			}

			const commandLine = [command].concat(commandArguments).join(" ");
			this.#job.appendLog(`$ ${commandLine}\n`);

			const child = spawn(command, commandArguments, {
				cwd: options.cwd,
				env: options.env,
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
			this.#child = child;

			child.stdout.on("data", (chunk) => {
				this.#job.appendLog(chunk);
			});
			child.stderr.on("data", (chunk) => {
				this.#job.appendLog(chunk);
			});
			child.on("error", (spawnError) => {
				this.#child = null;
				reject(spawnError);
			});
			child.on("close", (code, signal) => {
				this.#child = null;
				if (this.#canceled) {
					reject(new System.Error("취소되었습니다."));
					return;
				}
				if (code === 0) {
					resolve();
					return;
				}
				const reason = code === null ? `신호 ${signal}` : `종료 코드 ${code}`;
				reject(new System.Error(`${command} 실패 (${reason})`));
			});
		});
	}

	//==============================================================================
	// 취소. 실행 중인 명령의 프로세스 그룹에 종료 신호를 보낸다.
	//==============================================================================
	cancel() {
		this.#canceled = true;
		if (this.#child === null) {
			return;
		}
		const processId = this.#child.pid;
		try {
			System.process.kill(-processId, "SIGTERM");
		}
		catch (killError) {
			this.#job.appendLog(`[runner] 프로세스 종료 실패: ${killError.message}\n`);
		}
	}
}
