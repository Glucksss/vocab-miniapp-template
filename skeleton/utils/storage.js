// 本地存储工具：进度、星级、错词本、最高分
const KEY = 'vocab_quest_v1';

const DEFAULT = {
  stars: {},        // levelId -> 1/2/3
  wrong: [],        // 错词数组 [{w,p,m,from}]
  best: {},         // 玩法最高分 {timed: n, ...}
  stats: { totalRight: 0, totalWrong: 0, days: [], lastPlay: '' },
  // 遗忘曲线：word -> { stage:0-4, due:'YYYY-MM-DD', seen:n, right:n }
  review: {},
  // 单词图鉴：word -> { p, m, n }  记录见过/答过的词
  collected: {},
  // 玩法累计：{ game:n, spell:n, timed:n, boss:n, context:n, review:n }
  plays: {},
  // 已解锁成就 id 列表
  badges: [],
  // Streak 保护：补签卡 + 历史最长
  freezes: 0,       // 补签卡数量（上限3）
  streakBest: 0,    // 历史最长连续天数
  wrongSinceFreeze: 0, // 距上次发补签卡的答错数，满3给1张
  // 每日盲盒抽卡：cards[word]={r,date}，dailyDraw={date,count}
  cards: {},
  dailyDraw: { date: '', count: 0 },
  // 宠物养成：答题得成长值自动进化，能量可喂食涨亲密
  pet: { name: '小枭', exp: 0, energy: 0, bond: 0, fed: 0, lastFeed: '', seenStage: 0 },
  // 通关宝箱：每通关一个单元开一次，逐档升级（非赌博，确定性奖励）
  chest: { drawn: 0, shards: 0, history: [] },
  // 装备系统：碎片合成装扮，穿戴后轻微提升能量产出（只给效率，不给准入门槛）
  // owned=已解锁装扮id，worn=当前穿戴id（每槽位互斥），bonusPts=能量加成小数累积
  equip: { owned: [], worn: [], bonusPts: 0 },
  // Boss 终极奖励：全 app 唯一一次。
  // qualified=BOSS关满星已解锁资格（还没开箱），claimed=已在地图开箱领取
  ultimate: { claimed: false, qualified: false, date: '' },
  // 心愿清单：用户点亮"期待后续上线"的内容 id -> true。
  // 纯本地记录，只反映这台设备这个用户的心愿；不做排行、不统计、不承诺日期。
  wishes: {},
  // 错词清剿：三遍过滤进度。cleanPass[word]=0-2（三遍各答对一次即划掉），
  // cleanStreak[word]=连续几局没清掉（>=2 为顽固词，下次优先出现）。
  cleanPass: {},
  cleanStreak: {},
  // 每日能量加成额度：date=哪天，used=当天已享受+1加成的答对数，expanded=当天看视频扩容次数。
  // 软额度：额度内答对能量+2，用完恢复+1（不锁学习、不惩罚）。看视频每次+10题，每天最多5次。
  dailyBonus: { date: '', used: 0, expanded: 0 },
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = wx.getStorageSync(KEY);
    const fresh = JSON.parse(JSON.stringify(DEFAULT));
    cache = raw ? Object.assign(fresh, raw) : fresh;
    if (!cache.stats) cache.stats = JSON.parse(JSON.stringify(DEFAULT.stats));
    if (!cache.dailyDraw) cache.dailyDraw = { date: '', count: 0 };
    if (!cache.pet) cache.pet = JSON.parse(JSON.stringify(DEFAULT.pet));
    if (!cache.chest) cache.chest = JSON.parse(JSON.stringify(DEFAULT.chest));
    // 老存档兼容：补齐装备字段（含可能存在的残缺结构）
    if (!cache.equip) cache.equip = JSON.parse(JSON.stringify(DEFAULT.equip));
    if (!Array.isArray(cache.equip.owned)) cache.equip.owned = [];
    if (!Array.isArray(cache.equip.worn)) cache.equip.worn = [];
    if (typeof cache.equip.bonusPts !== 'number') cache.equip.bonusPts = 0;
    if (!cache.ultimate) cache.ultimate = JSON.parse(JSON.stringify(DEFAULT.ultimate));
    if (typeof cache.ultimate.qualified !== 'boolean') cache.ultimate.qualified = false;
    // 老存档兼容：心愿清单字段
    if (!cache.wishes || typeof cache.wishes !== 'object' || Array.isArray(cache.wishes)) cache.wishes = {};
    // 老存档兼容：错词清剿进度字段
    if (!cache.cleanPass || typeof cache.cleanPass !== 'object' || Array.isArray(cache.cleanPass)) cache.cleanPass = {};
    if (!cache.cleanStreak || typeof cache.cleanStreak !== 'object' || Array.isArray(cache.cleanStreak)) cache.cleanStreak = {};
    // 老存档兼容：每日能量加成额度字段
    if (!cache.dailyBonus || typeof cache.dailyBonus !== 'object' || Array.isArray(cache.dailyBonus)) {
      cache.dailyBonus = JSON.parse(JSON.stringify(DEFAULT.dailyBonus));
    }
  } catch (e) {
    cache = Object.assign({}, DEFAULT);
  }
  return cache;
}

// 防抖写入：一次答题会改多处(addStat/addWrong/recordReview)，
// 若每次都全量序列化大数据(几千词的review/collected)会阻塞主线程造成卡顿。
// 合并成一次延迟写入，显著减少 setStorageSync 次数。
let _saveTimer = null;
let _dirty = false;

function saveNow() {
  if (!_dirty && !cache) return;
  try {
    wx.setStorageSync(KEY, cache);
    _dirty = false;
  } catch (e) {}
}

function save() {
  _dirty = true;
  if (_saveTimer) return;
  _saveTimer = setTimeout(function () {
    _saveTimer = null;
    saveNow();
  }, 200);
}

// 页面隐藏/卸载时强制落盘，避免防抖窗口内丢数据
function flush() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  saveNow();
}

