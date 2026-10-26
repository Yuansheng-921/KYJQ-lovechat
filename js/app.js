/* ============================================================
 * app.js — 应用入口 (v5)
 * 初始化各模块、加载配置、启动应用、接入状态循环
 *
 * v5 变更：存储层迁移到 IndexedDB，init() 全异步化
 *
 * ★ 扩展示例（钩子，无需改核心）：
 *   LC.ChatEngine.use({
 *     async beforeSend(text){ ... },          // 发送前可改写
 *     async afterReply(units, userInputs){ ... } // 回复后
 *   });
 * ============================================================ */

window.LoveChat = window.LoveChat || {};

(function (LC) {
  'use strict';

  const App = {
    async init() {
      try {
        // 0. URL 参数：?reset=1 强制清空所有数据
        if (new URLSearchParams(location.search).get('reset') === '1') {
          await LC.Storage.clearAll();
          history.replaceState(null, '', location.pathname);
          console.log('%c[LoveChat] 已清空全部数据（?reset=1）', 'color:#E75480;font-weight:bold;');
          return location.reload();
        }
        // 0.1 初始化存储层（打开 IndexedDB + 迁移旧 localStorage 数据）
        await LC.Storage.init();
        // 0.2 数据版本保护：检测版本变化但不强行清空——靠 _loadConfig 做兼容迁移
        const CUR_VERSION = LC.CUR_DATA_VERSION || 5;
        const dataVer = await LC.Storage.get('dataVersion', 0);
        if (dataVer === 0) {
          await LC.Storage.set('dataVersion', CUR_VERSION);
        } else if (dataVer !== CUR_VERSION) {
          await LC.Storage.set('dataVersion', CUR_VERSION);
          console.log(`%c[LoveChat] 数据版本从 ${dataVer} 升级到 ${CUR_VERSION}，保留旧数据并迁移配置`, 'color:#E75480;');
        }
        // 1. 配置（含 v3→v4 兼容处理：typingDelay 单值 → min/max；particles/antiRepeat 丢弃）
        LC.config = await this._loadConfig();
        // 2. 字卡库（多模块）+ 聊天引擎（异步初始化）
        await LC.CardLibrary.init();
        await LC.ChatEngine.init();
        // 信件投递引擎
        await LC.Letters.init();
        // 3. UI（防御：init 内部出错不阻断后续渲染）
        try { LC.UI.init(); } catch (e) { console.error('[LoveChat] UI.init 出错:', e); }
        // 3.1 更新信件投递红点（启动时可能有未读/补发信件）
        try { LC.UI._updateLettersBadge(); } catch (e) { console.error('[LoveChat] _updateLettersBadge 出错:', e); }
        // 4. 外观
        this._applyAppearance();
        // 5. 渲染（防御：单独 try，确保渲染互不影响）
        try { LC.UI.renderHeader(); } catch (e) { console.error('[LoveChat] renderHeader 出错:', e); }
        try { LC.UI.renderHistory(); } catch (e) { console.error('[LoveChat] renderHistory 出错:', e); }
        // 聊天记录条数提醒（超过 5000/8000 条时提示备份，异步不阻塞启动）
        try { LC.UI._checkHistoryReminder(); } catch (e) { console.error('[LoveChat] _checkHistoryReminder 出错:', e); }
        // 主动发消息回调接入
        LC.ChatEngine.setProactiveCbs({
          onTypingStart: () => LC.UI.showTyping(true),
          onTypingEnd: () => LC.UI.showTyping(false),
          onUnit: (m) => LC.UI._renderMessage(m),
        });
        // 信件投递回调接入：收到新信件（主动信/回信）后更新红点+信件列表
        LC.Letters.onLetter(() => {
          try { LC.UI._updateLettersBadge(); } catch (e) { console.error('[LoveChat] _updateLettersBadge 回调出错:', e); }
          try { LC.UI._renderLetterList(); } catch (e) { console.error('[LoveChat] _renderLetterList 回调出错:', e); }
        });
        // 6. 状态显示接入
        const st = LC.CardLibrary.getStatus();
        if (st) LC.UI.updateStatus(st.content);
        LC.ChatEngine.onStatusChange((text) => LC.UI.updateStatus(text));
        // 7. 首次提示
        const hasConfig = await LC.Storage.has('config');
        if (!hasConfig) {
          setTimeout(() => LC.UI._toast('左上☰管理字卡 / 右上⚙设置 / 底栏有拍一拍、表情包、多条发送', 4000), 600);
        }
        console.log('%c私语 v5%c 心意相连', 'font-size:20px;font-weight:bold;color:#E75480;', 'font-size:14px;color:#888;');
      } catch (e) {
        console.error('[LoveChat] 启动失败:', e);
      }
    },

    async _loadConfig() {
      const saved = await LC.Storage.get('config', null);
      const config = JSON.parse(JSON.stringify(LC.DEFAULT_CONFIG));
      if (saved) {
        // 旧版 typingDelay 单值迁移到 min/max
        if (typeof saved.typingDelay === 'number' && !saved.typingDelayMin) {
          saved.typingDelayMin = saved.typingDelay;
          saved.typingDelayMax = saved.typingDelay;
        }
        config.partner = { ...config.partner, ...(saved.partner || {}) };
        config.user = { ...config.user, ...(saved.user || {}) };
        // v6 迁移：旧默认头像 🌸/🌙 → ''（启用新的"空白小人胸像"默认头像）
        // 仅迁移等于旧默认值的头像，用户自定义的 emoji/图片头像不受影响
        if (config.partner && config.partner.avatar === '🌸') config.partner.avatar = '';
        if (config.user && config.user.avatar === '🌙') config.user.avatar = '';
        // 拷贝除 partner/user 外的所有顶层字段
        Object.keys(saved).forEach(k => {
          if (k !== 'partner' && k !== 'user' && k !== 'typingDelay') config[k] = saved[k];
        });
      }
      return config;
    },

    _applyAppearance() {
      LC.UI.setTheme(LC.config.theme);
      LC.UI.applyAccentColor();
      LC.UI.applyChatFontColor();
      LC.UI.applyBackground();
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
  } else {
    App.init();
  }
  LC.App = App;
})(window.LoveChat);
