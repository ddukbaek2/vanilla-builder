//==============================================================================
// 포함 모듈 목록.
//==============================================================================
const System = globalThis;
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";
import * as NodeOs from "node:os";


//==============================================================================
// 설정 파일 이름과 기본 포트.
//==============================================================================
const SETTINGS_FILENAME = "settings.json";
export const DEFAULT_PORT = 8686;


//==============================================================================
// 서버 설정. (홈 디렉토리의 settings.json)
//
// 웹 UI 에서 바꾸는 값은 모두 여기에 둔다. 항목은 포트와 워크스페이스 둘뿐이다.
// 파일이 없으면 기본값으로 시작하고, 저장할 때 만든다.
//==============================================================================
export class Settings {
	//==============================================================================
	// 멤버 변수 목록.
	//==============================================================================
	/** @private @type { string } */ #homeDirectory;
	/** @private @type { number } */ #port;
	/** @private @type { string } */ #workspaceDirectory;

	//==============================================================================
	// 생성.
	//==============================================================================
	/**
	 * @param { string } homeDirectory 설정과 서버 상태를 두는 고정 디렉토리
	 */
	constructor(homeDirectory) {
		this.#homeDirectory = homeDirectory;
		this.#port = DEFAULT_PORT;
		this.#workspaceDirectory = homeDirectory;
	}

	//==============================================================================
	// 홈 디렉토리 반환.
	//==============================================================================
	/**
	 * @returns { string }
	 */
	getHomeDirectory() {
		return this.#homeDirectory;
	}

	//==============================================================================
	// 포트 반환.
	//==============================================================================
	/**
	 * @returns { number }
	 */
	getPort() {
		return this.#port;
	}

	//==============================================================================
	// 워크스페이스 디렉토리 반환. (프로젝트별 폴더가 만들어지는 곳)
	//==============================================================================
	/**
	 * @returns { string }
	 */
	getWorkspaceDirectory() {
		return this.#workspaceDirectory;
	}

	//==============================================================================
	// settings.json 읽기. 없으면 기본값 그대로.
	//==============================================================================
	load() {
		const settingsPath = NodePath.join(this.#homeDirectory, SETTINGS_FILENAME);
		if (!NodeFs.existsSync(settingsPath)) {
			return;
		}
		const settingsText = NodeFs.readFileSync(settingsPath, "utf8");
		const record = System.JSON.parse(settingsText);
		if (System.Number.isInteger(record.port)) {
			this.#port = record.port;
		}
		if (typeof record.workspaceDir === "string" && record.workspaceDir !== "") {
			this.#workspaceDirectory = record.workspaceDir;
		}
	}

	//==============================================================================
	// settings.json 저장.
	//==============================================================================
	save() {
		NodeFs.mkdirSync(this.#homeDirectory, { recursive: true });
		const record = this.toJson();
		const recordText = System.JSON.stringify(record, null, "\t");
		const settingsPath = NodePath.join(this.#homeDirectory, SETTINGS_FILENAME);
		NodeFs.writeFileSync(settingsPath, recordText, "utf8");
	}

	//==============================================================================
	// 설정 변경. 검증에 실패하면 아무것도 바꾸지 않고 오류 목록을 돌려준다.
	// 통과하면 적용하고 저장한다. (포트 변경의 실제 반영은 HTTP 서버가 한다)
	//==============================================================================
	/**
	 * @param { object } record { port?, workspaceDir? }
	 * @returns { string[] }
	 */
	update(record) {
		const errors = [];
		if (record === null || typeof record !== "object" || System.Array.isArray(record)) {
			errors.push("설정은 JSON 객체여야 합니다.");
			return errors;
		}

		let nextPort = this.#port;
		if (record.port !== undefined) {
			if (!System.Number.isInteger(record.port) || record.port < 1 || record.port > 65535) {
				errors.push("port 는 1 이상 65535 이하의 정수여야 합니다.");
			}
			else {
				nextPort = record.port;
			}
		}

		let nextWorkspaceDirectory = this.#workspaceDirectory;
		if (record.workspaceDir !== undefined) {
			if (typeof record.workspaceDir !== "string" || record.workspaceDir.trim() === "") {
				errors.push("workspaceDir 은 비어 있지 않은 문자열이어야 합니다.");
			}
			else {
				let candidate = record.workspaceDir.trim();
				if (candidate === "~" || candidate.startsWith("~/")) {
					const homeDirectory = NodeOs.homedir();
					candidate = NodePath.join(homeDirectory, candidate.slice(1));
				}
				if (!NodePath.isAbsolute(candidate)) {
					errors.push("workspaceDir 은 절대 경로여야 합니다. (~/ 로 시작해도 됩니다)");
				}
				else {
					try {
						NodeFs.mkdirSync(candidate, { recursive: true });
						const candidateStats = NodeFs.statSync(candidate);
						if (!candidateStats.isDirectory()) {
							errors.push(`workspaceDir 이 디렉토리가 아닙니다: ${candidate}`);
						}
						else {
							nextWorkspaceDirectory = candidate;
						}
					}
					catch (directoryError) {
						errors.push(`workspaceDir 을 만들 수 없습니다: ${directoryError.message}`);
					}
				}
			}
		}

		if (errors.length > 0) {
			return errors;
		}
		this.#port = nextPort;
		this.#workspaceDirectory = nextWorkspaceDirectory;
		this.save();
		return [];
	}

	//==============================================================================
	// API 응답용.
	//==============================================================================
	/**
	 * @returns { object }
	 */
	toJson() {
		return {
			port: this.#port,
			workspaceDir: this.#workspaceDirectory,
		};
	}
}