function init() {
  load();
  const today = formatDate(new Date());
  if (cache.stats.lastPlay === today) return;

  // 断签检测：若昨天没来，且有补签卡，自动消耗1张补上昨天
  const yesterday = addDays(today, -1);
  const days = cache.stats.days || [];
  if (days.indexOf(yesterday) < 0 && days.length > 0 && (cache.freezes || 0) > 0) {
    // 只有"刚好断1天"才补签，断多天不补（防止滥用）
    const last = days[days.length - 1];
    if (last === addDays(yesterday, -1)) {
      cache.freezes--;
      days.push(yesterday);
      cache.lastFreezeUse = today;
    }
  }

  days.push(today);
  if (days.length > 60) days.shift();
  cache.stats.days = days;
  cache.stats.lastPlay = today;
  // 更新历史最长连续天数
  const cur = streakDays();
  if (cur > (cache.streakBest || 0)) cache.streakBest = cur;
  save();
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// 关卡星级：取最高
function setStar(levelId, star) {
  const d = load();
  if (!d.stars[levelId] || star > d.stars[levelId]) {
    d.stars[levelId] = star;
    save();
  }
}

function getStar(levelId) {
  return load().stars[levelId] || 0;
}

function totalStars() {
  const s = load().stars;
  let n = 0;
  for (const k in s) n += s[k];
  return n;
}

// 错词本
function addWrong(word) {
  const d = load();
  const exist = d.wrong.findIndex(function (x) { return x.w === word.w; });
  if (exist >= 0) {
    d.wrong[exist].n = (d.wrong[exist].n || 1) + 1;
  } else {
    d.wrong.push({ w: word.w, p: word.p || '', m: word.m || '', n: 1 });
  }
  save();
}

function removeWrong(wordText) {
  const d = load();
  d.wrong = d.wrong.filter(function (x) { return x.w !== wordText; });
  save();
}

function getWrong() {
  return load().wrong || [];
}

function wrongCount() {
  return getWrong().length;
}

// 最高分
function setBest(key, score) {
  const d = load();
  if (!d.best[key] || score > d.best[key]) {
    d.best[key] = score;
    save();
    return true;
  }
  return false;
}

function getBest(key) {
  return load().best[key] || 0;
}

function addStat(right, wrong) {
  const d = load();
  d.stats.totalRight += right || 0;
  d.stats.totalWrong += wrong || 0;
  save();
}

function getStats() {
  return load().stats;
}

// 连续打卡天数（从今天或昨天往前数）
function streakDays() {
  const days = load().stats.days || [];
  if (days.length === 0) return 0;
  const set = {};
  days.forEach(function (d) { set[d] = true; });
  const today = new Date();
  // 若今天没打卡，从昨天开始算
  const cursor = new Date(today);
  if (!set[formatDate(cursor)]) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (set[formatDate(cursor)]) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// 最近7天周报 [{day, label, count}]，count 用当天答题数的近似（按 days 存在次数无法细分，改返回是否打卡）
function weeklyReport() {
  const days = load().stats.days || [];
  const set = {};
  days.forEach(function (d) { set[d] = true; });
  const week = [];
  const names = ['日', '一', '二', '三', '四', '五', '六'];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = formatDate(d);
    week.push({ key: key, label: names[d.getDay()], active: !!set[key] });
  }
  return week;
}

// 正确率
function accuracy() {
  const s = load().stats;
  const total = s.totalRight + s.totalWrong;
  if (total === 0) return 0;
  return Math.round(s.totalRight * 100 / total);
}

// ========== 遗忘曲线复习 ==========
// 复习间隔（天）：答对推进阶段，答错回到阶段0
const REVIEW_GAP = [1, 2, 4, 7, 15];

function addDays(dateStr, days) {
  const parts = dateStr.split('-');
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

// 每日能量加成额度：惰性跨天重置。
// quota = 基础10题 + 看视频扩容次数×10；used 只统计"答对并享受加成"的题。
function bonusState(d) {
  const today = formatDate(new Date());
  if (!d.dailyBonus || typeof d.dailyBonus !== 'object' || d.dailyBonus.date !== today) {
    d.dailyBonus = { date: today, used: 0, expanded: 0 };
  }
  return {
    ref: d.dailyBonus, // 直接引用存档对象，改动后才能随 save() 落盘
    date: today,
    used: d.dailyBonus.used || 0,
    expanded: d.dailyBonus.expanded || 0,
    quota: 10 + (d.dailyBonus.expanded || 0) * 10,
    expandLeft: Math.max(0, 5 - (d.dailyBonus.expanded || 0)),
  };
}

// 记录一次答题结果，更新复习排期 + 图鉴收集
function recordReview(word, right) {
  if (!word || !word.w) return;
  const d = load();
  const today = formatDate(new Date());
  const key = word.w;
  const item = d.review[key] || { stage: 0, due: today, seen: 0, right: 0 };
  item.seen = (item.seen || 0) + 1;
  if (right) {
    item.right = (item.right || 0) + 1;
    item.stage = Math.min((item.stage || 0) + 1, REVIEW_GAP.length - 1);
  } else {
    item.stage = 0;
    // 答错累计：每错3题送1张补签卡（上限3），保护 streak
    d.wrongSinceFreeze = (d.wrongSinceFreeze || 0) + 1;
    if (d.wrongSinceFreeze >= 3) {
      d.wrongSinceFreeze = 0;
      d.freezes = Math.min((d.freezes || 0) + 1, 3);
    }
  }
  item.due = addDays(today, REVIEW_GAP[item.stage]);
  d.review[key] = item;

  // 图鉴收集：记录见过的词与释义
  if (!d.collected[key]) {
    d.collected[key] = { p: word.p || '', m: word.m || '', n: 0 };
  }
  d.collected[key].n = (d.collected[key].n || 0) + 1;

  // 宠物成长与能量：都只奖励"答对"。答错不涨成长、不加能量——
  // 成长值代表"真正学会的词"，乱答也能进化宠物会让成长失去意义。
  // 答错照样进错词本、重排遗忘计划、累计补签卡（见上方分支），靠这些软机制补偿体验。
  if (!d.pet) d.pet = JSON.parse(JSON.stringify(DEFAULT.pet));
  if (right) {
    d.pet.exp = (d.pet.exp || 0) + 3;
    // 基础能量 +1（学习是唯一铸币厂）；每日加成额度内再多 +1。
    // 额度用完恢复 +1，不锁学习、不惩罚；成长值/错词/补签/星级逻辑一概不碰。
    const b = bonusState(d);
    let extra = 0;
    if (b.used < b.quota) { b.ref.used = b.used + 1; extra = 1; }
    d.pet.energy = (d.pet.energy || 0) + 1 + extra;
    // 装扮加成：把穿戴的百分比累积到 bonusPts，攒满 100 额外多给 1 点。
    // 只放大"答题产出"，不凭空造能量，符合"只给效率、不给准入门槛"。
    const bonus = equipBonus();
    if (bonus > 0) {
      if (!d.equip) d.equip = JSON.parse(JSON.stringify(DEFAULT.equip));
      d.equip.bonusPts = (d.equip.bonusPts || 0) + bonus;
      while (d.equip.bonusPts >= 100) {
        d.equip.bonusPts -= 100;
        d.pet.energy = (d.pet.energy || 0) + 1;
      }
    }
  }
  save();
}

// 今日待复习词（due <= 今天），按到期时间排序
function dueWords() {
  const d = load();
  const today = formatDate(new Date());
  const list = [];
  Object.keys(d.review).forEach(function (w) {
    const item = d.review[w];
    if (item && item.due && item.due <= today) {
      list.push({
        w: w,
        p: d.collected[w] ? d.collected[w].p : '',
        m: d.collected[w] ? d.collected[w].m : '',
        stage: item.stage,
        seen: item.seen,
        right: item.right,
      });
    }
  });
  list.sort(function (a, b) { return a.due < b.due ? -1 : 1; });
  return list;
}

function reviewCount() { return dueWords().length; }

function reviewStats() {
  const d = load();
  const all = Object.keys(d.review);
  let mastered = 0;
  all.forEach(function (w) { if ((d.review[w].stage || 0) >= 3) mastered++; });
  return { total: all.length, mastered: mastered, due: dueWords().length };
}

// ========== 玩法累计 / 图鉴 / 成就 ==========
function addPlay(mode) {
  const d = load();
  d.plays[mode] = (d.plays[mode] || 0) + 1;
  save();
}

function getPlays() { return load().plays || {}; }

function collectedCount() { return Object.keys(load().collected || {}).length; }

function getCollected() {
  const d = load();
  return Object.keys(d.collected).map(function (w) {
    return { w: w, p: d.collected[w].p || '', m: d.collected[w].m || '', n: d.collected[w].n || 1 };
  }).sort(function (a, b) { return b.n - a.n; });
}

// 成就定义：条件基于本地数据，全部可查证
// goal(d, ctx) -> {cur, max}：给卡片显示"还差多少"，与 test 用同一份真实数据
const BADGES = [
  { id: 'first_star', name: '初出茅庐', icon: '🌟', desc: '获得第 1 颗星', test: function () { return totalStars() >= 1; }, goal: function () { return { cur: totalStars(), max: 1 }; } },
  { id: 'star_10', name: '小有成就', icon: '⭐', desc: '累计 10 颗星', test: function () { return totalStars() >= 10; }, goal: function () { return { cur: totalStars(), max: 10 }; } },
  { id: 'star_50', name: '词汇达人', icon: '✨', desc: '累计 50 颗星', test: function () { return totalStars() >= 50; }, goal: function () { return { cur: totalStars(), max: 50 }; } },
  { id: 'star_100', name: '闯关高手', icon: '🏆', desc: '累计 100 颗星', test: function () { return totalStars() >= 100; }, goal: function () { return { cur: totalStars(), max: 100 }; } },
  { id: 'perfect', name: '满星战神', icon: '💎', desc: '任意一关拿到 3 星', test: function () { return Object.values(load().stars).some(function (s) { return s >= 3; }); }, goal: function () { const s = Object.values(load().stars); return { cur: s.length ? Math.max.apply(null, s) : 0, max: 3 }; } },
  { id: 'streak_3', name: '坚持不懈', icon: '🔥', desc: '连续打卡 3 天', test: function () { return streakDays() >= 3; }, goal: function () { return { cur: streakDays(), max: 3 }; } },
  { id: 'streak_7', name: '一周达人', icon: '📅', desc: '连续打卡 7 天', test: function () { return streakDays() >= 7; }, goal: function () { return { cur: streakDays(), max: 7 }; } },
  { id: 'right_100', name: '答题机器', icon: '⚡', desc: '累计答对 100 词', test: function () { return load().stats.totalRight >= 100; }, goal: function () { return { cur: load().stats.totalRight || 0, max: 100 }; } },
  { id: 'right_500', name: '学霸', icon: '🎓', desc: '累计答对 500 词', test: function () { return load().stats.totalRight >= 500; }, goal: function () { return { cur: load().stats.totalRight || 0, max: 500 }; } },
  { id: 'wrong_10', name: '错词猎手', icon: '🎯', desc: '累计清掉 10 个错词', test: function (d) { return d.killedTotal >= 10; }, goal: function (d) { return { cur: d.killedTotal || 0, max: 10 }; } },
  { id: 'collect_50', name: '图鉴收集者', icon: '📖', desc: '图鉴收录 50 词', test: function () { return collectedCount() >= 50; }, goal: function () { return { cur: collectedCount(), max: 50 }; } },
  { id: 'review_20', name: '复习达人', icon: '🧠', desc: '复习过 20 个词', test: function () { return Object.keys(load().review).length >= 20; }, goal: function () { return { cur: Object.keys(load().review).length, max: 20 }; } },
  { id: 'streak_30', name: '习惯养成', icon: '👑', desc: '连续打卡 30 天', test: function () { return streakDays() >= 30 || (load().streakBest || 0) >= 30; }, goal: function () { return { cur: Math.max(streakDays(), load().streakBest || 0), max: 30 }; } },
  { id: 'card_epic', name: '欧皇附体', icon: '🟣', desc: '抽到 1 张史诗卡', test: function () { return Object.keys(load().cards).some(function (w) { return load().cards[w].r === 'epic'; }); }, goal: function () { const got = Object.keys(load().cards).some(function (w) { return load().cards[w].r === 'epic'; }) ? 1 : 0; return { cur: got, max: 1 }; } },
  { id: 'ultimate_king', name: '词林王者', icon: '👑', desc: '通关 BOSS 关，领取终极毕业礼', test: function () { return !!(load().ultimate && load().ultimate.claimed); }, goal: function () { return { cur: (load().ultimate && load().ultimate.claimed) ? 1 : 0, max: 1 }; } },
];

// 检查并解锁新成就，返回本次新解锁的列表
function checkBadges() {
  const d = load();
  const ctx = { killedTotal: d.killedTotal || 0 };
  const earned = [];
  BADGES.forEach(function (b) {
    if (d.badges.indexOf(b.id) < 0 && b.test(ctx)) {
      d.badges.push(b.id);
      earned.push(b);
    }
  });
  if (earned.length) save();
  return earned;
}

function getBadges() {
  const d = load();
  const ctx = { killedTotal: d.killedTotal || 0 };
  return BADGES.map(function (b) {
    let progress = null;
    try { progress = b.goal ? b.goal(d, ctx) : null; } catch (e) {}
    if (progress) {
      progress.cur = Math.max(0, Number(progress.cur) || 0);
      progress.max = Math.max(1, Number(progress.max) || 1);
      progress.cur = Math.min(progress.cur, progress.max);
      progress.pct = Math.round(progress.cur * 100 / progress.max);
    }
    return {
      id: b.id, name: b.name, icon: b.icon, desc: b.desc,
      unlocked: d.badges.indexOf(b.id) >= 0,
      progress: progress,
    };
  });
}

function badgeCount() {
  const d = load();
  return { earned: d.badges.length, total: BADGES.length };
}

function addKilled(n) {
  const d = load();
  d.killedTotal = (d.killedTotal || 0) + (n || 1);
  save();
}

// ========== Streak 保护 / 每日盲盒 ==========
function getFreezes() { return load().freezes || 0; }

// 仅消耗补签卡（用于游戏内复活，不占用打卡日期）
function consumeFreeze() {
  const d = load();
  if ((d.freezes || 0) <= 0) return false;
  d.freezes--;
  save();
  return true;
}

// 手动使用补签卡（用户主动补今天漏签）
function useFreeze() {
  const d = load();
  if ((d.freezes || 0) <= 0) return false;
  const today = formatDate(new Date());
  if (d.stats.days.indexOf(today) >= 0) return false;
  d.freezes--;
  d.stats.days.push(today);
  d.stats.lastPlay = today;
  const cur = streakDays();
  if (cur > (d.streakBest || 0)) d.streakBest = cur;
  save();
  return true;
}

// 看广告补签：与 useFreeze 同样把今天补进打卡，但不消耗补签卡（广告是代价）
function restoreStreakByAd() {
  const d = load();
  const today = formatDate(new Date());
  if (d.stats.days.indexOf(today) >= 0) return false;
  d.stats.days.push(today);
  d.stats.lastPlay = today;
  const cur = streakDays();
  if (cur > (d.streakBest || 0)) d.streakBest = cur;
  save();
  return true;
}

function streakInfo() {
  return {
    current: streakDays(),
    best: load().streakBest || 0,
    freezes: getFreezes(),
    toFreeze: 3 - (load().wrongSinceFreeze || 0),
  };
}

// ========== 统一货币：能量 ==========
// 能量只在 recordReview 产出（答对+1），学习是唯一铸币厂。
// 消耗出口：喂食(3)、抽卡(10)、后续上架的装扮系统。
const ENERGY_COST_DRAW = 10;

// 每日加成额度展示状态（只读，不写存档；跨天自动显示为全新一天）
function bonusStatus() {
  const d = load();
  const today = formatDate(new Date());
  const b = (d.dailyBonus && d.dailyBonus.date === today) ? d.dailyBonus : null;
  const used = b ? (b.used || 0) : 0;
  const expanded = b ? (b.expanded || 0) : 0;
  return {
    date: today,
    used: used,
    expanded: expanded,
    quota: 10 + expanded * 10,
    expandLeft: Math.max(0, 5 - expanded),
  };
}

// 看视频扩容：每次 +10 题，每天最多 5 次。广告完整看完后由页面调用。
function expandBonusByAd() {
  const d = load();
  const b = bonusState(d);
  if (b.expanded >= 5) return { ok: false, msg: '今天已达上限' };
  const next = b.expanded + 1;
  b.ref.expanded = next;
  save();
  return {
    ok: true,
    expanded: next,
    quota: 10 + next * 10,
    expandLeft: Math.max(0, 5 - next),
  };
}

function getEnergy() {
  const d = load();
  return (d.pet && d.pet.energy) || 0;
}

function spendEnergy(n) {
  const d = load();
  if (!d.pet) d.pet = JSON.parse(JSON.stringify(DEFAULT.pet));
  n = n || 1;
  if ((d.pet.energy || 0) < n) return false;
  d.pet.energy -= n;
  save();
  return true;
}

function energyCost() { return { draw: ENERGY_COST_DRAW, feed: 3 }; }

// 章节宝箱奖励：直接发能量，不写进复习排期/图鉴（避免污染词库数据）
function rewardEnergy(n) {
  const d = load();
  if (!d.pet) d.pet = JSON.parse(JSON.stringify(DEFAULT.pet));
  n = n || 1;
  d.pet.energy = (d.pet.energy || 0) + n;
  save();
  return d.pet.energy;
}

// ========== 通关宝箱：逐档升级，确定性奖励（未成年人合规：不做真钱随机抽取）==========
// 每通关一个单元，按累计开箱数升档：木→银→金→传说，之后停在传说并给递增能量。
// 每档"通关必得"，档位公开可预期；词卡稀有度沿用已公示的抽卡概率，不额外赌博。
const CHEST_TIERS = [
  { tier: 1, name: '木质宝箱', icon: '📦', color: '#B98A56', energy: 3,  shards: 0, freezes: 0, card: true, cardMin: '',     cardLabel: '词卡 +1',       desc: '初出茅庐的小奖励' },
  { tier: 2, name: '白银宝箱', icon: '🥈', color: '#9FB4C8', energy: 5,  shards: 1, freezes: 0, card: true, cardMin: '',     cardLabel: '词卡 +1',       desc: '装扮碎片 +1' },
  { tier: 3, name: '黄金宝箱', icon: '🏅', color: '#E7B43C', energy: 8,  shards: 2, freezes: 1, card: true, cardMin: 'rare', cardLabel: '稀有词卡保底', desc: '碎片 +2、补签卡 +1、稀有词卡' },
  { tier: 4, name: '传说宝箱', icon: '👑', color: '#D98AE8', energy: 12, shards: 3, freezes: 1, card: true, cardMin: 'epic', cardLabel: '史诗词卡保底', desc: '碎片 +3、补签卡 +1、史诗词卡' },
];

// 全对加成时词卡保底提升一档：无→稀有，稀有→史诗，史诗保持
const RARITY_UP = { '': 'rare', common: 'rare', rare: 'epic', epic: 'epic' };

// 当前应开哪一档（第 drawn+1 次）
// tierOverride: 可选，显式指定 1-4 档（章节关按第几关定档）；不传则沿用累计次数逻辑（地图页等）
// perfect: 可选，本局全对加成——能量翻倍 + 词卡保底提升一档
function chestPreview(tierOverride, perfect) {
  const d = load();
  const drawn = (d.chest && d.chest.drawn) || 0;
  const explicit = typeof tierOverride === 'number' && tierOverride >= 1 && tierOverride <= CHEST_TIERS.length;
  const idx = explicit ? tierOverride - 1 : Math.min(drawn, CHEST_TIERS.length - 1);
  const t = CHEST_TIERS[idx];
  // 累计溢出加成只在"按次数"模式下给；按关卡定档时奖励干净可预期
  const bonus = (!explicit && drawn >= CHEST_TIERS.length) ? (drawn - CHEST_TIERS.length + 1) * 2 : 0;
  let energy = t.energy + bonus;
  let cardMin = t.cardMin || '';
  let cardLabel = t.cardLabel || '词卡 +1';
  if (perfect) {
    energy *= 2;
    const up = RARITY_UP[cardMin] || cardMin;
    if (up !== cardMin) {
      cardMin = up;
      cardLabel = up === 'epic' ? '史诗词卡保底' : '稀有词卡保底';
    }
  }
  return {
    drawn: drawn,
    tier: t.tier,
    name: t.name,
    icon: t.icon,
    color: t.color,
    desc: t.desc,
    energy: energy,
    shards: t.shards,
    freezes: t.freezes,
    card: t.card,
    cardMin: cardMin,
    cardLabel: cardLabel,
    perfect: !!perfect,
    isMax: drawn >= CHEST_TIERS.length,
    shardsTotal: (d.chest && d.chest.shards) || 0,
  };
}

// 开一次通关宝箱：确定性发奖，返回本次奖励明细
// tierOverride: 可选，显式指定档位（章节关按第几关定档）
// perfect: 可选，本局全对加成
function openChest(tierOverride, perfect) {
  const d = load();
  if (!d.chest) d.chest = JSON.parse(JSON.stringify(DEFAULT.chest));
  const preview = chestPreview(tierOverride, perfect);

  // 能量
  d.pet = d.pet || JSON.parse(JSON.stringify(DEFAULT.pet));
  d.pet.energy = (d.pet.energy || 0) + preview.energy;
  // 装扮碎片
  d.chest.shards = (d.chest.shards || 0) + preview.shards;
  // 补签卡（上限3）
  if (preview.freezes) d.freezes = Math.min((d.freezes || 0) + preview.freezes, 3);
  // 开箱计数
  d.chest.drawn = (d.chest.drawn || 0) + 1;
  const rec = {
    tier: preview.tier, name: preview.name, icon: preview.icon,
    energy: preview.energy, shards: preview.shards, freezes: preview.freezes,
    date: formatDate(new Date()),
  };
  d.chest.history = d.chest.history || [];
  d.chest.history.push(rec);
  if (d.chest.history.length > 30) d.chest.history.shift();
  save();

  return {
    tier: preview.tier, name: preview.name, icon: preview.icon, color: preview.color,
    energy: preview.energy, shards: preview.shards, freezes: preview.freezes,
    card: preview.card, cardMin: preview.cardMin, cardLabel: preview.cardLabel,
    perfect: preview.perfect,
    next: chestPreview(),
  };
}

// 看视频翻倍：给"最近开出的那一箱"追加同等能量与碎片。
// 只翻能量/碎片；补签卡、词卡数量与稀有度一律不翻，守住学习成果公平。
// 用 history 末条的 doubled 标记做幂等：同一箱只能翻倍一次，重复点击不再发奖。
function doubleChestReward() {
  const d = load();
  const h = d.chest && d.chest.history;
  if (!h || !h.length) return null;
  const rec = h[h.length - 1];
  if (!rec || rec.doubled) return null;
  const bonusEnergy = Math.max(0, Number(rec.energy) || 0);
  const bonusShards = Math.max(0, Number(rec.shards) || 0);
  if (!bonusEnergy && !bonusShards) return null;
  d.pet = d.pet || JSON.parse(JSON.stringify(DEFAULT.pet));
  d.pet.energy = (d.pet.energy || 0) + bonusEnergy;
  d.chest.shards = (d.chest.shards || 0) + bonusShards;
  rec.energy = bonusEnergy * 2;
  rec.shards = bonusShards * 2;
  rec.doubled = true;
  save();
  return { energy: bonusEnergy, shards: bonusShards };
}

function chestStatus() {
  const d = load();
  return {
    preview: chestPreview(),
    history: ((d.chest && d.chest.history) || []).slice().reverse().slice(0, 10),
    shards: (d.chest && d.chest.shards) || 0,
    tiers: CHEST_TIERS.map(function (t) {
      return { tier: t.tier, name: t.name, icon: t.icon, color: t.color, desc: t.desc, energy: t.energy, shards: t.shards, freezes: t.freezes };
    }),
  };
}

// ========== 装备系统：碎片→装扮→穿戴→能量加成 ==========
// 装扮只提升"能量产出效率"，不解锁关卡、不加经验门槛——学习仍是唯一铸币厂。
// 每件装扮有槽位（head/eyes/neck/body），同槽位只能穿一件。
const EQUIPMENT = [
  { id: 'hat',    name: '学士帽',   icon: '🎓', slot: 'head',  slotName: '头部', cost: 10, bonus: 8,  color: '#7C6FD6', desc: '戴上它，像个真正的大学者' },
  { id: 'glass',  name: '星芒眼镜', icon: '👓', slot: 'eyes',  slotName: '眼部', cost: 20, bonus: 12, color: '#4A9BD6', desc: '看单词都清晰了几分' },
  { id: 'scarf',  name: '智慧围巾', icon: '🧣', slot: 'neck',  slotName: '颈部', cost: 35, bonus: 18, color: '#E07B94', desc: '暖暖的，复习更有劲' },
  { id: 'cloak',  name: '学者披风', icon: '🧥', slot: 'body',  slotName: '身体', cost: 55, bonus: 25, color: '#3FA88A', desc: '披风一甩，学霸登场' },
  { id: 'crown',  name: '词林王冠', icon: '👑', slot: 'head',  slotName: '头部', cost: 90, bonus: 35, color: '#D98AE8', desc: '稀有 · 词汇之王象征' },
];

function equipDefs() { return EQUIPMENT.map(function (e) { return Object.assign({}, e); }); }

// 当前穿戴的加成总和（百分比整数）。加成只作用于答对时的额外能量，不影响基础1点。
function equipBonus() {
  const d = load();
  const worn = (d.equip && d.equip.worn) || [];
  let sum = 0;
  EQUIPMENT.forEach(function (e) { if (worn.indexOf(e.id) >= 0) sum += e.bonus; });
  return sum;
}

// 装备面板数据：每件含解锁/穿戴状态、碎片进度、加成
function equipStatus() {
  const d = load();
  const owned = (d.equip && d.equip.owned) || [];
  const worn = (d.equip && d.equip.worn) || [];
  const shards = (d.chest && d.chest.shards) || 0;
  const list = EQUIPMENT.map(function (e) {
    return Object.assign({}, e, {
      owned: owned.indexOf(e.id) >= 0,
      wearing: worn.indexOf(e.id) >= 0,
      canCraft: owned.indexOf(e.id) < 0 && shards >= e.cost,
      need: Math.max(0, e.cost - shards),
      progress: Math.min(100, Math.round(shards * 100 / e.cost)),
    });
  });
  return {
    shards: shards,
    list: list,
    ownedCount: owned.length,
    total: EQUIPMENT.length,
    worn: worn.slice(),
    bonus: equipBonus(),
    bonusPts: (d.equip && d.equip.bonusPts) || 0,
  };
}

// 合成装扮：消耗碎片，永久解锁。返回 { ok, msg }
function craftEquip(id) {
  const d = load();
  const def = EQUIPMENT.filter(function (e) { return e.id === id; })[0];
  if (!def) return { ok: false, msg: '没有这件装扮' };
  if (!d.equip) d.equip = JSON.parse(JSON.stringify(DEFAULT.equip));
  if (d.equip.owned.indexOf(id) >= 0) return { ok: false, msg: '已经拥有这件装扮啦' };
  const shards = (d.chest && d.chest.shards) || 0;
  if (shards < def.cost) return { ok: false, msg: '碎片不够，还差 ' + (def.cost - shards) + ' 片' };
  d.chest.shards = shards - def.cost;
  d.equip.owned.push(id);
  save();
  return { ok: true, msg: '合成成功！「' + def.name + '」已解锁，去穿戴看看吧' };
}

// 穿戴/卸下装扮：同槽位互斥（穿上新的一件自动换下旧的）
function toggleEquip(id) {
  const d = load();
  const def = EQUIPMENT.filter(function (e) { return e.id === id; })[0];
  if (!def) return { ok: false, msg: '没有这件装扮' };
  if (!d.equip) d.equip = JSON.parse(JSON.stringify(DEFAULT.equip));
  if (d.equip.owned.indexOf(id) < 0) return { ok: false, msg: '还没解锁这件装扮' };
  const worn = d.equip.worn || [];
  const at = worn.indexOf(id);
  if (at >= 0) {
    worn.splice(at, 1);
    save();
    return { ok: true, on: false, msg: '已卸下「' + def.name + '」' };
  }
  // 同槽位只留一件
  d.equip.worn = worn.filter(function (wid) {
    const old = EQUIPMENT.filter(function (e) { return e.id === wid; })[0];
    return !old || old.slot !== def.slot;
  });
  d.equip.worn.push(id);
  save();
  return { ok: true, on: true, msg: '穿上「' + def.name + '」，能量产出 +' + def.bonus + '%' };
}

// ========== BOSS 终极毕业礼（全 app 唯一一次）==========
// 触发：语境辨析关（地图第5张BOSS卡）拿到 3 星。奖励确定性发放，不做随机赌博。
const ULTIMATE_CARDS = 3;

// 终极礼状态：qualified=已满足开箱资格（BOSS满星），claimed=已开箱领取
function ultimateStatus() {
  const d = load();
  return {
    claimed: !!(d.ultimate && d.ultimate.claimed),
    qualified: !!(d.ultimate && d.ultimate.qualified),
    date: (d.ultimate && d.ultimate.date) || '',
  };
}

// BOSS 关满星时调用：只解锁开箱资格，不发放任何奖励。返回是否首次解锁。
function markUltimateReady() {
  const d = load();
  if (!d.ultimate) d.ultimate = JSON.parse(JSON.stringify(DEFAULT.ultimate));
  if (d.ultimate.claimed || d.ultimate.qualified) return false;
  d.ultimate.qualified = true;
  save();
  return true;
}

// 领取终极礼：王冠装扮 + 史诗词卡×3 + 能量+50 + 补签卡+2。
// words 为本关词数组，从中挑 3 个做成史诗卡。必须先满星解锁资格，且绝不重复发奖。
function claimUltimate(words) {
  const d = load();
  if (!d.ultimate) d.ultimate = JSON.parse(JSON.stringify(DEFAULT.ultimate));
  if (d.ultimate.claimed) return null;
  if (!d.ultimate.qualified) return null;
  if (!d.pet) d.pet = JSON.parse(JSON.stringify(DEFAULT.pet));
  if (!d.equip) d.equip = JSON.parse(JSON.stringify(DEFAULT.equip));
  if (!Array.isArray(d.equip.owned)) d.equip.owned = [];

  // 1) 王冠装扮直接解锁（不消耗碎片）
  if (d.equip.owned.indexOf('crown') < 0) d.equip.owned.push('crown');
  // 2) 史诗词卡 ×3（保底 epic），优先用本关词
  const cards = [];
  const pool = (words && words.length) ? words.slice() : [];
  for (let i = 0; i < ULTIMATE_CARDS && pool.length; i++) {
    const k = Math.floor(Math.random() * pool.length);
    const picked = pool.splice(k, 1)[0];
    const w = Array.isArray(picked) ? picked[0] : (picked && picked.w);
    const p = Array.isArray(picked) ? (picked[1] || '') : (picked && picked.p) || '';
    const m = Array.isArray(picked) ? (picked[2] || '') : (picked && picked.m) || '';
    if (w) cards.push(drawCard({ w: w, p: p, m: m }, 'epic'));
  }
  // 3) 能量 +50、补签卡 +2（上限3）
  d.pet.energy = (d.pet.energy || 0) + 50;
  d.freezes = Math.min((d.freezes || 0) + 2, 3);
  // 4) 标记领取，防止重复
  d.ultimate.claimed = true;
  d.ultimate.date = formatDate(new Date());
  save();
  checkBadges(); // 解锁「词林王者」成就
  return {
    crown: true,
    cards: cards,
    energy: 50,
    freezes: 2,
    date: d.ultimate.date,
  };
}

// 看视频翻倍：终极毕业礼只翻能量（+50 → 累计 +100）。
// 王冠、3 张史诗词卡、2 张补签卡都不翻；energyDoubled 保证每份毕业礼只能翻一次。
function doubleUltimateReward() {
  const d = load();
  if (!d.ultimate || !d.ultimate.claimed || d.ultimate.energyDoubled) return null;
  const bonus = 50;
  d.pet = d.pet || JSON.parse(JSON.stringify(DEFAULT.pet));
  d.pet.energy = (d.pet.energy || 0) + bonus;
  d.ultimate.energyDoubled = true;
  save();
  return { energy: bonus };
}

// 每日抽卡：每日首次免费1次，之后可用能量/补签卡/看广告换次数
const RARITY = [
  { key: 'common', name: '普通', icon: '⚪', rate: 70 },
  { key: 'rare', name: '稀有', icon: '🔵', rate: 25 },
  { key: 'epic', name: '史诗', icon: '🟣', rate: 5 },
];

// minRarity: 可选最低稀有度 'rare' / 'epic'。传说宝箱传入以保证必出稀有卡。
// 抽到的卡若已存在，只保留更高稀有度（保底不会被普通覆盖）。
const RARITY_RANK = { common: 0, rare: 1, epic: 2 };
function drawCard(word, minRarity) {
  const d = load();
  const today = formatDate(new Date());
  if (d.dailyDraw.date !== today) {
    d.dailyDraw = { date: today, count: 0 };
  }
  d.dailyDraw.count = (d.dailyDraw.count || 0) + 1;
  // 稀有度：随机但保证前几次能出好卡（可变奖励）
  const r = Math.random() * 100;
  let rarity = 'common';
  if (d.dailyDraw.count >= 3 && r < 25) rarity = 'epic';
  else if (r < 25) rarity = 'rare';
  // 保底：若指定最低稀有度，且随机结果低于它，则提升到该档（如传说箱必出 epic）
  if (minRarity && (RARITY_RANK[minRarity] || 0) > (RARITY_RANK[rarity] || 0)) {
    rarity = minRarity;
  }
  // 已有同词卡时取更高稀有度，保底不会被低稀有度覆盖
  const old = d.cards[word.w];
  if (old && (RARITY_RANK[old.r] || 0) > (RARITY_RANK[rarity] || 0)) {
    const oldMeta = RARITY.filter(function (x) { return x.key === old.r; })[0] || RARITY[0];
    return Object.assign({}, old, { rName: oldMeta.name, rIcon: oldMeta.icon, kept: true });
  }
  const card = {
    w: word.w, p: word.p || '', m: word.m || '',
    r: rarity, date: today,
  };
  d.cards[word.w] = card;
  save();
  const meta = RARITY.filter(function (x) { return x.key === rarity; })[0];
  return Object.assign({}, card, { rName: meta.name, rIcon: meta.icon });
}

function drawStatus() {
  const d = load();
  const today = formatDate(new Date());
  return {
    date: today,
    drawn: d.dailyDraw.date === today ? (d.dailyDraw.count || 0) : 0,
    freeLeft: d.dailyDraw.date === today ? Math.max(0, 1 - (d.dailyDraw.count || 0)) : 1,
    energy: getEnergy(),
    energyCost: ENERGY_COST_DRAW,
    canEnergyDraw: getEnergy() >= ENERGY_COST_DRAW,
    total: Object.keys(d.cards).length,
    epic: Object.keys(d.cards).filter(function (w) { return d.cards[w].r === 'epic'; }).length,
    rare: Object.keys(d.cards).filter(function (w) { return d.cards[w].r === 'rare'; }).length,
  };
}

function getCards() {
  const d = load();
  const order = { epic: 0, rare: 1, common: 2 };
  return Object.keys(d.cards).map(function (w) {
    const c = d.cards[w];
    const meta = RARITY.filter(function (x) { return x.key === c.r; })[0] || RARITY[0];
    return Object.assign({}, c, { rName: meta.name, rIcon: meta.icon });
  }).sort(function (a, b) { return (order[a.r] || 9) - (order[b.r] || 9); });
}

// 判断今天是否玩过（用于抽卡资格）
function playedToday() {
  return load().stats.days.indexOf(formatDate(new Date())) >= 0;
}

// ========== 宠物养成：词枭 ==========
// 5 段进化，按累计成长值 exp 解锁。每阶段含立绘、主题色、称号。
const PET_STAGES = [
  { stage: 0, name: '词蛋',   title: '沉睡的词蛋',   exp: 0,    img: '/images/pets/pet_egg.webp',     color: '#B49BE8', desc: '一枚写着单词符文的蛋，等你唤醒它。' },
  { stage: 1, name: '雏枭',   title: '破壳的雏枭',   exp: 60,   img: '/images/pets/pet_chick.webp',   color: '#9B8AE0', desc: '刚睁开眼，对世界充满好奇的小家伙。' },
  { stage: 2, name: '书枭',   title: '勤学的书枭',   exp: 180,  img: '/images/pets/pet_scholar.webp', color: '#7C6FD6', desc: '戴上学士帽，开始认真读每一个单词。' },
  { stage: 3, name: '星枭',   title: '闪耀的星枭',   exp: 420,  img: '/images/pets/pet_star.webp',    color: '#D4A437', desc: '知识与星光环绕，羽翼渐丰。' },
  { stage: 4, name: '枭皇',   title: '词林枭皇',     exp: 900,  img: '/images/pets/pet_king.webp',    color: '#C9962B', desc: '戴上王冠，成为词汇之王。' },
];

// 饥饿感 = 遗忘曲线到期词数量。复习完到期词归零，宠物自然"吃饱"。
// 托管模式：假期开启后饥饿提示变温和，不做任何惩罚（避免愧疚卸载）。
function petHunger() {
  const d = load();
  const due = reviewCount();
  const vac = !!(d.pet && d.pet.vacMode);
  let level, label, line;
  if (due === 0) {
    level = 0; label = '吃饱啦'; line = '词枭精神满满，今天没有要复习的词';
  } else if (due <= 5) {
    level = 1; label = '有点饿'; line = '有 ' + due + ' 个词该复习了，去喂喂它';
  } else if (due <= 15) {
    level = 2; label = '饿了'; line = due + ' 个词在等复习，词枭有点没精神';
  } else {
    level = 3; label = '很饿'; line = due + ' 个词堆积了，先复习几个让它缓一缓';
  }
  if (vac) {
    line = '托管中 · 慢慢来，' + due + ' 个词不着急';
  }
  return { due: due, level: level, label: label, line: line, vac: vac };
}

// 切换托管模式
function toggleVacMode() {
  const d = load();
  if (!d.pet) d.pet = JSON.parse(JSON.stringify(DEFAULT.pet));
  d.pet.vacMode = !d.pet.vacMode;
  save();
  return d.pet.vacMode;
}

function petInfo() {
  const d = load();
  if (!d.pet) d.pet = JSON.parse(JSON.stringify(DEFAULT.pet));
  const p = d.pet;
  const exp = p.exp || 0;
  let stage = 0;
  for (let i = 0; i < PET_STAGES.length; i++) {
    if (exp >= PET_STAGES[i].exp) stage = i;
  }
  const cur = PET_STAGES[stage];
  const next = PET_STAGES[stage + 1] || null;
  const base = cur.exp;
  const span = next ? (next.exp - base) : 1;
  return {
    name: p.name || '小枭',
    exp: exp,
    energy: p.energy || 0,
    bond: p.bond || 0,
    fed: p.fed || 0,
    lastFeed: p.lastFeed || '',
    stage: stage,
    title: cur.title,
    img: cur.img,
    color: cur.color,
    desc: cur.desc,
    nextName: next ? next.name : '',
    toNext: next ? Math.max(0, next.exp - exp) : 0,
    progress: next ? Math.min(100, Math.round((exp - base) * 100 / span)) : 100,
    isMax: !next,
    seenStage: p.seenStage || 0,
    hunger: petHunger(),
    stages: PET_STAGES.map(function (s) {
      return {
        stage: s.stage, name: s.name, title: s.title, exp: s.exp,
        img: s.img, color: s.color, desc: s.desc,
        unlocked: exp >= s.exp,
      };
    }),
  };
}

// ===== 心愿清单：点亮期待后续上线的内容（纯本地，无排行无日期） =====
// 返回用户已点亮的心愿 id -> true 的映射
function getWishes() { return load().wishes || {}; }

// 点亮数（给页面显示"已点亮 N 个心愿"）
function wishCount() { return Object.keys(getWishes()).length; }

// 切换心愿：点一下点亮，再点一下取消。返回切换后的状态 true/false
function toggleWish(id) {
  if (!id) return false;
  const d = load();
  if (!d.wishes || typeof d.wishes !== 'object') d.wishes = {};
  const next = !d.wishes[id];
  if (next) d.wishes[id] = true;
  else delete d.wishes[id];
  save();
  return next;
}

// ===== 错词清剿：三遍过滤进度 =====
// 每个词连过三遍（看英识义 → 看义选词 → 拼写）才从错词本划掉。
function getCleanPass(w) {
  if (!w) return 0;
  return Number((load().cleanPass || {})[w]) || 0;
}

// 某词答对一遍：pass+1；满 3 则真正划出错词本。返回 { pass, cleared }
function bumpCleanPass(w) {
  if (!w) return { pass: 0, cleared: false };
  const d = load();
  if (!d.cleanPass || typeof d.cleanPass !== 'object') d.cleanPass = {};
  const next = Math.min(3, (Number(d.cleanPass[w]) || 0) + 1);
  d.cleanPass[w] = next;
  let cleared = false;
  if (next >= 3) {
    d.wrong = (d.wrong || []).filter(function (x) { return x.w !== w; });
    delete d.cleanPass[w];
    if (d.cleanStreak) delete d.cleanStreak[w];
    cleared = true;
  }
  save();
  return { pass: next, cleared: cleared };
}

// 某词答错：进度归零，重新从第一遍开始
function resetCleanPass(w) {
  if (!w) return;
  const d = load();
  if (d.cleanPass && d.cleanPass[w]) { delete d.cleanPass[w]; save(); }
}

// 一局结算：清掉的词传 cleared，没清掉的传 missed，更新顽固词连续局数
function finishCleanRound(cleared, missed) {
  const d = load();
  if (!d.cleanStreak || typeof d.cleanStreak !== 'object') d.cleanStreak = {};
  (cleared || []).forEach(function (w) { delete d.cleanStreak[w]; });
  (missed || []).forEach(function (w) { d.cleanStreak[w] = (Number(d.cleanStreak[w]) || 0) + 1; });
  save();
}

// 顽固词（连续 >=2 局没清掉），给清剿页优先排前面
function getStubbornWords() {
  const d = load();
  const st = d.cleanStreak || {};
  return Object.keys(st).filter(function (w) { return Number(st[w]) >= 2; });
}

// 喂食：消耗 3 能量，亲密度 +1。每天最多喂 3 次，防止一次喂爆
function feedPet() {
  const d = load();
  if (!d.pet) d.pet = JSON.parse(JSON.stringify(DEFAULT.pet));
  const today = formatDate(new Date());
  if (d.pet.feedDate !== today) { d.pet.feedDate = today; d.pet.feedCount = 0; }
  if ((d.pet.energy || 0) < 3) return { ok: false, msg: '能量不够啦，答对题目可以攒能量' };
  if ((d.pet.feedCount || 0) >= 3) return { ok: false, msg: '今天喂饱啦，明天再来吧' };
  d.pet.energy -= 3;
  d.pet.bond = (d.pet.bond || 0) + 1;
  d.pet.fed = (d.pet.fed || 0) + 1;
  d.pet.feedCount = (d.pet.feedCount || 0) + 1;
  d.pet.lastFeed = today;
  save();
  return { ok: true, msg: '好好吃！亲密度 +1' };
}

// 改名：1-8 字符
function renamePet(name) {
  const d = load();
  if (!d.pet) d.pet = JSON.parse(JSON.stringify(DEFAULT.pet));
  const n = String(name || '').trim().slice(0, 8);
  if (!n) return false;
  d.pet.name = n;
  save();
  return true;
}

// 检测本次是否发生了进化（对比已看过阶段），返回新阶段或 null
function checkEvolution() {
  const d = load();
  if (!d.pet) d.pet = JSON.parse(JSON.stringify(DEFAULT.pet));
  const info = petInfo();
  if (info.stage > (d.pet.seenStage || 0)) {
    d.pet.seenStage = info.stage;
    save();
    return { stage: info.stage, name: info.name, title: info.title, img: info.img, desc: info.desc };
  }
  return null;
}

function resetAll() {
  cache = Object.assign({}, JSON.parse(JSON.stringify(DEFAULT)), { stats: Object.assign({}, DEFAULT.stats) });
  save();
}

module.exports = {
  init, setStar, getStar, totalStars,
  addWrong, removeWrong, getWrong, wrongCount,
  setBest, getBest, addStat, getStats, streakDays, weeklyReport, accuracy,
  recordReview, dueWords, reviewCount, reviewStats,
  addPlay, getPlays, collectedCount, getCollected,
  checkBadges, getBadges, badgeCount, addKilled,
  getFreezes, consumeFreeze, useFreeze, restoreStreakByAd, streakInfo,
  drawCard, drawStatus, getCards, playedToday,
  getEnergy, spendEnergy, energyCost, rewardEnergy, bonusStatus, expandBonusByAd,
  chestPreview, openChest, doubleChestReward, chestStatus,
  equipDefs, equipStatus, equipBonus, craftEquip, toggleEquip,
  ultimateStatus, markUltimateReady, claimUltimate, doubleUltimateReward,
  petInfo, feedPet, renamePet, checkEvolution,
  petHunger, toggleVacMode,
  getWishes, wishCount, toggleWish,
  getCleanPass, bumpCleanPass, resetCleanPass, finishCleanRound, getStubbornWords,
  resetAll,
  flush, saveNow,
};
