/* ============================================================
 * lock.js — 密码锁屏
 * 进入网站先输入密码；输对后本次浏览器会话内不再询问
 * （刷新页面不用重输；关闭浏览器后重新打开、或新开标签页需要再输）
 *
 * ★ 改密码：改下面 PASSWORD 数组（每一位一个数字）
 * ============================================================ */

(function () {
  'use strict';

  var SESSION_KEY = 'lcUnlocked';
  var PASSWORD = [0, 4, 1, 2, 2, 2]; // ← 当前密码
  var MAX_LEN = PASSWORD.length;

  var el = document.getElementById('lockScreen');
  if (!el || el.style.display === 'none') return; // 已解锁，无需绑定

  var dotsWrap = document.getElementById('lockDots');
  var sub = document.getElementById('lockSub');
  var dots = Array.prototype.slice.call(dotsWrap.querySelectorAll('.lock-dot'));
  var input = [];
  var busy = false; // 抖动/成功动画期间不接受输入

  function render() {
    dots.forEach(function (d, i) { d.classList.toggle('on', i < input.length); });
  }

  function press(k) {
    if (busy || input.length >= MAX_LEN) return;
    input.push(k);
    render();
    if (input.length === MAX_LEN) check();
  }

  function backspace() {
    if (busy || input.length === 0) return;
    input.pop();
    render();
  }

  function check() {
    var ok = input.every(function (v, i) { return v === PASSWORD[i]; });
    if (ok) {
      busy = true;
      try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (e) {}
      dotsWrap.classList.add('ok');
      setTimeout(function () {
        el.classList.add('lock-pass'); // 触发淡出
        setTimeout(function () { el.remove(); }, 450);
      }, 220);
    } else {
      busy = true;
      dotsWrap.classList.add('err');
      sub.textContent = '密码不对，再试一次';
      sub.classList.add('err');
      setTimeout(function () {
        dotsWrap.classList.remove('err');
        sub.textContent = '输入密码进入';
        sub.classList.remove('err');
        input = [];
        render();
        busy = false;
      }, 600);
    }
  }

  // 数字键点按
  Array.prototype.forEach.call(el.querySelectorAll('.lock-key[data-k]'), function (btn) {
    btn.addEventListener('click', function () {
      press(parseInt(btn.getAttribute('data-k'), 10));
    });
  });
  // 删除键
  document.getElementById('lockDel').addEventListener('click', backspace);

  // 电脑上也可以直接用键盘输入数字 / 退格
  document.addEventListener('keydown', function (e) {
    if (e.key >= '0' && e.key <= '9') press(parseInt(e.key, 10));
    else if (e.key === 'Backspace') { e.preventDefault(); backspace(); }
  });
})();
