const ui = require('../../utils/ui.js');
const quiz = require('../../utils/quiz.js');
const storage = require('../../utils/storage.js');
const tts = require('../../utils/tts.js');

// 遗忘曲线复习：从到期词生成选义题，答对推进阶段
Page({
  data: {
    words: [],
    dueCount: 0,
    stats: null,
    started: false,
    questions: [],
    qIndex: 0,
    total: 0,
    right: 0,
    wrong: 0,
    current: null,
    feedback: '',
    gameOver: false,
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const words = storage.dueWords();
    this.setData({
      words: words.slice(0, 30),
      dueCount: words.length,
      stats: storage.reviewStats(),
      started: false,
      gameOver: false,
    });
  },

  startReview() {
    const words = storage.dueWords();
    if (!words.length) {
      ui.notify(this, '今天没有待复习的词');
      return;
    }
    // 转成 quiz 题目格式 [w,p,m]，干扰项从全局词库取
    const list = words.slice(0, 30).map(function (x) { return [x.w, x.p, x.m]; });
    const qs = quiz.makeChoiceQuestions(list, list.length, list);
    storage.addPlay('review');
    this.bank = qs;
    this.setData({
      questions: qs, total: qs.length, qIndex: 0,
      right: 0, wrong: 0, started: true, gameOver: false,
    });
    this.loadQuestion(0);
  },

  loadQuestion(i) {
    const q = this.bank[i];
    if (!q) { this.setData({ gameOver: true }); return; }
    const slots = q.options.map(function (o, k) { return { key: k, word: o.w }; });
    this.setData({ current: q, options: quiz.shuffle(slots), feedback: '' });
  },

  speakQuestion() {
    try {
      if (this.data.current) tts.speakMeaning(this.data.current.q);
    } catch (e) {}
  },

  tapOption(e) {
    if (this.data.feedback || this.data.gameOver) return;
    const q = this.data.current;
    const word = e.currentTarget.dataset.word;
    const right = word === q.answer;
    // 更新遗忘曲线排期
    storage.recordReview({ w: q.answer, p: q.phonetic, m: q.q }, right);
    storage.addStat(right ? 1 : 0, right ? 0 : 1);
    if (!right) { storage.addWrong({ w: q.answer, p: q.phonetic, m: q.q }); ui.notify(this, ui.wrongTip()); }
    this.setData({
      feedback: right ? 'right' : 'wrong',
      right: this.data.right + (right ? 1 : 0),
      wrong: this.data.wrong + (right ? 0 : 1),
    });
    const self = this;
    setTimeout(function () { self.advance(); }, right ? 500 : 900);
  },

  advance() {
    const next = this.data.qIndex + 1;
    if (next >= this.data.total) {
      const earned = storage.checkBadges();
      this.setData({ gameOver: true, earnedBadges: earned });
      return;
    }
    this.setData({ qIndex: next });
    this.loadQuestion(next);
  },

  backHome() { wx.navigateBack(); },
  onUnload() { try { tts.stop(); } catch (e) {} },
});
