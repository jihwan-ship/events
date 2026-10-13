# events 폴더 사용법

행사 페이지(ExpoPortal.html)를 행사마다 바꿔 주는 설정 파일 모음입니다.
코드(JS/HTML)는 건드리지 않고 이 폴더의 JSON만 고치면 됩니다.

## 행사 추가
1. `_template.json` 을 복사해서 `행사id.json` 으로 저장 (id는 영문/숫자/-/_ 만)
2. 안의 값(title, subtitle 등)을 행사에 맞게 수정
3. `index.json` 에 한 줄 추가 (`ready: true` 여야 목록에서 클릭됨)
4. 영상이 정해지면 `videosUrl` 에 그 행사의 영상 목록(videos.json 형식) 주소를 넣기

## 행사 제거
- `index.json` 에서 해당 줄 삭제 (목록에서 사라짐)
- 또는 `ready` 를 `false` 로 바꾸기 (목록엔 "준비 중"으로 남음)
- `행사id.json` 파일은 지워도 되고 남겨 둬도 됩니다

## 설정 항목 (행사id.json)
| 항목 | 설명 | 비우면 |
|---|---|---|
| pageTitle | 브라우저 탭 제목 | 기본값 |
| eyebrow | 제목 위 작은 영문 문구 | 기본값 |
| logo / logoAlt | 제목 옆 로고 이미지 경로 / 대체 텍스트 | 로고 없이 제목만 |
| title | 큰 제목 | 기본값 |
| subtitle | 설명 문구 (`\n` 으로 줄바꿈) | 기본값 |
| searchPlaceholder | 검색창 안내 문구 | 기본값 |
| heroImage | 상단 배경 이미지 경로 | CSS 기본 이미지 |
| videosUrl | 이 행사의 영상 목록 JSON 주소 | 기본(전체) 영상 목록 |
| popularTerms | 인기 태그 칩 후보 | 칩 없음 |

빠진 항목은 `default.json` 이 아니라 JS 안의 `DEFAULT_EVENT` 값으로 채워집니다.

## index.json 항목
`{ "id", "name", "category", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "venue", "ready" }`
- category: `Exhibition` / `Convention` / `Pop-up/Event` (색 점이 달라짐)
- ready: `true` 면 클릭 가능, `false` 면 "준비 중"

## 주의
- 파일을 더블클릭(file://)으로 열면 JSON을 못 읽습니다. Live Server 등으로 여세요.
- JSON은 마지막 항목 뒤에 쉼표(,)를 붙이면 에러가 납니다.
