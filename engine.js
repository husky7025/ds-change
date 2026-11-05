/* ═══════════════════════════════════════════════════════════════
   결보강 탐색 엔진 (GitHub Pages 정적 버전 v2)
   - 서버 없음: 모든 탐색·시뮬레이션이 브라우저에서 동작
   - 원본 시간표 기준 정적 판단 수행
   - [v2 업데이트] 과목별 교과군 판별 및 교사별 주 교과군 자동 매핑
   - [v2 업데이트] 보강 후보 탐색 시 결강 과목과 동일 교과군 교사 우선 정렬
   - [v5 수정] 출장 기간 안으로 교체되는 오류, 자동 배정의 "제한 없음" 무시 수정
   - [v5 수정] 교과군 판별 보강, 과목명의 숫자(과2·제2 등)를 반으로 읽는 오류 수정
   - [v5 수정] 이어지는 수업 표시(│, ▽)를 앞 교시 수업으로 처리
   ═══════════════════════════════════════════════════════════════ */

const DAY_IDX = { "월": 1, "화": 2, "수": 3, "목": 4, "금": 5 };

function extractClassName(text) {
  const t = String(text || "").trim();
  const m = t.match(/(\d+\s*-\s*\d+)/);
  return m ? m[1].replace(/\s+/g, "") : t;
}

/* [수정] 시트에서 "3-9"가 날짜로 변환돼 CSV로 내려오는 경우("03월 09일") 원래 학급 표기로 복원 */
function normalizeClassroom(text) {
  let t = String(text || "").trim().replace(/^="?|"?$/g, "");
  const m = t.match(/(\d+)\s*월\s*(\d+)\s*일/);
  if (m) return String(parseInt(m[1], 10)) + "-" + String(parseInt(m[2], 10));
  return t;
}

function splitClassName(className) {
  const t = String(className || "");
  // 과목명에 숫자가 있어도(예: 과2-1-9) 끝에 있는 학년-반을 먼저 찾는다
  const m = t.match(/(\d+\s*-\s*\d+)\s*$/) || t.match(/(\d+\s*-\s*\d+)/);
  if (m) {
    const cls = m[1].replace(/\s+/g, "");
    const subj = t.slice(0, m.index).replace(/[-–—\s]+$/, "").trim() || t;
    return { subj: subj, cls: cls };
  }
  return { subj: t, cls: "" };
}

/* 시간표에 쓰는 줄임 과목명 → 교과군 (실제 담당 교사의 다른 과목으로 확인한 값) */
const SUBJECT_CATEGORY_MAP = {
  "국1": "국어", "국2": "국어",
  "세지": "사회", "도탐": "사회", "현윤": "사회", "법사": "사회",
  "세포": "과학", "역학": "과학", "물질": "과학", "물역": "과학", "역물": "과학", "물지": "과학", "지세": "과학",
  "스생": "체육",
  "음연": "예술",
  "제2": "제2외국어/한문", "일문": "제2외국어/한문", "중문": "제2외국어/한문"
};

