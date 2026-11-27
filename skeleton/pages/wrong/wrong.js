const ui = require('../../utils/ui.js');
const storage = require('../../utils/storage.js');
const tts = require('../../utils/tts.js');
const wordCard = require('../../utils/wordCard.js');
const levels = require('../../data/levels.js');

Page({
  data: {
    words: [],
    count: 0,
    hardCount: 0,
    maxWrong: 0,
    stats: null,
    // 星际词卡弹层
    detailOpen: false,
    detail: null,
    detailWord: '',
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const words = storage.getWrong().slice().sort(function (a, b) { return (b.n || 1) - (a.n || 1); });
    let hardCount = 0;
    let maxWrong = 0;
    words.forEach(function (w) {
      const n = Number(w.n) || 1;
      if (n >= 3) hardCount++;
      if (n > maxWrong) maxWrong = n;
    });
    this.setData({ words: words, count: words.length, hardCount: hardCount, maxWrong: maxWrong, stats: storage.getStats() });
  },

  startBoss() {
    if (this.data.count === 0) {
      ui.notify(this, '还没有错词，先去闯关吧');
      return;
    }
    wx.navigateTo({ url: '/pages/clean/clean' });
  },

  onUnload() { try { tts.stop(); } catch (e) {} },

  // 错词本复习：读完整单词「英文 + 中文」
  speakOne(e) {
    try {
      const i = Number(e.currentTarget.dataset.i);
      const item = this.data.words[i];
      if (item) tts.speakWord({ w: item.w, p: item.p, m: item.m });
    } catch (e) {}
  },

  removeOne(e) {
    const w = e.currentTarget.dataset.w;
    storage.removeWrong(w);
    this.refresh();
  },

  // ===== 星际词卡（词条上「词卡」入口）=====
  openWordCard(e) {
    const w = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.w;
    if (!w) return;
    const self = this;
    if (wordCard.hasData(w)) {
      this.setData({ detailOpen: true, detail: wordCard.get(w), detailWord: w });
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
      if (!d) { ui.notify(self, '暂无词卡'); return; }
      self.setData({ detailOpen: true, detail: d, detailWord: w });
    });
  },

  closeWordCard() { this.setData({ detailOpen: false }); },

  removeDetailAndClose() {
    const w = this.data.detailWord;
    if (w) { storage.removeWrong(w); this.refresh(); }
    this.setData({ detailOpen: false });
    ui.notify(this, '已移出错词本');
  },

  noop() {},

  volumeOfWord(w) {
    for (let i = 0; i < levels.length; i++) {
      const ws = levels[i].w || [];
      for (let k = 0; k < ws.length; k++) if (ws[k][0] === w) return levels[i].v;
    }
    return 1;
  },

  backHome() { wx.navigateBack(); },
});
