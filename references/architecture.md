# 工程架构与数据契约

## 目录

```
<项目>/
├── app.json              页面/分包/TabBar/插件/预下载规则
├── project.config.json   appid 与编译设置
├── pages/                17 个页面（四件套 js/wxml/wxss/json）
├── utils/
│   ├── storage.js        本地存档与全部成长数据（核心）
│   ├── quiz.js           组卷与题型生成
│   ├── wordCard.js       词卡统一加载器（主包 + 分包）
│   ├── volPicker.js      册次/单元选择器，运行时注入函数与字段
│   ├── tts.js            微信同声传译插件优先，有道 TTS 降级
│   ├── ad.js             激励视频封装，三场景复用 draw 广告位
│   └── ui.js             提示、loading、轻通知
├── data/                 levels / word_details / rich_lite / coll_add
└── pkgWordA|B/           词卡详情分包（load 页 + data/details.js）
```

## storage.js 关键 API

```js
recordReview(word, right)  // 枢纽：遗忘排期 + 图鉴 + 成长 + 能量 + 补签卡进度
addWrong(word)             // 由页面显式调用，recordReview 不会自动写入错词本
bonusStatus() / expandBonusByAd()
openChest(tier, perfect) / doubleChestReward()   // 后者幂等
drawCard(word, minRarity) / drawStatus()
feedPet() / petInfo() / checkEvolution()
equipStatus() / craftEquip() / toggleEquip()
markUltimateReady() / claimUltimate() / doubleUltimateReward()
finishCleanRound(cleared[], missed[]) / getStubbornWords()
streakInfo() / restoreStreakByAd()
checkBadges() / getBadges()
flush() / saveNow()        // save 有 200ms 防抖，测试跨天要先 flush
```

## quiz.js 参数约定

| 函数 | 第一个参数 | 产出结构 |
|---|---|---|
| `makeChoiceQuestions(words, n, pool)` | 原始 `[w,p,m]` 数组 | `q=中文`，`options=英文` |
| `makeReverseChoiceQuestions(words, n, pool)` | 原始数组 | `q=英文`，`options=[{label:中文}]` |
| `makeForwardChoiceQuestions(words, n, pool)` | 原始数组 | 正向选义 |
| `makeSpellQuestions(words, n)` / `makeTypingQuestions` | 原始数组 | `letters` / `q=中文释义`, `answer=英文` |

所有 `make*` 函数内部会 `toWord(item)`，传已转换的对象会导致 `q` 为空。

## wordCard.js 加载链

`localDetails` → `rich_lite` → `levels` 补音标/中文 → `coll_add` 补固定搭配 → 按需加载 `pkgWordA/pkgWordB` 分包。已有搭配的词卡不会被 `coll_add` 覆盖。

## 能量经济

- 唯一铸币厂是答题：额度内答对 +2，额度外用完 +1；答错不加能量、不加成长。
- 消耗出口：喂食 3、抽卡 10、装扮合成。
- 装扮只给能量产出 +8%~35% 的效率，不做准入门槛。

## 页面推进

所有答题页都要有 `qIndex + 1` 或等价推进分支；看词卡的关闭按钮只关词卡，不直接跳题，但要重新挂上推进定时器，避免卡死。
