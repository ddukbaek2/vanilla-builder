#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
# vanilla-builder 아이콘 생성. (docs/05-icon.md)
#
# 제미나이 이미지 생성 API 로 후보를 여러 장 뽑아 artwork/ 에 두고,
# 고른 후보를 1024 원본(artwork/icon-1024.png)과 웹용 256(public/icon.png)으로 저장한다.
#
# 사용법:
#   python3 tools/gen_icon.py              # 후보 3장 생성 후 1번을 저장
#   python3 tools/gen_icon.py --count 5    # 후보 5장
#   python3 tools/gen_icon.py --pick 2     # 생성 없이 2번 후보를 저장
#
# API 키는 프로젝트 루트 .env 의 GOOGLE_GEMINI_V3_KEY 를 읽는다.
# =============================================================================
import base64
import io
import json
import os
import sys
import time
import urllib.request

try:
	from PIL import Image
except ImportError:
	print("PIL(Pillow) 이 필요합니다: pip3 install Pillow")
	sys.exit(1)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ARTWORK_DIRECTORY = os.path.join(ROOT, "artwork")
PUBLIC_DIRECTORY = os.path.join(ROOT, "public")
ENV_PATH = os.path.join(ROOT, ".env")
ENV_KEY_NAME = "GOOGLE_GEMINI_V3_KEY"
API_MODEL = "gemini-2.5-flash-image"
API_URL = "https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent" % API_MODEL
ORIGINAL_SIZE = 1024
WEB_SIZE = 256

PROMPT = (
	"A premium macOS Big Sur style app icon, 1024x1024, rounded-square icon filling the entire frame edge to edge, "
	"no background around the icon. Design: a glossy three-dimensional vanilla-cream cube (like a soft ivory ceramic block, "
	"color #F3E4C2) with subtle bevels and gentle top-left lighting, sitting on a deep caramel-to-dark-chocolate vertical gradient "
	"background (#C98A3E at the top to #3B2314 at the bottom). Wrapped diagonally around the cube is a thin mint-green ribbon (#7FD3A5). "
	"A small brass wrench with realistic metal shading rests against the front-right corner. Soft drop shadow beneath the cube, "
	"faint highlight sheen on the top face, high-quality render, Apple design language, clean, elegant, no text, no letters, "
	"no watermark, no extra objects, centered composition."
)


# -----------------------------------------------------------------------------
# .env 에서 키 읽기.
# -----------------------------------------------------------------------------
def read_api_key():
	if not os.path.exists(ENV_PATH):
		print(".env 가 없습니다: %s" % ENV_PATH)
		sys.exit(1)
	with open(ENV_PATH, "r", encoding="utf-8") as env_file:
		for line in env_file:
			line = line.strip()
			if line.startswith(ENV_KEY_NAME + "="):
				return line[len(ENV_KEY_NAME) + 1:].strip().strip('"').strip("'")
	print(".env 에 %s 가 없습니다." % ENV_KEY_NAME)
	sys.exit(1)


# -----------------------------------------------------------------------------
# 이미지 한 장 요청.
# -----------------------------------------------------------------------------
def request_image(api_key, prompt, retries=3):
	body = {
		"contents": [{"parts": [{"text": prompt}]}],
		"generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
	}
	payload = json.dumps(body).encode("utf-8")
	for attempt in range(retries):
		try:
			request = urllib.request.Request(
				API_URL + "?key=" + api_key,
				data=payload,
				headers={"Content-Type": "application/json"},
			)
			with urllib.request.urlopen(request, timeout=120) as response:
				data = json.loads(response.read().decode("utf-8"))
			candidates = data.get("candidates", [])
			for candidate in candidates:
				for part in candidate.get("content", {}).get("parts", []):
					inline = part.get("inlineData")
					if inline is not None and inline.get("data"):
						raw = base64.b64decode(inline["data"])
						return Image.open(io.BytesIO(raw)).convert("RGBA")
			print("  응답에 이미지가 없습니다. 재시도 %d" % (attempt + 1))
		except Exception as error:
			print("  요청 실패(%s). 재시도 %d" % (error, attempt + 1))
		time.sleep(2 + attempt * 3)
	return None


# -----------------------------------------------------------------------------
# 정사각형으로 가운데 자르고 리사이즈.
# -----------------------------------------------------------------------------
def square_resize(image, size):
	width, height = image.size
	side = min(width, height)
	left = (width - side) // 2
	top = (height - side) // 2
	cropped = image.crop((left, top, left + side, top + side))
	return cropped.resize((size, size), Image.LANCZOS)


# -----------------------------------------------------------------------------
# 후보 경로.
# -----------------------------------------------------------------------------
def candidate_path(index):
	return os.path.join(ARTWORK_DIRECTORY, "icon-candidate-%d.png" % index)


# -----------------------------------------------------------------------------
# 고른 후보를 원본과 웹용으로 저장.
# -----------------------------------------------------------------------------
def save_pick(index):
	source_path = candidate_path(index)
	if not os.path.exists(source_path):
		print("후보가 없습니다: %s" % source_path)
		sys.exit(1)
	image = Image.open(source_path).convert("RGBA")
	original = square_resize(image, ORIGINAL_SIZE)
	original.save(os.path.join(ARTWORK_DIRECTORY, "icon-1024.png"))
	web = square_resize(image, WEB_SIZE)
	os.makedirs(PUBLIC_DIRECTORY, exist_ok=True)
	web.save(os.path.join(PUBLIC_DIRECTORY, "icon.png"))
	print("저장: artwork/icon-1024.png, public/icon.png (후보 %d)" % index)


# -----------------------------------------------------------------------------
# 메인.
# -----------------------------------------------------------------------------
def main():
	arguments = sys.argv[1:]
	count = 3
	pick = None
	index = 0
	while index < len(arguments):
		if arguments[index] == "--count" and index + 1 < len(arguments):
			count = int(arguments[index + 1])
			index += 2
			continue
		if arguments[index] == "--pick" and index + 1 < len(arguments):
			pick = int(arguments[index + 1])
			index += 2
			continue
		print("알 수 없는 인자: %s" % arguments[index])
		sys.exit(1)

	os.makedirs(ARTWORK_DIRECTORY, exist_ok=True)
	if pick is not None:
		save_pick(pick)
		return

	api_key = read_api_key()
	saved = []
	for number in range(1, count + 1):
		print("후보 %d 생성 중..." % number)
		image = request_image(api_key, PROMPT)
		if image is None:
			print("  실패. 건너뜁니다.")
			continue
		image.save(candidate_path(number))
		saved.append(number)
		print("  저장: artwork/icon-candidate-%d.png (%dx%d)" % (number, image.size[0], image.size[1]))
	if len(saved) == 0:
		print("생성된 후보가 없습니다.")
		sys.exit(1)
	save_pick(saved[0])


main()
