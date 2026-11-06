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
      // 迁移：旧格式空分类是裸名字（main 专属），新格式为 "模块::分类名"
      let catMigrated = false;
      this._emptyCats = this._emptyCats.map(k => {
        if (typeof k === 'string' && !k.includes('::')) { catMigrated = true; return 'main::' + k; }
        return k;
      });
      if (catMigrated) Storage.set('emptyCats', this._emptyCats);
      // 系统拼词小分类占位（格式 "大分类::小分类"，只记录没有字卡的空小分类）
      this._wordSubCats = (await Storage.get('wordSubCats', [])) || [];
      // 分类排列顺序（用户在分类管理里手动调整的顺序）：
      // key = 模块名（main/restricted/customWord）或 "sub::大分类"（系统拼词小分类），
      // value = 分类名数组。不在数组里的新分类排在最后（保持原有先后）。
      this._catOrders = (await Storage.get('catOrders', {})) || {};
      // 系统拼词：自动补齐 8 个固定分类（空分类占位，只补缺失的）
      for (const name of LC.WORD_SYS_CATS) this.addCategory(name, 'systemWord');
      // ★ 一次性补发系统拼词预设字卡（v1）：老用户本地已有数据，首次启动载入不到预设，
      //   这里补一次（只补"大分类+小分类+内容"都不重复的卡，不动已有卡）；
      //   标志位保证只补这一次——之后用户删掉的预设卡不会复活
      if (!(await Storage.get('sysWordPresetsV1', false))) {
        const presets = LC.DEFAULT_CARDS.systemWord || [];
        const existing = new Set((this.data.systemWord || [])
          .map(c => c.category + '::' + c.subCat + '::' + c.content));
        let added = 0;
        for (const p of presets) {
          if (existing.has(p.category + '::' + p.subCat + '::' + p.content)) continue;
          this.data.systemWord.push(this._norm(p, 'systemWord', this.data.systemWord.length));
          added++;
        }
        if (added) this.save();
        Storage.set('sysWordPresetsV1', true);
      }
      // ★ 一次性补发情绪辅助预设（v1）：同上，按内容去重只补缺的，只补这一次
      //   （情绪辅助无分类，去重键 = 卡片内容本身）
      if (!(await Storage.get('moodAssistPresetsV1', false))) {
        const presets = LC.DEFAULT_CARDS.moodAssist || [];
        const existing = new Set((this.data.moodAssist || []).map(c => c.content));
        let added = 0;
        for (const p of presets) {
          if (existing.has(p.content)) continue;
          this.data.moodAssist.push(this._norm(p, 'moodAssist', this.data.moodAssist.length));
          added++;
        }
        if (added) this.save();
        Storage.set('moodAssistPresetsV1', true);
      }
      // ★ 一次性补发关联词辅助预设（v1）：同上，按内容去重只补缺的，只补这一次
      if (!(await Storage.get('logicAssistPresetsV1', false))) {
        const presets = LC.DEFAULT_CARDS.logicAssist || [];
        const existing = new Set((this.data.logicAssist || []).map(c => c.content));
        let added = 0;
        for (const p of presets) {
          if (existing.has(p.content)) continue;
          this.data.logicAssist.push(this._norm(p, 'logicAssist', this.data.logicAssist.length));
          added++;
        }
        if (added) this.save();
        Storage.set('logicAssistPresetsV1', true);
      }
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
        // 系统拼词小分类（大分类下的分支，仅整理用，不参与抽取）
        subCat: (module === 'systemWord') ? String(card.subCat || '').trim() : '',
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

    /* ---- 分类管理（支持分类的模块：main / customWord / systemWord） ---- */

    getCategories(module = 'main') {
      const set = new Set();
      for (const c of (this.data[module] || [])) {
        if (c.category) set.add(c.category);
      }
      return Array.from(set);
    },

    /** 重命名分类 */
    renameCategory(oldName, newName, module = 'main') {
      if (module === 'systemWord' && LC.WORD_SYS_CATS.includes(oldName)) return false; // 8 个固定分类不可改名
      newName = String(newName || '').trim();
      if (!newName || newName === oldName) return false;
      for (const c of this.data[module] || []) {
        if (c.category === oldName) c.category = newName;
      }
      this.save();
      return true;
    },

    /** 删除分类（其下字卡归入"未分类"） */
    deleteCategory(name, module = 'main') {
      if (module === 'systemWord' && LC.WORD_SYS_CATS.includes(name)) return false; // 8 个固定分类不可删除
      for (const c of this.data[module] || []) {
        if (c.category === name) c.category = '未分类';
      }
      // 同步从空分类占位数组移除（存储格式为 "模块::分类名"）
      if (Array.isArray(this._emptyCats)) {
        const key = module + '::' + name;
        this._emptyCats = this._emptyCats.filter(n => n !== key);
        Storage.set('emptyCats', this._emptyCats);
      }
      this.save();
      return true;
    },

    /** 添加分类（创建空分类占位）
     *  用 _emptyCats 记录空分类名（按"模块::分类名"存储，区分不同模块的同名分类） */
    _emptyCats: [],
    addCategory(name, module = 'main') {
      name = String(name || '').trim();
      if (!name) return false;
      // 系统拼词分类固定为 8 个，只允许程序自动补齐这 8 个，不允许用户新增
      if (module === 'systemWord' && !LC.WORD_SYS_CATS.includes(name)) return false;
      const key = module + '::' + name;
      if (!this._emptyCats.includes(key) && !this.getCategories(module).includes(name)) {
        this._emptyCats.push(key);
        Storage.set('emptyCats', this._emptyCats);
        return true;
      }
      return false;
    },

    /** 获取分类列表（含空分类，按用户调整过的顺序排列） */
    getAllCategories(module = 'main') {
      const live = this.getCategories(module);
      const prefix = module + '::';
      const empties = (this._emptyCats || []).filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length));
      const all = Array.from(new Set([...live, ...empties]));
      return this._applyOrder(all, (this._catOrders || {})[module]);
    },

    /** 按已保存的顺序重排：在顺序表里的按表排，不在的（新建的）跟在后面保持原顺序 */
    _applyOrder(list, order) {
      if (!Array.isArray(order) || !order.length) return list;
      const inList = new Set(list);
      const ranked = order.filter(n => inList.has(n));
      const inOrder = new Set(order);
      const rest = list.filter(n => !inOrder.has(n));
      return [...ranked, ...rest];
    },

    /** 把分类 name 移到 target 的上方/下方（pos: 'before' 上方 / 'after' 下方），顺序持久保存 */
    moveCategoryTo(name, target, pos, module = 'main') {
      return this._moveToOrder(this.getAllCategories(module), name, target, pos, module);
    },

    /** 把系统拼词小分类 name 移到 target 的上方/下方（大分类 cat 下） */
    moveSubCatTo(cat, name, target, pos) {
      return this._moveToOrder(this.getSubCats(cat), name, target, pos, 'sub::' + cat);
    },

    _moveToOrder(list, name, target, pos, orderKey) {
      if (!list.includes(name) || !list.includes(target) || name === target) return false;
      const arr = list.filter(n => n !== name);
      const i = arr.indexOf(target);
      if (i < 0) return false;
      arr.splice((pos === 'before') ? i : i + 1, 0, name);
      this._catOrders = this._catOrders || {};
      this._catOrders[orderKey] = arr;
      Storage.set('catOrders', this._catOrders);
      return true;
    },

    /** 分类下字卡数 */
    countByCategory(name, module = 'main') {
      if (name === '全部字卡') return (this.data[module] || []).length;
      if (name === '未分类字卡') return (this.data[module] || []).filter(c => !c.category || c.category === '未分类').length;
      return (this.data[module] || []).filter(c => c.category === name).length;
    },

    /* ---- 系统拼词小分类（大分类下的分支，仅 systemWord 模块） ----
     * 存储：_wordSubCats 记录空小分类占位（"大分类::小分类"），
     * 卡片上实际出现的小分类自动并入列表（导入的字卡无需占位也能显示） */

    /** 某大分类下的小分类列表（含空占位，按用户调整过的顺序排列） */
    getSubCats(cat) {
      const live = new Set();
      for (const c of (this.data.systemWord || [])) {
        if (c.category === cat && c.subCat) live.add(c.subCat);
      }
      const prefix = cat + '::';
      const empties = (this._wordSubCats || []).filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length));
      const all = Array.from(new Set([...empties, ...live]));
      return this._applyOrder(all, (this._catOrders || {})['sub::' + cat]);
    },

    /** 添加小分类（在指定大分类下建空占位） */
    addSubCat(cat, name) {
      name = String(name || '').trim();
      if (!name || !LC.WORD_SYS_CATS.includes(cat)) return false;
      const key = cat + '::' + name;
      if (this._wordSubCats.includes(key) || this.getSubCats(cat).includes(name)) return false;
      this._wordSubCats.push(key);
      Storage.set('wordSubCats', this._wordSubCats);
      return true;
    },

    /** 重命名小分类（同步更新该大分类下字卡的 subCat） */
    renameSubCat(cat, oldName, newName) {
      newName = String(newName || '').trim();
      if (!newName || newName === oldName) return false;
      const oldKey = cat + '::' + oldName, newKey = cat + '::' + newName;
      const i = this._wordSubCats.indexOf(oldKey);
      if (i >= 0) { this._wordSubCats[i] = newKey; Storage.set('wordSubCats', this._wordSubCats); }
      for (const c of this.data.systemWord || []) {
        if (c.category === cat && c.subCat === oldName) c.subCat = newName;
      }
      this.save();
      return true;
    },

    /** 删除小分类（其下字卡的 subCat 清空，归入"未分类字卡"） */
    deleteSubCat(cat, name) {
      const key = cat + '::' + name;
      this._wordSubCats = (this._wordSubCats || []).filter(k => k !== key);
      Storage.set('wordSubCats', this._wordSubCats);
      for (const c of this.data.systemWord || []) {
        if (c.category === cat && c.subCat === name) c.subCat = '';
      }
      this.save();
      return true;
    },

    /** 某大分类下某小分类的字卡数（subCat 传 '' 统计"未分类字卡"） */
    countBySubCat(cat, subCat) {
      return (this.data.systemWord || []).filter(c =>
        c.category === cat && (subCat ? c.subCat === subCat : !c.subCat)).length;
    },

    /* ---- 查重去重（支持分类的模块） ----
     * 规则：同内容字卡只保留一份。
     * 若一份字卡同时出现在"未分类"和其他分类，优先删除"未分类"里的那一份，
     * 保留有具体分类的那一份。
     */
    dedup(module = 'main') {
      const arr = this.data[module] || [];
      // 第一遍：判断每条内容是否在"非未分类"分类里出现过
      const hasCategorized = new Set();
      for (const c of arr) {
        const cat = c.category;
        if (cat && cat !== '未分类') hasCategorized.add(c.content);
      }
      // 第二遍：按原顺序去重
      const seen = new Set();
      const removed = [];
      const kept = [];
      for (const c of arr) {
        const key = c.content;
        const isUncategorized = !c.category || c.category === '未分类';
        // 若内容已有具体分类版本，且当前这条是未分类，则跳过（删除）
        if (isUncategorized && hasCategorized.has(key)) {
          removed.push(c);
          continue;
        }
        if (seen.has(key)) { removed.push(c); continue; }
        seen.add(key);
        kept.push(c);
      }
      this.data[module] = kept;
      this.save();
      return { removed: removed.length, total: arr.length };
    },

    /* ---- 全局查重去重（所有模块：回复库 + 氛围感 + 拼词库） ----
     * 支持分类的模块（main/customWord/systemWord）走 dedup()（带分类优先级）
     * 其他模块（emoji/sticker/pat/status）走简单内容去重（保留首次出现）
     */
    dedupAll() {
      const result = {};
      let totalRemoved = 0;
      for (const m of MODULE_KEYS) {
        if (LC.MODULES[m] && LC.MODULES[m].hasCategory) {
          const r = this.dedup(m);
          result[m] = r;
          totalRemoved += r.removed;
        } else {
          const arr = this.data[m] || [];
          const seen = new Set();
          const kept = [];
          let removed = 0;
          for (const c of arr) {
            const key = c.content;
            if (seen.has(key)) { removed++; continue; }
            seen.add(key);
            kept.push(c);
          }
          if (removed > 0) {
            this.data[m] = kept;
            result[m] = { removed, total: arr.length };
            totalRemoved += removed;
          } else {
            result[m] = { removed: 0, total: arr.length };
          }
        }
      }
      if (totalRemoved > 0) this.save();
      return { perModule: result, removed: totalRemoved };
    },

    /* ---- 搜索 ---- */
    search(module, keyword, category) {
      let r = this.data[module] || [];
      if (category === '未分类字卡') {
        // 系统拼词：大分类级"未分类字卡" = 只放没选任何大分类的卡；
        // 分了大类但没分小类的卡 → 在各大分类自己的"未分类字卡"小分类里看（见 ui._filterBySubCat）
        if (module === 'systemWord') r = r.filter(c => !LC.WORD_SYS_CATS.includes(c.category));
        else r = r.filter(c => !c.category || c.category === '未分类');
      }
      else if (category && category !== '全部字卡') r = r.filter(c => c.category === category);
      if (keyword) {
        const kw = keyword.toLowerCase();
        r = r.filter(c => c.content.toLowerCase().includes(kw) || (c.category || '').toLowerCase().includes(kw));
      }
      return r;
    },

    /* ---- 加权抽取 ---- */
    /** 按给定 id 顺序重排模块（表情库拖拽排序用）
     *  ids = 当前可见项的新顺序；不可见项（未加载分页/损坏数据）保持原相对顺序排在后面 */
    reorder(module, ids) {
      if (!Array.isArray(ids) || !this.data[module]) return;
      const set = new Set(ids);
      const byId = {};
      for (const c of this.data[module]) byId[c.id] = c;
      const ordered = ids.map(id => byId[id]).filter(Boolean);
      if (!ordered.length) return;
      const rest = this.data[module].filter(c => !set.has(c.id));
      this.data[module] = [...ordered, ...rest];
      this.save();
    },

    selectRandom(module, opts = {}) {
      // module 支持字符串或数组（数组 = 合并多个模块的卡池，如 主字卡+限制字卡）
      const mods = Array.isArray(module) ? module : [module];
      const arr = mods.flatMap(m => this.data[m] || []);
      if (!arr.length) return null;
      const excludeRecent = opts.excludeRecent !== false && LC.config.antiRepeat;
      const win = LC.config.antiRepeatWindow || 5;
      let pool = [...arr];
      const recent = mods.flatMap(m => this._recent[m] || []);
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
      // 使用记录标记到所选卡实际所属的模块（防重复窗口按各模块自己算）
      const selMod = mods.find(m => (this.data[m] || []).some(c => c === sel)) || mods[0];
      if (!this._recent[selMod]) this._recent[selMod] = [];
      this._recent[selMod].push(sel.id);
      while (this._recent[selMod].length > Math.min(win, (this.data[selMod] || []).length - 1)) this._recent[selMod].shift();
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

    /** 按分类导出（支持分类的模块，可选分类）
     *  JSON 中带 module 标记，导入时据此自动分辨是主字卡还是拼词库哪一类 */
    exportByCategory(selectedCats, module = 'main') {
      const cats = selectedCats && selectedCats.length ? selectedCats : this.getAllCategories(module);
      const grouped = {};
      for (const cat of cats) {
        grouped[cat] = (this.data[module] || [])
          .filter(c => c.category === cat)
          .map(c => ({ content: c.content, category: c.category, weight: c.weight, subCat: (module === 'systemWord' ? (c.subCat || '') : undefined) }));
      }
      return JSON.stringify({ version: 2, mode: 'byCategory', module, grouped }, null, 2);
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
          subCat: (m === 'systemWord' ? (c.subCat || '') : undefined),
        }));
      }
      return JSON.stringify(out, null, 2);
    },

    /** 单模块导出 */
    exportModule(module) {
      return JSON.stringify({ version: 2, mode: 'module', module, cards: (this.data[module] || []).map(c => ({ content: c.content, category: c.category || undefined, weight: c.weight })) }, null, 2);
    },

    /* ---- 导入 ---- */

    /** 按分类导入（分类文件 → 对应模块，保留分类）
     *  mode: 'merge' 添加（在现有基础上追加，默认）| 'replace' 覆盖（清空该模块全部字卡与分类后替换）
     *  target: 导入目标 —— 'main'（主字卡）| 'word'（拼词库）
     *    拼词库导入时自动识别：文件带 module 标记（customWord/systemWord）则导入对应模块，
     *    无标记的文件（如外部手写文件）默认导入自定义拼词 */
    importByGroup(jsonText, mode = 'merge', target = 'main') {
      let data;
      try { data = JSON.parse(jsonText); } catch (e) { return { ok: false, error: 'JSON 格式错误：' + e.message }; }
      // 确定导入目标模块：
      //  - target === 'word'（历史兼容）→ 强制导入自定义拼词
      //  - target 是有效带分类模块（如 'restricted'、'main'）→ 强制导入该模块（文件来自哪个模块都不管）
      //  - target 为空或无效 → 优先用文件里的 data.module，没有就回退到 'main'
      let module;
      if (target === 'word') module = 'customWord';
      else if (target && LC.MODULES[target]?.hasCategory) module = target;
      else module = (data.module && LC.MODULES[data.module] && LC.MODULES[data.module].hasCategory)
        ? data.module : 'main';
      // 先解析出待导入条目（格式不符直接返回，不动旧数据，避免覆盖模式误删）
      const incoming = [];
      if (data.mode === 'byCategory' && data.grouped) {
        for (const [cat, cards] of Object.entries(data.grouped)) {
          for (const c of (Array.isArray(cards) ? cards : [])) {
            if (c.content) incoming.push({ content: c.content, category: cat, weight: c.weight, subCat: c.subCat });
          }
        }
      } else if (Array.isArray(data.customReplyGroups)) {
        // 兼容外部导出格式：{ customReplies:[...], customReplyGroups:[{name,items}] }
        // items 元素可能是字符串或对象
        for (const g of data.customReplyGroups) {
          const cat = String(g.name || '未分类').trim() || '未分类';
          for (const it of (Array.isArray(g.items) ? g.items : [])) {
            const content = (typeof it === 'string') ? it : (it && (it.content || it.text));
            if (content) incoming.push({ content, category: cat, weight: it && it.weight });
          }
        }
        // customReplies：未分组的扁平数组，归入"未分类"
        if (Array.isArray(data.customReplies)) {
          for (const it of data.customReplies) {
            const content = (typeof it === 'string') ? it : (it && (it.content || it.text));
            if (content) incoming.push({ content, category: '未分类', weight: it && it.weight });
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
      // 覆盖模式：确认文件可用后，才删除该模块现有字卡和分类
      if (mode === 'replace') {
        this.data[module] = [];
        if (this._emptyCats) {
          const prefix = module + '::';
          this._emptyCats = this._emptyCats.filter(n => !n.startsWith(prefix));
          Storage.set('emptyCats', this._emptyCats);
        }
        if (this._recent && this._recent[module]) this._recent[module] = [];
        this._saveRecent();
        this.save();
      }
      // 添加模式：用 Set 收集原文件已有 content，跳过已存在项，避免重复追加
      const existing = (mode === 'merge') ? new Set((this.data[module] || []).map(c => c.content)) : null;
      const incomingSeen = (mode === 'merge') ? new Set() : null;
      let added = 0;
      for (const item of incoming) {
        if (mode === 'merge') {
          // 跳过原文件已有的内容；也跳过本次导入内部重复
          if (existing.has(item.content) || incomingSeen.has(item.content)) continue;
          incomingSeen.add(item.content);
        }
        if (this.add(module, item)) added++;
      }
      return { ok: true, added, replaced: mode === 'replace', module };
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
        // 添加模式：跳过原文件已有内容，并避免导入文件内部重复
        const existing = (mode === 'merge') ? new Set((this.data[m] || []).map(c => c.content)) : null;
        const incomingSeen = (mode === 'merge') ? new Set() : null;
        for (const c of cards) {
          if (!c.content) continue;
          if (mode === 'merge') {
            if (existing.has(c.content) || incomingSeen.has(c.content)) continue;
            incomingSeen.add(c.content);
          }
          this.add(m, { content: c.content, category: c.category, weight: c.weight, subCat: c.subCat });
          added++;
        }
      }
      return { ok: true, added, replaced: mode === 'replace' };
    },

    /** 模块内导入 */
    importModule(jsonText, module, mode = 'merge') {
      let data;
      try { data = JSON.parse(jsonText); } catch (e) { return { ok: false, error: 'JSON 格式错误' }; }
      if (mode === 'replace') this.data[module] = [];
      // 添加模式：跳过原文件已有内容，并避免导入文件内部重复
      const existing = (mode === 'merge') ? new Set((this.data[module] || []).map(c => c.content)) : null;
      const incomingSeen = (mode === 'merge') ? new Set() : null;
      let added = 0;
      const cards = (data && data.cards) ? data.cards : (Array.isArray(data) ? data : []);
      for (const c of cards) {
        if (!c.content) continue;
        if (mode === 'merge') {
          if (existing.has(c.content) || incomingSeen.has(c.content)) continue;
          incomingSeen.add(c.content);
        }
        this.add(module, { content: c.content, category: c.category, weight: c.weight, subCat: c.subCat });
        added++;
      }
      return { ok: true, added, replaced: mode === 'replace' };
    },
  };

  LC.CardLibrary = CardLibrary;
})(window.LoveChat);
