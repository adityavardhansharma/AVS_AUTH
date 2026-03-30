import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, basename } from "path";

const CONTENT_DIR = join(import.meta.dirname, "content");
const DIST_DIR = join(import.meta.dirname, "dist");

const pages = [
  { file: "introduction.md", title: "Introduction", slug: "index" },
  { file: "getting-started-react.md", title: "Getting Started (React)", slug: "getting-started-react" },
  { file: "getting-started-vanilla.md", title: "Getting Started (Vanilla JS)", slug: "getting-started-vanilla" },
  { file: "how-it-works.md", title: "How It Works", slug: "how-it-works" },
  { file: "server-verification.md", title: "Server Verification", slug: "server-verification" },
  { file: "convex-integration.md", title: "Convex Integration", slug: "convex-integration" },
  { file: "api-reference.md", title: "API Reference", slug: "api-reference" }
];

function markdownToHtml(md) {
  return md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code class="lang-${lang || "text"}">${code.replace(/</g, "&lt;").replace(/>/g, "&gt;").trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/^\- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/^(?!<[huplo])((?!^\s*$).+)$/gm, "<p>$1</p>")
    .replace(/\n{2,}/g, "\n");
}

function buildPage(page, navHtml) {
  const md = readFileSync(join(CONTENT_DIR, page.file), "utf-8");
  const content = markdownToHtml(md);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${page.title} - AVS AUTH Docs</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#f6f0e5;color:#1a1714;margin:0;line-height:1.7}
.layout{display:flex;min-height:100vh}
nav{width:260px;background:#fffdf8;border-right:1px solid rgba(23,20,17,0.1);padding:24px;position:sticky;top:0;height:100vh;overflow-y:auto}
nav h2{font-size:1rem;margin:0 0 16px;color:#0e6b59}
nav a{display:block;padding:6px 12px;border-radius:8px;color:#444;text-decoration:none;font-size:0.9rem;margin-bottom:2px}
nav a:hover,nav a.active{background:rgba(14,107,89,0.08);color:#0e6b59}
main{flex:1;max-width:780px;padding:48px 40px}
h1{font-size:1.8rem;margin:0 0 16px;font-weight:700}
h2{font-size:1.3rem;margin:32px 0 12px;font-weight:600;color:#0e6b59}
h3{font-size:1.1rem;margin:24px 0 8px;font-weight:600}
code{background:rgba(23,20,17,0.06);padding:2px 8px;border-radius:6px;font-size:0.9em;font-family:'SF Mono',Consolas,monospace}
pre{background:#1a1714;color:#e8e4de;padding:20px;border-radius:12px;overflow-x:auto;margin:16px 0}
pre code{background:none;padding:0;color:inherit;font-size:0.85em}
ul{padding-left:24px;margin:8px 0}
li{margin:4px 0}
p{margin:8px 0}
@media(max-width:768px){.layout{flex-direction:column}nav{width:100%;height:auto;position:static;border-right:none;border-bottom:1px solid rgba(23,20,17,0.1)}}
</style>
</head>
<body>
<div class="layout">
<nav>
<h2>AVS AUTH Docs</h2>
${navHtml}
<hr style="border:none;border-top:1px solid rgba(23,20,17,0.08);margin:16px 0"/>
<a href="https://auth.adityavs.tech">Broker</a>
</nav>
<main>${content}</main>
</div>
</body>
</html>`;
}

mkdirSync(DIST_DIR, { recursive: true });

const navHtml = pages
  .map((p) => `<a href="${p.slug === "index" ? "/" : `/${p.slug}.html`}">${p.title}</a>`)
  .join("\n");

for (const page of pages) {
  const html = buildPage(page, navHtml);
  const filename = page.slug === "index" ? "index.html" : `${page.slug}.html`;
  writeFileSync(join(DIST_DIR, filename), html);
}

console.log(`Built ${pages.length} documentation pages to ${DIST_DIR}`);
