(function () {
  "use strict";

  // iOS Safari's address bar changes the visible viewport height without
  // always updating CSS dvh until the user scrolls, so measure it directly.
  // A standalone home-screen launch can also report a transitional height
  // before its launch animation settles, so re-measure a few times early on.
  function setAppHeight() {
    document.documentElement.style.setProperty("--app-height", window.innerHeight + "px");
    updateDebugInfo();
  }

  function updateDebugInfo() {
    var el = document.getElementById("debug-info");
    if (!el) return;
    var standaloneMedia = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
    var lines = [
      "innerW x innerH: " + window.innerWidth + " x " + window.innerHeight,
      "clientW x clientH: " + document.documentElement.clientWidth + " x " + document.documentElement.clientHeight,
      "screen: " + window.screen.width + " x " + window.screen.height,
      "devicePixelRatio: " + window.devicePixelRatio,
      "navigator.standalone: " + navigator.standalone,
      "display-mode standalone: " + standaloneMedia,
      "--app-height: " + getComputedStyle(document.documentElement).getPropertyValue("--app-height"),
      "phone rect: " + JSON.stringify((function () {
        var r = document.querySelector(".phone").getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) };
      })())
    ];
    el.textContent = lines.join("\n");
  }
  setAppHeight();
  window.addEventListener("load", setAppHeight);
  window.addEventListener("pageshow", setAppHeight);
  window.addEventListener("resize", setAppHeight);
  window.addEventListener("orientationchange", setAppHeight);
  document.addEventListener("visibilitychange", setAppHeight);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", setAppHeight);
  }
  [50, 150, 300, 600, 1200].forEach(function (ms) {
    setTimeout(setAppHeight, ms);
  });

  var STORAGE_KEY = "dailyPlanData_v1";
  var WEEKDAY_KO = ["월", "화", "수", "목", "금", "토", "일"];
  var WEEKDAY_KO_FULL = ["일", "월", "화", "수", "목", "금", "토"];
  var PALETTE = [
    "#FFB3BA", "#FFDFBA", "#FFF6BA", "#BAFFC9", "#BAE1FF",
    "#D5BAFF", "#FFC9DE", "#C9FFD5", "#BAF2FF", "#FFE1BA", "#E1BAFF"
  ];

  var SVG_NS = "http://www.w3.org/2000/svg";
  var CX = 170, CY = 170, TRACK_R = 122, TICK_R1 = 122, TICK_R2 = 131, LABEL_R = 148, WEDGE_LABEL_R = 82;

  // ---- state ----
  var allPlans = loadPlans();
  var plannerWeekOffset = 0;
  var selectedDate = new Date();
  var editingId = null;
  var expandedRows = {};
  var expandedHomeIds = {};

  // ---- storage helpers ----
  function loadPlans() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }
  function savePlans() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allPlans));
  }

  // ---- date/time helpers ----
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function dateKey(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function toMin(hhmm) {
    var parts = hhmm.split(":");
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }
  function toHHMM(mins) {
    mins = ((mins % 1440) + 1440) % 1440;
    return pad2(Math.floor(mins / 60)) + ":" + pad2(mins % 60);
  }
  function formatKoreanDate(d) {
    return (d.getMonth() + 1) + "월 " + d.getDate() + "일 " + WEEKDAY_KO_FULL[d.getDay()] + "요일";
  }
  function getMonday(d) {
    var date = new Date(d);
    var day = (date.getDay() + 6) % 7; // 0 = Monday
    date.setDate(date.getDate() - day);
    date.setHours(0, 0, 0, 0);
    return date;
  }
  function getWeekDates(offset) {
    var base = getMonday(new Date());
    base.setDate(base.getDate() + offset * 7);
    var arr = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(base);
      d.setDate(base.getDate() + i);
      arr.push(d);
    }
    return arr;
  }
  function sameDate(a, b) { return dateKey(a) === dateKey(b); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function getPlans(key) {
    return (allPlans[key] || []).slice().sort(function (a, b) {
      return toMin(a.start) - toMin(b.start);
    });
  }

  // ---- DOM refs ----
  var homeScreen = document.getElementById("home-screen");
  var plannerScreen = document.getElementById("planner-screen");
  var lockDate = document.getElementById("lock-date");
  var lockTime = document.getElementById("lock-time");
  var todayPlanList = document.getElementById("today-plan-list");
  var openPlannerBtn = document.getElementById("open-planner-btn");
  var backBtn = document.getElementById("back-btn");
  var prevWeekBtn = document.getElementById("prev-week-btn");
  var nextWeekBtn = document.getElementById("next-week-btn");
  var weekDaysEl = document.getElementById("week-days");
  var selectedDateLabel = document.getElementById("selected-date-label");
  var clockSvg = document.getElementById("clock-svg");
  var planTableBody = document.getElementById("plan-table-body");
  var emptyMsg = document.getElementById("empty-msg");

  var modalBackdrop = document.getElementById("modal-backdrop");
  var modalTitle = document.getElementById("modal-title");
  var inputStart = document.getElementById("input-start");
  var inputEnd = document.getElementById("input-end");
  var inputText = document.getElementById("input-text");
  var inputColor = document.getElementById("input-color");
  var deleteBtn = document.getElementById("delete-btn");
  var cancelBtn = document.getElementById("cancel-btn");
  var saveBtn = document.getElementById("save-btn");

  // ---- home screen ----
  function renderHome() {
    var now = new Date();
    lockDate.textContent = formatKoreanDate(now);
    lockTime.textContent = pad2(now.getHours()) + ":" + pad2(now.getMinutes());

    var plans = getPlans(dateKey(now));
    todayPlanList.innerHTML = "";
    if (plans.length === 0) {
      todayPlanList.innerHTML = '<p class="empty-msg-home">오늘의 플랜이 없어요</p>';
      return;
    }
    plans.forEach(function (p) {
      var isOpen = !!expandedHomeIds[p.id];
      var item = document.createElement("div");
      item.className = "home-plan-item";
      item.innerHTML =
        '<div class="home-plan-row">' +
          '<span class="time">' + p.start + '&ndash;' + p.end + '</span>' +
          '<span class="text">' + escapeHtml(p.text) + '</span>' +
        '</div>';
      item.addEventListener("click", function () {
        expandedHomeIds[p.id] = !expandedHomeIds[p.id];
        renderHome();
      });
      if (isOpen) {
        var detail = document.createElement("div");
        detail.className = "home-plan-detail";
        detail.textContent = p.detail && p.detail.trim() ? p.detail : "적어둔 상세 내용이 없어요";
        item.appendChild(detail);
      }
      todayPlanList.appendChild(item);
    });
  }

  // ---- svg helpers ----
  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  function polarToXY(cx, cy, r, angleDeg) {
    var rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }
  function minToAngle(min) { return (min / 1440) * 360 - 90; }
  function arcPath(cx, cy, r, startMin, endMin) {
    var startAngle = minToAngle(startMin);
    var endAngle = minToAngle(endMin);
    var startPt = polarToXY(cx, cy, r, startAngle);
    var endPt = polarToXY(cx, cy, r, endAngle);
    var diff = endMin - startMin;
    if (diff <= 0) diff += 1440;
    var largeArc = diff > 720 ? 1 : 0;
    return "M " + cx + " " + cy +
      " L " + startPt.x + " " + startPt.y +
      " A " + r + " " + r + " 0 " + largeArc + " 1 " + endPt.x + " " + endPt.y + " Z";
  }
  function getSvgPoint(svg, evt) {
    var pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    var ctm = svg.getScreenCTM().inverse();
    return pt.matrixTransform(ctm);
  }

  // ---- clock drag-to-create ----
  var dragState = null;

  function pointToSnappedMin(pt) {
    var dx = pt.x - CX, dy = pt.y - CY;
    var angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    var norm = (angle + 90 + 360) % 360;
    var minutes = (norm / 360) * 1440;
    return Math.round(minutes / 30) * 30 % 1440;
  }

  function dragRange() {
    var s = dragState.startMin, c = dragState.currentMin;
    var fwd = (c - s + 1440) % 1440;
    var bwd = (s - c + 1440) % 1440;
    if (fwd === 0) return { start: s, end: (s + 30) % 1440 };
    if (fwd <= bwd) return { start: s, end: c };
    return { start: c, end: s };
  }

  function updateDragPreview() {
    var range = dragRange();
    var endAdj = range.end <= range.start ? range.end + 1440 : range.end;
    dragState.previewEl.setAttribute("d", arcPath(CX, CY, TRACK_R, range.start, endAdj));
  }

  function attachTrackDrag(track) {
    track.addEventListener("pointerdown", function (e) {
      var pt = getSvgPoint(clockSvg, e);
      var startMin = pointToSnappedMin(pt);
      var preview = svgEl("path", { class: "clock-wedge-preview" });
      clockSvg.appendChild(preview);
      dragState = { startMin: startMin, currentMin: startMin, previewEl: preview };
      updateDragPreview();
      track.setPointerCapture(e.pointerId);
    });
    track.addEventListener("pointermove", function (e) {
      if (!dragState) return;
      var pt = getSvgPoint(clockSvg, e);
      dragState.currentMin = pointToSnappedMin(pt);
      updateDragPreview();
    });
    track.addEventListener("pointerup", function () {
      if (!dragState) return;
      var range = dragRange();
      dragState.previewEl.remove();
      dragState = null;
      openAddModal(range.start, range.end);
    });
    track.addEventListener("pointercancel", function () {
      if (!dragState) return;
      dragState.previewEl.remove();
      dragState = null;
    });
  }

  // ---- clock rendering ----
  function renderClock() {
    clockSvg.innerHTML = "";

    var track = svgEl("circle", { cx: CX, cy: CY, r: TRACK_R, class: "clock-track" });
    attachTrackDrag(track);
    clockSvg.appendChild(track);

    var key = dateKey(selectedDate);
    var plans = getPlans(key);
    plans.forEach(function (block) {
      var sMin = toMin(block.start);
      var eMinRaw = toMin(block.end);
      var eMin = eMinRaw <= sMin ? eMinRaw + 1440 : eMinRaw;
      var path = svgEl("path", {
        d: arcPath(CX, CY, TRACK_R, sMin, eMin),
        fill: block.color || PALETTE[0],
        class: "clock-wedge"
      });
      var title = svgEl("title", {});
      title.textContent = block.start + "-" + block.end + " " + block.text;
      path.appendChild(title);
      path.addEventListener("click", function (e) {
        e.stopPropagation();
        openEditModal(block);
      });
      clockSvg.appendChild(path);

      var diff = eMin - sMin;
      if (diff >= 60) {
        var midMin = sMin + diff / 2;
        var midAngle = minToAngle(midMin);
        var pos = polarToXY(CX, CY, WEDGE_LABEL_R, midAngle);
        var label = block.text.length > 8 ? block.text.slice(0, 7) + "…" : block.text;
        var text = svgEl("text", {
          x: pos.x, y: pos.y, class: "clock-wedge-label",
          "text-anchor": "middle", "dominant-baseline": "middle"
        });
        text.textContent = label;
        clockSvg.appendChild(text);
      }
    });

    var ticksGroup = svgEl("g", { class: "clock-ticks" });
    var labelsGroup = svgEl("g", { class: "clock-labels" });
    for (var h = 0; h < 24; h++) {
      var angle = h * 15 - 90;
      var p1 = polarToXY(CX, CY, TICK_R1, angle);
      var p2 = polarToXY(CX, CY, TICK_R2, angle);
      ticksGroup.appendChild(svgEl("line", {
        x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: "clock-tick"
      }));
      if (h % 2 === 0) {
        var lp = polarToXY(CX, CY, LABEL_R, angle);
        var t = svgEl("text", {
          x: lp.x, y: lp.y, class: "clock-label",
          "text-anchor": "middle", "dominant-baseline": "middle"
        });
        t.textContent = h;
        labelsGroup.appendChild(t);
      }
    }
    clockSvg.appendChild(ticksGroup);
    clockSvg.appendChild(labelsGroup);
    clockSvg.appendChild(svgEl("circle", { cx: CX, cy: CY, r: 3, fill: "#333" }));
  }

  // ---- table rendering ----
  function renderTable() {
    var key = dateKey(selectedDate);
    var plans = getPlans(key);
    planTableBody.innerHTML = "";
    emptyMsg.style.display = plans.length === 0 ? "block" : "none";

    plans.forEach(function (block) {
      var isOpen = !!expandedRows[block.id];
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + block.start + "&ndash;" + block.end + "</td>" +
        '<td class="plan-content">' + escapeHtml(block.text) +
          '<span class="content-hint">' + (isOpen ? "▾" : "▸") + " 상세</span></td>" +
        '<td><button class="row-del" aria-label="삭제">&times;</button></td>';

      tr.querySelector(".plan-content").addEventListener("click", function (e) {
        e.stopPropagation();
        expandedRows[block.id] = !expandedRows[block.id];
        renderTable();
      });
      tr.addEventListener("click", function (e) {
        if (e.target.classList.contains("row-del")) return;
        if (e.target.closest(".plan-content")) return;
        openEditModal(block);
      });
      tr.querySelector(".row-del").addEventListener("click", function (e) {
        e.stopPropagation();
        if (confirm("이 플랜을 삭제할까요?")) {
          delete expandedRows[block.id];
          allPlans[key] = allPlans[key].filter(function (b) { return b.id !== block.id; });
          savePlans();
          renderPlanner();
        }
      });
      planTableBody.appendChild(tr);

      if (isOpen) {
        var detailTr = document.createElement("tr");
        detailTr.className = "plan-detail-row";
        var detailTd = document.createElement("td");
        detailTd.colSpan = 3;
        var textarea = document.createElement("textarea");
        textarea.className = "plan-detail-input";
        textarea.rows = 4;
        textarea.placeholder = "상세 내용을 적어보세요 (예: 준비물, 순서, 참고 링크 등)";
        textarea.value = block.detail || "";
        textarea.addEventListener("click", function (e) { e.stopPropagation(); });
        textarea.addEventListener("blur", function () {
          block.detail = textarea.value;
          savePlans();
        });
        detailTd.appendChild(textarea);
        detailTr.appendChild(detailTd);
        planTableBody.appendChild(detailTr);
      }
    });
  }

  // ---- week strip ----
  function renderWeekStrip() {
    var dates = getWeekDates(plannerWeekOffset);
    var today = new Date();
    weekDaysEl.innerHTML = "";
    dates.forEach(function (d, i) {
      var btn = document.createElement("button");
      btn.className = "week-day-btn";
      if (sameDate(d, today)) btn.className += " is-today";
      if (sameDate(d, selectedDate)) btn.className += " is-selected";
      btn.innerHTML =
        '<span class="wd-label">' + WEEKDAY_KO[i] + "</span>" +
        '<span class="wd-date">' + d.getDate() + "</span>";
      btn.addEventListener("click", function () {
        selectedDate = d;
        renderPlanner();
      });
      weekDaysEl.appendChild(btn);
    });
  }

  function renderSelectedDateLabel() {
    selectedDateLabel.textContent = formatKoreanDate(selectedDate);
  }

  function renderPlanner() {
    renderWeekStrip();
    renderSelectedDateLabel();
    renderClock();
    renderTable();
  }

  // ---- modal ----
  function showModal() { modalBackdrop.classList.add("show"); }
  function closeModal() { modalBackdrop.classList.remove("show"); editingId = null; }

  function formatHourLabel(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return m === 0 ? h + "시" : h + "시 " + m + "분";
  }

  function openAddModal(startMin, endMin) {
    if (endMin === undefined) endMin = (startMin + 30) % 1440;
    editingId = null;
    modalTitle.textContent = formatHourLabel(startMin) + "부터 " + formatHourLabel(endMin) + "까지 뭐 할래 호지야?";
    inputStart.value = toHHMM(startMin);
    inputEnd.value = toHHMM(endMin);
    inputText.value = "";
    var key = dateKey(selectedDate);
    var count = (allPlans[key] || []).length;
    inputColor.value = PALETTE[count % PALETTE.length];
    deleteBtn.style.display = "none";
    showModal();
    inputText.focus();
  }
  function openEditModal(block) {
    editingId = block.id;
    modalTitle.textContent = "플랜 수정";
    inputStart.value = block.start;
    inputEnd.value = block.end;
    inputText.value = block.text;
    inputColor.value = block.color || PALETTE[0];
    deleteBtn.style.display = "inline-block";
    showModal();
  }

  saveBtn.addEventListener("click", function () {
    var start = inputStart.value;
    var end = inputEnd.value;
    var text = inputText.value.trim();
    if (!start || !end) { alert("시작/종료 시간을 입력해주세요."); return; }
    if (!text) { alert("내용을 입력해주세요."); return; }
    var sMin = toMin(start), eMin = toMin(end);
    if (eMin <= sMin) { alert("종료 시간은 시작 시간보다 늦어야 해요."); return; }

    var key = dateKey(selectedDate);
    if (!allPlans[key]) allPlans[key] = [];

    var color = inputColor.value;
    if (editingId) {
      var block = allPlans[key].find(function (b) { return b.id === editingId; });
      if (block) { block.start = start; block.end = end; block.text = text; block.color = color; }
    } else {
      allPlans[key].push({
        id: "p" + Date.now() + Math.random().toString(16).slice(2),
        start: start, end: end, text: text, color: color, detail: ""
      });
    }
    savePlans();
    closeModal();
    renderPlanner();
  });

  deleteBtn.addEventListener("click", function () {
    if (!editingId) return;
    if (!confirm("이 플랜을 삭제할까요?")) return;
    var key = dateKey(selectedDate);
    delete expandedRows[editingId];
    allPlans[key] = (allPlans[key] || []).filter(function (b) { return b.id !== editingId; });
    savePlans();
    closeModal();
    renderPlanner();
  });

  cancelBtn.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", function (e) {
    if (e.target === modalBackdrop) closeModal();
  });

  // ---- navigation ----
  openPlannerBtn.addEventListener("click", function () {
    plannerWeekOffset = 0;
    selectedDate = new Date();
    homeScreen.classList.remove("active");
    plannerScreen.classList.add("active");
    renderPlanner();
  });
  backBtn.addEventListener("click", function () {
    plannerScreen.classList.remove("active");
    homeScreen.classList.add("active");
    renderHome();
  });
  prevWeekBtn.addEventListener("click", function () {
    plannerWeekOffset -= 1;
    selectedDate = new Date(selectedDate);
    selectedDate.setDate(selectedDate.getDate() - 7);
    renderPlanner();
  });
  nextWeekBtn.addEventListener("click", function () {
    plannerWeekOffset += 1;
    selectedDate = new Date(selectedDate);
    selectedDate.setDate(selectedDate.getDate() + 7);
    renderPlanner();
  });

  // ---- init ----
  renderHome();
  setInterval(renderHome, 15000);
})();