/* 과목명 기반 교과군 판별 (물·화·생·지·과처럼 넓은 글자를 쓰는 과학 판별은 맨 마지막) */
function deduceSubjectCategory(subj) {
  if (!subj) return "교과";
  subj = splitClassName(String(subj)).subj.replace(/\s+/g, "");
  if (SUBJECT_CATEGORY_MAP[subj]) return SUBJECT_CATEGORY_MAP[subj];
  if (subj.includes("국어") || subj.includes("문학") || subj.includes("심국") || subj.includes("독서") || subj.includes("화작") || subj.includes("언매")) return "국어";
  if (subj.includes("수학") || subj.includes("미적") || subj.includes("기하") || subj.includes("수통") || subj.includes("수적") || subj.includes("확통")) return "수학";
  if (subj.includes("영어") || subj.includes("영Ⅱ") || subj.includes("심영") || subj.includes("미영") || subj.includes("영회")) return "영어";
  if (subj.includes("한문") || subj.includes("일본") || subj.includes("중국") || subj.includes("제2외")) return "제2외국어/한문";
  if (subj.includes("역사") || subj.includes("한국") || subj.includes("사회") || subj.includes("통사") || subj.includes("세지") || subj.includes("정법") || subj.includes("윤리") || subj.includes("경제") || subj.includes("지리")) return "사회";
  if (subj.includes("정보") || subj.includes("프로") || subj.includes("공일") || subj.includes("기술") || subj.includes("가정") || subj.includes("인공지능")) return "기술·가정";
  if (subj.includes("체육") || subj.includes("운동") || subj.includes("스포츠")) return "체육";
  if (subj.includes("음악") || subj.includes("미술") || subj.includes("연극")) return "예술";
  if (subj.includes("물") || subj.includes("화") || subj.includes("생") || subj.includes("지") || subj.includes("과") || subj.includes("통과")) return "과학";
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
      let subject = rawSubject;
      let classroom = rawClassroom;
      /* 이어지는 수업 표시(│, ▽)는 바로 앞 교시 수업과 같은 반·과목으로 처리 */
      const isContinued = /^[│|┃]$/.test(rawSubject) || /^[▽▼]$/.test(rawClassroom);
      if (isContinued) {
        const prev = scheduleList.find(function(s) {
          return s.teacher === t.name && s.day === currentDay && s.period === period - 1;
        });
        if (prev) { subject = prev.subject; classroom = prev.classroom; }
      }
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

/* =========================================================
   수업이 없는 날 (공휴일·학사일정)
   - 공휴일은 평일만 적고, 2027년 말까지 들어 있다
   - 학사일정은 setSchoolCalendar로 더한다
   ========================================================= */
const PUBLIC_HOLIDAYS = {
  "2026-12-25": "성탄절",
  "2027-01-01": "신정",
  "2027-02-08": "설날 연휴", "2027-02-09": "설날 대체공휴일",
  "2027-03-01": "삼일절",
  "2027-05-03": "노동절 대체공휴일", "2027-05-05": "어린이날", "2027-05-13": "부처님오신날",
  "2027-07-19": "제헌절 대체공휴일",
  "2027-08-16": "광복절 대체공휴일",
  "2027-09-14": "추석 연휴", "2027-09-15": "추석", "2027-09-16": "추석 연휴",
  "2027-10-04": "개천절 대체공휴일", "2027-10-11": "한글날 대체공휴일",
  "2027-12-27": "성탄절 대체공휴일"
};
let schoolCalendarDates = {};

function getBlockedReason(dateStr) {
  return schoolCalendarDates[dateStr] || PUBLIC_HOLIDAYS[dateStr] || "";
}

function setSchoolCalendar(dates) {
  schoolCalendarDates = dates || {};
}

function normalizeCalendarDate(text) {
  const m = String(text || "").trim().match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (!m) return "";
  return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
}

/* 학사일정 CSV → { 날짜: 내용 }. 첫 칸이 "시작일"인 머리글이 없으면 null (학사일정 표가 아님) */
function parseSchoolCalendar(csvText) {
  const rows = parseCSV(csvText);
  if (!rows.length || String(rows[0][0] || "").replace(/\s/g, "") !== "시작일") return null;
  const dates = {};
  rows.slice(1).forEach(function(r) {
    const start = normalizeCalendarDate(r[0]);
    if (!start) return;
    const end = normalizeCalendarDate(r[1]) || start;
    const title = String(r[2] || "").trim() || "학사일정";
    const cur = new Date(start + "T00:00:00");
    const last = new Date(end + "T00:00:00");
    for (let i = 0; cur <= last && i < 366; i++) {
      const key = cur.getFullYear() + "-" + String(cur.getMonth() + 1).padStart(2, "0") + "-" + String(cur.getDate()).padStart(2, "0");
      const dow = cur.getDay();
      if (dow >= 1 && dow <= 5) dates[key] = title;
      cur.setDate(cur.getDate() + 1);
    }
  });
  return dates;
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
  if (!limit || limit <= 0) return false;
  const dayPeriods = (scheduleIndex[teacher] && scheduleIndex[teacher][addDay]) || {};
  const periods = Object.keys(dayPeriods).map(Number).filter(function(p) {
    return !(addDay === removeDay && p === removePeriod);
  });
  if (periods.indexOf(addPeriod) < 0) periods.push(addPeriod);

  // 새로 추가되는 교시(addPeriod)를 포함하는 연속 수업 길이 계산
  let count = 1;
  let pPrev = addPeriod - 1;
  while (periods.indexOf(pPrev) >= 0) { count++; pPrev--; }
  let pNext = addPeriod + 1;
  while (periods.indexOf(pNext) >= 0) { count++; pNext++; }

  return count >= limit;
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


/* =========================================================
   출장·연가 일괄 결보강 모드 엔진 (Multi-day Trip Batch Mode)
   ========================================================= */

/**
 * 1. 출장 기간(시작일, 일수) 내 출장 교사의 모든 수업 목록 추출
 */
function getTripLessonsForDates(scheduleList, targetTeacher, dateList) {
  const lessons = [];
  let idCounter = 1;

  dateList.forEach(function(dObj) {
    const dayLessons = scheduleList.filter(function(s) {
      return s.teacher === targetTeacher && s.day === dObj.day;
    });

    dayLessons.sort(function(a, b) { return a.period - b.period; });

    dayLessons.forEach(function(l) {
      const parsed = splitClassName(l.className);
      const pureCls = l.pureClass || parsed.cls || l.className;
      const subj = parsed.subj || l.className;
      const cat = deduceSubjectCategory(l.className || subj);

      lessons.push({
        id: 'trip_lesson_' + (idCounter++),
        date: dObj.date,
        day: dObj.day,
        shortDate: dObj.shortDate || dObj.date,
        period: l.period,
        className: l.className,
        pureClass: pureCls,
        subject: subj,
        category: cat,
        targetTeacher: targetTeacher
      });
    });
  });

  return lessons;
}

/**
 * 2. 출장 기간 내 학급별 수업 빈도 및 교사별 전담 가능 여부(연속성) 분석
 */
function analyzeClassContinuity(scheduleIndex, allTeachers, tripLessons) {
  const classStats = {};

  tripLessons.forEach(function(l) {
    if (!classStats[l.pureClass]) {
      classStats[l.pureClass] = {
        total: 0,
        lessons: [],
        teacherAvailableCounts: {}
      };
    }
    classStats[l.pureClass].total++;
    classStats[l.pureClass].lessons.push(l);
  });

  Object.keys(classStats).forEach(function(cls) {
    const cInfo = classStats[cls];
    allTeachers.forEach(function(tName) {
      let freeCount = 0;
      cInfo.lessons.forEach(function(l) {
        if (isTeacherFree(scheduleIndex, tName, l.day, l.period)) {
          freeCount++;
        }
      });
      cInfo.teacherAvailableCounts[tName] = freeCount;
    });
  });

  return classStats;
}

/**
 * 3. 특정 수업에 대한 보강 후보 교사 목록 생성 (정렬 및 배지 메타데이터 포함)
 */
/**
 * 2-B. 출장 기간 중 특정 수업에 대한 '수업 맞교환(Swap)' 후보 목록 탐색
 */
function getTripSwapCandidatesForLesson(scheduleIndex, scheduleList, lesson, tripDateStrings, allowNextWeek, assignedSlots, consecutiveLimit) {
  const targetTeacher = lesson.targetTeacher;
  const targetClass = lesson.pureClass;
  const targetDateStr = lesson.date;
  const targetDay = lesson.day;
  const targetPeriod = lesson.period;

  const curDate = new Date(targetDateStr + 'T00:00:00');
  const dow = curDate.getDay(); // 1=Mon .. 5=Fri
  const monday = new Date(curDate);
  monday.setDate(curDate.getDate() - (dow - 1));

  const dayNames = ["", "월", "화", "수", "목", "금"];
  const candidateDates = [];
  const now = new Date();
  // 이미 지난 날짜로는 수업을 옮길 수 없다
  const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

  // 1) 같은 주의 출장 외 날짜 탐색
  for (let d = 1; d <= 5; d++) {
    const cDate = new Date(monday);
    cDate.setDate(monday.getDate() + (d - 1));
    const yyyy = cDate.getFullYear();
    const mm = String(cDate.getMonth() + 1).padStart(2, '0');
    const dd = String(cDate.getDate()).padStart(2, '0');
    const dStr = yyyy + '-' + mm + '-' + dd;
    if (tripDateStrings.indexOf(dStr) === -1 && dStr >= todayStr && !getBlockedReason(dStr)) {
      candidateDates.push({
        date: dStr,
        day: dayNames[d],
        shortDate: (cDate.getMonth() + 1) + '/' + cDate.getDate(),
        isNextWeek: false
      });
    }
  }

  // 2) 다음 주 날짜 탐색 (allowNextWeek가 true인 경우)
  if (allowNextWeek) {
    const nextMonday = new Date(monday);
    nextMonday.setDate(monday.getDate() + 7);
    for (let d = 1; d <= 5; d++) {
      const cDate = new Date(nextMonday);
      cDate.setDate(nextMonday.getDate() + (d - 1));
      const yyyy = cDate.getFullYear();
      const mm = String(cDate.getMonth() + 1).padStart(2, '0');
      const dd = String(cDate.getDate()).padStart(2, '0');
      const dStr = yyyy + '-' + mm + '-' + dd;
      if (tripDateStrings.indexOf(dStr) !== -1 || dStr < todayStr || getBlockedReason(dStr)) continue; // 출장일·지난 날짜·수업 없는 날 제외
      candidateDates.push({
        date: dStr,
        day: dayNames[d],
        shortDate: (cDate.getMonth() + 1) + '/' + cDate.getDate(),
        isNextWeek: true
      });
    }
  }

  const swapCandidates = [];

  candidateDates.forEach(function(candDateObj) {
    const dayB = candDateObj.day;
    const dateB = candDateObj.date;

    const matchingLessons = scheduleList.filter(function(s) {
      const pCls = s.pureClass || splitClassName(s.className).cls || s.className;
      return pCls === targetClass && s.teacher !== targetTeacher && s.day === dayB;
    });

    matchingLessons.forEach(function(lessonB) {
      const teacherB = lessonB.teacher;
      const periodB = lessonB.period;

      if (!isTeacherFree(scheduleIndex, teacherB, targetDay, targetPeriod)) return;
      if (!isTeacherFree(scheduleIndex, targetTeacher, dayB, periodB)) return;

      const slotA = targetDateStr + '_' + targetPeriod;
      const slotB = dateB + '_' + periodB;
      if (assignedSlots) {
        if (assignedSlots[teacherB] && assignedSlots[teacherB][slotA]) return;
        if (assignedSlots[targetTeacher] && assignedSlots[targetTeacher][slotB]) return;
        if (assignedSlots[teacherB] && assignedSlots[teacherB][slotB]) return;
      }

      if (consecutiveLimit > 0) {
        if (checkConsecutive(scheduleIndex, teacherB, targetDay, targetPeriod, dayB, periodB, consecutiveLimit)) return;
        if (checkConsecutive(scheduleIndex, targetTeacher, dayB, periodB, targetDay, targetPeriod, consecutiveLimit)) return;
      }

      const parsedB = splitClassName(lessonB.className);
      const subjB = parsedB.subj || lessonB.className;
      const catB = deduceSubjectCategory(lessonB.className || subjB);

      swapCandidates.push({
        type: '수업교체',
        teacherB: teacherB,
        dateB: dateB,
        dayB: dayB,
        shortDateB: candDateObj.shortDate,
        periodB: periodB,
        subjectB: subjB,
        categoryB: catB,
        classNameB: lessonB.className,
        isNextWeek: candDateObj.isNextWeek
      });
    });
  });

  swapCandidates.sort(function(a, b) {
    if (a.isNextWeek !== b.isNextWeek) return a.isNextWeek ? 1 : -1;
    if (a.dateB !== b.dateB) return a.dateB.localeCompare(b.dateB);
    return a.periodB - b.periodB;
  });

  return swapCandidates;
}

function getTripCandidatesForLesson(scheduleIndex, allTeachers, lesson, teacherSubjectMap, classStats, assignedSlots, currentAssignedCounts, currentAssignedToday, consecutiveLimit) {
  const targetCategory = lesson.category;
  const clsStat = classStats[lesson.pureClass] || { total: 1, teacherAvailableCounts: {} };
  const candidates = [];

  allTeachers.forEach(function(tName) {
    if (tName === lesson.targetTeacher) return;

    if (!isTeacherFree(scheduleIndex, tName, lesson.day, lesson.period)) return;

    const slotKey = lesson.date + '_' + lesson.period;
    if (assignedSlots && assignedSlots[tName] && assignedSlots[tName][slotKey]) return;

    if (consecutiveLimit > 0 && checkConsecutive(scheduleIndex, tName, lesson.day, lesson.period, '', 0, consecutiveLimit)) {
      return;
    }

    const tCategory = teacherSubjectMap[tName] || '교과';
    const isSameSubject = (tCategory === targetCategory);
    const classFreeCount = (clsStat.teacherAvailableCounts && clsStat.teacherAvailableCounts[tName]) || 0;
    const isFullContinuity = (clsStat.total > 1 && classFreeCount === clsStat.total);
    const isPartialContinuity = (clsStat.total > 1 && classFreeCount > 1);

    const totalAssigned = (currentAssignedCounts && currentAssignedCounts[tName]) || 0;
    const todayAssigned = (currentAssignedToday && currentAssignedToday[tName] && currentAssignedToday[tName][lesson.date]) || 0;

    let score = 0;
    if (isSameSubject) score += 100;
    if (isFullContinuity) score += 60;
    else if (isPartialContinuity) score += 30;

    score -= (totalAssigned * 25);
    if (todayAssigned === 1) score -= 40;
    if (todayAssigned >= 2) score -= 200;

    candidates.push({
      teacher: tName,
      category: tCategory,
      isSameSubject: isSameSubject,
      classFreeCount: classFreeCount,
      classTotalLessons: clsStat.total,
      isFullContinuity: isFullContinuity,
      isPartialContinuity: isPartialContinuity,
      totalAssigned: totalAssigned,
      todayAssigned: todayAssigned,
      score: score
    });
  });

  candidates.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.teacher.localeCompare(b.teacher, 'ko');
  });

  return candidates;
}

