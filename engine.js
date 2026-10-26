/* ═══════════════════════════════════════════════════════════════
   결보강 탐색 엔진 (GitHub Pages 정적 버전 v2)
   - 서버 없음: 모든 탐색·시뮬레이션이 브라우저에서 동작
   - 원본 시간표 기준 정적 판단 수행
   - [v2 업데이트] 과목별 교과군 판별 및 교사별 주 교과군 자동 매핑
   - [v2 업데이트] 보강 후보 탐색 시 결강 과목과 동일 교과군 교사 우선 정렬
   ═══════════════════════════════════════════════════════════════ */

const DAY_IDX = { "월": 1, "화": 2, "수": 3, "목": 4, "금": 5 };

function extractClassName(text) {
  const t = String(text || "").trim();
  const m = t.match(/(\d+\s*-\s*\d+)/);
  return m ? m[1].replace(/\s+/g, "") : t;
}

/* [수정] 시트에서 "3-9"가 날짜로 변환돼 CSV로 내려오는 경우("03월 09일") 원래 학급 표기로 복원 */
function normalizeClassroom(text) {
  const t = String(text || "").trim();
  const m = t.match(/(\d+)\s*월\s*(\d+)\s*일/);
  if (m) return String(parseInt(m[1], 10)) + "-" + String(parseInt(m[2], 10));
  return t;
}

function splitClassName(className) {
  const t = String(className || "");
  const m = t.match(/(\d+\s*-\s*\d+)/);
  if (m) {
    const cls = m[1].replace(/\s+/g, "");
    const subj = t.slice(0, m.index).replace(/[-–—\s]+$/, "").trim() || t;
    return { subj: subj, cls: cls };
  }
  return { subj: t, cls: "" };
}

/* 과목명 기반 교과군 판별 */
function deduceSubjectCategory(subj) {
  if (!subj) return "교과";
  subj = String(subj);
  if (subj.includes("국어") || subj.includes("문학") || subj.includes("심국") || subj.includes("독서") || subj.includes("화작") || subj.includes("언매")) return "국어";
  if (subj.includes("수학") || subj.includes("미적") || subj.includes("기하") || subj.includes("수통") || subj.includes("수적") || subj.includes("확통")) return "수학";
  if (subj.includes("영어") || subj.includes("영Ⅱ") || subj.includes("심영") || subj.includes("미영") || subj.includes("영회")) return "영어";
  if (subj.includes("물") || subj.includes("화") || subj.includes("생") || subj.includes("지") || subj.includes("과") || subj.includes("통과")) return "과학";
  if (subj.includes("역사") || subj.includes("한국") || subj.includes("사회") || subj.includes("통사") || subj.includes("세지") || subj.includes("정법") || subj.includes("윤리") || subj.includes("경제")) return "사회";
  if (subj.includes("정보") || subj.includes("프로") || subj.includes("공일") || subj.includes("기술") || subj.includes("가정") || subj.includes("인공지능")) return "기술·가정";
  if (subj.includes("체육") || subj.includes("운동") || subj.includes("스포츠")) return "체육";
  if (subj.includes("음악") || subj.includes("미술") || subj.includes("연극")) return "예술";
  if (subj.includes("한문") || subj.includes("일본") || subj.includes("중국") || subj.includes("제2외")) return "제2외국어/한문";
  return "교과";
}

/* 시간표 데이터에서 교사별 최다 빈도 주 교과군 매핑 */
function buildTeacherSubjectMap(scheduleList) {
  const map = {};
  const counts = {};
  scheduleList.forEach(function(s) {
    if (!s.teacher) return;
    if (!counts[s.teacher]) counts[s.teacher] = {};
    const cat = deduceSubjectCategory(s.className || s.subject);
    counts[s.teacher][cat] = (counts[s.teacher][cat] || 0) + 1;
  });
  Object.keys(counts).forEach(function(t) {
    let bestCat = "교과";
    let maxCnt = 0;
    Object.keys(counts[t]).forEach(function(cat) {
      if (counts[t][cat] > maxCnt) {
        maxCnt = counts[t][cat];
        bestCat = cat;
      }
    });
    map[t] = bestCat;
  });
  return map;
}

