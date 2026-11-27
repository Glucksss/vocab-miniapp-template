#!/usr/bin/env node
/**
 * 词库生成器（双入口，绝不编造释义）
 * 用法:
 *   A. 用户提供词表: node build_wordbank.js --input mywords.json --out <项目目录> --volume 1 --unit 1
 *   B. 从 ECDICT 提取: node build_wordbank.js --ecdict ecdict.csv --wordlist words.txt --out <项目目录> --volume 8 --unit 0
 *   C. 高考3500格式:  node build_wordbank.js --gaokao GaoKao_3500.json --out <项目目录> --volume 8 --unit 0
 *
 * 支持 --per-level 15 --name "译林版" 等。缺失音标/释义留空，不生成假数据。
 */
const fs = require('fs');
const path = require('path');

function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function clean(s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}
function firstMeaning(x) {
  if (Array.isArray(x)) return clean(x.slice(0, 3).join('；'));
  return clean(String(x || '').split('\n').slice(0, 3).join('；'));
}
function pick(o, keys) {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  return '';
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i];
    else throw new Error('未知参数: ' + argv[i]);
  }
  a.out = a.out || process.cwd();
  a.volume = Number(a.volume || 1);
  a.unit = Number(a.unit || 0);
  a['per-level'] = Number(a['per-level'] || 15);
  return a;
}

function readWords(a) {
  const out = [];
  if (a.input) {
    const raw = fs.readFileSync(a.input, 'utf8');
    let list;
    if (/\.csv$/i.test(a.input)) {
      const rows = parseCSV(raw);
      const head = (rows.shift() || []).map(h => clean(h).toLowerCase());
      const col = n => head.indexOf(n);
      const wi = Math.max(0, col('word'), col('w'));
      const pi = Math.max(-1, col('phonetic'), col('p'));
      const mi = Math.max(-1, col('meaning'), col('translation'), col('m'));
      const vi = col('volume'), ui = col('unit');
      list = rows.filter(r => r[wi]).map(r => ({
        w: clean(r[wi]), p: pi >= 0 ? clean(r[pi]) : '', m: mi >= 0 ? firstMeaning(r[mi]) : '',
        v: vi >= 0 ? Number(r[vi]) : a.volume, u: ui >= 0 ? Number(r[ui]) : a.unit,
      }));
    } else {
      const json = JSON.parse(raw);
      list = Array.isArray(json) ? json : (json.words || []);
      list = list.map(x => {
        if (typeof x === 'string') return { w: x, p: '', m: '', v: a.volume, u: a.unit };
        const m = pick(x, ['m', 'meaning', 'translation', 'trans', 'cn']);
        return {
          w: clean(pick(x, ['w', 'word', 'name'])),
          p: clean(pick(x, ['p', 'phonetic', 'usphone', 'ukphone'])),
          m: firstMeaning(m),
          v: Number(pick(x, ['v', 'volume']) || a.volume),
          u: Number(pick(x, ['u', 'unit']) || a.unit),
        };
      });
    }
    out.push(...list);
  } else if (a.gaokao) {
    const raw = JSON.parse(fs.readFileSync(a.gaokao, 'utf8'));
    (Array.isArray(raw) ? raw : raw.words || []).forEach(x => {
      out.push({
        w: clean(pick(x, ['name', 'w', 'word'])),
        p: clean(pick(x, ['usphone', 'ukphone', 'phonetic'])),
        m: firstMeaning(pick(x, ['trans', 'translation', 'm'])),
        v: a.volume, u: a.unit,
      });
    });
  } else if (a.ecdict) {
    const rows = parseCSV(fs.readFileSync(a.ecdict, 'utf8'));
    const head = (rows.shift() || []).map(h => clean(h).toLowerCase());
    const ci = n => head.indexOf(n);
    let allow = null;
    if (a.wordlist) {
      const raw = fs.readFileSync(a.wordlist, 'utf8').trim();
      let arr;
      if (raw.startsWith('[')) arr = JSON.parse(raw);
      else arr = raw.split(/\r?\n/);
      allow = new Set(arr.map(x => clean(typeof x === 'string' ? x : (x.w || x.word || x.name))).filter(Boolean));
    }
    rows.forEach(r => {
      const w = clean(r[ci('word')]);
      if (!w || (allow && !allow.has(w))) return;
      out.push({
        w,
        p: ci('phonetic') >= 0 ? clean(r[ci('phonetic')]) : '',
        m: firstMeaning(r[ci('translation')] || r[ci('definition')]),
        v: a.volume, u: a.unit,
      });
    });
  } else {
    throw new Error('必须提供 --input / --gaokao / --ecdict 之一');
  }

  // 去重 + 丢掉无单词的行
  const seen = {};
  return out.filter(x => {
    if (!x.w || seen[x.w]) return false;
    seen[x.w] = 1;
    return true;
  });
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const words = readWords(a);
  if (!words.length) throw new Error('没有解析到任何单词，请检查输入格式');

  // 按 v/u 分组切关
  const groups = {};
  words.forEach(w => {
    const k = (w.v || a.volume) + '_' + (w.u || 0);
    (groups[k] = groups[k] || []).push(w);
  });
  const levels = [];
  Object.keys(groups).forEach(k => {
    const [v, u] = k.split('_').map(Number);
    const list = groups[k];
    for (let i = 0; i < list.length; i += a['per-level']) {
      const chunk = list.slice(i, i + a['per-level']);
      const no = Math.floor(i / a['per-level']) + 1;
      levels.push({
        id: 'V' + v + 'U' + u + '-' + no,
        v, u,
        w: chunk.map(x => [x.w, x.p || '', x.m || '']),
      });
    }
  });

  const details = {};
  words.forEach(x => {
    details[x.w] = { w: x.w, p: x.p || '', cn: x.m || '', en: '', collocations: [], synonyms: [] };
  });

  const dataDir = path.join(a.out, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'levels.js'),
    '// 由 vocab-miniapp-factory/scripts/build_wordbank.js 生成，勿手改\nmodule.exports = ' +
    JSON.stringify(levels) + ';\n', 'utf8');
  fs.writeFileSync(path.join(dataDir, 'word_details.js'),
    '// 由 vocab-miniapp-factory/scripts/build_wordbank.js 生成，仅含来源已有的音标/释义\nmodule.exports = ' +
    JSON.stringify(details, null, 0) + ';\n', 'utf8');

  const blank = ['rich_lite.js', 'coll_add.js'].filter(f => !fs.existsSync(path.join(dataDir, f)));
  blank.forEach(f => fs.writeFileSync(path.join(dataDir, f), 'module.exports = {};\n', 'utf8'));

  console.log('词库生成完成: ' + words.length + ' 词 / ' + levels.length + ' 关');
  console.log('空释义词数: ' + words.filter(x => !x.m).length + '（未编造，仅留空）');
  console.log('输出: ' + dataDir);
}
try { main(); } catch (e) { console.error('失败: ' + e.message); process.exit(1); }
