#!/usr/bin/env node
/**
 * 单词闯关小程序脚手架
 * 用法:
 *   node scaffold.js <目标目录> --name "小学英语闯关" --appid wx1234567890 [--games game,spell,timed] [--force]
 *
 * --games 不传=全量玩法；传了=只保留列出的玩法（核心页 index/practice/treasure/pet 始终保留）。
 * 入口卡片的增删由 references/gameplay-catalog.md 指导，本脚本只改路由与配置。
 */
const fs = require('fs');
const path = require('path');

const SKELETON = path.join(__dirname, '..', 'assets', 'skeleton');
const CORE_PAGES = ['pages/index/index', 'pages/practice/practice', 'pages/treasure/treasure', 'pages/pet/pet'];
const GAME_PAGES = {
  game: 'pages/game/game', spell: 'pages/spell/spell', timed: 'pages/timed/timed',
  boss: 'pages/boss/boss', clean: 'pages/clean/clean', wrong: 'pages/wrong/wrong',
  review: 'pages/review/review', achieve: 'pages/achieve/achieve', context: 'pages/context/context',
  cards: 'pages/cards/cards', map: 'pages/map/map', chapter: 'pages/chapter/chapter',
  recite: 'pages/recite/recite',
};

function parseArgs(argv) {
  const args = { target: argv[0], force: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') args.force = true;
    else if (a === '--name' || a === '--appid' || a === '--games') args[a.slice(2)] = argv[++i];
    else throw new Error('未知参数: ' + a);
  }
  if (!args.target) throw new Error('缺少目标目录');
  if (!args.name) args.name = path.basename(path.resolve(args.target));
  return args;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (['.workbuddy', '.git', 'node_modules'].includes(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = path.resolve(args.target);
  if (fs.existsSync(target) && !args.force) {
    throw new Error('目标目录已存在: ' + target + '（确认覆盖请加 --force）');
  }
  copyDir(SKELETON, target);

  const appFile = path.join(target, 'app.json');
  const app = JSON.parse(fs.readFileSync(appFile, 'utf8'));
  app.window.navigationBarTitleText = args.name;

  if (args.games) {
    const keep = new Set(args.games.split(',').map(s => s.trim()).filter(Boolean));
    const allowed = new Set([...CORE_PAGES]);
    keep.forEach(k => { if (GAME_PAGES[k]) allowed.add(GAME_PAGES[k]); });
    app.pages = app.pages.filter(p => allowed.has(p));
    app.tabBar.list = app.tabBar.list.filter(t => allowed.has(t.pagePath));
    console.log('已保留玩法: ' + Array.from(keep).join(', '));
    console.log('注意：入口卡片需按 references/gameplay-catalog.md 手动增删。');
  }
  writeJson(appFile, app);

  const projFile = path.join(target, 'project.config.json');
  const proj = JSON.parse(fs.readFileSync(projFile, 'utf8'));
  proj.projectname = args.name;
  if (args.appid) proj.appid = args.appid;
  writeJson(projFile, proj);

  const readme = [
    '# ' + args.name,
    '',
    '由 `vocab-miniapp-factory` 生成。',
    '',
    '## 下一步',
    '',
    '1. 用 `scripts/build_wordbank.js` 生成 `data/levels.js`（词库双入口见 references/wordbank-sources.md）。',
    '2. 在微信公众平台把 `project.config.json` 的 `appid` 换成正式 AppID。',
    '3. 用 `scripts/validate.js` 自检，再按 references/launch-checklist.md 完成上架配置。',
    '',
    '## 目录',
    '',
    '- `pages/`：17 个页面骨架（按玩法开关裁剪）',
    '- `utils/`：storage / quiz / wordCard / tts / ad / volPicker / ui',
    '- `data/`：词库生成占位，勿手改',
    '- `images/`：图标与宠物装饰素材',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(target, 'README.md'), readme, 'utf8');

  console.log('脚手架完成: ' + target);
  console.log('页面数: ' + app.pages.length + ' / Tab 数: ' + app.tabBar.list.length);
}
try { main(); } catch (e) { console.error('失败: ' + e.message); process.exit(1); }