/* CSV 파서 (RFC4180 간이 구현: 따옴표·콤마·개행 처리) */
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const clean = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* 무시 */ }
      else field += c;
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/* 시트 2차원 배열 → 수업 리스트 파싱 (Code.gs와 동일 레이아웃) */
function parseSheetValues(data) {
  const teacherRow = data[3] || [];
  const teachers = [];
  for (let c = 2; c < teacherRow.length; c++) {
    const name = String(teacherRow[c] || "").trim();
    if (name) teachers.push({ colIndex: c, name: name });
  }
  const scheduleList = [];
  let currentDay = "";
  for (let r = 4; r < data.length; r++) {
    const dayCell = String(data[r][0] || "").trim();
    if (["월", "화", "수", "목", "금"].includes(dayCell)) currentDay = dayCell;
    if (!currentDay) continue;
    const periodCell = String(data[r][1] || "").trim();
    const periodMatch = periodCell.match(/(\d+)/);
    if (!periodMatch) continue;
    const period = parseInt(periodMatch[1], 10);
    teachers.forEach(function(t) {
      const rawSubject = String(data[r][t.colIndex] || "").trim();
      if (!rawSubject) return;
      const rawClassroom = normalizeClassroom(String((data[r + 1] || [])[t.colIndex] || "").trim());
      const subject = rawSubject;
      const classroom = rawClassroom;
      let combinedName = subject;
      if (classroom && !subject.includes(classroom)) combinedName = subject + "-" + classroom;
      const pureClass = extractClassName(classroom) || extractClassName(subject);
      scheduleList.push({
        day: currentDay, period: period, teacher: t.name,
        subject: subject, classroom: classroom,
        className: combinedName, pureClass: pureClass
      });
    });
    r++;
  }
  return scheduleList;
}

/* 교사별/요일별/교시 인덱스: { 교사명: { 요일: { 교시: true } } } */
function buildScheduleIndex(scheduleList) {
  const idx = {};
  scheduleList.forEach(function(s) {
    if (!idx[s.teacher]) idx[s.teacher] = {};
    if (!idx[s.teacher][s.day]) idx[s.teacher][s.day] = {};
    idx[s.teacher][s.day][s.period] = true;
  });
  return idx;
}

/* 공강 여부 (원본 시간표 기준, 대장 없음) */
function isTeacherFree(scheduleIndex, teacher, day, period) {
  return !(scheduleIndex[teacher] && scheduleIndex[teacher][day] && scheduleIndex[teacher][day][period]);
}

/* 연속수업 체크 (대장 없음) */
function checkConsecutive(scheduleIndex, teacher, addDay, addPeriod, removeDay, removePeriod, limit) {
  const dayPeriods = (scheduleIndex[teacher] && scheduleIndex[teacher][addDay]) || {};
  let periods = Object.keys(dayPeriods).map(Number).filter(function(p) {
    return !(addDay === removeDay && p === removePeriod);
  });
  if (periods.indexOf(addPeriod) < 0) periods.push(addPeriod);
  periods.sort(function(a, b) { return a - b; });
  for (let i = 0; i <= periods.length - limit; i++) {
    let isSeq = true;
    for (let k = 0; k < limit - 1; k++) {
      if (periods[i + k + 1] !== periods[i + k] + 1) { isSeq = false; break; }
    }
    if (isSeq) return true;
  }
  return false;
}

function buildGridData(teacherLessons) {
  const grid = {};
  ["월", "화", "수", "목", "금"].forEach(function(d) {
    grid[d] = {};
    for (let p = 1; p <= 7; p++) grid[d][p] = "-";
  });
  teacherLessons.forEach(function(lesson) {
    if (grid[lesson.day] && grid[lesson.day][lesson.period] !== undefined) {
      grid[lesson.day][lesson.period] = lesson.className;
    }
  });
  return grid;
}

