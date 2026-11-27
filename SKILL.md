---
name: vocab-miniapp-factory
description: 复刻/改造「单词闯关」类微信小程序（译林版、小学、初中、考研、四六级等任意词库）。当用户要求从零做一个背单词闯关小程序、换一套词库重做、增减玩法（打地鼠/限时风暴/Boss战/错词清剿/遗忘复习/语境关/单词盲盒/宠物养成/五步地图闯关）、生成词库文件、或准备上架配置时使用。自带完整工程骨架、词库双入口生成器、玩法开关和上架清单。
agent_created: true
---

# 单词闯关小程序工厂

以已上架验证过的「译林单词闯关」为母版，把工程骨架、17 个页面、词库生成、玩法清单和上架清单沉淀成可复刻资产。目标是让新项目不用再从长对话里反复改 UI，而是通过参数化脚手架 + 明确清单完成。

## 何时使用

- 从零做一个「背单词 + 闯关 + 宠物养成」类微信小程序。
- 用小学 / 初中 / 高中 / 考研 / 四六级词库复刻一个新小程序。
- 给现有单词闯关项目增加或删除某个玩法。
- 转换用户提供的词表为小程序可直接用的 `data/levels.js`。
- 检查工程是否能上架、还差哪些后台配置。

## 工作流

### 1. 脚手架

从 `assets/skeleton/` 复制完整工程（17 页 + 7 个 utils + 素材 + 分包配置）：

```bash
node scripts/scaffold.js <目标目录> --name "小学英语闯关" --appid wx1234567890
```

只保留部分玩法时加 `--games game,spell,timed`。核心页 `index/practice/treasure/pet` 始终保留。目标目录已存在需加 `--force`。

脚手架只改路由和标题；入口卡片的增删按 `references/gameplay-catalog.md` 操作，改完必须核对没有死链。

### 2. 词库（双入口，缺一不可）

**入口 A — 用户提供**：用户给 JSON / CSV / txt 词表时，用 `--input` 生成。

**入口 B — 工具生成**：用 ECDICT 或高考3500 JSON 等公开源，用 `--ecdict` 或 `--gaokao` 生成，可配 `--wordlist` 按词单筛选。

```bash
node scripts/build_wordbank.js --input words.json --out <目标目录> --volume 1 --unit 1
node scripts/build_wordbank.js --ecdict ecdict.csv --wordlist words.txt --out <目标目录> --volume 8 --unit 0
```

两个入口都要保留：优先按用户提供的词表生成；用户没给时再走开源词典路线，并按 `references/wordbank-sources.md` 处理署名。

**铁律：不编造音标和释义。** 源里没有就留空。固定搭配必须有同句真题证据，同义词源不可靠就不要塞进词卡。

### 3. 玩法增减

完整清单与依赖见 `assets/gameplay-registry.json`，操作细则见 `references/gameplay-catalog.md`。

删玩法要同时改三处：`app.json` 路由、入口 WXML 卡片、对应 JS 跳转函数（以及 TabBar / 我的页入口）。加玩法要在 `pages/` 建四件套、注册路由、加入口卡，并让答题走 `storage.recordReview()` 以接入成长闭环。

### 4. 自校验（每次改动后必做）

```bash
node scripts/validate.js <项目目录>
```

检查语法、JSON、页面文件、分包路径、词库数据、主包体积、出题结构。改完还必须做数据级模拟：用 mock `wx` 环境加载真实 `storage.js`/`quiz.js`，验证答题、奖励、错词、翻倍幂等；静态检查查不出运行时 undefined。

模块契约见 `references/architecture.md`，其中的参数约定（原始数组 vs 转换对象、数组参数 vs 布尔参数）是历史踩坑点，不要凭印象改。

### 5. 上架

按 `references/launch-checklist.md` 逐项确认。代码侧已就绪，剩余都是后台配置：正式 AppID、WechatSI 插件、真实广告位 ID、隐私指引、最低基础库、ICP 备案、类目不要选游戏、真机逐个测朗读按钮。

## 资源索引

| 文件 | 用途 |
|---|---|
| `assets/skeleton/` | 完整小程序工程骨架（词库已清空，由生成器填） |
| `assets/gameplay-registry.json` | 17 个玩法、入口位置、utils 依赖 |
| `scripts/scaffold.js` | 参数化创建项目 |
| `scripts/build_wordbank.js` | 词库双入口生成器 |
| `scripts/validate.js` | 工程自检 |
| `references/gameplay-catalog.md` | 玩法增删步骤与踩坑 |
| `references/wordbank-sources.md` | 词源格式、授权、验收标准 |
| `references/architecture.md` | 模块契约与数据字段 |
| `references/launch-checklist.md` | 上架清单与真机走查 |

## 交付说明

生成或改造完成后，明确告诉用户：脚手架路径、词库来源与词数关卡数、启用的玩法、自检结果、以及上架还需用户自己处理的后台事项。不要把"代码已就绪"说成"已上架"。
