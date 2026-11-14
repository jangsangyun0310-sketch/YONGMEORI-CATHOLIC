// 주보 → 본당 일정 자동 등록: 뽑은 일정 검사, 이미 있는 일정과 겹침 판단
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, similar, dedupe } from '../tools/weekly-bulletin/schedule.mjs';

test('비슷한 이름은 같은 일정, 숫자가 다르면 다른 일정', () => {
  assert.ok(similar('사목회의', '사목회 모임'));
  assert.ok(similar('황금궁전Cu. 월례회의', '황금궁전Cu 모임'));
  assert.ok(similar('평신도 주일 2차헌금', '평신도 주일 2차 헌금'));
  assert.ok(similar('성시간 및 성체강복', '성시간 및 성체강복'));
  assert.ok(!similar('6구역 반모임', '7구역 반모임'));
  assert.ok(!similar('8구역 1반 반모임', '8구역 2반 반모임'));
  assert.ok(!similar('수험생을 위한 미사', '사목회의'));
});

test('날짜·길이 검사: 형식이 틀리거나 너무 멀면 뺀다', () => {
  const v = validate([
    { date: '2026-11-17', title: ' 수험생을  위한 미사 ', time: '19시 30분' },
    { date: '2026-11-10', end_date: '2026-11-14', title: '수녀님 휴가' },
    { date: '2026-11-10', end_date: '2026-11-10', title: '끝 날짜가 같음' },
    { date: '2026-13-01', title: '없는 달' },
    { date: '2027-12-25', title: '너무 먼 날' },
    { date: '2026-11-20', title: '' },
    { date: '2026-11-20', title: 'x'.repeat(200) },
  ], '2026-11-15', '2026-11-01');
  assert.deepEqual(v.map(x => [x.date, x.end_date, x.title.length]), [['2026-11-17', '', 10], ['2026-11-10', '2026-11-14', 6], ['2026-11-10', '', 8], ['2026-11-20', '', 120]]);
  assert.equal(v[0].title, '수험생을 위한 미사');
});

test('이미 있는 일정과 같은 날·비슷한 이름은 건너뛰고, 주보 안의 중복도 하나만', () => {
  const existing = [{ date: '2026-11-15', title: '사목회의' }];
  const { keep, skip } = dedupe([
    { date: '2026-11-15', title: '사목회 모임' },
    { date: '2026-11-22', title: '사목회 모임' },
    { date: '2026-11-17', title: '수험생을 위한 미사' },
    { date: '2026-11-17', title: '수험생을 위한 미사' },
  ], existing);
  assert.deepEqual(keep.map(k => k.date + k.title), ['2026-11-22사목회 모임', '2026-11-17수험생을 위한 미사']);
  assert.equal(skip.length, 2);
});

test('이미 지난 일정은 넣지 않고, 기간 일정은 끝나는 날이 남았으면 넣는다', () => {
  const v = validate([
    { date: '2026-11-13', title: '어제 일정' },
    { date: '2026-11-14', title: '오늘 일정' },
    { date: '2026-11-10', end_date: '2026-11-14', title: '오늘 끝나는 휴가' },
    { date: '2026-11-10', end_date: '2026-11-12', title: '끝난 휴가' },
    { date: '2026-11-17', title: '다음 주 미사' },
  ], '2026-11-15', '2026-11-14');
  assert.deepEqual(v.map(x => x.title), ['오늘 일정', '오늘 끝나는 휴가', '다음 주 미사']);
});
