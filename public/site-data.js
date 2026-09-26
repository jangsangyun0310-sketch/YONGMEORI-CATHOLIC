// 홈페이지에 필요한 내용(공지·주보·갤러리 목록·본당 일정·접속 팝업·오늘의 말씀)을 서버에서 한 번에 받아온다.
// 페이지의 다른 스크립트들은 window.SITE_DATA(약속 객체)를 기다렸다가 각자 필요한 부분을 쓴다.
// 서버에 못 닿으면 null로 끝나고, 각 화면은 기본 내용을 그대로 둔다.
window.SITE_DATA = fetch('/api/home', { cache: 'no-store' })
  .then((res) => (res.ok ? res.json() : null))
  .catch(() => null);
