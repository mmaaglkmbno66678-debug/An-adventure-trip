/* ============================================================
   رحلة البحث عن الكنز – منطق اللعبة
   ============================================================ */
(function () {
  "use strict";

  const Q = window.QUESTION_BANK;
  const TOTAL = 15;
  const POINTS = 100;
  const STORAGE_KEY = "treasure-hunt-ar-v1";

  const SECTIONS = [
    { id: "map", name: "خريطة الكنز", icon: "🗺️", desc: "نقطة انطلاق القبطان" },
    { id: "port", name: "ميناء المعرفة", icon: "⚓", desc: "اختيار من متعدد · ٥ أسئلة" },
    { id: "depths", name: "أعماق الحقيقة", icon: "🌊", desc: "صح أو خطأ · ٤ أسئلة" },
    { id: "words", name: "جزيرة الكلمات المفقودة", icon: "🏝️", desc: "أكمل الفراغ · سؤالان" },
    { id: "captain", name: "تحدي القبطان", icon: "🧭", desc: "توصيل وترتيب · سؤالان" },
    { id: "treasure", name: "الكنز الأخير", icon: "💎", desc: "تحدي التفكير · سؤالان" }
  ];

  const ISLAND_POS = {
    map: { x: 9, y: 24 }, port: { x: 25, y: 71 }, depths: { x: 43, y: 26 },
    words: { x: 60, y: 73 }, captain: { x: 77, y: 31 }, treasure: { x: 91, y: 70 }
  };

  const $ = (id) => document.getElementById(id);
  let state = loadState();
  let timerId = null;
  let currentQuestion = null;
  let currentSectionIndex = 0;
  let selectedMatch = null;
  let matchAssign = {};
  let selectedOrder = null;
  let orderSlots = [null, null, null, null];
  let celebrationNext = "map";
  let lastBubbleAt = 0;

  function defaultState() {
    return {
      screen: "start", unlocked: 1, section: null, qIndex: {}, answers: {},
      score: 0, correct: 0, wrong: 0, sound: true, finished: false, celebrated: {}
    };
  }

  function loadState() {
    const base = defaultState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      const merged = Object.assign(base, saved);
      merged.answers = merged.answers && typeof merged.answers === "object" ? merged.answers : {};
      merged.qIndex = merged.qIndex && typeof merged.qIndex === "object" ? merged.qIndex : {};
      merged.celebrated = merged.celebrated && typeof merged.celebrated === "object" ? merged.celebrated : {};
      return merged;
    } catch (e) {
      return base;
    }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* تخزين غير متاح */ }
  }

  function questionsOf(section) { return Q[section.id] || []; }
  function isSectionDone(section) { return questionsOf(section).every((q) => !!state.answers[q.id]); }
  function answeredCount() { return Object.keys(state.answers).length; }
  function computeUnlocked() {
    for (let i = 1; i < SECTIONS.length; i++) if (!isSectionDone(SECTIONS[i])) return i;
    return SECTIONS.length;
  }
  function refreshUnlock() { state.unlocked = computeUnlocked(); }

  /* ---------- الصوت: مؤثرات وموسيقى مولّدة محليًا ---------- */
  const Sound = {
    ctx: null, master: null, ambient: false, musicTimer: null, enabled: state.sound !== false,

    init() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this.ctx) {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? 0.55 : 0;
        this.master.connect(this.ctx.destination);
        this.startAmbient();
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
    },

    setEnabled(on) {
      this.enabled = on;
      if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.05);
    },

    tone(freq, dur, type, vol, delay) {
      if (!this.ctx || !this.enabled) return;
      const t = this.ctx.currentTime + (delay || 0);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol || 0.08, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain); gain.connect(this.master);
      osc.start(t); osc.stop(t + dur + 0.05);
    },

    sweep(from, to, dur, vol, type) {
      if (!this.ctx || !this.enabled) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(to, t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol || 0.06, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain); gain.connect(this.master);
      osc.start(t); osc.stop(t + dur + 0.05);
    },

    noise(dur, vol, filterFreq) {
      if (!this.ctx || !this.enabled) return;
      const len = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const filter = this.ctx.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = filterFreq || 800;
      const gain = this.ctx.createGain();
      const t = this.ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol || 0.05, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filter); filter.connect(gain); gain.connect(this.master);
      src.start(t); src.stop(t + dur + 0.02);
    },

    startAmbient() {
      if (this.ambient || !this.ctx) return;
      this.ambient = true;
      // أمواج هادئة مستمرة
      const len = this.ctx.sampleRate * 3;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { last = (last + (Math.random() * 2 - 1) * 0.06) * 0.98; data[i] = last; }
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const filter = this.ctx.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 420;
      const gain = this.ctx.createGain(); gain.gain.value = 0.05;
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.12;
      const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 0.022;
      lfo.connect(lfoGain); lfoGain.connect(gain.gain);
      src.connect(filter); filter.connect(gain); gain.connect(this.master);
      src.start(); lfo.start();

      // موسيقى مغامرات بحرية هادئة
      const notes = [392, 440, 523, 587, 523, 440, 392, 349, 392, 523, 659, 587, 523, 440, 392, 330];
      let step = 0;
      this.musicTimer = setInterval(() => {
        if (document.hidden || !this.enabled) return;
        const f = notes[step % notes.length];
        this.tone(f, 0.38, "sine", 0.022, 0);
        if (step % 4 === 0) this.tone(f / 2, 0.8, "triangle", 0.018, 0);
        step++;
      }, 820);

      // طيور النورس من حين لآخر
      setInterval(() => {
        if (document.hidden || !this.enabled || Math.random() > 0.45) return;
        this.sweep(900, 1500, 0.22, 0.025);
        setTimeout(() => this.sweep(1300, 850, 0.26, 0.02), 260);
      }, 11000);
    },

    play(name) {
      if (!this.ctx || !this.enabled) return;
      switch (name) {
        case "correct":
          this.tone(660, 0.2, "triangle", 0.09, 0);
          this.tone(880, 0.22, "triangle", 0.09, 0.09);
          this.tone(1174, 0.35, "sine", 0.08, 0.18);
          break;
        case "wrong":
          this.tone(190, 0.3, "sawtooth", 0.045, 0);
          this.noise(0.16, 0.03, 500);
          break;
        case "coin":
          [1200, 1600, 2100].forEach((f, i) => this.tone(f, 0.16, "sine", 0.055, i * 0.07));
          break;
        case "bell":
          this.tone(880, 0.9, "sine", 0.075, 0);
          this.tone(1320, 0.7, "sine", 0.04, 0.06);
          break;
        case "wood":
          this.noise(0.22, 0.055, 900);
          this.tone(120, 0.12, "triangle", 0.03, 0);
          break;
        case "chest":
          this.noise(0.6, 0.07, 380);
          [900, 1300, 1800, 2400].forEach((f, i) => this.tone(f, 0.22, "sine", 0.05, 0.35 + i * 0.09));
          break;
        case "gull":
          this.sweep(900, 1500, 0.24, 0.03);
          break;
      }
    }
  };

  /* ---------- المؤثرات البصرية ---------- */
  function spawnBubble(x, y) {
    const fx = $("fxLayer");
    if (!fx) return;
    const b = document.createElement("span");
    b.className = "mouse-bubble";
    const s = 5 + Math.random() * 14;
    b.style.cssText = `left:${x}px;top:${y}px;width:${s}px;height:${s}px;`;
    fx.appendChild(b);
    setTimeout(() => b.remove(), 1300);
  }

  function spawnRipple(x, y) {
    const fx = $("fxLayer");
    if (!fx) return;
    const r = document.createElement("span");
    r.className = "ripple";
    r.style.cssText = `left:${x - 10}px;top:${y - 10}px;`;
    fx.appendChild(r);
    setTimeout(() => r.remove(), 750);
  }

  function spawnCoins(x, y, count) {
    const fx = $("fxLayer");
    if (!fx) return;
    for (let i = 0; i < (count || 9); i++) {
      const c = document.createElement("span");
      c.className = "particle-coin";
      const dx = (Math.random() - 0.5) * 220;
      const dy = -60 - Math.random() * 150;
      c.style.cssText = `left:${x}px;top:${y}px;--dx:${dx}px;--dy:${dy}px;animation-delay:${i * 45}ms;`;
      c.innerHTML = '<svg viewBox="0 0 40 40"><use href="#coinArt"/></svg>';
      fx.appendChild(c);
      setTimeout(() => c.remove(), 1600 + i * 45);
    }
  }

  function spawnSparks(x, y, count) {
    const fx = $("fxLayer");
    if (!fx) return;
    for (let i = 0; i < (count || 12); i++) {
      const s = document.createElement("span");
      s.className = "spark";
      const dx = (Math.random() - 0.5) * 180;
      const dy = (Math.random() - 0.5) * 140;
      s.style.cssText = `left:${x}px;top:${y}px;--dx:${dx}px;--dy:${dy}px;animation-delay:${i * 30}ms;`;
      fx.appendChild(s);
      setTimeout(() => s.remove(), 1000 + i * 30);
    }
  }

  function initAmbientBubbles() {
    const layer = $("ambientBubbles");
    if (!layer) return;
    for (let i = 0; i < 18; i++) {
      const b = document.createElement("i");
      const size = 4 + Math.random() * 12;
      b.style.cssText = `left:${Math.random() * 100}%;width:${size}px;height:${size}px;animation-duration:${11 + Math.random() * 15}s;animation-delay:-${Math.random() * 20}s;`;
      layer.appendChild(b);
    }
  }

  function initPointerEffects() {
    document.addEventListener("pointermove", (e) => {
      const now = Date.now();
      if (now - lastBubbleAt < 90) return;
      if (state.screen === "start" || state.screen === "map") {
        if (e.clientY > window.innerHeight * 0.42) { spawnBubble(e.clientX, e.clientY); lastBubbleAt = now; }
      }
    });
    document.addEventListener("pointerdown", (e) => {
      if (state.screen !== "start" && state.screen !== "map") return;
      if (e.clientY > window.innerHeight * 0.45) spawnRipple(e.clientX, e.clientY);
    });
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  /* ---------- التنقل والشريط العلوي ---------- */
  function showScreen(name) {
    clearInterval(timerId); timerId = null;
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    const screen = $("screen-" + name);
    if (screen) screen.classList.add("active");
    $("hud").classList.toggle("hidden", name === "start");
    state.screen = name;
    saveState();
  }

  function updateHUD() {
    const n = answeredCount();
    const pct = Math.round((n / TOTAL) * 100);
    $("progressFill").style.width = pct + "%";
    $("progressText").textContent = pct + "%";
    $("scoreText").textContent = state.score;
    $("correctText").textContent = state.correct;
  }

  function updateSoundUI() {
    const on = !!state.sound;
    $("soundIcon").textContent = on ? "🔊" : "🔇";
    $("soundLabel").textContent = on ? "الصوت مفعّل" : "الصوت مكتوم";
    $("startSoundLabel").textContent = on ? "الصوت مفعّل" : "الصوت مكتوم";
    $("btnSound").setAttribute("aria-pressed", String(on));
  }

  function toggleSound() {
    state.sound = !state.sound;
    Sound.init();
    Sound.setEnabled(state.sound);
    if (state.sound) Sound.play("bell");
    updateSoundUI(); saveState();
  }

  /* ---------- خريطة الرحلة ---------- */
  function renderMap() {
    refreshUnlock();
    const box = $("mapIslands");
    box.innerHTML = SECTIONS.map((s, i) => {
      const pos = ISLAND_POS[s.id];
      let cls = "island";
      if (i === 0 || isSectionDone(s) || state.finished) cls += " done";
      else if (i === state.unlocked) cls += " current";
      else cls += " locked";
      const badge = cls.includes("done") ? '<span class="done-badge">✓</span>' :
        cls.includes("locked") ? '<span class="lock-badge">🔒</span>' : "";
      return `<button class="${cls}" type="button" data-index="${i}" style="left:${pos.x}%;top:${pos.y}%" aria-label="${s.name}">
        <svg viewBox="0 0 200 130"><use href="#islandArt"/></svg>
        <span class="island-label">${s.icon} ${s.name}</span>${badge}
      </button>`;
    }).join("");

    box.querySelectorAll(".island").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.index);
        Sound.init();
        if (idx === 0 || state.finished) { showMap(); return; }
        if (idx > state.unlocked) {
          btn.classList.add("shake");
          setTimeout(() => btn.classList.remove("shake"), 450);
          Sound.play("wrong");
          toast("هذه الجزيرة مقفلة… أكمل الجزيرة السابقة أولًا!");
          return;
        }
        enterSection(idx);
      });
    });

    const pts = SECTIONS.map((s) => {
      const p = ISLAND_POS[s.id];
      return { x: p.x * 10, y: p.y * 6 };
    });
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1], cur = pts[i];
      const midX = (prev.x + cur.x) / 2;
      d += ` Q ${midX} ${prev.y - 18} ${cur.x} ${cur.y}`;
    }
    const doneUntil = Math.min(state.unlocked, SECTIONS.length - 1);
    let dDone = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i <= doneUntil; i++) {
      const prev = pts[i - 1], cur = pts[i];
      dDone += ` Q ${(prev.x + cur.x) / 2} ${prev.y - 18} ${cur.x} ${cur.y}`;
    }
    $("mapRoute").innerHTML =
      `<path d="${d}" fill="none" stroke="#8B5A35" stroke-width="4" stroke-dasharray="10 12" opacity=".55"/>
       <path d="${dDone}" fill="none" stroke="#F4B942" stroke-width="4" stroke-dasharray="10 12" style="filter:drop-shadow(0 0 5px #F4B942)"/>`;

    const pieces = $("piecesTracker");
    pieces.innerHTML = Array.from({ length: TOTAL }, (_, i) =>
      `<span class="piece-slot ${state.answers[i + 1] && state.answers[i + 1].correct ? "filled" : ""}">${state.answers[i + 1] && state.answers[i + 1].correct ? "✦" : "?"}</span>`
    ).join("");

    const idx = state.unlocked;
    $("mapStatus").textContent = state.finished
      ? "اكتملت الرحلة! الكنز في انتظارك."
      : idx >= SECTIONS.length ? "أنجزت كل الجزر… افتح الصندوق!"
      : `الجزيرة التالية: ${SECTIONS[idx].name} ${SECTIONS[idx].icon}`;
    updateHUD();
  }

  function showMap() {
    state.section = null;
    showScreen("map");
    renderMap();
    Sound.play("bell");
  }

  function enterSection(index) {
    currentSectionIndex = index;
    state.section = SECTIONS[index].id;
    showScreen("stage");
    Sound.play("wood");
    renderStage();
  }

  /* ---------- بناء شاشة السؤال ---------- */
  function stageHead(section, q, list) {
    const idxInList = list.findIndex((x) => x.id === q.id);
    const dots = list.map((_, i) => `<i class="${i < idxInList ? "done" : i === idxInList ? "current" : ""}"></i>`).join("");
    return `<div class="stage-head">
      <div class="stage-identity"><span class="stage-icon">${section.icon}</span>
        <div><h2>${section.name}</h2><p>${section.desc}</p></div></div>
      <div class="question-dots" aria-label="تقدم القسم">${dots}</div>
    </div>`;
  }

  function renderStage() {
    clearInterval(timerId); timerId = null;
    const section = SECTIONS[currentSectionIndex];
    const list = questionsOf(section);
    const nextQ = list.find((q) => !state.answers[q.id]);
    if (!nextQ) {
      if (state.celebrated[section.id]) { showMap(); toast("أكملت هذا القسم مسبقًا يا قبطان!"); }
      else completeSection(section);
      return;
    }
    currentQuestion = nextQ;
    state.qIndex[section.id] = list.indexOf(nextQ);
    saveState();

    const card = $("stageCard");
    card.className = "stage-card theme-" + section.id;

    if (section.id === "port" || section.id === "treasure") renderMCQ(card, section, nextQ, list);
    else if (section.id === "depths") renderTF(card, section, nextQ, list);
    else if (section.id === "words") renderFill(card, section, nextQ, list);
    else if (section.id === "captain") {
      if (nextQ.mode === "match") renderMatch(card, section, nextQ, list);
      else renderOrder(card, section, nextQ, list);
    }
    updateHUD();
  }

  function questionBlock(q, extraClass) {
    return `<div class="question-text ${extraClass || ""}"><span class="question-number">السؤال ${q.id} من ${TOTAL}</span><br>${q.text}</div>`;
  }

  function footBlock() {
    return `<div class="stage-foot"><span class="note">💾 تقدّمك محفوظ تلقائيًا</span><button class="back-link" type="button" data-back>← العودة إلى خريطة الرحلة</button></div>`;
  }

  function renderMCQ(card, section, q, list) {
    const timerHTML = section.id === "treasure"
      ? `<div class="timer-box" id="timerBox">⏳ <strong class="timer-num" id="timerNum">45</strong>
           <div class="timer-track"><div class="timer-fill" id="timerFill" style="width:100%"></div></div>
           <span>أجب قبل انتهاء الوقت!</span></div>` : "";
    card.innerHTML = stageHead(section, q, list) + timerHTML + questionBlock(q) +
      `<div class="answer-grid">${q.options.map((o) =>
        `<button class="option-btn" type="button" data-key="${o.key}"><span class="key-badge">${o.key}</span><span>${o.text}</span></button>`
      ).join("")}</div><div id="feedbackSlot"></div>` + footBlock();

    card.querySelectorAll(".option-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const opt = q.options.find((o) => o.key === btn.dataset.key);
        recordAnswer(q, section, {
          isCorrect: q.correct === opt.key,
          answerText: `${opt.key}. ${opt.text}`,
          correctText: `${q.correct}. ${q.options.find((o) => o.key === q.correct).text}`,
          chosenEl: btn
        });
      });
    });
    bindBack(card);
    if (section.id === "treasure") startTimer(45, q, section);
  }

  function renderTF(card, section, q, list) {
    card.innerHTML = stageHead(section, q, list) + questionBlock(q) +
      `<div class="tf-actions">
         <button class="tf-btn" type="button" data-answer="صح">✔ صح</button>
         <button class="tf-btn" type="button" data-answer="خطأ">✖ خطأ</button>
       </div><div id="feedbackSlot"></div>` + footBlock();
    card.querySelectorAll(".tf-btn").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        const rect = btn.getBoundingClientRect();
        for (let i = 0; i < 7; i++) {
          const el = document.createElement("span");
          el.className = "bubble-fx";
          el.style.cssText = `left:${rect.left + Math.random() * rect.width}px;top:${rect.top + rect.height / 2}px;animation-delay:${i * 60}ms;`;
          $("fxLayer").appendChild(el);
          setTimeout(() => el.remove(), 1000 + i * 60);
        }
        const choice = btn.dataset.answer;
        recordAnswer(q, section, {
          isCorrect: q.correct === choice,
          answerText: choice, correctText: q.correct, chosenEl: btn
        });
      });
    });
    bindBack(card);
  }

  function renderFill(card, section, q, list) {
    const pieces = q.listLength || list.length;
    const pieceHTML = Array.from({ length: 2 }, (_, i) =>
      `<svg class="map-piece ${state.answers[list[i].id] && state.answers[list[i].id].correct ? "revealed" : ""}" id="piece${i}" viewBox="0 0 100 100"><use href="#mapPieceArt"/></svg>`
    ).join("");
    card.innerHTML = stageHead(section, q, list) +
      `<div class="question-text"><span class="question-number">السؤال ${q.id} من ${TOTAL}</span></div>` +
      `<div class="map-pieces" title="قطع خريطة الكنز">${pieceHTML}</div>` +
      `<div class="sentence">${q.before}<span class="blank" id="blank">............</span>${q.after}</div>` +
      `<div class="word-grid">${q.choices.map((w) => `<button class="word-tile" type="button" data-word="${w}">${w}</button>`).join("")}</div>` +
      `<div id="feedbackSlot"></div>` + footBlock();

    card.querySelectorAll(".word-tile").forEach((btn) => {
      btn.addEventListener("click", () => {
        const word = btn.dataset.word;
        $("blank").textContent = word;
        $("blank").classList.add("filled");
        const isCorrect = q.correct === word;
        const idx = list.findIndex((x) => x.id === q.id);
        if (isCorrect) {
          const piece = $("piece" + idx);
          if (piece) { piece.classList.add("revealed"); const r = piece.getBoundingClientRect(); spawnSparks(r.left + r.width / 2, r.top + r.height / 2); }
        }
        recordAnswer(q, section, { isCorrect, answerText: word, correctText: q.correct, chosenEl: btn });
      });
    });
    bindBack(card);
  }

  function renderMatch(card, section, q, list) {
    selectedMatch = null;
    matchAssign = {};
    card.innerHTML = stageHead(section, q, list) + questionBlock(q) +
      `<p class="drag-tip">🧭 اسحب المفهوم إلى التعريف المناسب، أو اضغط عليه ثم اضغط على التعريف.</p>
       <div class="match-board" id="matchBoard"><svg class="match-lines" id="matchLines"></svg>
         <div class="match-column"><h4>المفاهيم</h4><div id="conceptPool"></div></div>
         <div class="match-column"><h4>التعريفات</h4><div id="definitionPool"></div></div>
       </div>
       <div class="check-row"><button class="btn btn-gold" id="btnCheckMatch" type="button">✓ تحقق من التوصيل</button>
         <button class="btn btn-outline" id="btnResetMatch" type="button">↺ إعادة الترتيب</button></div>
       <div id="feedbackSlot"></div>` + footBlock();
    drawMatchBoard(q);
    $("btnCheckMatch").addEventListener("click", () => {
      if (state.answers[q.id]) return;
      const assigned = Object.keys(matchAssign).filter((k) => matchAssign[k]);
      if (assigned.length < q.concepts.length) { toast("أكمل توصيل المفاهيم الثلاثة أولًا!"); Sound.play("wrong"); return; }
      const isCorrect = q.concepts.every((c) => matchAssign[c.id] === q.correct[c.id]);
      const answerText = q.concepts.map((c) => `${c.id}←${matchAssign[c.id]}`).join("، ");
      const correctText = q.concepts.map((c) => `${c.id}←${q.correct[c.id]}`).join("، ");
      if (!isCorrect) { matchAssign = Object.assign({}, q.correct); drawMatchBoard(q, true); }
      recordAnswer(q, section, { isCorrect, answerText, correctText });
    });
    $("btnResetMatch").addEventListener("click", () => {
      if (state.answers[q.id]) return;
      matchAssign = {}; selectedMatch = null; drawMatchBoard(q); Sound.play("wood");
    });
    bindBack(card);
  }

  function drawMatchBoard(q, showCorrect) {
    const pool = $("conceptPool"), defs = $("definitionPool");
    if (!pool || !defs) return;
    const assignedConcepts = Object.keys(matchAssign);
    pool.innerHTML = q.concepts.filter((c) => !assignedConcepts.includes(c.id)).map((c) =>
      `<button class="match-chip ${selectedMatch === c.id ? "selected" : ""}" type="button" draggable="true" data-concept="${c.id}">${c.text}</button>`
    ).join("") || '<p style="font-size:.85rem;color:var(--sand)">جميع المفاهيم موصولة ✓</p>';
    defs.innerHTML = q.definitions.map((d) => {
      const owner = Object.keys(matchAssign).find((k) => matchAssign[k] === d.id);
      const chip = owner ? q.concepts.find((c) => c.id === owner) : null;
      const correctOwner = Object.keys(q.correct).find((k) => q.correct[k] === d.id);
      return `<div class="match-slot" data-def="${d.id}">
        <div class="slot-body"><span class="definition-text">${d.text}</span>
          ${chip ? `<span class="match-chip ${showCorrect && q.correct[chip.id] !== d.id ? "wrong" : ""} ${showCorrect && q.correct[chip.id] === d.id ? "correct" : ""}" draggable="true" data-concept="${chip.id}">${chip.text}</span>
          <span class="assigned-label">${showCorrect ? "التوصيل الصحيح: " + q.correct[chip.id] : "موصول ✓"}</span>` : ""}
        </div></div>`;
    }).join("");

    pool.querySelectorAll(".match-chip").forEach(bindConceptChip);
    defs.querySelectorAll(".match-chip").forEach(bindConceptChip);
    defs.querySelectorAll(".match-slot").forEach((slot) => {
      slot.addEventListener("dragover", (e) => { e.preventDefault(); slot.classList.add("over"); });
      slot.addEventListener("dragleave", () => slot.classList.remove("over"));
      slot.addEventListener("drop", (e) => {
        e.preventDefault(); slot.classList.remove("over");
        const id = e.dataTransfer.getData("text/plain") || selectedMatch;
        if (id) { assignMatch(id, slot.dataset.def, q); Sound.play("wood"); }
      });
      slot.addEventListener("click", (e) => {
        if (e.target.closest(".match-chip") || !selectedMatch || state.answers[q.id]) return;
        assignMatch(selectedMatch, slot.dataset.def, q); Sound.play("wood");
      });
    });
    requestAnimationFrame(() => drawMatchLines());
  }

  function bindConceptChip(chip) {
    const q = currentQuestion;
    chip.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", chip.dataset.concept);
      e.dataTransfer.effectAllowed = "move";
      chip.classList.add("dragging");
      selectedMatch = chip.dataset.concept;
    });
    chip.addEventListener("dragend", () => chip.classList.remove("dragging"));
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      if (state.answers[q.id]) return;
      selectedMatch = chip.dataset.concept;
      document.querySelectorAll(".match-chip").forEach((c) => c.classList.toggle("selected", c.dataset.concept === selectedMatch));
      Sound.play("gull");
    });
  }

  function assignMatch(conceptId, defId, q) {
    if (state.answers[q.id]) return;
    Object.keys(matchAssign).forEach((k) => { if (matchAssign[k] === defId) delete matchAssign[k]; });
    matchAssign[conceptId] = defId;
    selectedMatch = null;
    drawMatchBoard(q);
  }

  function drawMatchLines() {
    const board = $("matchBoard"), svg = $("matchLines");
    if (!board || !svg || !Object.keys(matchAssign).length) return;
    const base = board.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${base.width} ${base.height}`);
    svg.innerHTML = Object.entries(matchAssign).map(([concept, def]) => {
      const chip = board.querySelector(`.match-chip[data-concept="${concept}"]`);
      const slot = board.querySelector(`.match-slot[data-def="${def}"]`);
      if (!chip || !slot) return "";
      const a = chip.getBoundingClientRect(), b = slot.getBoundingClientRect();
      const x1 = a.right - base.left, y1 = a.top + a.height / 2 - base.top;
      const x2 = b.left - base.left, y2 = b.top + b.height / 2 - base.top;
      const mid = (x1 + x2) / 2;
      return `<path d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}"/>`;
    }).join("");
  }

  function renderOrder(card, section, q, list) {
    selectedOrder = null;
    const shuffled = [q.items[1], q.items[3], q.items[0], q.items[2]];
    orderSlots = [null, null, null, null];
    card.innerHTML = stageHead(section, q, list) + questionBlock(q) +
      `<p class="drag-tip">🧭 اسحب كل مرحلة إلى ترتيبها الصحيح، أو اضغط عليها ثم اضغط على الخانة.</p>
       <div class="order-slots" id="orderSlots"></div>
       <div class="order-pool" id="orderPool"></div>
       <div class="check-row"><button class="btn btn-gold" id="btnCheckOrder" type="button">✓ تحقق من الترتيب</button>
         <button class="btn btn-outline" id="btnResetOrder" type="button">↺ إعادة الترتيب</button></div>
       <div id="feedbackSlot"></div>` + footBlock();

    function draw() {
      $("orderPool").innerHTML = shuffled.filter((it) => !orderSlots.includes(it)).map((it) =>
        `<button class="match-chip" type="button" draggable="true" data-item="${it}">${it}</button>`).join("")
        || '<span style="color:var(--sand);font-size:.85rem">وضعت كل المراحل ✓</span>';
      $("orderSlots").innerHTML = orderSlots.map((it, i) =>
        `<div class="order-slot" data-index="${i}"><span class="slot-num">${i + 1}</span>
          ${it ? `<button class="match-chip" type="button" draggable="true" data-item="${it}">${it}</button>` : ""}</div>`).join("");

      document.querySelectorAll("#orderPool .match-chip, #orderSlots .match-chip").forEach((chip) => {
        chip.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/plain", chip.dataset.item);
          selectedOrder = chip.dataset.item; chip.classList.add("dragging");
        });
        chip.addEventListener("dragend", () => chip.classList.remove("dragging"));
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          if (state.answers[q.id]) return;
          selectedOrder = chip.dataset.item;
          document.querySelectorAll(".match-chip").forEach((c) => c.classList.toggle("selected", c.dataset.item === selectedOrder));
          Sound.play("gull");
        });
      });
      document.querySelectorAll(".order-slot").forEach((slot) => {
        slot.addEventListener("dragover", (e) => { e.preventDefault(); slot.classList.add("over"); });
        slot.addEventListener("dragleave", () => slot.classList.remove("over"));
        slot.addEventListener("drop", (e) => {
          e.preventDefault(); slot.classList.remove("over");
          placeOrder(e.dataTransfer.getData("text/plain") || selectedOrder, Number(slot.dataset.index));
          Sound.play("wood");
        });
        slot.addEventListener("click", (e) => {
          if (e.target.closest(".match-chip") || !selectedOrder || state.answers[q.id]) return;
          placeOrder(selectedOrder, Number(slot.dataset.index)); Sound.play("wood");
        });
      });
    }

    function placeOrder(item, index) {
      if (!item || state.answers[q.id]) return;
      orderSlots = orderSlots.map((x) => (x === item ? null : x));
      const displaced = orderSlots[index];
      orderSlots[index] = item;
      if (displaced && !orderSlots.includes(displaced)) {
        const free = orderSlots.findIndex((x) => x === null);
        if (free >= 0) orderSlots[free] = displaced;
      }
      selectedOrder = null; draw();
    }

    draw();
    $("btnCheckOrder").addEventListener("click", () => {
      if (state.answers[q.id]) return;
      if (orderSlots.some((x) => !x)) { toast("رتّب المراحل الأربع أولًا!"); Sound.play("wrong"); return; }
      const isCorrect = orderSlots.every((x, i) => x === q.correct[i]);
      const answerText = orderSlots.map((x, i) => `${i + 1}. ${x}`).join(" | ");
      const correctText = q.correct.map((x, i) => `${i + 1}. ${x}`).join(" | ");
      if (!isCorrect) { orderSlots = q.correct.slice(); draw(); }
      recordAnswer(q, section, { isCorrect, answerText, correctText });
    });
    $("btnResetOrder").addEventListener("click", () => {
      if (state.answers[q.id]) return;
      orderSlots = [null, null, null, null]; selectedOrder = null; draw(); Sound.play("wood");
    });
    bindBack(card);
  }

  function bindBack(card) {
    const btn = card.querySelector("[data-back]");
    if (btn) btn.addEventListener("click", () => { Sound.play("wood"); showMap(); });
  }

  /* ---------- المؤقت ---------- */
  function startTimer(seconds, q, section) {
    clearInterval(timerId);
    let left = seconds;
    const num = $("timerNum"), fill = $("timerFill"), box = $("timerBox");
    const paint = () => {
      if (!num || !fill || !box) return;
      num.textContent = left;
      fill.style.width = (left / seconds) * 100 + "%";
      box.classList.toggle("danger", left <= 10);
    };
    paint();
    timerId = setInterval(() => {
      left--;
      paint();
      if (left <= 0) {
        clearInterval(timerId); timerId = null;
        if (!state.answers[q.id]) {
          Sound.play("wrong");
          recordAnswer(q, section, {
            isCorrect: false, answerText: "لم تُجَب (انتهى الوقت)",
            correctText: `${q.correct}. ${q.options.find((o) => o.key === q.correct).text}`
          });
        }
      }
    }, 1000);
  }

  /* ---------- تسجيل الإجابة ---------- */
  function recordAnswer(q, section, opts) {
    if (state.answers[q.id]) return;
    clearInterval(timerId); timerId = null;
    const isCorrect = !!opts.isCorrect;
    state.answers[q.id] = {
      correct: isCorrect,
      answer: opts.answerText || "—",
      correctAnswer: opts.correctText || "—",
      section: section.id
    };
    if (isCorrect) { state.score += POINTS; state.correct++; }
    else state.wrong++;
    refreshUnlock(); saveState(); updateHUD();

    const rect = (opts.chosenEl && opts.chosenEl.getBoundingClientRect()) || { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    if (isCorrect) {
      Sound.play("correct"); setTimeout(() => Sound.play("coin"), 180);
      spawnCoins(cx, cy, 10); spawnSparks(cx, cy, 14);
      if (opts.chosenEl) opts.chosenEl.classList.add("correct");
    } else {
      Sound.play("wrong");
      if (opts.chosenEl) opts.chosenEl.classList.add("wrong");
    }
    // تعطيل كل خيارات الإجابة بعد المحاولة
    document.querySelectorAll(".stage-card .option-btn, .stage-card .tf-btn, .stage-card .word-tile, .stage-card .match-chip, .stage-card #btnCheckMatch, .stage-card #btnResetMatch, .stage-card #btnCheckOrder, .stage-card #btnResetOrder")
      .forEach((el) => { el.disabled = true; el.style.pointerEvents = "none"; });

    const feedback = isCorrect
      ? `<div class="feedback correct">🏴‍☠️ <strong>أحسنت يا قرصان! حصلت على نقاط وقطعة من خريطة الكنز</strong><br>أجبتَ: ${opts.answerText}</div>`
      : `<div class="feedback wrong">🌊 لا بأس يا قبطان، كل محاولة تقربك من الكنز!<br>إجابتك: ${opts.answerText}<br><strong>الإجابة الصحيحة: ${opts.correctText}</strong></div>`;

    const slot = $("feedbackSlot");
    if (slot) {
      slot.innerHTML = feedback + `<div class="check-row"><button class="btn btn-gold" id="btnNextQuestion" type="button">
        ${questionsOf(section).some((x) => !state.answers[x.id]) ? "السؤال التالي ←" : "أكمل الإبحار ←"}</button></div>`;
      $("btnNextQuestion").addEventListener("click", () => afterAnswer(section));
      slot.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function afterAnswer(section) {
    Sound.play("wood");
    const remaining = questionsOf(section).filter((q) => !state.answers[q.id]);
    if (remaining.length) renderStage();
    else completeSection(section, true);
  }

  /* ---------- مكافآت الأقسام والنهاية ---------- */
  function completeSection(section, force) {
    if (state.celebrated[section.id] && !force) { showMap(); return; }
    state.celebrated[section.id] = true;
    refreshUnlock(); saveState();
    Sound.play("bell");
    const isTreasure = section.id === "treasure";
    $("celebrationTitle").textContent = isTreasure ? "حصلت على مفتاح الصندوق!" : "أحسنت يا قرصان!";
    $("celebrationText").textContent = isTreasure
      ? "أجبت عن أسئلة الكنز الأخير… الصندوق الذهبي ينتظرك."
      : "حصلت على نقاط وقطعة من خريطة الكنز، وُفتحت الجزيرة التالية.";
    $("celebrationReward").innerHTML = isTreasure
      ? '<svg viewBox="0 0 80 40" style="width:90px;height:45px"><use href="#keyArt"/></svg>'
      : `<svg viewBox="0 0 100 100"><use href="#mapPieceArt"/></svg><svg viewBox="0 0 40 40"><use href="#coinArt"/></svg><svg viewBox="0 0 40 40"><use href="#coinArt"/></svg>`;
    celebrationNext = isTreasure ? "end" : "map";
    $("celebration").classList.remove("hidden");
    const r = $("celebration").getBoundingClientRect();
    spawnCoins(r.left + r.width / 2, r.top + r.height / 2, 12);
  }

  function finishGame() {
    state.finished = true; state.screen = "end"; saveState();
    showScreen("end");
    const n = answeredCount();
    const pct = Math.round((state.correct / TOTAL) * 100);
    $("endScore").textContent = state.score;
    $("endCorrect").textContent = state.correct + " / " + TOTAL;
    $("endPercent").textContent = pct + "%";
    const chest = document.querySelector(".chest");
    chest.classList.remove("opened");
    $("coinBurst").innerHTML = "";
    setTimeout(() => {
      chest.classList.add("opened");
      Sound.play("chest");
      const scene = document.querySelector(".end-scene").getBoundingClientRect();
      for (let i = 0; i < 26; i++) {
        const c = document.createElement("span");
        c.className = "flying-coin";
        c.style.cssText = `left:${scene.left + scene.width / 2}px;top:${scene.top + scene.height * 0.55}px;--dx:${(Math.random() - 0.5) * scene.width * 1.1}px;--dy:${-40 - Math.random() * scene.height}px;animation-delay:${i * 45}ms;`;
        c.innerHTML = '<svg viewBox="0 0 40 40"><use href="#coinArt"/></svg>';
        $("coinBurst").appendChild(c);
        setTimeout(() => c.remove(), 2200 + i * 45);
      }
    }, 600);
  }

  function buildResults() {
    const pct = Math.round((state.correct / TOTAL) * 100);
    $("modalSummary").innerHTML =
      `<span>💰 النقاط: <strong>${state.score}</strong></span>
       <span>✅ صحيحة: <strong>${state.correct}</strong></span>
       <span>❌ خاطئة: <strong>${state.wrong}</strong></span>
       <span>📈 النسبة: <strong>${pct}%</strong></span>`;
    const all = SECTIONS.slice(1).flatMap((s) => questionsOf(s));
    $("resultsList").innerHTML = all.map((q) => {
      const a = state.answers[q.id];
      return `<div class="result-item ${a && a.correct ? "ok" : "no"}">
        <div class="result-q">${q.id}. ${q.text}</div>
        <div class="result-meta">
          <span>${a ? (a.correct ? "✅ إجابة صحيحة" : "❌ إجابة خاطئة") : "⚪ لم تُجب"}</span>
          <span>إجابتك: ${a ? a.answer : "—"}</span>
          <span>الصحيح: ${a ? a.correctAnswer : (q.options ? `${q.correct}. ${q.options.find((o) => o.key === q.correct).text}` : (q.correct || q.correctText || "—"))}</span>
        </div></div>`;
    }).join("");
  }

  function replay() {
    const keepSound = state.sound;
    state = defaultState();
    state.sound = keepSound;
    saveState();
    $("resultsModal").classList.add("hidden");
    $("helpModal").classList.add("hidden");
    $("celebration").classList.add("hidden");
    document.querySelector(".chest").classList.remove("opened");
    $("coinBurst").innerHTML = "";
    const ship = $("startShip");
    ship.classList.remove("docking"); ship.classList.add("sailing");
    showScreen("start");
    updateSoundUI(); updateHUD();
    toast("استعد لمغامرة جديدة يا قبطان!");
  }

  /* ---------- ربط الأحداث العامة ---------- */
  function bindGlobalEvents() {
    $("btnStart").addEventListener("click", () => {
      Sound.init(); Sound.play("wood");
      const ship = $("startShip");
      ship.classList.remove("sailing"); ship.classList.add("docking");
      setTimeout(() => { Sound.play("bell"); showMap(); ship.classList.remove("docking"); }, 1500);
    });
    $("btnStartSound").addEventListener("click", toggleSound);
    $("btnSound").addEventListener("click", toggleSound);
    $("btnHome").addEventListener("click", () => { Sound.play("wood"); showMap(); });
    $("btnCelebrationNext").addEventListener("click", () => {
      $("celebration").classList.add("hidden");
      Sound.play("wood");
      if (celebrationNext === "end") finishGame(); else showMap();
    });
    $("btnReplay").addEventListener("click", replay);
    $("btnModalReplay").addEventListener("click", replay);
    $("btnShowResults").addEventListener("click", () => { buildResults(); $("resultsModal").classList.remove("hidden"); Sound.play("bell"); });
    $("btnCloseResults").addEventListener("click", () => $("resultsModal").classList.add("hidden"));
    $("btnMapHelp").addEventListener("click", () => $("helpModal").classList.remove("hidden"));
    $("btnCloseHelp").addEventListener("click", () => $("helpModal").classList.add("hidden"));
    $("btnCloseHelp2").addEventListener("click", () => $("helpModal").classList.add("hidden"));
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      $("resultsModal").classList.add("hidden");
      $("helpModal").classList.add("hidden");
    });
    window.addEventListener("resize", () => { if (state.screen === "stage") drawMatchLines(); });
  }

  /* ---------- التهيئة ---------- */
  function init() {
    initAmbientBubbles();
    initPointerEffects();
    bindGlobalEvents();
    updateSoundUI();
    updateHUD();
    showScreen(state.finished ? "end" : state.screen === "start" ? "start" : state.screen);
    if (state.finished) {
      const n = answeredCount();
      $("endScore").textContent = state.score;
      $("endCorrect").textContent = state.correct + " / " + TOTAL;
      $("endPercent").textContent = Math.round((state.correct / TOTAL) * 100) + "%";
      document.querySelector(".chest").classList.add("opened");
    } else if (state.screen === "map") renderMap();
    else if (state.screen === "stage") renderStage();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
