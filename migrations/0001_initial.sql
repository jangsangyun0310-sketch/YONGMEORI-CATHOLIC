-- 용머리성당 홈페이지 데이터 (Cloudflare D1)
-- 사진 파일 자체는 GitHub 저장소(public/images/uploads/)에 두고, 여기에는 경로만 저장한다.
-- 사진 경로는 사이트 기준 경로다 (예: images/uploads/2026/20260915-194053-y4ka.jpg).

CREATE TABLE notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag TEXT NOT NULL DEFAULT '' CHECK (length(tag) <= 30),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  -- 날짜 칸에는 '2026.09.20' 같은 날짜뿐 아니라 '상시 모집', '접수마감 2026.09.20' 같은 문구도 쓴다
  date TEXT NOT NULL CHECK (length(date) BETWEEN 1 AND 30),
  body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 5000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- 공지 목록은 날짜가 문구일 수 있어 날짜가 아니라 추가한 순서(최근 것이 위)로 보여준다

CREATE TABLE bulletins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9].[0-9][0-9].[0-9][0-9]'),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_bulletins_date ON bulletins (date DESC, id DESC);

CREATE TABLE bulletin_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bulletin_id INTEGER NOT NULL REFERENCES bulletins (id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE INDEX idx_bulletin_images_bulletin ON bulletin_images (bulletin_id, position);

CREATE TABLE gallery_albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9].[0-9][0-9].[0-9][0-9]'),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_gallery_albums_date ON gallery_albums (date DESC, id DESC);

CREATE TABLE gallery_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL REFERENCES gallery_albums (id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE INDEX idx_gallery_photos_album ON gallery_photos (album_id, position);

-- 접속 시 팝업 (항상 한 줄)
CREATE TABLE announce (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 120),
  text TEXT NOT NULL DEFAULT '' CHECK (length(text) <= 3000),
  image TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO announce (id) VALUES (1);

-- 알림함 (관리자가 보낸 알림 기록)
CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_announcements_created ON announcements (created_at DESC);

-- 알림 구독 (휴대폰별 푸시 토큰)
CREATE TABLE push_tokens (
  token TEXT PRIMARY KEY,
  ua TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 관리자 명단 (대표 관리자는 설정값 OWNER_EMAIL로 항상 포함)
CREATE TABLE admins (
  email TEXT PRIMARY KEY,
  added_by TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 오늘의 말씀 (항상 한 줄, 매일 자동 갱신)
CREATE TABLE todayword (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ym TEXT NOT NULL,
  day TEXT NOT NULL,
  color TEXT NOT NULL,
  feast_name TEXT NOT NULL,
  verse TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 본당 일정 (1박2일처럼 여러 날짜에 걸치면 end_date에 마지막 날짜, 하루짜리면 빈 값)
CREATE TABLE schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT NOT NULL DEFAULT '' CHECK (end_date = '' OR (end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND end_date > date)),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  time TEXT NOT NULL DEFAULT '' CHECK (length(time) <= 80),
  place TEXT NOT NULL DEFAULT '' CHECK (length(place) <= 80),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_schedule_date ON schedule (date, id);
