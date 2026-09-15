// 웹 푸시 알림(Firebase Cloud Messaging) 설정
// Firebase 콘솔(https://console.firebase.google.com)에서 "용머리성당"용 프로젝트를 새로 만든 뒤
// "프로젝트 설정 > 일반 > 내 앱(웹 앱 추가)"에서 나오는 값들로 아래를 바꿔주세요.
// 서학동성당 홈페이지와는 반드시 별도의 Firebase 프로젝트를 써야 두 성당의 구독자·알림이 섞이지 않습니다.
// 이 값들은 비밀키가 아니라 공개되어도 되는 값입니다 (Firestore 보안 규칙이 실제 보호막입니다).
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

// 대표 관리자 구글 계정. 이 계정은 Firestore admins 명단에 없어도 항상 관리자로 취급되며,
// 관리자 페이지에서 다른 관리자를 추가·삭제할 수 있는 유일한 계정이다.
window.SITE_OWNER_EMAIL = "jangsangyun0310@gmail.com";

// 관리자 페이지 주소. 홈페이지는 GitHub Pages 주소를 그대로 쓰고(홈 화면 설치 링크가 바뀌지 않도록),
// 저장·사진 업로드·알림 발송 같은 서버 기능이 필요한 관리자 페이지만 Cloudflare Pages에서 돌아간다.
// docs/관리자-설정-안내.md 의 B단계에서 만든 프로젝트 이름과 같아야 한다.
window.ADMIN_URL = "https://yongmeori-catholic.pages.dev/admin/";
