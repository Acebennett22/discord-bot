// Audit: for each dashboard view, list bare top-level identifiers referenced
// in EJS tags that are NOT passed by every render() call for that view.
// A reference is SAFE if: it is passed by every render of its view, OR it
// is set on res.locals (applies to every render), OR the template guards it
// with `typeof X !== 'undefined'` (the header-partial pattern).
// Heuristic: strip string literals, drop identifiers preceded by '.', drop
// JS keywords/globals and identifiers declared in the template itself
// (forEach/for/of callbacks, let/const). Run: node tmp/audit-template-locals.js
const fs = require('fs');
const path = require('path');

const VIEWS = path.join(__dirname, '..', 'dashboard', 'views');
const DASH = path.join(__dirname, '..', 'src', 'dashboard.js');
const src = fs.readFileSync(DASH, 'utf8');

// Names defaulted on res.locals for every request (1.15.9: authExpired).
const resLocalsDefaults = new Set([...src.matchAll(/res\.locals\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]));

const KEYWORDS = new Set(('break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let of await async get set static from as').split(' '));
const GLOBALS = new Set(['Array', 'Object', 'String', 'Number', 'Boolean', 'Date', 'Math', 'JSON', 'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent', 'isNaN', 'isFinite', 'undefined', 'console', 'require', 'module', 'exports', '__dirname', '__filename', 'Buffer', 'Error', 'RegExp', 'Map', 'Set', 'Promise', 'include']);

// locals keys passed by each res.render('view', {...}) — object literal keys only
function renderLocals(view) {
  const out = [];
  const re = new RegExp(`res\\.render\\('${view}',\\s*\\{`, 'g');
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex, depth = 1, body = '';
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '{') depth++;
      if (c === '}') depth--;
      if (depth > 0) body += c;
      i++;
    }
    // top-level keys: identifier followed by ':' or shorthand at depth 0 of body
    const keys = new Set();
    let d = 0, cur = '';
    const flush = (tok) => { if (tok) keys.add(tok); };
    for (let j = 0; j < body.length; j++) {
      const c = body[j];
      if (c === '{' || c === '[' || c === '(') d++;
      if (c === '}' || c === ']' || c === ')') d--;
      if (d === 0 && /[A-Za-z0-9_$]/.test(c)) cur += c;
      else if (d === 0) {
        if (cur && body[j] === ':') flush(cur);
        else if (cur && (c === ',' || c === '}')) flush(cur);
        cur = '';
      }
    }
    // also capture shorthand keys (identifier at depth 0 followed by , or })
    out.push(keys);
  }
  return out;
}

function templateRefs(file) {
  const text = fs.readFileSync(file, 'utf8');
  const tags = [...text.matchAll(/<%[-=_]?([\s\S]*?)%>/g)].map((m) => m[1]);
  const declared = new Set();
  const guarded = new Set([...text.matchAll(/typeof\s+([A-Za-z_$][\w$]*)\s*!==?\s*'undefined'/g)].map((m) => m[1]));
  const refs = new Set();
  for (const tag of tags) {
    // identifiers declared by forEach/for/of/let/const/function params
    for (const dm of tag.matchAll(/\b(?:forEach|for|map|filter|find|sort|reduce)\s*\(\s*(?:function\s*)?\(?\s*([A-Za-z_$][\w$]*)/g)) declared.add(dm[1]);
    // destructured params: .forEach(([a, b]) => ...), .map(({ x, y }) => ...)
    for (const dm of tag.matchAll(/\(\s*[\[{]([^\]}]*)[\]}]/g)) for (const id of dm[1].matchAll(/([A-Za-z_$][\w$]*)/g)) declared.add(id[1]);
    for (const dm of tag.matchAll(/\b(?:let|const|var)\s+([A-Za-z_$][\w$]*)/g)) declared.add(dm[1]);
    for (const dm of tag.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\b/g)) declared.add(dm[1]);
    // strip string literals
    const code = tag.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
    for (const im of code.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)/g)) {
      const name = im[2];
      // object-literal key (e.g. `{ level: ... }`) — not a variable reference
      const after = code[im.index + im[0].length];
      if (after === ':') continue;
      if (!KEYWORDS.has(name) && !GLOBALS.has(name)) refs.add(name);
    }
  }
  for (const d of declared) refs.delete(d);
  for (const g of guarded) refs.delete(g);
  return refs;
}

let problems = 0;
for (const file of fs.readdirSync(VIEWS).filter((f) => f.endsWith('.ejs'))) {
  const view = file.replace('.ejs', '');
  const refs = templateRefs(path.join(VIEWS, file));
  const renders = renderLocals(view);
  if (!renders.length) { console.log(`${view}: no res.render calls found`); continue; }
  // names every render provides (intersection) — a ref missing from ANY render is a gap,
  // unless res.locals defaults it for every request
  for (const ref of [...refs].sort()) {
    if (resLocalsDefaults.has(ref)) continue;
    const missingFrom = renders.map((keys, i) => (keys.has(ref) ? null : i)).filter((x) => x !== null);
    if (missingFrom.length) {
      console.log(`${view}: '${ref}' NOT passed by render call(s) #${missingFrom.map((i) => i + 1).join(',')} of ${renders.length}`);
      problems++;
    }
  }
}
console.log(problems ? `\n${problems} gap(s)` : '\nOK: every bare template reference is passed by every render of its view');
