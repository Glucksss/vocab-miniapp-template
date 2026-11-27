const quiz = require('../../utils/quiz.js');
const storage = require('../../utils/storage.js');
const tts = require('../../utils/tts.js');
const ad = require('../../utils/ad.js');
const wordCard = require('../../utils/wordCard.js');
const ui = require('../../utils/ui.js');
const levels = require('../../data/levels.js');
const vp = require('../../utils/volPicker.js');

// 九宫格固定配色：按屏幕位置排列 紫粉绿/橙紫蓝/粉蓝紫（对应彩色胶囊参考图）
const HOLE_COLORS = ['purple', 'pink', 'green', 'orange', 'purple', 'blue', 'pink', 'blue', 'purple'];

Page(Object.assign({}, vp.behavior, {
  data: Object.assign({}, vp.data(), {
    levelId: '',
    questions: [],
    qIndex: 0,
    total: 15,
    score: 0,
    combo: 0,
    maxCombo: 0,
    lives: 3,
    correct: 0,
    holes: [],
    feedback: '',       // '', 'right', 'wrong'
    feedbackWord: '',
    gameOver: false,
    won: false,
    star: 0,
    showAnswer: false,
    showRevive: false,     // 生命耗尽复活弹窗
    canAd: false,          // 当前环境能否播广告
    freezes: 0,            // 补签卡数量
    canOpenDetail: false,  // 本题是否有星际词卡
    detailOpen: false,
    detail: null,
    detailWord: '',
    detailSaved: false,
    // 吉祥物 + 强化反馈
    petImg: '',
    petName: '',
    petStage: '',
    bubbleText: '来！敲出这个意思的单词',
    feedbackAnim: '',   // '', 'ok', 'no'
    tappedWord: '',
    gainText: '',
    confetti: [],
    flameSlots: [1, 2, 3],
    flameCount: 0,
    // 打地鼠视觉：锤子 + 幸运加分(答题后才揭晓，绝不泄题) + 对错反馈
    hammerSwing: false,
    screenShake: false,
    isGold: false,
    holesReady: false,
  }),

  onLoad(options) {
    const opt = options || {};
    const range = vp.init(this, opt);
    // 单关 idx 入口仍保留（首页旧节点/直接带 idx 进来的场景）
    if (!opt.v && opt.idx !== undefined) {
      const idx = Number(opt.idx) || 0;
      this.idxVal = idx;
      const words = quiz.levelWords(idx);
      const lv = quiz.getLevel(idx);
      this.levelId = lv ? lv.id : 'V0U0';
      this.levelVol = lv ? lv.v : 1;
      this.levelUnit = lv ? lv.u : 1;
      this.mixWords = null;
      this.loadBank(words);
    } else {
      this.applyRange(range.v, range.u);
    }
    this.setData({
      canAd: ad.isAvailable(),
      freezes: storage.getFreezes(),
    });
    this.refreshPet();
  },

  // 按册次 + 单元范围取词（u=0 整册混合）
  applyRange(v, u) {
    const words = [];
    const seen = {};
    levels.forEach(function (lv) {
      if (lv.v !== v) return;
      if (u && lv.u !== u) return;
      lv.w.forEach(function (x) {
        if (!seen[x[0]]) { seen[x[0]] = 1; words.push(x); }
      });
    });
    this.idxVal = -1;
    this.mixWords = words;
    this.levelId = 'MIX-V' + v + '-U' + u;
    this.levelVol = v;
    this.levelUnit = u;
    this.loadBank(words);
  },

  // 生成题库并重开本局（切换册次/单元后调用）
  loadBank(words) {
    const qs = quiz.makeChoiceQuestions(words, 15, words);
    this.questionBank = qs;
    this.setData({
      levelId: this.levelId,
      questions: qs,
      total: qs.length,
      qIndex: 0,
      score: 0,
      combo: 0,
      maxCombo: 0,
      lives: 3,
      correct: 0,
      star: 0,
      gameOver: false,
      won: false,
      showRevive: false,
      feedback: '',
    });
    this.clearAllTimers();
    this.advanceToken = (this.advanceToken || 0) + 1;
    this.nextQuestion();
  },

  // 吉祥物：读取当前宠物阶段真立绘（预览卡环境失败也不影响答题）
  refreshPet() {
    try {
      const p = storage.petInfo();
      this.setData({ petImg: p.img || '', petName: p.name || '小枭', petStage: p.title || '' });
    } catch (e) {}
  },

  flameNum(combo) {
    return combo >= 5 ? 3 : combo >= 3 ? 2 : combo >= 1 ? 1 : 0;
  },

  rightLine(combo) {
    if (combo >= 5) return '太强啦！连击 ×' + combo + '！';
    if (combo >= 3) return '漂亮！连击 ×' + combo + '！';
    if (combo >= 2) return '不错，连击 ×' + combo + '！';
    return ['答对啦！真棒！', '厉害，就是这个！', '漂亮！敲中了！'][combo % 3];
  },

  wrongLine() {
    // A+C：软鼓励 + 错词本资产化——答错不是白错，这词被收好了，以后能拿回来
    const lines = ['差一点，这词我帮你收进错词本啦～', '没关系，收好了，下次拿下它！', '别急，这词存进错词本，跑不掉的！', '小坑记下了，错过一次就再也忘不掉～'];
    return lines[Math.floor(Math.random() * lines.length)];
  },

  // 选义题：读中文题干，不泄露英文答案
  speakQuestion() {
    try {
      const q = this.questionBank[this.data.qIndex];
      if (q) tts.speakMeaning(q.q);
    } catch (e) {}
  },

  // 答完后用户主动点「读单词」才朗读正确答案（英文 + 中文），不自动播放
  speakAnswer() {
    try {
      const w = this.data.feedbackWord;
      if (w) tts.speakWord({ w: w, m: this.data.feedbackMean || '' });
    } catch (e) {}
  },

  onUnload() { this.clearAllTimers(); try { tts.stop(); } catch (e) {} try { storage.flush(); } catch (e) {} },

  onHide() { this.clearAllTimers(); try { tts.stop(); } catch (e) {} try { storage.flush(); } catch (e) {} },

  // 一次性清掉所有定时器，避免残留回调在切题后干扰视觉/重复推进
  clearAllTimers() {
    if (this.advanceTimer) { clearTimeout(this.advanceTimer); this.advanceTimer = null; }
    if (this.hammerTimer) { clearTimeout(this.hammerTimer); this.hammerTimer = null; }
    if (this.shakeTimer) { clearTimeout(this.shakeTimer); this.shakeTimer = null; }
  },

  nextQuestion() {
    this.clearAllTimers();
    // 递增口令：让上一题语音的完成回调自动失效，避免"读旧词跳新题"
    this.advanceToken = (this.advanceToken || 0) + 1;
    const i = this.data.qIndex;
    const q = this.questionBank[i];
    if (!q) { this.endGame(); return; }
    // 九宫格：9个英文选项（1对8干扰）正好铺满3×3，打乱位置后按位置配色
    const slots = q.options.map(function (o, k) { return { key: k, word: o.w, state: '' }; });
    const arranged = quiz.shuffle(slots);
    // 颜色 + idx 绑定屏幕位置（紫粉绿/橙紫蓝/粉蓝紫），与单词无关，稳定好看
    for (let c = 0; c < arranged.length; c++) {
      arranged[c].color = HOLE_COLORS[c] || 'purple';
      arranged[c].idx = c;
    }
    // 幸运加分：答题后才揭晓，答题前所有地鼠外观完全一致，绝不泄露答案
    this.setData({
      holes: arranged,
      feedback: '',
      showAnswer: false,
      canOpenDetail: false,
      detailOpen: false,
      feedbackAnim: '',
      tappedWord: '',
      gainText: '',
      confetti: [],
      bubbleText: '来！敲出这个意思的单词',
      hammerSwing: false,
      screenShake: false,
      isGold: false,
      holesReady: true,
    });
  },

  tapHole(e) {
    // 已答状态：点任意洞都立即进下一题（多重保险，防止定时器/词卡清掉后卡死）
    if (this.data.feedback) {
      this.clearAllTimers();
      this.advance();
      return;
    }
    const word = e.currentTarget.dataset.word;
    if (!word) return;
    const q = this.questionBank[this.data.qIndex];
    const right = word === q.answer;
    // 锤子落点 = 被点的格子（按位置算出中心点）
    const idx = Number(e.currentTarget.dataset.idx) || 0;
    const col = idx % 3, row = Math.floor(idx / 3);
    const hitX = 16 + col * 28 + 14;   // 每列约 28.3%（百分比）
    const hitY = row;                   // 0/1/2 行

    // 锤子斜劈 + 命中震屏（动画结束复位，不影响答题流程）
    this.setData({ hammerSwing: true, hammerX: hitX, hammerY: hitY, screenShake: true });
    const self = this;
    if (this.hammerTimer) clearTimeout(this.hammerTimer);
    if (this.shakeTimer) clearTimeout(this.shakeTimer);
    this.hammerTimer = setTimeout(function () { self.setData({ hammerSwing: false }); }, 620);
    this.shakeTimer = setTimeout(function () { self.setData({ screenShake: false }); }, 320);

    if (right) {
      const combo = this.data.combo + 1;
      // 幸运加分：答对后 20% 概率触发，答题阶段无任何金色提示
      const isGold = Math.random() < 0.2;
      const base = 10 * (combo >= 5 ? 3 : combo >= 3 ? 2 : 1);
      const gain = isGold ? base * 4 : base;
      const holes = this.data.holes.map(function (h) {
        return h.word === word ? Object.assign({}, h, { hit: 'ok' }) : h;
      });
      this.setData({
        feedback: 'right',
        feedbackWord: q.answer,
        feedbackMean: q.q,
        score: this.data.score + gain,
        combo: combo,
        maxCombo: Math.max(combo, this.data.maxCombo),
        correct: this.data.correct + 1,
        feedbackAnim: 'ok',
        tappedWord: word,
        isGold: isGold,
        gainText: '+' + gain + (isGold ? ' 幸运!' : ''),
        confetti: [],
        bubbleText: isGold ? '幸运翻倍！4 倍分！' : this.rightLine(combo),
        flameCount: this.flameNum(combo),
        holes: holes,
      });
      storage.addStat(1, 0);
      storage.recordReview({ w: q.answer, p: q.phonetic, m: q.q }, true);
    } else {
      const lives = this.data.lives - 1;
      // 错的那只地鼠"嘲笑"不下沉；正确答案那只弹出高亮
      const holes = this.data.holes.map(function (h) {
        if (h.word === word) return Object.assign({}, h, { hit: 'laugh' });
        if (h.word === q.answer) return Object.assign({}, h, { reveal: true });
        return h;
      });
      this.setData({
        feedback: 'wrong',
        feedbackWord: q.answer,
        feedbackMean: q.q,
        lives: lives,
        combo: 0,
        showAnswer: true,
        feedbackAnim: 'no',
        tappedWord: word,
        isGold: false,
        gainText: '-1 ♥',
        confetti: [],
        bubbleText: this.wrongLine(),
        flameCount: 0,
        holes: holes,
      });
      storage.addStat(0, 1);
      storage.addWrong({ w: q.answer, p: q.phonetic, m: q.q });
      storage.recordReview({ w: q.answer, p: q.phonetic, m: q.q }, false);
    }
    // 语音不自动播放：用户想听自己点「读单词」。这里只做固定停留后自动推进。
    const self2 = this;
    const answeredWord = q.answer;
    const token = this.advanceToken;
    // 词卡判定放下一帧，绝不阻塞点击
    setTimeout(function () {
      try {
        self2.setData({
          canOpenDetail: wordCard.hasData(answeredWord) || self2.volumeOfWord(answeredWord) > 1,
        });
      } catch (e) {}
    }, 0);
    // 答对停 1.2s；答错停 2.4s，留时间看词卡/思考。看词卡时不自动跳。
    this.stopAdvance();
    this.advanceTimer = setTimeout(function () {
      if (token !== self2.advanceToken) return;
      if (self2.data.detailOpen) return; // 正在看词卡，暂不跳
      self2.advance();
    }, right ? 1200 : 2400);
  },

  stopAdvance() {
    if (this.advanceTimer) { clearTimeout(this.advanceTimer); this.advanceTimer = null; }
  },

  // 由单词反查所属册次 v
  volumeOfWord(w) {
    for (let i = 0; i < levels.length; i++) {
      const ws = levels[i].w || [];
      for (let k = 0; k < ws.length; k++) if (ws[k][0] === w) return levels[i].v;
    }
    return 1;
  },

  // ===== 星际词卡（打地鼠入口）=====
  openWordCard() {
    const w = this.data.feedbackWord;
    if (!w) return;
    const self = this;
    this.stopAdvance();
    if (wordCard.hasData(w)) {
      this.setData({ detailOpen: true, detail: wordCard.get(w), detailWord: w, detailSaved: false });
      // 基础词卡先显示；分包可用时后台补齐搭配/同义词，并原地刷新弹层
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
      if (!d) { ui.notify(self, '暂无词卡'); self.advance(); return; }
      self.setData({ detailOpen: true, detail: d, detailWord: w, detailSaved: false });
    });
  },

  // ✕ 只关闭词卡、留在当前页；但重新挂上推进定时器，避免看词卡后彻底卡死
  closeWordCard() {
    this.setData({ detailOpen: false });
    const self = this;
    this.clearAllTimers();
    this.advanceTimer = setTimeout(function () { self.advance(); }, 600);
  },

  closeWordCardAndAdvance() {
    this.setData({ detailOpen: false });
    this.clearAllTimers();
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

  advance() {
    this.clearAllTimers();
    // 不在这里 tts.stop()：首次调用会创建 InnerAudioContext，在预览卡里初始化很慢，
    // 恰好卡在"第1题→第2题"。语音已改手动，切题无需停音频；点读时 speakWord 内部会 stop。
    const next = this.data.qIndex + 1;
    if (this.data.lives <= 0) {
      // 生命耗尽：先给复活机会（广告 / 补签卡），不直接结算
      this.setData({ showRevive: true, freezes: storage.getFreezes() });
      return;
    }
    if (next >= this.data.total) { this.endGame(); return; }
    this.setData({ qIndex: next });
    this.nextQuestion();
  },

  // 看广告复活：+2 条命继续
  reviveByAd() {
    const self = this;
    try {
      ad.show('revive', function () { self.doRevive(); }, function () {
        ui.notify(self, '当前环境暂不支持广告，可用补签卡复活');
      });
    } catch (e) {
      ui.notify(this, '当前环境暂不支持广告，可用补签卡复活');
    }
  },

  // 用补签卡复活：消耗1张，+2条命
  reviveByFreeze() {
    if ((storage.getFreezes() || 0) <= 0) {
      ui.notify(this, '没有补签卡了');
      return;
    }
    // 复用 useFreeze 会占用打卡日期，这里单独扣卡
    storage.consumeFreeze();
    this.doRevive();
  },

  doRevive() {
    const next = this.data.qIndex + 1;
    this.setData({
      showRevive: false,
      lives: this.data.lives + 2,
      freezes: storage.getFreezes(),
    });
    if (next >= this.data.total) { this.endGame(); return; }
    this.setData({ qIndex: next });
    this.nextQuestion();
  },

  giveUp() {
    this.setData({ showRevive: false });
    this.endGame();
  },

  endGame() {
    const c = this.data.correct;
    let star = 0;
    if (c >= 8) star = 1;
    if (c >= 12) star = 2;
    if (c >= 15) star = 3;
    if (star > 0) storage.setStar(this.levelId, star);
    storage.addPlay('game');
    const earned = storage.checkBadges();
    this.setData({ gameOver: true, star: star, won: star > 0, earnedBadges: earned });
  },

  retry() {
    this.clearAllTimers();
    try { tts.stop(); } catch (e) {}
    const words = this.idxVal < 0 ? (this.mixWords || []) : quiz.levelWords(this.idxVal || 0);
    const qs = quiz.makeChoiceQuestions(words, 15, words);
    this.questionBank = qs;
    // 先立即关掉结算弹窗并清掉所有反馈残留，视觉上"秒响应"
    this.setData({
      gameOver: false, showRevive: false, detailOpen: false,
      questions: qs, total: qs.length, qIndex: 0, score: 0,
      combo: 0, maxCombo: 0, lives: 3, correct: 0,
      star: 0, feedback: '', feedbackWord: '',
      feedbackAnim: '', tappedWord: '', gainText: '', confetti: [],
      isGold: false, screenShake: false, hammerSwing: false,
      flameCount: 0, bubbleText: '来！敲出这个意思的单词',
    });
    this.refreshPet();
    this.nextQuestion();
  },

  backHome() {
    wx.navigateBack();
  },
}));
