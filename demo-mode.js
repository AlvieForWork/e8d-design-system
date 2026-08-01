/* ============================================================
   demo 狀態列的可見性開關（2026-08-01）
   ------------------------------------------------------------
   驗證碼、帳密都改成「輸對才過、輸錯看到錯誤、錯到底進鎖定」之後，
   多數錯誤狀態 PM 自己操作就能碰到，狀態列不必再擺在畫面上。
   但「帳號權限已關閉」「此號碼非母帳號」「逾時」這類狀態靠亂輸入
   觸發不到，狀態列的邏輯與畫面**全部保留**，只是預設收起來。

   用法：網址加 ?demo=1 打開、?demo=0 關掉。
   開關記在 sessionStorage，所以只要進場那一頁帶過參數，
   同一個分頁往下走整條流程都看得到，不用每頁重貼。
   （sessionStorage 只活在這個分頁，關掉視窗就沒了——
     PM 拿到的乾淨網址永遠不會誤觸。）
   ============================================================ */
(function () {
  var KEY = 'e8d-demo-bar';
  var param = new URLSearchParams(location.search).get('demo');

  if (param === '1') sessionStorage.setItem(KEY, '1');
  if (param === '0') sessionStorage.removeItem(KEY);

  if (sessionStorage.getItem(KEY) === '1') {
    document.documentElement.classList.add('demo-on');
  }
})();
