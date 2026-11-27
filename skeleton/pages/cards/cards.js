const ui = require('../../utils/ui.js');
const quiz = require('../../utils/quiz.js');
const storage = require('../../utils/storage.js');
const ad = require('../../utils/ad.js');

// 每日盲盒：抽单词卡，普通/稀有/史诗三档，可变奖励
Page({
  data: {
    status: null,
    cards: [],
    poolSize: 0,
    canAd: false,
    lastDraw: null,   // 刚抽到的卡（展示动画）
    showResult: false,
    tab: 'draw',      // draw | album
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    this.setData({
      status: storage.drawStatus(),
      cards: storage.getCards(),
      poolSize: quiz.levelCount(),
      canAd: ad.isAvailable(),
    });
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  // 免费抽（每日首次）
  drawFree() {
    if (this.data.status.freeLeft <= 0) {
      ui.notify(this, '今日免费次数已用完');
      return;
    }
    this.doDraw();
  },

  // 用学习能量抽（统一货币：答题攒的能量）
  drawByEnergy() {
    const need = this.data.status.energyCost;
    if (!storage.spendEnergy(need)) {
      ui.notify(this, '能量不够，去闯关攒能量吧');
      return;
    }
    this.doDraw();
  },

  // 看广告再抽一次
  drawByAd() {
    const self = this;
    try {
      ad.show('draw', function () { self.doDraw(); }, function () {
        ui.notify(self, '当前环境不支持广告');
      });
    } catch (e) {
      ui.notify(this, '当前环境不支持广告');
    }
  },

  // 用补签卡抽
  drawByFreeze() {
    if (!storage.consumeFreeze()) {
      ui.notify(this, '没有补签卡了');
      return;
    }
    this.doDraw();
  },

  doDraw() {
    // 从词库随机抽一个词
    const all = [];
    for (let i = 0; i < quiz.levelCount(); i++) {
      const ws = quiz.levelWords(i);
      if (ws.length) all.push(ws[Math.floor(Math.random() * ws.length)]);
    }
    const pick = all[Math.floor(Math.random() * all.length)];
    if (!pick) return;
    const card = storage.drawCard({ w: pick[0], p: pick[1], m: pick[2] });
    this.setData({
      lastDraw: card,
      showResult: true,
      status: storage.drawStatus(),
      cards: storage.getCards(),
    });
    const earned = storage.checkBadges();
    if (earned.length) {
      ui.notify(this, '解锁新徽章：' + earned[0].name);
    }
  },

  closeResult() {
    this.setData({ showResult: false });
  },

  backHome() { wx.navigateBack(); },
});
