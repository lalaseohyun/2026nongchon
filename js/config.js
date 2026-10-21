// config.js — 행사 설정. 프로젝트마다 이 파일과 questions.js를 교체한다

export const EVENT = {
  title: '농촌사회연대경제 활성화 협업교육',
  subtitle: '농촌사회연대경제 핵심 다시보기',
  lobbyMessage: 'QR코드를 접속해 주세요.',
  // 대기 화면 QR이 가리킬 참가자 주소. 진행자 화면을 어디서 열든(내 컴퓨터의 localhost 포함) 항상 이 주소로 QR을 만든다.
  joinUrl: 'https://lalaseohyun.github.io/2026nongchon/',
  teamLabel: '조',
  teamCount: 6,
  teamNames: {
    1: '1조', 2: '2조', 3: '3조', 4: '4조', 5: '5조', 6: '6조'
  },
  members: {},              // 예) 1: ['홍길동', '김철수'] — PIN 설정 화면 오인 선택 방지용
  joinMode: 'open',
  showRanking: true,
  tieBreak: 'speed'
};

// Firebase 콘솔 > 프로젝트 설정 > 내 앱 > SDK 설정 및 구성의 값을 그대로 붙여 넣는다.
// databaseURL은 지역이 포함된 전체 주소여야 한다 (...asia-southeast1.firebasedatabase.app).
export const FIREBASE = {
  apiKey: 'AIzaSyBfC2mj0Wn5hxewk9mROxs-rtLLWHpt_yQ',
  authDomain: 'gimje-31fa2.firebaseapp.com',
  databaseURL: 'https://gimje-31fa2-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'gimje-31fa2',
  appId: '1:745554895893:web:871658b06bbabbcfe91a1c'
};
