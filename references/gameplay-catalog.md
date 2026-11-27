# 玩法清单与增减方法

完整清单见 `assets/gameplay-registry.json`（17 个页面，含入口与依赖）。这里是操作说明。

## 玩法分层

- **核心层（不可删）**：`index` 首页、`practice` 练习场、`treasure` 宝箱仓库、`pet` 宠物我的。这四页构成 TabBar 和奖励闭环。
- **玩法层（可增删）**：打地鼠 `game`、单词拼图 `spell`、限时风暴 `timed`、Boss 战 `boss`、错词清剿 `clean`、错词本 `wrong`、遗忘复习 `review`、成就 `achieve`、语境关 `context`、单词盲盒 `cards`、大地图 `map`、五步闯关 `chapter`、安静背诵 `recite`。

## 增加一个玩法

1. 复制 `assets/skeleton/pages/<任一玩法>/` 四个文件到新页面目录，改名后重写 WXML/WXSS/JS。
2. 在 `app.json` 的 `pages` 注册新页面；要进 TabBar 再改 `tabBar.list`（最多 5 个）。
3. 在入口页（通常是 `pages/practice/practice.wxml`）增加一张卡片，`bindtap` 指向新页面的跳转函数，并在对应 JS 里实现该函数。
4. 数据写入统一走 `utils/storage.js` 的 `recordReview()`，这样答题会同时推进遗忘曲线、图鉴、宠物成长、补签卡进度；结算调 `checkBadges()`。
5. 按 `references/architecture.md` 核对依赖的 utils 是否已存在。
6. 跑 `node scripts/validate.js <项目目录>`。

## 删除一个玩法（必须三处一起改，否则会留下死链）

1. `app.json` → 从 `pages` 移除该页面。
2. 入口卡片 → 按 `gameplay-registry.json` 的 `entry` 字段，到对应 WXML（多数在 `pages/practice/practice.wxml` 的「挑战自我」「更多玩法」区块，首页入口在 `pages/index/index.wxml`）删掉那张卡片；同时删掉 JS 里对应的跳转函数。
3. TabBar / 我的页入口 → 如果该玩法挂在 `tabBar.list` 或 `pages/pet/pet.wxml` 的功能九宫格里，一并删掉。

页面文件本身可以保留不删（不会被路由到），但入口必须清干净。

## 玩法与数据依赖要点

| 玩法 | 关键函数 | 注意 |
|---|---|---|
| 打地鼠 | `quiz.makeChoiceQuestions(raw, n, pool)` | 传原始 `[w,p,m]` 数组，不可先转对象 |
| 反向题 | `quiz.makeReverseChoiceQuestions` | 结构为 `q=英文词`、`options=[{label:中文}]` |
| 拼写题 | `quiz.makeSpellQuestions(raw, n)` | 只留英文字母，避免空白块 |
| 错词清剿 | `storage.finishCleanRound(cleared[], missed[])` | 第一个参数是数组，不是布尔 |
| 断签 | `storage.streakInfo()` | 字段 `current/best/freezes/toFreeze` |
| 开箱翻倍 | `storage.doubleChestReward()` | 幂等，第二次返回 null |
| 每日额度 | `storage.bonusStatus()/expandBonusByAd()` | 默认 10 题 +2，用完 +1 不锁学习；扩容每天最多 5 次 |

## 已知坑（不要重犯）

- 非核心能力（语音、广告）必须能力检测 + `try/catch`，否则预览卡里会让答题流程卡死。
- `setData` 要显式赋每个模板字段，对象整体赋值不会自动展开到兄弟字段。
- 静态检查查不出运行时 undefined；改完必须做数据级模拟。
- 词卡异步加载失败时要走基础词卡兜底，不能留空白。
