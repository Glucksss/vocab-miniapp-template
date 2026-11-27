const storage = require('../../utils/storage.js');
const tts = require('../../utils/tts.js');
const ui = require('../../utils/ui.js');
const levels = require('../../data/levels.js');

// 语境数据已迁到分包A（给主包腾 424KB）。异步加载；预览环境加载失败时
// 用主包 levels.js 的词表降级出简化题（看中文释义选英文词），保证玩法不白屏。
let ctxLevels = null;        // 分包加载好的真实语境数据
let ctxLoading = null;       // 正在加载时的回调队列
const CTX_PATH = '../../pkgWordA/data/context_levels.js';

function loadCtx(cb) {
  if (ctxLevels) { cb(true); return; }
  if (ctxLoading) { ctxLoading.push(cb); return; }
  ctxLoading = [cb];
  try {
    require(CTX_PATH, function (mod) {
      ctxLevels = (mod && mod.length) ? mod : null;
      const list = ctxLoading || []; ctxLoading = null;
      list.forEach(function (f) { f(!!ctxLevels); });
    }, function () {
      const list = ctxLoading || []; ctxLoading = null;
      list.forEach(function (f) { f(false); });
    });
  } catch (e) {
    const list = ctxLoading || []; ctxLoading = null;
    list.forEach(function (f) { f(false); });
  }
}

// 降级数据：把主包词表按每 15 词一关切成简化语境关
function fallbackLevels() {
  const all = [];
  levels.forEach(function (lv) {
    (lv.w || []).forEach(function (x) {
      if (x && x[0] && x[2]) all.push({ w: x[0], c: x[2], m: x[2] });
    });
  });
  const out = [];
  for (let i = 0; i < all.length; i += 15) out.push(all.slice(i, i + 15));
  return out;
}

// 语境辨析关：看真实英文释义，选正确单词
Page({
  data: {
    loading: true,
    levelIndex: 0,
    levelCount: 0,
    words: [],
    started: false,
    questions: [],
    qIndex: 0,
    total: 0,
    score: 0,
    correct: 0,
    current: null,
    options: [],
    // 双列选项的字母编号 + 5色循环（粉/蓝/绿/黄/紫），按 index 取，不改选项数据结构
    optLetters: ['A','B','C','D','E','F','G','H','I'],
    optColors: ['c0','c1','c2','c3','c4','c0','c1','c2','c3'],
    feedback: '',
    gameOver: false,
    star: 0,
    ultimateReady: false, // 满星已解锁终极宝箱资格
  },

  onLoad() {
    const self = this;
    loadCtx(function (ok) {
      if (!ok) {
        ctxLevels = fallbackLevels();
        self.setData({ degraded: true });
      }
      self.setData({ levelCount: ctxLevels.length, loading: false });
      self.loadLevel(0);
    });
  },

  loadLevel(i) {
    if (!ctxLevels || i >= ctxLevels.length) { this.setData({ gameOver: true }); return; }
    this.setData({
      levelIndex: i,
      words: ctxLevels[i],
      started: false,
      gameOver: false,
    });
  },

  start() {
    const words = this.data.words;
    if (!words || !words.length) return;
    // makeQuestions 直接读对象的 w/c/m 字段，必须传原对象数组，不能转成下标数组
    const qs = this.makeQuestions(words);
    this.bank = qs;
    storage.addPlay('context');
    this.setData({
      questions: qs, total: qs.length, qIndex: 0,
      score: 0, correct: 0, started: true, gameOver: false,
    });
    this.loadQuestion(0);
  },

  // 语境题：题干英文释义，9个英文选项
  makeQuestions(list) {
    const all = [];
    (ctxLevels || []).forEach(function (chunk) { all.push.apply(all, chunk); });
    const allWords = all.map(function (x) { return x.w; });
    const qs = [];
    const shuffled = list.slice().sort(function () { return Math.random() - 0.5; });
    shuffled.forEach(function (item) {
      const pool = allWords.filter(function (w) { return w !== item.w; });
      const distract = [];
      while (distract.length < 8 && pool.length) {
        const k = Math.floor(Math.random() * pool.length);
        const w = pool.splice(k, 1)[0];
        if (distract.indexOf(w) < 0) distract.push(w);
      }
      const opts = [item.w].concat(distract).sort(function () { return Math.random() - 0.5; });
      qs.push({ q: item.c, answer: item.w, meaning: item.m, options: opts });
    });
    return qs;
  },

  loadQuestion(i) {
    const q = this.bank[i];
    if (!q) { this.endGame(); return; }
    // 必须把 q.options 同步到页面数据，wxml 渲染的是 {{options}}，漏掉会导致选项区空白
    this.setData({ current: q, options: q.options || [], feedback: '' });
  },

  speakQuestion() {
    try {
      if (this.data.current) tts.speakEnglish(this.data.current.q);
    } catch (e) {}
  },

  tapOption(e) {
    if (this.data.feedback || this.data.gameOver) return;
    const q = this.data.current;
    const word = e.currentTarget.dataset.word;
    const right = word === q.answer;
    const rec = { w: q.answer, p: '', m: q.meaning };
    storage.recordReview(rec, right);
    storage.addStat(right ? 1 : 0, right ? 0 : 1);
    if (!right) { storage.addWrong(rec); ui.notify(this, ui.wrongTip()); }
    this.setData({
      feedback: right ? 'right' : 'wrong',
      score: this.data.score + (right ? 10 : 0),
      correct: this.data.correct + (right ? 1 : 0),
    });
    const self = this;
    setTimeout(function () { self.advance(); }, right ? 500 : 900);
  },

  advance() {
    const next = this.data.qIndex + 1;
    if (next >= this.data.total) { this.endGame(); return; }
    this.setData({ qIndex: next });
    this.loadQuestion(next);
  },

  endGame() {
    const c = this.data.correct;
    let star = 0;
    if (c >= 8) star = 1;
    if (c >= 12) star = 2;
    if (c === 15) star = 3;

    // 地图第5张BOSS卡 = 语境辨析关。首次在此拿到3星（全对15题）只解锁"开箱资格"，
    // 真正的奖励要回地图点线头的终极宝箱领取，形成"闯关→回地图开箱"的闭环。
    // 能力检测+异常隔离，避免老版本 storage 缺函数导致结算卡死。
    let ultimateReady = false;
    try {
      if (star === 3 && storage.markUltimateReady) {
        ultimateReady = storage.markUltimateReady();
      }
    } catch (e) {}
    // 已经解锁但还没开箱的，也要显示引导；已开箱领取过则不再提示
    if (!ultimateReady) {
      try {
        const us = storage.ultimateStatus ? storage.ultimateStatus() : {};
        ultimateReady = !!(us.qualified && !us.claimed);
      } catch (e) {}
    }

    const earned = storage.checkBadges();
    this.setData({
      gameOver: true,
      star: star,
      earnedBadges: earned,
      ultimateReady: ultimateReady,
    });
  },

  // 结算页引导：回地图去线头开终极宝箱
  goUltimateChest() { wx.navigateBack(); },

  nextLevel() {
    this.loadLevel(this.data.levelIndex + 1);
  },

  backHome() { wx.navigateBack(); },
  onUnload() { try { tts.stop(); } catch (e) {} },
});
