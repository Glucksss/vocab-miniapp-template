// 朗读模块：微信同声传译插件优先，网络发音降级，全程静默失败保护
// 重要：任何异常都不得冒泡到答题流程，否则会导致游戏卡住
// 用法：
//   tts.speakWord({ w, p, m })        读「英文 → 中文」
//   tts.speakMeaning(m)               只读中文（答题阶段用，不泄答案）
//   tts.speakEnglish(w)               只读英文
//   tts.stop()                        停止当前播放

let plugin = null;
let pluginTried = false;
let audioCtx = null;
let audioChecked = false;

function getPlugin() {
  if (pluginTried) return plugin;
  pluginTried = true;
  try {
    if (typeof requirePlugin === 'function') {
      plugin = requirePlugin('WechatSI');
    }
  } catch (e) {
    plugin = null;
  }
  return plugin;
}

// 能力检测：预览卡等环境可能没有 createInnerAudioContext
function getAudio() {
  if (audioChecked) return audioCtx;
  audioChecked = true;
  try {
    if (typeof wx === 'undefined' || !wx || typeof wx.createInnerAudioContext !== 'function') {
      audioCtx = null;
      return null;
    }
    audioCtx = wx.createInnerAudioContext();
    audioCtx.obeyMuteSwitch = false;
  } catch (e) {
    audioCtx = null;
  }
  return audioCtx;
}

// 清理中文释义：去掉词性前缀，最多读两个义项
function cleanMeaning(m) {
  try {
    const parts = String(m || '')
      .split(/[;；]/)
      .slice(0, 2)
      .map(function (p) { return p.trim().replace(/^[a-zA-Z]+\.\s*/, '').trim(); })
      .filter(function (p) { return !!p; });
    let s = parts.join('，');
    s = s.replace(/[\[\]【】]/g, '')
         .replace(/\.{2,}/g, '')
         .replace(/\s+/g, ' ')
         .trim();
    return s;
  } catch (e) {
    return String(m || '');
  }
}

// 播放一个音源，结束后回调 next
function playFile(src, gap, next) {
  const a = getAudio();
  if (!a) { setTimeout(next, 0); return; }
  let done = false;
  function finish() {
    if (done) return;
    done = true;
    try { a.offEnded(onEnded); } catch (e) {}
    try { a.offError(onError); } catch (e) {}
    setTimeout(next, gap || 100);
  }
  function onEnded() { finish(); }
  function onError() { finish(); }
  try {
    a.onEnded(onEnded);
    a.onError(onError);
    a.stop();
    a.src = src;
    a.play();
  } catch (e) {
    finish();
  }
  // 兜底：音源无回调时 6 秒后强制继续
  setTimeout(finish, 6000);
}

// 降级：有道公开词典发音。英文可靠；中文失败则静默跳过
function fallback(item, next) {
  const text = String(item.text || '').trim();
  if (!text) { next(); return; }
  if (!getAudio()) { next(); return; }
  const url = 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(text) + '&type=2';
  playFile(url, item.gap, next);
}

function runQueue(items, i, onDone) {
  if (i >= items.length) {
    try { if (typeof onDone === 'function') onDone(); } catch (e) {}
    return;
  }
  const item = items[i];
  const next = function () { runQueue(items, i + 1, onDone); };
  if (!getAudio()) {
    // 环境不支持音频：算作已完成，让上层照常推进
    try { if (typeof onDone === 'function') onDone(); } catch (e) {}
    return;
  }
  const p = getPlugin();

  if (p && typeof p.textToSpeech === 'function') {
    try {
      p.textToSpeech({
        lang: item.lang,
        tts: true,
        content: item.text,
        success: function (res) {
          if (res && res.tempFilePath) playFile(res.tempFilePath, item.gap, next);
          else fallback(item, next);
        },
        fail: function () { fallback(item, next); },
      });
    } catch (e) {
      fallback(item, next);
    }
  } else {
    fallback(item, next);
  }
}

function stop() {
  try {
    const a = getAudio();
    if (a) a.stop();
  } catch (e) {}
}

// 读英文 + 中文（对外接口，整体保护，绝不抛错）
function speakWord(word, opts) {
  try {
    if (!word) return;
    const o = opts || {};
    stop();
    const items = [];
    if (!o.chineseOnly && word.w) items.push({ text: word.w, lang: 'en_US', gap: 280 });
    if (!o.englishOnly && word.m) {
      const meaning = cleanMeaning(word.m);
      if (meaning) items.push({ text: meaning, lang: 'zh_CN', gap: 60 });
    }
    if (!items.length) { if (typeof o.onDone === 'function') o.onDone(); return; }
    runQueue(items, 0, o.onDone);
  } catch (e) {
    try { if (o && typeof o.onDone === 'function') o.onDone(); } catch (e2) {}
  }
}

// 只读中文（答题阶段用，不泄露英文答案）
function speakMeaning(m) {
  try {
    const meaning = cleanMeaning(m);
    if (!meaning) return;
    stop();
    runQueue([{ text: meaning, lang: 'zh_CN', gap: 0 }], 0);
  } catch (e) {}
}

// 只读英文
function speakEnglish(w) {
  try {
    if (!w) return;
    stop();
    runQueue([{ text: w, lang: 'en_US', gap: 0 }], 0);
  } catch (e) {}
}

module.exports = {
  speakWord, speakMeaning, speakEnglish, stop, cleanMeaning,
};
