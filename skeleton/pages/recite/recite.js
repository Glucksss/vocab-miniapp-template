const levels = require('../../data/levels.js');
const quiz = require('../../utils/quiz.js');
const tts = require('../../utils/tts.js');
const wordCard = require('../../utils/wordCard.js');
const ui = require('../../utils/ui.js');
const vp = require('../../utils/volPicker.js');

Page(Object.assign({}, vp.behavior, {
  data: Object.assign({}, vp.data(), {
    currentLevels: [],
    showLevels: false,
    levelIdx: -1,
    levelName: '',
    words: [],
    pos: 0,
    current: null,
    flipped: false,
    knownWords: [],
    masteryRate: 0,
    starSlots: [1, 2, 3],
    done: false,
    speakTip: '',
  }),

  onLoad(options) {
    const range = vp.init(this, options || {});
    this.applyRange(range.v, range.u);
  },

  onUnload() {
    if (this._speakStartTimer) { clearTimeout(this._speakStartTimer); this._speakStartTimer = null; }
    if (this._speakTipTimer) { clearTimeout(this._speakTipTimer); this._speakTipTimer = null; }
    try { tts.stop(); } catch (e) {}
  },

  // 和打地鼠/单词拼图同一套选择器：选完册次 + 单元范围后重建背诵内容。
  applyRange(v, u) {
    v = Number(v) || 1;
    u = Number(u) || 0;
    this._rangeV = v;
    this._rangeU = u;
    try {
      wx.setStorageSync('practice_vol', v);
      wx.setStorageSync('practice_unit', u);
    } catch (e) {}

    const list = [];
    if (!u) {
      list.push({ idx: -1, label: '整册混合', id: 'mix-' + v, mix: true });
    } else {
      let seq = 0;
      levels.forEach(function (lv, idx) {
        if (lv.v !== v || lv.u !== u) return;
        seq++;
        list.push({ idx: idx, label: 'U' + u + '-' + seq, id: lv.id });
      });
    }

    this.setData({
      activeVol: v,
      activeUnit: u,
      currentLevels: list,
      volOpen: false,
      showLevels: false,
    });

    if (list.length) this.loadLevel(list[0].idx);
    else this.setData({ words: [], current: null, levelName: '', done: true, knownWords: [] });
  },

  loadLevel(idx) {
    idx = Number(idx);
    const self = this;
    let words = [];
    let levelName = '';
    let key = '';
    const seen = {};

    if (idx < 0) {
      const v = Number(this._rangeV) || Number(this.data.activeVol) || 1;
      const u = Number(this._rangeU) || Number(this.data.activeUnit) || 0;
      levels.forEach(function (lv) {
        if (lv.v !== v || (u && lv.u !== u)) return;
        (lv.w || []).forEach(function (x) {
          const w = quiz.toWord(x);
          if (!w || !w.w || seen[w.w]) return;
          seen[w.w] = 1;
          words.push(self.decorateWord({ w: w.w, p: w.p, m: w.m }));
        });
      });
      levelName = u ? 'Unit ' + u + ' · 混合' : '整册混合';
      key = 'recite_known_mix_' + v + '_' + u;
    } else {
      const lv = levels[idx];
      if (!lv) return;
      words = (lv.w || []).map(function (x) {
        const w = quiz.toWord(x);
        return self.decorateWord({ w: w.w, p: w.p, m: w.m });
      }).filter(function (w) { return !!w.w; });
      const node = (this.data.currentLevels || []).filter(function (x) { return x.idx === idx; })[0];
      levelName = node ? node.label : ('Unit ' + lv.u);
      key = 'recite_known_' + lv.id;
    }

    words.forEach(function (w, i) { w.idx = i; });
    let knownWords = [];
    try { knownWords = wx.getStorageSync(key) || []; } catch (e) {}
    if (!Array.isArray(knownWords)) knownWords = [];
    this._knownKey = key;
    this.setData({
      levelIdx: idx,
      levelName: levelName,
      words: words,
      pos: 0,
      flipped: false,
      knownWords: knownWords,
      current: words[0] || null,
      done: words.length === 0,
      showLevels: false,
      speakTip: '',
    });
    this.refreshRate();
    this.ensureCard(Number(this._rangeV) || this.data.activeVol);
  },

  refreshRate() {
    const total = this.data.words.length;
    const rate = total ? Math.min(100, Math.round(this.data.knownWords.length * 100 / total)) : 0;
    if (rate !== this.data.masteryRate) this.setData({ masteryRate: rate });
  },

  // 词卡数据同步挂在词上：背面直接显示搭配/同义词，不再只显示中文释义
  decorateWord(w) {
    const d = wordCard.get(w.w) || {};
    w.p = w.p || d.p || '';
    w.m = w.m || d.cn || '';
    w.collocations = ((d.collocations || []).slice(0, 3)).map(function (c) {
      return { en: c.en || '', cn: c.cn || '' };
    });
    w.synonyms = (d.synonyms || []).slice(0, 6);
    w.cardSource = d.source || '';
    return w;
  },

  // 分包词卡异步到达后只刷新当前这一张，避免整册重排
  ensureCard(v) {
    if (!v || v === 1) return;
    try {
      wordCard.ensure(v, (ok) => {
        if (!ok || !this.data.current) return;
        const refreshed = this.decorateWord(Object.assign({}, this.data.current));
        const words = this.data.words.slice();
        words[this.data.pos] = refreshed;
        this.setData({ current: refreshed, words: words });
      });
    } catch (e) {}
  },

  toggleLevels() { this.setData({ showLevels: !this.data.showLevels }); },

  openLevel(e) { this.loadLevel(Number(e.currentTarget.dataset.idx)); },

  tapCard() {
    if (!this.data.current) return;
    this.setData({ flipped: !this.data.flipped });
  },

  clearSpeakTip() {
    if (this._speakTipTimer) { clearTimeout(this._speakTipTimer); this._speakTipTimer = null; }
    this.setData({ speakTip: '' });
  },

  speak() {
    const c = this.data.current;
    if (!c) return;
    const canAudio = typeof wx !== 'undefined' && wx && typeof wx.createInnerAudioContext === 'function';
    this.setData({ speakTip: canAudio ? '🔊 正在朗读：' + c.w : '当前预览环境不支持朗读' });
    try { ui.notify(this, canAudio ? '开始朗读' : '暂不支持朗读'); } catch (e) {}
    if (!canAudio) {
      this._speakTipTimer = setTimeout(() => this.clearSpeakTip(), 1800);
      return;
    }
    // 先让提示渲染出来，再启动音频初始化，避免预览环境首帧卡住
    if (this._speakStartTimer) clearTimeout(this._speakStartTimer);
    this._speakStartTimer = setTimeout(() => {
      this._speakStartTimer = null;
      try {
        tts.speakWord({ w: c.w, p: c.p, m: c.m }, { onDone: () => this.clearSpeakTip() });
      } catch (e) {
        this.setData({ speakTip: '朗读失败，请稍后再试' });
      }
    }, 0);
    this._speakTipTimer = setTimeout(() => this.clearSpeakTip(), 5000);
  },

  markKnown() {
    const c = this.data.current;
    if (!c) return;
    const known = this.data.knownWords.slice();
    if (known.indexOf(c.w) < 0) known.push(c.w);
    this.persistKnown(known);
    this.setData({ knownWords: known });
    this.refreshRate();
    this.move(1);
  },

  markAgain() {
    const c = this.data.current;
    if (!c) return;
    const known = this.data.knownWords.filter(function (w) { return w !== c.w; });
    this.persistKnown(known);
    this.setData({ knownWords: known });
    this.refreshRate();
    this.move(1);
  },

  persistKnown(list) {
    if (!this._knownKey) return;
    try { wx.setStorageSync(this._knownKey, list); } catch (e) {}
  },

  move(step) {
    const next = this.data.pos + step;
    const total = this.data.words.length;
    if (next < 0 || next >= total) {
      if (next >= total) this.setData({ done: true });
      return;
    }
    this.setData({ pos: next, current: this.data.words[next], flipped: false });
  },

  prev() { this.move(-1); },
  next() { this.move(1); },

  restart() {
    this.setData({ pos: 0, current: this.data.words[0] || null, flipped: false, done: false });
  },
}));