/* 교체/보강 탐색 (대장 제외 버전) */
function searchScheduleLocal(scheduleIndex, scheduleList, allTeachers, targetTeacher, targetDay, targetPeriod, consecutiveLimit, isSwap, isSub, subTargetTeacher) {
  const targetLesson = scheduleList.find(function(s) {
    return s.day === targetDay && s.period === targetPeriod && s.teacher === targetTeacher;
  });
  if (!targetLesson) {
    return { success: false, message: "선택하신 시간에 해당 교사의 수업이 없습니다. (데이터: " + targetDay + " " + targetPeriod + "교시)" };
  }
  const targetClass = targetLesson.pureClass || targetLesson.className;
  const targetCategory = deduceSubjectCategory(targetLesson.className || targetLesson.subject);
  const teacherSubjectMap = buildTeacherSubjectMap(scheduleList);

  let swapList = [];
  let substituteList = [];

  if (isSwap) {
    const targetDayNum = DAY_IDX[targetDay] || 0;
    scheduleList.forEach(function(lesson) {
      const lessonClass = lesson.pureClass || lesson.className;
      if (lessonClass === targetClass && lesson.teacher !== targetTeacher) {
        const teacherB = lesson.teacher;
        const dayB = lesson.day;
        const periodB = lesson.period;
        const candidateDayNum = DAY_IDX[dayB] || 0;
        let isFutureOption = (candidateDayNum === targetDayNum) ? (periodB > targetPeriod) : true;
        if (isFutureOption) {
          const isBFreeAtTarget = isTeacherFree(scheduleIndex, teacherB, targetDay, targetPeriod);
          const isAFreeAtCandidate = isTeacherFree(scheduleIndex, targetTeacher, dayB, periodB);
          if (isBFreeAtTarget && isAFreeAtCandidate) {
            let isValid = true;
            if (consecutiveLimit > 0) {
              if (checkConsecutive(scheduleIndex, teacherB, targetDay, targetPeriod, dayB, periodB, consecutiveLimit)) isValid = false;
              else if (checkConsecutive(scheduleIndex, targetTeacher, dayB, periodB, targetDay, targetPeriod, consecutiveLimit)) isValid = false;
            }
            if (isValid) {
              const bCat = teacherSubjectMap[teacherB] || deduceSubjectCategory(lesson.className || lesson.subject);
              const sortOrder = candidateDayNum >= targetDayNum ? (candidateDayNum - targetDayNum) : (candidateDayNum - targetDayNum + 5);
              swapList.push({
                teacherB: teacherB,
                dayB: dayB,
                periodB: periodB,
                classNameB: lesson.className,
                classB: lesson.className,
                categoryB: bCat,
                sortOrder: sortOrder
              });
            }
          }
        }
      }
    });

    swapList.sort(function(a, b) {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.periodB - b.periodB;
    });
  }

  if (isSub) {
    let targetCandidates = allTeachers;
    if (subTargetTeacher) targetCandidates = allTeachers.filter(function(t) { return t === subTargetTeacher; });
    targetCandidates.forEach(function(tName) {
      if (tName !== targetTeacher && isTeacherFree(scheduleIndex, tName, targetDay, targetPeriod)) {
        let isValid = true;
        if (consecutiveLimit > 0 && checkConsecutive(scheduleIndex, tName, targetDay, targetPeriod, "", 0, consecutiveLimit)) isValid = false;
        if (isValid) {
          const candCategory = teacherSubjectMap[tName] || "교과";
          const isSame = (candCategory === targetCategory);
          substituteList.push({
            teacher: tName,
            teacherB: tName,
            category: candCategory,
            isSameSubject: isSame
          });
        }
      }
    });

    // 동일 교과군 우선 정렬 -> 그 다음 교사명 가나다순
    substituteList.sort(function(a, b) {
      if (a.isSameSubject && !b.isSameSubject) return -1;
      if (!a.isSameSubject && b.isSameSubject) return 1;
      return a.teacher.localeCompare(b.teacher, 'ko');
    });
  }

  return {
    success: true,
    targetTeacher: targetTeacher,
    targetDay: targetDay,
    targetPeriod: targetPeriod,
    targetClass: targetClass,
    targetClassName: targetLesson.className,
    targetCategory: targetCategory,
    swapData: swapList,
    substituteData: substituteList
  };
}

/* 공동 공강 탐색 (대장 제외 버전) */
function findCommonFreeTimeLocal(scheduleIndex, teacherNames) {
  const missingTeachers = teacherNames.filter(function(n) { return !scheduleIndex[n]; });
  if (missingTeachers.length > 0) {
    return { success: false, message: "다음 선생님의 시간표 데이터를 찾을 수 없습니다: " + missingTeachers.join(", ") };
  }
  const commonFreeTimes = [];
  ["월", "화", "수", "목", "금"].forEach(function(d) {
    for (let p = 1; p <= 7; p++) {
      const allFree = teacherNames.every(function(tName) { return isTeacherFree(scheduleIndex, tName, d, p); });
      if (allFree) commonFreeTimes.push({ day: d, period: p });
    }
  });
  return { success: true, teachers: teacherNames, commonFreeTimes: commonFreeTimes };
}

