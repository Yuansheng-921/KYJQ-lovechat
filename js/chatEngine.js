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
      if (this.history.length > 800) this.history = this.history.slice(-800);
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

      // 1. 主字卡库空检测
      const mainCards = LC.CardLibrary.getAll('main');
      if (!mainCards.length) {
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

    /** 构建回合回复单元序列 */
    _buildReplyUnits(n) {
      const units = [];
      // 主字卡 n 条
      for (let i = 0; i < n; i++) {
        const card = LC.CardLibrary.selectRandom('main');
        if (card) units.push({ kind: 'text', card, content: card.content, emojiMerged: false });
      }
      // Emoji 触发
      const emojiLib = LC.CardLibrary.getAll('emoji');
      if (emojiLib.length && Math.random() < (LC.config.emojiChance || 0)) {
        const emojiCard = LC.CardLibrary.selectRandom('emoji');
        if (emojiCard) {
          // 50% 合并到某条文字，50% 独立成条
          const textUnits = units.filter(u => u.kind === 'text' && !u.emojiMerged);
          if (textUnits.length && Math.random() < 0.5) {
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
      return this._addMsg('partner', u.kind, u.content, { cardId: u.card?.id });
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
        const min = LC.config.statusMinMs || 180000;
        const max = LC.config.statusMaxMs || 600000;
        const next = min + Math.random() * (max - min);
        this._statusTimer = setTimeout(tick, next);
      };
      // 启动：若无当前状态，立即取一个
      if (!LC.CardLibrary.getStatus() && LC.CardLibrary.getAll('status').length) {
        tick();
      } else if (LC.CardLibrary.getAll('status').length) {
        // 已有状态，延迟后切换
        const min = LC.config.statusMinMs || 180000;
        const max = LC.config.statusMaxMs || 600000;
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
      // 主字卡空检测：同正常回合
      const mainCards = LC.CardLibrary.getAll('main');
      if (!mainCards.length) {
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
