//==============================================================================
// 포함 모듈 목록.
//==============================================================================
const System = globalThis;
import * as NodeHttp from "node:http";
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";
import * as NodeOs from "node:os";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { BuildSpecError } from "./jobqueue.js";


//==============================================================================
// 작업 하위 경로 형식. /api/jobs/<id>[/log | /cancel | /artifacts/<filename>]
//==============================================================================
const JOB_PATH_PATTERN = /^\/api\/jobs\/(\d+)(?:\/(log|cancel)|\/artifacts\/([^/]+))?$/;


//==============================================================================
// JSON 본문 크기 상한.
//==============================================================================
const JSON_BODY_LIMIT_BYTES = 1024 * 1024;


//==============================================================================
// public/ 에서 그대로 내보내는 정적 파일. 경로 형식과 확장자별 Content-Type.
//==============================================================================
const STATIC_PATH_PATTERN = /^\/([A-Za-z0-9_.-]+\.(png|svg|ico|json))$/;
const STATIC_CONTENT_TYPES = {
	png: "image/png",
	svg: "image/svg+xml",
	ico: "image/x-icon",
	json: "application/json; charset=utf-8",
};


//==============================================================================
// HTTP 서버. (작업 API + 설정 API + 현황 페이지)
//
// 통신 계층만 담당한다. 작업에 대한 판단은 JobQueue 에, 설정 검증은 Settings 에 넘긴다.
//==============================================================================
export class HttpServer {
	//==============================================================================
	// 멤버 변수 목록.
	//==============================================================================
	/** @private @type { number } */ #port;
	/** @private @type { object } */ #jobQueue;
	/** @private @type { string } */ #publicDirectory;
	/** @private @type { object | null } */ #httpServer;

	//==============================================================================
	// 생성.
	//==============================================================================
	/**
	 * @param { number } port 0 이면 빈 포트를 고른다
	 * @param { object } jobQueue
	 * @param { string } publicDirectory 현황 페이지가 있는 디렉토리
	 */
	constructor(port, jobQueue, publicDirectory) {
		this.#port = port;
		this.#jobQueue = jobQueue;
		this.#publicDirectory = publicDirectory;
		this.#httpServer = null;
	}

	//==============================================================================
	// 실제로 열린 포트 반환.
	//==============================================================================
	/**
	 * @returns { number }
	 */
	getPort() {
		const address = this.#httpServer.address();
		return address.port;
	}

	//==============================================================================
	// 리스너 하나 열기. 열지 못하면 던진다.
	//==============================================================================
	/**
	 * @param { number } port
	 * @returns { Promise<object> }
	 */
	listen(port) {
		const httpServer = NodeHttp.createServer((request, response) => {
			this.handleRequest(request, response);
		});
		return new System.Promise((resolve, reject) => {
			const handleListenError = (listenError) => {
				reject(listenError);
			};
			httpServer.once("error", handleListenError);
			httpServer.listen(port, () => {
				httpServer.removeListener("error", handleListenError);
				resolve(httpServer);
			});
		});
	}

	//==============================================================================
	// 기동.
	//==============================================================================
	/**
	 * @returns { Promise<void> }
	 */
	async start() {
		this.#httpServer = await this.listen(this.#port);
		const port = this.getPort();
		console.log(`[server] 빌드 서버 기동 — 포트 ${port}`);
	}

	//==============================================================================
	// 포트 변경. 새 포트를 먼저 열고, 성공하면 옛 리스너를 돌려준다. (호출자가 응답 뒤에 닫는다)
	// 새 포트를 열지 못하면 던지고 옛 리스너는 그대로 둔다.
	//==============================================================================
	/**
	 * @param { number } newPort
	 * @returns { Promise<object> }
	 */
	async changePort(newPort) {
		const newServer = await this.listen(newPort);
		const oldServer = this.#httpServer;
		this.#httpServer = newServer;
		this.#port = newPort;
		return oldServer;
	}