/**
 * 4. 출장 기간 전체 수업에 대한 '스마트 원클릭 자동 배정' 알고리즘
 */
function autoAssignTripSubstitutes(scheduleIndex, scheduleList, allTeachers, tripLessons, teacherSubjectMap, consecutiveLimit, policy, allowNextWeek, tripDates) {
  if (typeof allowNextWeek === 'undefined') allowNextWeek = true;
  if (typeof consecutiveLimit === 'undefined') consecutiveLimit = 3; // 0은 "제한 없음"이므로 그대로 둔다
  if (!policy) policy = 'swap_first';

  const classStats = analyzeClassContinuity(scheduleIndex, allTeachers, tripLessons);
  const assignedSlots = {};
  const currentAssignedCounts = {};
  const currentAssignedToday = {};
  const assignments = {};

  // 수업이 없는 출장일도 교체 대상에서 빠지도록 출장 기간 전체 날짜를 쓴다
  const tripDateStrings = tripDates ? tripDates.slice() : [];
  tripLessons.forEach(function(l) {
    if (tripDateStrings.indexOf(l.date) === -1) tripDateStrings.push(l.date);
  });

  const sortedLessons = tripLessons.slice().sort(function(a, b) {
    const countA = (classStats[a.pureClass] && classStats[a.pureClass].total) || 1;
    const countB = (classStats[b.pureClass] && classStats[b.pureClass].total) || 1;
    if (countB !== countA) return countB - countA;
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.period - b.period;
  });

  // 1단계: 수업 교체(Swap) 우선 탐색 (policy: swap_first 또는 swap_only)
  if (policy === 'swap_first' || policy === 'swap_only') {
    // 희소한 수업(교체 파트너가 적은 수업)을 먼저 매칭하여 교체 성공률을 100%로 극대화
    const swapCountsMap = {};
    tripLessons.forEach(function(l) {
      const c = getTripSwapCandidatesForLesson(
        scheduleIndex, scheduleList, l, tripDateStrings, allowNextWeek, {}, consecutiveLimit
      );
      swapCountsMap[l.id] = c.length;
    });

    const swapSortedLessons = tripLessons.slice().sort(function(a, b) {
      const cntA = swapCountsMap[a.id];
      const cntB = swapCountsMap[b.id];
      if (cntA === 0 && cntB > 0) return 1;
      if (cntB === 0 && cntA > 0) return -1;
      if (cntA !== cntB) return cntA - cntB;
      return a.date.localeCompare(b.date);
    });

    swapSortedLessons.forEach(function(lesson) {
      if (assignments[lesson.id]) return;

      const swapCands = getTripSwapCandidatesForLesson(
        scheduleIndex, scheduleList, lesson, tripDateStrings, allowNextWeek, assignedSlots, consecutiveLimit
      );

      if (swapCands.length > 0) {
        const bestSwap = swapCands[0];
        assignments[lesson.id] = {
          type: '수업교체',
          teacherB: bestSwap.teacherB,
          dateB: bestSwap.dateB,
          dayB: bestSwap.dayB,
          shortDateB: bestSwap.shortDateB,
          periodB: bestSwap.periodB,
          subjectB: bestSwap.subjectB,
          categoryB: bestSwap.categoryB,
          classNameB: bestSwap.classNameB,
          isNextWeek: bestSwap.isNextWeek
        };

        const tA = lesson.targetTeacher;
        const tB = bestSwap.teacherB;
        if (!assignedSlots[tB]) assignedSlots[tB] = {};
        if (!assignedSlots[tA]) assignedSlots[tA] = {};
        assignedSlots[tB][lesson.date + '_' + lesson.period] = true;
        assignedSlots[tA][bestSwap.dateB + '_' + bestSwap.periodB] = true;
        assignedSlots[tB][bestSwap.dateB + '_' + bestSwap.periodB] = true;
      }
    });
  }

  // 2단계: 보강(Substitute) 2순위 탐색 (policy: swap_first 또는 sub_only)
  if (policy === 'swap_first' || policy === 'sub_only') {
    sortedLessons.forEach(function(lesson) {
      if (assignments[lesson.id]) return;

      const subCands = getTripCandidatesForLesson(
        scheduleIndex, allTeachers, lesson, teacherSubjectMap, classStats,
        assignedSlots, currentAssignedCounts, currentAssignedToday, consecutiveLimit
      );

      if (subCands.length > 0) {
        const bestSub = subCands[0];
        const tName = bestSub.teacher;

        assignments[lesson.id] = {
          type: '수업보강',
          teacherB: tName,
          dateB: lesson.date,
          dayB: lesson.day,
          shortDateB: lesson.shortDate,
          periodB: lesson.period,
          subjectB: lesson.subject,
          categoryB: bestSub.category,
          isSameSubject: bestSub.isSameSubject
        };

        if (!assignedSlots[tName]) assignedSlots[tName] = {};
        assignedSlots[tName][lesson.date + '_' + lesson.period] = true;

        currentAssignedCounts[tName] = (currentAssignedCounts[tName] || 0) + 1;
        if (!currentAssignedToday[tName]) currentAssignedToday[tName] = {};
        currentAssignedToday[tName][lesson.date] = (currentAssignedToday[tName][lesson.date] || 0) + 1;
      } else {
        assignments[lesson.id] = null;
      }
    });
  }

  return {
    success: true,
    assignments: assignments,
    assignedCounts: currentAssignedCounts,
    assignedToday: currentAssignedToday,
    classStats: classStats
  };
}

