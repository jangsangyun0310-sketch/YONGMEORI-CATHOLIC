// Firebase 설정 — 관리자 구글 로그인과 휴대폰 푸시 알림에만 쓴다 (데이터 저장은 서버의 D1).
// 아래 값들은 Firebase 콘솔 "프로젝트 설정 > 일반 > 내 앱"에서 나오는 값이며,
// 비밀키가 아니라 공개되어도 되는 값입니다 (관리자 권한은 서버가 로그인 토큰과 관리자 명단으로 확인).
// 서학동성당과는 별도의 Firebase 프로젝트라 두 성당의 구독자·알림이 섞이지 않습니다.
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAENs_exymTcWYciCX1txgp6oNqUwyOXys",
  authDomain: "yongmeori-church.firebaseapp.com",
  projectId: "yongmeori-church",
  storageBucket: "yongmeori-church.firebasestorage.app",
  messagingSenderId: "900493543605",
  appId: "1:900493543605:web:ec90fd9ac9fc6e1d0156fc"
};

// Firebase 콘솔 > 프로젝트 설정 > 클라우드 메시징 > 웹 구성 > "웹 푸시 인증서" 에서 키 쌍을 생성하면 나오는 값
window.FIREBASE_VAPID_KEY = "BI1DV79Cf0IWsK8WTwVFRPk_RMyKamlbmNIOmJOTM3wtGAoRKAc8XToR6UfvuHu_FFD3nCA4HC8cS2meAGRxT-c";

// 대표 관리자 구글 계정. 이 계정은 관리자 명단에 없어도 항상 관리자로 취급되며 (서버 설정 OWNER_EMAIL과 같아야 함),
// 관리자 페이지에서 다른 관리자를 추가·삭제할 수 있는 유일한 계정이다.
window.SITE_OWNER_EMAIL = "jangsangyun0310@gmail.com";
