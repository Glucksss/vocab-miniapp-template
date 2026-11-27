#!/usr/bin/env node
/** 工程自检：node validate.js <项目目录>
 * 检查语法、JSON、页面文件、分包路径、词库数据、主包体积。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(process.argv[2] || '.');
const errs = [];
function walk(dir, out) {
  fs.readdirSync(dir).forEach(n => {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) {
      if (!['.git', 'node_modules', '.workbuddy'].includes(n)) walk(p, out);
    } else out.push(p);
  });
  return out;
}
const files = walk(root, []);
let js = 0, json = 0;
files.forEach(f => {
  const rel = path.relative(root, f).replace(/\\/g, '/');
  if (f.endsWith('.js')) {
    js++;
    try { new vm.Script(fs.readFileSync(f, 'utf8'), { filename: rel }); }
    catch (e) { errs.push('JS语法 ' + rel + ' → ' + e.message); }
  }
  if (f.endsWith('.json')) {
    json++;
    try { JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch (e) { errs.push('JSON ' + rel + ' → ' + e.message); }
  }
});

const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
app.pages.forEach(p => {
  ['js', 'wxml', 'wxss', 'json'].forEach(ext => {
    if (!fs.existsSync(path.join(root, p + '.' + ext))) errs.push('页面文件缺失 ' + p + '.' + ext);
  });
});
const subs = app.subPackages || app.subpackages || [];
subs.forEach(sp => {
  if (!fs.existsSync(path.join(root, sp.root))) errs.push('分包目录缺失 ' + sp.root);
  sp.pages.forEach(p => {
    ['js', 'wxml'].forEach(ext => {
      if (!fs.existsSync(path.join(root, sp.root, p + '.' + ext))) errs.push('分包页缺失 ' + sp.root + '/' + p + '.' + ext);
    });
  });
});

let mainBytes = 0, subBytes = 0;
files.forEach(f => {
  const rel = path.relative(root, f).replace(/\\/g, '/');
  const isSub = subs.some(sp => rel.indexOf(sp.root + '/') === 0);
  if (isSub) subBytes += fs.statSync(f).size; else mainBytes += fs.statSync(f).size;
});
if (mainBytes > 2 * 1024 * 1024) errs.push('主包超过 2MB');

let levelCount = 0, wordCount = 0, emptyMeaning = 0;
try {
  const levels = require(path.join(root, 'data/levels.js'));
  levelCount = levels.length;
  levels.forEach(l => (l.w || []).forEach(x => {
    wordCount++;
    if (!x[2]) emptyMeaning++;
  }));
  if (!levelCount) errs.push('词库为空：请先运行 build_wordbank.js');
} catch (e) { errs.push('词库读取失败: ' + e.message); }

// 出题结构抽样（不依赖 wx）
try {
  const quiz = require(path.join(root, 'utils/quiz.js'));
  const raw = quiz.levelWords(0).slice(0, 5);
  const pool = quiz.randomPool(20);
  const qs = quiz.makeChoiceQuestions(raw, 5, pool);
  if (qs.length !== 5 || qs.some(q => !q.q || !q.options || q.options.length < 2)) {
    errs.push('出题结构异常');
  }
} catch (e) { errs.push('出题抽样失败: ' + e.message); }

console.log('工程自检: ' + root);
console.log('JS ' + js + ' / JSON ' + json + ' / 页面 ' + app.pages.length + ' / 分包 ' + subs.length);
console.log('词库 ' + wordCount + ' 词 / ' + levelCount + ' 关（空释义 ' + emptyMeaning + '）');
console.log('主包 ' + (mainBytes / 1024 / 1024).toFixed(2) + ' MB / 分包 ' + (subBytes / 1024 / 1024).toFixed(2) + ' MB');
console.log('问题数: ' + errs.length);
errs.forEach((x, i) => console.log('  ' + (i + 1) + '. ' + x));
process.exit(errs.length ? 1 : 0);
