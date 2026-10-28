/* ============================================================
 * ui.js — UI 界面层 (v2)
 * 职责：消息渲染、聊天交互、字卡面板(多模块Tab)、各类弹窗、设置
 * ============================================================ */

window.LoveChat = window.LoveChat || {};

(function (LC) {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const esc = (str) => { const d = document.createElement('div'); d.textContent = String(str); return d.innerHTML; };

  const UI = {
    el: {},
    _editingCard: null,      // { module, id }
    _activeGroup: 'reply',   // reply | vibe
    _activeModule: 'main',   // current subtab module key
    _catFilter: '全部字卡',   // main 分类筛选
    _multiList: [],          // 多条发送暂存
    _multiMode: false,       // 多条发送激活
    _multiSelMode: false,    // 字卡批量多选激活
    _multiSel: new Set(),    // 字卡批量多选已选 id 集合
    _statusTimeout: null,
    /* 滚动状态（需求1）：
     * _isAtBottom: 用户当前是否在底部附近（距底 ≤ 60px）
     * _unreadCount: 对方已发送但用户未读的消息数（仅当用户不在底部时累计）
     * _programmaticScroll: 程序触发的滚动期间为 true，避免 _updateScrollState 误判
     * _scrollBtnVisible: 指示器是否在显示中
     * _scrollFlagTimer / _scrollDebounce: 内部计时器
     */
    _isAtBottom: true,
    _unreadCount: 0,
    _programmaticScroll: false,
    _scrollBtnVisible: false,
    _scrollFlagTimer: null,
    _scrollDebounce: null,

    /* ============ 初始化 ============ */
    init() {
      this.el = {
        messages: $('#messages'), messagesScroll: $('#messagesScroll'),
        emptyState: $('#emptyState'), typingIndicator: $('#typingIndicator'),
        typingAvatar: $('#typingAvatar'),
        messageInput: $('#messageInput'), sendBtn: $('#sendBtn'),
        partnerName: $('#partnerName'),
        partnerStatus: $('#partnerStatus'),
        cardsPanel: $('#cardsPanel'), settingsPanel: $('#settingsPanel'),
        overlay: $('#overlay'), panelBody: $('#panelBody'), panelSubTabs: $('#panelSubTabs'), panelMgmtBar: $('#panelMgmtBar'),
        panelTitle: $('#panelTitle'), addBtnLabel: $('#addBtnLabel'), panelFooter: $('#panelFooter'),
        cardModal: $('#cardModal'), cardModalTitle: $('#cardModalTitle'),
        cardTextInput: $('#cardTextInput'), cardCategoryFields: $('#cardCategoryFields'),
        cardCategoryInput: $('#cardCategoryInput'), cardCategorySelect: $('#cardCategorySelect'),
        cardWeightInput: $('#cardWeightInput'), cardWeightField: $('#cardWeightField'),
        cardBatchHint: $('#cardBatchHint'),
        inputExpand: $('#inputExpand'), inputExpandText: $('#inputExpandText'),
        multiSendModal: $('#multiSendModal'), multiSendList: $('#multiSendList'),
        patModal: $('#patModal'), patInput: $('#patInput'), patQuick: $('#patQuick'),
        expandMenuSheet: $('#expandMenuSheet'),
        categoryModal: $('#categoryModal'), catList: $('#catList'), catAddInput: $('#catAddInput'),
        exportModal: $('#exportCatModal'), exportCatList: $('#exportCatList'), exportModList: $('#exportModList'),
        importModal: $('#importModal'),
        // 头像/背景/抉择
        setPartnerAvatarPreview: $('#setPartnerAvatarPreview'),
        setUserAvatarPreview: $('#setUserAvatarPreview'),
        bgImagePreview: $('#bgImagePreview'),
        setBgFit: $('#setBgFit'),
        choiceModal: $('#choiceModal'), choiceMinutes: $('#choiceMinutes'),
        choiceQuestion: $('#choiceQuestion'), choiceOptions: $('#choiceOptions'),
        choiceScroll: document.querySelector('#choiceModal .choice-scroll'),
        choiceAddOptBtn: $('#choiceAddOptBtn'), choiceHint: $('#choiceHint'),
        choiceModeSingle: $('#choiceModeSingle'), choiceModeMulti: $('#choiceModeMulti'),
        choiceModeHint: $('#choiceModeHint'),
        choiceSendBtn: $('#choiceSendBtn'), choiceCancelBtn: $('#choiceCancelBtn'),
        customColorPresets: $('#customColorPresets'), customColorHexInput: $('#customColorHexInput'),
        choiceDetailModal: $('#choiceDetailModal'), choiceDetailTitle: $('#choiceDetailTitle'),
        choiceDetailList: $('#choiceDetailList'), choiceDetailCloseBtn: $('#choiceDetailCloseBtn'),
        // 信件投递
        letterScreen: $('#letterScreen'), letterList: $('#letterList'), letterEmpty: $('#letterEmpty'),
        letterListArea: $('#letterListArea'),
        letterCompose: $('#letterCompose'), letterTextarea: $('#letterTextarea'),
        letterFooter: $('#letterFooter'), letterFooterCompose: $('#letterFooterCompose'),
        letterModal: $('#letterModal'), letterModalTitle: $('#letterModalTitle'),
        letterModalBody: $('#letterModalBody'), letterModalFooter: $('#letterModalFooter'),
        lettersBadge: $('#lettersBadge'),
        // 隐藏/显示界面按钮
        uiHideBtn: $('#uiHideBtn'), uiShowBtn: $('#uiShowBtn'),
      };
      this._bindEvents();
      this._renderSubTabs();
    },

    /* ============ 事件绑定 ============ */
    _bindEvents() {
      const e = this.el;
      // 发送
      e.sendBtn.addEventListener('click', () => this._onSend());
      e.messageInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); this._onSend(); }
      });
      // 输入展开弹窗：focus 自动唤起 + 双击手动唤起（绕过 _suppressExpand 限制）
      // 双击只在 inputExpand 隐藏时唤起；已显示时双击不做任何事（不关闭，只能手动点收起）
      e.messageInput.addEventListener('focus', () => { if (!this._multiMode) this._openInputExpand(); });
      e.messageInput.addEventListener('dblclick', () => {
        if (this._multiMode) return;
        if (!this.el.inputExpand.hidden) return;  // 已显示 → 不动，避免双击关闭
        // 临时清除 _suppressExpand，让 _openInputExpand 能成功唤起
        this._suppressExpand = false;
        this._openInputExpand();
      });
      $('#inputExpandConfirm').addEventListener('click', () => this._closeInputExpand());
      $('#inputExpandCancel').addEventListener('click', () => this._closeInputExpand(true));
      e.inputExpandText.addEventListener('input', () => { e.messageInput.value = e.inputExpandText.value; });
      e.inputExpandText.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); this._onSend(); }
      });
      // 面板开关
      $('#openCardsBtn').addEventListener('click', () => this.openCardsPanel());
      $('#closeCardsBtn').addEventListener('click', () => this.closeCardsPanel());
      $('#openSettingsBtn').addEventListener('click', () => this.openSettingsPanel());
      $('#closeSettingsBtn').addEventListener('click', () => this.closeSettingsPanel());
      e.overlay.addEventListener('click', () => this.closeAllPanels());
      // 顶部 Tab
      $$('.toptab').forEach(b => b.addEventListener('click', () => this._switchGroup(b.dataset.group)));
      // 添加按钮
      $('#addCardBtn').addEventListener('click', () => this._onAddClick());
      // 字卡弹窗
      $('#cancelCardBtn').addEventListener('click', () => this._closeCardModal());
      $('#saveCardBtn').addEventListener('click', () => this._onSaveCard());
      e.cardCategorySelect.addEventListener('change', () => { if (e.cardCategorySelect.value) e.cardCategoryInput.value = e.cardCategorySelect.value; });
      // 分类管理
      $('#catAddBtn').addEventListener('click', () => this._onAddCategory());
      e.catAddInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') this._onAddCategory(); });
      $('#catCloseBtn').addEventListener('click', () => this._closeModal('categoryModal'));
      // 导入导出
      $('#globalDedupBtn').addEventListener('click', () => this._onGlobalDedup());
      $('#exportBtn').addEventListener('click', (ev) => { ev.stopPropagation(); this._onExportClick(ev); });
      $('#importBtn').addEventListener('click', () => this._onImportClick());
      $('#exportCatConfirm').addEventListener('click', () => this._doExportByCategory());
      $('#exportFullConfirm').addEventListener('click', () => this._doExportFull());
      $('#exportCatCancelBtn').addEventListener('click', () => this._closeModal('exportCatModal'));
      $('#exportFullCancelBtn').addEventListener('click', () => this._closeModal('exportFullModal'));
      // 导出方式浮窗的选项点击
      $('#exportChoiceMenu').addEventListener('click', (ev) => {
        const btn = ev.target.closest('.popup-item'); if (!btn) return;
        const act = btn.dataset.act;
        this._closeExportChoice();
        if (act === 'cat') this._openExportCatModal();
        else if (act === 'full') this._openExportFullModal();
      });
      $('#importGroupBtn').addEventListener('click', () => this._toggleImportModeMenu('group'));
      $('#importFullBtn').addEventListener('click', () => this._toggleImportModeMenu('full'));
      // 导入方式选择（覆盖 / 添加）：按分组导入和全量导入共用此菜单
      $('#importModeMenu').addEventListener('click', (ev) => {
        const btn = ev.target.closest('.popup-item'); if (!btn) return;
        this._closeImportModeMenu();
        this._doImport(this._importSource || 'group', btn.dataset.mode);
      });
      $('#importCancelBtn').addEventListener('click', () => { this._closeImportModeMenu(); this._closeModal('importModal'); });
      // 消息长按操作浮窗（引用 / 删除）
      $('#msgActionMenu').addEventListener('click', (ev) => {
        const btn = ev.target.closest('.popup-item'); if (!btn) return;
        const act = btn.dataset.act;
        const tid = $('#msgActionMenu').dataset.targetId;
        this._closeMsgMenu();
        if (!tid) return;
        const targetMsg = LC.ChatEngine.getHistory().find(m => m.id === tid);
        if (!targetMsg) return;
        if (act === 'quote') this._quoteMessage(targetMsg);
        else if (act === 'delete') { if (confirm('删除这条消息？')) this._deleteMessage(tid); }
      });
      // 引用预览条关闭按钮
      $('#quotePreviewClose').addEventListener('click', () => this._cancelQuote());
      // 拍一拍标志选择（个性化面板：我的/他的）
      $('#patMarkMeBtn').addEventListener('click', (ev) => this._openPatMarkMenu('me', ev.currentTarget));
      $('#patMarkPartnerBtn').addEventListener('click', (ev) => this._openPatMarkMenu('partner', ev.currentTarget));
      $('#patMarkGrid').addEventListener('click', (ev) => {
        const opt = ev.target.closest('.pat-mark-opt'); if (!opt) return;
        const sym = opt.dataset.mark;
        const who = $('#patMarkMenu').dataset.who;
        if (who === 'me') { LC.config.patMarkMe = sym; $('#patMarkMeVal').textContent = sym; }
        else { LC.config.patMarkPartner = sym; $('#patMarkPartnerVal').textContent = sym; }
        LC.Storage.set('config', LC.config);
        this._closePatMarkMenu();
      });
      // 聊天输入新按钮
      $('#expandMenuBtn').addEventListener('click', () => this._toggleExpandMenu());
      $('#patBtn').addEventListener('click', () => this._openPatModal());
      $('#stickerBtn').addEventListener('click', () => this._openStickerPicker());
      $('#multiSendBtn').addEventListener('click', () => this._openMultiSend());
      $('#multiSendCancelBtn').addEventListener('click', () => this._closeMultiSend(true));
      $('#multiSendSendBtn').addEventListener('click', () => this._multiSend());
      $('#patCancelBtn').addEventListener('click', () => this._closeModal('patModal'));
      $('#patSendBtn').addEventListener('click', () => this._onPatSend());
      e.patInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); this._onPatSend(); } });
      // 设置
      $('#setPartnerName').addEventListener('input', (ev) => { LC.config.partner.name = ev.target.value || '恋人'; this.renderHeader(); LC.Storage.set('config', LC.config); });
      $('#setUserName').addEventListener('input', (ev) => { LC.config.user.name = ev.target.value || '我'; LC.Storage.set('config', LC.config); });
      // 头像图片上传
      $('#setPartnerAvatarBtn').addEventListener('click', () => this._pickAvatarImage('partner'));
      $('#setUserAvatarBtn').addEventListener('click', () => this._pickAvatarImage('user'));
      $('#setPartnerAvatarReset').addEventListener('click', () => this._resetAvatar('partner'));
      $('#setUserAvatarReset').addEventListener('click', () => this._resetAvatar('user'));
      // 头像裁剪弹窗
      $('#cropCancelBtn').addEventListener('click', () => this._closeModal('avatarCropModal'));
      $('#cropConfirmBtn').addEventListener('click', () => this._confirmCrop());
      $('#cropZoomIn').addEventListener('click', () => this._cropZoomBy(20));
      $('#cropZoomOut').addEventListener('click', () => this._cropZoomBy(-20));
      $('#cropZoom').addEventListener('input', (ev) => this._cropApplyZoom(parseInt(ev.target.value)));
      // 背景图
      $('#bgImageBtn').addEventListener('click', () => this._pickBackgroundImage());
      $('#bgImageReset').addEventListener('click', () => this._resetBackground());
      $('#setBgFit').addEventListener('change', (ev) => {
        LC.config.backgroundImage = LC.config.backgroundImage || {};
        LC.config.backgroundImage.fit = ev.target.value;
        LC.Storage.set('config', LC.config);
        this.applyBackground();
      });
      // 设置面板 Tab 切换
      $$('.settings-tab').forEach(b => b.addEventListener('click', () => this._switchSettingsTab(b.dataset.stab)));
      $$('.theme-opt').forEach(b => b.addEventListener('click', () => this.setTheme(b.dataset.theme)));
      // 聊天字体颜色选择器
      $('#fontColorPicker').addEventListener('click', (ev) => {
        const d = ev.target.closest('.color-dot');
        if (!d) return;
        this._setChatFontColor(d.dataset.color || null);
      });
      // 主题色 - 自定义颜色按钮与弹窗（仅靠按钮关闭，不点空白关闭）
      $('#customColorBtn').addEventListener('click', () => this._openCustomColorModal());
      $('#customColorHexInput').addEventListener('input', (ev) => this._onCustomColorHexInput(ev.target.value));
      $('#customColorCancelBtn').addEventListener('click', () => this._closeCustomColorModal());
      $('#customColorConfirmBtn').addEventListener('click', () => this._confirmCustomColor());
      // 回复条数
      $('#setReplyMin').addEventListener('input', (ev) => this._onReplyCountChange());
      $('#setReplyMax').addEventListener('input', (ev) => this._onReplyCountChange());
      // 回复延迟（区间输入，秒）
      $('#setTypingMin').addEventListener('input', () => this._onTypingDelayChange());
      $('#setTypingMax').addEventListener('input', () => this._onTypingDelayChange());
      // 条数间隔时间（区间输入，秒）
      $('#setUnitGapMin').addEventListener('input', () => this._onUnitGapChange());
      $('#setUnitGapMax').addEventListener('input', () => this._onUnitGapChange());
      $('#setMergeWindow').addEventListener('input', (ev) => { const v = parseInt(ev.target.value); LC.config.mergeWindow = v; $('#mergeWindowValue').textContent = (v/1000)+'s'; LC.Storage.set('config', LC.config); });
      $('#setEmojiChance').addEventListener('input', (ev) => { const v = parseInt(ev.target.value); LC.config.emojiChance = v/100; $('#emojiChanceValue').textContent = v+'%'; LC.Storage.set('config', LC.config); });
      $('#setStickerChance').addEventListener('input', (ev) => { const v = parseInt(ev.target.value); LC.config.stickerChance = v/100; $('#stickerChanceValue').textContent = v+'%'; LC.Storage.set('config', LC.config); });
      $('#setPatChance').addEventListener('input', (ev) => { const v = parseInt(ev.target.value); LC.config.patChance = v/100; $('#patChanceValue').textContent = v+'%'; LC.Storage.set('config', LC.config); });
      // 状态时长（分钟输入）
      $('#setStatusMin').addEventListener('input', () => this._onStatusDurChange());
      $('#setStatusMax').addEventListener('input', () => this._onStatusDurChange());
      // 主动发消息
      $('#setProactiveEnabled').addEventListener('change', (ev) => { LC.config.proactiveEnabled = ev.target.checked; LC.Storage.set('config', LC.config); LC.ChatEngine.refreshProactive(); });
      const onProactiveRange = () => {
        let mn = Math.max(1, parseFloat($('#setProactiveIntervalMin').value) || 5);
        let mx = Math.max(mn, parseFloat($('#setProactiveIntervalMax').value) || (mn + 10));
        LC.config.proactiveIntervalMin = mn; LC.config.proactiveIntervalMax = mx;
        LC.Storage.set('config', LC.config);
        $('#proactiveIntervalHint').textContent = `${mn} ~ ${mx} 分钟`;
        LC.ChatEngine.refreshProactive();
      };
      $('#setProactiveIntervalMin').addEventListener('input', onProactiveRange);
      $('#setProactiveIntervalMax').addEventListener('input', onProactiveRange);
      $('#setFailCooldown').addEventListener('input', (ev) => { const v = Math.max(1, parseFloat(ev.target.value) || 3); LC.config.failCooldownMin = v; LC.Storage.set('config', LC.config); LC.ChatEngine.refreshProactive(); });
      // 抉择弹窗
      $('#extChoiceBtn').addEventListener('click', () => this._openChoiceModal());
      // 表情大乱斗（先做按钮，功能后续实现）
      $('#extEmojiRumbleBtn').addEventListener('click', () => { this._toast('表情大乱斗开发中～'); this._closeExpandMenu(); });
      // 信件投递
      $('#extLettersBtn').addEventListener('click', () => this._openLetterScreen());
      $('#letterCloseBtn').addEventListener('click', () => this._closeLetterScreen());
      $('#letterExportBtn').addEventListener('click', () => this._exportLetters());
      $('#letterImportBtn').addEventListener('click', () => $('#letterImportInput').click());
      $('#letterImportInput').addEventListener('change', (ev) => this._importLetters(ev));
      $('#letterFavBtn').addEventListener('click', () => this._toggleFavMode());
      $$('.letter-tab').forEach(b => b.addEventListener('click', () => this._switchLetterTab(b.dataset.tab)));
      $('#letterWriteBtn').addEventListener('click', () => this._enterComposeMode());
      $('#letterCancelBtn').addEventListener('click', () => this._exitComposeMode());
      $('#letterSendBtn').addEventListener('click', () => this._sendLetter());
      $('#letterModalClose').addEventListener('click', () => this._hideModal('letterModal'));
      // 气泡设计弹窗
      $('#bubbleDesignBtn').addEventListener('click', () => this._openBubbleDesign());
      $('#bubbleDesignClose').addEventListener('click', () => this._hideModal('bubbleDesignModal'));
      $('#bubbleCSSClear').addEventListener('click', () => { $('#bubbleCSSInput').value = ''; $('#bubbleCSSInput').focus(); });
      $('#bubbleCSSApply').addEventListener('click', () => this._applyBubbleCSS());
      // 信件设置
      $('#setLetterReplyMin').addEventListener('input', (ev) => this._onLetterReplyHoursChange());
      $('#setLetterReplyMax').addEventListener('input', (ev) => this._onLetterReplyHoursChange());
      $('#setLetterReplyCountMin').addEventListener('input', (ev) => this._onLetterReplyCountChange());
      $('#setLetterReplyCountMax').addEventListener('input', (ev) => this._onLetterReplyCountChange());
      $('#setLetterProactiveMin').addEventListener('input', (ev) => this._onLetterProactiveChange());
      $('#setLetterProactiveMax').addEventListener('input', (ev) => this._onLetterProactiveChange());
      $('#setLetterProactiveContinuous').addEventListener('change', (ev) => { LC.config.letterProactiveContinuous = ev.target.checked; LC.Storage.set('config', LC.config); });
      // 聊天记录导出/导入
      $('#exportChatBtn').addEventListener('click', () => this._exportChatHistory());
      $('#exportChatJsonBtn').addEventListener('click', () => this._exportChatHistoryJson());
      $('#importChatBtn').addEventListener('click', () => $('#importChatInput').click());
      $('#importChatInput').addEventListener('change', (ev) => this._importChatHistory(ev));
      $('#choiceCancelBtn').addEventListener('click', () => this._closeModal('choiceModal'));
      $('#choiceSendBtn').addEventListener('click', () => this._sendChoice());
      $('#choiceAddOptBtn').addEventListener('click', () => this._addChoiceOption());
      $('#choiceQuestion').addEventListener('input', () => this._updateChoiceSendBtn());
      // 抉择模式：单选 / 多选 切换
      $('#choiceModeSingle').addEventListener('click', () => this._setChoiceMode('single'));
      $('#choiceModeMulti').addEventListener('click', () => this._setChoiceMode('multi'));
      // 抉择详情
      $('#choiceDetailCloseBtn').addEventListener('click', () => this._closeModal('choiceDetailModal'));
      $('#clearChatBtn').addEventListener('click', () => this._onClearChat());
      $('#resetAllBtn').addEventListener('click', () => this._onResetAll());
      // 全量导出/导入
      $('#exportAllBtn').addEventListener('click', () => this._onExportAll());
      $('#importAllBtn').addEventListener('click', () => $('#importAllInput').click());
      $('#importAllInput').addEventListener('change', (ev) => this._onImportAll(ev));
      $('#pasteImportBtn').addEventListener('click', () => this._openPasteImportModal());
      // 拍一拍快捷
      this._renderPatQuick();
      // 点击弹窗外区域关闭（针对无关闭按钮的浮层：扩展菜单 / 输入展开 / 表情包选择器）
      document.addEventListener('click', (ev) => this._onOutsideClick(ev), true);
      // 消息区滚动监听 + 回到底部指示器点击（需求1）
      e.messages.addEventListener('scroll', () => {
        // 防抖：连续滚动时只在停下后处理（避免高频更新）
        clearTimeout(this._scrollDebounce);
        this._scrollDebounce = setTimeout(() => this._updateScrollState(), 60);
      }, { passive: true });
      $('#scrollBottomBtn').addEventListener('click', () => this._onScrollBottomClick());
      // 隐藏 / 显示 界面（只保留聊天记录，隐藏顶部条框/底部条框/回到底部按钮）
      $('#uiHideBtn').addEventListener('click', () => this._setUIHidden(true));
      $('#uiShowBtn').addEventListener('click', () => this._setUIHidden(false));
    },
    /* 隐藏/显示界面切换：隐藏时把顶/底/回到底部条框全部隐藏，左上角出现实心圆恢复按钮 */
    _setUIHidden(hidden) {
      document.body.classList.toggle('ui-hidden', hidden);
      this.el.uiShowBtn.hidden = !hidden;
      // 隐藏界面时同步隐藏回到底部指示器，避免它浮在消息上
      if (hidden) {
        this.el.scrollBottomBtn.hidden = true;
        this.el.scrollBottomBtn.classList.remove('show');
      }
    },

    /** 处理点击浮层外部时关闭（仅对无关闭按钮的浮层，提升体验） */
    _onOutsideClick(ev) {
      // 导出方式选择浮窗（点外部关闭，但点选项不关闭——选项点击由内部 click 处理）
      const choiceMenu = $('#exportChoiceMenu');
      if (choiceMenu && !choiceMenu.hidden
          && !choiceMenu.contains(ev.target) && !$('#exportBtn').contains(ev.target)) {
        this._closeExportChoice();
        return;
      }
      // 导入方式浮窗（覆盖/添加）：点任何空白处关闭（按分组导入 / 全量导入按钮都触发该菜单，需排除）
      const importModeMenu = $('#importModeMenu');
      if (importModeMenu && !importModeMenu.hidden
          && !importModeMenu.contains(ev.target)
          && !$('#importGroupBtn').contains(ev.target)
          && !$('#importFullBtn').contains(ev.target)) {
        this._closeImportModeMenu();
        return;
      }
      // 消息长按操作浮窗（引用/删除）：点任何空白处关闭
      const msgMenu = $('#msgActionMenu');
      if (msgMenu && !msgMenu.hidden) {
        this._handleMsgMenuOutsideClick(ev);
      }
      // 拍一拍标志弹窗：点任何空白处关闭
      const patM = $('#patMarkMenu');
      if (patM && !patM.hidden) { this._handlePatMarkOutsideClick(ev); }
      // 扩展菜单底部弹窗
      const sheet = this.el.expandMenuSheet;
      if (sheet && !sheet.hidden && sheet.classList.contains('show')
          && !sheet.contains(ev.target) && !$('#expandMenuBtn').contains(ev.target)) {
        this._closeExpandMenu();
        return;
      }
      // 输入展开弹窗（多条发送模式下不处理）
      const expand = this.el.inputExpand;
      if (expand && !expand.hidden && !this._multiMode
          && !expand.contains(ev.target) && !this.el.messageInput.contains(ev.target)) {
        this._closeInputExpand(false);
      }
      // 表情包选择器：仅点取消按钮关闭，不响应空白处点击（按需求 2.3 修复）
    },

    /* ============ 消息渲染 ============ */
    // 分批加载配置（参考 milk-main：初始 70 条 + 每批 100 条 + 哨兵 + 隐藏容器避免跳动）
    _renderBatch: 70,          // 初始加载条数
    _loadBatch: 100,           // 每次上滑加载条数
    _loadedCount: 0,           // 已渲染条数（从末尾往前累计）
    _loadingMore: false,       // 加载中标志（防重入）
    _loadMoreObserver: null,   // IntersectionObserver 实例（监听顶部哨兵）
    renderHistory() {
      const h = LC.ChatEngine.getHistory();
      this.el.messagesScroll.innerHTML = '';
      this._loadingMore = false;
      if (!h.length) {
        this._loadedCount = 0;
        this.el.emptyState.style.display = '';
        this._updateMessagesLayout();
        return;
      }
      this.el.emptyState.style.display = 'none';
      // 只渲染最近 _renderBatch 条；若总条数更少则全量渲染
      const start = Math.max(0, h.length - this._renderBatch);
      this._loadedCount = h.length - start;
      let lastDate = '';
      for (let i = start; i < h.length; i++) {
        const m = h[i];
        const ds = this._fmtDate(m.time);
        if (ds !== lastDate) { this._renderDateSep(ds); lastDate = ds; }
        this._renderMessage(m, false);
      }
      // 仍有更早历史 → 顶部插入"向上滚动加载更多"提示
      if (start > 0) this._renderLoadMoreIndicator(false);
      this._updateMessagesLayout();
      // 启动时确保滚到底：多时机兜底（双 rAF + setTimeout + window load）
      // 应对 file:// 直开 + 字体/图片慢加载场景，任何时机没到底就再滚一次
      this._ensureScrollBottomOnBoot();
      // 启动 IntersectionObserver 监听顶部哨兵
      this._observeLoadMore();
    },
    /* IntersectionObserver 监听顶部"加载更多"哨兵，进入视野 200px 时触发加载
     * 参考 milk-main core.js L2305-L2321 */
    _observeLoadMore() {
      const sentinel = document.getElementById('loadMoreTop');
      if (!sentinel) {
        // 没有哨兵（已无更多历史）：断开旧 observer
        if (this._loadMoreObserver) { this._loadMoreObserver.disconnect(); this._loadMoreObserver = null; }
        return;
      }
      // 已存在 observer：先断开（避免重复 observe），再重新观察新哨兵节点
      if (this._loadMoreObserver) this._loadMoreObserver.disconnect();
      if (typeof IntersectionObserver === 'undefined') return; // 老浏览器降级
      this._loadMoreObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !this._loadingMore) {
          const h = LC.ChatEngine.getHistory();
          if (this._loadedCount < h.length) this._loadMoreHistory();
        }
      }, {
        root: this.el.messages,
        rootMargin: '200px 0px 0px 0px',   // 顶部 200px 提前触发
        threshold: 0.01
      });
      this._loadMoreObserver.observe(sentinel);
    },
    /* 顶部"加载更多"提示节点（点击或滚动到顶部触发） */
    _renderLoadMoreIndicator(loading = false) {
      const old = document.getElementById('loadMoreTop');
      if (old) {
        // 只切换状态，避免重复插入
        old.classList.toggle('loading', loading);
        old.firstElementChild && (old.firstElementChild.textContent = loading ? '加载中…' : '向上滚动加载更多');
        return;
      }
      const indicator = document.createElement('div');
      indicator.id = 'loadMoreTop';
      indicator.className = 'load-more-indicator';
      indicator.innerHTML = `<span>${loading ? '加载中…' : '向上滚动加载更多'}</span>`;
      this.el.messagesScroll.insertBefore(indicator, this.el.messagesScroll.firstChild);
    },
    _removeLoadMoreIndicator() {
      const old = document.getElementById('loadMoreTop');
      if (old) old.remove();
    },
    /* 向前加载一批（_loadedCount 之前的 _renderBatch 条）
     * 关键：插入顶部时保持当前 scrollTop 不跳变（视野不动） */
    _loadMoreHistory() {
      if (this._loadingMore) return;
      const h = LC.ChatEngine.getHistory();
      if (this._loadedCount >= h.length) { this._removeLoadMoreIndicator(); return; }
      this._loadingMore = true;
      this._renderLoadMoreIndicator(true);
      const container = this.el.messages;           // 滚动容器
      const scrollInner = this.el.messagesScroll;   // 消息列表容器

      // === 锚点法（参考 milk-main core.js L91-L134）：找当前视窗内第一条可见 msg-row ===
      const wrappers = Array.from(scrollInner.querySelectorAll('.msg-row'));
      const firstVisible = wrappers.find(el => el.offsetTop + el.offsetHeight >= container.scrollTop)
                          || wrappers[0] || null;
      const anchorId = firstVisible ? firstVisible.dataset.id : null;
      const anchorTop = firstVisible ? firstVisible.getBoundingClientRect().top : 0;

      // === 隐藏容器（淡出 + 隐藏 overflow）避免渲染跳动可见 ===
      const prevVisibility = scrollInner.style.visibility;
      const prevOverflow   = container.style.overflow;
      const prevScrollBehavior = container.style.scrollBehavior;
      const prevOpacity    = scrollInner.style.opacity;
      scrollInner.style.opacity = '0.015';
      scrollInner.style.visibility = 'hidden';
      container.style.overflow = 'hidden';
      container.style.scrollBehavior = 'auto';

      // 计算新一批范围（向前再取 _loadBatch 条）
      const prevStart = h.length - this._loadedCount;
      const newCount = Math.min(this._loadBatch, prevStart);
      const newStart = prevStart - newCount;

      setTimeout(() => {
        // 渲染新批次到 DocumentFragment，避免多次 reflow
        this._removeLoadMoreIndicator();
        const frag = document.createDocumentFragment();
        let lastDate = '';
        for (let i = newStart; i < newStart + newCount; i++) {
          const m = h[i];
          const ds = this._fmtDate(m.time);
          if (ds !== lastDate) { this._renderDateSep(ds, frag); lastDate = ds; }
          this._renderMessage(m, false, frag);
        }
        if (newStart > 0) {
          const indicator = document.createElement('div');
          indicator.id = 'loadMoreTop';
          indicator.className = 'load-more-indicator';
          indicator.innerHTML = '<span>向上滚动加载更多</span>';
          frag.insertBefore(indicator, frag.firstChild);
        }
        scrollInner.insertBefore(frag, scrollInner.firstChild);
        this._loadedCount += newCount;

        // === 第一帧 rAF：用锚点修正 scrollTop（让视野保持原位置） ===
        requestAnimationFrame(() => {
          if (anchorId) {
            const newAnchor = scrollInner.querySelector('.msg-row[data-id="' + CSS.escape(anchorId) + '"]');
            if (newAnchor) {
              const newTop = newAnchor.getBoundingClientRect().top;
              container.scrollTop += (newTop - anchorTop);
            }
          } else {
            // 无锚点兜底：保持原 scrollTop + 新增内容高度
          }

          // === 第二帧 rAF：恢复可见 ===
          requestAnimationFrame(() => {
            scrollInner.style.opacity = prevOpacity || '';
            scrollInner.style.visibility = prevVisibility || '';
            container.style.overflow = prevOverflow || '';
            container.style.scrollBehavior = prevScrollBehavior || '';
            this._loadingMore = false;
            // 重新观察哨兵（IntersectionObserver 在隐藏期间可能漏触发）
            this._observeLoadMore();
          });
        });
      }, 120);
    },
    /** 根据消息内容高度动态切换对齐方式：
     *  消息少（未撑满容器）→ 从顶部开始显示，避免空界面下方大片留白
     *  消息多（撑满或溢出）→ 从底部开始，新消息在视野内 */
    _updateMessagesLayout() {
      const scroll = this.el.messagesScroll;
      const container = this.el.messages;
      if (!scroll || !container) return;
      // 内容高度（含 padding）小于容器可视高度 → 顶部对齐
      if (scroll.scrollHeight <= container.clientHeight) {
        scroll.classList.add('align-top');
      } else {
        scroll.classList.remove('align-top');
      }
    },
    _renderDateSep(ds, container = null) {
      const s = document.createElement('div'); s.className = 'date-separator';
      s.innerHTML = `<span>${esc(ds)}</span>`;
      (container || this.el.messagesScroll).appendChild(s);
    },
    _renderMessage(msg, animate = true, container = null) {
      // 首条消息：隐藏空状态
      if (this.el.emptyState) this.el.emptyState.style.display = 'none';
      if (msg.kind === 'pat') { this._renderPatMessage(msg, animate, container); this._updateMessagesLayout(); return; }
      if (msg.kind === 'choice') { this._renderChoiceMessage(msg, animate, container); this._updateMessagesLayout(); return; }
      if (msg.kind === 'letter') { this._renderLetterMessage(msg, animate, container); this._updateMessagesLayout(); return; }
      const row = document.createElement('div');
      row.className = 'msg-row ' + msg.role;
      row.dataset.id = msg.id;
      // 我和对方都显示头像（支持 emoji 字符串 / {url,crop} 对象）
      const av = msg.role === 'partner' ? LC.config.partner.avatar : LC.config.user.avatar;
      const isPhoto = av && typeof av === 'object';
      const avatarHTML = this._avatarHTML(av);
      const avClass = isPhoto ? ' avatar-photo' : (av ? '' : ' avatar-default');
      const isSticker = msg.kind === 'sticker';
      // message-sent/message-received 为"气泡设计"自定义 CSS 的别名类名，用户可直接粘贴用这两个类名写的 CSS
      // 仅文字气泡加别名，表情包气泡不受自定义样式影响
      const alias = isSticker ? '' : (msg.role === 'partner' ? ' message-received' : ' message-sent');
      const bubbleClass = (isSticker ? 'msg-bubble sticker-bubble' : 'msg-bubble') + alias;
      const content = isSticker ? `<img src="${esc(msg.content)}" alt="表情" onerror="this.style.background='rgba(231,84,128,.15)';this.alt='[图片加载失败]'">` : esc(msg.content);
      const timeStr = this._fmtTime(msg.time);
      // 引用块（微信式：气泡内顶部展示被引用内容，带分隔线）
      const quoteHTML = msg.quote ? this._quoteBlockHTML(msg.quote) : '';
      row.innerHTML = `<div class="avatar${avClass}">${avatarHTML}</div><div class="bubble-group"><div class="${bubbleClass}">${quoteHTML}${content}</div><div class="msg-time">${timeStr}</div></div>`;
      if (!animate) row.style.animation = 'none';
      (container || this.el.messagesScroll).appendChild(row);
      // 长按消息弹出操作菜单（引用 / 删除）—— 仅普通文字与表情包消息支持
      this._attachLongPress(row, msg);
      if (!container) this._updateMessagesLayout();
      if (animate && !container) this._maybeAutoScroll(msg.role);
    },
    /** 渲染头像 HTML（支持 emoji 字符串 / {url,crop} 对象 / 空=默认剪影） */
    _avatarHTML(avatar) {
      if (!avatar) {
        // 默认头像：空白小人胸像剪影（参考抖音默认头像），白色人胸像 SVG
        return `<svg class="avatar-default-svg" viewBox="0 0 24 24" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><path fill="#ffffff" d="M12 12.5c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v3h16v-3c0-2.66-5.33-4-8-4z"/></svg>`;
      }
      if (typeof avatar === 'string') return esc(avatar);
      if (avatar && avatar.url) {
        const c = avatar.crop || { x: 0, y: 0, w: 1, h: 1 };
        return `<img src="${esc(avatar.url)}" alt="" style="object-position:-${Math.round(c.x*100)}% -${Math.round(c.y*100)}%;transform:scale(${1/c.w});">`;
      }
      return '';
    },
    /* ============ 消息长按操作：引用 / 删除 ============ */
    /** 给消息行绑定 500ms 长按事件（移动端 touchstart + 桌面端 mousedown） */
    _attachLongPress(row, msg) {
      let timer = null;
      const start = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          this._showMsgMenu(msg, row);
          if (navigator.vibrate) try { navigator.vibrate(10); } catch (_) {}
        }, 500);
      };
      const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
      row.addEventListener('touchstart', start, { passive: true });
      row.addEventListener('touchend', cancel);
      row.addEventListener('touchmove', cancel, { passive: true });
      row.addEventListener('touchcancel', cancel);
      row.addEventListener('mousedown', start);
      row.addEventListener('mouseup', cancel);
      row.addEventListener('mouseleave', cancel);
      // 屏蔽移动端长按选中文字的默认菜单
      row.addEventListener('contextmenu', (e) => e.preventDefault());
    },
    /** 显示长按操作浮窗（引用 / 删除），定位在消息行上方 */
    _showMsgMenu(msg, row) {
      const m = $('#msgActionMenu');
      if (!m) return;
      this._closeMsgMenu();
      m.dataset.targetId = msg.id;
      const r = row.getBoundingClientRect();
      // 先显示才能取高度
      m.hidden = false;
      const menuH = m.offsetHeight || 40;
      const menuW = m.offsetWidth || 120;
      // 默认放在消息行上方，水平居中于消息；上方空间不足则放下方
      let top = r.top - menuH - 6;
      const placeBelow = top < 8;
      if (placeBelow) top = r.bottom + 6;
      let left = r.left + r.width / 2 - menuW / 2;
      if (left < 8) left = 8;
      if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
      m.style.left = left + 'px';
      m.style.top = top + 'px';
      m.dataset.placed = '1';
    },
    _closeMsgMenu() {
      const m = $('#msgActionMenu');
      if (m) { m.hidden = true; m.removeAttribute('data-target-id'); m.removeAttribute('data-placed'); }
    },
    /** 点空白处关闭消息操作浮窗（在全局 click 处理里调用） */
    _handleMsgMenuOutsideClick(ev) {
      const m = $('#msgActionMenu');
      if (!m || m.hidden) return false;
      // 刚显示的这一次点击不处理（避免长按抬起立刻被关闭）
      if (m.dataset.placed === '1') { m.removeAttribute('data-placed'); return true; }
      if (!m.contains(ev.target)) { this._closeMsgMenu(); return true; }
      return false;
    },
    /** 引用某条消息：把被引用信息存入 _pendingQuote，显示输入栏引用预览条 */
    _quoteMessage(msg) {
      this._pendingQuote = { content: msg.content, role: msg.role, kind: msg.kind || 'text' };
      this._renderQuotePreview();
      // 聚焦输入栏，让用户直接打字
      try { this.el.messageInput.focus(); } catch (_) {}
    },
    _renderQuotePreview() {
      const bar = $('#quotePreview');
      if (!bar) return;
      if (!this._pendingQuote) { bar.hidden = true; return; }
      const q = this._pendingQuote;
      const who = q.role === 'me' ? '我' : 'Ta';
      const isSticker = q.kind === 'sticker';
      const text = isSticker ? '[表情]' : (q.content.length > 40 ? q.content.slice(0, 40) + '…' : q.content);
      bar.querySelector('.quote-preview-label').textContent = '引用 ' + who + '：';
      bar.querySelector('.quote-preview-text').textContent = text;
      bar.hidden = false;
    },
    _cancelQuote() {
      this._pendingQuote = null;
      this._renderQuotePreview();
    },
    /** 删除某条消息（仅删该条，其他不影响） */
    _deleteMessage(id) {
      LC.ChatEngine.deleteMessage(id);
      const row = this.el.messagesScroll.querySelector(`.msg-row[data-id="${CSS.escape(id)}"]`);
      if (row) row.remove();
      // 如果没有消息了，恢复空状态
      if (!this.el.messagesScroll.querySelector('.msg-row')) {
        if (this.el.emptyState) this.el.emptyState.style.display = '';
      }
      this._updateMessagesLayout();
      this._toast('已删除');
    },
    /** 生成消息气泡内的引用块 HTML */
    _quoteBlockHTML(quote) {
      const who = quote.role === 'me' ? '我' : 'Ta';
      if (quote.kind === 'sticker') {
        return `<div class="msg-quote"><img class="msg-quote-img" src="${esc(quote.content)}" alt="[表情]"><span class="msg-quote-text">${who}</span></div>`;
      }
      return `<div class="msg-quote"><span class="msg-quote-text">${esc(quote.content)}</span></div>`;
    },
    /* ============ 拍一拍标志选择弹窗（居中 modal） ============ */
    _openPatMarkMenu(who, anchorBtn) {
      const m = $('#patMarkMenu');
      this._closePatMarkMenu();
      // 填充符号选项
      const grid = $('#patMarkGrid');
      const cur = who === 'me' ? (LC.config.patMarkMe || '') : (LC.config.patMarkPartner || '');
      grid.innerHTML = (LC.PAT_MARKS || []).map(sym =>
        `<button class="pat-mark-opt${sym === cur ? ' active' : ''}" data-mark="${esc(sym)}">${esc(sym)}</button>`
      ).join('');
      m.dataset.who = who;
      $('#patMarkTitle').textContent = who === 'me' ? '我的拍一拍标志' : '他的拍一拍标志';
      this._showModal('patMarkMenu');
      // 标记刚打开：跳过这一次点击（避免打开弹窗的点击立刻触发关闭）
      m.dataset.placed = '1';
    },
    _closePatMarkMenu() { const m = $('#patMarkMenu'); if (m) m.removeAttribute('data-placed'); this._closeModal('patMarkMenu'); },
    _handlePatMarkOutsideClick(ev) {
      const m = $('#patMarkMenu');
      if (!m || m.hidden || !m.classList.contains('show')) return;
      // 刚打开的那次点击跳过
      if (m.dataset.placed === '1') { m.removeAttribute('data-placed'); return; }
      // 点弹窗内容不关闭
      if (m.contains(ev.target)) return;
      this._closePatMarkMenu();
    },
    /** 渲染抉择 box 消息（用户发 + 对方回） */
    _renderChoiceMessage(msg, animate = true, container = null) {
      const row = document.createElement('div');
      row.className = 'msg-row ' + msg.role;
      row.dataset.id = msg.id;
      const av = msg.role === 'partner' ? LC.config.partner.avatar : LC.config.user.avatar;
      const isPhoto = av && typeof av === 'object';
      const avatarHTML = this._avatarHTML(av);
      const avClass = isPhoto ? ' avatar-photo' : (av ? '' : ' avatar-default');
      const c = msg.content || {};
      const isReply = msg.role === 'partner';
      // 拆为 前缀 + 问题内容 + 后缀 三段，方便"限4行时只在问题内容上省略"
      const pre = isReply ? '已完成「' : '关于「';
      const suf = '」的抉择';
      const question = c.question || '';
      const timeStr = this._fmtTime(msg.time);
      // 抉择模式标识：单选/多选（旧数据无 mode 视为单选）
      const modeLabel = c.mode === 'multi' ? '多选' : '单选';
      // box 只显示标题, 不显示选项列表 (查看详情时再展示)
      row.innerHTML = `<div class="avatar${avClass}">${avatarHTML}</div><div class="bubble-group"><div class="choice-bubble" data-id="${esc(msg.id)}"><div class="cb-title"><span class="cb-pre">${esc(pre)}</span><span class="cb-q">${esc(question)}</span><span class="cb-suf">${esc(suf)}</span></div><div class="cb-foot"><span class="cb-mode">${esc(modeLabel)}</span><span class="cb-foot-hint">点击查看详情</span></div></div><div class="msg-time">${timeStr}</div></div>`;
      if (!animate) row.style.animation = 'none';
      (container || this.el.messagesScroll).appendChild(row);
      // 需求2：标题视觉最多 4 行（不含"点击查看详情"提示行），超出时只省略问题内容，保留模板前后缀
      this._clampChoiceTitle(row.querySelector('.cb-title'), pre, question, suf, 4);
      // 点击 box 打开详情弹窗
      row.querySelector('.choice-bubble').addEventListener('click', () => this._openChoiceDetail(msg.id));
      if (animate && !container) this._maybeAutoScroll(msg.role);
    },
    /* 需求2：抉择框标题限 maxLines 行（视觉行，按 scrollHeight vs lineHeight*maxLines 判定）
     * 超出时通过二分查找截断问题内容（保留前缀 pre 与后缀 suf），并在截断处加 "…" */
    _clampChoiceTitle(container, pre, question, suf, maxLines) {
      if (!container) return;
      // 模板结构：前缀 + 问题内容 + 后缀
      const setHTML = (qText) => {
        container.innerHTML = `<span class="cb-pre">${esc(pre)}</span><span class="cb-q">${esc(qText)}</span><span class="cb-suf">${esc(suf)}</span>`;
      };
      // 先用完整问题内容测量
      setHTML(question);
      const cs = getComputedStyle(container);
      const lineHeight = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.5) || 21;
      // 容差 1.5px，避免 sub-pixel 抖动
      const maxHeight = lineHeight * maxLines + 1.5;
      if (container.scrollHeight <= maxHeight) return; // 完整放得下，无需截断
      if (!question) return;
      // 检查截断后是否放得下：返回给定长度下"前缀 + sliced + '…' + 后缀"是否 fit
      const tryLen = (len) => {
        const t = question.slice(0, len);
        const q = len < question.length ? (t + '…') : t;
        setHTML(q);
        return container.scrollHeight <= maxHeight;
      };
      // 二分查找最大可显示长度（前提：len=0 时一定能放下省略号+模板）
      if (!tryLen(0)) { tryLen(0); return; } // 极端情况：连省略号都放不下
      let lo = 0, hi = question.length, result = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (tryLen(mid)) { result = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      // 应用最终结果（重新设置一次确保状态正确）
      tryLen(result);
    },
    /** 渲染信封样式消息（信件发送到聊天记录时） */
    _renderLetterMessage(msg, animate = true, container = null) {
      const row = document.createElement('div');
      row.className = 'msg-row ' + msg.role;
      row.dataset.id = msg.id;
      const av = msg.role === 'partner' ? LC.config.partner.avatar : LC.config.user.avatar;
      const isPhoto = av && typeof av === 'object';
      const avatarHTML = this._avatarHTML(av);
      const avClass = isPhoto ? ' avatar-photo' : (av ? '' : ' avatar-default');
      const c = msg.content || {};
      const letterId = c.letterId;
      const timeStr = this._fmtTime(msg.time);
      const titleText = msg.role === 'me' ? '我寄出了一封信，记得查收' : 'Ta 寄来了一封信，记得查收';
      row.innerHTML = `<div class="avatar${avClass}">${avatarHTML}</div><div class="bubble-group"><div class="letter-bubble" data-letter-id="${esc(letterId || '')}"><div class="lb-icon">✉️</div><div class="lb-text">${esc(titleText)}</div><div class="lb-foot">点击查看信件</div></div><div class="msg-time">${timeStr}</div></div>`;
      if (!animate) row.style.animation = 'none';
      (container || this.el.messagesScroll).appendChild(row);
      row.querySelector('.letter-bubble').addEventListener('click', () => this._openLetterPreview(letterId));
      if (animate && !container) this._maybeAutoScroll(msg.role);
    },
    _renderChoicePreview(options, chosenIndex) {
      const arr = options || [];
      const max = 3;
      const shown = arr.slice(0, max).map((o, i) => {
        const cls = (chosenIndex === i) ? 'cb-opt chosen' : 'cb-opt';
        return `<div class="${cls}">${esc(o)}</div>`;
      }).join('');
      const extra = arr.length > max ? `<div class="cb-opt">…还有 ${arr.length - max} 个</div>` : '';
      return shown + extra;
    },
    _renderPatMessage(msg, animate = true, container = null) {
      const row = document.createElement('div');
      row.className = 'msg-row pat';
      row.dataset.id = msg.id;
      // 拍一拍作为系统消息样式字卡：直接显示字卡文字内容，不再拼成"X 拍了拍 Y"句子
      // 前缀标志区分我/他（用户在"个性化"里设置 patMarkMe / patMarkPartner）
      const mark = msg.role === 'me' ? (LC.config.patMarkMe || '') : (LC.config.patMarkPartner || '');
      const markHTML = mark ? `<span class="pat-mark">${esc(mark)}</span>` : '';
      row.innerHTML = `<div class="pat-msg">${markHTML}${esc(msg.content || '')}</div>`;
      if (!animate) row.style.animation = 'none';
      (container || this.el.messagesScroll).appendChild(row);
      if (animate && !container) this._maybeAutoScroll(msg.role);
    },
    _scrollBottom(instant) {
      const el = this.el.messages;
      if (instant) el.scrollTop = el.scrollHeight;
      else requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
    },
    /* 启动时确保滚到底：多次兜底，应对 file:// 直开 + 字体/图片慢加载场景
     * 任何时机只要还没到底就再滚一次；已到底则跳过 */
    _ensureScrollBottomOnBoot() {
      const el = this.el.messages;
      const tryScroll = () => {
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (dist > 5) el.scrollTop = el.scrollHeight;
      };
      // 多个时机兜底：双 rAF / 0ms / 50ms / 200ms / 500ms / window load
      requestAnimationFrame(() => requestAnimationFrame(tryScroll));
      setTimeout(tryScroll, 0);
      setTimeout(tryScroll, 50);
      setTimeout(tryScroll, 200);
      setTimeout(tryScroll, 500);
      if (document.readyState !== 'complete') {
        window.addEventListener('load', () => setTimeout(tryScroll, 100), { once: true });
      }
    },
    /* 程序触发的滚动到底部（设置 _programmaticScroll 标志以避免 _updateScrollState
       在动画过程中误判为"用户向上翻"而显示指示器） */
    _programmaticScrollBottom(instant = false) {
      this._isAtBottom = true;
      this._programmaticScroll = true;
      this._scrollBottom(instant);
      clearTimeout(this._scrollFlagTimer);
      // smooth 动画约 300ms，留余量；instant 几乎立即完成
      this._scrollFlagTimer = setTimeout(() => { this._programmaticScroll = false; }, instant ? 120 : 550);
    },
    /* 新消息渲染后调用：根据用户当前位置决定滚到底部或累计未读
     * - 用户在底部：滚动到底部（带 programmatic 标志，避免误判）
     * - 我自己发的消息：强制滚动到底部（用户主动发送后应回到最新一条）
     * - 用户不在底部 + 对方消息：累计未读、显示指示器（不滚） */
    _maybeAutoScroll(role) {
      if (this._isAtBottom || role === 'me') {
        this._programmaticScrollBottom(false);
      } else if (role === 'partner') {
        this._unreadCount = (this._unreadCount || 0) + 1;
        this._showScrollToBottom(this._unreadCount);
      }
    },
    /* 根据当前滚动位置更新状态 + 指示器显隐
     * 触发指示器显示的阈值：距离底部 > 容器可视高度的一半（"翻半页"以上）
     * 注意：上滑加载历史改由 IntersectionObserver 监听顶部哨兵触发（_observeLoadMore），
     *       本函数只负责"回到底部"指示器的显隐，不再判断 scrollTop<=50 */
    _updateScrollState() {
      const el = this.el.messages;
      if (!el) return;
      // 程序滚动期间：保持"在底部"状态，不更新指示器
      if (this._programmaticScroll) {
        this._isAtBottom = true;
        return;
      }
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const NEAR_BOTTOM = 60;            // 距底 60px 内算"已在底部"
      const SHOW_THRESHOLD = el.clientHeight * 0.5; // 超过半页距离才显示指示器
      const wasAtBottom = this._isAtBottom;
      this._isAtBottom = distance < NEAR_BOTTOM;
      if (this._isAtBottom) {
        // 已在底部：清零未读、隐藏指示器
        if (this._unreadCount > 0 || this._scrollBtnVisible) {
          this._unreadCount = 0;
          this._hideScrollToBottom();
        }
      } else if (distance > SHOW_THRESHOLD) {
        // 离底部够远：显示指示器（带未读数，可能为 0）
        this._showScrollToBottom(this._unreadCount);
      } else if (this._scrollBtnVisible) {
        // 中间区域（半页内但不在底部）：隐藏指示器
        this._hideScrollToBottom();
      }
    },
    /* ============ 聊天记录条数提醒 ============
     * 取消 800 条上限后，改为条数提醒引导用户备份
     * 规则：超过 5000 / 8000 条时，在聊天顶部弹出纯色提示横幅
     * 每个档位点"我知道了"后不再提醒；清空记录后自动重置，下次再超会重新提醒 */
    _historyReminderThresholds: [5000, 8000],
    async _checkHistoryReminder() {
      try {
        const count = LC.ChatEngine.getHistory().length;
        let dismissed = await LC.Storage.get('historyReminderDismissed', 0) || 0;
        // 记录被清空/减少 → 重置已读档位，下次再超会重新提醒
        if (count < dismissed) { dismissed = 0; LC.Storage.set('historyReminderDismissed', 0); }
        // 找当前应提醒的最高档位（未读过且已到达的）
        const hit = this._historyReminderThresholds.filter(t => count >= t && t > dismissed).pop();
        if (!hit) return;
        this._showHistoryReminder(hit);
      } catch (e) { console.warn('[LoveChat] 条数提醒检查失败:', e); }
    },
    _showHistoryReminder(threshold) {
      const old = document.getElementById('historyReminderBanner');
      if (old) old.remove();
      const chatView = document.querySelector('.chat-view');
      if (!chatView) return;
      const banner = document.createElement('div');
      banner.id = 'historyReminderBanner';
      banner.className = 'history-reminder';
      banner.innerHTML = `
        <div class="hr-main">⚠️ 温馨提示：当前对话记录已超过 ${threshold} 条，为保障程序持续流畅运行，建议定期备份聊天记录。</div>
        <div class="hr-sub">小提示：聊天记录累计过多可能造成卡顿。如遇卡顿，请前往设置——数据——导出聊天记录 进行备份，再清空当前聊天记录，以优化程序性能。</div>
        <div class="hr-footer"><button class="hr-ok" id="historyReminderOk">我知道了</button></div>`;
      chatView.appendChild(banner);
      banner.querySelector('#historyReminderOk').addEventListener('click', () => {
        LC.Storage.set('historyReminderDismissed', threshold);
        banner.classList.add('closing');
        setTimeout(() => banner.remove(), 200);
      });
    },
    _showScrollToBottom(count) {
      const btn = $('#scrollBottomBtn');
      if (!btn) return;
      const badge = $('#scrollBottomBadge');
      btn.hidden = false;
      // 触发回流后加 show 类，让过渡动画生效
      void btn.offsetWidth;
      btn.classList.add('show');
      if (badge) {
        if (count && count > 0) {
          badge.textContent = String(count);
          badge.hidden = false;
        } else {
          badge.hidden = true;
        }
      }
      this._scrollBtnVisible = true;
    },
    _hideScrollToBottom() {
      const btn = $('#scrollBottomBtn');
      if (!btn) { this._scrollBtnVisible = false; return; }
      btn.classList.remove('show');
      btn.hidden = true;
      const badge = $('#scrollBottomBadge');
      if (badge) badge.hidden = true;
      this._scrollBtnVisible = false;
    },
    _onScrollBottomClick() {
      // 立即跳到底部（不用 smooth，避免中间态触发指示器闪现）
      this._programmaticScrollBottom(true);
      this._unreadCount = 0;
      this._hideScrollToBottom();
    },
    showTyping(show) {
      this.el.typingIndicator.style.display = show ? 'flex' : 'none';
      const pav = LC.config.partner.avatar;
      this.el.typingAvatar.innerHTML = this._avatarHTML(pav);
      this.el.typingAvatar.classList.toggle('avatar-photo', !!(pav && typeof pav === 'object'));
      this.el.partnerStatus.textContent = show ? '正在输入…' : (LC.CardLibrary.getStatus()?.content || '在线');
      // 需求1：typing 不再强制拉回底部；仅当用户已在底部附近时才滚到底部显示输入指示
      if (show && this._isAtBottom) this._programmaticScrollBottom(false);
    },

    /* ============ 发送逻辑 ============ */
    _onSend() {
      const text = this.el.messageInput.value.trim();
      if (!text) return;
      this.el.messageInput.value = '';
      // 取出引用（发送后清空，无论多条/单条模式）
      const quote = this._pendingQuote || null;
      this._pendingQuote = null;
      this._renderQuotePreview();
      if (this._multiMode) {
        // 多条模式下，输入加入暂存列表（多条发送不支持引用，忽略 quote）
        this._multiList.push(text);
        this._renderMultiList();
        if (!this.el.inputExpand.hidden) this.el.inputExpandText.value = '';
        return;
      }
      // 同步展开弹窗
      if (!this.el.inputExpand.hidden) this.el.inputExpandText.value = '';
      LC.ChatEngine.sendUserMessage(text, {
        onUserMessage: (m) => { this.el.emptyState.style.display = 'none'; this._renderMessage(m); },
        onTypingStart: () => this.showTyping(true),
        onTypingEnd: () => this.showTyping(false),
        onUnit: (m) => this._renderMessage(m),
        onEmpty: () => { this.showTyping(false); this._toast('字卡库还是空的～去添加一些回复吧'); setTimeout(() => this.openCardsPanel(), 800); },
      }, quote);
      // 发送后自动关闭输入展开弹窗（取消开关，按需求 3.1 默认自动关闭）
      if (!this.el.inputExpand.hidden) {
        this._closeInputExpand(false);
      }
    },

    /* ============ 输入展开弹窗 ============ */
    _openInputExpand() {
      if (this._suppressExpand) return;
      this.el.inputExpand.hidden = false;
      this.el.inputExpandText.value = this.el.messageInput.value;
      // 扩展框打开时禁用 messageInput：光标只能在扩展框里移动
      this.el.messageInput.disabled = true;
      setTimeout(() => this.el.inputExpandText.focus(), 50);
    },
    _closeInputExpand(cancel) {
      if (!cancel) { this.el.messageInput.value = this.el.inputExpandText.value; }
      this.el.inputExpand.hidden = true;
      // 扩展框关闭时恢复 messageInput 可用
      this.el.messageInput.disabled = false;
      this._suppressExpand = true;
      this.el.messageInput.focus();
      setTimeout(() => { this._suppressExpand = false; }, 200);
    },
    /* ============ 底部功能弹窗统一关闭（三大分类互斥规则）============
     * 底部功能（拍一拍/表情包/多条发送/更多）属于"最底层"分类
     * 当打开字卡库或设置时，必须先关闭所有底部功能弹窗
     * 底部 4 个弹窗之间也互斥：开新弹窗前关闭其他三个 */
    _closeBottomPanels() {
      // 拍一拍
      const patM = $('#patModal');
      if (patM && !patM.hidden) this._hideModal('patModal');
      // 表情包
      const stickerM = $('#stickerPicker');
      if (stickerM && !stickerM.hidden) this._hideModal('stickerPicker');
      // 多条发送
      const multiM = $('#multiSendModal');
      if (multiM && !multiM.hidden) this._closeMultiSend(false);
      // 扩展菜单（更多）
      this._closeExpandMenu();
    },
    /* 底部 4 个弹窗互斥：保留指定弹窗，关闭其他三个
     * 参数 keep: 'patModal' | 'stickerPicker' | 'multiSendModal' | 'expandMenu' */
    _closeBottomPanelsExcept(keep) {
      if (keep !== 'patModal') {
        const patM = $('#patModal');
        if (patM && !patM.hidden) this._hideModal('patModal');
      }
      if (keep !== 'stickerPicker') {
        const stickerM = $('#stickerPicker');
        if (stickerM && !stickerM.hidden) this._hideModal('stickerPicker');
      }
      if (keep !== 'multiSendModal') {
        const multiM = $('#multiSendModal');
        if (multiM && !multiM.hidden) this._closeMultiSend(false);
      }
      if (keep !== 'expandMenu') this._closeExpandMenu();
    },

    /* ============ 多条发送 ============ */
    _openMultiSend() {
      // 底部 4 个弹窗互斥：开多条发送前关其他三个
      this._closeBottomPanelsExcept('multiSendModal');
      this._multiMode = true;
      // 不再无条件清空 _multiList：如果上次是被弹窗强制关闭（_closeMultiSend(false)），
      // 暂存的消息需要保留，下次重新打开时还能看到
      // 只有发送成功（_multiSend 内清空）或用户主动点取消（_closeMultiSend(true)）才会清空
      this._renderMultiList();
      this._showModal('multiSendModal');
      this.el.messageInput.focus();
    },
    _closeMultiSend(cancel) {
      // cancel=true：用户主动点取消，清空暂存消息
      // cancel=false：被弹窗强制关闭或点击空白，保留暂存消息
      if (cancel) this._multiList = [];
      this._multiMode = false;
      this._hideModal('multiSendModal');
    },
    _multiAdd() {
      const v = this.el.messageInput.value.trim();
      if (!v) return;
      this._multiList.push(v);
      this.el.messageInput.value = '';
      this.el.messageInput.focus();
      this._renderMultiList();
    },
    _renderMultiList() {
      if (!this._multiList.length) {
        this.el.multiSendList.innerHTML = '<div class="multi-empty">还没有添加消息</div>';
        return;
      }
      this.el.multiSendList.innerHTML = this._multiList.map((t, i) =>
        `<div class="multi-item"><span class="mi-text">${esc(t)}</span><button class="mi-del" data-i="${i}">×</button></div>`).join('');
      this.el.multiSendList.querySelectorAll('.mi-del').forEach(b => {
        b.addEventListener('click', () => { this._multiList.splice(parseInt(b.dataset.i), 1); this._renderMultiList(); });
      });
    },
    _multiSend() {
      if (!this._multiList.length) { this._toast('请先添加消息'); return; }
      const list = [...this._multiList];
      this._multiList = [];
      this._multiMode = false;
      this._hideModal('multiSendModal');
      this.el.emptyState.style.display = 'none';
      LC.ChatEngine.sendMultiMessage(list, {
        onUserMessage: (m) => this._renderMessage(m),
        onTypingStart: () => this.showTyping(true),
        onTypingEnd: () => this.showTyping(false),
        onUnit: (m) => this._renderMessage(m),
        onEmpty: () => { this.showTyping(false); this._toast('字卡库还是空的'); },
      });
    },

    /* ============ 拍一拍 ============ */
    _renderPatQuick() {
      this.el.patQuick.innerHTML = LC.PAT_QUICK.map(p => `<span data-p="${esc(p)}">${esc(p)}</span>`).join('');
      this.el.patQuick.querySelectorAll('span').forEach(s => s.addEventListener('click', () => { this.el.patInput.value = s.dataset.p; this.el.patInput.focus(); }));
    },
    _openPatModal() {
      // 底部 4 个弹窗互斥：开拍一拍前关其他三个
      this._closeBottomPanelsExcept('patModal');
      this.el.patInput.value = '';
      this._showModal('patModal');
      setTimeout(() => this.el.patInput.focus(), 100);
    },
    _onPatSend() {
      const text = this.el.patInput.value.trim();
      this._hideModal('patModal');
      this.el.emptyState.style.display = 'none';
      // 拍一拍走与文字一样的回合流程；_renderMessage 会按 kind='pat' 走系统消息渲染
      LC.ChatEngine.sendPat(text, {
        onUserMessage: (m) => this._renderMessage(m),
        onTypingStart: () => this.showTyping(true),
        onTypingEnd: () => this.showTyping(false),
        onUnit: (m) => this._renderMessage(m),
        onEmpty: () => { this.showTyping(false); this._toast('字卡库还是空的～去添加一些回复吧'); setTimeout(() => this.openCardsPanel(), 800); },
      });
    },

    /* ============ 表情包选择器 ============ */
    _openStickerPicker() {
      // 底部 4 个弹窗互斥：开表情包前关其他三个
      this._closeBottomPanelsExcept('stickerPicker');
      const stickers = LC.CardLibrary.getAll('sticker').filter(c => typeof c.content === 'string' && c.content.startsWith('data:image/'));
      if (!stickers.length) { this._toast('表情库还没有图片，去表情库添加吧'); setTimeout(() => this.openCardsPanel(), 800); return; }
      // 复用 modal 机制：动态弹窗
      let picker = $('#stickerPicker');
      if (!picker) {
        picker = document.createElement('div');
        picker.id = 'stickerPicker';
        picker.className = 'modal';
        picker.innerHTML = `<div class="modal-content"><h3 class="modal-title">选择表情包</h3><div class="grid-cards" id="stickerPickerGrid" style="max-height:300px;overflow:auto"></div><div class="modal-actions"><button class="ghost-btn full" id="stickerPickerClose">取消</button></div></div>`;
        document.getElementById('app').appendChild(picker);
        $('#stickerPickerClose').addEventListener('click', () => this._hideModal('stickerPicker'));
      }
      const grid = $('#stickerPickerGrid');
      grid.innerHTML = stickers.map(s => `<div class="grid-card" data-id="${esc(s.id)}"><img class="gc-img" src="${esc(s.content)}" onerror="this.style.opacity='.2'"></div>`).join('') || '<div class="empty-grid">还没有表情包</div>';
      grid.querySelectorAll('.grid-card').forEach(c => c.addEventListener('click', () => {
        const card = LC.CardLibrary.getById('sticker', c.dataset.id);
        this._hideModal('stickerPicker');
        if (!card || typeof card.content !== 'string' || !card.content.startsWith('data:image/')) {
          this._toast('表情包数据已损坏，请重新添加');
          return;
        }
        this.el.emptyState.style.display = 'none';
        // 走 ChatEngine.sendSticker 统一入库流程（修复历史上 UI 层重复 push 导致表情包重复入库的 bug）
        // 由 ChatEngine 内部 _addMsg 入库一次，再通过 onUserMessage 回调渲染
        LC.ChatEngine.sendSticker(card.content, {
          onUserMessage: (m) => this._renderMessage(m),
          onTypingStart: () => this.showTyping(true),
          onTypingEnd: () => this.showTyping(false),
          onUnit: (m) => this._renderMessage(m),
          onEmpty: () => { this.showTyping(false); this._toast('字卡库还是空的'); },
        });
      }));
      this._showModal('stickerPicker');
    },

    /* ============ 扩展菜单 ============ */
    _toggleExpandMenu() {
      const sheet = this.el.expandMenuSheet;
      if (sheet.classList.contains('show')) this._closeExpandMenu();
      else {
        // 底部 4 个弹窗互斥：开"更多"前关其他三个
        this._closeBottomPanelsExcept('expandMenu');
        sheet.hidden = false;
        requestAnimationFrame(() => sheet.classList.add('show'));
      }
    },
    _closeExpandMenu() {
      const sheet = this.el.expandMenuSheet;
      sheet.classList.remove('show');
      setTimeout(() => { sheet.hidden = true; }, 300);
    },

    /* ============ 字卡面板 ============ */
    openCardsPanel() {
      // 互斥：保留自己（cardsPanel），关掉 settingsPanel
      this._closeOther('cardsPanel');
      // 打开字卡库前关闭所有底部功能弹窗（三大分类互斥：底部弹窗在最底层）
      this._closeBottomPanels();
      this.el.cardsPanel.classList.add('open');
      this.el.cardsPanel.setAttribute('aria-hidden', 'false');
      this.el.overlay.hidden = false;
      requestAnimationFrame(() => this.el.overlay.classList.add('show'));
      this._renderPanelContent();
    },
    closeCardsPanel() {
      this.el.cardsPanel.classList.remove('open');
      this.el.cardsPanel.setAttribute('aria-hidden', 'true');
      // 关闭字卡面板时关闭多选模式（避免下次打开还停留在多选）
      if (this._multiSelMode) { this._multiSelMode = false; this._multiSel.clear(); }
      this._maybeHideOverlay();
      this._closeAllModals();
    },
    _switchGroup(group) {
      // 切换分组时关闭多选模式
      if (this._multiSelMode) { this._multiSelMode = false; this._multiSel.clear(); }
      this._activeGroup = group;
      $$('.toptab').forEach(b => b.classList.toggle('active', b.dataset.group === group));
      // 默认选该组第一个模块
      const firstMod = Object.values(LC.MODULES).find(m => m.group === group);
      if (firstMod) { this._activeModule = firstMod.key; this._renderSubTabs(); this._renderPanelContent(); }
    },
    _renderSubTabs() {
      const mods = Object.values(LC.MODULES).filter(m => m.group === this._activeGroup);
      this.el.panelSubTabs.innerHTML = mods.map(m =>
        `<button class="subtab${m.key === this._activeModule ? ' active' : ''}" data-mod="${m.key}">${esc(m.name)}</button>`).join('');
      this.el.panelSubTabs.querySelectorAll('.subtab').forEach(b => b.addEventListener('click', () => {
        // 切换子模块时关闭多选模式
        if (this._multiSelMode) { this._multiSelMode = false; this._multiSel.clear(); }
        this._activeModule = b.dataset.mod; this._renderSubTabs(); this._renderPanelContent();
      }));
      // 标题
      this.el.panelTitle.textContent = this._activeGroup === 'reply' ? '回复库' : '氛围感';
    },
    _renderPanelContent() {
      const mod = LC.MODULES[this._activeModule];
      this.el.addBtnLabel.textContent = '添加' + mod.name;
      // 切换模块前先清空 mgmt-bar（仅主字卡面板会注入工具栏）
      if (mod.key !== 'main' && this.el.panelMgmtBar) this.el.panelMgmtBar.innerHTML = '';
      if (mod.key === 'main') this._renderMainPanel();
      else if (mod.type === 'emoji') this._renderEmojiPanel();
      else if (mod.type === 'image') this._renderStickerPanel();
      else this._renderTextListPanel(); // pat / status
    },
    /* ============ 字卡库通用分页渲染（参考 milk-main reply-library.js L689-L717） ============
     * 目的：避免一次性渲染全部字卡导致打开卡顿（2000 条主字卡打开需 3-4 秒）
     * 策略：先渲染前 80 条，超过时追加"显示更多"按钮，点击后一次性追加剩余
     * 适用：所有字卡模块（main/emoji/sticker/pat/status）的列表与网格
     * 多选兼容：分页只影响渲染，不影响选中状态。点"全选"会选中当前分类的全部（含未渲染部分），
     *           点"显示更多"后新渲染的卡片 checkbox 会根据 _multiSel 自动反映选中状态 */
    _cardPageSize: 80,
    _renderCardListPaginated(container, cards, renderItem, opts = {}) {
      if (!container) return;
      container.innerHTML = '';
      if (!cards.length) {
        if (opts.emptyHtml) container.innerHTML = opts.emptyHtml;
        return;
      }
      const pageSize = opts.pageSize || this._cardPageSize;
      const toRender = cards.slice(0, pageSize);
      const remaining = cards.length - toRender.length;
      const frag = document.createDocumentFragment();
      toRender.forEach(card => frag.appendChild(renderItem(card)));
      // 超过 80 条 → 追加"显示更多"按钮
      if (remaining > 0) {
        const btn = document.createElement('button');
        btn.className = 'card-show-more' + (opts.buttonClass ? ' ' + opts.buttonClass : '');
        btn.textContent = `显示剩余 ${remaining} 条`;
        btn.addEventListener('click', () => {
          btn.remove();
          const moreFrag = document.createDocumentFragment();
          cards.slice(pageSize).forEach(card => moreFrag.appendChild(renderItem(card)));
          container.appendChild(moreFrag);
          // 渲染剩余后需重新绑定多选选中态（针对主字卡）
          if (opts.onAfterMore) opts.onAfterMore();
        });
        frag.appendChild(btn);
      }
      container.appendChild(frag);
    },

    /* --- 主字卡面板 --- */
    _renderMainPanel() {
      // 搜索+管理工具栏渲染到 panel-mgmtbar（紧贴 subtabs，避免缝隙透字）
      this.el.panelMgmtBar.innerHTML = `
        <div class="mgmt-bar">
          <input type="text" id="cardSearch" class="filter-input" placeholder="搜索字卡内容……">
          <button class="mgmt-btn" id="multiBtn" title="多选">
            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 5h8v2H3V5zm0 5h8v2H3v-2zm0 5h8v2H3v-2zM19 3l-1.41 1.41L18.17 5H14v2h4.17l-1.58 1.59L18 10l4-4-4-4-3 3 1 1z" opacity="0"/><path fill="currentColor" d="M3 5h8v2H3V5zm0 5h8v2H3v-2zm0 5h8v2H3v-2zM19.5 9.5L18 8l-3 3 3 3 1.5-1.5L18.83 11H22V9h-3.17l.67-.5z M19 13c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
          </button>
          <button class="mgmt-btn" id="catMgmtBtn" title="分类管理">
            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 5h18v2H3V5zm0 6h18v2H3v-2zm0 6h18v2H3v-2z"/></svg>
          </button>
          <button class="mgmt-btn" id="dedupBtn" title="查重去重">
            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 7h12v2H6V7zm0 4h12v2H6v-2zm0 4h8v2H6v-2zM3 3h18v18H3V3z" opacity="0"/><path fill="currentColor" d="M4 6h16v2H4V6zm0 5h12v2H4v-2z M19 13l-1.41 1.41L19.17 16 15 11.83 16.41 10.42z"/></svg>
          </button>
        </div>`;
      const html = `
        <div class="main-sticky-area">
          <div class="cat-chips" id="catChips"></div>
          <div class="multi-bar" id="multiBar" hidden>
            <button class="multi-action" id="multiSelectAllBtn">全选</button>
            <button class="multi-action" id="multiGroupBtn">分组</button>
            <button class="multi-action multi-danger" id="multiDeleteBtn">删除</button>
            <span class="multi-count" id="multiCount">已选 0 条</span>
          </div>
        </div>
        <div class="card-list" id="mainCardList"></div>`;
      this.el.panelBody.innerHTML = html;
      $('#cardSearch').addEventListener('input', () => this._renderMainList());
      $('#catMgmtBtn').addEventListener('click', () => this._openCategoryModal());
      $('#dedupBtn').addEventListener('click', () => this._onDedup());
      $('#multiBtn').addEventListener('click', () => this._toggleMultiMode());
      $('#multiSelectAllBtn').addEventListener('click', () => this._multiSelectAllToggle());
      $('#multiGroupBtn').addEventListener('click', () => this._multiGroupSelected());
      $('#multiDeleteBtn').addEventListener('click', () => this._multiDeleteSelected());
      this._renderCatChips();
      this._renderMainList();
      this._applyMultiMode();
    },
    _renderCatChips() {
      const cats = ['全部字卡', '未分类字卡', ...LC.CardLibrary.getAllCategories().filter(c => c !== '未分类')];
      const chips = $('#catChips');
      if (!chips) return;
      chips.innerHTML = cats.map(c => `<button class="cat-chip${c === this._catFilter ? ' active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
      chips.querySelectorAll('.cat-chip').forEach(b => b.addEventListener('click', () => {
        this._catFilter = b.dataset.cat;
        // 切换分类清空之前分类的框选（避免跨分类混选）
        if (this._multiSelMode) this._multiSel.clear();
        this._renderCatChips();
        this._renderMainList();
      }));
    },
    _renderMainList() {
      const kw = ($('#cardSearch')?.value || '').trim();
      const cat = this._catFilter;
      const cards = LC.CardLibrary.search('main', kw, cat);
      const list = $('#mainCardList');
      if (!list) return;
      const self = this;
      // 构造单条字卡 DOM 节点（事件在节点上直接绑定，分页"显示更多"后新节点也能工作）
      const renderItem = (c) => {
        const sel = self._multiSel.has(c.id);
        const div = document.createElement('div');
        div.className = 'card-item' + (self._multiSelMode && sel ? ' selected' : '');
        div.dataset.id = c.id;
        const actions = self._multiSelMode
          ? `<label class="card-check"><input type="checkbox" data-id="${esc(c.id)}" ${sel ? 'checked' : ''}><span class="checkmark"></span></label>`
          : `<button class="icon-btn edit-card" data-id="${esc(c.id)}" title="编辑"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></button>
             <button class="icon-btn del-card" data-id="${esc(c.id)}" title="删除"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>`;
        div.innerHTML = `
          <div class="card-item-content">
            <div class="card-text">${esc(c.content)}</div>
            <div class="card-meta">
              <span class="card-tag">${esc(c.category || '未分类')}</span>
              ${c.weight > 1 ? `<span class="card-weight">权重${c.weight}</span>` : ''}
              ${c.useCount > 0 ? `<span class="card-weight">用过${c.useCount}次</span>` : ''}
            </div>
          </div>
          <div class="card-actions">${actions}</div>`;
        // 绑定事件（多选模式 vs 普通模式）
        if (self._multiSelMode) {
          const cb = div.querySelector('.card-check input');
          if (cb) cb.addEventListener('change', (ev) => {
            if (ev.target.checked) self._multiSel.add(cb.dataset.id);
            else self._multiSel.delete(cb.dataset.id);
            self._updateMultiCount();
            cb.closest('.card-item').classList.toggle('selected', ev.target.checked);
          });
        } else {
          const eb = div.querySelector('.edit-card');
          const db = div.querySelector('.del-card');
          if (eb) eb.addEventListener('click', () => self._openCardModal('main', eb.dataset.id));
          if (db) db.addEventListener('click', () => self._onDeleteCard('main', db.dataset.id));
        }
        return div;
      };
      this._renderCardListPaginated(list, cards, renderItem, {
        emptyHtml: '<div class="empty-card-list">没有匹配的字卡</div>'
      });
      this._updateMultiCount();
    },

    /* ============ 字卡批量多选 ============ */
    _toggleMultiMode() {
      // 反向互斥：开启多选模式前关闭分类管理/导出/导入等弹窗（关闭多选时不动其他弹窗）
      if (!this._multiSelMode) this._closeLibraryModalsExcept('multiSel');
      this._multiSelMode = !this._multiSelMode;
      // 关闭时清空选中
      if (!this._multiSelMode) this._multiSel.clear();
      this._applyMultiMode();
      this._renderMainList();
    },
    _applyMultiMode() {
      const bar = $('#multiBar');
      const btn = $('#multiBtn');
      if (!bar || !btn) return;
      bar.hidden = !this._multiSelMode;
      btn.classList.toggle('active', this._multiSelMode);
    },
    _updateMultiCount() {
      const el = $('#multiCount');
      if (!el) return;
      el.textContent = `已选 ${this._multiSel.size} 条`;
      // 更新全选按钮文案：当前分类全选时显示"取消全选"
      const allBtn = $('#multiSelectAllBtn');
      if (!allBtn) return;
      const kw = ($('#cardSearch')?.value || '').trim();
      const cards = LC.CardLibrary.search('main', kw, this._catFilter);
      const allSel = cards.length > 0 && cards.every(c => this._multiSel.has(c.id));
      allBtn.textContent = allSel ? '取消全选' : '全选';
    },
    _multiSelectAllToggle() {
      const kw = ($('#cardSearch')?.value || '').trim();
      const cards = LC.CardLibrary.search('main', kw, this._catFilter);
      if (!cards.length) return;
      const allSel = cards.every(c => this._multiSel.has(c.id));
      if (allSel) {
        // 取消当前分类全选
        cards.forEach(c => this._multiSel.delete(c.id));
      } else {
        // 全选当前分类
        cards.forEach(c => this._multiSel.add(c.id));
      }
      this._renderMainList();
    },
    _multiGroupSelected() {
      if (!this._multiSel.size) { this._toast('请先选中字卡'); return; }
      // 弹出可用分类列表（除当前分类外的所有分类 + "未分类"）
      const cats = LC.CardLibrary.getAllCategories();
      const curCat = this._catFilter;
      const target = cats.filter(c => c !== curCat && c !== '未分类字卡' && c !== '全部字卡');
      // 用 prompt 简单实现（后续可换成弹窗）
      const opts = ['未分类', ...target];
      const msg = `选择目标分类（输入序号）:\n${opts.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;
      const ans = prompt(msg);
      if (ans === null) return;
      const idx = parseInt(ans) - 1;
      if (isNaN(idx) || idx < 0 || idx >= opts.length) { this._toast('无效选择'); return; }
      const dest = opts[idx] === '未分类' ? '' : opts[idx];
      let count = 0;
      for (const id of this._multiSel) {
        const card = LC.CardLibrary.getById('main', id);
        if (card) { LC.CardLibrary.update('main', id, { category: dest }); count++; }
      }
      this._multiSel.clear();
      this._renderCatChips();
      this._renderMainList();
      this._toast(`已移动 ${count} 条到「${dest || '未分类'}」`, 2000);
    },
    _multiDeleteSelected() {
      if (!this._multiSel.size) { this._toast('请先选中字卡'); return; }
      if (!confirm(`确认删除选中的 ${this._multiSel.size} 条字卡？`)) return;
      let count = 0;
      for (const id of [...this._multiSel]) {
        if (LC.CardLibrary.remove('main', id)) count++;
      }
      this._multiSel.clear();
      this._renderCatChips();
      this._renderMainList();
      this._toast(`已删除 ${count} 条字卡`, 2000);
    },


    /* --- Emoji 网格面板 --- */
    _renderEmojiPanel() {
      const cards = LC.CardLibrary.getAll('emoji');
      const html = `<div class="grid-cards" id="emojiGrid"></div>`;
      this.el.panelBody.innerHTML = html;
      const grid = $('#emojiGrid');
      if (!grid) return;
      if (!cards.length) {
        grid.innerHTML = '<div class="empty-grid">还没有 Emoji，点击下方添加</div>';
        return;
      }
      const renderItem = (c) => {
        const div = document.createElement('div');
        div.className = 'grid-card';
        div.dataset.id = c.id;
        div.innerHTML = `<span class="gc-emoji">${esc(c.content)}</span><button class="gc-del" data-id="${esc(c.id)}">×</button>`;
        return div;
      };
      this._renderCardListPaginated(grid, cards, renderItem, {
        buttonClass: 'grid-show-more'
      });
      this._bindGridCards('emoji');
    },

    /* --- 表情库图片网格面板 --- */
    _renderStickerPanel() {
      const cards = LC.CardLibrary.getAll('sticker').filter(c => typeof c.content === 'string' && c.content.startsWith('data:image/'));
      // 头部"添加图片"按钮固定在网格首位，不参与分页
      this.el.panelBody.innerHTML = `<div class="grid-cards" id="stickerGrid">
        <div class="grid-add" id="stickerAdd">
          <svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          <span>添加图片</span>
        </div>
      </div>`;
      const grid = $('#stickerGrid');
      const stickerAdd = $('#stickerAdd');
      if (stickerAdd) stickerAdd.addEventListener('click', () => this._onAddStickerFile());
      if (!grid) return;
      if (!cards.length) return; // 头部"添加图片"按钮已渲染
      const renderItem = (c) => {
        const div = document.createElement('div');
        div.className = 'grid-card';
        div.dataset.id = c.id;
        div.innerHTML = `<img class="gc-img" src="${esc(c.content)}" onerror="this.outerHTML='<div class=&quot;gc-broken&quot;>图片损坏</div>'"><button class="gc-del" data-id="${esc(c.id)}">×</button>`;
        return div;
      };
      // 分页渲染：前 80 张 + 显示更多。注意 stickerAdd 已在容器内，append 即可
      this._renderStickerPaginated(grid, cards, renderItem, 80);
      this._bindGridCards('sticker');
    },
    /* sticker 专用分页：保留头部"添加图片"按钮位置，新内容追加在其后 */
    _renderStickerPaginated(grid, cards, renderItem, pageSize) {
      const toRender = cards.slice(0, pageSize);
      const remaining = cards.length - toRender.length;
      const frag = document.createDocumentFragment();
      toRender.forEach(c => frag.appendChild(renderItem(c)));
      if (remaining > 0) {
        const btn = document.createElement('button');
        btn.className = 'card-show-more grid-show-more';
        btn.textContent = `显示剩余 ${remaining} 条`;
        btn.addEventListener('click', () => {
          btn.remove();
          const moreFrag = document.createDocumentFragment();
          cards.slice(pageSize).forEach(c => moreFrag.appendChild(renderItem(c)));
          grid.appendChild(moreFrag);
        });
        frag.appendChild(btn);
      }
      grid.appendChild(frag);
    },

    /* --- 拍一拍/状态 文字列表面板 --- */
    _renderTextListPanel() {
      const mod = this._activeModule;
      const cards = LC.CardLibrary.getAll(mod);
      const html = `
        <div class="mgmt-bar"><input type="text" id="textSearch" class="filter-input" placeholder="搜索……"></div>
        <div class="card-list" id="textCardList"></div>`;
      this.el.panelBody.innerHTML = html;
      const search = $('#textSearch');
      if (search) search.addEventListener('input', () => this._renderTextList());
      this._renderTextList();
    },
    _renderTextList() {
      const mod = this._activeModule;
      const kw = ($('#textSearch')?.value || '').trim();
      let cards = LC.CardLibrary.getAll(mod);
      if (kw) { const k = kw.toLowerCase(); cards = cards.filter(c => c.content.toLowerCase().includes(k)); }
      const list = $('#textCardList');
      if (!list) return;
      const self = this;
      const renderItem = (c) => {
        const div = document.createElement('div');
        div.className = 'card-item';
        div.dataset.id = c.id;
        div.innerHTML = `
          <div class="card-item-content"><div class="card-text">${esc(c.content)}</div></div>
          <div class="card-actions">
            <button class="icon-btn edit-card" data-id="${esc(c.id)}"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></button>
            <button class="icon-btn del-card" data-id="${esc(c.id)}"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
          </div>`;
        const eb = div.querySelector('.edit-card');
        const db = div.querySelector('.del-card');
        if (eb) eb.addEventListener('click', () => self._openCardModal(mod, eb.dataset.id));
        if (db) db.addEventListener('click', () => self._onDeleteCard(mod, db.dataset.id));
        return div;
      };
      this._renderCardListPaginated(list, cards, renderItem, {
        emptyHtml: '<div class="empty-card-list">还没有字卡</div>'
      });
    },

    /* 网格卡片长按删除 */
    _bindGridCards(module) {
      const gridId = module === 'emoji' ? '#emojiGrid' : '#stickerGrid';
      const grid = $(gridId);
      if (!grid) return;
      grid.querySelectorAll('.grid-card').forEach(card => {
        let timer = null;
        const start = (e) => { timer = setTimeout(() => { e.preventDefault(); card.classList.add('show-del'); }, 450); };
        const cancel = () => { if (timer) clearTimeout(timer); };
        card.addEventListener('touchstart', start, { passive: true });
        card.addEventListener('touchend', cancel);
        card.addEventListener('touchmove', cancel);
        card.addEventListener('mousedown', start);
        card.addEventListener('mouseup', cancel);
        card.addEventListener('mouseleave', cancel);
      });
      grid.querySelectorAll('.gc-del').forEach(btn => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); LC.CardLibrary.remove(module, btn.dataset.id); this._renderPanelContent(); });
      });
      // 点击空白取消删除态
      document.addEventListener('click', () => grid.querySelectorAll('.grid-card.show-del').forEach(c => c.classList.remove('show-del')), { once: true });
    },

    /* ============ 添加按钮 ============ */
    _onAddClick() {
      const mod = this._activeModule;
      if (mod === 'sticker') { this._onAddStickerFile(); return; }
      this._openCardModal(mod, null);
    },
    _onAddStickerFile() {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
      input.onchange = async () => {
        for (const file of input.files) {
          const url = await this._resizeImage(file);
          if (url) LC.CardLibrary.add('sticker', { content: url });
        }
        this._renderPanelContent();
      };
      input.click();
    },
    // 统一图片处理：input 可为 File 或 dataURL 字符串；maxSize 缩放上限
    // sticker 走 File + PNG（保留透明），背景图走 dataURL + JPEG 0.85
    _resizeImage(input, maxSize = 200) {
      return new Promise((resolve) => {
        const handleDataUrl = (dataUrl) => {
          if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
            console.warn('[LoveChat] _resizeImage 收到非 data URL:', dataUrl);
            return resolve(null);
          }
          const img = new Image();
          img.onload = () => {
            let w = img.naturalWidth || img.width;
            let h = img.naturalHeight || img.height;
            if (w > maxSize || h > maxSize) {
              const r = Math.min(maxSize / w, maxSize / h);
              w = Math.max(1, Math.round(w * r));
              h = Math.max(1, Math.round(h * r));
            }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            // PNG 保留透明 + 补白；其余输出 JPEG
            const isPng = dataUrl.includes('image/png');
            if (!isPng) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
            ctx.drawImage(img, 0, 0, w, h);
            try {
              const mime = isPng ? 'image/png' : 'image/jpeg';
              const out = canvas.toDataURL(mime, isPng ? undefined : 0.85);
              if (typeof out === 'string' && out.startsWith('data:image/')) resolve(out);
              else resolve(null);
            } catch (e) {
              console.warn('[LoveChat] 图片转码失败:', e);
              resolve(null);
            }
          };
          img.onerror = (e) => { console.warn('[LoveChat] 图片加载失败:', e); resolve(null); };
          img.src = dataUrl;
        };

        if (typeof input === 'string') {
          handleDataUrl(input);
        } else if (input instanceof Blob) {
          const reader = new FileReader();
          reader.onload = () => handleDataUrl(reader.result);
          reader.onerror = (e) => { console.warn('[LoveChat] FileReader 失败:', e); resolve(null); };
          try { reader.readAsDataURL(input); } catch (e) { console.warn(e); resolve(null); }
        } else {
          console.warn('[LoveChat] _resizeImage 收到非 Blob/dataURL:', input);
          resolve(null);
        }
      });
    },

    /* ============ 字卡编辑弹窗 ============ */
    _openCardModal(module, id) {
      const mod = LC.MODULES[module];
      this._editingCard = { module, id };
      this.el.cardModalTitle.textContent = id ? '编辑字卡' : ('添加' + mod.name);
      // 分类/权重字段显隐
      this.el.cardCategoryFields.style.display = mod.hasCategory ? '' : 'none';
      this.el.cardWeightField.style.display = mod.type === 'image' ? 'none' : '';
      // 分类下拉
      if (mod.hasCategory) {
        const cats = LC.CardLibrary.getAllCategories();
        this.el.cardCategorySelect.innerHTML = '<option value="">选已有</option>' + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      }
      // 批量提示
      this.el.cardBatchHint.style.display = (mod.type === 'text' || mod.type === 'emoji') ? '' : 'none';
      if (id) {
        const card = LC.CardLibrary.getById(module, id);
        if (!card) return;
        this.el.cardTextInput.value = card.content;
        this.el.cardCategoryInput.value = card.category || '';
        this.el.cardWeightInput.value = card.weight;
      } else {
        this.el.cardTextInput.value = '';
        this.el.cardCategoryInput.value = '';
        this.el.cardWeightInput.value = 1;
      }
      this._showModal('cardModal');
      setTimeout(() => this.el.cardTextInput.focus(), 100);
    },
    _closeCardModal() { this._hideModal('cardModal'); this._editingCard = null; },
    _onSaveCard() {
      const { module, id } = this._editingCard || {};
      if (!module) return;
      const mod = LC.MODULES[module];
      const raw = this.el.cardTextInput.value;
      if (mod.type === 'image') { this._closeCardModal(); return; }
      // 批量：换行分隔
      const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
      if (!lines.length) { this._toast('请填写内容'); this.el.cardTextInput.focus(); return; }
      if (id) {
        // 编辑单条（取第一行）
        LC.CardLibrary.update(module, id, { content: lines[0], category: mod.hasCategory ? (this.el.cardCategoryInput.value.trim() || '未分类') : '', weight: parseInt(this.el.cardWeightInput.value) || 1 });
      } else {
        for (const line of lines) {
          LC.CardLibrary.add(module, { content: line, category: mod.hasCategory ? (this.el.cardCategoryInput.value.trim() || '未分类') : '', weight: parseInt(this.el.cardWeightInput.value) || 1 });
        }
      }
      this._closeCardModal();
      this._renderPanelContent();
      this._toast(id ? '已更新' : `已添加 ${lines.length} 条`, 1500);
    },
    _onDeleteCard(module, id) {
      const card = LC.CardLibrary.getById(module, id);
      if (!card) return;
      const preview = card.content.length > 20 ? card.content.slice(0, 20) + '…' : card.content;
      if (confirm(`确定删除？\n${preview}`)) { LC.CardLibrary.remove(module, id); this._renderPanelContent(); this._toast('已删除', 1200); }
    },

    /* ============ 字卡库内顶层功能弹窗互斥 ============
     * 规则：分类管理 / 按分类导出 / 全量导出 / 导入 这 4 个 modal 之间互斥
     * 开一个前关掉其他三个；同时打开任意一个前如果多选模式激活要先退出多选
     * 子分支选项（如导入弹窗里的"覆盖"/"叠加"）不算独立功能，不影响导入弹窗本身 */
    _closeLibraryModalsExcept(keep) {
      // 退出多选模式（清空已选 + 隐藏多选条 + 同步按钮颜色，避免 active 样式残留）
      if (this._multiSelMode) {
        this._multiSelMode = false;
        this._multiSel.clear();
        const bar = $('#multiBar'); if (bar) bar.hidden = true;
        // 必须调用 _applyMultiMode 同步按钮 active class，否则按钮颜色不会改回
        this._applyMultiMode();
      }
      // 关掉其他 modal
      if (keep !== 'categoryModal')   this._hideModal('categoryModal');
      if (keep !== 'exportCatModal')  this._hideModal('exportCatModal');
      if (keep !== 'exportFullModal') this._hideModal('exportFullModal');
      if (keep !== 'importModal')     this._hideModal('importModal');
    },

    /* ============ 分类管理 ============ */
    _openCategoryModal() {
      this._closeLibraryModalsExcept('categoryModal');
      this._renderCatList();
      this._showModal('categoryModal');
      setTimeout(() => $('#catAddInput').focus(), 100);
    },
    _renderCatList() {
      const cats = LC.CardLibrary.getAllCategories();
      this.el.catList.innerHTML = cats.length ? cats.map(c => `
        <div class="cat-item" data-cat="${esc(c)}">
          <span class="ci-name">${esc(c)}</span>
          <span class="ci-count">${LC.CardLibrary.countByCategory(c)}</span>
          <button class="ci-btn cat-rename" title="改名"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></button>
          <button class="ci-btn cat-delete" title="删除"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
        </div>`).join('') : '<div class="empty-card-list">还没有分类</div>';
      this.el.catList.querySelectorAll('.cat-rename').forEach(b => b.addEventListener('click', () => {
        const old = b.closest('.cat-item').dataset.cat;
        const nw = prompt('新分类名：', old);
        if (nw && nw.trim() && nw.trim() !== old) { LC.CardLibrary.renameCategory(old, nw.trim()); this._renderCatList(); this._renderCatChips(); this._renderMainList(); }
      }));
      this.el.catList.querySelectorAll('.cat-delete').forEach(b => b.addEventListener('click', () => {
        const cat = b.closest('.cat-item').dataset.cat;
        if (confirm(`删除分类"${cat}"？其下字卡将归入"未分类"`)) { LC.CardLibrary.deleteCategory(cat); this._renderCatList(); this._renderCatChips(); this._renderMainList(); }
      }));
    },
    _onAddCategory() {
      const name = this.el.catAddInput.value.trim();
      if (!name) return;
      if (LC.CardLibrary.addCategory(name)) { this.el.catAddInput.value = ''; this._renderCatList(); this._renderCatChips(); }
      else this._toast('该分类已存在');
    },

    /* ============ 查重 ============ */
    _onDedup() {
      const r = LC.CardLibrary.dedup();
      this._renderMainList();
      this._toast(r.removed ? `删除了 ${r.removed} 条重复字卡` : '没有重复字卡', 2000);
    },

    /* ============ 全局查重（回复库 + 氛围感） ============ */
    _onGlobalDedup() {
      const r = LC.CardLibrary.dedupAll();
      // 刷新面板（包括分类标签与字卡列表）
      this._renderPanelContent();
      if (this._activeModule === 'main') { this._renderCatChips(); this._renderMainList(); }
      this._toast(r.removed ? `全局查重：删除了 ${r.removed} 条重复字卡` : '没有重复字卡', 2000);
    },

    /* ============ 导出 ============ */
    _onExportClick(ev) {
      // 在导出按钮附近弹出选择浮窗（按分类导出 / 全量导出）
      const menu = $('#exportChoiceMenu');
      const btn = $('#exportBtn');
      const r = btn.getBoundingClientRect();
      // 弹窗位置：按钮下方，左对齐按钮右边（不超出右边屏）
      const menuW = 180;
      let left = r.right - menuW; if (left < 8) left = 8;
      let top = r.bottom + 4;
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';
      menu.hidden = false;
      menu._open = true;
    },
    _closeExportChoice() {
      const m = $('#exportChoiceMenu'); if (!m) return; m.hidden = true; m._open = false;
    },
    _openExportCatModal() {
      this._closeLibraryModalsExcept('exportCatModal');
      const cats = LC.CardLibrary.getAllCategories();
      const list = $('#exportCatList');
      list.innerHTML = cats.length ? cats.map(c => `<label class="check-item"><input type="checkbox" checked data-cat="${esc(c)}">${esc(c)} <span style="color:var(--text-muted);font-size:12px">(${LC.CardLibrary.countByCategory(c)})</span></label>`).join('') : '<div class="empty-card-list">无分类</div>';
      this._showModal('exportCatModal');
    },
    _openExportFullModal() {
      this._closeLibraryModalsExcept('exportFullModal');
      const mods = Object.values(LC.MODULES);
      const list = $('#exportModList');
      list.innerHTML = mods.map(m => `<label class="check-item"><input type="checkbox" checked data-mod="${m.key}">${esc(m.name)} <span style="color:var(--text-muted);font-size:12px">(${LC.CardLibrary.getAll(m.key).length})</span></label>`).join('');
      this._showModal('exportFullModal');
    },
    _doExportByCategory() {
      const checked = [...$('#exportCatList').querySelectorAll('input:checked')].map(i => i.dataset.cat);
      const cats = checked.length ? checked : LC.CardLibrary.getAllCategories();
      const json = LC.CardLibrary.exportByCategory(cats);
      this._download(json, `cards-by-category-${this._dateStr()}.json`);
      this._closeModal('exportCatModal');
      this._toast('已导出', 1500);
    },
    _doExportFull() {
      const checked = [...$('#exportModList').querySelectorAll('input:checked')].map(i => i.dataset.mod);
      const mods = checked.length ? checked : Object.keys(LC.MODULES);
      const json = LC.CardLibrary.exportFull(mods);
      this._download(json, `cards-full-${this._dateStr()}.json`);
      this._closeModal('exportFullModal');
      this._toast('已导出', 1500);
    },
    _download(text, filename) {
      // 导出确认弹窗：显示文件名（可编辑）+ 大小，用户点"下载"才执行
      const sizeMB = text.length / 1024 / 1024;
      const sizeStr = sizeMB < 1 ? (text.length / 1024).toFixed(1) + ' KB' : sizeMB.toFixed(2) + ' MB';

      let modal = $('#exportConfirmModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'exportConfirmModal';
        modal.className = 'modal';
        modal.innerHTML = `
          <div class="modal-content" style="max-width:440px;">
            <div class="modal-header">
              <h3 class="modal-title">导出数据</h3>
              <button class="modal-close" id="exportConfirmClose">×</button>
            </div>
            <div style="padding:4px 0 8px;">
              <label style="font-size:13px;color:var(--text-secondary);display:block;margin-bottom:6px;">文件名</label>
              <input id="exportConfirmName" class="field-input" style="width:100%;" />
              <p id="exportConfirmSize" style="font-size:12px;color:var(--text-muted);margin:8px 0 0;"></p>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">
              <button class="btn-secondary" id="exportConfirmCopyBtn">复制全部</button>
              <button class="btn-primary" id="exportConfirmDlBtn">下载文件</button>
            </div>
          </div>`;
        document.body.appendChild(modal);
        $('#exportConfirmClose').addEventListener('click', () => this._closeModal('exportConfirmModal'));
        $('#exportConfirmCopyBtn').addEventListener('click', () => {
          const ta = document.createElement('textarea');
          ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.focus(); ta.select();
          const ok = document.execCommand('copy'); ta.remove();
          this._toast(ok ? '已复制到剪贴板' : '复制失败', 2000);
        });
        $('#exportConfirmDlBtn').addEventListener('click', () => {
          const name = $('#exportConfirmName').value.trim() || filename;
          this._closeModal('exportConfirmModal');
          this._doDownload(text, name);
        });
      }
      $('#exportConfirmName').value = filename;
      $('#exportConfirmSize').textContent = '文件大小：' + sizeStr;
      this._showModal('exportConfirmModal');
      setTimeout(() => $('#exportConfirmName').focus(), 100);
    },
    /** 实际下载逻辑：navigator.share 优先（安卓APP系统分享）→ blob → data URI → 文本弹窗兜底 */
    async _doDownload(text, filename) {
      const ua = navigator.userAgent || '';
      const isMobile = /Mobile|Android|iPhone|iPad/.test(ua);
      const sizeMB = text.length / 1024 / 1024;
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });

      // 1. navigator.share + File（安卓系统分享面板，可保存到文件/分享到其他APP，支持大文件）
      if (isMobile && navigator.share) {
        try {
          const file = new File([blob], filename, { type: 'application/json' });
          if (!navigator.canShare || navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: filename, text: '导出数据' });
            this._toast('导出成功', 1500);
            return;
          }
        } catch (e) {
          if (e && e.name === 'AbortError') return; // 用户取消，不降级
          // 其他错误继续降级
        }
      }

      // 2. blob 下载（桌面浏览器）
      const tryBlob = () => {
        try {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = filename;
          a.style.display = 'none';
          document.body.appendChild(a);
          let failed = false;
          a.addEventListener('error', () => { failed = true; URL.revokeObjectURL(url); a.remove(); tryDataURI(); });
          a.click();
          setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
          if (!failed) this._toast('导出成功', 1500);
        } catch (e) {
          tryDataURI();
        }
      };

      // 3. data URI 下载（安卓WebView 无 share 时的降级，有大小限制）
      const DATA_URI_LIMIT_MB = 5;
      const tryDataURI = () => {
        if (sizeMB >= DATA_URI_LIMIT_MB) {
          this._toast(`数据量 ${sizeMB.toFixed(1)}MB 过大，请用"复制全部"或电脑端导出`, 5000);
          this._showTextExportModal(text, filename);
          return;
        }
        try {
          const a = document.createElement('a');
          a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(text);
          a.download = filename;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click(); a.remove();
          this._toast('导出成功', 1500);
        } catch (e) {
          this._showTextExportModal(text, filename);
        }
      };

      tryBlob();
    },
    /** 文本导出弹窗：长文本展示 + 复制 + 尝试下载 */
    _showTextExportModal(text, filename) {
      let modal = $('#textExportModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'textExportModal';
        modal.className = 'modal';
        modal.innerHTML = `
          <div class="modal-content" style="max-width:600px;">
            <div class="modal-header">
              <h3 class="modal-title">导出数据</h3>
              <button class="modal-close" id="textExportClose">×</button>
            </div>
            <p style="font-size:13px;color:#888;margin:8px 0;">文件名：${esc(filename)}</p>
            <p style="font-size:12px;color:#999;margin:0 0 8px;">长按文本可全选复制，或点"复制全部"按钮。粘贴到任意文本编辑器另存为 .json 文件即可。</p>
            <textarea id="textExportArea" class="field-input" style="width:100%;height:280px;font-family:monospace;font-size:11px;resize:vertical;" readonly></textarea>
            <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">
              <button class="btn-secondary" id="textExportCopyBtn">复制全部</button>
              <button class="btn-primary" id="textExportSaveBtn">尝试下载文件</button>
            </div>
          </div>`;
        document.body.appendChild(modal);
        $('#textExportClose').addEventListener('click', () => this._closeModal('textExportModal'));
        $('#textExportCopyBtn').addEventListener('click', () => {
          const ta = $('#textExportArea');
          ta.focus(); ta.select();
          const ok = document.execCommand('copy');
          this._toast(ok ? '已复制到剪贴板' : '复制失败，请手动长按选择', 2000);
        });
        $('#textExportSaveBtn').addEventListener('click', () => {
          // 尝试 a.download，桌面浏览器会保存到下载目录，APP WebView 可能无效
          try {
            const blob = new Blob([text], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            this._toast('已尝试下载，若未弹出请用"复制全部"', 2500);
          } catch (e) {
            this._toast('下载不可用，请用"复制全部"', 2500);
          }
        });
      }
      $('#textExportArea').value = text;
      this._showModal('textExportModal');
      // 全选方便复制
      setTimeout(() => { const ta = $('#textExportArea'); ta.focus(); ta.select(); }, 100);
    },

    /* ============ 导入 ============ */
    _onImportClick() {
      // 主字卡显示两种方式；其他模块直接文件导入
      if (this._activeModule === 'main') {
        this._closeLibraryModalsExcept('importModal');
        this._showModal('importModal');
      }
      else { this._doImport('module'); }
    },
    _doImport(mode, importMode = 'merge') {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json,application/json';
      input.onchange = () => {
        const file = input.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          let result;
          if (mode === 'group') result = LC.CardLibrary.importByGroup(reader.result, importMode);
          else if (mode === 'full') result = LC.CardLibrary.importFull(reader.result, importMode);
          else result = LC.CardLibrary.importModule(reader.result, this._activeModule, importMode);
          if (result.ok) {
            this._renderPanelContent();
            if (this._activeModule === 'main') { this._renderCatChips(); this._renderMainList(); }
            const msg = result.replaced
              ? `已覆盖，导入 ${result.added} 条字卡`
              : `导入成功，新增 ${result.added} 条`;
            this._toast(msg, 2000);
            this._closeModal('importModal');
          }
          else this._toast('导入失败：' + result.error, 3000);
        };
        reader.readAsText(file);
      };
      input.click();
    },

    /* ---- 导入方式选择浮窗：覆盖 / 添加（按分组导入 / 全量导入共用） ---- */
    _toggleImportModeMenu(source = 'group') {
      const m = $('#importModeMenu');
      if (!m.hidden) { this._closeImportModeMenu(); return; }
      this._importSource = source;  // 记录当前导入来源（'group' / 'full'）
      const btn = source === 'full' ? $('#importFullBtn') : $('#importGroupBtn');
      const r = btn.getBoundingClientRect();
      const menuW = 210;
      let left = r.right - menuW; if (left < 8) left = 8;
      if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
      m.style.left = left + 'px';
      m.style.top = (r.bottom + 4) + 'px';
      m.hidden = false;
    },
    _closeImportModeMenu() { const m = $('#importModeMenu'); if (m) m.hidden = true; },

    /* ============ 设置 ============ */
    openSettingsPanel() {
      // 互斥：保留自己（settingsPanel），关掉 cardsPanel
      this._closeOther('settingsPanel');
      // 打开设置前关闭所有底部功能弹窗（三大分类互斥：底部弹窗在最底层）
      this._closeBottomPanels();
      this.el.settingsPanel.classList.add('open');
      this.el.settingsPanel.setAttribute('aria-hidden', 'false');
      this.el.overlay.hidden = false;
      requestAnimationFrame(() => this.el.overlay.classList.add('show'));
      this.renderSettings();
    },
    closeSettingsPanel() {
      this.el.settingsPanel.classList.remove('open');
      this.el.settingsPanel.setAttribute('aria-hidden', 'true');
      this._maybeHideOverlay();
    },
    renderSettings() {
      $('#setPartnerName').value = LC.config.partner.name;
      $('#setUserName').value = LC.config.user.name;
      this._renderAvatarPreview();
      $$('.theme-opt').forEach(b => b.classList.toggle('active', b.dataset.theme === LC.config.theme));
      // 回复延迟区间
      const tMin = (LC.config.typingDelayMin || 0) / 1000;
      const tMax = (LC.config.typingDelayMax || 0) / 1000;
      $('#setTypingMin').value = tMin.toFixed(1);
      $('#setTypingMax').value = tMax.toFixed(1);
      $('#typingDelayHint').textContent = `${tMin.toFixed(1)} ~ ${tMax.toFixed(1)} 秒`;
      // 条数间隔时间区间（旧 config 无此字段时用默认 400/1500ms）
      const gMin = (LC.config.unitGapMin ?? 400) / 1000;
      const gMax = (LC.config.unitGapMax ?? 1500) / 1000;
      $('#setUnitGapMin').value = gMin.toFixed(1);
      $('#setUnitGapMax').value = gMax.toFixed(1);
      $('#unitGapHint').textContent = `${gMin.toFixed(1)} ~ ${gMax.toFixed(1)} 秒`;
      $('#setMergeWindow').value = LC.config.mergeWindow; $('#mergeWindowValue').textContent = (LC.config.mergeWindow/1000)+'s';
      $('#setEmojiChance').value = Math.round(LC.config.emojiChance*100); $('#emojiChanceValue').textContent = Math.round(LC.config.emojiChance*100)+'%';
      $('#setStickerChance').value = Math.round(LC.config.stickerChance*100); $('#stickerChanceValue').textContent = Math.round(LC.config.stickerChance*100)+'%';
      $('#setPatChance').value = Math.round(LC.config.patChance*100); $('#patChanceValue').textContent = Math.round(LC.config.patChance*100)+'%';
      // 状态时长（分钟）
      const sMin = Math.round((LC.config.statusMinMs || 180000) / 60000);
      const sMax = Math.round((LC.config.statusMaxMs || 600000) / 60000);
      $('#setStatusMin').value = sMin;
      $('#setStatusMax').value = sMax;
      $('#statusHint').textContent = `${sMin} ~ ${sMax} 分钟`;
      // 主动发消息
      $('#setProactiveEnabled').checked = !!LC.config.proactiveEnabled;
      const pMin = LC.config.proactiveIntervalMin || 5;
      const pMax = LC.config.proactiveIntervalMax || (pMin + 10);
      $('#setProactiveIntervalMin').value = pMin;
      $('#setProactiveIntervalMax').value = pMax;
      $('#proactiveIntervalHint').textContent = `${pMin} ~ ${pMax} 分钟`;
      $('#setFailCooldown').value = LC.config.failCooldownMin || 3;
      // 输入体验
      // 信件投递配置
      $('#setLetterReplyMin').value = LC.config.letterReplyMinHours ?? 17;
      $('#setLetterReplyMax').value = LC.config.letterReplyMaxHours ?? 21;
      $('#setLetterReplyCountMin').value = LC.config.letterReplyCountMin ?? 6;
      $('#setLetterReplyCountMax').value = LC.config.letterReplyCountMax ?? 8;
      $('#setLetterProactiveMin').value = LC.config.letterProactiveMinHours ?? 20;
      $('#setLetterProactiveMax').value = LC.config.letterProactiveMaxHours ?? 48;
      $('#setLetterProactiveContinuous').checked = !!LC.config.letterProactiveContinuous;
      $('#letterReplyHoursHint').textContent = `${LC.config.letterReplyMinHours ?? 17} ~ ${LC.config.letterReplyMaxHours ?? 21} 小时`;
      $('#letterReplyCountHint').textContent = `${LC.config.letterReplyCountMin ?? 6} ~ ${LC.config.letterReplyCountMax ?? 8} 条`;
      $('#letterProactiveHint').textContent = `${LC.config.letterProactiveMinHours ?? 20} ~ ${LC.config.letterProactiveMaxHours ?? 48} 小时`;
      // 背景图
      this._renderBgPreview();
      // 拍一拍标志当前值
      $('#patMarkMeVal').textContent = LC.config.patMarkMe || '';
      $('#patMarkPartnerVal').textContent = LC.config.patMarkPartner || '';
      // 自定义气泡 CSS（应用已保存的样式）
      try { this._applyBubbleCSSFromConfig(); } catch(e) { console.warn('气泡CSS加载失败', e); }
      $('#setReplyMin').value = LC.config.replyCountMin; $('#setReplyMax').value = LC.config.replyCountMax;
      this._updateReplyCountHint();
      this.renderColorPicker();
      this._renderFontColorPicker();
      this._renderDataStats();
    },
    /* 设置面板 Tab 切换 */
    _switchSettingsTab(name) {
      $$('.settings-tab').forEach(b => b.classList.toggle('active', b.dataset.stab === name));
      $$('.settings-pane').forEach(p => {
        const on = p.dataset.pane === name;
        p.classList.toggle('active', on); p.hidden = !on;
      });
    },
    /* 时长格式化（毫秒 -> "3分钟"/"1小时"） */
    _fmtDur(ms) {
      if (ms < 60000) return (ms/1000).toFixed(0) + '秒';
      const m = Math.round(ms/60000);
      if (m < 60) return m + '分钟';
      const h = Math.floor(m/60), rem = m % 60;
      return rem ? `${h}小时${rem}分` : `${h}小时`;
    },
    _onReplyCountChange() {
      let min = parseInt($('#setReplyMin').value) || 1;
      let max = parseInt($('#setReplyMax').value) || 1;
      if (min > max) max = min;
      LC.config.replyCountMin = min; LC.config.replyCountMax = max;
      LC.Storage.set('config', LC.config);
      this._updateReplyCountHint();
    },
    _updateReplyCountHint() { $('#replyCountHint').textContent = `${LC.config.replyCountMin} ~ ${LC.config.replyCountMax} 条/回合`; },
    _onTypingDelayChange() {
      let min = parseFloat($('#setTypingMin').value);
      let max = parseFloat($('#setTypingMax').value);
      if (isNaN(min) || min < 0) min = 0;
      if (isNaN(max) || max < min) max = min;
      LC.config.typingDelayMin = Math.round(min * 1000);
      LC.config.typingDelayMax = Math.round(max * 1000);
      $('#typingDelayHint').textContent = `${min.toFixed(1)} ~ ${max.toFixed(1)} 秒`;
      LC.Storage.set('config', LC.config);
    },
    _onUnitGapChange() {
      let min = parseFloat($('#setUnitGapMin').value);
      let max = parseFloat($('#setUnitGapMax').value);
      if (isNaN(min) || min < 0) min = 0;
      if (isNaN(max) || max < min) max = min;
      LC.config.unitGapMin = Math.round(min * 1000);
      LC.config.unitGapMax = Math.round(max * 1000);
      $('#unitGapHint').textContent = `${min.toFixed(1)} ~ ${max.toFixed(1)} 秒`;
      LC.Storage.set('config', LC.config);
    },
    _onStatusDurChange() {
      let min = parseFloat($('#setStatusMin').value);
      let max = parseFloat($('#setStatusMax').value);
      if (isNaN(min) || min < 1) min = 1;
      if (isNaN(max) || max < min) max = min;
      LC.config.statusMinMs = Math.round(min * 60000);
      LC.config.statusMaxMs = Math.round(max * 60000);
      $('#statusHint').textContent = `${min} ~ ${max} 分钟`;
      LC.Storage.set('config', LC.config);
      LC.ChatEngine.refreshStatus();
    },
    renderColorPicker() {
      const p = $('#colorPicker');
      p.innerHTML = LC.ACCENT_PRESETS.map(c => `<div class="color-dot${c.color === LC.config.accentColor ? ' active' : ''}" style="background:${c.color}" data-color="${c.color}" title="${c.name}"></div>`).join('');
      p.querySelectorAll('.color-dot').forEach(d => d.addEventListener('click', () => {
        LC.config.accentColor = d.dataset.color; this.applyAccentColor(); LC.Storage.set('config', LC.config);
        p.querySelectorAll('.color-dot').forEach(x => x.classList.remove('active')); d.classList.add('active');
      }));
    },
    setTheme(theme) {
      LC.config.theme = theme; document.documentElement.setAttribute('data-theme', theme);
      $$('.theme-opt').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
      LC.Storage.set('config', LC.config);
    },
    applyAccentColor() {
      const color = LC.config.accentColor;
      document.documentElement.style.setProperty('--accent', color);
      const hex = color.replace('#', '');
      const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
      document.documentElement.style.setProperty('--accent-rgb', `${r},${g},${b}`);
      document.documentElement.style.setProperty('--accent-gradient', `linear-gradient(135deg, ${this._lighten(color,20)} 0%, ${color} 100%)`);
      document.documentElement.style.setProperty('--user-bubble', `linear-gradient(135deg, ${this._lighten(color,25)} 0%, ${color} 100%)`);
    },
    /* 聊天字体颜色：控制时间/拍一拍/抉择脚注/日期分隔等辅助文字颜色
     * null=跟随主题；可设为黑/白/灰/自定义色 */
    _setChatFontColor(color) {
      LC.config.chatFontColor = color || null;
      LC.Storage.set('config', LC.config);
      this.applyChatFontColor();
      this._renderFontColorPicker();
    },
    applyChatFontColor() {
      const c = LC.config.chatFontColor;
      if (c) document.documentElement.style.setProperty('--chat-aux-color', c);
      else document.documentElement.style.setProperty('--chat-aux-color', '');
    },
    _renderFontColorPicker() {
      const p = $('#fontColorPicker');
      if (!p) return;
      const cur = LC.config.chatFontColor || '';
      p.querySelectorAll('.color-dot').forEach(d => {
        d.classList.toggle('active', d.dataset.color === cur);
      });
      $('#chatFontColorHint').textContent = cur ? cur.toUpperCase() : '跟随主题';
    },
    _lighten(hex, p) { const n = parseInt(hex.replace('#',''),16); const r = Math.min(255,((n>>16)&255)+p), g = Math.min(255,((n>>8)&255)+p), b = Math.min(255,(n&255)+p); return '#'+((r<<16)|(g<<8)|b).toString(16).padStart(6,'0'); },

    /* ============ 主题色 - 自定义颜色弹窗（仅靠按钮关闭） ============
     * 注意：此弹窗有"取消"按钮，不绑定外部点击关闭，避免"闪现消失"bug
     * 状态：_customColorDraft 存储当前正在挑选的颜色（未点确定前不生效）
     */
    _customColorDraft: '#E75480',
    _openCustomColorModal() {
      // 打开时初始化为当前主题色（便于在原色基础上微调）
      const cur = LC.config.accentColor || '#E75480';
      this._customColorDraft = cur;
      const preview = $('#customColorPreview');
      const hex = $('#customColorHex');
      const hexInput = $('#customColorHexInput');
      if (preview) preview.style.background = cur;
      if (hex) hex.textContent = cur.toUpperCase();
      if (hexInput) hexInput.value = cur.toUpperCase();
      this._renderCustomColorPresets(cur);
      this._showModal('customColorModal');
    },
    /* 渲染预设色块（手机端原生色盘常不可用时的兜底选择方式） */
    _renderCustomColorPresets(currentColor) {
      const presets = ['#E75480','#FF6B6B','#FF8E53','#FFB627','#F1C40F','#A3CB38',
        '#42B86E','#2ECC71','#22C1C3','#3498DB','#3A86FF','#6C5CE7',
        '#A66BCC','#9B59B6','#E056FD','#FD79A8','#C0392B','#636E72','#2D3436'];
      const box = this.el.customColorPresets;
      if (!box) return;
      box.innerHTML = '';
      presets.forEach(c => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'custom-color-preset' + (c.toLowerCase() === String(currentColor||'').toLowerCase() ? ' active' : '');
        b.style.background = c;
        b.dataset.color = c;
        b.title = c.toUpperCase();
        b.addEventListener('click', () => this._onCustomColorInput(c));
        box.appendChild(b);
      });
    },
    _onCustomColorInput(value) {
      if (!value) return;
      this._customColorDraft = value;
      const preview = $('#customColorPreview');
      const hex = $('#customColorHex');
      const hexInput = $('#customColorHexInput');
      if (preview) preview.style.background = value;
      if (hex) hex.textContent = value.toUpperCase();
      if (hexInput && hexInput.value.toLowerCase() !== value.toLowerCase()) hexInput.value = value.toUpperCase();
      // 同步预设 active
      const box = this.el.customColorPresets;
      if (box) box.querySelectorAll('.custom-color-preset').forEach(b => {
        b.classList.toggle('active', b.dataset.color.toLowerCase() === value.toLowerCase());
      });
    },
    /* HEX 文本输入：用户手输颜色，实时校验并预览 */
    _onCustomColorHexInput(value) {
      let v = (value || '').trim();
      if (v && !v.startsWith('#')) v = '#' + v;
      if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
        this._onCustomColorInput(v);
      } else {
        // 格式不全时只更新 draft（不强写回输入框，避免打字时光标跳尾）
        this._customColorDraft = v;
      }
    },
    _confirmCustomColor() {
      const color = this._customColorDraft || '#E75480';
      // 最终再校验一次，不合法回退默认色
      const final = /^#[0-9A-Fa-f]{6}$/.test(color) ? color : '#E75480';
      LC.config.accentColor = final;
      this.applyAccentColor();
      LC.Storage.set('config', LC.config);
      // 同步色盘 active 状态（自定义色不在预设里，所有 dot 都取消 active）
      const p = $('#colorPicker');
      if (p) p.querySelectorAll('.color-dot').forEach(x => x.classList.remove('active'));
      this._closeCustomColorModal();
      this._toast('已应用自定义颜色', 1200);
    },
    _closeCustomColorModal() { this._closeModal('customColorModal'); },

    /* ============ 头部 / 状态 ============ */
    renderHeader() {
      this.el.partnerName.textContent = LC.config.partner.name;
      // 头像：emoji 字符串 / {url, crop} 对象 / 空=默认剪影
      // 头部头像已移除（仅保留打字指示器的小头像）
      const av = LC.config.partner.avatar;
      this.el.typingAvatar.innerHTML = this._avatarHTML(av);
      this.el.typingAvatar.classList.toggle('avatar-photo', !!(av && typeof av === 'object'));
      this.el.typingAvatar.classList.toggle('avatar-default', !av);
    },
    updateStatus(text) { this.el.partnerStatus.textContent = text; },

    /* ============ 头像图片上传 + 裁剪 ============ */
    _avatarCropSource: null, // dataURL
    _avatarCropZoom: 100,
    _avatarCropPan: { x: 0, y: 0 }, // 平移 (像素), 受 transform-origin 影响
    _avatarCropRect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, // 相对坐标
    _pickAvatarImage(target) {
      this._avatarCropTarget = target;
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          this._avatarCropSource = reader.result;
          this._avatarCropZoom = 100;
          this._avatarCropPan = { x: 0, y: 0 };
          this._avatarCropRect = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
          this._openCropModal();
        };
        reader.readAsDataURL(file);
      };
      input.click();
    },
    _openCropModal() {
      const img = $('#cropImg');
      img.onload = () => {
        this._avatarCropRect = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
        this._avatarCropZoom = 100;
        this._avatarCropPan = { x: 0, y: 0 };
        $('#cropZoom').value = 100;
        this._bindCropPan();
        this._renderCropFrame();
      };
      img.src = this._avatarCropSource;
      $('#cropPreviewImg').src = this._avatarCropSource;
      this._showModal('avatarCropModal');
    },
    _renderCropFrame() {
      const rect = this._avatarCropRect;
      const mask = $('#cropMask');
      const r = mask.querySelector('#cropRect');
      r.style.left = (rect.x * 100) + '%';
      r.style.top = (rect.y * 100) + '%';
      r.style.width = (rect.w * 100) + '%';
      r.style.height = (rect.h * 100) + '%';
      // 主图：按 zoom 缩放 + 用户平移
      const img = $('#cropImg');
      const z = this._avatarCropZoom / 100;
      img.style.transformOrigin = 'center center';
      img.style.transform = `translate(${this._avatarCropPan.x}px, ${this._avatarCropPan.y}px) scale(${z})`;
      // 预览：以 rect 为基准放大, 应用相同平移 (相对 frame 百分比)
      const pv = $('#cropPreviewImg');
      const frameW = 260;
      pv.style.transformOrigin = `${(rect.x + rect.w/2) * 100}% ${(rect.y + rect.h/2) * 100}%`;
      // 平移在预览中的比例 = pan / frameSize (近似)
      const pxPct = (this._avatarCropPan.x / frameW) * 100;
      const pyPct = (this._avatarCropPan.y / frameW) * 100;
      // 用 background-position 没法做, 用 transform 平移
      pv.style.transform = `translate(${pxPct}%, ${pyPct}%) scale(${z / rect.w})`;
    },
    /** 绑定图片拖动 (pan) */
    _bindCropPan() {
      const img = $('#cropImg');
      const frame = $('.crop-frame');
      if (!img || img.dataset.panBound === '1') return;
      img.dataset.panBound = '1';
      let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
      const onDown = (e) => {
        dragging = true;
        const pt = e.touches ? e.touches[0] : e;
        sx = pt.clientX; sy = pt.clientY;
        ox = this._avatarCropPan.x; oy = this._avatarCropPan.y;
        img.classList.add('dragging');
        // 阻止图片默认拖拽 (浏览器会把 dataURL 当文件下载)
        e.preventDefault();
      };
      const onMove = (e) => {
        if (!dragging) return;
        const pt = e.touches ? e.touches[0] : e;
        this._avatarCropPan.x = ox + (pt.clientX - sx);
        this._avatarCropPan.y = oy + (pt.clientY - sy);
        this._renderCropFrame();
        e.preventDefault();
      };
      const onUp = () => { dragging = false; img.classList.remove('dragging'); };
      // 用 frame 而不是 img, 避免 img 上 pointer-events 与 mask 冲突
      frame.addEventListener('mousedown', onDown);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      frame.addEventListener('touchstart', onDown, { passive: false });
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp);
      // 阻止图片原生拖拽 (img drag 行为)
      img.addEventListener('dragstart', (e) => e.preventDefault());
    },
    _cropZoomBy(delta) {
      let z = Math.max(50, Math.min(300, this._avatarCropZoom + delta));
      this._avatarCropZoom = z;
      $('#cropZoom').value = z;
      this._renderCropFrame();
    },
    _cropApplyZoom(z) {
      this._avatarCropZoom = z;
      this._renderCropFrame();
    },
    _confirmCrop() {
      const rect = this._avatarCropRect;
      const target = this._avatarCropTarget;
      const zoom = this._avatarCropZoom / 100;
      // 计算最终取景区域：相对坐标 + pan 偏移 + zoom
      // 图像渲染: img 实际尺寸 = frame * zoom (object-fit:contain 的前提下)
      const img = new Image();
      img.onload = () => {
        const out = 240;
        const frameW = 260;
        const ew = rect.w / zoom;
        const eh = rect.h / zoom;
        // pan 在图像原始坐标系的偏移:
        // 图像原始宽度 = frameW / zoom (在 object-fit:contain 下等于 frame), 实际可见区 = frameW/zoom
        const imgCoordW = frameW; // canvas 同 frame
        const imgCoordH = frameW;
        // pan 是像素, 转成相对坐标
        const px = this._avatarCropPan.x / imgCoordW;
        const py = this._avatarCropPan.y / imgCoordH;
        // 取景中心 = rect 中心 + pan 偏移 (因为 transform-origin=center)
        const cx = rect.x + rect.w / 2 + px;
        const cy = rect.y + rect.h / 2 + py;
        const ex = cx - ew / 2;
        const ey = cy - eh / 2;
        const canvas = document.createElement('canvas');
        canvas.width = out; canvas.height = out;
        const ctx = canvas.getContext('2d');
        const sw = img.naturalWidth * ew;
        const sh = img.naturalHeight * eh;
        const sx = img.naturalWidth * ex;
        const sy = img.naturalHeight * ey;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, out, out);
        const dataUrl = canvas.toDataURL('image/png');
        // 保存 rect 信息以便后续可能复用 (实际图片已是裁剪后的)
        const av = { url: dataUrl, crop: { x: 0, y: 0, w: 1, h: 1 } };
        if (target === 'partner') LC.config.partner.avatar = av;
        else LC.config.user.avatar = av;
        LC.Storage.set('config', LC.config);
        this._renderAvatarPreview();
        if (target === 'partner') this.renderHeader();
        this._closeModal('avatarCropModal');
        this._toast('头像已更新', 1500);
      };
      img.src = this._avatarCropSource;
    },
    _resetAvatar(target) {
      // 恢复默认 = 空字符串 → 渲染为"空白小人胸像"默认头像（中性灰背景）
      if (target === 'partner') LC.config.partner.avatar = '';
      else LC.config.user.avatar = '';
      LC.Storage.set('config', LC.config);
      this._renderAvatarPreview();
      if (target === 'partner') this.renderHeader();
      this._toast('已恢复默认头像', 1500);
    },
    _renderAvatarPreview() {
      const pAv = LC.config.partner.avatar;
      const uAv = LC.config.user.avatar;
      if (this.el.setPartnerAvatarPreview) {
        this.el.setPartnerAvatarPreview.innerHTML = this._renderSingleAvatarPreview(pAv);
        this.el.setPartnerAvatarPreview.classList.toggle('avatar-default', !pAv);
      }
      if (this.el.setUserAvatarPreview) {
        this.el.setUserAvatarPreview.innerHTML = this._renderSingleAvatarPreview(uAv);
        this.el.setUserAvatarPreview.classList.toggle('avatar-default', !uAv);
      }
    },
    _renderSingleAvatarPreview(av) {
      if (!av) return this._avatarHTML(av); // 空 → 默认剪影
      if (typeof av === 'string') return esc(av);
      return `<img src="${esc(av.url)}" alt="">`;
    },

    /* ============ 背景图 ============ */
    _pickBackgroundImage() {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          // 背景图用原图，不再压缩（v5：用户反馈压缩严重）
          const dataUrl = reader.result;
          const fit = (LC.config.backgroundImage && LC.config.backgroundImage.fit) || 'cover';
          LC.config.backgroundImage = { url: dataUrl, fit };
          LC.Storage.set('config', LC.config);
          this._renderBgPreview();
          this.applyBackground();
          this._toast('背景已更新', 1500);
        };
        reader.readAsDataURL(file);
      };
      input.click();
    },
    _resetBackground() {
      LC.config.backgroundImage = null;
      LC.Storage.set('config', LC.config);
      this._renderBgPreview();
      this.applyBackground();
      this._toast('已清除背景', 1500);
    },
    _renderBgPreview() {
      if (!this.el.bgImagePreview) return;
      const bg = LC.config.backgroundImage;
      if (bg && bg.url) {
        this.el.bgImagePreview.style.backgroundImage = `url(${bg.url})`;
        this.el.bgImagePreview.style.backgroundSize = 'cover';
        this.el.bgImagePreview.style.backgroundPosition = 'center';
        this.el.bgImagePreview.textContent = '';
      } else {
        this.el.bgImagePreview.style.backgroundImage = '';
        this.el.bgImagePreview.textContent = '未设置';
      }
      if (this.el.setBgFit) this.el.setBgFit.value = (bg && bg.fit) || 'cover';
    },
    applyBackground() {
      const bg = LC.config.backgroundImage;
      // 背景挂在独立静态层 #chatBg 上（absolute 铺满 chat-view），
      // 与消息滚动彻底脱钩：消息再多也不会推动/拉伸背景
      const layer = document.getElementById('chatBg');
      const messages = this.el.messages;
      // 清理历史遗留：v4 之前背景挂在 messages 上
      if (messages) {
        messages.style.backgroundImage = '';
        messages.style.backgroundSize = '';
        messages.style.backgroundRepeat = '';
        messages.style.backgroundPosition = '';
        messages.style.backgroundAttachment = '';
      }
      if (!layer) return;
      if (bg && bg.url) {
        const fit = bg.fit || 'cover';
        let size, repeat, position;
        if (fit === 'cover') { size = 'cover'; repeat = 'no-repeat'; position = 'center'; }
        else if (fit === 'contain') { size = 'contain'; repeat = 'no-repeat'; position = 'center'; }
        else if (fit === 'tile') { size = '160px'; repeat = 'repeat'; position = 'top left'; }
        else { size = 'auto'; repeat = 'no-repeat'; position = 'center'; }
        layer.style.backgroundImage = `url(${bg.url})`;
        layer.style.backgroundSize = size;
        layer.style.backgroundRepeat = repeat;
        layer.style.backgroundPosition = position;
      } else {
        layer.style.backgroundImage = '';
        layer.style.backgroundSize = '';
        layer.style.backgroundRepeat = '';
        layer.style.backgroundPosition = '';
      }
    },

    /* ============ 危险操作 ============ */
    _onClearChat() { if (confirm('确定清空所有聊天记录？不可恢复。')) { LC.ChatEngine.clearHistory(); LC.ChatEngine.cancelAllChoiceTimers(); this.renderHistory(); this._renderDataStats(); this._toast('聊天记录已清空'); } },
    async _onResetAll() { if (confirm('⚠️ 确定重置全部数据？\n将删除所有字卡、聊天记录、设置，恢复初始状态！')) { await LC.Storage.clearAll(); location.reload(); } },

    /* ============ 抉择功能 ============ */
    // 抉择模式：'single'（默认） | 'multi'
    _choiceMode: 'single',
    _setChoiceMode(mode) {
      this._choiceMode = mode;
      this.el.choiceModeSingle.classList.toggle('active', mode === 'single');
      this.el.choiceModeMulti.classList.toggle('active', mode === 'multi');
      this.el.choiceModeHint.textContent = mode === 'multi'
        ? '多选：Ta 随机回复 1~全部 个选项'
        : '单选：Ta 随机回复 1 个选项';
    },
    _openChoiceModal() {
      this.el.choiceQuestion.value = '';
      this._renderChoiceOptions(['', '']);
      this._setChoiceMode('single');
      this._updateChoiceSendBtn();
      this._showModal('choiceModal');
      // 让弹窗内部滚轮初始位于最上方（手机端避免默认滚到中间，导致看不到单选/多选按钮）
      // 用户要求：打开弹窗后不要主动触发任何输入框的 focus，否则浏览器会把焦点元素 scrollIntoView
      // 到视野中央，把"单选/多选"按钮挤出顶部可视区。
      requestAnimationFrame(() => { if (this.el.choiceScroll) this.el.choiceScroll.scrollTop = 0; });
      setTimeout(() => { if (this.el.choiceScroll) this.el.choiceScroll.scrollTop = 0; }, 60);
    },
    _renderChoiceOptions(options) {
      const wrap = this.el.choiceOptions;
      wrap.innerHTML = '';
      options.forEach((opt, idx) => {
        const row = document.createElement('div');
        row.className = 'choice-option';
        row.dataset.idx = String(idx);
        row.innerHTML = `<textarea class="choice-opt-input" placeholder="选项 ${idx+1}" rows="1">${esc(opt)}</textarea><button class="choice-opt-del" data-idx="${idx}" style="display:none">删除</button>`;
        wrap.appendChild(row);
      });
      this._bindChoiceOptionEvents();
    },
    _bindChoiceOptionEvents() {
      const wrap = this.el.choiceOptions;
      wrap.querySelectorAll('.choice-option').forEach(row => {
        const ta = row.querySelector('textarea');
        const delBtn = row.querySelector('.choice-opt-del');
        // 自适应高度
        ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
        ta.addEventListener('input', () => {
          ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
          this._updateChoiceSendBtn();
        });
        // 长按显示删除按钮（其他全部隐藏，只显示当前）
        let timer = null;
        const start = (e) => {
          timer = setTimeout(() => {
            wrap.querySelectorAll('.choice-opt-del').forEach(b => b.style.display = 'none');
            delBtn.style.display = '';
          }, 450);
        };
        const cancel = () => { if (timer) clearTimeout(timer); };
        row.addEventListener('touchstart', start, { passive: true });
        row.addEventListener('touchend', cancel);
        row.addEventListener('touchmove', cancel);
        row.addEventListener('mousedown', start);
        row.addEventListener('mouseup', cancel);
        row.addEventListener('mouseleave', cancel);
        delBtn.addEventListener('click', () => this._deleteChoiceOption(parseInt(row.dataset.idx)));
      });
    },
    _deleteChoiceOption(idx) {
      const wrap = this.el.choiceOptions;
      const rows = [...wrap.querySelectorAll('.choice-option')];
      if (rows.length <= 2) { this._toast('至少保留 2 个选项'); return; }
      rows[idx].remove();
      [...wrap.querySelectorAll('.choice-option')].forEach((r, i) => {
        r.dataset.idx = String(i);
        r.querySelector('textarea').placeholder = '选项 ' + (i+1);
        r.querySelector('.choice-opt-del').dataset.idx = String(i);
      });
      this._updateChoiceSendBtn();
    },
    _addChoiceOption() {
      const wrap = this.el.choiceOptions;
      const rows = [...wrap.querySelectorAll('.choice-option')];
      const row = document.createElement('div');
      row.className = 'choice-option';
      row.dataset.idx = String(rows.length);
      row.innerHTML = `<textarea class="choice-opt-input" placeholder="选项 ${rows.length+1}" rows="1"></textarea><button class="choice-opt-del" data-idx="${rows.length}" style="display:none">删除</button>`;
      wrap.appendChild(row);
      this._bindChoiceOptionEvents();
      row.querySelector('textarea').focus();
      this._updateChoiceSendBtn();
    },
    _collectChoiceOptions() {
      const wrap = this.el.choiceOptions;
      return [...wrap.querySelectorAll('.choice-opt-input')]
        .map(t => t.value.trim())
        .filter(Boolean);
    },
    _updateChoiceSendBtn() {
      const q = this.el.choiceQuestion.value.trim();
      const opts = this._collectChoiceOptions();
      const ok = !!q && opts.length >= 2;
      this.el.choiceSendBtn.disabled = !ok;
      this.el.choiceHint.textContent = opts.length < 2 ? '至少需要 2 个选项' : `已输入 ${opts.length} 个选项`;
    },
    _sendChoice() {
      const q = this.el.choiceQuestion.value.trim();
      const opts = this._collectChoiceOptions();
      const minutes = Math.max(0.1, parseFloat(this.el.choiceMinutes.value) || 1);
      if (!q || opts.length < 2) return;
      this._hideModal('choiceModal');
      this.el.emptyState.style.display = 'none';
      LC.ChatEngine.sendChoice(q, opts, minutes, this._choiceMode, {
        onUserMessage: (m) => this._renderMessage(m),
        onChoiceReply: (m) => {
          this.showTyping(false);
          this._renderMessage(m);
          this._toast('Ta 的抉择结果已送达', 1800);
        },
      });
      this._toast('抉择已发送，等待 Ta 的回复…', 1800);
    },
    _openChoiceDetail(msgId) {
      const msg = LC.ChatEngine.history.find(m => m.id === msgId);
      if (!msg || msg.kind !== 'choice') return;
      const c = msg.content || {};
      // 兼容旧数据 chosenIndex（单值）与新数据 chosenIndices（数组）
      const chosen = Array.isArray(c.chosenIndices) && c.chosenIndices.length
        ? c.chosenIndices.slice()
        : (c.chosenIndex != null ? [c.chosenIndex] : []);
      const chosenSet = new Set(chosen);
      const modeLabel = c.mode === 'multi' ? '多选' : '单选';
      const title = msg.role === 'partner'
        ? `已完成「${c.question}」的抉择 · ${modeLabel}`
        : `关于「${c.question}」的抉择 · ${modeLabel}`;
      this.el.choiceDetailTitle.textContent = title;
      this.el.choiceDetailList.innerHTML = (c.options || []).map((o, i) => {
        const isChosen = chosenSet.has(i);
        const cls = isChosen ? 'cdl-item chosen' : 'cdl-item';
        const tag = isChosen ? '<span class="cdl-tag">Ta 的选择</span>' : '';
        return `<div class="${cls}"><span class="cdl-idx">${i+1}</span><span class="cdl-text">${esc(o)}</span>${tag}</div>`;
      }).join('');
      this._showModal('choiceDetailModal');
    },

    /* ============ 全量备份与恢复 ============ */
    /** 导出全部数据：字卡库 + 聊天记录 + 设置 全部打包成一个 JSON */
    async _onExportAll() {
      try {
        const json = await LC.Storage.exportAll();
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
        this._download(json, `lovechat-backup-${stamp}.json`);
        this._toast('已导出全部数据，请妥善保存此文件', 3000);
      } catch (e) {
        this._toast('导出失败：' + e.message, 3500);
      }
    },
    /** 导入全部数据：从备份 JSON 恢复，会覆盖现有数据
     *  支持两种入口：选文件（桌面） / 粘贴 JSON 文本（APP WebView 下 file input 可能失效） */
    async _onImportAll(ev) {
      const file = ev.target.files[0];
      if (!file) return;
      if (!confirm('⚠️ 导入会覆盖当前所有数据（字卡、聊天记录、设置）。\n\n建议在导入前先点"导出全部数据"做一次当前数据备份。\n\n确认继续导入？')) {
        ev.target.value = ''; return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        await this._doImportAllText(reader.result);
        ev.target.value = '';
      };
      reader.readAsText(file);
    },
    async _doImportAllText(jsonText) {
      try {
        const result = await LC.Storage.importAll(jsonText, 'replace');
        if (result.ok) {
          this._toast(`导入成功，已恢复 ${result.count} 项数据，2 秒后刷新页面`, 2500);
          setTimeout(() => location.reload(), 2000);
        } else {
          this._toast('导入失败：' + result.error, 3500);
        }
      } catch (e) {
        this._toast('导入失败：' + e.message, 3500);
      }
    },
    /** 打开"粘贴 JSON 导入"弹窗（APP 下 file 选择可能失效时的备选入口） */
    _openPasteImportModal() {
      let modal = $('#pasteImportModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'pasteImportModal';
        modal.className = 'modal';
        modal.innerHTML = `
          <div class="modal-content" style="max-width:600px;">
            <div class="modal-header">
              <h3 class="modal-title">粘贴备份导入</h3>
              <button class="modal-close" id="pasteImportClose">×</button>
            </div>
            <p style="font-size:12px;color:#999;margin:0 0 8px;">将之前导出的 JSON 文本全部粘贴到下方文本框，点"导入"恢复数据。</p>
            <textarea id="pasteImportArea" class="field-input" style="width:100%;height:280px;font-family:monospace;font-size:11px;resize:vertical;" placeholder="在此粘贴备份 JSON..."></textarea>
            <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">
              <button class="btn-secondary" id="pasteImportCancelBtn">取消</button>
              <button class="btn-primary" id="pasteImportConfirmBtn">导入</button>
            </div>
          </div>`;
        document.body.appendChild(modal);
        $('#pasteImportClose').addEventListener('click', () => this._closeModal('pasteImportModal'));
        $('#pasteImportCancelBtn').addEventListener('click', () => this._closeModal('pasteImportModal'));
        $('#pasteImportConfirmBtn').addEventListener('click', async () => {
          const txt = $('#pasteImportArea').value.trim();
          if (!txt) { this._toast('请先粘贴 JSON 文本', 1500); return; }
          if (!confirm('⚠️ 导入会覆盖当前所有数据，确认继续？')) return;
          this._closeModal('pasteImportModal');
          await this._doImportAllText(txt);
        });
      }
      $('#pasteImportArea').value = '';
      this._showModal('pasteImportModal');
      setTimeout(() => $('#pasteImportArea').focus(), 100);
    },
    /** 渲染数据统计：占用大小、字卡数、消息数 */
    async _renderDataStats() {
      if (!$('#dataStats')) return;
      const stats = await LC.Storage.getStats();
      $('#statTotalSize').textContent = stats.totalDisplay;
      // 字卡总数（所有模块）
      let totalCards = 0;
      for (const m of Object.keys(LC.MODULES)) totalCards += (LC.CardLibrary.getAll(m) || []).length;
      $('#statCardCount').textContent = totalCards + ' 条';
      // 消息数
      const hist = LC.ChatEngine.getHistory();
      $('#statMsgCount').textContent = hist.length + ' 条';
    },

    /* ============ 工具 ============ */
    _closeOther(keep) { if (keep !== 'cardsPanel') this.closeCardsPanel(); if (keep !== 'settingsPanel') this.closeSettingsPanel(); },
    closeAllPanels() { this.closeCardsPanel(); this.closeSettingsPanel(); },
    _maybeHideOverlay() {
      const any = this.el.cardsPanel.classList.contains('open') || this.el.settingsPanel.classList.contains('open');
      if (!any) { this.el.overlay.classList.remove('show'); setTimeout(() => { this.el.overlay.hidden = true; }, 300); }
    },
    _showModal(id) { const m = $('#'+id); if (!m) return; if (m._hideTimer) { clearTimeout(m._hideTimer); m._hideTimer = null; } m.hidden = false; requestAnimationFrame(() => m.classList.add('show')); },
    _hideModal(id) { const m = $('#'+id); if (!m) return; m.classList.remove('show'); if (m._hideTimer) clearTimeout(m._hideTimer); m._hideTimer = setTimeout(() => { m.hidden = true; m._hideTimer = null; }, 300); },
    _closeModal(id) { this._hideModal(id); },

    /* ---- 气泡设计 ---- */
    _getCustomBubbleStyleEl() {
      let el = document.getElementById('customBubbleCSS');
      if (!el) { el = document.createElement('style'); el.id = 'customBubbleCSS'; document.head.appendChild(el); }
      return el;
    },
    _applyBubbleCSSFromConfig() {
      const css = (LC.config && LC.config.customBubbleCSS) || '';
      this._getCustomBubbleStyleEl().textContent = css;
    },
    _openBubbleDesign() {
      const ta = $('#bubbleCSSInput');
      // 打开时显示已保存的 CSS（若无则填入默认模板）
      ta.value = (LC.config && LC.config.customBubbleCSS) || this._defaultBubbleCSSTemplate();
      this._showModal('bubbleDesignModal');
      requestAnimationFrame(() => ta.focus());
    },
    _applyBubbleCSS() {
      const ta = $('#bubbleCSSInput');
      const css = ta.value.trim();
      this._getCustomBubbleStyleEl().textContent = css;
      LC.config.customBubbleCSS = css;
      LC.Storage.set('config', LC.config);
      this._toast('已应用气泡样式', 1500);
    },
    _defaultBubbleCSSTemplate() {
      return `/* 我发送的气泡（右侧） */
.message-sent {
  position: relative !important;
  background: rgba(245, 245, 245, 0.9) !important;
  border: 2px solid rgba(210, 210, 210, 0.6) !important;
  border-radius: 12px 12px 0 12px !important;
  box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.06) !important;
  padding: 5px 12px !important;
  margin: 3px 0 3px auto !important;
  font-size: 14px !important;
  line-height: 1.4 !important;
  color: #999 !important;
  display: inline-block !important;
  max-width: none !important;
  overflow: visible !important;
  margin-bottom: 18px !important;
  z-index: 1 !important;
}
.message-sent::after {
  content: '' !important;
  position: absolute !important;
  bottom: -13px !important;
  left: -7px !important;
  width: 26px !important;
  height: 26px !important;
  background: url('https://files.catbox.moe/bq2cxt.png') center / contain no-repeat !important;
  image-rendering: pixelated !important;
  -ms-interpolation-mode: nearest-neighbor !important;
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
  z-index: 99999 !important;
  pointer-events: none !important;
}
.message-sent * {
  color: #888 !important;
}

/* 他发来的气泡（左侧） */
.message-received {
  position: relative !important;
  background: rgba(215, 215, 215, 0.7) !important;
  border: 2px solid rgba(190, 190, 190, 0.5) !important;
  border-radius: 12px 12px 12px 0 !important;
  box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.06) !important;
  padding: 5px 12px !important;
  margin: 3px auto 3px 0 !important;
  font-size: 14px !important;
  line-height: 1.4 !important;
  color: #555 !important;
  display: inline-block !important;
  max-width: none !important;
  overflow: visible !important;
  margin-bottom: 18px !important;
  z-index: 1 !important;
}
.message-received::after {
  content: '' !important;
  position: absolute !important;
  bottom: -13px !important;
  right: -7px !important;
  width: 26px !important;
  height: 26px !important;
  background: url('https://files.catbox.moe/v9hr2m.png') center / contain no-repeat !important;
  image-rendering: pixelated !important;
  -ms-interpolation-mode: nearest-neighbor !important;
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
  z-index: 99999 !important;
  pointer-events: none !important;
}`;
    },
    _closeAllModals() {
      // 静态弹窗 + 可能的动态弹窗；元素不存在直接跳过（防止 null.classList 报错阻断流程）
      ['cardModal','categoryModal','exportCatModal','exportFullModal','exportChoiceMenu','importModal','importModeMenu','multiSendModal','patModal','stickerPicker','inputExpand','expandMenuSheet','avatarCropModal','choiceModal','choiceDetailModal','bubbleDesignModal','customColorModal']
        .forEach(id => this._hideModal(id));
    },
    _toast(msg, dur = 2000) {
      let t = $('.lc-toast');
      if (!t) { t = document.createElement('div'); t.className = 'lc-toast'; t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;padding:10px 20px;border-radius:20px;font-size:13px;z-index:999;opacity:0;transition:opacity .3s;pointer-events:none;max-width:80%;text-align:center'; document.body.appendChild(t); }
      t.textContent = msg; t.style.opacity = '1'; clearTimeout(t._timer); t._timer = setTimeout(() => { t.style.opacity = '0'; }, dur);
    },
    _fmtTime(ts) {
      const d = new Date(ts);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    },
    _fmtDate(ts) { const d = new Date(ts), t = new Date(), y = new Date(); y.setDate(y.getDate()-1);
      const same = (a,b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
      if (same(d,t)) return '今天'; if (same(d,y)) return '昨天'; return `${d.getMonth()+1}月${d.getDate()}日`; },
    _dateStr() { const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); },

    /* ============ 信件投递 ============ */
    _letterState: { tab: 'sent', favMode: false, showFav: false }, // 当前tab/收藏模式/长按显示爱心

    _openLetterScreen() {
      this._closeExpandMenu();
      this._letterState.tab = 'sent';
      this._letterState.favMode = false;
      this._letterState.showFav = false;
      this.el.letterScreen.hidden = false;
      $('#letterFavBtn').classList.remove('active');
      $$('.letter-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'sent'));
      this._exitComposeMode();
      this._renderLetterList();
    },
    _closeLetterScreen() {
      this.el.letterScreen.hidden = true;
    },
    _switchLetterTab(tab) {
      this._letterState.tab = tab;
      $$('.letter-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      this._exitComposeMode();
      this._renderLetterList();
    },
    _toggleFavMode() {
      this._letterState.favMode = !this._letterState.favMode;
      $('#letterFavBtn').classList.toggle('active', this._letterState.favMode);
      this._renderLetterList();
    },
    _enterComposeMode() {
      this.el.letterFooter.hidden = true;
      this.el.letterFooterCompose.hidden = false;
      this.el.letterCompose.hidden = false;
      this.el.letterListArea.hidden = true;
      this.el.letterTextarea.value = '';
      setTimeout(() => this.el.letterTextarea.focus(), 100);
    },
    _exitComposeMode() {
      this.el.letterFooter.hidden = false;
      this.el.letterFooterCompose.hidden = true;
      this.el.letterCompose.hidden = true;
      this.el.letterListArea.hidden = false;
    },
    async _sendLetter() {
      const content = this.el.letterTextarea.value.trim();
      if (!content) { this._toast('请写信件内容', 1500); return; }
      const alsoChat = $('#letterAlsoChat').checked;
      const letter = await LC.Letters.sendLetter(content);
      // 同步到聊天记录：信封样式消息，点开弹窗预览信件
      if (alsoChat) {
        const chatMsg = { id: 'msg_' + Date.now(), role: 'me', kind: 'letter', content: { letterId: letter.id, preview: content.slice(0, 50) }, time: Date.now() };
        LC.ChatEngine.history.push(chatMsg);
        if (LC.ChatEngine.history.length > 800) LC.ChatEngine.history = LC.ChatEngine.history.slice(-800);
        LC.Storage.set('history', LC.ChatEngine.history);
        this._renderMessage(chatMsg, true);
      }
      this._exitComposeMode();
      this._renderLetterList();
      this._updateLettersBadge();
      this._toast('信件已寄出', 1500);
    },

    _renderLetterList() {
      const { tab, favMode, showFav } = this._letterState;
      const list = LC.Letters.getList(tab, favMode);
      this.el.letterList.innerHTML = '';
      if (!list.length) {
        this.el.letterEmpty.hidden = false;
        this.el.letterEmpty.textContent = favMode
          ? '收藏夹空空如也。\n\n长按任意信件 → 点亮爱心即可收藏。\n再点爱心变灰 = 取消收藏。\n点垃圾桶 = 删除该信。'
          : (tab === 'sent' ? '还没有寄出的信。\n点下方"写信"开始第一封吧。' : '还没有收到的信。\n静静等待 Ta 的来信…');
        return;
      }
      this.el.letterEmpty.hidden = true;
      for (const l of list) {
        const item = document.createElement('div');
        item.className = 'letter-item ' + l.type;
        if (l.favorite) item.classList.add('fav-active');
        if (showFav) item.classList.add('show-fav');
        item.dataset.id = l.id;
        const d = new Date(l.time);
        const dateStr = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')
          + ' ' + String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
        const replyTag = (l.type === 'sent' && l.isReply) ? '<span class="letter-item-reply-tag">·回信</span>' : '';
        const unreadDot = (l.type === 'received' && !l.read) ? '<div class="letter-item-unread-dot"></div>' : '';
        const preview = (l.content || '').slice(0, 80);
        const favIcon = `<svg class="letter-item-fav-icon${l.favorite ? ' active' : ''}" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
        // 删除图标（小垃圾桶）：与收藏图标一起，长按后显示，再次长按隐藏
        const delIcon = `<svg class="letter-item-del-icon" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
        item.innerHTML = `<div class="letter-item-date">${esc(dateStr)}${replyTag}</div><div class="letter-item-preview">${esc(preview)}</div>${unreadDot}${favIcon}${delIcon}`;
        // 长按显示/隐藏 收藏与删除 两个图标
        let pressTimer = null;
        item.addEventListener('touchstart', () => {
          pressTimer = setTimeout(() => {
            this._letterState.showFav = !this._letterState.showFav;
            this._renderLetterList();
          }, 500);
        });
        item.addEventListener('touchend', () => { clearTimeout(pressTimer); });
        item.addEventListener('touchmove', () => { clearTimeout(pressTimer); });
        // 鼠标长按
        item.addEventListener('mousedown', () => {
          pressTimer = setTimeout(() => {
            this._letterState.showFav = !this._letterState.showFav;
            this._renderLetterList();
          }, 500);
        });
        item.addEventListener('mouseup', () => { clearTimeout(pressTimer); });
        item.addEventListener('mouseleave', () => { clearTimeout(pressTimer); });
        // 点击爱心收藏
        const favEl = item.querySelector('.letter-item-fav-icon');
        if (favEl) {
          favEl.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const fav = await LC.Letters.toggleFavorite(l.id);
            this._renderLetterList();
            this._toast(fav ? '已收藏' : '已取消收藏', 1200);
          });
        }
        // 点击垃圾桶删除：先弹确认框，确认后才真正删除该条信件
        const delEl = item.querySelector('.letter-item-del-icon');
        if (delEl) {
          delEl.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            // 用原生 confirm 避免自定义弹窗的定时器竞态
            if (!confirm('确定删除这封信吗？\n删除后不可恢复。')) return;
            const ok = await LC.Letters.deleteLetter(l.id);
            if (ok) {
              this._renderLetterList();
              this._updateLettersBadge();
              this._toast('信件已删除', 1200);
            }
          });
        }
        // 点击信件预览
        item.addEventListener('click', () => this._openLetterPreview(l.id));
        this.el.letterList.appendChild(item);
      }
    },

    async _openLetterPreview(letterId) {
      const l = LC.Letters.letters.find(x => x.id === letterId);
      if (!l) return;
      // 标记已读
      if (l.type === 'received' && !l.read) {
        await LC.Letters.markRead(letterId);
        this._updateLettersBadge();
      }
      this.el.letterModalTitle.textContent = l.type === 'sent' ? '寄出的信' : '收到的信';
      this.el.letterModalFooter.hidden = true;
      this.el.letterModalBody.innerHTML = '';
      const esc2 = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      if (l.type === 'sent') {
        if (l.isReply && l.replyToId) {
          // 寄出的回信：先我的内容 + 后他的原信
          const orig = LC.Letters.getOriginal(l.replyToId);
          this.el.letterModalBody.innerHTML = `<div class="letter-section-label">我的回信</div><div class="letter-paper">${esc2(l.content)}</div>`
            + (orig ? `<div class="letter-divider"></div><div class="letter-section-label">Ta 的原信</div><div class="letter-paper">${esc2(orig.content)}</div>` : '');
        } else {
          // 我主动写的信
          this.el.letterModalBody.innerHTML = `<div class="letter-paper">${esc2(l.content)}</div>`;
        }
      } else {
        // 收到的信
        if (l.isReply && l.replyToId) {
          // 他回我的信：先他回的内容 + 后我的原信
          const orig = LC.Letters.getOriginal(l.replyToId);
          this.el.letterModalBody.innerHTML = `<div class="letter-section-label">Ta 的回信</div><div class="letter-paper">${esc2(l.content)}</div>`
            + (orig ? `<div class="letter-divider"></div><div class="letter-section-label">我的原信</div><div class="letter-paper">${esc2(orig.content)}</div>` : '');
        } else if (l.isProactive) {
          // 他主动发信：显示他的内容 + 底部回信按钮
          this.el.letterModalBody.innerHTML = `<div class="letter-section-label">Ta 的来信</div><div class="letter-paper">${esc2(l.content)}</div>`;
          this.el.letterModalFooter.hidden = false;
          this.el.letterModalFooter.innerHTML = `<button class="primary-btn" id="letterReplyBtn">回信</button>`;
          $('#letterReplyBtn').addEventListener('click', () => this._showLetterReplyBox(l.id));
        } else {
          this.el.letterModalBody.innerHTML = `<div class="letter-paper">${esc2(l.content)}</div>`;
        }
      }
      this._showModal('letterModal');
      this._renderLetterList(); // 刷新红点状态
    },

    _showLetterReplyBox(originalLetterId) {
      const footer = this.el.letterModalFooter;
      footer.innerHTML = `<textarea class="letter-reply-textarea" id="letterReplyArea" placeholder="写下回信…" rows="6"></textarea>`
        + `<div class="letter-reply-actions"><button class="ghost-btn sm" id="letterReplyCancel">取消</button><button class="primary-btn" id="letterReplySend">发送</button></div>`;
      $('#letterReplyCancel').addEventListener('click', () => {
        this._hideModal('letterModal');
      });
      $('#letterReplySend').addEventListener('click', async () => {
        const txt = $('#letterReplyArea').value.trim();
        if (!txt) { this._toast('请写回信内容', 1500); return; }
        await LC.Letters.sendReply(originalLetterId, txt);
        this._hideModal('letterModal');
        this._renderLetterList();
        this._updateLettersBadge();
        this._toast('回信已寄出', 1500);
      });
      setTimeout(() => $('#letterReplyArea').focus(), 100);
    },

    _exportLetters() {
      const html = LC.Letters.exportHTML();
      this._showTextExportModal(html, 'letters-' + this._dateStr() + '.html');
    },

    async _importLetters(ev) {
      const file = ev.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          // 支持 HTML 导入（从导出的 HTML 提取）或 JSON
          const text = reader.result;
          // 简单导入：解析 JSON 格式信件数组
          let letters;
          try { letters = JSON.parse(text); } catch(e) { letters = null; }
          if (!Array.isArray(letters)) { this._toast('仅支持导入之前导出的信件JSON', 2500); ev.target.value=''; return; }
          if (!confirm('导入会覆盖当前所有信件，确认继续？')) { ev.target.value=''; return; }
          LC.Letters.letters = letters;
          await LC.Storage.set('letters', letters);
          this._renderLetterList();
          this._updateLettersBadge();
          this._toast('导入成功', 1500);
        } catch(e) { this._toast('导入失败：' + e.message, 2500); }
        ev.target.value = '';
      };
      reader.readAsText(file);
    },

    _updateLettersBadge() {
      const n = LC.Letters.getUnreadCount();
      this.el.lettersBadge.hidden = n === 0;
      if (n > 0) this.el.lettersBadge.textContent = n > 99 ? '99+' : n;
    },

    /* 信件设置 */
    _onLetterReplyHoursChange() {
      let min = Math.max(0.01, parseFloat($('#setLetterReplyMin').value) || 17);
      let max = Math.max(min, parseFloat($('#setLetterReplyMax').value) || 21);
      LC.config.letterReplyMinHours = min; LC.config.letterReplyMaxHours = max;
      LC.Storage.set('config', LC.config);
      $('#letterReplyHoursHint').textContent = `${min} ~ ${max} 小时`;
    },
    _onLetterReplyCountChange() {
      let min = Math.max(1, parseInt($('#setLetterReplyCountMin').value) || 6);
      let max = Math.max(min, parseInt($('#setLetterReplyCountMax').value) || 8);
      LC.config.letterReplyCountMin = min; LC.config.letterReplyCountMax = max;
      LC.Storage.set('config', LC.config);
      $('#letterReplyCountHint').textContent = `${min} ~ ${max} 条`;
    },
    _onLetterProactiveChange() {
      let min = Math.max(0.01, parseFloat($('#setLetterProactiveMin').value) || 20);
      let max = Math.max(min, parseFloat($('#setLetterProactiveMax').value) || 48);
      LC.config.letterProactiveMinHours = min; LC.config.letterProactiveMaxHours = max;
      LC.Storage.set('config', LC.config);
      $('#letterProactiveHint').textContent = `${min} ~ ${max} 小时`;
      // 重置下次主动信时间并重新调度定时器，使新间隔立即生效
      LC.Letters._nextProactiveTime = 0;
      LC.Letters._scheduleTimers();
    },

    /* 聊天记录导出/导入（HTML） */
    _exportChatHistory() {
      const h = LC.ChatEngine.getHistory();
      const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const fmtTime = (ts) => { const d=new Date(ts); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); };
      let lastDate = '';
      const items = h.map(m => {
        const ds = fmtTime(m.time).split(' ')[0];
        let sep = '';
        if (ds !== lastDate) { sep = `<div class="chat-date-sep">${ds}</div>`; lastDate = ds; }
        const side = m.role === 'me' ? 'me' : 'them';
        let content = '';
        if (m.kind === 'text') content = esc(m.content);
        else if (m.kind === 'sticker') content = `<img src="${esc(m.content)}" alt="[表情]" style="max-width:120px;">`;
        else if (m.kind === 'pat') content = `<em>${esc(m.content)}</em>`;
        else if (m.kind === 'choice') content = `🎲 ${esc(m.title || m.content)}`;
        return sep + `<div class="chat-msg ${side}"><span class="chat-time">${fmtTime(m.time).split(' ')[1]}</span><div class="chat-bubble ${side}">${content}</div></div>`;
      }).join('\n');
      const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>聊天记录 · 私语</title>
