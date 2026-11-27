const ui = require('../../utils/ui.js');
const quiz = require('../../utils/quiz.js');
const storage = require('../../utils/storage.js');
const tts = require('../../utils/tts.js');
const vp = require('../../utils/volPicker.js');

Page(Object.assign({}, vp.behavior, {
  data: Object.assign({}, vp.data(), {
    questions: [],
    qIndex: 0,
    total: 10,
    score: 0,
    correct: 0,
    letters: [],        // [{id,ch,used}]
    answer: [],         // [{id,ch}]
    currentQ: null,
    feedback: '',
    gameOver: false,
    wrongList: [],      // 本局拼错的词
  }),

  onLoad(options) {
    const range = vp.init(this, options || {});
    this.applyRange(range.v, range.u);
  },

  // 按册次 + 单元范围取词：范围内攒够5个错词优先拼错词，否则整池随机
  applyRange(v, u) {
    const pool = [];
    const seen = {};
    const levels = require('../../data/levels.js');
    levels.forEach(function (lv) {
      if (lv.v !== v) return;
      if (u && lv.u !== u) return;
      lv.w.forEach(function (x) {
        if (!seen[x[0]]) { seen[x[0]] = 1; pool.push([x[0], x[1], x[2]]); }
      });
    });
    const wrongMap = {};
    storage.getWrong().forEach(function (w) { wrongMap[w.w] = w; });
    const wrongs = pool.filter(function (x) { return wrongMap[x[0]]; });
    let words;
    if (wrongs.length >= 5) words = quiz.shuffle(wrongs).slice(0, 10);
    else words = quiz.shuffle(pool).slice(0, 10);
    const qs = quiz.makeSpellQuestions(words, 10);
    this.setData({
      questions: qs,
      total: qs.length,
      qIndex: 0,
      score: 0,
      correct: 0,
      wrongList: [],
      feedback: '',
      gameOver: false,
      currentQ: qs[0],
    });
    this.loadQuestion(0);
  },

  // 拼写题答题阶段：只读中文提示，不读英文答案
  speakQuestion() {
    try {
      const q = this.data.currentQ;
      if (q) tts.speakMeaning(q.q);
    } catch (e) {}
  },

  onUnload() { try { tts.stop(); } catch (e) {} },

  loadQuestion(i) {
    const q = this.data.questions[i];
    // 只保留真实字母，过滤空格/符号，避免空白块；同时保证判定长度一致
    const cleaned = (q.letters || []).filter(function (ch) { return /[a-zA-Z]/.test(ch); });
    const letters = cleaned.map(function (ch, k) { return { id: k, ch: ch, used: false }; });
    this.setData({ currentQ: q, letters: quiz.shuffle(letters), answer: [], feedback: '' });
  },

  tapLetter(e) {
    if (this.data.feedback) return;
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
    this.checkAuto();
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

  checkAuto() {
    const typed = this.data.answer.map(function (a) { return a.ch; }).join('').toUpperCase();
    const target = this.data.currentQ.answer.replace(/[^a-zA-Z]/g, '').toUpperCase();
    if (typed.length !== target.length) return;
    if (typed === target) {
      this.setData({ feedback: 'right', score: this.data.score + 15, correct: this.data.correct + 1 });
      storage.addStat(1, 0);
      storage.recordReview({ w: this.data.currentQ.answer, p: this.data.currentQ.phonetic, m: this.data.currentQ.q }, true);
      // 答对后才朗读完整单词：英文 + 中文，强化记忆且不泄题（朗读失败不得影响流程）
      try { tts.speakWord({ w: this.data.currentQ.answer, p: this.data.currentQ.phonetic, m: this.data.currentQ.q }); } catch (e) {}
    } else {
      this.setData({ feedback: 'wrong' });
      storage.addWrong({ w: this.data.currentQ.answer, p: this.data.currentQ.phonetic, m: this.data.currentQ.q });
      ui.notify(this, ui.wrongTip());
      storage.recordReview({ w: this.data.currentQ.answer, p: this.data.currentQ.phonetic, m: this.data.currentQ.q }, false);
      const wl = this.data.wrongList.concat([this.data.currentQ.answer]);
      this.setData({ wrongList: wl });
      storage.addStat(0, 1);
    }
    const self = this;
    setTimeout(function () { self.advance(); }, 900);
  },

  advance() {
    const next = this.data.qIndex + 1;
    if (next >= this.data.total) {
      storage.addPlay('spell');
      this.setData({ gameOver: true, earnedBadges: storage.checkBadges() });
      return;
    }
    this.setData({ qIndex: next });
    this.loadQuestion(next);
  },

  hint() {
    const q = this.data.currentQ;
    const target = q.answer.replace(/[^a-zA-Z]/g, '').toUpperCase();
    const typed = this.data.answer.map(function (a) { return a.ch; }).join('').toUpperCase();
    for (let i = 0; i < target.length; i++) {
      if (typed[i] !== target[i]) {
        ui.notify(this, '第 ' + (i + 1) + ' 个字母是 ' + target[i]);
        return;
      }
    }
  },

  backHome() { wx.navigateBack(); },
}));
