# WhisPlay - 실시간 음성 번역 및 자막 오버레이 시스템

WhisPlay는 실시간 음성을 텍스트로 변환하고 번역하여 OBS 스트리밍 오버레이로 표시하는 웹 애플리케이션입니다. 강의, 스트리밍, 화상 회의 등에서 실시간 자막 및 번역 기능이 필요할 때 유용하게 사용할 수 있습니다.

## 주요 기능

- 브라우저 마이크를 통한 실시간 음성 녹음
- [Lemonfox.ai] API를 이용한 음성-텍스트 변환 (STT)
- [DeepL] API를 통한 자동 언어 감지 및 한국어 번역
- WebSocket을 통한 실시간 번역 결과 전송
- OBS용 브라우저 소스로 사용 가능한 오버레이 페이지
- 타이핑 효과와 함께 표시되는 번역 텍스트

## 시스템 요구사항

- Node.js 18.x 이상
- npm 또는 yarn
- FFmpeg (자동으로 설치됨)
- Lemonfox.ai API 키
- DeepL API 키 (Free 또는 Pro)

## 설치 방법

1. 저장소 클론 또는 다운로드

```bash
git clone https://github.com/ipcgrdn/whispLay.git
cd whisplay
```

2. 의존성 설치

```bash
npm install
```

3. 환경 변수 설정

`.env` 파일을 루트 디렉토리에 생성하고 다음 내용을 추가합니다:

```
# 서버 설정
PORT=3000

# Lemonfox.ai 설정
LEMONFOX_API_KEY=your_lemonfox_api_key_here

# DeepL 설정
DEEPL_API_KEY=your_deepl_api_key_here

# 오디오 처리 설정
MAX_AUDIO_SIZE_MB=10
MAX_AUDIO_AGE_DAYS=7
```

## 실행 방법

개발 모드로 실행:

```bash
npm run dev
```

프로덕션 모드로 실행:

```bash
npm run build
npm run start:prod
```

서버가 시작되면 다음 주소로 접속할 수 있습니다:
- 메인 페이지: `http://localhost:3000`
- 오버레이 페이지: `http://localhost:3000/overlay.html`

## OBS에서 사용하는 방법

1. OBS Studio 실행
2. '소스' 섹션에서 '+' 버튼을 클릭하고 '브라우저'를 선택
3. 새 브라우저 소스 이름 입력 (예: "실시간 번역 자막")
4. 다음 설정을 입력:
   - URL: `http://localhost:3000/overlay.html`
   - 너비: 적절한 너비 (예: 1280)
   - 높이: 적절한 높이 (예: 200)
   - 사용자 지정 CSS: 필요 없음 (이미 스타일이 내장됨)
5. '확인'을 클릭하여 브라우저 소스 추가

## 사용 방법

1. 메인 페이지(`http://localhost:3000`)에 접속
2. '녹음 시작' 버튼을 클릭하여 마이크 녹음 시작
3. 말하기 시작하면 실시간으로 텍스트 변환 및 번역이 이루어짐
4. OBS 오버레이에 번역 결과가 표시됨
5. '녹음 중지' 버튼으로 녹음 종료

## 자막 스타일 변경

오버레이 페이지는 다음과 같은 URL 파라미터를 통해 스타일을 변경할 수 있습니다:
- `?speed=20`: 타이핑 속도 조절 (숫자가 낮을수록 빠름, 기본값: 25)
- `?fontSize=28px`: 글꼴 크기 지정

예시: `http://localhost:3000/overlay.html?speed=15&fontSize=32px`

## 프로젝트 구조

```
whisplay/
├── src/                    # 소스 코드
│   ├── audio/              # 오디오 처리 관련 코드
│   │   ├── audio.gateway.ts     # WebSocket 게이트웨이
│   │   ├── audio.module.ts      # NestJS 모듈 정의
│   │   ├── audio.service.ts     # 오디오 처리 서비스
│   │   ├── translation.service.ts # 번역 서비스 (DeepL)
│   │   └── whisper.service.ts   # STT 서비스 (Lemonfox.ai)
│   ├── utils/              # 유틸리티 함수
│   │   └── text-processing.ts   # 텍스트 처리 유틸리티
│   ├── app.module.ts       # 메인 애플리케이션 모듈
│   └── main.ts             # 애플리케이션 시작점
├── public/                 # 정적 파일
│   ├── index.html          # 메인 페이지
│   └── overlay.html        # OBS 오버레이 페이지
├── audio_data/             # 오디오 임시 저장 디렉토리 (자동 생성)
├── .env                    # 환경 변수 설정
├── package.json            # 의존성 및 스크립트 정의
└── README.md               # 프로젝트 설명서 (현재 파일)
```

## 주요 기술 스택

- **Backend**:
  - NestJS: 서버 프레임워크
  - Socket.io: 실시간 WebSocket 통신
  - FFmpeg: 오디오 포맷 변환
  - Lemonfox.ai API: 음성-텍스트 변환
  - DeepL API: 텍스트 번역

- **Frontend**:
  - HTML/CSS/JavaScript: 웹 인터페이스
  - Socket.io-client: 실시간 데이터 수신
  - MediaRecorder API: 브라우저 녹음 기능

## 참고 사항

- 오디오 파일은 `audio_data` 디렉토리에 임시로 저장되며, 설정된 기간(기본 7일)이 지나면 자동으로 삭제됩니다.
- 기본적으로 모든 입력 언어를 한국어로 번역합니다.
- 브라우저 마이크 접근 권한이 필요합니다.
- 인터넷 연결이 필요합니다 (Lemonfox.ai 및 DeepL API 사용).
- 개발 모드에서는 모든 도메인에서 WebSocket 연결이 허용되지만, 프로덕션 환경에서는 보안을 위해 CORS 설정을 변경하는 것이 좋습니다.

## 문제 해결

- **마이크가 인식되지 않는 경우**: 브라우저 권한 설정을 확인하세요.
- **STT 변환이 작동하지 않는 경우**: Lemonfox.ai API 키를 확인하세요.
- **번역이 작동하지 않는 경우**: DeepL API 키를 확인하세요.
- **OBS에서 오버레이가 보이지 않는 경우**: 브라우저 소스 설정을 확인하고, 페이지를 새로고침하세요.
