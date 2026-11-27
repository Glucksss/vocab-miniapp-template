const levels = require('../../data/levels.js');
const storage = require('../../utils/storage.js');
const vp = require('../../utils/volPicker.js');
const ad = require('../../utils/ad.js');
const ui = require('../../utils/ui.js');

// 背景成图 660 x 1874，等比换算到 750rpx 宽
const MAP_W = 750;
const IMG_W = 660;
const IMG_H = 1874;
const MAP_H = Math.round(MAP_W * IMG_H / IMG_W); // ≈ 2130rpx
// 深蓝画框左右各留 30rpx，画布由 750 缩到 690rpx；球/卡片坐标按此等比缩放
const FRAME_PAD = 30;
const SCALE = (MAP_W - FRAME_PAD * 2) / MAP_W; // 0.92

// 4 个宝箱球，卡在相邻两张卡片之间的橙线中点（间隙 1-2 / 2-3 / 3-4 / 4-5 各一个）。
// 坐标用生成底图同一条 Catmull-Rom 曲线求得：既在两卡片正中，又精确压在橙线上。
// 每个球 = 对应单元的通关奖励宝箱，点进去闯关，闯完按累计档位开箱（木→银→金→传说）。
const CHEST_BALLS = [
  { unit: 1, tier: 1, icon: '📦', label: '木箱',   left: 511, top: 362 },
  { unit: 2, tier: 2, icon: '🥈', label: '银箱',   left: 186, top: 767 },
  { unit: 3, tier: 3, icon: '🏅', label: '金箱',   left: 571, top: 1171 },
  { unit: 4, tier: 4, icon: '👑', label: '传说箱', left: 183, top: 1576 },
];

// BOSS 终极宝箱：橙线末端线头处，左右不动(x=217)，只上下微调压住橙线(y=1815)。
// 球 96rpx(半径48)+脉冲1.05(有效50.4)，球底 1815+50.4=1865.4 < 图高1959，留93rpx，不撑开。
const ULTIMATE_BALL = { left: 217, top: 1815 };

const UNIT_NAMES = ['基础入门', '词块进阶', '语境突破', '高分冲刺'];
const UNIT_BADGES = ['🚀', '📚', '🔍', '⭐'];
// 译林 7 册都是 4 单元结构，共用这套地图；v8/v9 是平铺关卡，不走地图。
const VOL_NAMES = ['', '必修一', '必修二', '必修三', '选择性必修一', '选择性必修二', '选择性必修三', '选择性必修四'];
const CARD_Y = [0.075, 0.265, 0.455, 0.645, 0.835]; // 5 张卡片纵向位置

// 功能球都在卡片之间的空隙里（球 top=373/805/1161，卡片区间 95-225/499-629/904-1034/1309-1439/1714-1844），
// 纵向完全不重叠，所以卡片按索引左右交错即可，正是参考图的排法。
function cardSide(pos) { return pos % 2 === 0 ? 'card-right' : 'card-left'; }

