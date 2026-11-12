# declarative-font

텍스처의 글리프와 글리프 그룹을 인덱스로 조합하고, 결과를 유니코드 코드 포인트에 연결하는 선언형 구성 방식입니다. 규칙의 정본은 [SPEC.md](SPEC.md)(Draft v0.3)입니다. 현재는 선언을 조사하고 PNG로 미리 보는 CLI가 있으며, TTF 생성기는 아직 없습니다.

## 구성

- [`SPEC.md`](SPEC.md): 이미지 경로만 등록하는 텍스처셋, 그룹의 추출·임포트·반복, 유니코드 매핑의 명세
- [`examples/`](examples/): 8×4×4벌 한글 선언·텍스처·원본 BIN과 8×16 DOS 글리프 선언·BIN·텍스처
- [`tools/inspector/`](tools/inspector/): 선언 검사·PNG 미리보기 CLI ([사용법](tools/inspector/README.md), [명세](tools/inspector/SPEC.md))
- [`tools/font_bin_to_png.py`](tools/font_bin_to_png.py): BIN을 PNG 텍스처로 변환
- [`docs/`](docs/): 8×4×4벌 참고 문서와 이전 명세 백업

## 실행

Python 3.11 이상과 `uv`가 필요합니다. 프로젝트 루트에서:

```sh
cd tools/inspector
uv sync
uv run glyph-inspect list ../../examples/hangul.json
uv run glyph-inspect groups ../../examples/hangul.json --format json --parts
uv run glyph-inspect text ../../examples/hangul.json --text 'ASCII 가각나' --output text.png
uv run glyph-inspect text ../../examples/ascii.json --text 'ASCII' --output ascii.png
uv run pytest
```

한글 예제는 U+AC00부터 U+D7A3까지 11,172자를 정의합니다. ASCII 예제 [`examples/ascii.json`](examples/ascii.json)은 U+0020부터 U+007E까지 95자를 정의하며, 같은 그룹이 `hangul.json`에도 들어 있어 한 선언으로 영문과 한글을 함께 그릴 수 있습니다. 텍스처를 다시 만들려면 같은 디렉터리에서 `uv run python ../font_bin_to_png.py ../../examples/hangul.bin` 또는 `... ../../examples/ascii.bin`을 실행하면 됩니다. 출력 PNG는 입력 BIN 옆에 저장됩니다.