/**
 * 5. 교사별 전후 시간표 비교 (변경이 있는 주마다 하나씩 반환)
 *    changed 값: removed(수업이 빠짐), added(수업이 들어옴), unassigned(미배정), conflict(같은 칸에 겹침)
 */
function buildTripWeekComparison(scheduleList, tripLessons, assignments, teacher, tripTeacher) {
  const dayNames = ["", "월", "화", "수", "목", "금"];
  const before = buildGridData(scheduleList.filter(function(s) { return s.teacher === teacher; }));
  const weeks = {};

  function weekOf(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const monday = new Date(d);
    monday.setDate(d.getDate() - (d.getDay() - 1));
    const key = monday.getFullYear() + '-' + String(monday.getMonth() + 1).padStart(2, '0') + '-' + String(monday.getDate()).padStart(2, '0');
    if (!weeks[key]) {
      const dayLabels = {};
      for (let i = 1; i <= 5; i++) {
        const c = new Date(monday);
        c.setDate(monday.getDate() + i - 1);
        dayLabels[dayNames[i]] = (c.getMonth() + 1) + '/' + c.getDate();
      }
      weeks[key] = { weekStart: key, dayLabels: dayLabels, removes: [], adds: [], unassigned: [] };
    }
    return weeks[key];
  }

  tripLessons.forEach(function(l) {
    const a = assignments[l.id];
    const isTripTeacher = (teacher === tripTeacher);
    if (!a) {
      if (isTripTeacher) weekOf(l.date).unassigned.push({ day: l.day, period: l.period });
      return;
    }
    if (a.type === '수업교체') {
      if (isTripTeacher) {
        weekOf(l.date).removes.push({ day: l.day, period: l.period });
        weekOf(a.dateB).adds.push({ day: a.dayB, period: a.periodB, text: l.className });
      } else if (a.teacherB === teacher) {
        weekOf(a.dateB).removes.push({ day: a.dayB, period: a.periodB });
        weekOf(l.date).adds.push({ day: l.day, period: l.period, text: (a.subjectB || l.subject) + "-" + l.pureClass });
      }
    } else if (a.type === '수업보강') {
      if (isTripTeacher) weekOf(l.date).removes.push({ day: l.day, period: l.period });
      else if (a.teacherB === teacher) weekOf(l.date).adds.push({ day: l.day, period: l.period, text: l.className + "(보강)" });
    }
  });

  return Object.keys(weeks).sort().map(function(key) {
    const w = weeks[key];
    const after = JSON.parse(JSON.stringify(before));
    const changed = {};
    w.removes.forEach(function(r) {
      after[r.day][r.period] = "-";
      changed[r.day + '_' + r.period] = 'removed';
    });
    w.unassigned.forEach(function(u) { changed[u.day + '_' + u.period] = 'unassigned'; });
    w.adds.forEach(function(a) {
      const k = a.day + '_' + a.period;
      const isClash = after[a.day][a.period] !== "-";
      after[a.day][a.period] = isClash ? after[a.day][a.period] + " / " + a.text : a.text;
      changed[k] = isClash ? 'conflict' : 'added';
    });
    return { weekStart: w.weekStart, dayLabels: w.dayLabels, before: before, after: after, changed: changed };
  });
}

/* Node 테스트용 export */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { deduceSubjectCategory, buildTeacherSubjectMap, parseCSV, parseSheetValues, buildScheduleIndex, isTeacherFree, checkConsecutive,
    searchScheduleLocal, findCommonFreeTimeLocal, simulateSwapLocal, simulateSubstituteLocal,
    getTeacherTimetableLocal, extractClassName, splitClassName, buildGridData, getTripLessonsForDates, analyzeClassContinuity, getTripCandidatesForLesson, autoAssignTripSubstitutes, getTripSwapCandidatesForLesson, buildTripWeekComparison, getBlockedReason, setSchoolCalendar, parseSchoolCalendar };
}
