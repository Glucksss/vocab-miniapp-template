# 词库来源与双入口

## 铁律：绝不编造释义

音标和释义只能来自用户提供的词表或声明了许可的开源词典。源里没有就留空，不要自己"补一个看起来合理"的意思。上架审的是用户能看到的内容，编造会直接误导学生。

## 入口 A：用户自己提供词表

支持 JSON / CSV / 每行一词的 txt。

JSON 示例（字段名可混用 `w/word/name`、`p/phonetic/usphone`、`m/meaning/translation/trans`）：
```json
[
  { "w": "apple", "p": "ˈæpl", "m": "n. 苹果", "v": 1, "u": 1 },
  { "w": "look forward to", "p": "", "m": "盼望，期待", "v": 1, "u": 2 }
]
```

CSV 表头至少包含 `word`，可选 `phonetic,meaning,volume,unit`。

调用：
```bash
node scripts/build_wordbank.js --input mywords.json --out <项目目录> --volume 1 --unit 0
```

## 入口 B：从开源词典生成

ECDICT（MIT 许可，可商用，需保留署名）CSV 表头：
`word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio`

先用词频或自己的词单筛选，再从 ECDICT 取音标和中文：
```bash
node scripts/build_wordbank.js --ecdict ecdict.csv --wordlist words.txt --out <项目目录> --volume 8 --unit 0
```

`--wordlist` 支持 JSON 数组或每行一个单词。生成器只做"按词取已有字段"，不做翻译、不做推断。

高考3500 常见 JSON 格式（`name/usphone/ukphone/trans`）：
```bash
node scripts/build_wordbank.js --gaokao GaoKao_3500.json --out <项目目录> --volume 8 --unit 0
```

## 生成结果

- `data/levels.js`：`[{id,v,u,w:[[word,phonetic,meaning],...]}]`，每 `--per-level` 词一关（默认 15）。
- `data/word_details.js`：基础词卡 `{word:{w,p,cn,en,collocations,synonyms}}`；`en`、搭配、同义词一律留空，等有可靠来源再补。
- `rich_lite.js`、`coll_add.js` 若不存在会建空对象。

## 授权与署名（上架合规）

| 来源 | 许可 | 小程序内必须做的事 |
|---|---|---|
| ECDICT | MIT | 保留来源署名（© 2025 Linwei） |
| 抗遗忘单词表 word.threeher.cn（译林词表） | CC BY 4.0 | 在用户可见位置署名，说明"已整理改编" |
| Princeton WordNet | WNL | 仅开发期使用，原始数据库不要打包进小程序 |
| 自写真题语料 | — | 不要整段打包原题原文，避免版权与审核风险 |

骨架里 `pages/index/index.wxml` 的 `source` 面板已预留署名文案，换词库时按实际来源改写这段。

## 固定搭配 / 同义替换的验收标准

- 固定搭配：核心词必须同时出现在同一句真题原文中；中文逐条核对；单词单独出现不算证据；派生词和无教学价值项剔除。宁可少收，不可编造。
- 同义替换：本地 WordNet 命中率极低（实测仅 3.1%，且多为缩写），不要批量塞进词卡。换更全词源或人工核对后再补。
