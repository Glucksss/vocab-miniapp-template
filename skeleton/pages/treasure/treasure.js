const storage = require('../../utils/storage.js');

// 宝箱Tab：战利品仓库。汇总能量、装扮碎片、宝箱档位进度、开箱记录、稀有词卡与终极礼状态。
// 实际开箱发生在章节关/地图线头，这里只做展示和引导，不重复发奖。
Page({
  data: {
    energy: 0,
    shards: 0,
    chest: null,      // chestStatus(): preview / history / tiers / shards
    cards: null,      // drawStatus(): total / epic / rare / freeLeft
    equip: null,      // equipStatus(): ownedCount / total / bonus
    ultimate: null,   // ultimateStatus()
    nextTierIndex: 0, // 已开箱数在档位序列中的位置
    starSlots: [1, 2, 3, 4],
    // 仓库增强：全部用真实存档数据算，不编造分母/概率
    album: { collected: 0, learned: 0, percent: 0 },   // 已收集词卡 / 已学过的词
    pity: { step: 0, need: 0, epic: 0, done: false },  // 当日抽卡进度（每日第3次起概率提升）
  },

  onShow() { this.refresh(); },

  refresh() {
    const chest = storage.chestStatus();
    const equip = storage.equipStatus();
    const cards = storage.drawStatus();
    const drawn = chest.preview.drawn || 0;
    // 图鉴进度：已收集词卡 / 已学过的词（分母用真实 collectedCount，不虚构总数）
    const learned = storage.collectedCount();
    const collected = cards.total || 0;
    const album = {
      collected: collected,
      learned: learned,
      percent: learned > 0 ? Math.min(100, Math.round(collected * 100 / learned)) : 0,
    };
    // 当日抽卡进度：真实规则是"当日第3次起史诗概率提升"，不承诺固定几抽必出
    const todayDrawn = cards.drawn || 0;
    const pity = {
      step: todayDrawn,
      need: Math.max(0, 3 - todayDrawn),
      epic: cards.epic || 0,
      done: todayDrawn >= 3,
    };
    this.setData({
      energy: storage.getEnergy(),
      shards: chest.shards,
      chest: chest,
      cards: cards,
      equip: equip,
      ultimate: storage.ultimateStatus(),
      nextTierIndex: Math.min(drawn, (chest.tiers || []).length - 1),
      album: album,
      pity: pity,
    });
  },

  // 去闯关开箱：直接进入大地图（跟随当前册次），不再回首页
  goChallenge() {
    const v = Number(wx.getStorageSync('home_vol'));
    wx.navigateTo({ url: '/pages/map/map?v=' + (v >= 1 && v <= 7 ? v : 1) });
  },

  // 去练习赚能量
  goPractice() {
    wx.switchTab({ url: '/pages/practice/practice' });
  },

  // 去我的页合成/穿戴装扮
  goEquip() {
    wx.switchTab({ url: '/pages/pet/pet' });
  },

  // 词卡收藏册（二级页）
  openCards() {
    wx.navigateTo({ url: '/pages/cards/cards' });
  },

  // 每日盲盒（二级页）
  openDraw() {
    wx.navigateTo({ url: '/pages/cards/cards' });
  },

  // 回地图开终极礼（二级页）
  goMap() {
    wx.navigateTo({ url: '/pages/map/map?v=1' });
  },
});
