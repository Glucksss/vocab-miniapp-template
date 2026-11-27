// 出题逻辑：从词库生成选义题、拼写题
const levels = require('../data/levels.js');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function getLevel(index) {
  return levels[index] || null;
}

function levelCount() {
  return levels.length;
}

// 取某关的词
function levelWords(index) {
  const lv = levels[index];
  return lv ? lv.w : [];
}

// 把 [w,p,m] 转成对象
function toWord(arr) {
  return { w: arr[0], p: arr[1] || '', m: arr[2] || '' };
}

// 生成选义题：题干给中文，9个英文选项（1对8干扰）
// pool 为本关词，不够从全局抽
function makeChoiceQuestions(words, count, pool) {
  const base = pool || words;
  const qs = [];
  const picked = shuffle(words).slice(0, count);
  picked.forEach(function (item) {
    const ans = toWord(item);
    let distract = shuffle(base.filter(function (x) { return x[0] !== ans.w; })).slice(0, 8);
    if (distract.length < 8) {
      // 从全部关卡抽补充
      const all = [];
      for (let i = 0; i < levels.length && all.length < 20; i++) {
        all.push.apply(all, levels[i].w);
      }
      distract = distract.concat(shuffle(all.filter(function (x) {
        return x[0] !== ans.w && distract.indexOf(x) < 0;
      })).slice(0, 8 - distract.length));
    }
    const options = shuffle([ans].concat(distract.map(toWord)));
    qs.push({
      q: ans.m,          // 题干：中文释义
      answer: ans.w,     // 正确答案
      options: options,  // [{w,p,m}]
      phonetic: ans.p,
    });
  });
  return qs;
}

