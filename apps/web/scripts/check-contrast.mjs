// index.css のトークンから WCAG AA コントラストを機械検証する
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse, wcagContrast } from 'culori';

const css = readFileSync(fileURLToPath(new URL('../src/index.css', import.meta.url)), 'utf8');

function extractVars(selector) {
  const re = new RegExp(`${selector}\\s*\\{([^}]*)\\}`);
  const body = css.match(re)?.[1] ?? '';
  const vars = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

const themes = { light: extractVars(':root'), dark: extractVars('\\.dark') };
// [前景, 背景, 最低比] — 本文・ボタン文字はすべて AA (4.5)
const pairs = [
  ['foreground', 'background', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['card-foreground', 'card', 4.5],
  ['muted-foreground', 'card', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['secondary-foreground', 'secondary', 4.5],
  ['accent-foreground', 'accent', 4.5],
  ['destructive-foreground', 'destructive', 4.5],
  ['destructive', 'background', 4.5],
  ['destructive', 'card', 4.5],
  ['primary', 'background', 4.5],
];

let failed = false;
for (const [name, vars] of Object.entries(themes)) {
  for (const [fg, bg, min] of pairs) {
    const f = parse(vars[fg]);
    const b = parse(vars[bg]);
    if (!f || !b) {
      console.error(`${name}: --${fg} / --${bg} をパースできません`);
      failed = true;
      continue;
    }
    const ratio = wcagContrast(f, b);
    const ok = ratio >= min;
    if (!ok) failed = true;
    console.log(`${ok ? 'ok  ' : 'FAIL'} [${name}] ${fg} on ${bg}: ${ratio.toFixed(2)} (>= ${min})`);
  }
}
process.exit(failed ? 1 : 0);
