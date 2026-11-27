const storage = require('../../utils/storage.js');

// 「我的」Tab：宠物养成 + 装扮 + 图鉴 + 成长汇总。答题得成长值自动进化，能量喂食涨亲密。
Page({
  data: {
    pet: null,
    tab: 'home',        // home | gallery | equip
    equip: null,        // 装备面板数据
    showEvolve: false,  // 进化弹窗
    evolve: null,
    showRename: false,
    renameValue: '',
    toast: '',
    totalStars: 0,
    streak: 0,
    badgeEarned: 0,
    badgeTotal: 0,
    collected: 0,
    cardTotal: 0,
    // 新伙伴计划：只点亮"方向"，不承诺具体某个宠物一定上线，避免落空失望。纯本地记录。
    // open 控制分组折叠，默认全收起，点标题展开/收起。
    wishGroups: [
      { key: 'pets', title: '🦉 新伙伴', open: false, items: [
        { id: 'pet_dragon', icon: '🐉', name: '神话伙伴', on: false },
        { id: 'pet_fox',    icon: '🦊', name: '森林伙伴', on: false },
        { id: 'pet_panda',  icon: '🐼', name: '国宝伙伴', on: false },
      ]},
      { key: 'gear', title: '🎀 新装扮', open: false, items: [
        { id: 'gear_wing',  icon: '✨', name: '翅膀装扮', on: false },
        { id: 'gear_wand',  icon: '🔮', name: '魔法道具', on: false },
        { id: 'gear_season', icon: '🎐', name: '节日套装', on: false },
      ]},
      { key: 'play', title: '🎮 新玩法', open: false, items: [
        { id: 'play_mood',  icon: '💬', name: '宠物心情', on: false },
        { id: 'play_story', icon: '📖', name: '冒险剧情', on: false },
        { id: 'play_egg',   icon: '🥚', name: '盲盒宠物', on: false },
      ]},
    ],
    wishCount: 0,
  },

  onShow() {
    this.refresh();
    // 检测进化（答题后回到本页面时触发）
    const evo = storage.checkEvolution();
    if (evo) {
      this.setData({ showEvolve: true, evolve: evo });
    }
  },

  refresh() {
    const bs = storage.badgeCount();
    const wishes = storage.getWishes();
    // 按本地记录重建心愿点亮态（只反映这台设备，无排行无日期）
    const groups = this.data.wishGroups.map(function (g) {
      return {
        key: g.key,
        title: g.title,
        open: g.open,   // 保留展开/收起状态，点亮心愿后不会被重新收起
        items: g.items.map(function (it) {
          return Object.assign({}, it, { on: !!wishes[it.id] });
        }),
      };
    });
    this.setData({
      pet: storage.petInfo(),
      equip: storage.equipStatus(),
      totalStars: storage.totalStars(),
      streak: storage.streakDays(),
      badgeEarned: bs.earned,
      badgeTotal: bs.total,
      collected: storage.collectedCount(),
      cardTotal: storage.drawStatus().total,
      wishGroups: groups,
      wishCount: storage.wishCount(),
    });
  },

  // 分组折叠：点分组标题展开/收起，只动 UI 状态不碰存储
  toggleGroup(e) {
    const key = e.currentTarget.dataset.key;
    const groups = this.data.wishGroups.map(function (g) {
      if (g.key === key) return Object.assign({}, g, { open: !g.open });
      return g;
    });
    this.setData({ wishGroups: groups });
  },

  // 点亮/取消一个心愿：只改本地记录，给个轻提示确认
  toggleWish(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    const on = storage.toggleWish(id);
    this.refresh();
    this.showToast(on ? ('已点亮「' + name + '」的心愿 ✨') : ('已取消「' + name + '」'));
  },

  // 页内切换（注意：这是页面内 tab，不是微信 TabBar）
  switchPetTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  // 合成装扮：消耗碎片解锁
  craft(e) {
    const id = e.currentTarget.dataset.id;
    const res = storage.craftEquip(id);
    this.showToast(res.msg);
    if (res.ok) this.refresh();
  },

  // 穿戴/卸下装扮（同槽位互斥）
  wear(e) {
    const id = e.currentTarget.dataset.id;
    const res = storage.toggleEquip(id);
    this.showToast(res.msg);
    if (res.ok) this.refresh();
  },

  // 喂食：消耗3能量，亲密+1
  feed() {
    const res = storage.feedPet();
    this.showToast(res.msg);
    if (res.ok) this.refresh();
  },

  // 去复习：到期词复习完，宠物自然吃饱
  goReview() {
    wx.navigateTo({ url: '/pages/review/review' });
  },

  // 托管模式：假期免打扰，饥饿提示变温和、不做惩罚
  onVacMode() {
    const on = storage.toggleVacMode();
    this.showToast(on ? '托管已开启，假期慢慢来' : '托管已关闭');
    this.refresh();
  },

  // 改名弹窗
  openRename() {
    this.setData({ showRename: true, renameValue: this.data.pet.name });
  },
  onRenameInput(e) {
    this.setData({ renameValue: e.detail.value });
  },
  closeRename() {
    this.setData({ showRename: false });
  },
  confirmRename() {
    const ok = storage.renamePet(this.data.renameValue);
    if (ok) {
      this.showToast('改名成功');
      this.refresh();
    } else {
      this.showToast('名字不能为空');
    }
    this.setData({ showRename: false });
  },

  closeEvolve() {
    this.setData({ showEvolve: false });
  },

  // 去闯关：直接进入大地图关卡（跟随当前册次），不再回首页
  goPlay() {
    const v = Number(wx.getStorageSync('home_vol'));
    wx.navigateTo({ url: '/pages/map/map?v=' + (v >= 1 && v <= 7 ? v : 1) });
  },

  // 成长汇总入口
  openAchieve() { wx.navigateTo({ url: '/pages/achieve/achieve' }); },
  openCards() { wx.navigateTo({ url: '/pages/cards/cards' }); },

  showToast(msg) {
    this.setData({ toast: msg });
    const self = this;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(function () { self.setData({ toast: '' }); }, 1800);
  },
});
