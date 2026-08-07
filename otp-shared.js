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
       maxAttempts: 5,        // 選填，預設 5（輸錯幾次鎖定）
       checkCode: function (code) { return true; },   // 選填，預設一律成功
       onSuccess: function (code) { ... },
       // 有效時間／重發冷卻不用傳，取下方 OTP_VALIDITY_SEC／OTP_RESEND_SEC
       // （2026-08-06 前是逐頁傳 timeoutMs，已改成統一設定）
       validityEl: document.getElementById('validitySec'),  // 選填，逐秒顯示剩餘秒數
       validityWrap: document.getElementById('validityWrap')// 選填，過期時掛 .is-expired
                     // 讓「有效時間 NNN 秒」整段換成「驗證碼已失效，請重新發送」
     });
     otp.reset();               // 進到這一步時呼叫，重置輸入/倒數/逾時計時/有效時間
     otp.startCountdown(56);    // 開始重發倒數
   ============================================================ */

/* ============================================================
   ⚙️ 可調整設定（改這裡，三頁同步生效）
   ------------------------------------------------------------
   OTP_VALIDITY_SEC — 驗證碼有效時間。
     ⚠️ 接 SafeSay 之後這個值可能要調高：使用者得離開畫面去點簡訊連結、
        到 SafeSay 讀取代碼與驗證碼、再切回來輸入，光來回就會吃掉不少秒數。
        180 秒是沿用簡訊直接寄碼時代的數字，偏緊。要調就改這一個地方——
        三頁的畫面文字（「有效時間 NNN 秒」）也是從這裡填的，不用逐頁改。

   OTP_RESEND_SEC — 重新發送簡訊的冷卻秒數。

   OTP_MAX_ATTEMPTS — 驗證碼可以輸錯幾次才鎖定（2026-08-06 由 5 改為 3）。
     ⚠️ 這個數字**跟帳密錯誤的 5 次是分開的兩套**（登入頁的 MAX_LOGIN_ATTEMPTS），
        沿用公司其他產品的既有設計，刻意不對齊，不要「順手」改成一樣。
        兩者未來都可能改、或都收成後端 config，各自改各自的就好。
     ⚠️ 2026-08-06 更正：兩者**鎖定後的解法相同**，都是永久鎖、只能人工解鎖。
        （原本驗證碼寫「隔日才解」，Alvie 澄清現階段沒有這個選項，全部靠人工。）
        差別只剩次數：帳密 5 次、驗證碼 3 次。

   ⚠️ 忘記密碼頁的 OTP 主邏輯仍是自己一份實作（歷史因素），
      但它的 VALIDITY_SEC 與 MAX_OTP_ATTEMPTS 都已改成讀這裡，數字不會再分岔。
   ============================================================ */
var OTP_VALIDITY_SEC = 180;
var OTP_RESEND_SEC   = 60;
var OTP_MAX_ATTEMPTS = 3;

/* 「信任這個裝置」勾選後，同一裝置多久之內不再跳 2FA（2026-08-06 新增）。
   ⚠️ 30 天是我照業界常見值（Google、GitHub 都是這個量級）先填的，
      實際天數待 PM 確認。畫面上那句話的數字從這裡填，改這裡就好。 */
var TRUST_DEVICE_DAYS = 30;
/* ============================================================
   驗證代碼四選一（2026-08-05）
   ------------------------------------------------------------
   簡訊裡帶一組三碼英文代碼，畫面給四個候選讓使用者挑出收到的那一個。

   ⚠️ 畫面上不可再顯示正解——原本副標那句「交易代碼 ABC」必須一併拿掉，
      否則答案就寫在題目旁邊，這道防線等於沒有。三頁的副標統一成
      「已發送簡訊至 09xx****xxx，有效時間 NNN 秒。
        請點簡訊中的連結，於 SafeSay 取得代碼與驗證碼後填入：」
      （2026-08-06 接 SafeSay：代碼與驗證碼都改在 SafeSay 頁面上讀取，
        簡訊本身只帶連結）。

   原型的正解固定是 CORRECT_TX_CODE（跟六位數固定 123456 同一個道理），
   四個選項每次洗牌，避免變成「永遠選第一個」就會過。

   用法：
     var otp;
     var choice = initCodeChoice({
       row: document.getElementById('codeChoiceRow'),
       onChange: function () { otp && otp.recheck(); }   // 選了碼要重新判斷能否送出
     });
     otp = initOtpVerifier({ ..., codeChoice: choice });
   ============================================================ */
