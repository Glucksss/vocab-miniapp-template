const storage = require('./utils/storage.js');

// 应用卡预览 / 模拟器环境可能缺少部分反馈类 wx 接口。
// 只在缺失时补静默空实现，真实微信环境一律用原生实现；
// 避免"点一下词卡就报 wx.showLoading is not a function"把答题流程卡死。
function ensureFeedbackApi() {
  if (typeof wx === 'undefined' || !wx) return;
  ['showToast', 'hideToast', 'showLoading', 'hideLoading', 'showModal',
    'showActionSheet', 'vibrateShort', 'setNavigationBarTitle'].forEach(function (name) {
    if (typeof wx[name] !== 'function') {
      try { wx[name] = function () {}; } catch (e) {}
    }
  });
}
ensureFeedbackApi();

App({
  globalData: {
    appName: '单词闯关',
  },
  onLaunch() {
    ensureFeedbackApi();
    storage.init();
  },
  // 切后台/关闭时把防抖未落盘的数据强制写入，避免丢进度
  onHide() { try { storage.flush(); } catch (e) {} },
});
