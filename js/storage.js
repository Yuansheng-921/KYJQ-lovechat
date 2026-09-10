/* ============================================================
 * storage.js — IndexedDB 持久化层 (v5)
 * 全异步 API，容量远大于 localStorage（几百 MB~GB 级），
 * 适合大量图片（表情包/头像/背景）数据存储
 * 兼容旧 lovechat_ localStorage 键：首次启动时自动迁移
 * ============================================================ */

window.LoveChat = window.LoveChat || {};

(function (LC) {
  'use strict';

  const DB_NAME = 'lovechat_db';
  const DB_VERSION = 1;
  const STORE = 'kv';
  const OLD_PREFIX = 'lovechat_'; // 旧 localStorage 前缀

  let _db = null;
  let _migrated = false;

  /** 打开/创建 IndexedDB（单例） */
  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /** 一次性迁移：把旧 localStorage 的 lovechat_ 数据搬到 IndexedDB
   *  仅在 IndexedDB 为空 + localStorage 有旧数据时执行 */
  async function migrateFromLocalStorage() {
    if (_migrated) return;
    _migrated = true;
    try {
      const db = await openDB();
      const hasData = await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).count();
        req.onsuccess = () => resolve(req.result > 0);
        req.onerror = () => resolve(false);
      });
      if (hasData) return;
      const oldKeys = Object.keys(localStorage).filter(k => k.startsWith(OLD_PREFIX));
      if (!oldKeys.length) return;
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const k of oldKeys) {
        const shortKey = k.slice(OLD_PREFIX.length);
        const raw = localStorage.getItem(k);
        if (raw === null) continue;
        try { store.put(JSON.parse(raw), shortKey); }
        catch (e) { store.put(raw, shortKey); }
      }
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      console.log('%c[LoveChat] 已从旧 localStorage 迁移数据到 IndexedDB', 'color:#E75480;');
    } catch (e) {
      console.warn('[LoveChat] 迁移失败（不影响使用）:', e);
    }
  }

  const Storage = {
    /**
     * 读取数据
     * @returns {Promise} 解析后的值（IndexedDB 直接存对象，无需 JSON.parse）
     */
    async get(key, fallback) {
      try {
        const db = await openDB();
        return new Promise((resolve) => {
          const tx = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).get(key);
          req.onsuccess = () => {
            if (req.result === undefined) return resolve(fallback);
            resolve(req.result);
          };
          req.onerror = () => resolve(fallback);
        });
      } catch (e) {
        console.warn('[LoveChat] 读取失败:', key, e);
        return fallback;
      }
    },

    /** 写入数据（异步，返回 Promise） */
    async set(key, value) {
      try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(value, key);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => {
            const err = tx.error;
            if (err && err.name === 'QuotaExceededError') {
              alert('存储空间已满，请清理一些旧数据后再试。');
            }
            reject(err);
          };
        });
      } catch (e) {
        console.error('[LoveChat] 写入失败:', key, e);
        if (e && e.name === 'QuotaExceededError') {
          alert('存储空间已满，请清理一些旧数据后再试。');
        }
        return false;
      }
    },

    /** 删除单个键 */
    async remove(key) {
      try {
        const db = await openDB();
        return new Promise((resolve) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(key);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        });
      } catch (e) { return false; }
    },

    /** 清空本应用所有数据（IndexedDB + 旧 localStorage） */
    async clearAll() {
      try {
        // 清 IndexedDB
        const db = await openDB();
        await new Promise((resolve) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).clear();
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        });
        // 同时清旧 localStorage 残留
        Object.keys(localStorage)
          .filter(k => k.startsWith(OLD_PREFIX))
          .forEach(k => localStorage.removeItem(k));
        return true;
      } catch (e) { return false; }
    },

    /** 检查某键是否存在 */
    async has(key) {
      const v = await this.get(key, undefined);
      return v !== undefined;
    },

    /** 全量导出：所有数据打包成 JSON 字符串 */
    async exportAll() {
      const db = await openDB();
      const dump = {};
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).openCursor();
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            dump[cursor.key] = cursor.value;
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => reject(req.error);
      });
      return JSON.stringify({
        app: 'LoveChat',
        version: LC.CUR_DATA_VERSION || 5,
        exportedAt: new Date().toISOString(),
        data: dump,
      }, null, 2);
    },

    /** 全量导入：从 exportAll 生成的 JSON 恢复 */
    async importAll(jsonText, mode = 'replace') {
      let parsed;
      try { parsed = JSON.parse(jsonText); }
      catch (e) { return { ok: false, error: 'JSON 格式错误：' + e.message }; }
      if (!parsed || !parsed.data || typeof parsed.data !== 'object') {
        return { ok: false, error: '文件格式不符（不是 LoveChat 备份文件）' };
      }
      if (mode === 'replace') await this.clearAll();
      let count = 0;
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        for (const [shortKey, value] of Object.entries(parsed.data)) {
          if (shortKey === 'dataVersion') continue;
          store.put(value, shortKey);
          count++;
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      this.set('dataVersion', LC.CUR_DATA_VERSION || 5);
      return { ok: true, count, sourceVersion: parsed.version };
    },

    /** 统计：占用大小、各类条目数 */
    async getStats() {
      const stats = { totalBytes: 0, keys: 0, breakdown: {} };
      try {
        const db = await openDB();
        await new Promise((resolve) => {
          const tx = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).openCursor();
          req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              const k = String(cursor.key);
              const v = cursor.value;
              const raw = (typeof v === 'string') ? v : JSON.stringify(v);
              stats.totalBytes += raw.length + k.length;
              stats.keys++;
              let count = '';
              try {
                if (Array.isArray(v)) count = v.length + ' 条';
                else if (v && typeof v === 'object') count = '对象';
                else count = String(v).slice(0, 30);
              } catch (e) { count = '—'; }
              stats.breakdown[k] = { bytes: raw.length, count };
              cursor.continue();
            } else {
              resolve();
            }
          };
          req.onerror = () => resolve();
        });
      } catch (e) {}
      stats.totalKB = (stats.totalBytes / 1024).toFixed(1);
      stats.totalDisplay = stats.totalBytes < 1024 * 1024
        ? stats.totalKB + ' KB'
        : (stats.totalBytes / 1024 / 1024).toFixed(2) + ' MB';
      return stats;
    },

    /** 初始化：打开 DB + 迁移旧数据（在 app.js 启动时调用） */
    async init() {
      await openDB();
      await migrateFromLocalStorage();
    },
  };

  LC.Storage = Storage;
})(window.LoveChat);