/* 교체 시뮬레이션 */
function simulateSwapLocal(scheduleList, teacherA, dayA, periodA, teacherB, dayB, periodB) {
  const gridA_orig = buildGridData(scheduleList.filter(function(s) { return s.teacher === teacherA; }));
  const gridB_orig = buildGridData(scheduleList.filter(function(s) { return s.teacher === teacherB; }));
  const gridA_new = JSON.parse(JSON.stringify(gridA_orig));
  const gridB_new = JSON.parse(JSON.stringify(gridB_orig));
  gridA_new[dayB][periodB] = gridB_orig[dayB][periodB];
  gridB_new[dayA][periodA] = gridA_orig[dayA][periodA];
  return { success: true, teacherA_orig: gridA_orig, teacherA_new: gridA_new, teacherB_orig: gridB_orig, teacherB_new: gridB_new };
}

/* 보강 시뮬레이션 */
function simulateSubstituteLocal(scheduleList, teacherB, dayA, periodA, classA) {
  const gridB_orig = buildGridData(scheduleList.filter(function(s) { return s.teacher === teacherB; }));
  const gridB_new = JSON.parse(JSON.stringify(gridB_orig));
  gridB_new[dayA][periodA] = classA + "(보강)";
  return {
    success: true,
    teacher_orig: gridB_orig,
    teacher_new: gridB_new,
    teacherB_orig: gridB_orig,
    teacherB_new: gridB_new
  };
}

/* 교사 시간표 조회 (정적) */
function getTeacherTimetableLocal(scheduleList, teacherName) {
  const lessons = scheduleList.filter(function(s) { return s.teacher === teacherName; });
  if (lessons.length === 0) return { success: false, message: teacherName + " 선생님의 시간표 데이터가 없습니다." };
  return { success: true, timetable: buildGridData(lessons) };
}

/* ═══════════════════════════════════════════════════════════════
   출장·연가 일괄 탐색 (Trip mode)
   - 시간표는 주 단위 반복 패턴: 요일/교시로 판단하고 날짜는 표시용으로 계산
   - 맞교환은 복귀 후(출장 종료일 다음날 이후) 첫 해당 요일 날짜로 잡음
   ═══════════════════════════════════════════════════════════════ */

var TRIP_DAY_IDX = { "월": 1, "화": 2, "수": 3, "목": 4, "금": 5 };
var TRIP_DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function tripDateToDay(dateStr) {
  var d = new Date(dateStr + 'T00:00:00');
  return TRIP_DAY_NAMES[d.getDay()];
}

function tripAddDays(dateStr, n) {
  var d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  var yyyy = d.getFullYear();
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}

/* 기간 내 출장 교사 수업 목록 (주말 제외, 날짜순·교시순) */
function getTripLessons(scheduleList, teacher, startDateStr, endDateStr) {
  var lessons = [];
  var cur = startDateStr;
  while (cur <= endDateStr) {
    var day = tripDateToDay(cur);
    if (TRIP_DAY_IDX[day]) {
      scheduleList.forEach(function(s) {
        if (s.teacher === teacher && s.day === day) {
          lessons.push({
            date: cur, day: day, period: s.period,
            subject: s.subject, classroom: s.classroom,
            className: s.className, pureClass: s.pureClass || s.className
          });
        }
      });
    }
    cur = tripAddDays(cur, 1);
  }
  lessons.sort(function(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.period - b.period;
  });
  return lessons;
}

/* earliest 이후 dayKor 요일인 첫 날짜 */
function tripFirstDateOnOrAfter(earliestDateStr, dayKor) {
  for (var i = 0; i < 8; i++) {
    var cand = tripAddDays(earliestDateStr, i);
    if (tripDateToDay(cand) === dayKor) return cand;
  }
  return tripAddDays(earliestDateStr, 7);
}

