/* ============================================================
   OTP 驗證共用邏輯（2026-07-31，2026-08-04 補上有效時間倒數）
   ------------------------------------------------------------
   六格輸入行為、輸入錯誤鎖定、重發三態、逾時——這四件事三頁
   （找回帳密頁、2FA 綁定引導頁、2FA 簡訊驗證頁）原本各自寫一份，
   正是「這頁改了那頁沒改」的飄移根源。抽成這支共用檔，改一次三頁同步。

   目前「2FA 綁定引導頁」「2FA 簡訊驗證頁」都接這支檔案；找回帳密頁
   維持原本各自的實作（沒有共用），之後個別評估要不要一起換成呼叫這裡。

   用法：
   <script src="otp-shared.js"></script>
   <script>
     var otp = initOtpVerifier({
       otpRow: document.getElementById('otpRow'),
       verifyBtn: document.getElementById('verifyBtn'),
       verifyLabelEl: document.querySelector('#verifyBtn span'),
       errorBox: document.getElementById('errorMsg'),
       errorTextEl: document.getElementById('errorTextMsg'),
       resendRow: document.getElementById('resendRow'),
       maxAttempts: 5,        // 選填，預設 5
       maxResends: 3,         // 選填，預設 3
       checkCode: function (code) { return true; },   // 選填，預設一律成功
       onSuccess: function (code) { ... },
       onTimeout: function () { ... },                // 選填，不傳就不啟動逾時計時
       timeoutMs: 3 * 60 * 1000,                       // 選填，搭配 onTimeout 使用
       validityEl: document.getElementById('validitySec')  // 選填，逐秒顯示剩餘秒數（交易代碼那行）
     });
     otp.reset();               // 進到這一步時呼叫，重置輸入/倒數/逾時計時/有效時間
     otp.startCountdown(56);    // 開始重發倒數
   ============================================================ */
