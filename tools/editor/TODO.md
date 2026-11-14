# TODO

## 작업 규칙

- unchecked 항목(`- [ ]`)만 수정한다.
- 항목을 고친 뒤 `- [x]`로 표시하고, 같은 줄 끝에 커밋 해시와 검증 결과를 짧게 남긴다.
- 사용자가 작성한 피드백 문구는 임의로 바꾸지 않는다.
- 피드백이 모호하면 추측해서 구현하지 않는다. 명확한 항목만 완료하고, 모호한 항목은 unchecked로 두고 항목 아래에 `확정 필요:`와 확인할 내용을 적는다.
- 한 번에 처리 가능한 unchecked 항목 전체를 처리하되, 서로 충돌하면 먼저 확인한다.

## 피드백

- [x] 프리셋 열때 한글/영문 텍스쳐 미리보기 — `e0f7c9e`, preview image + generator link browser test
    - "임의 크기의 한글/ascii 선언 생성하기: generate_declaration.py" 하고 생성 스크립트를 링크
- [x] 열기 메뉴에 새 프로젝트 버튼으로 선언이랑 모든 텍스쳐를 비운 새 작업을 생성하는 옵션 — `e0f7c9e`, empty-state reset browser test
    - 그냥 아무 저장된 작업이 없으면 나오는 기본 화면이 나오게

- [x] 프리셋 선택에 텍스쳐를 선택할 수 있도록 해. 루트에서 examples/fonts/read_ks.txt.utf8 보면 각각 폰트 파일에 폰트 이름 대응되어 있으니까, ascii랑 hangul프리셋에 폰트 텍스쳐 선택 추가해줘 — `4abfda0`, preset texture hash browser test

- [x] 폰트 섀도잉 값들에서 각 슬라이더를 세로로 정렬. 보통 table 쓰던데 — `6f06519`, browser column alignment test

- [x] 폰트 섀도잉 슬라이더들을 <라벨> <슬라이더> 를 가로로 배치. — `c4f467a`, browser same-row test
- [x] 폰트 섀도잉 좌표, 크기, 불투명도 값을 묶어서 목록으로 저장하고 네이밍할 수 있는 기능. — `034a5ea`, preset browser + persistence/project tests
    한글 폰트는 어떤 좌표의 어떤 크기, 영어 폰트는 어떤 좌표의 어떤 크기 등등을 하기 위함.
    - 확정: 프리셋 저장 위치를 브라우저 전역(localStorage), 작업별(IndexedDB), `.jjaim` 포함 중 어디에 둘지: .jjaim
    - 확정: 프리셋을 로드한 폰트 파일별로 분리할지, 모든 폰트에서 공용으로 쓸지: 모든 폰트에서 공용.
    - 확정: 프리셋에 `표시` 토글도 포함할지, 좌표·크기·불투명도만 저장할지: 표시 토글 비포함
    - 확정: 목록 UI를 select로 할지 버튼 목록으로 할지, 적용 외에 이름 변경/삭제까지 제공할지: 적용, 이름 변경/삭제 제공

- [x] 폰트 섀도잉 옵션이 팝업에 들어가 있어서 옮기면서 실시간으로 확인하기 불편함. 문구 미리보기 아래로 옮기고, 크기, x, y, 불투명도 값 설정을 슬라이더로. x, y는 폰트를 글꼴 칸 양 극단을 기준으로 — `c439f78`, compare move + slider range browser test
    - 확정: `글꼴 칸`이 현재 선택 그룹의 `width×height`인지, 로드한 폰트의 em/size 박스인지: 로드한 폰트의 범위 박스가 글리프 박스와 겹치기만 하면 되는. 즉 폰트 박스의 우측이 글리프 박스의 좌측 보다 우측이고, 폰트 박스의 좌측이 글리프 박스의 우측 보다 좌측이고, 위, 아래도 마찬가지로.
    - 확정: x/y 슬라이더 범위를 `-글리프 폭..+글리프 폭`, `-글리프 높이..+글리프 높이`로 할지, `0..폭`, `0..높이`로 할지: 위의 범위 방식에 따르면 그 값의 명시는 중요하지 않아보임. 차라리 퍼센테지?
    - 확정: 크기 슬라이더 범위를 기존 `0.25..1024` step `0.25`로 유지할지, 더 좁은 실용 범위로 할지: 실용 범위
    - 확정: 폰트 열기/표시 토글도 문구 미리보기 아래로 함께 옮길지, 크기·x·y·불투명도만 옮길지: 작업기록 팝업에서 아예 탭을 없애고, 비교 탭 내용을 전부 문구 미리보기 아래로 옮기기.

