// 共享「册次 + 单元范围」选择器：打地鼠/单词拼图/大地图页共用。
// 用法：
//   const vp = require('../../utils/volPicker.js');
//   Page(Object.assign({}, vp.behavior, {
//     data: Object.assign({}, vp.data(), { /* 本页字段 */ }),
//     onLoad(o) { vp.init(this, o); ... },
//     applyRange(v, u) { /* 本页按新范围重新出题 */ },
//   }));
// 注意：WXML 选择器已改为各页内联（预览卡对 <import>/<template> 渲染不可靠），
//       本模块只提供 data/behavior 逻辑，样式在 app.wxss 的 .vol-* 全局类。
const levels = require('../data/levels.js');

const VOL_NAMES = ['必修一', '必修二', '必修三', '选择性必修一', '选择性必修二', '选择性必修三', '选择性必修四', '高考3500', '真题高频'];

function buildCatalog() {
  const volumes = [];
  for (let v = 1; v <= 9; v++) {
    const idxs = [];
    for (let i = 0; i < levels.length; i++) if (levels[i].v === v) idxs.push(i);
    volumes.push({ v: v, name: VOL_NAMES[v - 1], count: idxs.length, special: v >= 8 });
  }
  const volGroups = [
    { title: '必修课', hint: '译林 · 第一至三册', items: volumes.slice(0, 3) },
    { title: '选择性必修课', hint: '译林 · 第一至四册', items: volumes.slice(3, 7) },
    { title: '高考冲刺', hint: '真题与高频词', items: volumes.slice(7, 9) },
  ];
  return { volumes: volumes, volGroups: volGroups };
}

function unitsOf(v) {
  const seen = {};
  const opts = [{ u: 0, name: '整册混合' }];
  for (let i = 0; i < levels.length; i++) {
    const lv = levels[i];
    if (lv.v !== v || !lv.u || seen[lv.u]) continue;
    seen[lv.u] = 1;
    opts.push({ u: lv.u, name: 'Unit ' + lv.u });
  }
  return opts;
}

// 页内选择器 data：注意只放选择器字段，业务字段由页面自己合入
function data() {
  const cat = buildCatalog();
  return {
    volumes: cat.volumes,
    volGroups: cat.volGroups,
    activeVol: 1,
    activeUnit: 0,
    unitOptions: unitsOf(1),
    volOpen: false,
  };
}

// 初始化：优先用传入的 v/u，其次用 storage，最后默认必修一整册
function init(page, options, opts) {
  const o = options || {};
  const cfg = opts || {};
  const storedV = Number(wx.getStorageSync('practice_vol')) || 1;
  const rawV = Number(o.v) || 0;
  const inV = (rawV >= 1 && rawV <= 9) ? rawV : 0;
  let v = inV || ((storedV >= 1 && storedV <= 9) ? storedV : 1);
  // 章节页只支持 1~7 册（大地图口径），8/9 是平铺词库无单元
  if (cfg.maxVol) v = Math.min(v, cfg.maxVol);
  let optsU = unitsOf(v);
  // 章节页按单元闯关，不支持"整册混合"
  if (cfg.noMixed) optsU = optsU.filter(function (x) { return x.u !== 0; });
  const valid = function (u) {
    for (let i = 0; i < optsU.length; i++) if (optsU[i].u === u) return true;
    return false;
  };
  const storedU = Number(wx.getStorageSync('practice_unit'));
  let u = Number(o.u);
  if (!valid(u)) u = valid(storedU) ? storedU : (cfg.minUnit || 0);
  page._vpCfg = cfg;
  page.setData({
    activeVol: v,
    activeUnit: u,
    unitOptions: optsU,
    volOpen: false,
  });
  return { v: v, u: u };
}

function toggleVolMenu() { this.setData({ volOpen: !this.data.volOpen }); }
function closeVolMenu() { this.setData({ volOpen: false }); }

function switchVol(e) {
  const v = Number(e.currentTarget.dataset.v);
  let opts = unitsOf(v);
  const cfg = this._vpCfg || {};
  if (cfg.noMixed) opts = opts.filter(function (x) { return x.u !== 0; });
  const unit = opts.length ? opts[0].u : 0;
  // 选册次不收起，让用户接着选出题范围
  this.setData({ activeVol: v, unitOptions: opts, activeUnit: unit });
}

function switchUnit(e) {
  const u = Number(e.currentTarget.dataset.u);
  // 范围选定才收起，并让本页用新范围重出题
  this.setData({ activeUnit: u, volOpen: false });
  wx.setStorageSync('practice_vol', this.data.activeVol);
  wx.setStorageSync('practice_unit', u);
  if (typeof this.applyRange === 'function') {
    this.applyRange(this.data.activeVol, u);
  }
}

const behavior = {
  toggleVolMenu: toggleVolMenu,
  closeVolMenu: closeVolMenu,
  switchVol: switchVol,
  switchUnit: switchUnit,
};

module.exports = {
  data: data,
  init: init,
  behavior: behavior,
  unitsOf: unitsOf,
  VOL_NAMES: VOL_NAMES,
};
