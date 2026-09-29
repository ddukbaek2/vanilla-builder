//==============================================================================
// vanilla-builder 메뉴 막대 아이콘. (docs/06-menubar.md)
//
// 앱 번들 없이 swiftc 로 컴파일한 실행 파일 하나다. Dock 에는 나오지 않는다.
// 5초마다 서버의 /api/jobs 를 읽어 대기/진행 중 수를 메뉴에 보여 준다.
//
// 컴파일: swiftc -O -o vanilla-builder-menubar menubar/main.swift
//==============================================================================
import AppKit
import Foundation

let SERVICE_LABEL = "com.ddukbaek2.vanilla-builder"
let MENUBAR_LABEL = "com.ddukbaek2.vanilla-builder.menubar"
let DEFAULT_PORT = 8686
let POLL_INTERVAL_SECONDS = 5.0
let ICON_SIZE = 18.0

let homeDirectory = FileManager.default.homeDirectoryForCurrentUser
let builderHome = homeDirectory.appendingPathComponent(".vanilla-builder")
let settingsPath = builderHome.appendingPathComponent("settings.json")
let iconPath = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "")


//==============================================================================
// settings.json 에서 포트 읽기. 없으면 기본 포트.
//==============================================================================
func readPort() -> Int {
	guard let data = FileManager.default.contents(atPath: settingsPath.path) else {
		return DEFAULT_PORT
	}
	guard let record = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
		return DEFAULT_PORT
	}
	guard let port = record["port"] as? Int else {
		return DEFAULT_PORT
	}
	return port
}


//==============================================================================
// 메뉴 막대 컨트롤러.
//==============================================================================
final class MenuBarController: NSObject {
	private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
	private let statusMenuItem = NSMenuItem(title: "확인 중...", action: nil, keyEquivalent: "")
	private var timer: Timer?

	override init() {
		super.init()
		if let image = NSImage(contentsOf: iconPath) {
			image.size = NSSize(width: ICON_SIZE, height: ICON_SIZE)
			statusItem.button?.image = image
		}
		else {
			statusItem.button?.title = "VB"
		}
		statusItem.button?.toolTip = "vanilla-builder"

		let menu = NSMenu()
		statusMenuItem.isEnabled = false
		menu.addItem(statusMenuItem)
		menu.addItem(NSMenuItem.separator())
		menu.addItem(makeItem(title: "현황 페이지 열기", action: #selector(openStatusPage)))
		menu.addItem(makeItem(title: "서버 재시작", action: #selector(restartServer)))
		menu.addItem(NSMenuItem.separator())
		menu.addItem(makeItem(title: "종료", action: #selector(quitAll)))
		statusItem.menu = menu

		poll()
		timer = Timer.scheduledTimer(withTimeInterval: POLL_INTERVAL_SECONDS, repeats: true) { _ in
			self.poll()
		}
	}

	private func makeItem(title: String, action: Selector) -> NSMenuItem {
		let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
		item.target = self
		return item
	}

	//==============================================================================
	// 서버 상태 조회.
	//==============================================================================
	private func poll() {
		let port = readPort()
		guard let url = URL(string: "http://127.0.0.1:\(port)/api/jobs") else {
			return
		}
		var request = URLRequest(url: url)
		request.timeoutInterval = 3
		let task = URLSession.shared.dataTask(with: request) { data, _, error in
			var statusText = "서버 응답 없음 (포트 \(port))"
			var alive = false
			if error == nil, let data = data, let jobs = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
				let queued = jobs.filter { ($0["state"] as? String) == "queued" }.count
				let running = jobs.filter { ($0["state"] as? String) == "running" }.count
				statusText = "대기 \(queued) · 진행 중 \(running) · 전체 \(jobs.count)"
				alive = true
			}
			DispatchQueue.main.async {
				self.statusMenuItem.title = statusText
				self.statusItem.button?.alphaValue = alive ? 1.0 : 0.4
			}
		}
		task.resume()
	}

	@objc private func openStatusPage() {
		let port = readPort()
		if let url = URL(string: "http://localhost:\(port)/") {
			NSWorkspace.shared.open(url)
		}
	}

	@objc private func restartServer() {
		let process = Process()
		process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
		process.arguments = ["kickstart", "-k", "gui/\(getuid())/\(SERVICE_LABEL)"]
		try? process.run()
	}

	//==============================================================================
	// 종료. 서버와 메뉴 막대 아이콘을 모두 내린다. (다음 로그인이나 install.sh 로 다시 올라온다)
	//==============================================================================
	@objc private func quitAll() {
		for label in [SERVICE_LABEL, MENUBAR_LABEL] {
			let process = Process()
			process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
			process.arguments = ["bootout", "gui/\(getuid())/\(label)"]
			try? process.run()
			process.waitUntilExit()
		}
		NSApp.terminate(nil)
	}
}


//==============================================================================
// 진입점.
//==============================================================================
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let controller = MenuBarController()
application.run()
