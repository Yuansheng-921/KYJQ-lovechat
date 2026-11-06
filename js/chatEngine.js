/* ============================================================
 * chatEngine.js — 聊天引擎 (v2 回合制)
 *
 * 回合机制（核心）：
 *   - 每次发送 = 一个回合；多条发送一次性发出 = 一个回合
 *   - 连续手动发送（5秒内下一条）自动合并为同一回合，避免回复过多
 *   - 每回合：随机回复 replyCountMin~replyCountMax 张主字卡
 *   - 每回合按概率额外触发：Emoji（可合并到某条文字或独立成条）、
 *     表情包（一张，可穿插任意位置）、拍一拍（系统消息）
 *
 * 回复单元 types: text(主字卡,可含emoji) | emoji(独立) | sticker(图片) | pat(系统消息)
 *
 * 钩子（扩展点）: beforeSend / beforeReply / afterReply / onTurnEnd
 * ============================================================ */

window.LoveChat = window.LoveChat || {};

(function (LC) {
  'use strict';

  const Storage = LC.Storage;

  /* ---- 系统拼词：语序模板表（36 个，用户定义） ----
   * 字母对应 config.js 的 LC.WORD_SYS_ORDER：F发语 S主语 A状语 D程度 M情态 P谓语 O客体 T语气
   * 匹配规则：抽中的分类集合（按基础语序排序成字母串）与模板的字母集合一致才算命中 */
  const WORD_TEMPLATES = [
    // 两词
    'SP', 'PO', 'PT', 'DP', 'MP', 'AP', 'FP', 'ST', 'DM', 'MO',
    // 三词
    'SPT', 'SDP', 'SMP', 'SAP', 'POT', 'DPT', 'DMP', 'MPO', 'FSP', 'FPT', 'AMP', 'APT',
    // 四词
    'SPOT', 'FSPO', 'SAMP', 'SDMP', 'FSPT', 'ADMP', 'DMPT', 'MPOT', 'SAPT',
    // 五词及以上
    'FSAPO', 'SADMP', 'SAMPO', 'FSPOT', 'SADMPOT',
  ];
  // 索引：分类集合（按基础语序排好序的字母串）→ 模板语序
  const WORD_TPL_MAP = (() => {
    const idx = {};
    LC.WORD_SYS_ORDER.forEach(([k], i) => { idx[k] = i; });
    const sortKey = (s) => s.split('').sort((a, b) => idx[a] - idx[b]).join('');
    const m = new Map();
    for (const t of WORD_TEMPLATES) m.set(sortKey(t), t);
    return m;
  })();

  const ChatEngine = {
    history: [],
    _hooks: {},
    _busy: false,            // 正在处理回合中
    _pending: [],            // 待处理回合的用户消息（合并窗口）
    _mergeTimer: null,       // 合并防抖计时器
    _statusTimer: null,      // 状态切换计时器

    async init() {
      this.history = (await Storage.get('history', [])) || [];
      this._hooks = {};
      this._busy = false;
      this._pending = [];
      // 恢复或启动状态循环
      this._startStatusLoop();
      // 启动主动发消息引擎
      this._initProactive();
    },

    /* ---- 钩子 ---- */
    use(plugin) {
      if (!plugin) return this;
      for (const k of Object.keys(plugin)) {
        if (typeof plugin[k] === 'function') {
          (this._hooks[k] = this._hooks[k] || []).push(plugin[k]);
        }
      }
      return this;
    },
    /** 主字卡抽取模块池：限制模式关闭（粉心）时并入"限制字卡"；开启（灰心）时不参与 */
    mainPoolMods() {
      return LC.config.restrictedMode ? ['main'] : ['main', 'restricted'];
    },
    async _runHook(name, ...args) {
      const fns = this._hooks[name]; if (!fns) return undefined;
      let res;
      for (const fn of fns) {
        try { res = await fn(...args); if (res !== undefined) return res; }
        catch (e) { console.warn('[LoveChat] hook', name, e); }
      }
      return res;
    },

    /* ---- 历史管理 ---- */
    getHistory() { return [...this.history]; },
    clearHistory() { this.history = []; Storage.set('history', []); },
    /** 按 id 删除单条消息（仅删该条，不影响其他） */
    deleteMessage(id) {
      const idx = this.history.findIndex(m => m.id === id);
      if (idx === -1) return false;
      this.history.splice(idx, 1);
      Storage.set('history', this.history);
      return true;
    },
    _addMsg(role, kind, content, extra = {}) {
      const msg = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        role, kind, content, time: Date.now(),
        ...extra,
      };
      this.history.push(msg);
      // 不再限制聊天记录条数上限（原 800 条截断已移除，改用条数提醒功能引导用户备份）
      Storage.set('history', this.history);
      return msg;
    },

    /* ---- 用户发送入口 ---- */

    /**
     * 用户发送单条消息（手动）
     * @param {string} text
     * @param {object} cbs 回调集
     * @param {object|null} quote 引用块 { content, role, kind }，参考微信引用
     */
    sendUserMessage(text, cbs = {}, quote = null) {
      const trimmed = (text || '').trim();
      if (!trimmed) return false;
      // 即使对方正在回复（_busy）也允许发送：消息立即显示+存储+累积到 _pending，
      // 由 _flushTurn 结尾衔接新回合（不启动合并计时器，避免和当前回合冲突）
      // 1. 立即显示并记录用户消息（引用信息存入 extra，不进入 _pending 影响回复逻辑）
      const userMsg = this._addMsg('me', 'text', trimmed, quote ? { quote } : {});
      cbs.onUserMessage && cbs.onUserMessage(userMsg);
      // 2. 累积到待处理回合
      this._pending.push({ text: trimmed, msg: userMsg });
      this._lastCbs = cbs;
      // busy 期间不启动合并计时器，等回合结束衔接
      if (this._busy) return true;
      // 3. 重置合并计时器
      if (this._mergeTimer) clearTimeout(this._mergeTimer);
      const win = LC.config.mergeWindow || 5000;
      // 先短暂等待后显示"正在输入"，到窗口期满再开始生成回复
      const showTypingAt = Math.min(1200, win * 0.4);
      setTimeout(() => {
        if (this._busy || !this._pending.length) return;
        cbs.onTypingStart && cbs.onTypingStart();
      }, showTypingAt);
      this._mergeTimer = setTimeout(() => this._flushTurn(cbs), win);
      return true;
    },

    /**d
     * 多条发送（一次性，作为单回合）
     * @param {string[]} texts
     */
    sendMultiMessage(texts, cbs = {}) {
      const list = (texts || []).map(t => (t || '').trim()).filter(Boolean);
      if (!list.length) return false;
      // 即使对方正在回复（_busy）也允许发送：消息立即显示+存储+累积到 _pending，
      // 由 _flushTurn 结尾衔接新回合（与 sendUserMessage 一致）
      const userMsgs = [];
      for (const t of list) {
        const m = this._addMsg('me', 'text', t);
        userMsgs.push(m);
        cbs.onUserMessage && cbs.onUserMessage(m);
      }
      this._pending.push(...list.map((t, i) => ({ text: t, msg: userMsgs[i] })));
      this._lastCbs = cbs;
      // busy 期间不启动回合，等当前回合结束衔接
      if (this._busy) return true;
      // 多条发送立即触发回合（无防抖）
      if (this._mergeTimer) { clearTimeout(this._mergeTimer); this._mergeTimer = null; }
      this._flushTurn(cbs);
      return true;
    },

    /**
     * 我发起拍一拍（与其他消息一样进入合并窗口，触发正常回复回合；
     * 拍一拍字卡在回合里按 patChance 概率作为系统消息出现，不再单独"回拍"）
     */
    sendPat(text, cbs = {}) {
      const trimmed = (text || '').trim();
      if (!trimmed) return false;
      // 即使对方正在回复也允许拍一拍（与文字消息一致），累积到 _pending 等回合衔接
      // 1. 立即显示我的拍一拍系统消息（直接显示文字内容，不拼"拍了拍我的"句子）
      const patMsg = this._addMsg('me', 'pat', trimmed);
      cbs.onUserMessage && cbs.onUserMessage(patMsg);
      // 2. 累积到待处理回合（拍一拍、文字、emoji、表情包之间可自由合并）
      this._pending.push({ text: '[拍一拍]', msg: patMsg, isPat: true });
      this._lastCbs = cbs;
      // busy 期间不启动合并计时器，等回合结束衔接
      if (this._busy) return true;
      // 3. 重置合并计时器（与 sendUserMessage 一致）
      if (this._mergeTimer) clearTimeout(this._mergeTimer);
      const win = LC.config.mergeWindow || 5000;
      const showTypingAt = Math.min(1200, win * 0.4);
      setTimeout(() => {
        if (this._busy || !this._pending.length) return;
        cbs.onTypingStart && cbs.onTypingStart();
      }, showTypingAt);
      this._mergeTimer = setTimeout(() => this._flushTurn(cbs), win);
      return true;
    },

    /**
     * 我发表情包（触发正常回合）
     */
    sendSticker(dataUrl, cbs = {}) {
      // 与 sendUserMessage 统一流程：始终由 ChatEngine 内部 _addMsg 入库一次，
      // 通过 onUserMessage 回调让 UI 渲染（修复历史上 UI 层重复 push 导致表情包重复入库的 bug）
      const userMsg = this._addMsg('me', 'sticker', dataUrl);
      cbs.onUserMessage && cbs.onUserMessage(userMsg);
      // 累积到待处理回合
      this._pending.push({ text: '[表情包]', msg: userMsg, isSticker: true });
      this._lastCbs = cbs;
      // busy 期间不启动合并计时器，等回合结束衔接（与 sendUserMessage 一致）
      if (this._busy) return true;
      if (this._mergeTimer) clearTimeout(this._mergeTimer);
      const win = LC.config.mergeWindow || 5000;
      setTimeout(() => { if (this._busy || !this._pending.length) return; cbs.onTypingStart && cbs.onTypingStart(); }, 1000);
      this._mergeTimer = setTimeout(() => this._flushTurn(cbs), win);
      return true;
    },

    /* ---- 回合处理 ---- */

    async _flushTurn(cbs) {
      if (this._busy) return;
      this._busy = true;
      if (this._mergeTimer) { clearTimeout(this._mergeTimer); this._mergeTimer = null; }
      const userInputs = [...this._pending];
      this._pending = [];

      // beforeSend 钩子
      const combined = userInputs.map(u => u.text).join('\n');
      await this._runHook('beforeSend', combined);

      // 1. 主字卡库空检测（限制模式关闭时，限制字卡并入主字卡池）
      if (!this.mainPoolMods().some(m => LC.CardLibrary.getAll(m).length)) {
        this._busy = false;
        cbs.onEmpty && cbs.onEmpty();
        return;
      }

      // 2. 计算回复条数
      let n = 1;
      const min = Math.max(1, LC.config.replyCountMin || 1);
      const max = Math.max(min, LC.config.replyCountMax || min);
      n = min + Math.floor(Math.random() * (max - min + 1));

      // 3. 生成回复单元序列
      const units = this._buildReplyUnits(n);

      // 4. 逐个渲染（带打字延迟）
      cbs.onTypingStart && cbs.onTypingStart();
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        // 每条之间停顿（i=0 用回复延迟的 0.6 倍作为合并窗口结束到首条的过渡；
        // i>0 用 unitGap 区间随机，受"条数间隔时间"设置控制）
        if (i > 0) cbs.onTypingStart && cbs.onTypingStart();
        await this._sleep(i === 0 ? Math.max(200, this._rollTypingDelay() * 0.6) : Math.max(200, this._rollUnitGap()));
        cbs.onTypingEnd && cbs.onTypingEnd();
        const msg = this._renderUnit(u);
        cbs.onUnit && cbs.onUnit(msg, u);
        await this._sleep(150);
      }
      cbs.onTypingEnd && cbs.onTypingEnd();

      // 5. afterReply / onTurnEnd 钩子
      await this._runHook('afterReply', units, userInputs);
      cbs.onTurnEnd && cbs.onTurnEnd();
      this._busy = false;
      // 6. 衔接：本回合进行中用户又发了消息（文字/拍一拍/表情包，已累积到 _pending），
      //    按 50/50 处理：
      //      50% → 触发新回合（800ms 短合并窗口让用户能连续追加）
      //      50% → 不触发新回合（消息已显示+存储，但不进入回复，对方"没回"）
      if (this._pending.length) {
        if (Math.random() < 0.5) {
          const carryCbs = this._lastCbs || cbs;
          this._mergeTimer = setTimeout(() => this._flushTurn(carryCbs), 800);
        } else {
          // 不触发新回合，清空累积队列
          this._pending = [];
        }
      }
    },

    /** 按权重随机抽一张（每次独立计算，不受之前抽过什么影响，权重不衰减） */
    _pickWeighted(cards) {
      const total = cards.reduce((s, c) => s + (c.weight || 1), 0);
      let r = Math.random() * total;
      for (const c of cards) { r -= (c.weight || 1); if (r <= 0) return c; }
      return cards[cards.length - 1];
    },

    /** 构建一条系统拼词消息（规则由用户确认）：
     *  1. 只从 8 个固定分类中"有卡且未被禁用"的分类里抽，随机 1~N 个分类（每种数量机会均等）
     *  2. 每个抽中的分类里各抽 1 张卡（一条消息内每个分类最多一张，跨消息可重复）
     *  3. 拿"分类组合"先套 36 个语序模板，套不中按基础语序 F→S→A→D→M→P→O→T 排
     *     （语序永远生效；原"语序模板辅助"开关已按用户要求移除）
     *  4. 排列顺序就是最终顺序，内容直接首尾相连不加标点
     *  5. 数量不受"拼词数量"设置影响（独立随机 1~8）；emoji 不与拼词混合（isWord 标记）
     */
    _buildSystemWordUnit(sysLib) {
      // 按分类字母分组（只认 8 个固定分类，其他分类的卡不参与）
      const keyOf = {};
      for (const [k, n] of LC.WORD_SYS_ORDER) keyOf[n] = k;
      const byKey = {};
      for (const c of sysLib) {
        const k = keyOf[c.category];
        if (k) (byKey[k] = byKey[k] || []).push(c);
      }
      // 已禁用的分类（长按分类标签切换）不参与抽取
      const disabledCats = new Set(Array.isArray(LC.config.wordDisabledCats) ? LC.config.wordDisabledCats : []);
      const avail = LC.WORD_SYS_ORDER
        .filter(([k, n]) => byKey[k] && byKey[k].length && !disabledCats.has(n))
        .map(([k]) => k);
      if (!avail.length) return null;
      // 洗牌决定抽取顺序，随机抽 1~N 个分类（N = 有卡的分类数，数量均等）
      const shuffled = [...avail];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const count = 1 + Math.floor(Math.random() * shuffled.length);
      const chosen = shuffled.slice(0, count); // 抽取顺序
      // 每个抽中的分类各抽一张（带权重）
      const drawn = {};
      for (const k of chosen) drawn[k] = this._pickWeighted(byKey[k]);
      // 决定最终语序：先套 36 个语序模板，套不中按基础语序 F→S→A→D→M→P→O→T 排（永远生效）
      const idx = {};
      LC.WORD_SYS_ORDER.forEach(([k], i) => { idx[k] = i; });
      const setKey = [...chosen].sort((a, b) => idx[a] - idx[b]).join('');
      const tpl = WORD_TPL_MAP.get(setKey);
      const order = tpl ? tpl.split('') : [...chosen].sort((a, b) => idx[a] - idx[b]);
      const content = order.map((k) => drawn[k].content).join('');
      return { kind: 'text', content, isWord: true, emojiMerged: false };
    },

    /** 构建一条自定义拼词消息
     *  规则（用户确认）：
     *  - 抽取数量 = 设置"拼词数量"区间内随机（上限不超过库里已有的张数）
     *  - 同一条消息内同一张卡不会重复出现（"宝贝宝贝"不可以）
     *  - 排列顺序 = 抽取顺序；内容直接首尾相连，不加空格/符号
     *  - 每条消息都是全新计算：不受之前抽过什么影响，权重不衰减
     *  - 同一回合的不同拼词消息之间可以出现同一张卡
     *  - isWord 标记：emoji 不会融合进拼词消息（只有主字卡可融合）
     */
    _buildCustomWordUnit(wordLib) {
      const min = Math.max(1, LC.config.wordCountMin || 2);
      const max = Math.max(min, LC.config.wordCountMax || 4);
      let cnt = min + Math.floor(Math.random() * (max - min + 1));
      cnt = Math.min(cnt, wordLib.length); // 库不够时只抽已有的
      const usedIds = new Set(); // 本条消息内已抽过的卡（不放回）
      let s = '';
      for (let j = 0; j < cnt; j++) {
        let card = null;
        // 重抽直到抽到本条消息内没出现过的卡（最多尝试 20 次防死循环）
        for (let tries = 0; tries < 20; tries++) {
          const c = LC.CardLibrary.selectRandom('customWord');
          if (c && !usedIds.has(c.id)) { card = c; break; }
        }
        if (!card) break;
        usedIds.add(card.id);
        s += card.content;
      }
      if (!s) return null;
      return { kind: 'text', content: s, isWord: true, emojiMerged: false };
    },

    /** 构建一条主字卡拼词消息
     *  规则（用户确认）：
     *  - 只拼主字卡自身的字卡，不掺自定义/系统拼词库
     *  - 抽取数量 = 设置"拼词数量"区间内随机（第一张已由槽位抽好，剩余从主字卡里补）
     *  - 同一条消息内同一张卡不会重复
     *  - 段与段之间隔两个空格
     *  - isWord 标记：显示"自由造句"气泡，emoji 不融合进这条
     */
    _buildMainWordUnit(firstCard) {
      const min = Math.max(1, LC.config.wordCountMin || 2);
      const max = Math.max(min, LC.config.wordCountMax || 4);
      let cnt = min + Math.floor(Math.random() * (max - min + 1));
      const usedIds = new Set([firstCard.id]);
      const parts = [firstCard.content];
      for (let j = 1; j < cnt; j++) {
        let card = null;
        // 重抽直到抽到本条消息内没出现过的卡（最多尝试 20 次防死循环）
        for (let tries = 0; tries < 20; tries++) {
          const c = LC.CardLibrary.selectRandom(this.mainPoolMods());
          if (c && !usedIds.has(c.id)) { card = c; break; }
        }
        if (!card) break;
        usedIds.add(card.id);
        parts.push(card.content);
      }
      return { kind: 'text', content: parts.join('  '), isWord: true, emojiMerged: false };
    },

    /** 构建回合回复单元序列 */
    _buildReplyUnits(n) {
      const units = [];
      // ===== 拼词槽位整合（用户确认的规则） =====
      // 外层：每个回复槽位掷硬币——主字卡 vs 拼词（五五开），回合内不强制配比，
      //       可能整回合全主字卡或全拼词，都是正常概率
      // 内层：掷到拼词后再掷一次硬币——自定义 vs 系统（五五开）。
      //       两类拼词各视为"一张卡"（发出的永远是组合结果，内部字卡不算完整字卡），
      //       不按内部字卡数量分比例
      const customLib = (LC.config.wordEnabled && LC.config.wordDisableCustom !== true)
        ? LC.CardLibrary.getAll('customWord') : [];
      const sysLib = (LC.config.wordEnabled && LC.config.wordDisableSystem !== true)
        ? LC.CardLibrary.getAll('systemWord').filter((c) => LC.WORD_SYS_CATS.includes(c.category)) : [];
      const wordAvail = customLib.length > 0 || sysLib.length > 0;
      for (let i = 0; i < n; i++) {
        if (wordAvail && Math.random() < 0.5) {
          let wordUnit = null;
          if (customLib.length && sysLib.length) {
            wordUnit = (Math.random() < 0.5)
              ? this._buildCustomWordUnit(customLib)
              : this._buildSystemWordUnit(sysLib);
          } else if (customLib.length) {
            wordUnit = this._buildCustomWordUnit(customLib);
          } else {
            wordUnit = this._buildSystemWordUnit(sysLib);
          }
          if (wordUnit) { units.push(wordUnit); continue; }
        }
        const card = LC.CardLibrary.selectRandom(this.mainPoolMods());
        if (card) {
          // ★ 主字卡拼词（二次概率）：开启后，五五开选中主字卡时按概率升级为
          //   "主字卡拼词"（多张主字卡隔两个空格连成一句），否则单发这张主字卡
          const mwChance = (LC.config.mainWordEnabled === true) ? (LC.config.mainWordChance || 0) : 0;
          if (mwChance > 0 && Math.random() < mwChance) {
            units.push(this._buildMainWordUnit(card));
            continue;
          }
          units.push({ kind: 'text', card, content: card.content, emojiMerged: false });
        }
      }
      // Emoji 触发
      const emojiLib = LC.CardLibrary.getAll('emoji');
      if (emojiLib.length && Math.random() < (LC.config.emojiChance || 0)) {
        const emojiCard = LC.CardLibrary.selectRandom('emoji');
        if (emojiCard) {
          // 50% 合并到某条文字，50% 独立成条（关闭"允许emoji与字卡融合发送"后只独立成条）
          // 拼词消息（isWord）不与 emoji 混合，只有主字卡可以融合
          const textUnits = units.filter(u => u.kind === 'text' && !u.emojiMerged && !u.isWord);
          if (LC.config.emojiFuse !== false && textUnits.length && Math.random() < 0.5) {
            const target = textUnits[Math.floor(Math.random() * textUnits.length)];
            if (Math.random() < 0.5) target.content = emojiCard.content + target.content;
            else target.content = target.content + emojiCard.content;
            target.emojiMerged = true;
          } else {
            // 独立 emoji 单元，随机插入位置
            const pos = Math.floor(Math.random() * (units.length + 1));
            units.splice(pos, 0, { kind: 'emoji', card: emojiCard, content: emojiCard.content });
          }
        }
      }
      // 表情包触发（一张，可穿插任意位置）
      const stickerLib = LC.CardLibrary.getAll('sticker');
      if (stickerLib.length && Math.random() < (LC.config.stickerChance || 0)) {
        const stickerCard = LC.CardLibrary.selectRandom('sticker');
        if (stickerCard) {
          const pos = Math.floor(Math.random() * (units.length + 1));
          units.splice(pos, 0, { kind: 'sticker', card: stickerCard, content: stickerCard.content });
        }
      }
      // 拍一拍触发（系统消息样式，与其他单元一样可穿插任意位置）
      const patLib = LC.CardLibrary.getAll('pat');
      if (patLib.length && Math.random() < (LC.config.patChance || 0)) {
        const patCard = LC.CardLibrary.selectRandom('pat');
        if (patCard) {
          const pos = Math.floor(Math.random() * (units.length + 1));
          units.splice(pos, 0, { kind: 'pat', card: patCard, content: patCard.content });
        }
      }
      return units;
    },

    /** 渲染单元为历史消息 */
    _renderUnit(u) {
      if (u.kind === 'pat') {
        return this._addMsg('partner', 'pat', u.content, { cardId: u.card?.id });
      }
      const extra = { cardId: u.card?.id };
      // 辅助标签（仅文字消息；存入消息记录，刷新后仍在）：
      //   word=拼词来源（只要来自拼词就标，不受辅助开关影响）
      //   logic=关联词辅助、mood=情绪辅助：各自独立判定 = 开关 + 应用范围匹配 + 每条消息 50% 概率触发
      if (u.kind === 'text') {
        const assist = {};
        if (u.isWord) assist.word = true;
        if (LC.config.moodAssistEnabled && this._assistScopeMatch('moodAssistEnabledScope', u.isWord)
          && LC.CardLibrary.getAll('moodAssist').length && Math.random() < 0.5) {
          const c = LC.CardLibrary.selectRandom('moodAssist');
          if (c) assist.mood = c.content;
        }
        if (LC.config.wordLogicLink && this._assistScopeMatch('wordLogicLinkScope', u.isWord)
          && LC.CardLibrary.getAll('logicAssist').length && Math.random() < 0.5) {
          const c = LC.CardLibrary.selectRandom('logicAssist');
          if (c) assist.logic = c.content;
        }
        if (assist.word || assist.mood || assist.logic) extra.assist = assist;
      }
      return this._addMsg('partner', u.kind, u.content, extra);
    },
    /** 辅助应用范围匹配：'all' 全部字卡 | 'word' 仅拼词 | 'main' 仅主字卡 */
    _assistScopeMatch(scopeKey, isWord) {
      const s = LC.config[scopeKey] || 'all';
      if (s === 'all') return true;
      return isWord ? s === 'word' : s === 'main';
    },

    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); },
    isBusy() { return this._busy; },

    /** 随机一个回复延迟值（毫秒），区间 [min, max]
     * 用途：合并窗口结束后到第一条回复的延迟 */
    _rollTypingDelay() {
      const min = Math.max(0, LC.config.typingDelayMin || 0);
      const max = Math.max(min, LC.config.typingDelayMax || min);
      if (max <= min) return min;
      return min + Math.random() * (max - min);
    },
    /** 随机一个条数间隔值（毫秒），区间 [unitGapMin, unitGapMax]
     * 用途：回合内每条回复之间的间隔；被动回合和主动回合共用
     * 旧 config 无此字段时回退到默认 400/1500ms */
    _rollUnitGap() {
      const min = Math.max(0, LC.config.unitGapMin ?? 400);
      const max = Math.max(min, LC.config.unitGapMax ?? 1500);
      if (max <= min) return min;
      return min + Math.random() * (max - min);
    },

    /* ---- 状态循环（独立于回合） ---- */
    _startStatusLoop() {
      if (this._statusTimer) clearTimeout(this._statusTimer);
      const tick = () => {
        const card = LC.CardLibrary.pickNewStatus();
        if (card && this._onStatusChange) this._onStatusChange(card.content);
        const min = LC.config.statusMinMs || 21600000;
        const max = LC.config.statusMaxMs || 43200000;
        const next = min + Math.random() * (max - min);
        this._statusTimer = setTimeout(tick, next);
      };
      // 启动：若无当前状态，立即取一个
      if (!LC.CardLibrary.getStatus() && LC.CardLibrary.getAll('status').length) {
        tick();
      } else if (LC.CardLibrary.getAll('status').length) {
        // 已有状态，延迟后切换
        const min = LC.config.statusMinMs || 21600000;
        const max = LC.config.statusMaxMs || 43200000;
        this._statusTimer = setTimeout(tick, min + Math.random() * (max - min));
      }
    },
    onStatusChange(fn) { this._onStatusChange = fn; },
    refreshStatus() { this._startStatusLoop(); },

    /* ---- 主动发消息引擎 ----
     * 逻辑：
     *   进入网站后开始首次计时（主动间隔的分钟数）
     *   计时到点 → 公平 50/50 决定发不发
     *     发：进入"主动间隔"冷却（分钟），并立即执行一次回合
     *     不发：进入"失败冷却"（分钟），计时到点再次判定，循环
     *   主动回合的条数 = replyCountMin/Max（与正常一致）
     */
    _proactiveTimer: null,
    _initProactive() {
      // 仅在启用时启动
      if (!LC.config.proactiveEnabled) { this._stopProactive(); return; }
      const delay = this._proactiveDelay();
      if (this._proactiveTimer) clearTimeout(this._proactiveTimer);
      this._proactiveTimer = setTimeout(() => this._proactiveRoll(), delay);
    },
    /** 随机一个主动发送间隔（毫秒），区间 [proactiveIntervalMin, proactiveIntervalMax] 分钟 */
    _proactiveDelay() {
      const lo = Math.max(1, LC.config.proactiveIntervalMin || 5);
      const hi = Math.max(lo, LC.config.proactiveIntervalMax || lo);
      return (lo + Math.random() * (hi - lo)) * 60 * 1000;
    },
    _stopProactive() {
      if (this._proactiveTimer) { clearTimeout(this._proactiveTimer); this._proactiveTimer = null; }
    },
    /** 设置变更时调用：若启用则重启计时，若关闭则停止 */
    refreshProactive() {
      this._stopProactive();
      if (LC.config.proactiveEnabled) this._initProactive();
    },
    _proactiveRoll() {
      // 公平 50/50 决定
      const send = Math.random() < 0.5;
      if (send) this._proactiveSend();
      else this._proactiveFailCooldown();
    },
    _proactiveSend() {
      if (this._busy) {
        // 当前正在回复中：跳过本次主动发送，等下一次机会（直接进主动间隔）
        this._proactiveCooldown();
        return;
      }
      // 主字卡空检测：同正常回合（限制模式关闭时，限制字卡并入主字卡池）
      if (!this.mainPoolMods().some(m => LC.CardLibrary.getAll(m).length)) {
        // 没字卡就当作失败冷却（让用户能察觉到"主动发"按钮已开但没字卡）
        this._proactiveFailCooldown();
        return;
      }
      // 直接构造一轮回复（不走 _flushTurn，因为不需要合并窗口）
      this._doProactiveTurn();
      // 进入主动间隔冷却（区间随机）
      this._proactiveTimer = setTimeout(() => this._proactiveRoll(), this._proactiveDelay());
    },
    _proactiveFailCooldown() {
      const min = Math.max(1, LC.config.failCooldownMin || 3);
      this._proactiveTimer = setTimeout(() => this._proactiveRoll(), min * 60 * 1000);
    },
    async _doProactiveTurn() {
      this._busy = true;
      const cbs = this._proactiveCbs || {};
      cbs.onTypingStart && cbs.onTypingStart();
      // 复用 _buildReplyUnits 逻辑
      let n = 1;
      const cmin = Math.max(1, LC.config.replyCountMin || 1);
      const cmax = Math.max(cmin, LC.config.replyCountMax || cmin);
      n = cmin + Math.floor(Math.random() * (cmax - cmin + 1));
      const units = this._buildReplyUnits(n);
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (i > 0) cbs.onTypingStart && cbs.onTypingStart();
        await this._sleep(i === 0 ? Math.max(200, this._rollTypingDelay() * 0.6) : Math.max(200, this._rollUnitGap()));
        cbs.onTypingEnd && cbs.onTypingEnd();
        const msg = this._renderUnit(u);
        cbs.onUnit && cbs.onUnit(msg, u);
        await this._sleep(150);
      }
      cbs.onTypingEnd && cbs.onTypingEnd();
      this._busy = false;
    },
    setProactiveCbs(cbs) { this._proactiveCbs = cbs; },

    /* ---- 抉择功能 ----
     * 用户发送一个"问题 + 多个选项"，AI 在设定的时间窗口内随机时刻回复选择结果
     * 数据结构：{ role, kind: 'choice', content: { question, options, mode, chosenIndices? } }
     *   mode: 'single'（默认，选 1 个） | 'multi'（随机选 1~全部 个）
     *   兼容旧数据：旧消息无 mode 字段视为 'single'，chosenIndex（单值）仍可读
     */
    _choiceTimers: [],     // 每个待处理抉择的 setTimeout 句柄

    /**
     * 用户发起抉择
     * @param {string} question
     * @param {string[]} options
     * @param {number} minutes - 时间窗口（分钟）
     * @param {string} mode - 'single' | 'multi'
     * @param {object} cbs - { onUserMessage, onChoiceReply }
     */
    sendChoice(question, options, minutes, mode, cbs = {}) {
      const q = (question || '').trim();
      const opts = (options || []).map(o => (o || '').trim()).filter(Boolean);
      const win = Math.max(0.1, Number(minutes) || 1); // 至少 ~6 秒
      const replyMode = mode === 'multi' ? 'multi' : 'single';
      if (!q || opts.length < 2) return false;
      // 1. 立即写入我方的抉择消息（mode 标记，便于渲染时显示单选/多选）
      const msg = this._addMsg('me', 'choice', { question: q, options: opts, mode: replyMode, chosenIndices: undefined });
      cbs.onUserMessage && cbs.onUserMessage(msg);
      // 2. 在 [8s, win*60s] 之间随机一个延迟后回复（最短 8 秒）
      const minMs = 8000;
      const maxMs = Math.max(minMs, win * 60 * 1000);
      const delayMs = minMs + Math.random() * (maxMs - minMs);
      const timer = setTimeout(() => {
        // 从列表中移除
        this._choiceTimers = this._choiceTimers.filter(t => t !== timer);
        // 计算 Ta 的选择
        let chosenIndices;
        if (replyMode === 'multi') {
          // 多选：随机选 1~N 个（至少 1 个，最多全部）
          const count = 1 + Math.floor(Math.random() * opts.length);
          const indices = opts.map((_, i) => i);
          // Fisher-Yates 洗牌
          for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
          }
          chosenIndices = indices.slice(0, count).sort((a, b) => a - b);
        } else {
          // 单选：随机 1 个
          const idx = Math.floor(Math.random() * opts.length);
          chosenIndices = [idx];
        }
        const reply = this._addMsg('partner', 'choice', { question: q, options: opts, mode: replyMode, chosenIndices });
        cbs.onChoiceReply && cbs.onChoiceReply(reply);
      }, delayMs);
      this._choiceTimers.push(timer);
      return true;
    },

    /** 取消所有未触发的抉择定时器（设置变更/切分类时调用） */
    cancelAllChoiceTimers() {
      for (const t of this._choiceTimers) clearTimeout(t);
      this._choiceTimers = [];
    },
  };

  LC.ChatEngine = ChatEngine;
})(window.LoveChat);
