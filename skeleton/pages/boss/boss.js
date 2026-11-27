const quiz = require('../../utils/quiz.js');
const storage = require('../../utils/storage.js');
const tts = require('../../utils/tts.js');
const ui = require('../../utils/ui.js');
const wordCard = require('../../utils/wordCard.js');
const levels = require('../../data/levels.js');

Page({
  data: {
    questions: [],
    qIndex: 0,
    total: 0,
    killed: 0,
    currentQ: null,
    optLabels: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
    letters: [],
    answer: [],
    feedback: '',
    wrongPick: '',   // 选义题答错时，用户点错的那个词（红框标出）
    gameOver: false,
    // 星际词卡弹层（答完才出现，不泄题）
    detailOpen: false,
    detail: null,
    detailWord: '',
    detailSaved: false,
    advanceTimer: null,
    // 题库模式：gk=高考3500(v8) / zt=真题高频(v9) / mix=混合随机
    bankMode: 'mix',
    bankTabs: [
      { key: 'gk', name: '高考3500' },
      { key: 'zt', name: '真题高频' },
      { key: 'mix', name: '混合随机' },
    ],
  },

  // 按册次取词：v8=高考3500, v9=真题高频
  wordsOfBank(mode) {
    let pool = [];
    levels.forEach(function (lv) {
      const v = Number(lv.v);
      if (mode === 'gk' && v !== 8) return;
      if (mode === 'zt' && v !== 9) return;
      if (mode === 'mix' && v !== 8 && v !== 9) return;
      const ws = lv.w || [];
      for (let k = 0; k < ws.length; k++) {
        pool.push({ w: ws[k][0], p: ws[k][1] || '', m: ws[k][2] || '' });
      }
    });
    return quiz.shuffle(pool).slice(0, 15);
  },

  buildQuestions(mode) {
    const source = this.wordsOfBank(mode);
    return quiz.makeBossQuestions(source, Math.min(source.length, 15));
  },

  onLoad() {
    this.clearAdvance();
    const qs = this.buildQuestions('mix');
    this.setData({ bankMode: 'mix', questions: qs, total: qs.length, gameOver: false, qIndex: 0, killed: 0 });
    this.loadQuestion(0);
  },

  // 切换题库：立即重开一局
  switchBank(e) {
    const mode = e && e.currentTarget && e.currentTarget.dataset.mode;
    if (!mode || mode === this.data.bankMode) return;
    this.clearAdvance();
    const qs = this.buildQuestions(mode);
    this.setData({ bankMode: mode, questions: qs, total: qs.length, gameOver: false, qIndex: 0, killed: 0, feedback: '', wrongPick: '' });
    this.loadQuestion(0);
    ui.notify(this, '已切换题库');
  },

  loadQuestion(i) {
    const q = this.data.questions[i];
    if (!q) { this.setData({ gameOver: true }); return; }
    if (q.type === 'spell') {
      // 只保留真实字母，过滤空格/符号，避免空白块；同时保证判定长度一致
      const cleaned = (q.letters || []).filter(function (ch) { return /[a-zA-Z]/.test(ch); });
      const letters = cleaned.map(function (ch, k) { return { id: k, ch: ch, used: false }; });
      this.setData({ currentQ: q, letters: quiz.shuffle(letters), answer: [], feedback: '', wrongPick: '' });
    } else {
      this.setData({ currentQ: q, feedback: '', wrongPick: '' });
    }
  },

  // Boss 战答题阶段：只读中文题干，不读英文答案
  speakQuestion() {
    try {
      const q = this.data.currentQ;
      if (q) tts.speakMeaning(q.q);
    } catch (e) {}
  },

  // 选义题
  tapOption(e) {
    if (this.data.feedback || this.data.currentQ.type !== 'choice') return;
    const word = e.currentTarget.dataset.word;
    if (word === this.data.currentQ.answer) this.onRight();
    else { this.setData({ wrongPick: word }); this.onWrong(); }
  },

  // 拼写题
  tapLetter(e) {
    if (this.data.feedback || this.data.currentQ.type !== 'spell') return;
    const id = Number(e.currentTarget.dataset.id);
    const hit = this.data.letters.filter(function (l) { return l.id === id && !l.used; })[0];
    if (!hit) return;
    const ch = hit.ch;
    const letters = this.data.letters.map(function (l) {
      if (l.id === id && !l.used) return Object.assign({}, l, { used: true });
      return l;
    });
    const answer = this.data.answer.concat([{ id: id, ch: ch }]);
    this.setData({ letters: letters, answer: answer });
    this.checkSpell();
  },

  tapAnswer(e) {
    if (this.data.feedback) return;
    const id = Number(e.currentTarget.dataset.id);
    const letters = this.data.letters.map(function (l) {
      if (l.id === id) return Object.assign({}, l, { used: false });
      return l;
    });
    const answer = this.data.answer.filter(function (a) { return a.id !== id; });
    this.setData({ letters: letters, answer: answer });
  },

  checkSpell() {
    const typed = this.data.answer.map(function (a) { return a.ch; }).join('').toUpperCase();
    const target = this.data.currentQ.answer.replace(/[^a-zA-Z]/g, '').toUpperCase();
    if (typed.length !== target.length) return;
    if (typed === target) this.onRight();
    else this.onWrong();
  },

  onRight() {
    const q = this.data.currentQ;
    // 答对后朗读：英文 + 中文，强化记忆（朗读失败不得影响流程）
    try { tts.speakWord({ w: q.answer, p: q.phonetic, m: q.q }); } catch (e) {}
    storage.addKilled(1);
    storage.addStat(1, 0);
    storage.recordReview({ w: q.answer, p: q.phonetic, m: q.q }, true);
    this.setData({ feedback: 'right', killed: this.data.killed + 1 });
    this.scheduleAdvance(2000);
  },

  onWrong() {
    const q = this.data.currentQ;
    const rec = { w: q.answer, p: q.phonetic || '', m: q.q || '' };
    storage.addStat(0, 1);
    storage.recordReview(rec, false);
    // 答错不涨成长，词进错词本留着以后清剿
    storage.addWrong(rec);
    ui.notify(this, '差一点，这个词已进错词本，下次再战 ✊');
    this.setData({ feedback: 'wrong' });
    this.scheduleAdvance(2400);
  },

  // 自动跳下一题：默认照常跳；正在看词卡时暂停，等关闭后再续上
  scheduleAdvance(ms) {
    this.clearAdvance();
    const self = this;
    this.advanceTimer = setTimeout(function () {
      self.advanceTimer = null;
      if (self.data.detailOpen) return; // 看词卡中不跳，关闭时再挂定时器
      self.advance();
    }, ms);
  },
  clearAdvance() {
    if (this.advanceTimer) { clearTimeout(this.advanceTimer); this.advanceTimer = null; }
  },

  advance() {
    const next = this.data.qIndex + 1;
    if (next >= this.data.total) {
      storage.addPlay('boss');
      this.setData({ gameOver: true, earnedBadges: storage.checkBadges() });
      return;
    }
    this.setData({ qIndex: next });
    this.loadQuestion(next);
  },

  // ===== 星际词卡（答完后才出现，不泄题）=====
  openWordCard() {
    const q = this.data.currentQ;
    if (!q || !q.answer) return;
    const w = q.answer;
    this.clearAdvance(); // 暂停自动跳，看完再续
    const self = this;
    if (wordCard.hasData(w)) {
      this.setData({ detailOpen: true, detail: wordCard.get(w), detailWord: w, detailSaved: false });
      if (wordCard.isBasic(w)) {
        const v = this.volumeOfWord(w);
        wordCard.ensure(v, function () {
          const d = wordCard.get(w);
          if (d && !d._basic && self.data.detailWord === w) self.setData({ detail: d });
        });
      }
      return;
    }
    ui.showLoading({ title: '加载词卡…' });
    wordCard.ensure(this.volumeOfWord(w), function () {
      ui.hideLoading();
      const d = wordCard.get(w);
      if (!d) { ui.notify(self, '暂无词卡'); self.scheduleAdvance(600); return; }
      self.setData({ detailOpen: true, detail: d, detailWord: w, detailSaved: false });
    });
  },

  closeWordCard() {
    this.setData({ detailOpen: false });
    this.scheduleAdvance(600); // 看完继续自动跳，不卡死
  },

  closeWordCardAndAdvance() {
    this.setData({ detailOpen: false });
    this.clearAdvance();
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

  volumeOfWord(w) {
    for (let i = 0; i < levels.length; i++) {
      const ws = levels[i].w || [];
      for (let k = 0; k < ws.length; k++) if (ws[k][0] === w) return levels[i].v;
    }
    return 1;
  },

  onUnload() {
    this.clearAdvance();
    try { tts.stop(); } catch (e) {}
  },

  backHome() { wx.navigateBack(); },
});
