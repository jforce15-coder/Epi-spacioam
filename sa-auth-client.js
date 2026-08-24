/* Spacio AM · Cliente de auth unificado — EPI
   Hoja «Control de usuarios» (una sola para las 4 apps).
   Cárgalo en index.html DESPUÉS de React/ReactDOM y ANTES de app.js:
       <script src="sa-auth-client.js"></script>
   Ya viene configurado con el endpoint de control de usuarios.               */
(function (global) {
  var CFG = {
    url:   'https://script.google.com/macros/s/AKfycbxfdwLzsA8bwgOxUTOtf3Hw1ptIm8Cy34tspmFndu3WtRrkVSSnGyBP7obRrm73mcUd/exec',
    token: 'SpacioAM2026!'
  };

  function call(action, payload) {
    var body = Object.assign({ action: action, token: CFG.token }, payload || {});
    // text/plain evita el preflight CORS de Apps Script
    return fetch(CFG.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); })
      .catch(function (e) { return { ok: false, error: String(e) }; });
  }

  var SAAuth = {
    configure: function (url, token) { CFG.url = url; if (token) CFG.token = token; },
    login:              function (email, password) { return call('login', { email: email, password: password }); },
    setInitialPassword: function (email, next)     { return call('setInitialPassword', { email: email, next: next }); },
    profile:            function (email)           { return call('profile', { email: email }); },
    setPassword:        function (email, cur, next){ return call('setPassword', { email: email, current: cur, next: next }); },
    setEmail:           function (email, next)     { return call('setEmail', { email: email, next: next }); },
    setPhoto:           function (email, url)      { return call('setPhoto', { email: email, url: url }); },
    roleFor:            function (profile, appKey) { return (profile && profile.apps && profile.apps[appKey]) || null; }
  };

  global.SAAuth = SAAuth;
})(window);
