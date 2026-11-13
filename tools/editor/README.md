# JJaim 텍스쳐 편집기

루트 [`SPEC.md`](../../SPEC.md)의 선언을 읽어 글자·부품 관계를 탐색하고, 원본 PNG 텍스처의 픽셀을 직접 고치는 정적 브라우저 앱입니다. 그룹 선언을 편집하는 [`../declaration-editor/`](../declaration-editor/)와는 별도 프로그램입니다. 요구 사항의 정본은 [`SPEC.md`](SPEC.md)입니다.

## 실행

서버 프로세스, 설치, 빌드 없이 정적 파일만으로 동작합니다. 저장소 루트에서 열거나 `tools/editor` 자체를 루트로 열어도 됩니다.

```sh
# 저장소 루트에서
python3 -m http.server 8000
# http://localhost:8000/tools/editor/

# 또는 tools/editor에서
cd tools/editor
python3 -m http.server 8000
# http://localhost:8000/
```

GitHub Pages에서는 `https://USER.github.io/REPO/tools/editor/`처럼 저장소 하위 경로로 엽니다. 모든 앱 자산 URL은 문서 기준 상대 경로이며 CDN·원격 API·분석 서버 호출이 없습니다. `file://` 직접 열기와 모바일 전용 UI는 지원 대상이 아닙니다.

## 화면

- 앱을 다시 열면 가장 최근에 연 작업을 자동으로 불러옵니다. 저장된 작업이 없을 때만 시작 화면이 나옵니다.
- 상단의 `▤`는 저장된 작업, 이력, 비교 팝업을 엽니다. 이력·diff·어니언 스킨·폰트 섀도 설정은 이 팝업 안에 있습니다.
- `☰` 메뉴에 선언/프로젝트 열기, 소스 연결, PNG/ZIP/프로젝트 내보내기가 있습니다.
- `◧`/`◨`로 왼쪽 탐색 패널과 오른쪽 정보 패널을 접습니다.
- 도구는 아이콘과 단축키를 함께 제공합니다. 오른쪽 위 `EN`/`한`으로 언어를, `☾`/`☀`로 다크 모드를 전환합니다. 다크 모드에서는 비트맵 글리프를 흰색으로 표시하며 저장 픽셀은 바꾸지 않습니다.
- 직계 자식 목록은 기본으로 현재 글리프에 실제 배치된 자식만 표시하고 각 발생 건의 글리프 미리보기를 보여줍니다.
- 결과 문맥 옆에는 현재 글리프에 배치된 직계 자식 글리프가 결과 미리보기와 같은 크기로 표시됩니다. 미리보기를 누르면 표시/숨기기가 토글되고, 좌상단 `↗` 버튼으로 해당 글리프를 엽니다.
- 정보 패널에는 구조적 `부품 사용처`만 남기고, 명령별 영향 후보/실제 변경 목록은 표시하지 않습니다.

## 입력과 출력

입력:

- UTF-8 JSON 선언 하나. `metadata`, `texture_sets`, `groups`와 v0.3 그룹 필드를 읽고, 알 수 없는 필드·중복 키·순환 임포트·유니코드 충돌은 거부합니다. 선언 원문은 수정하지 않습니다.
- `.jjaim` 프로젝트 파일. ZIP 안의 `project.json`과 `textures/` PNG에서 선언, 현재 픽셀, 이력, 보기 상태를 복원하며 항상 새 작업으로 엽니다.
- PNG 파일 여러 개 또는 PNG를 담은 일반 ZIP. ZIP은 stored/deflate만 읽고, 암호화·분할·ZIP64·심볼릭 링크·정규화 후 중복 경로를 거부합니다.
- 연결하는 PNG는 선언의 모든 추출 사각형을 포함할 만큼 커야 합니다. 부족하면 `이미지 W×H, 최소 W×H 필요` 오류로 연결을 거부하며 기존 자산은 바꾸지 않습니다.
- 이미지 없이 선언만 연 경우 소스 연결 표의 `빈 텍스쳐` 버튼으로 선언 최소 크기의 완전 투명 PNG를 만들 수 있습니다.
- 선택 사항: `.ttf`, `.otf`, `.woff` 참고 폰트. WOFF2와 TTC/OTC는 거부합니다.

출력:

- 선택한 현재 텍스처 PNG, 변경/전체 텍스처 ZIP.
- 선언 원문, 현재 PNG, 전체 이력, 현재 revision과 보기 상태를 담은 `.jjaim` 프로젝트 ZIP. 일반 텍스처 ZIP과 달리 `project.json`을 포함합니다.

출력:

- 현재 선택한 텍스처의 전체 PNG 한 장.
- 최초 원본과 픽셀이 다른 자산만 담은 ZIP.
- 연결된 모든 PNG를 담은 ZIP. ZIP에는 PNG만 들어가며 선언 JSON, 히스토리, 폰트, 썸네일은 들어가지 않습니다.

