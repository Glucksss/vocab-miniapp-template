// 激励视频广告封装：带完整能力检测，任何环境失败都静默降级，绝不阻塞游戏
// 正式发布后微信公众平台创建广告位，把 adUnitId 填到下面即可
// 预览卡/未开通流量主环境：show() 直接走 fail 回调，不抛错

const AD_UNIT = {
  revive: 'adunit-xxxxxxxxxxxxxxxx',  // 复活：生命耗尽
  freeze: 'adunit-xxxxxxxxxxxxxxxx',  // 补签：断签保护
  draw: 'adunit-xxxxxxxxxxxxxxxx',    // 抽卡：额外次数 / 收益翻倍（共用同一激励视频位）
};

// 收益翻倍（限时分数 / 宝箱能量碎片 / 终极礼能量）复用 draw 广告位。
// 这样上架只需在公众平台建 3 个广告位，不需要为翻倍单独再建一个。
const SCENE_ALIAS = { bonus: 'draw' };

let adChecked = false;
let canUseAd = false;

// 能力检测：wx.createRewardedVideoAd 是否存在
function checkEnv() {
  if (adChecked) return canUseAd;
  adChecked = true;
  try {
    canUseAd = typeof wx !== 'undefined' && wx && typeof wx.createRewardedVideoAd === 'function';
  } catch (e) {
    canUseAd = false;
  }
  return canUseAd;
}

const instances = {};

function getAd(scene) {
  if (!checkEnv()) return null;
  try {
    if (!instances[scene]) {
      const id = AD_UNIT[scene] || AD_UNIT.revive;
      instances[scene] = wx.createRewardedVideoAd({ adUnitId: id });
    }
    return instances[scene];
  } catch (e) {
    return null;
  }
}

// 播放激励视频。成功看完整 => onSuccess()；失败/取消/环境不支持 => onFail()
// 保证：任何情况下都会回调其中之一，且不抛异常
function show(scene, onSuccess, onFail) {
  const ok = onSuccess || function () {};
  const no = onFail || function () {};
  let settled = false;
  function done(cb) {
    if (settled) return;
    settled = true;
    try { cb(); } catch (e) {}
  }

  const ad = getAd(SCENE_ALIAS[scene] || scene);
  if (!ad) { done(no); return; }

  try {
    const onClose = function (res) {
      try { ad.offClose(onClose); } catch (e) {}
      // res.isEnded === true 才算看完
      if (res && res.isEnded === true) done(ok);
      else done(no);
    };
    ad.onClose(onClose);
    ad.load()
      .then(function () { return ad.show(); })
      .catch(function () {
        // 加载失败，尝试直接 show 一次
        ad.show().catch(function () { done(no); });
      });
  } catch (e) {
    done(no);
  }
}

module.exports = {
  isAvailable: checkEnv,
  show,
};
