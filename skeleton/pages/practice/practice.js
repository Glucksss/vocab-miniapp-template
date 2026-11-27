const ui = require('../../utils/ui.js');
const levels = require('../../data/levels.js');
const storage = require('../../utils/storage.js');
const ad = require('../../utils/ad.js');

const VOL_NAMES = ['必修一', '必修二', '必修三', '选择性必修一', '选择性必修二', '选择性必修三', '选择性必修四', '高考3500', '真题高频'];

Page({
  data: {
    volumes: [],
    volGroups: [],
    activeVol: 1,
    activeUnit: 0,
    unitOptions: [],
    volOpen: false,
    dueCount: 0,
    wrongCount: 0,
    accuracy: 0,
    bonus: { used: 0, quota: 10, expanded: 0, expandLeft: 5 },
    bonusRuleOpen: false, // 加成计入范围说明弹层
  },

  onShow() { this.refresh(); },

  refresh() {
    const volMap = {};
    levels.forEach(function (lv, idx) {
      if (!volMap[lv.v]) volMap[lv.v] = [];
      volMap[lv.v].push(idx);
    });
    const volumes = [];
    for (let v = 1; v <= 9; v++) {
      const idxs = volMap[v] || [];
      volumes.push({ v: v, name: VOL_NAMES[v - 1], count: idxs.length, special: v >= 8 });
    }
    const volGroups = [
      { title: '必修课', hint: '译林 · 第一至三册', items: volumes.slice(0, 3) },
      { title: '选择性必修课', hint: '译林 · 第一至四册', items: volumes.slice(3, 7) },
      { title: '高考冲刺', hint: '真题与高频词', items: volumes.slice(7, 9) },
    ];
    const savedVol = Number(wx.getStorageSync('practice_vol')) || 1;
    const activeVol = savedVol >= 1 && savedVol <= 9 ? savedVol : 1;
    this.setData({
      volumes: volumes,
      volGroups: volGroups,
      activeVol: activeVol,
      dueCount: storage.reviewCount(),
      wrongCount: storage.wrongCount(),
      accuracy: storage.accuracy(),
      bonus: storage.bonusStatus(),
    });
    this.buildUnits(activeVol);
  },

  // 当前册的单元范围：整册混合 + 各单元
  buildUnits(v) {
    const seen = {};
    const opts = [{ u: 0, name: '整册混合' }];
    levels.forEach(function (lv) {
      if (lv.v !== v || !lv.u || seen[lv.u]) return;
      seen[lv.u] = 1;
      opts.push({ u: lv.u, name: 'Unit ' + lv.u });
    });
    const cur = Number(wx.getStorageSync('practice_unit'));
    const activeUnit = seen[cur] || cur === 0 ? cur : 0;
    wx.setStorageSync('practice_unit', activeUnit);
    this.setData({ unitOptions: opts, activeUnit: activeUnit });
  },

  toggleVolMenu() { this.setData({ volOpen: !this.data.volOpen }); },
  closeVolMenu() { this.setData({ volOpen: false }); },

  switchVol(e) {
    const v = Number(e.currentTarget.dataset.v);
    wx.setStorageSync('practice_vol', v);
    // 选册次不收起，让用户接着选出题范围
    this.setData({ activeVol: v });
    this.buildUnits(v);
  },

  switchUnit(e) {
    const u = Number(e.currentTarget.dataset.u);
    wx.setStorageSync('practice_unit', u);
    // 出题范围选定后才收起窗口
    this.setData({ activeUnit: u, volOpen: false });
  },

  // 加成计入范围：只说边界，不改任何数据
  openBonusRule() { this.setData({ bonusRuleOpen: true }); },
  closeBonusRule() { this.setData({ bonusRuleOpen: false }); },

  // 看视频扩容今日能量加成：每次 +10 题，每天最多 5 次。
  // 广告本身是代价，扩容只放大"答题产出"，不碰成长/错词/星级/词卡/补签。
  expandBonus() {
    if (this.data.bonus.expandLeft <= 0) {
      ui.notify(this, '今天已扩满，明天再来');
      return;
    }
    const self = this;
    ad.show('bonus', function () {
      const r = storage.expandBonusByAd();
      if (!r.ok) { ui.notify(self, r.msg); return; }
      self.setData({ bonus: storage.bonusStatus() });
      ui.notify(self, '今日加成额度 +10 题！');
    }, function () {
      ui.notify(self, '当前环境暂不支持广告');
    });
  },

  // 打地鼠速玩：按当前册次 + 单元范围混合出题
  quickPlay() {
    const v = this.data.activeVol;
    const u = this.data.activeUnit || 0;
    wx.navigateTo({ url: '/pages/game/game?v=' + v + '&u=' + u });
  },

  // 挑战自我两张卡：按 data-path 跳转
  openMode(e) {
    const path = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.path;
    if (!path) return;
    wx.navigateTo({ url: path });
  },

  openSpell() { wx.navigateTo({ url: '/pages/spell/spell' }); },
  openRecite() { wx.navigateTo({ url: '/pages/recite/recite' }); },
  openReview() { wx.navigateTo({ url: '/pages/review/review' }); },
  openContext() { wx.navigateTo({ url: '/pages/context/context' }); },
  openWrong() { wx.navigateTo({ url: '/pages/wrong/wrong' }); },
  comingSoon() {
    ui.notify(this, '更多玩法正在路上');
  },

  goChallenge() {
    wx.navigateTo({ url: '/pages/map/map?v=' + this.data.activeVol });
  },
});
