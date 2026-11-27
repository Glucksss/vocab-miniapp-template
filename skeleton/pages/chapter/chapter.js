const quiz = require('../../utils/quiz.js');
const storage = require('../../utils/storage.js');
const levels = require('../../data/levels.js');
const wordCard = require('../../utils/wordCard.js');
const ui = require('../../utils/ui.js');
const tts = require('../../utils/tts.js');
const vp = require('../../utils/volPicker.js');
const ad = require('../../utils/ad.js');

// 章节内 5 步节奏：每步换一种题型，三方向递进（识别→回忆→拼写）+ 限时冲刺
// 新学 反向(英→中)5 → 练习 正向(中→英)5 → 复习 打字拼写5 → 宝箱 → 小挑战 限时反向5
// 主关 20 题；结算后可再点「错词加练 5 题」，加练不阻塞通关、不改写主关星级。
const TIMED_SEC = 15;
// 开箱达标线：宝箱前 15 题答对 >= 9 题才能开箱（约 60% 正确率）。
// 未达标只让"再闯一次"，不发奖、不记星，错词照样进错词本。
const PASS_MIN = 9;
const ADDON_COUNT = 5;
const STAGES = [
  { key: 'learn', name: '新学', icon: '🌱', desc: '看英文，选中文意思', count: 5, type: 'reverse' },
  { key: 'practice', name: '练习', icon: '✏️', desc: '看中文，选英文单词', count: 5, type: 'forward' },
  { key: 'review', name: '复习', icon: '🧠', desc: '看中文，拼出单词', count: 5, type: 'typing' },
  { key: 'chest', name: '宝箱', icon: '🎁', desc: '走过一半，开个宝箱', count: 0, type: '' },
  { key: 'challenge', name: '小挑战', icon: '⚡', desc: '限时抢答，冲刺三星', count: 5, type: 'timed' },
];

const UNIT_NAMES = ['', '基础入门', '词块进阶', '语境突破', '高分冲刺'];
const VOL_NAMES = ['', '必修一', '必修二', '必修三', '选择性必修一', '选择性必修二', '选择性必修三', '选择性必修四'];

// 智能抽词：优先抽本单元练得少的词。
// 熟悉度 = 练习次数 collected[word].n × 2 + 极小扰动(0~0.5)。
// ×2 的间隔保证"没练过(n=0)"永远排在"练过1次(n=1)"之前，扰动只在同档内打乱顺序。
function pickWords(pool, count, used) {
  const colMap = {};
  storage.getCollected().forEach(function (c) { colMap[c.w] = c.n || 0; });
  const scored = pool.map(function (w) {
    const n = colMap[w[0]] || 0;
    return { w: w, score: n * 2 + Math.random() * 0.5 };
  });
  scored.sort(function (a, b) { return a.score - b.score; });
  const out = [];
  const seen = {};
  for (let i = 0; i < scored.length && out.length < count; i++) {
    const key = scored[i].w[0];
    if (used && used[key]) continue;
    if (seen[key]) continue;
    seen[key] = true;
    out.push(scored[i].w);
  }
  for (let i = 0; i < scored.length && out.length < count; i++) {
    const key = scored[i].w[0];
    if (!seen[key]) { seen[key] = true; out.push(scored[i].w); }
  }
  return out;
}

// 某册某单元原始词 [w,p,m]
function unitWords(u, v) {
  const volV = v || 1;
  const out = [];
  for (let i = 0; i < levels.length; i++) {
    const lv = levels[i];
    if (lv.v === volV && lv.u === u) {
      for (let k = 0; k < lv.w.length; k++) out.push(lv.w[k]);
    }
  }
  return out;
}

