const quiz = require('../../utils/quiz.js');
const storage = require('../../utils/storage.js');
const tts = require('../../utils/tts.js');
const ui = require('../../utils/ui.js');
const wordCard = require('../../utils/wordCard.js');
const levels = require('../../data/levels.js');

const ROUND = 15;

Page({
  data: {
    started: false,
    gameOver: false,
    qIndex: 0,
    total: 0,
    currentQ: null,
    feedback: '',
    wrongPick: '',
    combo: 0,
    maxCombo: 0,
    killed: 0,          // 本局彻底清掉的词数
    remain: 0,          // 剩余错词
    ansLetters: [],     // 拼写题：已放入的字母 [{id,ch}]
    letters: [],        // 拼写题：字母池
    // 结算
    clearedCount: 0,
    pass1Count: 0,
    missCount: 0,
    stubbornCount: 0,
    // 词卡弹层
    detailOpen: false,
    detail: null,
    detailWord: '',
    detailSaved: false,
    advanceTimer: null,
  },

  onLoad() {
    this.queue = [];
    this.clearedWords = [];
    this.missedWords = [];
    this.setData({ remain: storage.wrongCount() });
  },

  onUnload() {
    this.clearAdvance();
    try { tts.stop(); } catch (e) {}
    try { storage.flush(); } catch (e) {}
  },

  // 取本局词表：顽固词优先，其次进度低的在前（先补欠账）
  buildQueue() {
    const wrong = storage.getWrong().slice();
    const stubborn = storage.getStubbornWords();
    wrong.sort(function (a, b) {
      const sa = stubborn.indexOf(a.w) >= 0 ? 1 : 0;
      const sb = stubborn.indexOf(b.w) >= 0 ? 1 : 0;
      if (sa !== sb) return sb - sa;
      return (storage.getCleanPass(a.w) || 0) - (storage.getCleanPass(b.w) || 0);
    });
    this.queue = wrong.slice(0, ROUND).map(function (x) {
      return [x.w, x.p || '', x.m || ''];
    });
  },

  start() {
    if (!storage.wrongCount()) {
      ui.notify(this, '错词本是空的，先去闯关攒错词');
      return;
    }
    this.buildQueue();
    this.clearedWords = [];
    this.missedWords = [];
    this.setData({
      started: true, gameOver: false, qIndex: 0, total: this.queue.length,
      combo: 0, maxCombo: 0, killed: 0, remain: storage.wrongCount(),
      feedback: '', wrongPick: '',
    });
    this.loadQuestion(0);
  },

  // 第 n 遍的题型：0=看英识义, 1=看义选词, 2=拼写
  loadQuestion(i) {
    if (i >= this.queue.length) { this.endGame(); return; }
    const item = this.queue[i];
    const stage = storage.getCleanPass(item[0]) || 0;
    let q = null;
    if (stage === 0) {
      q = quiz.makeReverseChoiceQuestions([item], 1, this.queue)[0];
      q.type = 'choice';
      q.stageLabel = '第 1 遍 · 看英识义';
    } else if (stage === 1) {
      q = quiz.makeForwardChoiceQuestions([item], 1, this.queue)[0];
      q.type = 'choice';
      q.stageLabel = '第 2 遍 · 看义选词';
    } else {
      q = quiz.makeSpellQuestions([item], 1)[0];
      q.type = 'spell';
      q.stageLabel = '第 3 遍 · 拼写';
    }
    q.stage = stage;
    q.passDots = [stage > 0, stage > 1, stage > 2];
    this.setData({
      currentQ: q, qIndex: i, feedback: '', wrongPick: '',
      ansLetters: [], letters: q.type === 'spell' ? quiz.shuffle(q.letters.map(function (ch, k) { return { id: k, ch: ch }; })) : [],
    });
  },

  tapOption(e) {
    if (this.data.feedback || !this.data.currentQ || this.data.currentQ.type !== 'choice') return;
    const picked = e.currentTarget.dataset.label;
    if (picked === this.data.currentQ.answer) this.onRight();
    else { this.setData({ wrongPick: picked }); this.onWrong(); }
  },

  tapLetter(e) {
    if (this.data.feedback || this.data.currentQ.type !== 'spell') return;
    const id = Number(e.currentTarget.dataset.id);
    const pool = this.data.letters;
    const hit = pool.filter(function (l) { return l.id === id && !l.used; })[0];
    if (!hit) return;
    const next = pool.map(function (l) { return l.id === id ? Object.assign({}, l, { used: true }) : l; });
    this.setData({ letters: next, ansLetters: this.data.ansLetters.concat([{ id: id, ch: hit.ch }]) });
    if (this.data.ansLetters.length + 1 === this.data.currentQ.answer.replace(/[^a-zA-Z]/g, '').length) this.checkSpell();
  },

  tapAnswer(e) {
    if (this.data.feedback) return;
    const id = Number(e.currentTarget.dataset.id);
    const pool = this.data.letters;
    const next = pool.map(function (l) { return l.id === id ? Object.assign({}, l, { used: false }) : l; });
    this.setData({ letters: next, ansLetters: this.data.ansLetters.filter(function (a) { return a.id !== id; }) });
  },

  checkSpell() {
    const typed = this.data.ansLetters.map(function (a) { return a.ch; }).join('').toUpperCase();
    const target = this.data.currentQ.answer.replace(/[^a-zA-Z]/g, '').toUpperCase();
    if (typed === target) this.onRight();
    else this.onWrong();
  },

  onRight() {
    const q = this.data.currentQ;
    try { tts.speakWord({ w: q.answer, p: q.phonetic, m: q.meaning || q.q }); } catch (e) {}
    const res = storage.bumpCleanPass(q.answer);
    storage.addStat(1, 0);
    storage.recordReview({ w: q.answer, p: q.phonetic, m: q.meaning || q.q }, true);
    const combo = this.data.combo + 1;
    const killed = this.data.killed + (res.cleared ? 1 : 0);
    if (res.cleared) this.clearedWords.push(q.answer);
    this.setData({
      feedback: 'right', combo: combo, maxCombo: Math.max(combo, this.data.maxCombo),
      killed: killed, remain: storage.wrongCount(),
    });
    this.scheduleAdvance(1500);
  },

  onWrong() {
    const q = this.data.currentQ;
    storage.resetCleanPass(q.answer);
    storage.addStat(0, 1);
    storage.recordReview({ w: q.answer, p: q.phonetic, m: q.meaning || q.q }, false);
    this.missedWords.push(q.answer);
    this.setData({ feedback: 'wrong', combo: 0, remain: storage.wrongCount() });
    this.scheduleAdvance(1800);
  },

  scheduleAdvance(ms) {
    this.clearAdvance();
    const self = this;
    this.advanceTimer = setTimeout(function () {
      self.advanceTimer = null;
      if (self.data.detailOpen) return;
      self.advance();
    }, ms);
  },
  clearAdvance() {
    if (this.advanceTimer) { clearTimeout(this.advanceTimer); this.advanceTimer = null; }
  },
  advance() { this.loadQuestion(this.data.qIndex + 1); },

  endGame() {
    this.clearAdvance();
    storage.finishCleanRound(this.clearedWords, this.missedWords);
    const stubborn = storage.getStubbornWords();
    // 三行分布：本局彻底清掉 / 有进度未清 / 没拿下
    const cleared = this.clearedWords.length;
    const partial = this.queue.filter(function (row) {
      const p = storage.getCleanPass(row[0]);
      return p > 0 && p < 3;
    }).length;
    const miss = this.missedWords.length;
    this.setData({
      gameOver: true,
      clearedCount: cleared, pass1Count: partial, missCount: miss,
      stubbornCount: stubborn.length, remain: storage.wrongCount(),
      earnedBadges: storage.checkBadges(),
    });
    try { storage.flush(); } catch (e) {}
  },

  retry() { this.start(); },
  backHome() { wx.navigateBack(); },

  // 只读题干，不读答案（选择题读中文题干或英文单词）
  speakQuestion() {
    try {
      const q = this.data.currentQ;
      if (!q) return;
      if (q.stage === 1) tts.speakWord({ w: q.answer, p: q.phonetic, m: '' });
      else tts.speakMeaning(q.meaning || q.q);
    } catch (e) {}
  },

  // ===== 星际词卡（复用现成弹层）=====
  openWordCard() {
    const q = this.data.currentQ;
    if (!q || !q.answer) return;
    const w = q.answer;
    this.clearAdvance();
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
  closeWordCard() { this.setData({ detailOpen: false }); this.scheduleAdvance(600); },
  closeWordCardAndAdvance() { this.setData({ detailOpen: false }); this.clearAdvance(); this.advance(); },
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
});