	//==============================================================================
	// 종료.
	//==============================================================================
	/**
	 * @returns { Promise<void> }
	 */
	stop() {
		return new System.Promise((resolve) => {
			this.#httpServer.closeAllConnections();
			this.#httpServer.close(() => {
				resolve();
			});
		});
	}

	//==============================================================================
	// 요청 분배.
	//==============================================================================
	/**
	 * @param { object } request
	 * @param { object } response
	 */
	async handleRequest(request, response) {
		try {
			const requestUrl = new System.URL(request.url, "http://localhost");
			const requestPath = requestUrl.pathname;
			const requestMethod = request.method;

			if (requestPath === "/" && requestMethod === "GET") {
				this.handleStatusPage(response);
				return;
			}

			const staticMatch = requestPath.match(STATIC_PATH_PATTERN);
			if (staticMatch !== null && requestMethod === "GET") {
				this.handleStaticFile(staticMatch[1], staticMatch[2], response);
				return;
			}

			if (requestPath === "/api/jobs") {
				if (requestMethod === "POST") {
					const targetsQuery = requestUrl.searchParams.get("targets");
					await this.handleCreateJob(request, response, targetsQuery);
					return;
				}
				if (requestMethod === "GET") {
					this.handleListJobs(response);
					return;
				}
				this.sendJson(response, 405, { error: "허용되지 않는 메서드입니다." });
				return;
			}

			if (requestPath === "/api/settings") {
				if (requestMethod === "GET") {
					this.handleGetSettings(response);
					return;
				}
				if (requestMethod === "PUT") {
					await this.handleUpdateSettings(request, response);
					return;
				}
				this.sendJson(response, 405, { error: "허용되지 않는 메서드입니다." });
				return;
			}

			const jobMatch = requestPath.match(JOB_PATH_PATTERN);
			if (jobMatch !== null) {
				const jobId = System.Number(jobMatch[1]);
				const job = this.#jobQueue.getJob(jobId);
				if (job === undefined) {
					this.sendJson(response, 404, { error: `작업 #${jobId} 이 없습니다.` });
					return;
				}
				const action = jobMatch[2];
				const artifactName = jobMatch[3];
				if (action === undefined && artifactName === undefined && requestMethod === "GET") {
					this.handleGetJob(job, response);
					return;
				}
				if (action === "log" && requestMethod === "GET") {
					const offsetQuery = requestUrl.searchParams.get("offset");
					this.handleGetLog(job, response, offsetQuery);
					return;
				}
				if (action === "cancel" && requestMethod === "POST") {
					this.handleCancelJob(job, response);
					return;
				}
				if (artifactName !== undefined && requestMethod === "GET") {
					this.handleGetArtifact(job, artifactName, response);
					return;
				}
				this.sendJson(response, 405, { error: "허용되지 않는 메서드입니다." });
				return;
			}

			this.sendJson(response, 404, { error: "없는 경로입니다." });
		}
		catch (handleError) {
			console.error(`[server] 요청 처리 실패: ${handleError.message}`);
			if (!response.headersSent) {
				this.sendJson(response, 500, { error: handleError.message });
			}
			else {
				response.end();
			}
		}
	}

	//==============================================================================
	// 현황 페이지.
	//==============================================================================
	/**
	 * @param { object } response
	 */
	handleStatusPage(response) {
		const pagePath = NodePath.join(this.#publicDirectory, "index.html");
		const pageHtml = NodeFs.readFileSync(pagePath, "utf8");
		response.writeHead(200, {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-store",
		});
		response.end(pageHtml);
	}

	//==============================================================================
	// public/ 의 정적 파일. (아이콘 등) 하위 경로는 받지 않는다.
	//==============================================================================
	/**
	 * @param { string } filename
	 * @param { string } extension
	 * @param { object } response
	 */
	handleStaticFile(filename, extension, response) {
		const filePath = NodePath.join(this.#publicDirectory, filename);
		if (!NodeFs.existsSync(filePath)) {
			this.sendJson(response, 404, { error: "없는 경로입니다." });
			return;
		}
		const fileStats = NodeFs.statSync(filePath);
		response.writeHead(200, {
			"Content-Type": STATIC_CONTENT_TYPES[extension],
			"Content-Length": fileStats.size,
			"Cache-Control": "no-store",
		});
		const fileStream = NodeFs.createReadStream(filePath);
		fileStream.pipe(response);
	}

	//==============================================================================
	// 작업 생성. 본문(zip)을 임시 파일로 받아 큐에 넘긴다.
	//==============================================================================
	/**
	 * @param { object } request
	 * @param { object } response
	 * @param { string | null } targetsQuery 쉼표로 구분된 플랫폼 목록
	 */
	async handleCreateJob(request, response, targetsQuery) {
		const zipPath = NodePath.join(NodeOs.tmpdir(), `vanilla-builder-${randomUUID()}.zip`);
		try {
			const zipStream = NodeFs.createWriteStream(zipPath);
			await pipeline(request, zipStream);

			const zipStats = NodeFs.statSync(zipPath);
			if (zipStats.size === 0) {
				this.sendJson(response, 400, { errors: ["요청 본문이 비어 있습니다. zip 파일을 본문으로 보내야 합니다."] });
				return;
			}

			let targetsFilter = null;
			if (targetsQuery !== null) {
				targetsFilter = targetsQuery.split(",").map((platform) => {
					return platform.trim();
				}).filter((platform) => {
					return platform !== "";
				});
			}

			const job = await this.#jobQueue.createJob(zipPath, targetsFilter);
			const jobId = job.getId();
			this.sendJson(response, 201, { id: jobId });
		}
		catch (createError) {
			if (createError instanceof BuildSpecError) {
				const errors = createError.getErrors();
				this.sendJson(response, 400, { errors: errors });
				return;
			}
			throw createError;
		}
		finally {
			NodeFs.rmSync(zipPath, { force: true });
		}
	}

	//==============================================================================
	// 작업 목록.
	//==============================================================================
	/**
	 * @param { object } response
	 */
	handleListJobs(response) {
		const jobs = this.#jobQueue.listJobs();
		const summaries = jobs.map((job) => {
			return job.toSummary();
		});
		this.sendJson(response, 200, summaries);
	}

	//==============================================================================
	// 작업 상세.
	//==============================================================================
	/**
	 * @param { object } job
	 * @param { object } response
	 */
	handleGetJob(job, response) {
		const detail = job.toDetail();
		this.sendJson(response, 200, detail);
	}

	//==============================================================================
	// 로그. offset 바이트 이후만 돌려준다. 로그가 아직 없으면 빈 본문.
	//==============================================================================
	/**
	 * @param { object } job
	 * @param { object } response
	 * @param { string | null } offsetQuery
	 */
	handleGetLog(job, response, offsetQuery) {
		let offset = System.Number(offsetQuery);
		if (!System.Number.isInteger(offset) || offset < 0) {
			offset = 0;
		}
		const logPath = job.getLogPath();
		response.writeHead(200, {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "no-store",
		});
		if (!NodeFs.existsSync(logPath)) {
			response.end();
			return;
		}
		const logStats = NodeFs.statSync(logPath);
		if (offset >= logStats.size) {
			response.end();
			return;
		}
		const logStream = NodeFs.createReadStream(logPath, { start: offset });
		logStream.pipe(response);
	}

	//==============================================================================
	// 취소.
	//==============================================================================
	/**
	 * @param { object } job
	 * @param { object } response
	 */
	handleCancelJob(job, response) {
		const jobId = job.getId();
		const canceled = this.#jobQueue.cancelJob(jobId);
		if (!canceled) {
			this.sendJson(response, 409, { error: `작업 #${jobId} 은 이미 끝났습니다.` });
			return;
		}
		this.sendJson(response, 200, { id: jobId, canceled: true });
	}

	//==============================================================================
	// 산출물 다운로드.
	//==============================================================================
	/**
	 * @param { object } job
	 * @param { string } artifactName URL 인코딩된 파일명
	 * @param { object } response
	 */
	handleGetArtifact(job, artifactName, response) {
		const filename = System.decodeURIComponent(artifactName);
		const artifacts = job.getArtifacts();
		if (!artifacts.includes(filename)) {
			this.sendJson(response, 404, { error: `산출물이 없습니다: ${filename}` });
			return;
		}
		const artifactsDirectory = job.getArtifactsDirectory();
		const artifactPath = NodePath.join(artifactsDirectory, filename);
		if (!NodeFs.existsSync(artifactPath)) {
			this.sendJson(response, 404, { error: `산출물 파일이 없습니다: ${filename}` });
			return;
		}
		const artifactStats = NodeFs.statSync(artifactPath);
		const encodedFilename = System.encodeURIComponent(filename);
		response.writeHead(200, {
			"Content-Type": "application/octet-stream",
			"Content-Length": artifactStats.size,
			"Content-Disposition": `attachment; filename*=UTF-8''${encodedFilename}`,
		});
		const artifactStream = NodeFs.createReadStream(artifactPath);
		artifactStream.pipe(response);
	}

	//==============================================================================
	// 설정 조회.
	//==============================================================================
	/**
	 * @param { object } response
	 */
	handleGetSettings(response) {
		const settings = this.#jobQueue.getSettings();
		const settingsJson = settings.toJson();
		this.sendJson(response, 200, settingsJson);
	}

	//==============================================================================
	// 설정 변경. 포트가 바뀌면 새 포트를 먼저 열어 보고, 성공했을 때만 저장한 뒤
	// 응답을 보낸 다음 옛 포트를 닫는다. 새 포트를 못 열면 설정을 되돌리고 400.
	//==============================================================================
	/**
	 * @param { object } request
	 * @param { object } response
	 */
	async handleUpdateSettings(request, response) {
		const settings = this.#jobQueue.getSettings();
		let record = null;
		try {
			record = await this.readJsonBody(request);
		}
		catch (bodyError) {
			this.sendJson(response, 400, { errors: [bodyError.message] });
			return;
		}

		const previousPort = settings.getPort();
		const errors = settings.update(record);
		if (errors.length > 0) {
			this.sendJson(response, 400, { errors: errors });
			return;
		}

		const nextPort = settings.getPort();
		let oldServer = null;
		if (nextPort !== previousPort) {
			try {
				oldServer = await this.changePort(nextPort);
			}
			catch (portError) {
				settings.update({ port: previousPort });
				this.sendJson(response, 400, { errors: [`포트 ${nextPort} 를 열 수 없습니다: ${portError.message}`] });
				return;
			}
		}

		const settingsJson = settings.toJson();
		this.sendJson(response, 200, settingsJson);
		if (oldServer !== null) {
			response.on("finish", () => {
				oldServer.closeAllConnections();
				oldServer.close();
			});
			console.log(`[server] 포트 변경: ${previousPort} → ${nextPort}`);
		}
	}

	//==============================================================================
	// JSON 본문 읽기.
	//==============================================================================
	/**
	 * @param { object } request
	 * @returns { Promise<object> }
	 */
	readJsonBody(request) {
		return new System.Promise((resolve, reject) => {
			const chunks = [];
			let totalLength = 0;
			request.on("data", (chunk) => {
				totalLength += chunk.length;
				if (totalLength > JSON_BODY_LIMIT_BYTES) {
					reject(new System.Error("본문이 너무 큽니다."));
					request.destroy();
					return;
				}
				chunks.push(chunk);
			});
			request.on("end", () => {
				try {
					const bodyText = System.Buffer.concat(chunks).toString("utf8");
					const record = System.JSON.parse(bodyText);
					resolve(record);
				}
				catch (parseError) {
					reject(new System.Error(`본문이 JSON 이 아닙니다: ${parseError.message}`));
				}
			});
			request.on("error", reject);
		});
	}

	//==============================================================================
	// JSON 응답.
	//==============================================================================
	/**
	 * @param { object } response
	 * @param { number } statusCode
	 * @param { object } body
	 */
	sendJson(response, statusCode, body) {
		const bodyText = System.JSON.stringify(body);
		response.writeHead(statusCode, {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
		});
		response.end(bodyText);
	}
}
