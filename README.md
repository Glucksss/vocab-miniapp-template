# 单词闯关小程序模板

一套可直接复刻的微信小程序工程：背单词 + 五步地图闯关 + 宠物养成 + 盲盒抽卡 + 遗忘曲线复习 + 错词清剿。母版是已打磨完成的「译林单词闯关」，词库可整包替换成小学、初中、考研、四六级等任意词表。

## 怎么用

点击右上角 **Use this template → Create a new repository**，即可基于本模板创建自己的项目仓库；也可以直接 clone。

```bash
git clone https://github.com/<你的账号>/<你的新仓库>.git
cd <你的新仓库>
```

然后：

1. 把 `project.config.json` 里的 `touristappid` 换成正式 AppID。
2. 用 `scripts/build_wordbank.js` 生成 `data/levels.js`。
3. 用 `scripts/validate.js` 自检，再按 `references/launch-checklist.md` 完成后台配置。

## 目录

```
SKILL.md                       WorkBuddy 可直接加载的技能定义
scripts/scaffold.js            参数化创建新项目
scripts/build_wordbank.js      词库双入口生成器
scripts/validate.js            工程自检
references/                    玩法清单、词库来源、架构、上架清单
assets/gameplay-registry.json  17 个玩法与入口依赖
skeleton/                      完整小程序工程（词库已清空）
```

## 词库双入口

- **用户提供**：`node scripts/build_wordbank.js --input words.json --out <项目目录> --volume 1 --unit 1`
- **工具生成**：`node scripts/build_wordbank.js --ecdict ecdict.csv --wordlist words.txt --out <项目目录> --volume 8 --unit 0`

生成器只从来源取已有的音标和释义，**不编造**。源里没有就留空。

## 玩法增减

17 个玩法分核心层（首页 / 练习场 / 宝箱 / 宠物）和玩法层（打地鼠、限时风暴、Boss 战、单词拼图、安静背诵、遗忘复习、语境关、错词清剿、地图五步闯关等）。增删方法见 `references/gameplay-catalog.md`；删玩法务必同时改路由、入口卡片和跳转函数三处。

## 授权与署名

- ECDICT：MIT 许可，保留署名 © 2025 Linwei。
- 译林词表来自「抗遗忘单词表」word.threeher.cn，CC BY 4.0，已整理改编。
- WordNet 仅开发期使用，原始数据库不打包进小程序。
- 换词库时按实际来源改写 `skeleton/pages/index/index.wxml` 的 `source` 面板。

## 上架注意

代码侧已就绪，但 AppID、WechatSI 插件、真实广告位 ID、隐私指引、最低基础库、ICP 备案、类目选择、真机朗读验证必须在公众平台后台人工完成。详见 `references/launch-checklist.md`。

## 与 WorkBuddy Skill 的关系

本地已安装的用户级 Skill `vocab-miniapp-factory` 与仓库内容一致，并额外包含完整图片素材。直接在对话里说「用词库 X 复刻一个小学闯关小程序」即可触发，不必手工操作这些脚本。