// 同册前面单元里"已学过"的词（阶段式混合用）
function priorLearnedWords(u, v) {
  const volV = v || 1;
  const colMap = {};
  storage.getCollected().forEach(function (c) { colMap[c.w] = true; });
  const out = [];
  for (let i = 0; i < levels.length; i++) {
    const lv = levels[i];
    if (lv.v === volV && lv.u > 0 && lv.u < u) {
      for (let k = 0; k < lv.w.length; k++) {
        if (colMap[lv.w[k][0]]) out.push(lv.w[k]);
      }
    }
  }
  return out;
}

// 全量词索引：任何来源（到期词/collected/错词）都从这里补全 [w,p,m]，
// 避免只塞单词导致题干为空（曾是复习步空白的根因）。
function buildWordIndex() {
  const index = {};
  for (let i = 0; i < levels.length; i++) {
    const ws = levels[i].w || [];
    for (let k = 0; k < ws.length; k++) {
      if (ws[k] && ws[k][0] && !index[ws[k][0]]) index[ws[k][0]] = ws[k];
    }
  }
  return index;
}

// 打字复习词源：遗忘曲线到期词（跨单元）+ 本单元已学词补足
function typingWords(u, count, v) {
  const index = buildWordIndex();
  const colMap = {};
  storage.getCollected().forEach(function (c) { colMap[c.w] = true; });
  const out = [];
  const seen = {};
  function add(w) {
    if (!w || !w[0] || seen[w[0]]) return;
    const full = index[w[0]] || w;
    // 题干必须有中文释义，否则打字题没法做——用索引补全后仍为空则跳过
    if (!String(full[2] || '').trim()) return;
    seen[w[0]] = true;
    out.push(full);
  }
  // 1) 遗忘曲线到期词（跨单元），释义从索引补全
  storage.dueWords().slice(0, count).forEach(function (d) { add([d.w, d.p || '', d.m || '']); });
  // 2) 本单元已学词
  quiz.shuffle(unitWords(u, v).filter(function (w) { return colMap[w[0]]; })).forEach(add);
  // 3) 其它已学词（跨单元温故），带全量释义
  quiz.shuffle(Object.keys(colMap).map(function (w) { return index[w] || [w, '', '']; })).forEach(add);
  // 4) 兜底：本单元词，保证首次进入也不空
  quiz.shuffle(unitWords(u, v)).forEach(add);
  return out.slice(0, count);
}

// 给题目打题型标记，供模板分支渲染与判定
function tag(list, type) {
  return list.map(function (q) { q.type = type; return q; });
}

// 可选加练词源：错词本优先（错得越多越靠前）→ 遗忘曲线到期词 → 本单元词兜底。
// 全部从全量索引补全 [w,p,m]，保证题干、音标、判定都有数据。
function addonWords(u, count, v) {
  const index = buildWordIndex();
  const out = [];
  const seen = {};
  function add(raw) {
    if (!raw) return;
    const key = Array.isArray(raw) ? raw[0] : raw.w;
    if (!key || seen[key]) return;
    const full = index[key] || (Array.isArray(raw)
      ? [raw[0], raw[1] || '', raw[2] || '']
      : [raw.w, raw.p || '', raw.m || '']);
    if (!String(full[2] || '').trim()) return;
    seen[key] = true;
    out.push(full);
  }
  const wrong = storage.getWrong().slice().sort(function (a, b) {
    return (b.n || 1) - (a.n || 1);
  });
  wrong.forEach(add);
  storage.dueWords().forEach(add);
  quiz.shuffle(unitWords(u, v)).forEach(add);
  return out.slice(0, count);
}

// 加练 5 题混合三种回忆方式：拼写 → 英选中 → 中选英 → 拼写 → 英选中。
// 不采用限时，避免"加练"变成二次惩罚。
function makeAddonQuestions(u, count, v) {
  const words = addonWords(u, count, v);
  if (!words.length) return [];
  const index = buildWordIndex();
  const pool = Object.keys(index).map(function (w) { return index[w]; });
  const qs = [];
  words.forEach(function (w, i) {
    const one = [w];
    if (i % 3 === 0) {
      qs.push(tag(quiz.makeTypingQuestions(one, 1), 'typing')[0]);
    } else if (i % 3 === 1) {
      qs.push(tag(quiz.makeReverseChoiceQuestions(one, 1, pool), 'reverse')[0]);
    } else {
      qs.push(tag(quiz.makeForwardChoiceQuestions(one, 1, pool), 'forward')[0]);
    }
  });
  return qs;
}

