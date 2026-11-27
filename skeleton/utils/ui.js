// 轻提示能力检测：应用卡预览 / 模拟器环境可能没有 showLoading、showToast 等接口。
// 这些只是反馈类 UI，缺了要静默降级，绝不能让答题或开词卡流程卡住。
function call(name, opts) {
  try {
    if (typeof wx !== 'undefined' && wx && typeof wx[name] === 'function') return wx[name](opts);
  } catch (e) {}
  return null;
}

function showLoading(opts) { return call('showLoading', opts); }
function hideLoading() { return call('hideLoading'); }
function showToast(opts) { return call('showToast', opts); }
function showModal(opts) { return call('showModal', opts); }

// 统一轻提示：应用卡预览里原生 wx.showToast 不会自动消失，会一直挂着。
// 改用页面内提示条（notifyText），2 秒后自动清空，真机/预览表现一致。
// 用法：页面 wxml 放 <view class="notify" wx:if="{{notifyText}}">{{notifyText}}</view>，
//       js 里 this 或 self 调 ui.notify(this, '提示文案')。
function notify(page, msg, duration) {
  if (!page || typeof page.setData !== 'function' || !msg) return;
  try {
    page.setData({ notifyText: msg });
    if (page._notifyTimer) clearTimeout(page._notifyTimer);
    page._notifyTimer = setTimeout(function () {
      try { page.setData({ notifyText: '' }); } catch (e) {}
      page._notifyTimer = null;
    }, duration || 2000);
  } catch (e) {}
}

// 答错软文案：A+C 方案——先鼓励，再点明"这词已收进错词本，还能拿回来"。
// 答错不涨成长、不加能量，靠这句话把"白错了"的感觉补回来。
const WRONG_TIPS = [
  '差一点！这词已收进错词本 ✊',
  '没关系，记住它就赢了！',
  '收进错词本啦，下次拿下它～',
  '别急，这词存好了，跑不掉！',
  '错过一次，就再也忘不掉它～',
];
function wrongTip() {
  return WRONG_TIPS[Math.floor(Math.random() * WRONG_TIPS.length)];
}

module.exports = { showLoading, hideLoading, showToast, showModal, call, notify, wrongTip };