픽셀 정본은 straight-alpha 8비트 RGBA입니다. 원본과 현재 상태를 분리하고, 같은 논리 경로의 모든 셋/소스 별칭이 하나의 픽셀 버퍼를 공유합니다.

## 저장과 이력

작업은 IndexedDB에 자동 저장됩니다. 선언 원문, 자산 원본/현재 픽셀, 전체 revision 히스토리, 현재 head, redo 선택, 탐색/보기 설정, 참고 폰트가 포함됩니다.

- 픽셀 명령 하나가 revision 하나입니다. undo/redo는 현재 revision을 옮기고, undo 뒤 새로 편집하면 이전 분기를 삭제하지 않습니다.
- 이력 선택은 읽기 전용 미리보기이며, `이 상태로 복원`은 모든 PNG에 새 복원 명령을 추가합니다.
- 같은 작업을 두 탭에서 동시에 수정하지 못하도록 단일 작성자 잠금을 사용합니다. 두 번째 탭은 읽기 전용입니다.
- 브라우저 저장은 같은 프로필/오리진에만 유효합니다. 사이트 데이터를 지우면 작업이 사라지고, ZIP에는 히스토리가 없습니다.
- 저장에 실패하면 화면의 최신 편집을 유지한 채 `다시 저장`, `PNG 내보내기`, `임시 작업`을 제공하며 후속 픽셀 명령을 막습니다.

## 테스트

Node.js와 npm은 테스트에만 사용합니다. 런타임이나 Pages 배포 전에는 필요하지 않습니다.

```sh
cd tools/editor
npm install
npm test            # DOM 없는 핵심 테스트
npm run test:browser
```

`npm run test:browser`는 시스템 Chromium을 사용합니다. 경로가 다르면 `CHROMIUM_PATH=/path/to/chromium npm run test:browser`로 지정합니다. 브라우저 테스트는 저장소 하위 경로 정적 서버, 상대 자산 로드, 오프라인 파일 작업/저장/내보내기, 재접속 복원, 외부 요청 0회를 확인합니다.

## 내장 데이터와 라이선스

- 런타임 외부 라이브러리는 없습니다. `puppeteer-core`만 개발 의존성이며 Apache-2.0입니다.
- [`src/data/ksx1001.js`](src/data/ksx1001.js)는 KS X 1001 한글 2,350자의 코드 포인트 목록입니다. Python `euc_kr` 코덱으로 `0xB0..0xC8 × 0xA1..0xFE`를 디코딩해 생성했습니다. 재생성:

  ```sh
  python3 - <<'PY'
  import json
  cps = [ord(bytes([b1, b2]).decode("euc_kr")) for b1 in range(0xB0, 0xC9) for b2 in range(0xA1, 0xFF)]
  open("src/data/ksx1001.js", "w", encoding="utf-8").write(
      "// Generated from Python euc_kr bytes 0xB0..0xC8 x 0xA1..0xFE.\nexport default " + json.dumps(cps, separators=(",", ":")) + ";\n"
  )
  PY
  ```

- 예제 PNG/JSON은 저장소의 [`examples/`](../../examples/)를 읽기 전용 입력으로 사용합니다.

## 핵심 모듈

| 파일 | 책임 |
| --- | --- |
| `src/declaration.js` | 엄격 JSON 파서, 선언 검증, 유니코드/배치/사용처 인덱스 |
| `src/png.js`, `src/zip.js` | PNG 디코드/인코드, ZIP 읽기/쓰기와 경로·CRC 검증 |
| `src/assets.js` | 논리 경로별 원본/현재 픽셀 저장소와 변경 판정 |
| `src/compose.js` | 추출·임포트 합성, 레이어 트리, 영향 문자 계산 |
| `src/pixels.js`, `src/history.js` | 픽셀 드래프트, revision과 분기 보존 히스토리 |
| `src/persistence.js` | IndexedDB 작업 저장/복원과 탭 잠금 |
| `src/importer.js`, `src/exporter.js` | PNG/ZIP 연결·교체, 전체/변경 PNG 내보내기 |
| `src/unicode-sets.js`, `src/text.js` | 내장 유니코드 셋, 검색/페이지, 문구 미리보기 |
| `src/font.js` | 참고 폰트 cmap 판독과 섀도 설정 |
| `src/app.js` | 화면 상태, 탐색, 편집, 비교, 저장·내보내기 연결 |

## 알려진 제한

- 최신 데스크톱 Chromium을 자동 검증했습니다. Firefox는 수동 검증 대상이며 이 저장소의 자동 브라우저 테스트에는 포함되지 않습니다.
- 이미지 크기 변경, 그룹 선언 생성/편집, 여러 선언을 한 작업에 합치는 기능은 없습니다.
- 애니메이션 PNG, WOFF2, TTC/OTC, ZIP64, 암호화/분할 ZIP은 지원하지 않습니다.