Page(Object.assign({}, vp.behavior, {
  data: Object.assign({}, vp.data(), {
    chestBalls: [],
    cards: [],
    volName: '必修一',
    subtitle: 'Unit 1–4 核心词汇',
    earned: 0,
    maxStars: 0,
    total: 0,
    cleared: 0,
    unitCount: 0,
    wordTotal: 0,
    progress: 0,
    showChest: false,
    chestDlg: null, // 宝箱球点击弹窗数据
    ultimateBall: null, // 线头终极宝箱
    showUltimate: false,
    ultimateDlg: null,
    ultimateDoubled: false, // 终极礼能量是否已看视频翻倍，每份礼仅一次
  }),

  onLoad(options) {
    const range = vp.init(this, options || {}, { maxVol: 7, minUnit: 1, noMixed: true });
    this.volV = range.v;
    this.loadData();
  },

  // 大地图只选册次：点册次立即重绘（无单元概念，不同于答题页）
  switchVol(e) {
    const v = Number(e.currentTarget.dataset.v);
    this.setData({ activeVol: v, volOpen: false });
    this.applyRange(v, 0);
  },

  // 页内换册次：重绘地图并同步首页大地图册次
  applyRange(v, u) {
    this.volV = v;
    wx.setStorageSync('home_vol', v);
    wx.setStorageSync('practice_vol', v);
    this.loadData();
  },

  loadData() {
    const all = levels;
    const volV = this.volV || 1;
    const globalIdx = [];
    all.forEach(function (lv, i) { if (lv.v === volV) globalIdx.push(i); });

    // 信息条：整本进度口径（已通关关数 / 单元数 / 总词数 / 百分比），全部按真实数据算
    let earned = 0;
    let maxStars = 0;
    let cleared = 0;
    let wordTotal = 0;
    const unitSet = {};
    globalIdx.forEach(function (gi) {
      const lv = all[gi];
      const star = storage.getStar(lv.id);
      earned += star;
      maxStars += 3;
      if (star > 0) cleared++;
      wordTotal += lv.w.length;
      unitSet[lv.u] = true;
    });
    const total = globalIdx.length;
    const progress = total ? Math.round(cleared * 100 / total) : 0;
    const unitCount = Object.keys(unitSet).length;

    // 4 个宝箱球：坐标已是卡片间隙中点的画布像素，直接用
    // cleared=该单元所有关卡是否都拿到星（即通关），用于点击时区分两态弹窗
    const chestBalls = CHEST_BALLS.map(function (f) {
      const unitLevels = globalIdx.filter(function (gi) { return all[gi].u === f.unit; });
      const cleared = unitLevels.length > 0 && unitLevels.every(function (gi) { return storage.getStar(all[gi].id) > 0; });
      const tierDef = storage.chestStatus().tiers[f.tier - 1] || {};
      let reward = '能量 +' + (tierDef.energy || 0);
      if (tierDef.shards) reward += ' · 碎片 +' + tierDef.shards;
      if (tierDef.freezes) reward += ' · 补签卡 +' + tierDef.freezes;
      reward += ' · 词卡';
      return {
        unit: f.unit,
        tier: f.tier,
        icon: f.icon,
        label: f.label,
        left: Math.round(f.left * SCALE),
        top: Math.round(f.top * SCALE),
        cleared: cleared,
        reward: reward,
        name: tierDef.name || f.label,
      };
    });

    // 线头终极宝箱：状态由 BOSS 关资格 + 是否已开箱决定
    let us = { claimed: false, qualified: false };
    try { if (storage.ultimateStatus) us = storage.ultimateStatus(); } catch (e) {}
    const ultimateBall = {
      left: ULTIMATE_BALL.left,
      top: ULTIMATE_BALL.top,
      claimed: us.claimed,
      qualified: us.qualified,
    };

    // 5 张单元卡片（U1-U4 + BOSS），点击进入章节流程页。
    // 软锁：所有关卡都能点进去练（不拦截），只做视觉标记——
    // 第一个未通关的非BOSS关=当前主线关（高亮），其余未通关标「自由练」并置灰。
    const cards = [];
    const firstUnclearedUnit = (function () {
      for (let u = 1; u <= 4; u++) {
        const list = globalIdx.filter(function (gi) { return all[gi].u === u; });
        if (!list.length) continue;
        const cleared = list.every(function (gi) { return storage.getStar(all[gi].id) > 0; });
        if (!cleared) return u;
      }
      return 0; // 4 个单元全通关
    })();
    for (let u = 1; u <= 4; u++) {
      const list = globalIdx.filter(function (gi) { return all[gi].u === u; });
      if (!list.length) continue;
      const words = list.reduce(function (s, gi) { return s + all[gi].w.length; }, 0);
      const stars = list.reduce(function (s, gi) { return s + storage.getStar(all[gi].id); }, 0);
      const max = list.length * 3;
      const pos = u - 1;
      const cy = CARD_Y[pos] * MAP_H;
      const done = stars > 0;
      const allCleared = list.every(function (gi) { return storage.getStar(all[gi].id) > 0; });
      cards.push({
        no: u,
        name: UNIT_NAMES[pos],
        badge: UNIT_BADGES[pos],
        words: words,
        stars: stars,
        max: max,
        pct: Math.round(stars / max * 100),
        done: done,
        allCleared: allCleared,
        current: !allCleared && u === firstUnclearedUnit,
        unit: u,
        boss: false,
        top: Math.round(cy * SCALE),
        side: cardSide(pos),
      });
    }
    cards.push({
      no: 5,
      name: 'BOSS·综测',
      badge: '👑',
      words: 0,
      stars: 0,
      max: 0,
      pct: 0,
      done: false,
      unit: 0,
      boss: true,
      top: Math.round(CARD_Y[4] * MAP_H * SCALE),
      side: cardSide(4),
    });

    this.setData({
      volName: VOL_NAMES[volV] || ('第' + volV + '册'),
      chestBalls: chestBalls,
      ultimateBall: ultimateBall,
      cards: cards,
      earned: earned,
      maxStars: maxStars,
      total: total,
      cleared: cleared,
      unitCount: unitCount,
      wordTotal: wordTotal,
      progress: progress,
    });
  },

  onShow() { if (this.volV) this.loadData(); },

  // 卡片 -> 章节流程页（5 步闯关），带上当前册次
  openUnit(e) {
    const unit = Number(e.currentTarget.dataset.unit);
    if (unit === 0) {
      wx.navigateTo({ url: '/pages/context/context' });
      return;
    }
    wx.navigateTo({ url: '/pages/chapter/chapter?v=' + (this.volV || 1) + '&u=' + unit });
  },

  // 宝箱球 -> 两态弹窗：已通关显示已得奖励，未通关显示神秘礼物预告（只展示，不重复发奖）
  openChest(e) {
    const unit = Number(e.currentTarget.dataset.unit);
    const ball = this.data.chestBalls.filter(function (b) { return b.unit === unit; })[0] || {};
    const dlg = ball.cleared
      ? {
          win: true, unit: unit, icon: ball.icon, name: ball.name,
          title: '闯关成功！',
          rows: [
            { icon: '🏅', text: '获得勋章：词汇新星' },
            { icon: '🎁', text: '已得奖励：' + ball.reward },
          ],
        }
      : {
          win: false, unit: unit, icon: '🎁', name: ball.label,
          title: '闯关未成功',
          rows: [
            { icon: '🔒', text: '神秘礼物：通关后揭晓' },
            { icon: '💡', text: '提示：闯完本单元即可开箱' },
          ],
        };
    this.setData({ showChest: true, chestDlg: dlg });
  },

  closeChest() { this.setData({ showChest: false }); },

  // 线头终极宝箱：三态
  // 1) 未解锁 → "闯关未成功"提示，去打 BOSS 关
  // 2) 已解锁未开 → "终极宝箱已解锁"，点开箱才真正领奖
  // 3) 已开箱 → 回看已得奖励，不重复发
  openUltimate() {
    const ball = this.data.ultimateBall || {};
    let dlg;
    if (ball.claimed) {
      dlg = {
        state: 'claimed', win: true,
        title: '词林王者 · 已毕业',
        rows: [
          { icon: '👑', text: '已解锁：词林王冠装扮' },
          { icon: '🃏', text: '已获得：史诗词卡 ×3' },
          { icon: '⚡', text: '已获得：能量 +50 · 补签卡 +2' },
        ],
      };
    } else if (ball.qualified) {
      dlg = {
        state: 'ready', win: true,
        title: '终极宝箱已解锁！',
        rows: [
          { icon: '🏅', text: '称号：词林王者' },
          { icon: '👑', text: '装扮：词林王冠（宠物可穿戴）' },
          { icon: '🃏', text: '史诗词卡 ×3（保底史诗）' },
          { icon: '⚡', text: '能量 +50 · 补签卡 +2' },
        ],
      };
    } else {
      dlg = {
        state: 'locked', win: false,
        title: '闯关未成功',
        rows: [
          { icon: '🔒', text: '神秘礼物：BOSS 关满星后揭晓' },
          { icon: '💡', text: '提示：语境辨析关 15 题全对即可解锁' },
        ],
      };
    }
    this.setData({ showUltimate: true, ultimateDlg: dlg });
  },

  // 真正开箱：此时才调用 claimUltimate 发奖，之后刷新地图状态
  claimUltimateChest() {
    const dlg = this.data.ultimateDlg || {};
    if (dlg.state !== 'ready') return;
    let result = null;
    try {
      // 词表从主包 levels.js 取（语境数据已迁分包，开箱不能依赖分包加载）
      const lv = require('../../data/levels.js');
      const words = [];
      lv.forEach(function (row) {
        (row.w || []).forEach(function (x) { if (x && x[0]) words.push({ w: x[0], p: x[1] || '', m: x[2] || '' }); });
      });
      result = storage.claimUltimate(words);
    } catch (e) {}
    if (!result) { this.setData({ showUltimate: false }); this.loadData(); return; }
    this.setData({
      ultimateDoubled: false,
      ultimateDlg: {
        state: 'opened', win: true,
        title: '🎉 毕业礼已领取！',
        rows: [
          { icon: '👑', text: '解锁装扮：词林王冠，去宠物页穿戴' },
          { icon: '🃏', text: '史诗词卡 ×3 已入册：' + result.cards.map(function (c) { return c.w; }).join('、') },
          { icon: '⚡', text: '能量 +50 · 补签卡 +2 已到账' },
        ],
      },
    });
    this.loadData(); // 刷新球状态为 claimed，返回后显示回看态
  },

  // 看视频 · 终极礼能量翻倍：只翻能量 +50 → 累计 +100。
  // 王冠、3 张史诗词卡、2 张补签卡都不翻；每份毕业礼只能翻一次。
  doubleUltimateByAd() {
    const dlg = this.data.ultimateDlg || {};
    if (dlg.state !== 'opened' || this.data.ultimateDoubled) return;
    const self = this;
    ad.show('bonus', function () {
      const bonus = storage.doubleUltimateReward();
      if (!bonus) { ui.notify(self, '这份毕业礼已经翻倍过了'); return; }
      let hit = false;
      const rows = (dlg.rows || []).map(function (r) {
        if (r.icon === '⚡') {
          hit = true;
          return { icon: '⚡', text: '能量 +50 → +100（看视频翻倍）· 补签卡 +2 已到账' };
        }
        return r;
      });
      if (!hit) rows.push({ icon: '⚡', text: '能量 +50 → +100（看视频翻倍）已到账' });
      self.setData({
        ultimateDoubled: true,
        ultimateDlg: Object.assign({}, dlg, { rows: rows }),
      });
      ui.notify(self, '能量已翻倍！');
    }, function () {
      ui.notify(self, '当前环境暂不支持广告');
    });
  },

  closeUltimate() { this.setData({ showUltimate: false }); },

  ultimateGoBattle() {
    this.setData({ showUltimate: false });
    wx.navigateTo({ url: '/pages/context/context' });
  },
  ultimateGoCards() {
    this.setData({ showUltimate: false });
    wx.navigateTo({ url: '/pages/cards/cards' });
  },
  ultimateGoPet() {
    this.setData({ showUltimate: false });
    wx.switchTab({ url: '/pages/pet/pet' });
  },

  // 弹窗内三个操作：继续闯关 / 查看词卡 / 返回
  chestGoBattle() {
    const unit = this.data.chestDlg.unit;
    this.setData({ showChest: false });
    wx.navigateTo({ url: '/pages/chapter/chapter?v=' + (this.volV || 1) + '&u=' + unit });
  },
  chestGoCards() {
    this.setData({ showChest: false });
    wx.navigateTo({ url: '/pages/cards/cards' });
  },

  backHome() { wx.navigateBack(); },
}));