// 取短释义：去掉词性前缀(n./vt./adj.等)，取前两个义项，过长截断。
// 判题与选项 label 都调用本函数，改这里两处自动一致。
// 例：'n. 时机，机会' -> '时机，机会'；'a. 年长的,资深的' -> '年长的，资深的'
function shortMeaning(m, maxLen) {
  const cap = maxLen || 14;
  let s = String(m || '').trim();
  // 逐层剥掉前缀：=别名、(过去式/美式/复数)、词性、'&'连接符。
  // 例：'(forgave, forgiven) vt. 原谅，宽恕' -> '原谅，宽恕'
  // 若不剥干净，取前两个义项会把 '(forgave，forgiven)' 当释义，截出来全是英文残片。
  for (let i = 0; i < 8; i++) {
    const t = s.replace(/^[=＝]\s*/, '')
      .replace(/^(?:\([^)]*\)\s*)+/, '')
      .replace(/^(?:n|v|vt|vi|adj|adv|prep|conj|pron|art|num|int|a|abbr)\.\s*/gi, '')
      .replace(/^[a-z]+\.\s*/i, '')
      .replace(/^[&＆、,，]\s*/, '')
      .trim();
    if (t === s) break;
    s = t;
  }
  // 兜底：前缀是纯英文/符号而后头有中文时，直接从第一个中文开始
  const cn = s.search(/[一-龥]/);
  if (cn > 0 && /^[\x00-\x7F\s.,;:()\[\]=&'"\/\\-]+$/.test(s.slice(0, cn))) s = s.slice(cn);
  // 取前两个义项：按逗号/分号/顿号/斜杠切，统一用中文逗号连接
  const parts = s.split(/[，,；;、\/]/).map(function (x) { return x.trim(); }).filter(Boolean);
  let out = parts.slice(0, 2).join('，') || s || '释义';
  if (out.length > cap) out = out.slice(0, cap).replace(/[，,、；;\s]+$/, '');
  return out;
}

// 生成反向选义题：题干给英文单词，4 个中文短释义选项（1 对 3 干扰）。
// answer 仍是英文原词，作为判定与记录的 key，保证错词本/复习/图鉴不受显示反转影响。
function makeReverseChoiceQuestions(words, count, pool) {
  const base = pool || words;
  const qs = [];
  const picked = shuffle(words).slice(0, count);
  picked.forEach(function (item) {
    const ans = toWord(item);
    const ansShort = shortMeaning(ans.m);
    // 干扰项：从词池取 3 个中文短释义不同的词
    const cand = shuffle(base.filter(function (x) {
      return x[0] !== ans.w && shortMeaning(x[2]) !== ansShort;
    }));
    const distract = [];
    for (let i = 0; i < cand.length && distract.length < 3; i++) {
      const sm = shortMeaning(cand[i][2]);
      if (distract.indexOf(sm) < 0 && sm !== ansShort) distract.push(sm);
    }
    // 兜底：词池不够时从全局补
    if (distract.length < 3) {
      const all = [];
      for (let i = 0; i < levels.length && all.length < 40; i++) all.push.apply(all, levels[i].w);
      const more = shuffle(all);
      for (let i = 0; i < more.length && distract.length < 3; i++) {
        const sm = shortMeaning(more[i][2]);
        if (more[i][0] !== ans.w && sm !== ansShort && distract.indexOf(sm) < 0) distract.push(sm);
      }
    }
    const options = shuffle([ansShort].concat(distract)).map(function (sm) {
      return { label: sm };
    });
    qs.push({
      q: ans.w,        // 题干：英文单词
      answer: ans.w,   // 判定与记录 key：仍是英文原词
      meaning: ans.m,  // 完整释义，供反馈显示
      options: options,// [{label:中文短释义}]
      phonetic: ans.p,
    });
  });
  return qs;
}

// 生成正向选义题：题干给中文，4 个英文单词选项（1 对 3 干扰）。
// 与反向题方向相反，训练"中 → 英"回忆。选项统一 {label:英文词}，方便模板复用。
function makeForwardChoiceQuestions(words, count, pool) {
  const base = pool || words;
  const qs = [];
  const picked = shuffle(words).slice(0, count);
  picked.forEach(function (item) {
    const ans = toWord(item);
    const cand = shuffle(base.filter(function (x) { return x[0] !== ans.w; }));
    const distract = [];
    for (let i = 0; i < cand.length && distract.length < 3; i++) {
      if (cand[i][0] !== ans.w && distract.indexOf(cand[i][0]) < 0) distract.push(cand[i][0]);
    }
    if (distract.length < 3) {
      const all = [];
      for (let i = 0; i < levels.length && all.length < 40; i++) all.push.apply(all, levels[i].w);
      const more = shuffle(all);
      for (let i = 0; i < more.length && distract.length < 3; i++) {
        if (more[i][0] !== ans.w && distract.indexOf(more[i][0]) < 0) distract.push(more[i][0]);
      }
    }
    const options = shuffle([ans.w].concat(distract)).map(function (w) { return { label: w }; });
    qs.push({
      q: ans.m,          // 题干：中文释义
      answer: ans.w,     // 判定与记录 key：英文原词
      meaning: ans.m,
      options: options,  // [{label:英文词}]
      phonetic: ans.p,
    });
  });
  return qs;
}

// 生成打字拼写题：中文题干 + 音标，玩家用系统键盘输入英文（不出字母池）。
// 题干用两义项短释义（如"宇航员，航天员"），干净好读；判定仍比对 answer 英文原词。
function makeTypingQuestions(words, count) {
  const qs = [];
  const picked = shuffle(words).slice(0, count);
  picked.forEach(function (item) {
    const ans = toWord(item);
    qs.push({ q: shortMeaning(ans.m), meaning: ans.m, answer: ans.w, phonetic: ans.p });
  });
  return qs;
}

// 生成拼写题：题干给中文+音标，打乱字母
function makeSpellQuestions(words, count) {
  const qs = [];
  const picked = shuffle(words).slice(0, count);
  picked.forEach(function (item) {
    const ans = toWord(item);
    let letters = ans.w.replace(/[^a-zA-Z]/g, '').split('');
    letters = shuffle(letters);
    qs.push({
      q: ans.m,
      answer: ans.w,
      phonetic: ans.p,
      letters: letters,
    });
  });
  return qs;
}

// 从错词本生成混合题
function makeBossQuestions(wrongWords, count) {
  const qs = [];
  const n = Math.min(count, wrongWords.length);
  shuffle(wrongWords).slice(0, n).forEach(function (ww, i) {
    const ans = { w: ww.w, p: ww.p || '', m: ww.m || '', fromWrong: !!ww.fromWrong };
    if (i % 2 === 0) {
      // 选义题
      const pool = [];
      for (let k = 0; k < levels.length && pool.length < 30; k++) {
        pool.push.apply(pool, levels[k].w);
      }
      // 8 个选项（1 答案 + 7 干扰）正好 2 列 4 行排满 Boss 技能盘
      let distract = shuffle(pool.filter(function (x) { return x[0] !== ans.w; })).slice(0, 7).map(toWord);
      qs.push({
        type: 'choice',
        q: ans.m,
        answer: ans.w,
        options: shuffle([ans].concat(distract)),
        phonetic: ans.p,
        word: ans,
      });
    } else {
      // 拼写题
      let letters = shuffle(ans.w.replace(/[^a-zA-Z]/g, '').split(''));
      qs.push({
        type: 'spell',
        q: ans.m,
        answer: ans.w,
        letters: letters,
        phonetic: ans.p,
        word: ans,
      });
    }
  });
  return qs;
}

// 全局随机词（限时风暴用）：先按单词去重，避免同一局出现重复题
function randomPool(size) {
  const seen = {};
  const all = [];
  for (let i = 0; i < levels.length; i++) {
    const ws = levels[i].w;
    for (let j = 0; j < ws.length; j++) {
      const w = ws[j][0];
      if (w && !seen[w]) { seen[w] = true; all.push(ws[j]); }
    }
  }
  const want = Math.min(size || 200, all.length);
  return shuffle(all).slice(0, want);
}

module.exports = {
  shuffle, getLevel, levelCount, levelWords, toWord,
  makeChoiceQuestions, makeSpellQuestions, makeBossQuestions, randomPool,
  shortMeaning, makeReverseChoiceQuestions, makeForwardChoiceQuestions, makeTypingQuestions,
};
