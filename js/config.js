/* ============================================================
 * config.js — 全局配置 & 默认数据 (v2 多模块结构)
 *
 * 字卡系统重构为「模块」概念：
 *   回复库：主字卡(文字) / Emoji / 表情库(图片)
 *   氛围感：拍一拍 / 状态
 * 所有模块内容统称"字卡"，只是格式不同。
 * ============================================================ */

window.LoveChat = window.LoveChat || {};

(function (LC) {
  'use strict';

  /* ---- 模块定义 ----
   * type: text(文字) | emoji | image(图片)
   * hasCategory: 是否支持分类（仅主字卡支持）
   * group: reply(回复库) | vibe(氛围感)
   */
  LC.MODULES = {
    main:    { key: 'main',    name: '主字卡', type: 'text',  hasCategory: true,  group: 'reply' },
    emoji:   { key: 'emoji',   name: 'Emoji',  type: 'emoji', hasCategory: false, group: 'reply' },
    sticker: { key: 'sticker', name: '表情库', type: 'image', hasCategory: false, group: 'reply' },
    pat:     { key: 'pat',     name: '拍一拍', type: 'text',  hasCategory: false, group: 'vibe' },
    status:  { key: 'status',  name: '状态',   type: 'text',  hasCategory: false, group: 'vibe' },
  };

  /* ---- 默认配置 ---- */
  LC.DEFAULT_CONFIG = {
    // v3 字段：partner/user.avatar 支持字符串(emoji) 或 { url, crop } 对象
    // v6：默认 avatar 改为 ''（空），表示使用"空白小人胸像"默认头像（中性灰背景，不跟主题色）
    partner: { name: '恋人', avatar: '' },
    user: { name: '我', avatar: '' },
    theme: 'light',
    accentColor: '#E75480',
    // v4 起 typingDelay 改为区间随机（毫秒）
    typingDelayMin: 800,
    typingDelayMax: 2000,
    // v4 新增：回合内每条回复之间的间隔（毫秒），独立于"回复延迟"
    // 被动回合和主动回合共用；旧 config 无此字段时回退到默认 400/1500
    unitGapMin: 400,
    unitGapMax: 1500,
    // v4 移除：particles、antiRepeat（旧数据残留会被忽略）
    // v2 字段
    replyCountMin: 1,        // 每回合回复条数下限
    replyCountMax: 3,        // 每回合回复条数上限
    mergeWindow: 5000,       // 连续手动发送合并窗口（毫秒）
    emojiChance: 0.35,       // 每回合触发 Emoji 的概率
    stickerChance: 0.25,     // 每回合触发表情包的概率
    patChance: 0.15,         // 每回合触发拍一拍的概率
    statusMinMs: 180000,     // 状态最短维持 3 分钟
    statusMaxMs: 600000,     // 状态最长维持 10 分钟
    // v4 新增：背景图
    backgroundImage: null,    // { url, fit: 'cover'|'contain'|'tile'|'center' } | null
    // v4 新增：主动发消息
    proactiveEnabled: false,
    proactiveIntervalMin: 5,  // 主动发送间隔下限（分钟）— 发送成功后冷却
    proactiveIntervalMax: 15, // 主动发送间隔上限（分钟）— 与下限组成随机区间
    failCooldownMin: 3,       // 失败冷却（分钟）— 随机判定"不发"后冷却
    // v4 新增：输入体验
    autoCloseInputAfterSend: false, // 发送后自动关闭输入展开弹窗
    // v5 新增：聊天辅助文字颜色（时间/拍一拍/抉择脚注/日期分隔）
    // null=跟随主题；可设为 #000000/#ffffff/#888888 等自定义色
    chatFontColor: null,
    // v5 新增：信件投递配置
    letterReplyMinHours: 17,    // 他回复我信件的时间下限（小时）
    letterReplyMaxHours: 21,   // 他回复我信件的时间上限（小时）
    letterReplyCountMin: 6,    // 他回信字卡条数下限
    letterReplyCountMax: 8,   // 他回信字卡条数上限
    letterProactiveMinHours: 20, // 他主动写信间隔下限（小时）
    letterProactiveMaxHours: 48, // 他主动写信间隔上限（小时）
    letterProactiveContinuous: false, // 连续主动写信：开启后错过多次时全部补发，不只发一封
    // v5 新增：自定义气泡 CSS（用户在"气泡设计"弹窗里编辑，写入 <style id="customBubbleCSS">）
    customBubbleCSS: '',
    // 拍一拍消息前缀标志（区分我/他），空字符串=无标志
    patMarkMe: '☆',
    patMarkPartner: '★',
  };

  /* ---- 预设字卡（首次启动自动载入） ----
   * 统一字卡结构：{ content, category?, weight }
   *   content: 文字内容 / emoji字符 / 图片dataURL
   */
  LC.DEFAULT_CARDS = {
    // 主字卡（文字，带分类）— v5 起首次使用为空，由用户自行添加/导入
    main: [],
    // Emoji（他可发送的 emoji）
    emoji: [
      { content: '😊', weight: 1 },
      { content: '🥰', weight: 1 },
      { content: '😘', weight: 1 },
      { content: '💕', weight: 1 },
      { content: '❤️', weight: 1 },
      { content: '🌙', weight: 1 },
      { content: '✨', weight: 1 },
      { content: '🥺', weight: 1 },
      { content: '😴', weight: 1 },
      { content: '🌹', weight: 1 },
      { content: '🍓', weight: 1 },
      { content: '🤭', weight: 1 },
    ],
    // 表情库（图片，默认空，用户自行导入）
    sticker: [],
    // 拍一拍（文字字卡，作为系统消息样式字卡直接显示）
    pat: [
      { content: '拍拍肩膀', weight: 1 },
      { content: '摸摸头', weight: 1 },
      { content: '拍拍后背', weight: 1 },
      { content: '摸摸手背', weight: 1 },
      { content: '揉揉脸蛋', weight: 1 },
    ],
    // 状态（显示在头部"在线"位置）
    status: [
      { content: '在线', weight: 1 },
      { content: '想念中', weight: 1 },
      { content: '发呆中', weight: 1 },
      { content: '等你消息', weight: 1 },
      { content: '心情不错', weight: 1 },
      { content: '有点困了', weight: 1 },
    ],
  };

  /* ---- 主题色预设 ----
   * v6：删除 紫罗兰/樱红/摩卡 三个色（原位置 2/6/7），保留 5 个 + 自定义按钮
   */
  LC.ACCENT_PRESETS = [
    { color: '#E75480', name: '玫瑰粉' },
    { color: '#FF8A65', name: '暖橘' },
    { color: '#26A69A', name: '青瓷' },
    { color: '#5C6BC0', name: '靛蓝' },
    { color: '#7E57C2', name: '夜紫' },
  ];

  LC.AVATAR_EMOJIS = ['🌸', '🌙', '💫', '🐱', '🐰', '🦊', '🐻', '🌷', '💙', '⭐', '☁️', '🍃'];

  /* ---- 拍一拍快捷词（我发起拍一拍时可快选，作为系统消息字卡直接显示） ---- */
  LC.PAT_QUICK = ['拍拍肩膀', '摸摸头', '拍拍后背', '摸摸手背'];

  /* ---- 拍一拍前缀标志可选符号（用户在"个性化"里选择，用于区分我/他） ---- */
  LC.PAT_MARKS = ['', '△', '○', '☆', '♡', '♢', '★', '♥', '☼', '☾', '✿', '❉'];

  /* ---- 数据版本（用于备份/迁移/兼容性检测） ----
   * 升级数据结构时增加此版本号，app.js 会自动检测旧版数据并清空重置
   */
  LC.CUR_DATA_VERSION = 5;

})(window.LoveChat);
