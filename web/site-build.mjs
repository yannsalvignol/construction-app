#!/usr/bin/env node
// Builds the legal/support pages at casprod.app from docs/legal/*.md into
// web/site/. The landing page (web/site/index.html + landing.css/js) is
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
const OUT = path.join(ROOT, 'web/site');

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
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
<link rel="icon" href="/img/logo.png" type="image/png">
</head>
<body>
<header><a class="brand" href="/"><img src="/img/logo.png" alt="">CASPROD</a><nav>${nav}</nav></header>
<main>
${body}
</main>
<footer>© ${new Date().getFullYear()} CASPROD · <a href="mailto:contact@casprod.app">contact@casprod.app</a></footer>
</body>
</html>
`;
}

const STYLE = `:root{color-scheme:dark;--bg:#07080a;--fg:#e8eaee;--fg2:#b7bcc6;--muted:#6f7683;--line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.14);--signal:#cfd8ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg2);font:16px/1.65 "Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 28px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:13px;letter-spacing:.18em;color:var(--fg);text-decoration:none}
.brand img{width:22px;height:22px;border-radius:5px;box-shadow:0 0 0 1px var(--line2)}
nav{display:flex;gap:22px;font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase}nav a{color:var(--muted);text-decoration:none}nav a:hover{color:var(--fg)}nav a[aria-current]{color:var(--fg)}
main{max-width:720px;margin:0 auto;padding:56px 28px 96px}
h1{font-size:34px;line-height:1.1;margin:0 0 10px;color:var(--fg);font-weight:500;letter-spacing:-.025em}h2{font-size:20px;margin:44px 0 10px;color:var(--fg);font-weight:500;letter-spacing:-.02em}h3{font-size:16px;margin:24px 0 4px;color:var(--fg);font-weight:500}
p{margin:0 0 14px}.meta{color:var(--muted);font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:28px}
a{color:var(--signal)}strong{font-weight:500;color:var(--fg)}code{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:.85em;background:rgba(255,255,255,.06);padding:1px 5px}
ul{padding-left:20px;margin:0 0 14px}li{margin-bottom:6px}
blockquote{margin:0 0 14px;padding:10px 16px;border-left:1px solid var(--line2);color:var(--muted)}
.table{overflow-x:auto;margin:0 0 14px}table{border-collapse:collapse;width:100%;font-size:14.5px}
th,td{text-align:left;padding:10px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:500;font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase}
footer{text-align:center;color:var(--muted);font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:28px 20px 44px;border-top:1px solid var(--line)}footer a{color:var(--muted)}
`;



// web/site/index.html (the landing page) is hand-written and not generated here.

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'style.css'), STYLE);
for (const { slug, file } of PAGES) {
  const { title, body } = render(await readFile(path.join(SOURCE, file), 'utf8'));
  await mkdir(path.join(OUT, slug), { recursive: true });
  await writeFile(path.join(OUT, slug, 'index.html'), page({ title, body, slug }));
  console.log(`web/site/${slug}/index.html ← docs/legal/${file}`);
}