<style>body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f5f5;margin:0;padding:16px;}
h1{text-align:center;color:#E75480;}.container{max-width:600px;margin:0 auto;}
.chat-date-sep{text-align:center;color:#999;font-size:12px;margin:16px 0 8px;}
.chat-msg{margin:6px 0;display:flex;flex-direction:column;}.chat-msg.me{align-items:flex-end;}
.chat-msg.them{align-items:flex-start;}.chat-time{font-size:10px;color:#999;margin-bottom:2px;}
.chat-bubble{padding:8px 12px;border-radius:12px;font-size:14px;line-height:1.5;max-width:75%;}
.chat-bubble.me{background:#E75480;color:#fff;border-bottom-right-radius:4px;}
.chat-bubble.them{background:#fff;color:#333;border-bottom-left-radius:4px;}</style></head>
<body><h1>聊天记录</h1><div class="container">${items || '<p style="text-align:center;color:#999;">暂无消息</p>'}</div></body></html>`;
      this._showTextExportModal(html, 'chat-history-' + this._dateStr() + '.html');
    },

    /* 聊天记录导出（JSON）：与导入格式匹配，走 _download 流程（弹窗确认+改文件名+显示大小） */
    _exportChatHistoryJson() {
      const h = LC.ChatEngine.getHistory();
      const json = JSON.stringify(h, null, 2);
      this._download(json, 'chat-history-' + this._dateStr() + '.json');
    },

    async _importChatHistory(ev) {
      const file = ev.target.files[0]; if (!file) return;
      if (!confirm('导入会覆盖当前聊天记录，确认继续？')) { ev.target.value=''; return; }
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          let arr;
          try { arr = JSON.parse(reader.result); } catch(e) { arr = null; }
          if (!Array.isArray(arr)) { this._toast('仅支持导入之前导出的聊天记录JSON', 2500); ev.target.value=''; return; }
          LC.ChatEngine.history = arr;
        LC.Storage.set('history', LC.ChatEngine.history);
          this.renderHistory();
          this._toast('聊天记录已导入', 1500);
        } catch(e) { this._toast('导入失败：' + e.message, 2500); }
        ev.target.value = '';
      };
      reader.readAsText(file);
    },
  };

  LC.UI = UI;
})(window.LoveChat);
