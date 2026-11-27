// 星际词卡统一加载器
// - 必修一 v=1 的完整人工词卡随主包（local）
// - 其余册词卡在分包 A/B，按需异步加载并注册进内存缓存
// - 对外：get(w) 同步取；ensure(v, cb) 确保某册数据已加载；hasData(w) 是否有词卡
const localDetails = require('../data/word_details.js');
const levels = require('../data/levels.js');
// 主包精简丰富词卡：2797 词的搭配(含中文)+同义词，预览卡环境不依赖分包也能看到
const richLite = require('../data/rich_lite.js');
// 人工逐册核对的固定搭配补充：只补 richLite 里还没有搭配的词
const collAdd = require('../data/coll_add.js');

// 册次 -> 分包数据路径（相对本文件）
const PKG_OF = {};
[2, 3, 4, 5, 6, 7, 9].forEach(function (v) { PKG_OF[v] = '../pkgWordA/data/details.js'; });
PKG_OF[8] = '../pkgWordB/data/details.js';

const cache = {};        // w -> detail 对象（人工/分包丰富词卡）
const basic = {};        // w -> 基础词卡兜底（来自 levels.js，主包内，任何环境都有）
const loadedPkg = {};     // 分包路径 -> true
const loadingPkg = {};    // 分包路径 -> [cb]

// 全册关卡词表本身带 [单词, 音标, 中文释义]，在主包里。
// 即使预览环境加载不了分包，也要保证每个词都能开出一张至少含释义的词卡。
levels.forEach(function (lv) {
  (lv.w || []).forEach(function (row) {
    if (!row || !row[0] || basic[row[0]]) return;
    basic[row[0]] = {
      w: row[0], p: row[1] || '', cn: row[2] || '', en: '',
      collocations: [], synonyms: [], source: '基础词卡', _basic: true,
    };
  });
});

// 紧凑数组 -> 展示对象
function expand(row) {
  if (!row || !row[0]) return null;
  return {
    w: row[0],
    p: row[1] || '',
    cn: row[2] || '',
    en: row[3] || '',
    collocations: (row[4] || []).map(function (c) { return { en: c[0], cn: c[1] }; }),
    synonyms: row[5] || [],
    source: 'ECDICT(MIT) · 词表 · 人工核对',
  };
}

// 注册主包本地数据（启动时）
Object.keys(localDetails).forEach(function (k) { cache[k] = localDetails[k]; });

// 精简串解包："搭配EN=中文|搭配EN=中文" / "同义1,同义2"
function expandLite(w, collStr, synStr) {
  const collocations = String(collStr || '').split('|').map(function (x) {
    if (!x) return null;
    const p = x.indexOf('=');
    return p < 0 ? { en: x, cn: '' } : { en: x.slice(0, p), cn: x.slice(p + 1) };
  }).filter(Boolean);
  const synonyms = String(synStr || '').split(',').filter(Boolean);
  return {
    w: w, p: '', cn: '', en: '',
    collocations: collocations, synonyms: synonyms,
    source: 'ECDICT(MIT) · 词表 · 人工核对',
  };
}
// 精简数据补进 cache：不覆盖已有人工词卡；把基础兜底升级为带搭配/同义词
richLite.forEach(function (r) {
  const w = r[0];
  if (!w || (cache[w] && !cache[w]._basic)) return;
  cache[w] = expandLite(w, r[1], r[2]);
});
// 精简数据没有音标/中文释义，从 levels 索引补回，保证展示完整
levels.forEach(function (lv) {
  (lv.w || []).forEach(function (row) {
    if (!row || !row[0] || !cache[row[0]]) return;
    if (!cache[row[0]].cn) cache[row[0]].cn = row[2] || '';
    if (!cache[row[0]].p) cache[row[0]].p = row[1] || '';
  });
});

// 人工搭配补充：只给还没有搭配的词补，已有的不覆盖（人工优先）
Object.keys(collAdd).forEach(function (vk) {
  const dict = collAdd[vk] || {};
  Object.keys(dict).forEach(function (w) {
    if (!w) return;
    const d = cache[w];
    if (d && (d.collocations || []).length) return; // 已有搭配，跳过
    const added = expandLite(w, dict[w], '').collocations;
    if (d && !d._basic) {
      d.collocations = added;
    } else {
      const base = (basic[w] || {});
      cache[w] = {
        w: w, p: base.p || '', cn: base.cn || '', en: '',
        collocations: added, synonyms: (d && d.synonyms) || [],
        source: '人工核对搭配',
      };
    }
  });
});

function registerRows(rows) {
  if (!Array.isArray(rows)) return;
  rows.forEach(function (row) {
    const w = row && row[0];
    if (!w) return;
    // 已有人工核对/丰富数据优先；基础兜底可以被丰富数据覆盖
    if (cache[w] && !cache[w]._basic) return;
    cache[w] = expand(row);
  });
}

function loadPkg(path, done) {
  if (loadedPkg[path]) { done(true); return; }
  if (loadingPkg[path]) { loadingPkg[path].push(done); return; }
  loadingPkg[path] = [done];
  try {
    require(path, function (mod) {
      if (mod) registerRows(mod);
      loadedPkg[path] = true;
      const cbs = loadingPkg[path] || [];
      delete loadingPkg[path];
      cbs.forEach(function (cb) { cb(true); });
    }, function () {
      const cbs = loadingPkg[path] || [];
      delete loadingPkg[path];
      cbs.forEach(function (cb) { cb(false); });
    });
  } catch (e) {
    // 分包不可用时（如预览环境），静默降级：词卡入口不显示，不影响答题
    const cbs = loadingPkg[path] || [];
    delete loadingPkg[path];
    cbs.forEach(function (cb) { cb(false); });
  }
}

module.exports = {
  // 同步取词卡：丰富词卡优先，没有就用主包基础词卡兜底
  get: function (w) { return (w && (cache[w] || basic[w])) || null; },

  // 是否已有某词的词卡数据（基础词卡也算有）
  hasData: function (w) { return !!(w && (cache[w] || basic[w])); },

  // 当前是否只是基础兜底（用于后台继续加载丰富词卡）
  isBasic: function (w) { return !!(w && (!cache[w] || cache[w]._basic) && basic[w]); },

  // 确保某册数据加载完成（幂等）；cb(success)
  ensure: function (v, cb) {
    const path = PKG_OF[Number(v)];
    if (!path) { if (cb) cb(false); return; }
    loadPkg(path, function (ok) { if (cb) cb(ok); });
  },

  // 预加载某册（无回调）
  preload: function (v) { this.ensure(v, function () {}); },
};
