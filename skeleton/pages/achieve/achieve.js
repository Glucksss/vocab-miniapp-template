const storage = require('../../utils/storage.js');

Page({
  data: {
    tab: 'badge',       // badge | book
    badges: [],
    badgeStat: null,
    collected: [],
    collectedCount: 0,
    filter: '',
    shown: [],
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const all = storage.getCollected();
    const earned = storage.checkBadges();
    this.allCollected = all;
    this.setData({
      badges: storage.getBadges(),
      badgeStat: storage.badgeCount(),
      collected: all.slice(0, 60),
      collectedCount: all.length,
      shown: all.slice(0, 60),
      newBadges: earned,
    });
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  onFilter(e) {
    const key = String(e.detail.value || '').trim().toLowerCase();
    const list = this.allCollected.filter(function (x) {
      return !key || x.w.toLowerCase().indexOf(key) >= 0 || x.m.indexOf(key) >= 0;
    });
    this.setData({ filter: key, shown: list.slice(0, 100) });
  },

  backHome() { wx.navigateBack(); },
});
