const ui = require('../../utils/ui.js');
const levels = require('../../data/levels.js');
const storage = require('../../utils/storage.js');
const ad = require('../../utils/ad.js');

const VOL_NAMES = ['必修一', '必修二', '必修三', '选择性必修一', '选择性必修二', '选择性必修三', '选择性必修四', '高考3500', '真题高频'];

// 首页 = 下一步导向：状态行 + 继续闯关大卡（唯一地图入口）+ 今日任务 + 小入口。
// 打地鼠关卡网格已下沉到「练习」Tab，首页只保留一个闯关入口，避免长列表劝退。
Page({
  data: {
    totalStars: 0,
    streak: 0,
    energy: 0,
    volumes: [],
    activeVol: 0,
    currentVol: null,
    doneCount: 0,
    volLevelCount: 0,
    nextLevelName: '',
    dueCount: 0,
    drawFreeLeft: 0,
    wrongCount: 0,
    badgeEarned: 0,
    badgeTotal: 0,
    volOpen: false,
    volGroups: [],
    // 顶部三胶囊说明弹层：'' | 'star' | 'fire' | 'energy'
    infoPanel: '',
    // 奖励速览条：默认折叠，只露一行提示，点开再看完整规则
    rewardOpen: false,
    // 首次三步引导浮层：新用户第一次进首页自动弹一次，看过写本地标记不再打扰
    guideOpen: false,
    maxStars: 0,
    streakBest: 0,
    freezes: 0,
    week: [],
  },

  onShow() {
    this.refresh();
    // 首次引导：只弹一次，本地标记持久化（用独立 key，不污染主存档）
    try {
      if (!wx.getStorageSync('guide_seen_v1')) this.setData({ guideOpen: true });
    } catch (e) {}
    // 章节页换册次后同步过来的当前册次
    const hv = Number(wx.getStorageSync('home_vol'));
    if (hv >= 1 && hv <= 7 && hv - 1 !== this.data.activeVol) {
      this.buildVol(hv - 1);
    }
    // 答题攒够成长值后回到首页，提示宠物进化
    const evo = storage.checkEvolution();
    if (evo) {
      const self = this;
      wx.showModal({
        title: '✨ 宠物进化了！',
        content: '你的词枭进化成了「' + evo.name + ' · ' + evo.title + '」，快去看看！',
        confirmText: '去看看',
        cancelText: '稍后',
        success: function (r) {
          if (r.confirm) self.openPet();
        },
      });
    }
  },

  refresh() {
    const volMap = {};
    levels.forEach(function (lv, idx) {
      if (!volMap[lv.v]) volMap[lv.v] = [];
      volMap[lv.v].push(idx);
    });
    const volumes = [];
    for (let v = 1; v <= 9; v++) {
      const idxs = volMap[v] || [];
      const stars = idxs.reduce(function (s, i) { return s + storage.getStar(levels[i].id); }, 0);
      volumes.push({
        v: v,
        name: VOL_NAMES[v - 1],
        count: idxs.length,
        stars: stars,
        special: v >= 8,
      });
    }
    const ds = storage.drawStatus();
    const bs = storage.badgeCount();
    const si = storage.streakInfo();
    // 册次下拉按「必修课 / 选择性必修课 / 高考冲刺」三组归类
    const withIdx = function (arr, base) {
      return arr.map(function (v, i) { v.idx = base + i; return v; });
    };
    const volGroups = [
      { title: '必修课', hint: '译林 · 第一至三册', items: withIdx(volumes.slice(0, 3), 0) },
      { title: '选择性必修课', hint: '译林 · 第一至四册', items: withIdx(volumes.slice(3, 7), 3) },
      { title: '高考冲刺', hint: '真题与高频词', items: withIdx(volumes.slice(7, 9), 7) },
    ];
    this.setData({
      totalStars: storage.totalStars(),
      maxStars: levels.length * 3,
      streak: storage.streakDays(),
      streakBest: si.best,
      freezes: si.freezes,
      week: storage.weeklyReport(),
      energy: storage.getEnergy(),
      volumes: volumes,
      volGroups: volGroups,
      dueCount: storage.reviewCount(),
      drawFreeLeft: ds.freeLeft,
      wrongCount: storage.wrongCount(),
      badgeEarned: bs.earned,
      badgeTotal: bs.total,
    });
    this.buildVol(this.data.activeVol);
  },

  // 计算当前册进度与下一站
  buildVol(activeIdx) {
    const v = activeIdx + 1;
    let done = 0;
    let count = 0;
    let nextName = '';
    let seq = 0;
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].v !== v) continue;
      seq++;
      const star = storage.getStar(levels[i].id);
      count++;
      if (star > 0) done++;
      else if (!nextName) nextName = v >= 8 ? ('第' + seq + '关') : ('Unit ' + levels[i].u);
    }
    if (!nextName) nextName = count ? '全部通关 · 再来一轮' : '开始闯关';
    this.setData({
      activeVol: activeIdx,
      currentVol: this.data.volumes[activeIdx] || null,
      doneCount: done,
      volLevelCount: count,
      nextLevelName: nextName,
    });
  },

  toggleVolMenu() {
    this.setData({ volOpen: !this.data.volOpen });
  },

  closeVolMenu() {
    this.setData({ volOpen: false });
  },

  switchVol(e) {
    this.buildVol(Number(e.currentTarget.dataset.idx));
    this.setData({ volOpen: false });
  },

  // 顶部 ⭐🔥⚡ + 签到长条：打开对应说明层（fire 被长条和顶部🔥共用）
  openInfo(e) {
    this.setData({ infoPanel: e.currentTarget.dataset.panel, volOpen: false });
  },
  closeInfo() {
    this.setData({ infoPanel: '' });
  },
  // 奖励速览条折叠/展开
  toggleReward() {
    this.setData({ rewardOpen: !this.data.rewardOpen });
  },

  // 首次引导：跳过 / 开始闯关 都写标记并关闭，保证只弹一次
  closeGuide() {
    try { wx.setStorageSync('guide_seen_v1', true); } catch (e) {}
    this.setData({ guideOpen: false });
  },
  startGuide() {
    this.closeGuide();
    wx.navigateTo({ url: '/pages/game/game' });
  },
  // 标题旁「?」：随时重看三步引导（不重写标记）
  openGuide() {
    this.setData({ guideOpen: true });
  },
  // 断签时用补签卡恢复连续天数
  useFreeze() {
    if (storage.useFreeze()) {
      ui.notify(this, '已恢复连续打卡！');
      this.refresh();
      this.setData({ infoPanel: '' });
    } else {
      ui.notify(this, '暂时无法使用');
    }
  },
  // 看广告补签：看完激励视频恢复连续天数（能力检测，预览环境静默降级）
  freezeByAd() {
    const self = this;
    ad.show('freeze', function () {
      // 看广告补签：不消耗补签卡
      const ok = storage.restoreStreakByAd();
      ui.notify(self, ok ? '已恢复连续打卡！' : '今天已点亮，明天见');
      self.refresh();
      self.setData({ infoPanel: '' });
    }, function () {
      ui.notify(self, '当前环境暂不支持广告，可用补签卡');
    });
  },

  // 闯关唯一入口：跟随当前册次进大地图
  openMap() {
    const v = this.data.activeVol + 1;
    wx.navigateTo({ url: '/pages/map/map?v=' + (v >= 1 && v <= 7 ? v : 1) });
  },

  // 速玩：进练习Tab（打地鼠第一张卡）
  quickPlay() {
    wx.switchTab({ url: '/pages/practice/practice' });
  },

  // 宠物页已升为Tab页
  openPet() {
    wx.switchTab({ url: '/pages/pet/pet' });
  },

  openReview() { wx.navigateTo({ url: '/pages/review/review' }); },
  openCards() { wx.navigateTo({ url: '/pages/cards/cards' }); },
  openAchieve() { wx.navigateTo({ url: '/pages/achieve/achieve' }); },
  openContext() { wx.navigateTo({ url: '/pages/context/context' }); },
  goWrong() { wx.navigateTo({ url: '/pages/wrong/wrong' }); },

  onShareAppMessage() {
    return { title: '译林英语单词闯关，边玩边记！', path: '/pages/index/index' };
  },
});
