/**
 * login.js — หน้าเข้าสู่ระบบ
 *
 * เขียนเป็นสคริปต์ธรรมดา (ไม่ใช่ ES module) เพราะหน้านี้ต้องเบาที่สุด
 * และไม่ควรพึ่ง i18n.js ซึ่งเป็นไฟล์ที่ต้องล็อกอินก่อนถึงจะโหลดได้
 *
 * รหัสผ่านถูกส่งไปตรวจที่ฝั่งเซิร์ฟเวอร์เท่านั้น เบราว์เซอร์ไม่เคยเห็น hash
 * และ session กลับมาเป็นคุกกี้ HttpOnly ซึ่ง JavaScript อ่านไม่ได้
 */
(function () {
  'use strict';

  var form = document.getElementById('login-form');
  var errorBox = document.getElementById('login-error');
  var submit = document.getElementById('login-submit');
  var label = document.getElementById('login-submit-label');
  var busy = false;

  /** หน้าที่ผู้ใช้ตั้งใจจะเข้าก่อนโดนเด้งมาล็อกอิน */
  function nextUrl() {
    var raw = new URLSearchParams(location.search).get('next');
    // รับเฉพาะ path ภายในเว็บนี้ กัน open redirect ไปเว็บอื่น
    if (!raw || raw.charAt(0) !== '/' || raw.charAt(1) === '/') return '/';
    return raw;
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function setBusy(on) {
    busy = on;
    submit.disabled = on;
    submit.classList.toggle('is-busy', on);
    label.textContent = on ? 'กำลังตรวจสอบ…' : 'เข้าสู่ระบบ';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;

    var username = document.getElementById('username').value.trim();
    var password = document.getElementById('password').value;
    if (!username || !password) return;

    errorBox.hidden = true;
    setBusy(true);

    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: username, password: password }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (r) {
        if (!r.ok) {
          setBusy(false);
          showError(r.data.error || 'เข้าสู่ระบบไม่สำเร็จ');
          document.getElementById('password').value = '';
          document.getElementById('password').focus();
          return;
        }
        // สำเร็จ — คุกกี้ถูกตั้งแล้ว ไปหน้าที่ตั้งใจจะเข้า
        location.replace(nextUrl());
      })
      .catch(function (err) {
        setBusy(false);
        showError('ติดต่อเซิร์ฟเวอร์ไม่ได้: ' + err.message);
      });
  });
})();
