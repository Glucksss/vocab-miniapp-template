const quiz = require('../../utils/quiz.js');
const storage = require('../../utils/storage.js');
const tts = require('../../utils/tts.js');
const ui = require('../../utils/ui.js');
const ad = require('../../utils/ad.js');

Page({
  data: {
    timeLeft: 60,
    score: 0,
    displayScore: 0,   // 结算展示分数：看视频翻倍后变化，原始 score 永远不污染学习货币
    scoreDoubled: false,
    combo: 0,
    correct: 0,
    total: 0,
    currentQ: null,
    feedback: '',
    wrongPick: '',   // 本时间点错的选项，红框标出
    started: false,
    gameOver: false,
    best: 0,
    isNewBest: false,
    progress: 100,
    wrongWords: [],  // 本局答错的词（结算弹窗可点进去查看）
  },

  onLoad() {
    this.setData({ best: storage.getBest('timed') });
    this.pool = quiz.randomPool(200);
    this.qIdx = 0;
    this.timer = null;
  },

  onUnload() {
    if (this.timer) clearInterval(this.timer);
    try { tts.stop(); } catch (e) {}
  },

  // 限时风暴：读中文题干，不读英文选项（避免报答案）
  speakQuestion() {
    try {
      if (this.data.currentQ) tts.speakMeaning(this.data.currentQ.q);
    } catch (e) {}
  },

  start() {
    this.setData({ started: true, timeLeft: 60, score: 0, displayScore: 0, scoreDoubled: false, combo: 0, correct: 0, total: 0, gameOver: false, wrongWords: [], wrongPick: '' });
    this.nextQuestion();
    const self = this;
    this.timer = setInterval(function () {
      const t = self.data.timeLeft - 1;
      self.setData({ timeLeft: t, progress: t * 100 / 60 });
      if (t <= 0) self.endGame();
    }, 1000);
  },

  nextQuestion() {
    if (this.qIdx >= this.pool.length) this.qIdx = 0;
    const item = this.pool[this.qIdx++];
    const ans = quiz.toWord(item);
    const distract = quiz.shuffle(this.pool.filter(function (x) { return x[0] !== ans.w; })).slice(0, 3).map(quiz.toWord);
    this.setData({
      currentQ: { q: ans.m, answer: ans.w, phonetic: ans.p, options: quiz.shuffle([ans].concat(distract)) },
      feedback: '', wrongPick: '',
    });
  },

  tapOption(e) {
    if (this.data.feedback || this.data.gameOver) return;
    const word = e.currentTarget.dataset.word;
    const right = word === this.data.currentQ.answer;
    if (right) {
      const combo = this.data.combo + 1;
      const gain = 10 + Math.min(combo, 10) * 2;
      this.setData({
        feedback: 'right', score: this.data.score + gain,
        combo: combo, correct: this.data.correct + 1, total: this.data.total + 1,
      });
      storage.addStat(1, 0);
      storage.recordReview({ w: this.data.currentQ.answer, p: this.data.currentQ.phonetic, m: this.data.currentQ.q }, true);
    } else {
      const wrongWord = { w: this.data.currentQ.answer, p: this.data.currentQ.phonetic, m: this.data.currentQ.q };
      const list = this.data.wrongWords.slice();
      if (!list.some(function (x) { return x.w === wrongWord.w; })) list.push(wrongWord);
      this.setData({ feedback: 'wrong', wrongPick: word, combo: 0, total: this.data.total + 1, wrongWords: list });
      storage.addWrong(wrongWord);
      ui.notify(this, ui.wrongTip());
      storage.recordReview(wrongWord, false);
      storage.addStat(0, 1);
    }
    const self = this;
    setTimeout(function () { if (!self.data.gameOver) self.nextQuestion(); }, 350);
  },

  endGame() {
    if (this.timer) clearInterval(this.timer);
    const newBest = storage.setBest('timed', this.data.score);
    storage.addPlay('timed');
    this.setData({
      gameOver: true, isNewBest: newBest,
      displayScore: this.data.score, scoreDoubled: false,
      best: Math.max(this.data.best, this.data.score),
      earnedBadges: storage.checkBadges(),
    });
  },

  retry() {
    if (this.timer) clearInterval(this.timer);
    this.qIdx = 0;
    this.start();
  },

  // 看视频 · 分数翻倍：只翻本局展示分数与本地最高分。
  // 能量/成长值/错词在答题时已按真实表现结算，这里一概不碰；每局只能翻一次。
  doubleScoreByAd() {
    if (!this.data.gameOver || this.data.scoreDoubled) return;
    const self = this;
    ad.show('bonus', function () {
      const doubled = self.data.score * 2;
      storage.setBest('timed', doubled);
      self.setData({
        displayScore: doubled,
        scoreDoubled: true,
        isNewBest: true,
        best: Math.max(self.data.best, doubled),
      });
      ui.notify(self, '分数已翻倍！能量和成长按真实答题结算');
    }, function () {
      ui.notify(self, '当前环境暂不支持广告');
    });
  },

  // 结算弹窗：点进去错词本查看本局答错的词（已在 storage 里）
  viewWrong() {
    if (!this.data.wrongWords.length) {
      ui.notify(this, '本局全对，没有错词');
      return;
    }
    wx.navigateTo({ url: '/pages/wrong/wrong' });
  },

  backHome() { wx.navigateBack(); },
});