function initOtpVerifier(opts) {
  var otpRow       = opts.otpRow;
  var inputs       = Array.prototype.slice.call(otpRow.querySelectorAll('input'));
  var verifyBtn    = opts.verifyBtn;
  var verifyLabelEl= opts.verifyLabelEl;
  var errorBox     = opts.errorBox;
  var errorTextEl  = opts.errorTextEl;
  var resendRow    = opts.resendRow;
  var validityEl   = opts.validityEl;
  var maxAttempts  = opts.maxAttempts || 5;
  var maxResends   = opts.maxResends || 3;
  var checkCode    = opts.checkCode || function () { return true; };

  var attemptsLeft = maxAttempts;
  var resendCount  = 0;
  var resendTimer  = null;
  var timeoutTimer = null;
  var timeoutSecLeft = 0;   // 有效時間倒數用（交易代碼那行），跟 resendTimer 是各自獨立的計時器
  var verifyLabelDefault = verifyLabelEl ? verifyLabelEl.textContent : '驗證';
  var resendBtnId  = 'resendBtn_' + Math.random().toString(36).slice(2, 8);

  function code() { return inputs.map(function (i) { return i.value; }).join(''); }

  function clearError() {
    otpRow.classList.remove('is-error');
    if (errorBox) errorBox.classList.remove('show', 'error');
  }

  function checkComplete() {
    var done = code().length === inputs.length;
    verifyBtn.disabled = !done;
    if (done) verify();
  }

  inputs.forEach(function (input, i) {
    input.addEventListener('input', function () {
      this.value = this.value.replace(/\D/g, '').slice(0, 1);
      this.classList.toggle('filled', this.value !== '');
      clearError();
      if (this.value && i < inputs.length - 1) inputs[i + 1].focus();
      checkComplete();
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace' && !this.value && i > 0) {
        inputs[i - 1].focus();
        inputs[i - 1].value = '';
        inputs[i - 1].classList.remove('filled');
        checkComplete();
      }
      if (e.key === 'ArrowLeft'  && i > 0) inputs[i - 1].focus();
      if (e.key === 'ArrowRight' && i < inputs.length - 1) inputs[i + 1].focus();
    });

    input.addEventListener('paste', function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      if (!text) return;
      inputs.forEach(function (inp, k) {
        inp.value = text[k] || '';
        inp.classList.toggle('filled', inp.value !== '');
      });
      inputs[Math.min(text.length, inputs.length - 1)].focus();
      clearError();
      checkComplete();
    });

    input.addEventListener('focus', function () { this.select(); });
  });

  // 輸滿即自動送出；按鈕保留手動點擊路徑（例如輸錯後同一組碼想重送一次）。
  // 若頁面本身要接管送出按鈕（例如同一顆按鈕依模式切換要驗證 OTP 還是備用碼，
  // 見 F1-2FA驗證頁-提案.html 的簡訊/備用碼雙模式），傳 autoBindVerifyClick:false
  // 停用這裡的自動綁定，改由頁面自己呼叫回傳的 verify()
  if (opts.autoBindVerifyClick !== false) {
    verifyBtn.addEventListener('click', function () {
      if (!verifyBtn.disabled) verify();
    });
  }

  function verify() {
    otpRow.classList.add('is-loading');
    verifyBtn.disabled = true;
    if (verifyLabelEl) verifyLabelEl.innerHTML = '<span class="spinner"></span>';
    setTimeout(function () {
      otpRow.classList.remove('is-loading');
      if (verifyLabelEl) verifyLabelEl.textContent = verifyLabelDefault;
      if (checkCode(code())) { opts.onSuccess && opts.onSuccess(code()); return; }
      showError();
    }, 1200);
  }

  function showError() {
    attemptsLeft = Math.max(0, attemptsLeft - 1);
    otpRow.classList.remove('is-error');
    void otpRow.offsetWidth;   // 重新觸發抖動動畫
    otpRow.classList.add('is-error');

    if (attemptsLeft > 0) {
      if (errorBox) errorBox.classList.add('show', 'error');
      if (errorTextEl) errorTextEl.innerHTML = '驗證碼錯誤，還可以再嘗試 <b>' + attemptsLeft + '</b> 次';
      // 錯了就清空六格、游標回第一格（業界通例）。
      // 不清空的話舊碼還留著＝已經是「填滿」狀態，使用者一改其中一格就立刻重新送出，
      // 還沒改完就白白吃掉一次機會——這是 2026-08-01 實測抓到的。
      inputs.forEach(function (i) { i.value = ''; i.classList.remove('filled'); });
      verifyBtn.disabled = true;
      inputs[0].focus();
    } else {
      // 兩階鎖定：第 1 次 30 分自動解鎖，與帳密錯誤鎖定策略一致
      if (errorBox) errorBox.classList.add('show', 'error');
      if (errorTextEl) errorTextEl.innerHTML = '錯誤次數過多，請於 <b>30 分鐘</b>後再試';
      otpRow.classList.add('is-disabled');
      inputs.forEach(function (i) { i.disabled = true; });
      verifyBtn.disabled = true;
      clearInterval(resendTimer);
      resendRow.innerHTML = '';
      // 30 分鐘鎖定蓋過 3 分鐘的驗證碼有效時間——鎖定中不該讓有效時間倒數繼續跑，
      // 否則歸零會跳去「驗證已逾時」頁，蓋掉這裡的鎖定訊息
      clearInterval(timeoutTimer);
    }
  }

  /* ---- 重新發送：狀態區塊，同一格永遠只顯示一種內容 ----
     可重發／倒數中／已達上限，三態互斥，不併排、不疊加 */
  function renderResendRow(state, sec) {
    resendRow.classList.toggle('is-limit', state === 'limited');

    if (state === 'counting') {
      resendRow.innerHTML = '沒收到簡訊？<span class="countdown">' + sec + '</span> 秒後可重新發送';
      return;
    }
    if (state === 'ready') {
      resendRow.innerHTML =
        '沒收到簡訊？<button class="resend-btn" type="button" id="' + resendBtnId + '">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>' +
          '重新發送驗證碼</button>';
      document.getElementById(resendBtnId).addEventListener('click', function () {
        resendCount++;
        resendRow.innerHTML =
          '<span class="resend-sent">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' +
            '已重新發送</span>';
        setTimeout(function () {
          if (resendCount >= maxResends) renderResendRow('limited');
          else startCountdown(opts.resendSec || 60);
        }, 1600);
      });
      return;
    }
    if (state === 'limited') {
      resendRow.innerHTML =
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>' +
        '<span>今日簡訊次數已達上限，請明日再試，或聯絡客服協助</span>';
    }
  }

  function startCountdown(sec) {
    clearInterval(resendTimer);
    var left = sec;
    render();
    resendTimer = setInterval(function () {
      left--;
      if (left <= 0) {
        clearInterval(resendTimer);
        renderResendRow(resendCount >= maxResends ? 'limited' : 'ready');
      } else render();
    }, 1000);
    function render() { renderResendRow('counting', left); }
  }

  /* 有效時間倒數（交易代碼那行）：跟上面 resendTimer 是不同的計時器變數，
     互不干擾。歸零時直接呼叫 onTimeout，取代原本啞的一次性 setTimeout
     ——原本那個只在到期那一刻觸發，畫面上不會逐秒顯示，2026-08-04 前
     三頁都沒有可視倒數，只有這支檔案裡默默計時 */
  function renderValidity() { if (validityEl) validityEl.textContent = timeoutSecLeft; }

  function reset() {
    attemptsLeft = maxAttempts;
    resendCount = 0;
    inputs.forEach(function (i) { i.value = ''; i.disabled = false; i.classList.remove('filled'); });
    otpRow.classList.remove('is-error', 'is-loading', 'is-disabled');
    clearError();
    verifyBtn.disabled = true;
    if (verifyLabelEl) verifyLabelEl.textContent = verifyLabelDefault;
    clearInterval(resendTimer);
    clearInterval(timeoutTimer);
    if (opts.onTimeout && opts.timeoutMs) {
      timeoutSecLeft = Math.round(opts.timeoutMs / 1000);
      renderValidity();
      timeoutTimer = setInterval(function () {
        timeoutSecLeft--;
        if (timeoutSecLeft <= 0) { clearInterval(timeoutTimer); opts.onTimeout(); }
        else renderValidity();
      }, 1000);
    }
    inputs[0].focus();
  }

  function stopTimeout() { clearInterval(timeoutTimer); }

  return {
    reset: reset,
    verify: verify,              // autoBindVerifyClick:false 時，頁面自己呼叫這個送出
    startCountdown: startCountdown,
    renderResendRow: renderResendRow,
    showError: showError,       // 給 demo 狀態列直接觸發錯誤展示
    stopTimeout: stopTimeout,
    code: code,
    focus: function () { inputs[0].focus(); },
    fillDemo: function (digits) {   // 給 demo 狀態列快速填格子用
      inputs.forEach(function (i, k) { i.value = digits[k] || ''; i.classList.toggle('filled', !!digits[k]); });
    },
    stopResendTimer: function () { clearInterval(resendTimer); },   // demo 直接設定 resendRow 狀態前要先停掉倒數，否則下一秒被蓋回去
    getAttemptsLeft: function ()  { return attemptsLeft; },
    setAttemptsLeft: function (n) { attemptsLeft = n; },
    getResendCount: function ()  { return resendCount; },
    setResendCount: function (n) { resendCount = n; }
  };
}
