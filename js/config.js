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
   * hasCategory: 是否支持分类（主字卡 + 拼词库支持）
   * group: reply(回复库) | vibe(氛围感) | word(拼词库)
   */
  LC.MODULES = {
    main:       { key: 'main',       name: '主字卡',   type: 'text',  hasCategory: true,  group: 'reply' },
    restricted: { key: 'restricted', name: '限制字卡', type: 'text',  hasCategory: true,  group: 'reply' },
    emoji:      { key: 'emoji',      name: 'Emoji',    type: 'emoji', hasCategory: false, group: 'reply' },
    sticker:    { key: 'sticker',    name: '表情库',   type: 'image', hasCategory: false, group: 'reply' },
    pat:        { key: 'pat',        name: '拍一拍',   type: 'text',  hasCategory: false, group: 'vibe' },
    status:     { key: 'status',     name: '状态',     type: 'text',  hasCategory: false, group: 'vibe' },
    logicAssist:{ key: 'logicAssist', name: '关联词辅助', type: 'text', hasCategory: false, group: 'vibe' },
    moodAssist: { key: 'moodAssist', name: '情绪辅助',  type: 'text',  hasCategory: false, group: 'vibe' },
    customWord: { key: 'customWord', name: '自定义拼词', type: 'text', hasCategory: true, group: 'word' },
    systemWord: { key: 'systemWord', name: '系统拼词',  type: 'text', hasCategory: true, group: 'word' },
  };

  /* 系统拼词的 8 个固定分类（顺序 = 基础语序 F→S→A→D→M→P→O→T）
   * 由程序自动创建，不可删除/改名/新增；语序模板只认这 8 个 */
  LC.WORD_SYS_ORDER = [
    ['F', '发语引导'],
    ['S', '主语/称呼'],
    ['A', '时间/处所状语'],
    ['D', '程度限定'],
    ['M', '情态/否定'],
    ['P', '谓语核心'],
    ['O', '客体/人称'],
    ['T', '语气收尾'],
  ];
  LC.WORD_SYS_CATS = LC.WORD_SYS_ORDER.map((d) => d[1]);

  /* ---- 默认配置 ---- */
  LC.DEFAULT_CONFIG = {
    // v3 字段：partner/user.avatar 支持字符串(emoji) 或 { url, crop } 对象
    // v6：默认 avatar 改为 ''（空），表示使用"空白小人胸像"默认头像（中性灰背景，不跟主题色）
    partner: { name: '未命名', avatar: '' },
    user: { name: '我', avatar: '' },
    theme: 'light',
    accentColor: '#E75480',
    // v4 起 typingDelay 改为区间随机（毫秒）
    typingDelayMin: 5000,
    typingDelayMax: 7000,
    // v4 新增：回合内每条回复之间的间隔（毫秒），独立于"回复延迟"
    // 被动回合和主动回合共用；旧 config 无此字段时回退到默认 10000/15000
    unitGapMin: 10000,
    unitGapMax: 15000,
    // v4 移除：particles、antiRepeat（旧数据残留会被忽略）
    // v2 字段
    replyCountMin: 1,        // 每回合回复条数下限
    replyCountMax: 4,        // 每回合回复条数上限
    mergeWindow: 5000,       // 连续手动发送合并窗口（毫秒）
    emojiChance: 0.30,       // 每回合触发 Emoji 的概率
    stickerChance: 0.30,     // 每回合触发表情包的概率
    patChance: 0.30,         // 每回合触发拍一拍的概率
    statusMinMs: 21600000,   // 状态最短维持 6 小时
    statusMaxMs: 43200000,   // 状态最长维持 12 小时
    // v4 新增：背景图
    backgroundImage: null,    // { url, fit: 'cover'|'contain'|'tile'|'center' } | null
    // v4 新增：主动发消息
    proactiveEnabled: false,
    proactiveIntervalMin: 3,  // 主动发送间隔下限（分钟）— 发送成功后冷却
    proactiveIntervalMax: 10, // 主动发送间隔上限（分钟）— 与下限组成随机区间
    failCooldownMin: 3,       // 失败冷却（分钟）— 随机判定"不发"后冷却
    // v4 新增：输入体验
    autoCloseInputAfterSend: false, // 发送后自动关闭输入展开弹窗
    // v5 新增：聊天辅助文字颜色（时间/拍一拍/抉择脚注/日期分隔）
    // null=跟随主题；可设为 #000000/#ffffff/#888888 等自定义色
    chatFontColor: null,
    // v5 新增：信件投递配置
    letterReplyMinHours: 12,    // 他回复我信件的时间下限（小时）
    letterReplyMaxHours: 24,   // 他回复我信件的时间上限（小时）
    letterReplyCountMin: 5,    // 他回信字卡条数下限
    letterReplyCountMax: 8,   // 他回信字卡条数上限
    letterProactiveMinHours: 72, // 他主动写信间隔下限（小时）
    letterProactiveMaxHours: 168, // 他主动写信间隔上限（小时）
    letterProactiveContinuous: false, // 连续主动写信：开启后错过多次时全部补发，不只发一封
    // v5 新增：自定义气泡 CSS（用户在"气泡设计"弹窗里编辑，写入 <style id="customBubbleCSS">）
    customBubbleCSS: '',
    // 拍一拍消息前缀标志（区分我/他），空字符串=无标志
    patMarkMe: '☆',
    patMarkPartner: '★',
    // 拼词功能（具体逻辑后续开发，先存配置）
    wordEnabled: false,        // 开启拼词功能
    wordCountMin: 2,           // 拼词数量下限（条）
    wordCountMax: 4,           // 拼词数量上限（条）
    wordDisableSystem: false,  // 禁用系统拼词
    wordDisableCustom: false,  // 禁用自定义拼词
    mainWordEnabled: false,   // 开启主字卡拼词（用主字卡自身的字卡拼接成一句）
    mainWordChance: 0.5,      // 主字卡拼词概率：五五开选中主字卡后，按此概率升级为主字卡拼词
    wordDisabledCats: [],      // 系统拼词已禁用的分类名（长按分类标签切换，禁用的分类不参与抽取）
    wordLogicLink: false,      // 开启逻辑关联词辅助
    restrictedMode: false,     // 限制模式：true=开启（限制字卡不参与自动抽取）；false=关闭（并入主字卡抽取）
    wordLogicLinkScope: 'all', // 逻辑关联词辅助应用范围：'all' 全部字卡 | 'word' 仅拼词 | 'main' 仅主字卡
    moodAssistEnabled: false,  // 开启情绪辅助
    moodAssistEnabledScope: 'all', // 情绪辅助应用范围：'all' 全部字卡 | 'word' 仅拼词 | 'main' 仅主字卡
    // Emoji 与字卡融合发送（true=可融合进文字或独立成条；false=只独立成条）
    emojiFuse: true,
  };

  /* ---- 系统拼词预设字卡 ----
   * 按 [大分类, 小分类, '卡1、卡2、…'] 组织（与用户清单一一对应），
   * 下方展开成标准字卡数组；小分类仅整理用，不参与抽取
   */
  const SYS_WORD_PRESETS = [
    // F 发语引导
    ['发语引导', '话题开启', '对了、话说、哦对、哎、喂'],
    ['发语引导', '承接附和', '对啊、可不是、害、好吧、确实'],
    ['发语引导', '停顿提醒', '不是、等等'],
    // S 主语/称呼
    ['主语/称呼', '人称', '我、你、咱、我们、他、她、它、他们'],
    ['主语/称呼', '关系称呼', '宝宝、亲爱的、朋友、你这家伙'],
    ['主语/称呼', '指示', '这、那'],
    // A 时间/处所状语
    ['时间/处所状语', '时间', '今天、昨天、明天、这会儿、刚才、现在、以后、之前'],
    ['时间/处所状语', '处所', '在这里、在家、去公司、路上、外面、里面'],
    // D 程度限定
    ['程度限定', '强程度', '超、特别、非常、真的、太'],
    ['程度限定', '中程度', '挺、蛮、还、可'],
    ['程度限定', '弱程度', '有点、稍微'],
    ['程度限定', '否定倾向', '不太'],
    // M 情态/否定
    ['情态/否定', '否定标记', '不、没、别、未、无、不要、不能、不会、不可以、不必、不应该、不用、没有'],
    ['情态/否定', '肯定情态', '要、能、会、可以、必须、应该、得(děi)、用'],
    // P 谓语核心
    ['谓语核心', '中性日常动作', '吃、睡、上班、下班、出门、回家、休息、洗澡、洗漱、喝水、打、看、刷、听、走路、坐车、加班、摸鱼、发呆、起床'],
    ['谓语核心', '正向互动动作', '想、爱、贴贴、抱抱、亲亲、夸、陪、等、找、帮、接、送、早安、晚安、惦记'],
    ['谓语核心', '负向状态动作', '生气、难过、哭、累、困、饿、烦、怕、嫌弃、无语、头疼、不舒服'],
    ['谓语核心', '正向情绪状态', '开心、舒服、惬意、惊喜、感动、安心、喜欢、可爱、好看、棒'],
    // O 客体/人称
    ['客体/人称', '人称', '我、你、咱、我们、他、她、它、他们'],
    ['客体/人称', '关系称呼', '宝宝、亲爱的、朋友、你这家伙'],
    ['客体/人称', '指示', '这、那'],
    ['客体/人称', '实体事物', '饭、觉、班、游戏、剧、手机、歌、快递、外卖、水'],
    ['客体/人称', '事件场景', '天气、聚会、逛街、散步、工作'],
    // T 语气收尾
    ['语气收尾', '陈述/感叹', '啊、呀、哦、呐、啦、了'],
    ['语气收尾', '疑问', '吗、呢、嘛'],
    ['语气收尾', '祈使/商量', '吧、呗'],
  ];

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
    // 拼词库（自定义：默认空；系统：上方 SYS_WORD_PRESETS 展开的 170 张预设）
    customWord: [],
    systemWord: SYS_WORD_PRESETS.flatMap(([category, subCat, str]) =>
      str.split('、').map(content => ({ content, category, subCat, weight: 1 }))),
    // 情绪辅助预设：51 个情绪词（顺序已按用户要求打乱，进站自带）
    moodAssist: '惊喜、忐忑、五味杂陈、恼火、淡然、狐疑、欣慰、不屑、黯然、惊讶、羞涩、愉悦、笃定、失落、惶恐、郑重、百感交集、悻悻、释然、反感、落寞、愧疚、震怒、怀疑、平静、诧异、尴尬、焦虑、欣喜、烦躁、沉痛、窘迫、疑惑、随意、害怕、难过、恍然、歉意、鄙夷、窃喜、迷茫、怅然、迟疑、嫌恶、崩溃、心虚、困惑、淡漠、傲慢、生气、憎恶'.split('、').map(content => ({ content, weight: 1 })),
    // 关联词辅助预设：12 对关联词（一对一张卡，"前半...后半"，进站自带；
    // 用作消息下方的语境提示标签，不拼进回复文本，故保持成对以保证指向完整）
    logicAssist: '因为...所以、虽然...但是、如果...那么、只要...便能、只有...才能、除非...否则、不但...而且、不仅...并且、既然...那就、与其...不如、尽管...仍然、由于...因此'.split('、').map(content => ({ content, weight: 1 })),
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