/* 다주간 맞교환 후보: 같은 반 수업 + 패턴상 공강 + 복귀 후 첫 해당 요일 날짜 */
function findCrossWeekSwaps(scheduleIndex, scheduleList, teacherSubjectMap, targetTeacher, targetDay, targetPeriod, targetPureClass, consecutiveLimit, earliestDateStr) {
  var results = [];
  var seen = {};
  scheduleList.forEach(function(lesson) {
    if (lesson.teacher === targetTeacher) return;
    var lessonClass = lesson.pureClass || lesson.className;
    if (lessonClass !== targetPureClass) return;
    var teacherB = lesson.teacher, dayB = lesson.day, periodB = lesson.period;
    var key = teacherB + '|' + dayB + '|' + periodB;
    if (seen[key]) return;
    seen[key] = true;
    if (!isTeacherFree(scheduleIndex, teacherB, targetDay, targetPeriod)) return;
    if (!isTeacherFree(scheduleIndex, targetTeacher, dayB, periodB)) return;
    if (consecutiveLimit > 0) {
      if (checkConsecutive(scheduleIndex, teacherB, targetDay, targetPeriod, dayB, periodB, consecutiveLimit)) return;
      if (checkConsecutive(scheduleIndex, targetTeacher, dayB, periodB, targetDay, targetPeriod, consecutiveLimit)) return;
    }
    var dateB = tripFirstDateOnOrAfter(earliestDateStr, dayB);
    var cat = (teacherSubjectMap && teacherSubjectMap[teacherB]) || deduceSubjectCategory(lesson.className || lesson.subject);
    results.push({
      teacherB: teacherB, dayB: dayB, periodB: periodB,
      classB: lesson.className, classNameB: lesson.className,
      dateB: dateB, categoryB: cat
    });
  });
  results.sort(function(a, b) {
    if (a.dateB !== b.dateB) return a.dateB < b.dateB ? -1 : 1;
    return a.teacherB.localeCompare(b.teacherB, 'ko');
  });
  return results;
}

/* 차시별 하이브리드 분류: 다주간 맞교환 → 동일교과 보강 → 일반 보강 */
function classifyTripLesson(scheduleIndex, scheduleList, allTeachers, teacherSubjectMap, lesson, consecutiveLimit, earliestDateStr) {
  var swaps = findCrossWeekSwaps(scheduleIndex, scheduleList, teacherSubjectMap,
    lesson.teacher, lesson.day, lesson.period, lesson.pureClass, consecutiveLimit, earliestDateStr);
  var subs = [];
  var targetCategory = deduceSubjectCategory(lesson.className || lesson.subject);
  allTeachers.forEach(function(tName) {
    if (tName === lesson.teacher) return;
    if (!isTeacherFree(scheduleIndex, tName, lesson.day, lesson.period)) return;
    if (consecutiveLimit > 0 && checkConsecutive(scheduleIndex, tName, lesson.day, lesson.period, "", 0, consecutiveLimit)) return;
    var cat = (teacherSubjectMap && teacherSubjectMap[tName]) || "교과";
    subs.push({ teacher: tName, teacherB: tName, category: cat, isSameSubject: (cat === targetCategory) });
  });
  subs.sort(function(a, b) {
    if (a.isSameSubject && !b.isSameSubject) return -1;
    if (!a.isSameSubject && b.isSameSubject) return 1;
    return a.teacher.localeCompare(b.teacher, 'ko');
  });
  var strategy = 'none';
  if (swaps.length > 0) strategy = 'swap';
  else if (subs.length > 0 && subs[0].isSameSubject) strategy = 'sameSub';
  else if (subs.length > 0) strategy = 'generalSub';
  return { strategy: strategy, swaps: swaps, subs: subs, targetCategory: targetCategory };
}

/* 2연속 블록 후보: 같은 반 2교시 연속을 한 명이 맡을 수 있는 경우 */
function findBlockCandidates(scheduleIndex, scheduleList, allTeachers, teacherSubjectMap, targetTeacher, day, period1, period2, pureClass) {
  var results = [];
  allTeachers.forEach(function(tName) {
    if (tName === targetTeacher) return;
    if (!isTeacherFree(scheduleIndex, tName, day, period1)) return;
    if (!isTeacherFree(scheduleIndex, tName, day, period2)) return;
    var teachesClass = scheduleList.some(function(s) {
      return s.teacher === tName && (s.pureClass || s.className) === pureClass;
    });
    var cat = (teacherSubjectMap && teacherSubjectMap[tName]) || "교과";
    results.push({ teacher: tName, teacherB: tName, category: cat, teachesClass: teachesClass });
  });
  results.sort(function(a, b) {
    if (a.teachesClass && !b.teachesClass) return -1;
    if (!a.teachesClass && b.teachesClass) return 1;
    return a.teacher.localeCompare(b.teacher, 'ko');
  });
  return results;
}

/* Node 테스트용 export */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { deduceSubjectCategory, buildTeacherSubjectMap, parseCSV, parseSheetValues, buildScheduleIndex, isTeacherFree, checkConsecutive,
    searchScheduleLocal, findCommonFreeTimeLocal, simulateSwapLocal, simulateSubstituteLocal,
    getTeacherTimetableLocal, extractClassName, splitClassName, buildGridData,
    getTripLessons, tripDateToDay, tripAddDays, tripFirstDateOnOrAfter, findCrossWeekSwaps, classifyTripLesson, findBlockCandidates };
}
