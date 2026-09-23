import TurndownService from 'https://cdn.jsdelivr.net/npm/turndown@7.2.4/+esm';
import { gfm } from 'https://cdn.jsdelivr.net/npm/@joplin/turndown-plugin-gfm@1.0.68/+esm';

// mammoth is loaded as a classic script (window.mammoth).
const { mammoth } = window;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
turndown.use(gfm);

// Same conversion rules as the Docs to Markdown Actor.
function htmlToMarkdown(html) {
    const withHeaders = html.replace(/<table\b[^>]*>(?:(?!<\/table>)[\s\S])*?<\/table>/gi, (table) => {
        if (/<th[\s>]/i.test(table)) return table;
        return table.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/i, (row) => row.replace(/<(\/?)td\b/gi, '<$1th'));
    });
    return turndown.turndown(withHeaders)
        .replace(/^(\s*)([-*]|\d+\.)\s{2,}/gm, '$1$2 ')
        .replace(/!\[([^\]]*)\]\(\)/g, (m, alt) => (alt ? `*[image: ${alt}]*` : ''))
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

$('#file').addEventListener('change', async () => {
    const file = $('#file').files[0];
    const status = $('#status');
    const out = $('#result');
    if (!file) return;
    out.innerHTML = '';
    if (!/\.docx$/i.test(file.name)) {
        status.innerHTML = '<span class="error">Please choose a .docx file. For old .doc files, open them in Word and "Save as" .docx first.</span>';
        return;
    }
    status.textContent = `Converting ${file.name}…`;
    try {
        const { value: html } = await mammoth.convertToHtml(
            { arrayBuffer: await file.arrayBuffer() },
            { convertImage: mammoth.images.imgElement(async (img) => ({ src: '', alt: img.altText ?? '' })) },
        );
        const md = htmlToMarkdown(html);
        const words = md.split(/\s+/).filter(Boolean).length;
        out.innerHTML = `
          <div class="summary"><span class="pill good">${words.toLocaleString()} words</span><span class="pill muted">${md.length.toLocaleString()} characters</span></div>
          <div class="actions">
            <button type="button" id="copy">Copy Markdown</button>
            <button type="button" class="secondary" id="dl">Download .md</button>
          </div>
          <pre id="md" style="max-height:520px;overflow:auto;margin-top:14px">${esc(md)}</pre>`;
        status.textContent = '';
        $('#copy').addEventListener('click', async (e) => { await navigator.clipboard.writeText(md); e.target.textContent = 'Copied'; });
        $('#dl').addEventListener('click', () => {
            const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
            Object.assign(document.createElement('a'), { href: url, download: file.name.replace(/\.docx$/i, '.md') }).click();
            URL.revokeObjectURL(url);
        });
    } catch (err) {
        status.innerHTML = `<span class="error">Could not convert this file: ${esc(err.message)}</span>`;
    }
});
