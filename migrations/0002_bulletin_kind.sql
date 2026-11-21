-- 주보(weekly)와 용머리 까치 월보(monthly)를 같은 표에 두고 종류로 나눈다 (2026-11-21)
-- 기존 주보와 주보 자동 올림 도구가 넣는 것은 모두 weekly
ALTER TABLE bulletins ADD COLUMN kind TEXT NOT NULL DEFAULT 'weekly' CHECK (kind IN ('weekly', 'monthly'));
