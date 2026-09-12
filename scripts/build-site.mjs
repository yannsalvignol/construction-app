#!/usr/bin/env node
// Builds the legal/support pages at casprod.app from docs/legal/*.md into
// website/. The landing page (website/index.html + landing.css/js) is
// hand-written and left untouched.
//
// The Markdown in docs/legal is the source of truth (it is what gets reviewed
// and edited); this script renders it into plain static HTML that Cloudflare
// Pages serves as-is, so no framework and no dependency. The subset of
// Markdown supported is exactly what those files use: headings, paragraphs,
// bold, inline code, links, bullet lists, tables and blockquotes.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SOURCE = path.join(ROOT, 'docs/legal');
const OUT = path.join(ROOT, 'website');

const PAGES = [
  { slug: 'privacy', file: 'privacy-policy.md' },
  { slug: 'terms', file: 'terms.md' },
  { slug: 'support', file: 'support.md' },
];

function escape(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(text) {
  return escape(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function render(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  let title = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const heading = line.match(/^(#{1,3}) (.+)$/);
    if (heading) {
      const level = heading[1].length;
      if (level === 1 && !title) title = heading[2];
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++; continue;
    }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (row) => row.slice(1, -1).split('|').map((c) => inline(c.trim()));
      const [head, , ...body] = rows;
      out.push('<div class="table"><table><thead><tr>' + cells(head).map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + cells(r).map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    if (line.startsWith('- ')) {
      const items = [];
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('  '))) {
        if (lines[i].startsWith('- ')) items.push(lines[i].slice(2));
        else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      out.push('<ul>' + items.map((t) => `<li>${inline(t)}</li>`).join('') + '</ul>');
      continue;
    }
    if (line.startsWith('> ')) {
      const quote = [];
      while (i < lines.length && lines[i].startsWith('> ')) quote.push(lines[i++].slice(2));
      out.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||- |> )/.test(lines[i])) para.push(lines[i++].trim());
    const text = para.join(' ');
    out.push(/^\*.+\*$/.test(text) ? `<p class="meta">${inline(text.slice(1, -1))}</p>` : `<p>${inline(text)}</p>`);
  }
  return { title, body: out.join('\n') };
}

function page({ title, body, slug }) {
  const nav = PAGES.map((p) => `<a href="/${p.slug}"${p.slug === slug ? ' aria-current="page"' : ''}>${{ privacy: 'Confidentialité', terms: 'Conditions', support: 'Assistance' }[p.slug]}</a>`).join('');
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(title)} de l’application CASPROD.">
<link rel="stylesheet" href="/style.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
<header><a class="brand" href="/">CASPROD</a><nav>${nav}</nav></header>
<main>
${body}
</main>
<footer>© ${new Date().getFullYear()} CASPROD · <a href="mailto:contact@casprod.app">contact@casprod.app</a></footer>
</body>
</html>
`;
}

const STYLE = `:root{color-scheme:light dark;--bg:#faf8ff;--fg:#1c1730;--muted:#5b5570;--accent:#7238ce;--line:#e5e0f2;--card:#fff}
@media(prefers-color-scheme:dark){:root{--bg:#14111f;--fg:#ece8f7;--muted:#a59fbf;--accent:#b18cf0;--line:#2c2740;--card:#1c1829}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 20px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.brand{font-weight:800;letter-spacing:.04em;color:var(--fg);text-decoration:none;font-size:18px}
nav{display:flex;gap:16px}nav a{color:var(--muted);text-decoration:none}nav a[aria-current]{color:var(--accent);font-weight:600}
main{max-width:720px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:28px;line-height:1.25;margin:0 0 8px}h2{font-size:20px;margin:36px 0 8px}h3{font-size:17px;margin:24px 0 4px}
p{margin:0 0 14px}.meta{color:var(--muted);font-size:14px}
a{color:var(--accent)}strong{font-weight:600}code{font-size:.9em;background:var(--line);padding:1px 5px;border-radius:4px}
ul{padding-left:22px;margin:0 0 14px}li{margin-bottom:6px}
blockquote{margin:0 0 14px;padding:10px 14px;border-left:3px solid var(--accent);background:var(--card);color:var(--muted)}
.table{overflow-x:auto;margin:0 0 14px}table{border-collapse:collapse;width:100%;font-size:15px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600}
footer{text-align:center;color:var(--muted);font-size:14px;padding:24px 20px;border-top:1px solid var(--line)}
.home{display:grid;gap:12px;margin-top:24px}.home a{display:block;padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--card);text-decoration:none;color:var(--fg)}.home a span{display:block;color:var(--muted);font-size:14px}
`;

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#7238ce"/><rect x="14" y="26" width="36" height="12" rx="6" fill="#fff"/></svg>`;

// website/index.html (the landing page) is hand-written and not generated here.

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'style.css'), STYLE);
await writeFile(path.join(OUT, 'favicon.svg'), FAVICON);
for (const { slug, file } of PAGES) {
  const { title, body } = render(await readFile(path.join(SOURCE, file), 'utf8'));
  await mkdir(path.join(OUT, slug), { recursive: true });
  await writeFile(path.join(OUT, slug, 'index.html'), page({ title, body, slug }));
  console.log(`website/${slug}/index.html ← docs/legal/${file}`);
}
