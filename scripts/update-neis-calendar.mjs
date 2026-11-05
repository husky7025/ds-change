// 나이스 학사일정을 받아 neis-calendar.json을 만든다.
// 환경변수: SCHOOL_CODE(필수), NEIS_KEY(권장). 키가 없으면 7일 단위로 나눠 조회한다.
import fs from 'node:fs';

const OFFICE_CODE = 'G10'; // 대전광역시교육청
const SCHOOL_CODE = process.env.SCHOOL_CODE;
const NEIS_KEY = process.env.NEIS_KEY || '';
const OUTPUT = 'neis-calendar.json';
const DAYS_AHEAD = 400;
const REFRESH_DAYS = 30; // 변경이 없어도 이 주기로 갱신해 예약 실행이 멈추지 않게 한다
const NO_KEY_ROW_LIMIT = 5; // 키 없는 호출은 한 번에 5건까지만 돌려준다
const EXAM_PATTERN = /(중간|기말|지필).*(고사|시험|평가)|\d차\s*고사/;

if (!SCHOOL_CODE) throw new Error('SCHOOL_CODE 환경변수가 필요합니다.');

const DAY_MS = 86400000;
const ymd = date => date.toISOString().slice(0, 10).replace(/-/g, '');

async function requestRows(from, to, page) {
  const params = new URLSearchParams({
    Type: 'json', pIndex: String(page), pSize: '1000',
    ATPT_OFCDC_SC_CODE: OFFICE_CODE, SD_SCHUL_CODE: SCHOOL_CODE,
    AA_FROM_YMD: from, AA_TO_YMD: to
  });
  if (NEIS_KEY) params.set('KEY', NEIS_KEY);
  const response = await fetch('https://open.neis.go.kr/hub/SchoolSchedule?' + params);
  if (!response.ok) throw new Error('나이스 응답 오류: HTTP ' + response.status);
  const data = await response.json();
  const code = data.RESULT?.CODE;
  if (code === 'INFO-200') return { rows: [], total: 0 }; // 해당 기간 일정 없음
  if (code) throw new Error('나이스 오류: ' + code + ' ' + (data.RESULT?.MESSAGE || ''));
  const body = data.SchoolSchedule;
  if (!body) throw new Error('나이스 응답 형식이 예상과 다릅니다.');
  return { rows: body[1]?.row || [], total: body[0].head[0].list_total_count };
}

async function fetchWithKey(start, end) {
  const rows = [];
  for (let page = 1; ; page++) {
    const result = await requestRows(ymd(start), ymd(end), page);
    rows.push(...result.rows);
    if (!result.rows.length || rows.length >= result.total) return rows;
  }
}

async function fetchRange(start, end) {
  const result = await requestRows(ymd(start), ymd(end), 1);
  if (result.total <= result.rows.length) return result.rows;
  if (start.getTime() === end.getTime()) {
    throw new Error(ymd(start) + ' 일정이 5건을 넘어 키 없이는 받을 수 없습니다.');
  }
  // 5건을 넘으면 기간을 반으로 나눠 다시 조회한다
  const half = Math.floor((end - start) / DAY_MS / 2);
  const middle = new Date(start.getTime() + half * DAY_MS);
  const next = new Date(middle.getTime() + DAY_MS);
  return [...await fetchRange(start, middle), ...await fetchRange(next, end)];
}

async function fetchWithoutKey(start, end) {
  const rows = [];
  for (let cur = start; cur <= end; cur = new Date(cur.getTime() + 7 * DAY_MS)) {
    const last = new Date(Math.min(cur.getTime() + 6 * DAY_MS, end.getTime()));
    rows.push(...await fetchRange(cur, last));
  }
  return rows;
}

/* { 날짜: { 학년: 일정 이름 } } 로 바꾼다. 평일만, 수업이 없는 일정만 남긴다 */
function buildDates(rows) {
  const dates = {};
  for (const row of rows) {
    const text = row.AA_YMD;
    const iso = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const name = String(row.EVENT_NM || '').trim();
    const noClass = row.SBTR_DD_SC_NM === '공휴일' || row.SBTR_DD_SC_NM === '휴업일';
    if (!noClass && !EXAM_PATTERN.test(name)) continue;
    let grades = [1, 2, 3].filter(g => row[['ONE', 'TW', 'THREE'][g - 1] + '_GRADE_EVENT_YN'] === 'Y');
    if (!grades.length) grades = [1, 2, 3];
    dates[iso] = dates[iso] || {};
    for (const g of grades) dates[iso][g] = dates[iso][g] || name;
  }
  return Object.fromEntries(Object.keys(dates).sort().map(k => [k, dates[k]]));
}

const now = new Date(ymd(new Date()).replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3') + 'T00:00:00Z');
const end = new Date(now.getTime() + DAYS_AHEAD * DAY_MS);
const rows = NEIS_KEY ? await fetchWithKey(now, end) : await fetchWithoutKey(now, end);
const dates = buildDates(rows);
if (!Object.keys(dates).length) throw new Error('받은 일정이 없어 기존 파일을 유지합니다.');

let previous = null;
if (fs.existsSync(OUTPUT)) previous = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
const unchanged = previous && JSON.stringify(previous.dates) === JSON.stringify(dates);
const recent = previous && (now - new Date(previous.updated)) < REFRESH_DAYS * DAY_MS;
if (unchanged && recent) {
  console.log('변경 없음:', Object.keys(dates).length + '일');
} else {
  fs.writeFileSync(OUTPUT, JSON.stringify({ updated: now.toISOString().slice(0, 10), dates }, null, 1) + '\n');
  console.log('갱신:', Object.keys(dates).length + '일', NEIS_KEY ? '(인증키)' : '(키 없음)');
}
