# TODO

## 작업 규칙

- unchecked 항목(`- [ ]`)만 수정한다.
- 항목을 고친 뒤 `- [x]`로 표시하고, 같은 줄 끝에 커밋 해시와 검증 결과를 짧게 남긴다.
- 사용자가 작성한 피드백 문구는 임의로 바꾸지 않는다.
- 한 번에 unchecked 항목 전체를 처리하되, 서로 충돌하면 먼저 확인한다.

## 피드백

- [ ] design-taste-frontend 사용

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

## 아직 처리하지 말것. 나중에 모아서 요청할 예정

- [ ] ui 전반적 크기 증가. 지금은 좀 작아서 가독성이 별로임
- [ ] AI 느낌 줄이기 위해 taste-skill 도입?
