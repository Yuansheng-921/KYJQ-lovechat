/* ============================================================
 * cardLibrary.js — 字卡库管理 (v2 多模块)
 * 职责：各模块字卡增删改查、分类管理、查重去重、加权抽取、
 *       按分类/全量导出、按分组/全量导入
 *
 * 模块：main(主字卡) / emoji / sticker(表情库) / pat(拍一拍) / status(状态)
 * ============================================================ */

window.LoveChat = window.LoveChat || {};

(function (LC) {
  'use strict';

  const Storage = LC.Storage;
  const MODULE_KEYS = Object.keys(LC.MODULES);

  const CardLibrary = {
    // 各模块字卡：{ main:[], emoji:[], sticker:[], pat:[], status:[] }
    data: {},
    // 各模块最近使用记录（不重复窗口）
    _recent: {},
    // 当前状态卡（运行时）
    _currentStatus: null,

    /* ---- 初始化（异步：IndexedDB 读取） ---- */
    async init() {
      const saved = await Storage.get('cards', null);
      if (Array.isArray(saved)) {
        // v1 兼容：旧版 cards 是扁平数组，迁移到 main 模块；
        // 新模块（emoji/sticker/pat/status）补上预设默认，避免迁移后为空
        this.data = {};
        this.data.main = saved.map((c, i) => this._norm(c, 'main', i));
        for (const k of MODULE_KEYS) {
          if (k === 'main') continue;
          const defs = LC.DEFAULT_CARDS[k] || [];
          this.data[k] = defs.map((c, i) => this._norm(c, k, i));
        }
        this.save();
      } else if (saved && typeof saved === 'object') {
        // 合并保存数据与模块定义（兼容新增模块）
        this.data = {};
        for (const k of MODULE_KEYS) {
          this.data[k] = Array.isArray(saved[k]) ? saved[k].map((c, i) => this._norm(c, k, i)) : [];
        }
      } else {
        // 首次：载入预设
        this.data = {};
        for (const k of MODULE_KEYS) {
          const defs = LC.DEFAULT_CARDS[k] || [];
          this.data[k] = defs.map((c, i) => this._norm(c, k, i));
        }
        this.save();
      }
      // ★ v4 清理：sticker 模块历史上可能残留了非 dataURL 的损坏数据 (如 '[object File]')，
      // 直接渲染会触发 404 请求。此处过滤掉非法 content, 并自动保存。
      if (Array.isArray(this.data.sticker)) {
        const before = this.data.sticker.length;
        this.data.sticker = this.data.sticker.filter(c => {
          const v = (c && typeof c.content === 'string') ? c.content : '';
          return v.startsWith('data:image/');
        });
        if (this.data.sticker.length !== before) {
          console.warn(`[LoveChat] 清理了 ${before - this.data.sticker.length} 条损坏 sticker 数据`);
          this.save();
        }
      }
      // 加载最近使用记录
      this._recent = (await Storage.get('recent', {})) || {};
      for (const k of MODULE_KEYS) if (!this._recent[k]) this._recent[k] = [];
      // 加载空分类记录
      this._emptyCats = (await Storage.get('emptyCats', [])) || [];
      // 加载当前状态
      this._currentStatus = await Storage.get('currentStatus', null);
    },

    _saveRecent() { Storage.set('recent', this._recent); },

    /** 规范化字卡 */
    _norm(card, module, index) {
      const mod = LC.MODULES[module] || {};
      return {
        id: card.id || ('card_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '_' + index),
        module,
        content: String(card.content ?? card.text ?? '').trim(),
        category: mod.hasCategory ? (String(card.category || '').trim() || '未分类') : '',
        weight: Math.max(1, Math.min(10, Number(card.weight) || 1)),
        createdAt: card.createdAt || Date.now(),
        useCount: card.useCount || 0,
        lastUsedAt: card.lastUsedAt || null,
      };
    },

    save() { Storage.set('cards', this.data); },

    /* ---- 通用 CRUD ---- */

    getAll(module) { return [...(this.data[module] || [])]; },

    getById(module, id) { return (this.data[module] || []).find(c => c.id === id) || null; },

    add(module, cardData) {
      if (!this.data[module]) this.data[module] = [];
      const card = this._norm(cardData, module, this.data[module].length);
      if (!card.content) return null;
      this.data[module].push(card);
      this.save();
      return card;
    },

    /** 批量添加（换行分隔，用于文字/emoji模块） */
    addBatch(module, rawText) {
      if (!this.data[module]) this.data[module] = [];
      const lines = String(rawText).split('\n').map(s => s.trim()).filter(Boolean);
      const added = [];
      for (const line of lines) {
        const card = this._norm({ content: line }, module, this.data[module].length + added.length);
        this.data[module].push(card);
        added.push(card);
      }
      this.save();
      return added;
    },

    update(module, id, changes) {
      const arr = this.data[module] || [];
      const idx = arr.findIndex(c => c.id === id);
      if (idx === -1) return null;
      arr[idx] = { ...arr[idx], ...this._norm({ ...arr[idx], ...changes }, module, idx) };
      this.save();
      return arr[idx];
    },

    remove(module, id) {
      const arr = this.data[module] || [];
      const idx = arr.findIndex(c => c.id === id);
      if (idx === -1) return false;
      arr.splice(idx, 1);
      this._recent[module] = (this._recent[module] || []).filter(cid => cid !== id);
      this._saveRecent();
      this.save();
      return true;
    },

    /* ---- 分类管理（仅 main 模块） ---- */

    getCategories(module = 'main') {
      const set = new Set();
      for (const c of (this.data[module] || [])) {
        if (c.category) set.add(c.category);
      }
      return Array.from(set);
    },

    /** 重命名分类 */
    renameCategory(oldName, newName) {
      newName = String(newName || '').trim();
      if (!newName || newName === oldName) return false;
      for (const c of this.data.main || []) {
        if (c.category === oldName) c.category = newName;
      }
      this.save();
      return true;
    },

    /** 删除分类（其下字卡归入"未分类"） */
    deleteCategory(name) {
      for (const c of this.data.main || []) {
        if (c.category === name) c.category = '未分类';
      }
      this.save();
      return true;
    },

    /** 添加分类（创建空分类占位：加一条空内容字卡？不需要——分类由字卡动态生成。
     *  为支持"添加空分类"，用 _emptyCats 记录空分类名 */
    _emptyCats: [],
    addCategory(name) {
      name = String(name || '').trim();
      if (!name) return false;
      if (!this._emptyCats.includes(name) && !this.getCategories().includes(name)) {
        this._emptyCats.push(name);
        Storage.set('emptyCats', this._emptyCats);
        return true;
      }
      return false;
    },

    /** 获取分类列表（含空分类） */
    getAllCategories() {
      const live = this.getCategories();
      const all = new Set([...live, ...(this._emptyCats || [])]);
      return Array.from(all);
    },

    /** 分类下字卡数 */
    countByCategory(name) {
      if (name === '全部字卡') return (this.data.main || []).length;
      if (name === '未分类字卡') return (this.data.main || []).filter(c => !c.category || c.category === '未分类').length;
      return (this.data.main || []).filter(c => c.category === name).length;
    },

    /* ---- 查重去重（main 模块） ---- */
    dedup() {
      const arr = this.data.main || [];
      const seen = new Set();
      const removed = [];
      const kept = [];
      for (const c of arr) {
        const key = c.content;
        if (seen.has(key)) { removed.push(c); continue; }
        seen.add(key);
        kept.push(c);
      }
      this.data.main = kept;
      this.save();
      return { removed: removed.length, total: arr.length };
    },

    /* ---- 搜索 ---- */
    search(module, keyword, category) {
      let r = this.data[module] || [];
      if (category === '未分类字卡') r = r.filter(c => !c.category || c.category === '未分类');
      else if (category && category !== '全部字卡') r = r.filter(c => c.category === category);
      if (keyword) {
        const kw = keyword.toLowerCase();
        r = r.filter(c => c.content.toLowerCase().includes(kw) || (c.category || '').toLowerCase().includes(kw));
      }
      return r;
    },

    /* ---- 加权抽取 ---- */
    selectRandom(module, opts = {}) {
      const arr = this.data[module] || [];
      if (!arr.length) return null;
      const excludeRecent = opts.excludeRecent !== false && LC.config.antiRepeat;
      const win = LC.config.antiRepeatWindow || 5;
      let pool = [...arr];
      const recent = this._recent[module] || [];
      if (excludeRecent && recent.length && pool.length > 1) {
        pool = pool.filter(c => !recent.includes(c.id));
        if (!pool.length) pool = [...arr];
      }
      const total = pool.reduce((s, c) => s + (c.weight || 1), 0);
      let r = Math.random() * total;
      let sel = pool[0];
      for (const c of pool) { r -= (c.weight || 1); if (r <= 0) { sel = c; break; } }
      sel.useCount = (sel.useCount || 0) + 1;
      sel.lastUsedAt = Date.now();
      if (!this._recent[module]) this._recent[module] = [];
      this._recent[module].push(sel.id);
      while (this._recent[module].length > Math.min(win, arr.length - 1)) this._recent[module].shift();
      this._saveRecent();
      this.save();
      return sel;
    },

    /* ---- 状态卡管理 ---- */
    getStatus() { return this._currentStatus; },
    setStatus(card) {
      this._currentStatus = card;
      Storage.set('currentStatus', card);
    },
    pickNewStatus() {
      const c = this.selectRandom('status', { excludeRecent: true });
      this.setStatus(c);
      return c;
    },

    /* ---- 统计 ---- */
    getStats(module) {
      const arr = this.data[module] || [];
      return { total: arr.length, uses: arr.reduce((s, c) => s + (c.useCount || 0), 0) };
    },

    /* ---- 导出 ---- */

    /** 按分类导出（主字卡，可选分类） */
    exportByCategory(selectedCats) {
      const cats = selectedCats && selectedCats.length ? selectedCats : this.getAllCategories();
      const grouped = {};
      for (const cat of cats) {
        grouped[cat] = (this.data.main || [])
          .filter(c => c.category === cat)
          .map(c => ({ content: c.content, category: c.category, weight: c.weight }));
      }
      return JSON.stringify({ version: 2, mode: 'byCategory', grouped }, null, 2);
    },

    /** 全量导出（可选模块） */
    exportFull(selectedModules) {
      const mods = selectedModules && selectedModules.length ? selectedModules : MODULE_KEYS;
      const out = { version: 2, mode: 'full', modules: {} };
      for (const m of mods) {
        if (!LC.MODULES[m]) continue;
        out.modules[m] = (this.data[m] || []).map(c => ({
          content: c.content,
          category: LC.MODULES[m].hasCategory ? c.category : undefined,
          weight: c.weight,
        }));
      }
      return JSON.stringify(out, null, 2);
    },

    /** 单模块导出 */
    exportModule(module) {
      return JSON.stringify({ version: 2, mode: 'module', module, cards: (this.data[module] || []).map(c => ({ content: c.content, category: c.category || undefined, weight: c.weight })) }, null, 2);
    },

    /* ---- 导入 ---- */

    /** 按分组导入（分类文件 → 主字卡，保留分组）
     *  mode: 'merge' 添加（在现有基础上追加，默认）| 'replace' 覆盖（清空全部主字卡与分类后替换） */
    importByGroup(jsonText, mode = 'merge') {
      let data;
      try { data = JSON.parse(jsonText); } catch (e) { return { ok: false, error: 'JSON 格式错误：' + e.message }; }
      // 先解析出待导入条目（格式不符直接返回，不动旧数据，避免覆盖模式误删）
      const incoming = [];
      if (data.mode === 'byCategory' && data.grouped) {
        for (const [cat, cards] of Object.entries(data.grouped)) {
          for (const c of (Array.isArray(cards) ? cards : [])) {
            if (c.content) incoming.push({ content: c.content, category: cat, weight: c.weight });
          }
        }
      } else if (Array.isArray(data)) {
        // 兼容 v1 纯数组
        for (const c of data) {
          if (c.content || c.text) incoming.push({ content: c.content || c.text, category: c.category, weight: c.weight });
        }
      } else {
        return { ok: false, error: '文件格式不符（需按分类导出文件）' };
      }
      // 覆盖模式：确认文件可用后，才删除全部现有主字卡和分类
      if (mode === 'replace') {
        this.data.main = [];
        this._emptyCats = [];
        Storage.set('emptyCats', this._emptyCats);
        if (this._recent && this._recent.main) this._recent.main = [];
        this._saveRecent();
        this.save();
      }
      let added = 0;
      for (const item of incoming) {
        if (this.add('main', item)) added++;
      }
      return { ok: true, added, replaced: mode === 'replace' };
    },

    /** 全量导入（各模块分别导入） */
    importFull(jsonText, mode = 'merge') {
      let data;
      try { data = JSON.parse(jsonText); } catch (e) { return { ok: false, error: 'JSON 格式错误：' + e.message }; }
      if (data.mode !== 'full' || !data.modules) return { ok: false, error: '文件格式不符（需全量导出文件）' };
      if (mode === 'replace') {
        for (const m of Object.keys(data.modules)) if (LC.MODULES[m]) this.data[m] = [];
      }
      let added = 0;
      for (const [m, cards] of Object.entries(data.modules)) {
        if (!LC.MODULES[m] || !Array.isArray(cards)) continue;
        for (const c of cards) {
          if (c.content) { this.add(m, { content: c.content, category: c.category, weight: c.weight }); added++; }
        }
      }
      return { ok: true, added };
    },

    /** 模块内导入 */
    importModule(jsonText, module, mode = 'merge') {
      let data;
      try { data = JSON.parse(jsonText); } catch (e) { return { ok: false, error: 'JSON 格式错误' }; }
      if (mode === 'replace') this.data[module] = [];
      let added = 0;
      const cards = (data && data.cards) ? data.cards : (Array.isArray(data) ? data : []);
      for (const c of cards) {
        if (c.content) { this.add(module, { content: c.content, category: c.category, weight: c.weight }); added++; }
      }
      return { ok: true, added };
    },
  };

  LC.CardLibrary = CardLibrary;
})(window.LoveChat);