- [x] 편집 보드에서 선택한 영역을 복사하고 붙여넣기 할 수 있는 기능. + 복사한 것과 다른 글리프에도 붙여넣기 가능하도록 — `ddf4cd6`, unit + cross-glyph browser test
    - 예를 들어 initial_0[0]에서 복사해서 initial_1[0]으로 붙여넣기
    - 확정: 선택이 없을 때 복사 범위를 현재 글리프 전체로 할지: yes
    - 확정: 붙여넣기 위치를 현재 선택 영역 좌상단으로 할지, 원본과 같은 좌표로 할지, 선택이 없으면 (0,0)으로 할지: 원본과 같은 좌표.
    - 확정: 다른 크기 글리프에 붙여넣을 때 넘치는 픽셀을 trim할지 거부할지: trim
    - 확정: 투명 픽셀을 포함한 덮어쓰기로 붙여넣을지, source-over로 합성할지: source over
    - 확정: 실행 경로를 Ctrl/Cmd+C·V만 둘지, 툴바/메뉴 버튼도 추가할지: 툴바 버튼 추가
    - 확정: 앱 내부 clipboard만 쓸지, 시스템 clipboard 연동도 필요한지: 앱 내부 클립보드

- [x] 아무 저장된 작업이 없으면 나오는 기본 화면에서, 프리셋 버튼 추가 — `b8f6305`, empty-state preset browser test

- [x] 열기 메뉴에 프리셋 옵션. 누르면 프리셋 팝업 띄우고, hangul이랑 ascii 프리셋 (선언 + 텍스쳐) — `5492abe`, preset browser test
- [x] 설정 팝업에 언어 선택이 생겼으니, 영어/한글 토글 버튼은 없애. — `5492abe`, header removed + settings language test
- [x] 부품 사용처 목록 하단 버튼을 이전, 다음 말고 방향 아이콘으로. 다른 이전, 다음 버튼들도 아이콘으로 — `5492abe`, usage pager icon test

- [x] 밑에 context row 에 미리보기도 편집 보드처럼 항상 선명하게 해야할듯함. 너무 흐려짐. — `1aca766`, context dataURL + pixelated test

- [x] 글꼴 미리보기를 포함해서 비트맵들이 전부 anti aliasing이 꺼져있는 것 같은데, 켤 수 있도록 설정 — `3f3c3be`, settings AA toggle + browser test
- [x] 설정 팝업을 만들어서 언어랑 anti aliasing toggle을 넣기 — `3f3c3be`, settings dialog + language sync test

- [x] id="group-glyph-section" 가 id="group-index-controls" 바로 위나 아래에 있어야 함. — `0659383`, DOM sibling test

- [x] 내가 의미한 그룹 목록 그리드는 그룹 목록이 아니라 그룹 내부의 글꼴 목록이었음. — `7d7a1ce`, selected-group glyph grid + pager test

- [x] 그룹 목록 그리드는 우측에 그룹에서 직계 자식 위쪽에 있도록. — `bd17a4a`, DOM order browser test
- [x] 문구 미리보기를 왼쪽으로 옮기기. — `bd17a4a`, navigator containment test

- [x] 그룹에도 문자 셋과 같은 목록 미리보기 그리드를 추가. — `b3703b2`, group tile browser test
- [x] 그룹/문자셋 그리드를 접을 수 있게. — `b3703b2`, collapse + reload persistence test

- [x] dark/light 테마 바꿀때, 자동으로 직계 글리프 목록의 글리프 색이 변하지 않음. dark->light 이면 글꼴이 흰색으로 남는식. 한번 클릭 해주거나 다른 글꼴로 바꿔서 업데이트 되게 하면 그제서야 바뀜. — `ed8ea3d`, browser child preview theme test
- [x] checkbox still have rounded corners. 보통 appearance: none; 한 다음에 after나 before pseudo element로 하던데 — `ed8ea3d`, appearance:none + square check test

- [x] 예문 미리보기에 1,2,4 배율이 있는데, aspect ratio 보전이 안돼서, 높이만 남고 좌우로 줄어듦. 그냥 기본 anti aliasing 서 너비 100%로 하고, 누르면 popup 뜨는 방식으로. — `5c90504`, browser ratio + popup test
- [x] border radius 0으로 할때 checkbox 도 마찬가지로 — `5c90504`, checkbox radius test

- [x] UI에서 border radius 전부 0으로 하자 — `112f595`, all border-radius 0
- [x] 선택 영역이 움직일때 드래그 도중에는 선택 박스가 움직이지 않음. 드롭을 해야 박스가 움직임. 드래그 도중에도 박스가 움직여야함. — `e9edfdb`, browser drag test
- [x] 선택 영역이 전체 영역 밖으로 나갈 수 있어야 함. 밖에 나간건 trim되어야함. — `e9edfdb`, unit + browser trim test