var CORRECT_TX_CODE = 'ABC';
var TX_CODE_DECOYS  = ['KMP', 'XQT', 'RDV'];

function initCodeChoice(opts) {
  var row     = opts.row;
  var correct = opts.correct || CORRECT_TX_CODE;
  var decoys  = opts.decoys  || TX_CODE_DECOYS;
  var selected = null;

  function render() {
    var pool = [correct].concat(decoys);
    // Fisher–Yates 洗牌：正解落在第幾格每次都不同
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    row.innerHTML = '';
    pool.forEach(function (text) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'code-choice';
      b.textContent = text;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.addEventListener('click', function () { select(text); });
      row.appendChild(b);
    });
  }

  function select(text) {
    selected = text;
    row.classList.remove('is-error');
    Array.prototype.forEach.call(row.children, function (b) {
      var on = b.textContent === text;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    opts.onChange && opts.onChange(text);
  }

  render();

  return {
    getSelected: function () { return selected; },
    isCorrect:   function () { return selected === correct; },
    reset: function () {
      selected = null;
      row.classList.remove('is-error', 'is-disabled', 'is-loading');
      render();
    },
    showError: function () {
      row.classList.remove('is-error');
      void row.offsetWidth;   // 重新觸發抖動動畫
      row.classList.add('is-error');
    },
    clearError: function () { row.classList.remove('is-error'); },
    /* 驗證失敗後清掉選取，但**不重新洗牌**：位置跟著跳會讓人以為選項換了一批。
       清掉是必要的——不清的話使用者只會一直重打六位數，
       若錯的其實是代碼，他會一路錯到鎖定都不知道要回頭看代碼 */
    clearSelection: function () {
      selected = null;
      Array.prototype.forEach.call(row.children, function (b) {
        b.classList.remove('is-selected');
        b.setAttribute('aria-checked', 'false');
      });
    },
    setDisabled: function (on) { row.classList.toggle('is-disabled', !!on); }
  };
}

function initOtpVerifier(opts) {
  var otpRow       = opts.otpRow;
  var inputs       = Array.prototype.slice.call(otpRow.querySelectorAll('input'));
  var verifyBtn    = opts.verifyBtn;
  var verifyLabelEl= opts.verifyLabelEl;
  var errorBox     = opts.errorBox;
  var errorTextEl  = opts.errorTextEl;
  var resendRow    = opts.resendRow;
  var validityEl   = opts.validityEl;
  var validityWrap = opts.validityWrap || null;   // 包住「有效時間 NNN 秒／已失效」那段的容器
  var maxAttempts  = opts.maxAttempts || OTP_MAX_ATTEMPTS;
  // 有效時間／重發冷卻一律取檔案上方的設定值，頁面不再各自傳一份
  // （原本三頁各寫 timeoutMs: 3*60*1000，要調整得改四個地方）
  var validitySec  = opts.validitySec || OTP_VALIDITY_SEC;
  var resendSec    = opts.resendSec   || OTP_RESEND_SEC;
  var checkCode    = opts.checkCode || function () { return true; };
  var codeChoice   = opts.codeChoice || null;   // 選填，接上「驗證代碼四選一」

  var attemptsLeft = maxAttempts;
  var resendTimer  = null;
  var timeoutTimer = null;
  var timeoutSecLeft = 0;   // 有效時間倒數用，跟 resendTimer 是各自獨立的計時器
  var expired = false;      // 有效時間已歸零：碼失效但畫面留在原地，等使用者重發
  var verifyLabelDefault = verifyLabelEl ? verifyLabelEl.textContent : '驗證';
  var resendBtnId  = 'resendBtn_' + Math.random().toString(36).slice(2, 8);

  function code() { return inputs.map(function (i) { return i.value; }).join(''); }

  function clearError() {
    otpRow.classList.remove('is-error');
    if (codeChoice) codeChoice.clearError();
    if (errorBox) errorBox.classList.remove('show', 'error');
  }

  /* 「可以送出」＝六格填滿 **且** 已選代碼（沒接四選一的頁面就只看六格）。
     兩件事哪個先完成都可以：選碼那邊會透過 onChange 回頭呼叫 recheck()。

     2026-08-05：這裡**只切換按鈕的可按狀態，不再自動送出**。
     原本填滿第六碼就直接驗證，但這頁是「四選一代碼＋六位數」雙重驗證——
     使用者可能還沒選代碼、或想再核對一次簡訊，就被搶先送出、白吃一次錯誤次數。
     改成他自己按「驗證」，兩件事都確認完再送。 */
  function checkComplete() {
    var done = code().length === inputs.length && (!codeChoice || !!codeChoice.getSelected());
    verifyBtn.disabled = !done;
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

  // 2026-08-05 起這是**唯一**的送出路徑（自動送出已移除，見 checkComplete）。
  // 若頁面本身要接管送出按鈕（例如同一顆按鈕要依模式切換驗證對象），
  // 傳 autoBindVerifyClick:false 停用這裡的自動綁定，改由頁面自己呼叫回傳的 verify()。
  // 目前三頁都沒有用到這個選項（備用碼模式移除後不再需要分流）
  if (opts.autoBindVerifyClick !== false) {
    verifyBtn.addEventListener('click', function () {
      if (!verifyBtn.disabled) verify();
    });
  }

  function verify() {
    otpRow.classList.add('is-loading');
    if (codeChoice) codeChoice.setDisabled(true);
    verifyBtn.disabled = true;
    if (verifyLabelEl) verifyLabelEl.innerHTML = '<span class="spinner"></span>';
    setTimeout(function () {
      otpRow.classList.remove('is-loading');
      if (codeChoice) codeChoice.setDisabled(false);
      if (verifyLabelEl) verifyLabelEl.textContent = verifyLabelDefault;
      // 代碼選錯、驗證碼打錯、碼已過期，一律視為同一件事：驗證失敗、吃掉一次機會。
      // 不分開講是哪個錯——分開講等於告訴攻擊者「代碼你猜對了」，
      // 把四選一好不容易加上的那道門又開回去。
      // 過期後即使打對也不給過：那組碼在真實系統裡已經不能用了
      var passed = !expired && checkCode(code()) && (!codeChoice || codeChoice.isCorrect());
      if (passed) { opts.onSuccess && opts.onSuccess(code()); return; }
      showError();
    }, 1200);
  }

  function showError() {
    attemptsLeft = Math.max(0, attemptsLeft - 1);
    otpRow.classList.remove('is-error');
    void otpRow.offsetWidth;   // 重新觸發抖動動畫
    otpRow.classList.add('is-error');
    if (codeChoice) codeChoice.showError();

    if (attemptsLeft > 0) {
      if (errorBox) errorBox.classList.add('show', 'error');
      if (errorTextEl) errorTextEl.innerHTML =
        '驗證碼錯誤，還可以再嘗試 <b>' + attemptsLeft + '</b> 次';
      // 錯了就清空六格、游標回第一格（業界通例）。
      // 不清空的話舊碼還留著＝已經是「填滿」狀態，使用者一改其中一格就立刻重新送出，
      // 還沒改完就白白吃掉一次機會——這是 2026-08-01 實測抓到的。
      inputs.forEach(function (i) { i.value = ''; i.classList.remove('filled'); });
      if (codeChoice) codeChoice.clearSelection();
      verifyBtn.disabled = true;
      inputs[0].focus();
    } else {
      lockNow();
    }
  }

  /* 進入鎖定狀態。從 showError() 錯滿時呼叫，也可以由頁面直接呼叫
     （例如使用者鎖定後**重新整理再進來**——那時沒有「剛剛錯了一次」這回事，
     不該播抖動動畫，畫面一載入就該是鎖著的）。

     2026-08-06：鎖定規則從「30 分鐘後自動解」改成**永久鎖、只能人工解鎖**
     （中途一度寫成「隔日才解」，Alvie 澄清現階段沒有這個選項，全部靠人工）。
     驗證碼錯代表使用者拿不到手機，等一段時間通常也解決不了，真正的出口就是人工協助。
     ⚠️ 畫面上不可出現任何「XX 後再試」的承諾——等到了還是進不去，比一開始就講清楚更糟。
     ⚠️ 解鎖窗口是客服還是業務，待 PM 確認（先預設客服） */
  function lockNow() {
    attemptsLeft = 0;
    if (errorBox) errorBox.classList.add('show', 'error');
    /* 「聯絡客服」做成行內連結（樣式見 auth-tokens.css 的 .msg a）：
       被鎖住的人唯一還能做的事就是找客服，那句話必須可以點 */
    if (errorTextEl) {
      errorTextEl.innerHTML = '錯誤次數過多，請<a href="#" class="js-support">聯絡客服</a>協助解鎖';
      var a = errorTextEl.querySelector('a');
      if (a) a.addEventListener('click', function (e) {
        e.preventDefault();
        opts.onSupport && opts.onSupport();
      });
    }
    otpRow.classList.add('is-disabled');
    inputs.forEach(function (i) { i.disabled = true; });
    if (codeChoice) codeChoice.setDisabled(true);
    verifyBtn.disabled = true;
    // 頁面自己還有東西要一起鎖（例如 2FA 頁的「信任這個裝置」勾選）就掛這個
    opts.onLock && opts.onLock();
    /* 重發整行清空＝**不可以再發簡訊**。這條在「鎖定後重整」的情境特別重要：
       若還留著可按的重發鈕，使用者每重整一次就能多送一則簡訊，等於開了一個燒錢的洞 */
    clearInterval(resendTimer);
    resendRow.innerHTML = '';
    // 鎖定蓋過 3 分鐘的驗證碼有效時間——鎖定中不該讓有效時間倒數繼續跑，
    // 否則歸零會把說明改成「已失效，請重新發送」，跟「請聯絡客服解鎖」互相打架
    clearInterval(timeoutTimer);
  }

  /* ---- 重新發送：狀態區塊，同一格永遠只顯示一種內容 ----
     倒數中／可重發，兩態互斥，不併排、不疊加。
     2026-08-05：拿掉第三態「今日簡訊次數已達上限」——每日發送次數上限這條
     規則已經取消，重發永遠可以再來一次。注意這跟「輸錯 5 次鎖定」是兩回事，
     那個在 showError() 裡，完整保留。 */
  function renderResendRow(state, sec) {
    if (state === 'counting') {
      resendRow.innerHTML = '沒收到簡訊？<span class="countdown">' + sec + '</span> 秒後可重新發送';
      return;
    }
    if (state === 'ready') {
      resendRow.innerHTML =
        '沒收到簡訊？<button class="resend-btn" type="button" id="' + resendBtnId + '">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>' +
          // 接 SafeSay 後發出去的是「一則帶連結的簡訊」，不是驗證碼本身，
          // 說明句已經改成「請點簡訊中的連結」，這顆鈕再講「重新發送驗證碼」會自相矛盾
          '重新發送簡訊</button>';
      document.getElementById(resendBtnId).addEventListener('click', function () {
        resendRow.innerHTML =
          '<span class="resend-sent">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' +
            '已重新發送</span>';
        // 重發＝拿到一組新碼：有效時間從頭跑、失效提示收掉、過期旗標解除
        startValidity();
        /* 重發過一次還是收不到，才給「聯絡客服」這條人工退路（2026-08-06）。
           第一次沒收到多半只是簡訊延遲，一開始就擺著客服只是雜訊；
           重發過仍無聲才是真的卡住。露出後就不再收回。 */
        if (opts.supportRow) opts.supportRow.hidden = false;
        setTimeout(function () { startCountdown(resendSec); }, 1600);
      });
      return;
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
        renderResendRow('ready');
      } else render();
    }, 1000);
    function render() { renderResendRow('counting', left); }
  }

  /* 有效時間倒數：跟上面 resendTimer 是不同的計時器變數，互不干擾。

     2026-08-05：歸零不再跳「驗證已逾時」獨立頁，改成就地提示——
     說明句那段換成「驗證碼已失效，請重新發送」，重發鈕立刻變可按，
     輸入框**不鎖**（使用者仍可打，只是打了一定失敗）。
     整頁跳走的成本太高：使用者已經填到一半，被丟到另一頁還要重走一次流程，
     而他要的其實只是「再給我一組碼」。 */
  function renderValidity() { if (validityEl) validityEl.textContent = timeoutSecLeft; }

  function setExpired(on) {
    expired = !!on;
    if (validityWrap) validityWrap.classList.toggle('is-expired', expired);
  }

  function startValidity() {
    clearInterval(timeoutTimer);
    setExpired(false);
    if (!validitySec) return;
    timeoutSecLeft = validitySec;
    renderValidity();
    timeoutTimer = setInterval(function () {
      timeoutSecLeft--;
      if (timeoutSecLeft <= 0) {
        clearInterval(timeoutTimer);
        setExpired(true);
        // 碼過期的當下就讓重發可按，不要求使用者再等重發倒數跑完
        clearInterval(resendTimer);
        renderResendRow('ready');
      } else renderValidity();
    }, 1000);
  }

  function reset() {
    attemptsLeft = maxAttempts;
    opts.onUnlock && opts.onUnlock();   // 跟 onLock 成對，把頁面自己鎖住的東西放開
    inputs.forEach(function (i) { i.value = ''; i.disabled = false; i.classList.remove('filled'); });
    otpRow.classList.remove('is-error', 'is-loading', 'is-disabled');
    if (codeChoice) codeChoice.reset();   // 重新洗牌：這是新的一輪，代碼本來就該換位置
    clearError();
    verifyBtn.disabled = true;
    if (verifyLabelEl) verifyLabelEl.textContent = verifyLabelDefault;
    clearInterval(resendTimer);
    startValidity();
    inputs[0].focus();
  }

  function stopTimeout() { clearInterval(timeoutTimer); }

  /* 畫面上「有效時間 NNN 秒」的初始數字由這裡填入，HTML 裡寫的只是佔位。
     這樣調整 OTP_VALIDITY_SEC 就不必再逐頁去改 HTML 的數字，
     也不會出現「設定改了、畫面初值還是舊的」這種分岔 */
  timeoutSecLeft = validitySec;
  renderValidity();

  return {
    reset: reset,
    verify: verify,              // autoBindVerifyClick:false 時，頁面自己呼叫這個送出
    recheck: checkComplete,      // 四選一那邊選了碼之後回頭呼叫，重新判斷能否送出
    startCountdown: startCountdown,
    renderResendRow: renderResendRow,
    showError: showError,       // 給 demo 狀態列直接觸發錯誤展示
    lock: lockNow,              // 直接進鎖定（鎖定後重新整理再進來的情境，不播抖動）
    stopTimeout: stopTimeout,
    code: code,
    focus: function () { inputs[0].focus(); },
    /* 選完代碼要把游標接過來時用這個，不要用 focus()：
       跳到第一個還沒填的格子，六格都填滿就**不搶焦點**——
       那時使用者接下來要按的是「驗證」，把他丟回第一格（還會整格選取）
       只會擋路，甚至可能誤刪已經打好的數字 */
    focusNextEmpty: function () {
      for (var i = 0; i < inputs.length; i++) {
        if (!inputs[i].value) { inputs[i].focus(); return; }
      }
    },
    fillDemo: function (digits) {   // 給 demo 狀態列快速填格子用
      inputs.forEach(function (i, k) { i.value = digits[k] || ''; i.classList.toggle('filled', !!digits[k]); });
    },
    stopResendTimer: function () { clearInterval(resendTimer); },   // demo 直接設定 resendRow 狀態前要先停掉倒數，否則下一秒被蓋回去
    getAttemptsLeft: function ()  { return attemptsLeft; },
    setAttemptsLeft: function (n) { attemptsLeft = n; },
    expire: function () {           // 給 demo 狀態列直接看「驗證碼已失效」，不用真的等 3 分鐘
      clearInterval(timeoutTimer);
      setExpired(true);
      clearInterval(resendTimer);
      renderResendRow('ready');
    }
  };
}
