/* Compila app.jsx → app.build.js con el mismo preset que usaba Babel en el navegador (react, clásico).
   Así el teléfono ya no descarga Babel (~3 MB) ni compila 1.8 MB de JSX en cada apertura. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const babel = require('@babel/core');
const raiz = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(raiz, 'app.jsx'), 'utf8');
const out = babel.transformSync(src, { presets: [[require.resolve('@babel/preset-react'), { runtime: 'classic' }]], filename: 'app.jsx', babelrc: false, configFile: false, compact: true, comments: false, minified: true });
const v = crypto.createHash('sha1').update(src).digest('hex').slice(0, 12);
fs.writeFileSync(path.join(raiz, 'app.build.js'), '/* Generado desde app.jsx (' + v + '). No editar: se regenera solo. */\n' + out.code);
fs.writeFileSync(path.join(raiz, 'app.build.v'), v + '\n');
console.log('app.build.js', v, Math.round(out.code.length / 1024) + ' KB');
