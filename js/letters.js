/**
 * 信件投递引擎（v5 新增）
 * 负责：信件数据管理、定时回复、主动写信、导出/导入
 *
 * 信件数据结构：
 * {
 *   id: string,                 // 唯一ID
 *   type: 'sent' | 'received',  // 寄出 / 收到
 *   content: string,            // 信件正文（多行）
 *   time: number,               // 发送时间戳
 *   replyToId: string|null,    // 若为回信，指向原信ID
 *   isReply: boolean,           // 是否为"回信"（我回他主动信 / 他回我信）
 *   isProactive: boolean,       // 是否为他主动发信
 *   read: boolean,              // 是否已读（仅 received 有意义，控制红点）
 *   favorite: boolean,          // 是否收藏
 * }
 *
 * 信件关系：
 * - 我主动写信 → sent, isReply=false
 * - 他主动写信 → received, isProactive=true, read=false
 * - 我回他主动信 → sent, isReply=true, replyToId=他主动信ID
 * - 他回我信 → received, isReply=true, replyToId=我的原信ID, read=false
 */
window.LoveChat = window.LoveChat || {};

(function (LC) {
  'use strict';

LC.Letters = {
  letters: [],
  // 待回复队列：{ replyToId, replyTime } — 我发信后等待他回信
  _pendingReplies: [],
  // 下次主动信时间戳；0=未设置（首次启动用主动间隔）
  _nextProactiveTime: 0,
  _timer: null,        // setTimeout 句柄
  _proactiveTimer: null,
  // UI 回调（由 app.js 注册）：信件生成后通知 UI 更新红点+列表
  _onLetterCbs: [],

  async init() {
    this.letters = await LC.Storage.get('letters', []);
    this._pendingReplies = await LC.Storage.get('pendingReplies', []);
    this._nextProactiveTime = await LC.Storage.get('nextProactiveTime', 0);
    // 启动时检查到期的回信和主动信
    this._checkDueOnStartup();
    this._scheduleTimers();
  },

  /** 注册 UI 回调：收到新信件（主动信/回信）后触发 */
  onLetter(cb) {
    if (typeof cb === 'function') this._onLetterCbs.push(cb);
  },
  /** 触发 UI 回调：通知 UI 更新红点+信件列表 */
  _notifyLetter(letter) {
    for (const cb of this._onLetterCbs) {
      try { cb(letter); } catch (e) { console.error('[LoveChat] onLetter 回调出错:', e); }
    }
  },

  /** 生成唯一ID */
  _genId() {
    return 'letter_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  },

  /** 区间随机整数 */
  _randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  /** 从主字卡抽取 N 条不重复，换行拼成信件正文 */
  _drawLetterContent(count) {
    const all = (LC.CardLibrary.data.main || []).slice();
    if (!all.length) return '（这封信是空的…）';
    // 加权洗牌后取前 count 条（不重复）
    const weighted = [];
    for (const c of all) {
      const w = Math.max(1, c.weight || 1);
      for (let i = 0; i < w; i++) weighted.push(c);
    }
    // Fisher-Yates 洗牌
    for (let i = weighted.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [weighted[i], weighted[j]] = [weighted[j], weighted[i]];
    }
    // 去重（同一字卡可能因权重出现多次）
    const seen = new Set();
    const lines = [];
    for (const c of weighted) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      if (c.content) lines.push(c.content);
      if (lines.length >= count) break;
    }
    // 如果字卡总数不够 count，就返回已有的
    return lines.join('\n') || '（这封信是空的…）';
  },

  /** 我主动写信 */
  async sendLetter(content) {
    const letter = {
      id: this._genId(),
      type: 'sent',
      content: content,
      time: Date.now(),
      replyToId: null,
      isReply: false,
      isProactive: false,
      read: true,
      favorite: false,
    };
    this.letters.push(letter);
    await LC.Storage.set('letters', this.letters);
    // 设置待回复
    const replyHours = LC.config.letterReplyMinHours + Math.random() * (LC.config.letterReplyMaxHours - LC.config.letterReplyMinHours);
    const replyTime = Date.now() + replyHours * 3600 * 1000;
    this._pendingReplies.push({ replyToId: letter.id, replyTime });
    await LC.Storage.set('pendingReplies', this._pendingReplies);
    this._scheduleTimers();
    return letter;
  },

  /** 我回他主动信（信件标记 isReply=true，同样会触发他回信） */
  async sendReply(originalLetterId, content) {
    const letter = {
      id: this._genId(),
      type: 'sent',
      content: content,
      time: Date.now(),
      replyToId: originalLetterId,
      isReply: true,
      isProactive: false,
      read: true,
      favorite: false,
    };
    this.letters.push(letter);
    await LC.Storage.set('letters', this.letters);
    // 我回他主动信后，他会回信
    const replyHours = LC.config.letterReplyMinHours + Math.random() * (LC.config.letterReplyMaxHours - LC.config.letterReplyMinHours);
    const replyTime = Date.now() + replyHours * 3600 * 1000;
    this._pendingReplies.push({ replyToId: letter.id, replyTime });
    await LC.Storage.set('pendingReplies', this._pendingReplies);
    this._scheduleTimers();
    return letter;
  },

  /** 他回我信（内部调用：从 pendingReplies 到期触发） */
  async _generateReply(replyToId) {
    const original = this.letters.find(l => l.id === replyToId);
    if (!original) return;
    const count = this._randInt(LC.config.letterReplyCountMin, LC.config.letterReplyCountMax);
    const content = this._drawLetterContent(count);
    const reply = {
      id: this._genId(),
      type: 'received',
      content: content,
      time: Date.now(),
      replyToId: replyToId,
      isReply: true,
      isProactive: false,
      read: false,
      favorite: false,
    };
    this.letters.push(reply);
    await LC.Storage.set('letters', this.letters);
    // 通知 UI 更新红点+信件列表
    this._notifyLetter(reply);
    return reply;
  },

  /** 他主动写信（内部调用：定时器到期触发） */
  async _generateProactive() {
    const count = this._randInt(LC.config.letterReplyCountMin, LC.config.letterReplyCountMax);
    const content = this._drawLetterContent(count);
    const letter = {
      id: this._genId(),
      type: 'received',
      content: content,
      time: Date.now(),
      replyToId: null,
      isReply: false,
      isProactive: true,
      read: false,
      favorite: false,
    };
    this.letters.push(letter);
    await LC.Storage.set('letters', this.letters);
    // 设置下次主动信时间
    const intervalHours = LC.config.letterProactiveMinHours + Math.random() * (LC.config.letterProactiveMaxHours - LC.config.letterProactiveMinHours);
    this._nextProactiveTime = Date.now() + intervalHours * 3600 * 1000;
    await LC.Storage.set('nextProactiveTime', this._nextProactiveTime);
    // 通知 UI 更新红点+信件列表
    this._notifyLetter(letter);
    return letter;
  },

  /** 启动时检查到期的回信和主动信（APP 关闭期间到期的在这里补发） */
  async _checkDueOnStartup() {
    const now = Date.now();
    let changed = false;
    // 检查到期回信
    const due = this._pendingReplies.filter(p => p.replyTime <= now);
    for (const p of due) {
      await this._generateReply(p.replyToId);
      changed = true;
    }
    if (due.length) {
      this._pendingReplies = this._pendingReplies.filter(p => p.replyTime > now);
      await LC.Storage.set('pendingReplies', this._pendingReplies);
    }
    // 检查到期主动信
    if (this._nextProactiveTime && this._nextProactiveTime <= now) {
      if (LC.config.letterProactiveContinuous) {
        // 连续主动写信：估算错过的周期数，全部补发
        // 用最小间隔估算最多错过多少个周期（上限 10 封，避免过多）
        const minIntervalMs = (LC.config.letterProactiveMinHours || 0.01) * 3600 * 1000;
        let missedCount = minIntervalMs > 0 ? Math.floor((now - this._nextProactiveTime) / minIntervalMs) : 0;
        missedCount = Math.min(missedCount, 10); // 上限
        for (let i = 0; i <= missedCount; i++) {
          await this._generateProactive();
        }
      } else {
        // 默认：只补发一封
        await this._generateProactive();
      }
      changed = true;
    }
    return changed;
  },

  /** 设置定时器（基于最近的到期时间） */
  _scheduleTimers() {
    // 清理旧定时器
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (this._proactiveTimer) { clearTimeout(this._proactiveTimer); this._proactiveTimer = null; }
    const now = Date.now();
    // 最近的待回复
    if (this._pendingReplies.length) {
      const next = Math.min(...this._pendingReplies.map(p => p.replyTime));
      const delay = Math.max(0, next - now);
      // setTimeout 最大 ~24.8 天，小时级没问题
      this._timer = setTimeout(() => this._onReplyDue(), delay);
    }
    // 主动信
    if (this._nextProactiveTime) {
      const delay = Math.max(0, this._nextProactiveTime - now);
      this._proactiveTimer = setTimeout(() => this._onProactiveDue(), delay);
    } else {
      // 首次启动：用主动间隔设置首次主动信
      const intervalHours = LC.config.letterProactiveMinHours + Math.random() * (LC.config.letterProactiveMaxHours - LC.config.letterProactiveMinHours);
      this._nextProactiveTime = now + intervalHours * 3600 * 1000;
      LC.Storage.set('nextProactiveTime', this._nextProactiveTime);
      const delay = this._nextProactiveTime - now;
      this._proactiveTimer = setTimeout(() => this._onProactiveDue(), delay);
    }
  },

  async _onReplyDue() {
    const now = Date.now();
    const due = this._pendingReplies.filter(p => p.replyTime <= now);
    for (const p of due) {
      await this._generateReply(p.replyToId);
    }
    if (due.length) {
      this._pendingReplies = this._pendingReplies.filter(p => p.replyTime > now);
      await LC.Storage.set('pendingReplies', this._pendingReplies);
    }
    this._timer = null;
    this._scheduleTimers();
  },

  async _onProactiveDue() {
    await this._generateProactive();
    this._proactiveTimer = null;
    this._scheduleTimers();
  },

  /** 标记信件已读（收到信才需要） */
  async markRead(letterId) {
    const l = this.letters.find(x => x.id === letterId);
    if (l && l.type === 'received' && !l.read) {
      l.read = true;
      await LC.Storage.set('letters', this.letters);
    }
  },

  /** 切换收藏 */
  async toggleFavorite(letterId) {
    const l = this.letters.find(x => x.id === letterId);
    if (l) {
      l.favorite = !l.favorite;
      await LC.Storage.set('letters', this.letters);
    }
    return l ? l.favorite : false;
  },

  /** 获取未读收到信数量（红点判断） */
  getUnreadCount() {
    return this.letters.filter(l => l.type === 'received' && !l.read).length;
  },

  /** 获取信件列表（按 type 筛选，按时间倒序） */
  getList(type, favoritesOnly = false) {
    let list = this.letters.filter(l => l.type === type);
    if (favoritesOnly) list = list.filter(l => l.favorite);
    return list.sort((a, b) => b.time - a.time);
  },

  /** 获取原信（回信点开时显示原信用） */
  getOriginal(replyToId) {
    if (!replyToId) return null;
    return this.letters.find(l => l.id === replyToId);
  },

  /** 导出信件为 HTML（按时间平铺，寄出/收到分区） */
  exportHTML() {
    const all = [...this.letters].sort((a, b) => a.time - b.time);
    const fmtTime = (ts) => {
      const d = new Date(ts);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
        + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    };
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    const lettersHTML = all.map(l => {
      const tag = l.type === 'sent' ? '寄出' : '收到';
      const replyTag = l.isReply ? ' ·回信' : '';
      const proactiveTag = l.isProactive ? ' ·主动' : '';
      return `<div class="letter-item ${l.type}">
        <div class="letter-meta">${fmtTime(l.time)} [${tag}${replyTag}${proactiveTag}]</div>
        <div class="letter-body">${esc(l.content)}</div>
      </div>`;
    }).join('\n');
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>信件归档 · 私语</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f5f0e8; color: #333; margin: 0; padding: 20px; }
  h1 { text-align: center; color: #E75480; }
  .container { max-width: 600px; margin: 0 auto; }
  .letter-item { background: #fff; margin: 12px 0; padding: 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .letter-item.sent { border-left: 4px solid #E75480; }
  .letter-item.received { border-left: 4px solid #4a90d9; }
  .letter-meta { font-size: 12px; color: #999; margin-bottom: 8px; }
  .letter-body { font-size: 15px; line-height: 1.8; white-space: pre-wrap; background-image: linear-gradient(to bottom, transparent 0, transparent calc(1.8em - 1px), #e0d8c8 calc(1.8em - 1px), #e0d8c8 1.8em); background-size: 100% 1.8em; padding: 0 8px; }
</style>
</head>
<body>
<h1>信件归档</h1>
<div class="container">
${lettersHTML || '<p style="text-align:center;color:#999;">暂无信件</p>'}
</div>
</body>
</html>`;
  },
};

})(window.LoveChat);
