// Génère la requête SQL de réinitialisation d'un mot de passe (mêmes paramètres que src/index.js :
// PBKDF2-SHA256, 100 000 itérations, sel de 16 octets, empreinte de 256 bits, base64url).
(function () {
  'use strict';
  var ITER = 100000;
  var USER_RE = /^[a-z0-9][a-z0-9_.-]{2,23}$/;
  var ENC = new TextEncoder();
  function $(s) { return document.querySelector(s); }
  function b64u(buf) {
    var a = new Uint8Array(buf), s = '';
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function derive(password, saltBytes) {
    var key = await crypto.subtle.importKey('raw', ENC.encode(password), 'PBKDF2', false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: ITER }, key, 256);
    return b64u(bits);
  }
  function fail(msg) { var e = $('#err'); e.textContent = msg; e.hidden = !msg; }

  $('#f').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    fail('');
    var user = $('#u').value.trim().toLowerCase(), pw = $('#p').value;
    if (!USER_RE.test(user)) { fail('Identifiant invalide (lettres minuscules, chiffres, point, tiret, tiret bas).'); return; }
    if (pw.length < 8 || pw.length > 200) { fail('Le mot de passe doit contenir entre 8 et 200 caractères.'); return; }
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var hash = await derive(pw, salt);
    // Seuls des caractères sûrs (base64url, identifiant validé) entrent dans la requête.
    var sql =
      "UPDATE users SET pw_hash = '" + hash + "', pw_salt = '" + b64u(salt) + "', pw_iter = " + ITER +
      " WHERE username = '" + user + "';\n" +
      "DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = '" + user + "');\n" +
      "DELETE FROM attempts WHERE key = 'u:" + user + "';";
    $('#sql').value = sql;
    $('#out').hidden = false;
  });

  $('#copy').addEventListener('click', async function () {
    var ta = $('#sql');
    try { await navigator.clipboard.writeText(ta.value); this.textContent = 'Copié'; }
    catch (e) { ta.focus(); ta.select(); this.textContent = 'Sélectionné : copiez avec Ctrl+C'; }
  });
})();