// 星际词卡：统一走加载器（必修一本地同步，其余册分包按需）。没数据的词不显示入口。
function detailFor(w) {
  return wordCard.get(w);
}

// 宝箱档位由第几关决定：第1关木 → 第2关银 → 第3关金 → 第4关传说（越往后越高级）。
// 正确率不决定档位，只决定"全对加成"：能量翻倍 + 词卡保底提升一档。
function tierByUnit(u) {
  return Math.max(1, Math.min(4, Number(u) || 1));
}

Page(Object.assign({}, vp.behavior, {
  data: Object.assign({}, vp.data(), {
    unit: 1,
    volName: '',
    unitName: '',
    stages: [],
    stageIndex: 0,
    stageName: '',
    stageIcon: '',
    stageDesc: '',
    questions: [],
    qIndex: 0,
    current: null,
    feedback: '',
    feedbackWord: '',
    typed: '',
    spellLocked: false,
    timeLeft: TIMED_SEC,
    totalRight: 0,
    answered: 0,        // 主关已答题数（宝箱判定按此口径算，宝箱前 15 题）
    chestPassed: false, // 是否达到开箱线（答对 >= PASS_MIN）
    chestReason: '',    // 宝箱档位理由文案
    stageRight: 0,
    totalCount: 0,
    chestOpened: false,
    chestWord: '',
    chest: null,
    chestResult: null,
    chestCard: null,
    chestDoubled: false, // 本箱是否已看视频翻倍，每箱仅一次
    finished: false,
    star: 0,
    starSlots: [1, 2, 3],
    earnedBadges: [],
    // 结算后可选错词加练：独立计数，绝不改写主关星级与答对口径
    addonMode: false,
    addonDone: false,
    addonRight: 0,
    addonCount: 0,
    addonStageRight: 0,
    // 星际词卡弹层
    detailOpen: false,
    detail: null,
    detailWord: '',
    detailSaved: false,
    canOpenDetail: false,
    keys: ['A', 'B', 'C', 'D'],
  }),

  onLoad(options) {
    // 章节页按册次+单元出题：大地图带入 v/u，页内也可改
    const range = vp.init(this, options || {}, { maxVol: 7, minUnit: 1, noMixed: true });
    this.applyRange(range.v, range.u);
  },

  // 按新范围重建五步题库并同步首页大地图册次
  applyRange(v, u) {
    this.unit = u;
    this.volV = v;
    // 同步首页大地图当前册次，避免"章节在必修二、地图还显示必修一"
    wx.setStorageSync('home_vol', v);
    this.stopTimer();
    this.stopAdvance();
    this.earnedStar = 0;
    // 清空上一轮的答题计数，开箱/星级判定不串关
    this.setData({
      answered: 0,
      totalRight: 0,
      score: 0,
      combo: 0,
      maxCombo: 0,
      finished: false,
      won: false,
      resultOpen: false,
      feedback: '',
      detailOpen: false,
      chestOpen: false,
    });
    this.rebuildBank(u, v);
  },

  rebuildBank(u, v) {
    const words = unitWords(u, v);
    this.words = words;
    const levelIds = [];
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].v === v && levels[i].u === u) levelIds.push(levels[i].id);
    }
    this.levelIds = levelIds;

    // 新学/练习：本单元智能抽词，两步间不重复
    const used = {};
    const mark = function (list) { list.forEach(function (w) { used[w[0]] = true; }); };
    const learnWords = pickWords(words, STAGES[0].count, used); mark(learnWords);
    const practiceWords = pickWords(words, STAGES[1].count, used); mark(practiceWords);
    // 复习：到期词 + 本单元已学（打字拼写）
    const reviewWords = typingWords(u, STAGES[2].count, v);
    // 小挑战：优先前面单元已学词 + 本单元已学词混合（限时抢答考旧词），不足再用本单元词补。
    // 注意不能用 pickWords 直接抽全池——它优先未练词，会把旧词挤掉，违背"阶段式混合"。
    const prior = priorLearnedWords(u, v);
    const colMap = {};
    storage.getCollected().forEach(function (c) { colMap[c.w] = true; });
    const ownLearned = words.filter(function (w) { return colMap[w[0]]; });
    let challengePool = prior.concat(ownLearned);
    if (challengePool.length < STAGES[4].count) challengePool = challengePool.concat(words);
    const challengeWords = pickWords(challengePool, STAGES[4].count, used); mark(challengeWords);

    const learn = tag(quiz.makeReverseChoiceQuestions(learnWords, learnWords.length, words), 'reverse');
    const practice = tag(quiz.makeForwardChoiceQuestions(practiceWords, practiceWords.length, words), 'forward');
    const review = tag(quiz.makeTypingQuestions(reviewWords, reviewWords.length), 'typing');
    const challenge = tag(quiz.makeReverseChoiceQuestions(challengeWords, challengeWords.length, challengePool), 'timed');

    this.bank = { learn: learn, practice: practice, review: review, challenge: challenge };
    const totalCount = learn.length + practice.length + review.length + challenge.length;
    const bank = this.bank;
    const stagesView = STAGES.map(function (s) {
      const n = s.key === 'chest' ? 0 : (bank[s.key] || []).length;
      return { key: s.key, name: s.name, icon: s.icon, count: n };
    });

    this.setData({
      unit: u,
      volName: VOL_NAMES[v] || ('第' + v + '册'),
      unitName: UNIT_NAMES[u] || ('第' + u + '单元'),
      stages: stagesView,
      totalCount: totalCount,
    });
    this.enterStage(0);
  },

  onUnload() {
    this.stopTimer();
    this.stopAdvance();
    try { tts.stop(); } catch (e) {}
  },

  enterStage(i) {
    this.stopTimer();
    this.stopAdvance();
    if (i >= STAGES.length) { this.finish(); return; }
    const s = STAGES[i];
    if (s.key === 'chest') {
      const w = this.words.length ? this.words[Math.floor(Math.random() * this.words.length)] : ['quest', '', '单词之旅'];
      // 档位由第几关决定（第1关木…第4关传说）；全对则额外加成（能量翻倍+词卡升级）
      const tier = tierByUnit(this.unit);
      const perfect = this.data.answered > 0 && this.data.totalRight === this.data.answered;
      const preview = storage.chestPreview(tier, perfect);
      const ratePct = this.data.answered ? Math.round(this.data.totalRight * 100 / this.data.answered) : 0;
      const passed = this.data.totalRight >= PASS_MIN;
      const reason = '答对 ' + this.data.totalRight + '/' + this.data.answered + '（' + ratePct + '%）· '
        + (passed ? ('第' + this.unit + '关 ' + preview.name + (perfect ? '　🎁 全对加成！' : '')) : ('再答对 ' + (PASS_MIN - this.data.totalRight) + ' 题即可开箱'));
      this.chestTier = tier;
      this.chestPerfect = perfect;
      this.setData({
        stageIndex: i, stageName: s.name, stageIcon: s.icon, stageDesc: s.desc,
        questions: [], current: null, chestOpened: false, chestWord: w[0], chestPassed: passed,
        chest: preview, chestReason: reason, chestResult: null, chestCard: null, chestDoubled: false,
        feedback: '', feedbackWord: '', typed: '', spellLocked: false, stageRight: 0,
        detailOpen: false,
      });
      return;
    }
    const qs = this.bank[s.key] || [];
    if (!qs.length) { this.enterStage(i + 1); return; }
    this.setData({
      stageIndex: i, stageName: s.name, stageIcon: s.icon, stageDesc: s.desc,
      questions: qs, qIndex: 0, current: qs[0], feedback: '', feedbackWord: '',
      typed: '', spellLocked: false, timeLeft: TIMED_SEC, stageRight: 0,
      detailOpen: false,
    });
    this.maybeTimer();
  },

  tapOption(e) {
    if (this.data.feedback || !this.data.current) return;
    this.stopTimer();
    const label = e.currentTarget.dataset.label;
    const q = this.data.current;
    const type = q.type || 'reverse';
    // 正向题正确项=英文原词；反向/限时题正确项=中文短释义。记录 key 一律英文原词。
    const rightLabel = type === 'forward' ? q.answer : quiz.shortMeaning(q.meaning);
    this.applyAnswer(label === rightLabel, q, rightLabel);
  },

  onTypeInput(e) { this.setData({ typed: e.detail.value }); },

  submitTyping() {
    if (this.data.feedback || !this.data.current || this.data.spellLocked) return;
    this.stopTimer();
    const q = this.data.current;
    const typed = String(this.data.typed || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!typed) return;
    const target = String(q.answer || '').toUpperCase().replace(/\s+/g, ' ');
    this.applyAnswer(typed === target, q, q.answer);
  },

  applyAnswer(right, q, rightLabel) {
    const rec = { w: q.answer, p: q.phonetic || '', m: q.meaning || q.q || '' };
    storage.addStat(right ? 1 : 0, right ? 0 : 1);
    storage.recordReview(rec, right);
    if (!right) { storage.addWrong(rec); ui.notify(this, ui.wrongTip()); }
    try { tts.speakWord(rec); } catch (err) {}
    const base = {
      feedback: right ? 'right' : 'wrong',
      feedbackWord: rightLabel,
      spellLocked: true,
      canOpenDetail: !!detailFor(q.answer),
    };
    if (this.addonMode) {
      // 加练只记录真实学习数据，不改主关的 totalRight / answered / 星级。
      this.setData(Object.assign(base, { addonStageRight: this.data.addonStageRight + (right ? 1 : 0) }));
    } else {
      this.setData(Object.assign(base, {
        stageRight: this.data.stageRight + (right ? 1 : 0),
        totalRight: this.data.totalRight + (right ? 1 : 0),
        answered: this.data.answered + 1,
      }));
    }
    // 有星际词卡的题多留一点时间，让孩子能点「看词卡」；没词卡时保持原节奏。
    this.scheduleAdvance(right, !!detailFor(q.answer));
  },

  // 读题干英文（能力检测+异常隔离）
  speakWord() {
    try {
      const q = this.data.current;
      if (q) tts.speakWord({ w: q.answer, p: q.phonetic || '', m: q.meaning || '' });
    } catch (e) {}
  },

  maybeTimer() {
    const q = this.data.current;
    if (q && q.type === 'timed') this.startTimer();
    else this.stopTimer();
  },
  startTimer() {
    this.stopTimer();
    const self = this;
    this.setData({ timeLeft: TIMED_SEC });
    this.timer = setInterval(function () {
      const left = self.data.timeLeft - 1;
      if (left <= 0) {
        self.stopTimer();
        if (!self.data.feedback && self.data.current && self.data.current.type === 'timed') {
          const q = self.data.current;
          self.applyAnswer(false, q, quiz.shortMeaning(q.meaning));
        }
      } else {
        self.setData({ timeLeft: left });
      }
    }, 1000);
  },
  stopTimer() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },

  // 自动跳题计时器：词卡弹层打开时必须暂停，否则用户还没看完就跳走了。
  stopAdvance() { if (this.advanceTimer) { clearTimeout(this.advanceTimer); this.advanceTimer = null; } },
  scheduleAdvance() {
    // 全部题目都改成用户控制：答完题后统一显示「下一题」，不再自动跳。
    this.stopAdvance();
  },

  advance() {
    this.stopTimer();
    this.stopAdvance();
    const next = this.data.qIndex + 1;
    if (next >= this.data.questions.length) {
      if (this.addonMode) { this.finishAddon(); return; }
      this.enterStage(this.data.stageIndex + 1);
      return;
    }
    this.setData({
      qIndex: next, current: this.data.questions[next], feedback: '', feedbackWord: '',
      typed: '', spellLocked: false, timeLeft: TIMED_SEC, canOpenDetail: false,
    });
    this.maybeTimer();
  },

  // ===== 星际词卡 =====
  openWordCard() {
    if (!this.data.feedback || !this.data.current) return;
    const w = this.data.current.answer;
    const self = this;
    // 本地数据同步打开；否则按词所属册次加载分包后再开（首次可能短暂等待）。
    if (wordCard.hasData(w)) {
      this.stopAdvance();
      this.setData({ detailOpen: true, detail: detailFor(w), detailWord: w, detailSaved: false });
      // 基础词卡先显示；分包可用时后台补齐搭配/同义词，并原地刷新弹层
      if (wordCard.isBasic(w)) {
        const v = this.volumeOfWord(w);
        wordCard.ensure(v, function () {
          const d = detailFor(w);
          if (d && !d._basic && self.data.detailWord === w) self.setData({ detail: d });
        });
      }
      return;
    }
    const v = this.volumeOfWord(w);
    ui.showLoading({ title: '加载词卡…' });
    wordCard.ensure(v, function () {
      ui.hideLoading();
      const d = detailFor(w);
      if (!d) { ui.notify(self, '暂无词卡'); return; }
      self.stopAdvance();
      self.setData({ detailOpen: true, detail: d, detailWord: w, detailSaved: false });
    });
  },

  // 由单词反查所属册次 v（用于分包定位）
  volumeOfWord(w) {
    for (let i = 0; i < levels.length; i++) {
      const ws = levels[i].w || [];
      for (let k = 0; k < ws.length; k++) {
        if (ws[k][0] === w) return levels[i].v;
      }
    }
    return 1;
  },

  // 右上角 ✕ 和点遮罩只关闭词卡，停留在当前题目；只有底部「下一题」才推进。
  closeWordCard() {
    this.setData({ detailOpen: false });
  },

  closeWordCardAndAdvance() {
    this.setData({ detailOpen: false });
    this.advance();
  },

  addDetailToWrong() {
    const d = this.data.detail;
    if (!d || !d.w) return;
    storage.addWrong({ w: d.w, p: d.p || '', m: d.cn || d.en || '' });
    this.setData({ detailSaved: true });
    ui.notify(this, '已加入错词本');
  },

  noop() {},

  openChest() {
    if (this.data.chestOpened || !this.data.chestPassed) return;
    this.setData({ chestOpened: true });
    let result = null;
    try { result = storage.openChest(this.chestTier || 1, !!this.chestPerfect); } catch (e) {}
    let card = null;
    if (result && result.card) {
      try {
        const w = this.words.length ? this.words[Math.floor(Math.random() * this.words.length)] : null;
        if (w) card = storage.drawCard({ w: w[0], p: w[1] || '', m: w[2] || '' }, result.cardMin || '');
      } catch (e) {}
    }
    storage.checkBadges();
    this.setData({ chestResult: result, chestCard: card });
  },

  // 看视频 · 奖励翻倍：只追加同等能量与碎片。
  // 星级、宠物成长值、词卡数量/稀有度、补签卡一概不翻；每箱仅一次。
  doubleChestByAd() {
    if (this.data.chestDoubled || !this.data.chestOpened || !this.data.chestResult) return;
    const self = this;
    ad.show('bonus', function () {
      const bonus = storage.doubleChestReward();
      if (!bonus) { ui.notify(self, '这一箱已经翻倍过了'); return; }
      const old = self.data.chestResult;
      self.setData({
        chestResult: Object.assign({}, old, {
          energy: (old.energy || 0) + bonus.energy,
          shards: (old.shards || 0) + bonus.shards,
        }),
        chestDoubled: true,
      });
      ui.notify(self, '能量与碎片已翻倍！');
    }, function () {
      ui.notify(self, '当前环境暂不支持广告');
    });
  },

  nextAfterChest() { this.enterStage(this.data.stageIndex + 1); },

  // 未达开箱线：把前面的词重学一遍（重新抽词、重置计数），不发奖、不记星
  relearn() {
    this.stopTimer();
    this.addonMode = false;
    this.setData({
      totalRight: 0, answered: 0, stageRight: 0, finished: false, star: 0, qIndex: 0,
      feedback: '', typed: '', chestPassed: false,
      addonMode: false, addonDone: false, addonRight: 0, addonCount: 0, addonStageRight: 0,
    });
    this.enterStage(0);
  },

  finish() {
    const total = this.data.totalCount;
    const right = this.data.totalRight;
    let star = 0;
    if (total > 0) {
      const rate = right / total;
      if (rate >= 0.6) star = 1;
      if (rate >= 0.8) star = 2;
      if (rate >= 1) star = 3;
    }
    let target = null;
    for (let i = 0; i < this.levelIds.length; i++) {
      if (!storage.getStar(this.levelIds[i])) { target = this.levelIds[i]; break; }
    }
    if (!target && this.levelIds.length) target = this.levelIds[this.levelIds.length - 1];
    if (target && star > 0) storage.setStar(target, star);

    storage.addPlay('chapter');
    const earned = storage.checkBadges();
    this.setData({
      finished: true, star: star, earnedBadges: earned, addonMode: false, addonDone: false,
      current: null, questions: [], feedback: '', feedbackWord: '', canOpenDetail: false, detailOpen: false,
    });
  },

  // 结算页可选入口：错词本优先，做 5 题混合回忆；不影响主关星级与奖励
  startAddon() {
    if (!this.data.finished || this.addonMode) return;
    this.stopTimer();
    const qs = makeAddonQuestions(this.unit, ADDON_COUNT, this.volV || 1);
    if (!qs.length) {
      ui.notify(this, '暂时没有可加练的词');
      return;
    }
    this.addonMode = true;
    this.setData({
      finished: false, addonMode: true, addonDone: false,
      stageName: '错词加练', stageIcon: '🎯', stageDesc: '错词优先，再做 5 题',
      questions: qs, qIndex: 0, current: qs[0], feedback: '', feedbackWord: '',
      typed: '', spellLocked: false, timeLeft: TIMED_SEC,
      addonRight: 0, addonCount: qs.length, addonStageRight: 0,
    });
    this.maybeTimer();
  },

  // 加练结算：回到主关结算页，追加一行加练成绩；不重新记星、不重复 addPlay
  finishAddon() {
    this.stopTimer();
    this.addonMode = false;
    const earned = storage.checkBadges();
    const seen = {};
    const merged = (this.data.earnedBadges || []).concat(earned).filter(function (b) {
      if (seen[b.id]) return false;
      seen[b.id] = true;
      return true;
    });
    this.setData({
      finished: true, addonMode: false, addonDone: true,
      current: null, questions: [], stageName: '',
      addonRight: this.data.addonStageRight, addonCount: this.data.addonCount,
      earnedBadges: merged,
    });
  },

  retry() {
    this.addonMode = false;
    this.setData({
      finished: false, star: 0, totalRight: 0, answered: 0, qIndex: 0, feedback: '', typed: '',
      addonMode: false, addonDone: false, addonRight: 0, addonCount: 0, addonStageRight: 0,
    });
    this.enterStage(0);
  },

  backHome() { wx.navigateBack(); },
}));