- [x] design-taste-frontend 사용 — `0b59993`, before/after captures + Chromium/Firefox tests

- [x] 스펙 이름이 JJaim으로 정해졌으므로 제목을 JJaim Texture Editor / JJaim 텍스쳐 편집기 — `b04a82a`, title browser test

- [x] 그리드도 좀 얇음. 좀 더 두껍게 — `44f8ceb`, 2px grid browser pixel test
- [x] 자동으로 마지막 작업 불러오기 — `44f8ceb`, reload auto-load browser test
- [x] 선언 기반 텍스쳐 최소 크기로 선언만 주어졌을때 텍스쳐 연결 popup에 빈 텍스쳐 생성 버튼 — `44f8ceb`, blank texture unit + browser test
- [x] 프로젝트를 통째로 하나의 zip 파일로 내보내고 불러오는 기능 (텍스쳐 zip 불러오기와 호환. 선언과 텍스쳐를 하나의 zip에) — `9ba85a0`, project unit + browser roundtrip
    - 이건 구현할때 유저한테 디테일한 부분 질문 하면서 구현할것.
    - zip 포멧이지만 .jjaim 확장자 사용하기

- [x] 다크모드에서 그리드는 밝은색이어야함 — `c8fb4c2`, browser dark board test
- [x] 선택 영역 사각형 테두리가 얇음. 좀 더 두껍게 — `c8fb4c2`, 2px+ dashed border
- [x] 선택을 한 뒤 자동으로 move 모드로 변경 — `c8fb4c2`, browser test

- [x] context row에 직계 글리프 목록 미리보기와 직계 글리프 목록 toggle을 합치기: 글리프 미리보기 자체를 토글로 사용, 미리보기 사각형 좌상단에 글리프로 이동 버튼 — `2f8b4ce`, browser toggle/nav test
    + 직계 글리프 미리보기 목록의 중요도가 커졌으므로, 현재 id=context 만큼 크게, id=context 우측에 나열하는 방식으로.

- [x] 문자 셋 또는 부품 사용처에서 글꼴을 선택했을때 context row와 그리는 공간의 글꼴이 교체되지 않음. 현재는 context row의 현재 직계 자식 글리프 목록 표시만 선택된 글꼴의 직계 글리프 목록으로 교체됨. — `3c3ac9f`, browser canvas test

- [x] 다크모드일때 비트맵 글꼴은 하얀색이도록 — `018b330`, browser canvas test
- [x] 왼쪽 pane을 접으면 그리는 공간까지 사라지면 안됨. — `018b330`, explicit grid column + viewport test
- [x] 캐릭터 셋의 글꼴들의 aspect ratio는 유지. — `018b330`, fixed-box fit
- [x] 직계 자식 목록에 현재 글리프 배치가 존재하는 것은 글리프를 표시 — `018b330`, thumbnail test
- [x] context row에 현재 직계 자식 글리프 목록 표시 — `018b330`, child strip test
- [x] 부품 사용처 제외하고 영향 가능 문자, 실제 모양 변경은 제거 — `018b330`, DOM removed test
- [x] 제목 DGC Texture Editor / DGC 텍스쳐 편집기 — `018b330`, title test

- [x] ui 밀집도가 높음. 왼쪽, 오른쪽 Pane들 접는 기능 필요 — `6ff3ffd`, browser test
- [x] 텍스트가 많음. 연필, 지우개 같은 UI 는 아이콘 사용. — `6ff3ffd`
- [x] 브라우저에 저장됨 텍스트가 너비가 변하면서 UI가 불안정함. 저것도 아이콘 사용해서 너비 일정하게 유지 — `6ff3ffd`, fixed 22px
- [x] 저장된 작업은 header의 오른쪽으로 이동 — `6ff3ffd`
- [x] Header에 버튼이 많음. 내보내기/불러오기 popup또는 menu를 만들어. — `6ff3ffd`
- [x] 저장된 작업 + 이력 + 비교(어니언 스킨) popup 만들어서 분리 — `6ff3ffd`, records dialog tabs
- [x] 직계 자식 목록에서 현재 글리프에 배치가 존재하는 것만 표시하는 기능. 현재 글리프에 배치가 존재하는 것만 표시하는 것을 기본으로. — `6ff3ffd`, browser test
- [x] 폰트 섀도는 그리기 창(연필, 지우개 등 사용하는 부분)에서도 보여야함. 현재 아래에만 보임. — `6ff3ffd`, browser canvas test
- [x] 부품 사용처를 누르면 그 글리프로 이동하는 기능 — `6ff3ffd`, hangul browser test
- [x] 다크모드(토글) — `6ff3ffd`, browser test
- [x] i18n(한글, 영어) — `6ff3ffd`, browser test
