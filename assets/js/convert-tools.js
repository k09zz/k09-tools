// Shared logic for the CSV / Excel / HTML to Markdown pages. The page sets <body data-mode="csv|excel|html">.
import { mdTable, parseCsv, tidy } from './markdown.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mode = document.body.dataset.mode;
let baseName = 'converted';

function show(md) {
    const out = $('#result');
    if (!md.trim()) {
        out.innerHTML = '<p class="error">Nothing to convert. Paste some content or choose a file.</p>';
        return;
    }
    out.innerHTML = `
      <div class="actions"><button type="button" id="copy">Copy Markdown</button><button type="button" class="secondary" id="dl">Download .md</button></div>
      <pre style="max-height:520px;overflow:auto;margin-top:14px">${esc(md)}</pre>`;
    $('#copy').addEventListener('click', async (e) => { await navigator.clipboard.writeText(md); e.target.textContent = 'Copied'; });
    $('#dl').addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
        Object.assign(document.createElement('a'), { href: url, download: `${baseName}.md` }).click();
        URL.revokeObjectURL(url);
    });
}

// ---------- CSV ----------
const csvToMd = (text) => mdTable(parseCsv(text.replace(/^﻿/, '')));

// ---------- HTML (same rules as the Docs to Markdown Actor) ----------
let turndown;
async function htmlToMd(html) {
    if (!turndown) {
        const [{ default: TurndownService }, { gfm }] = await Promise.all([
            import('https://cdn.jsdelivr.net/npm/turndown@7.2.4/+esm'),
            import('https://cdn.jsdelivr.net/npm/@joplin/turndown-plugin-gfm@1.0.68/+esm'),
        ]);
        turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
        turndown.use(gfm);
        turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 'template', 'head', 'title', 'nav', 'footer']);
    }
    const withHeaders = html.replace(/<table\b[^>]*>(?:(?!<\/table>)[\s\S])*?<\/table>/gi, (table) => {
        if (/<th[\s>]/i.test(table)) return table;
        return table.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/i, (row) => row.replace(/<(\/?)td\b/gi, '<$1th'));
    });
    return tidy(turndown.turndown(withHeaders).replace(/^(\s*)([-*]|\d+\.)\s{2,}/gm, '$1$2 '));
}

// ---------- Excel (same rules as the Docs to Markdown Actor) ----------
function cellText(value) {
    if (value == null) return '';
    if (value instanceof Date) return value.toISOString().replace('T00:00:00.000Z', '');
    if (typeof value === 'object') {
        if ('result' in value) return cellText(value.result);
        if ('richText' in value) return value.richText.map((r) => r.text).join('');
        if ('text' in value) return String(value.text);
        if ('error' in value) return String(value.error);
        return '';
    }
    return String(value);
}

async function excelToMd(buffer) {
    const wb = new window.ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const parts = [];
    wb.eachSheet((sheet) => {
        if (sheet.state && sheet.state !== 'visible') return;
        const rows = [];
        sheet.eachRow({ includeEmpty: false }, (row) => {
            const values = [];
            for (let c = 1; c <= sheet.columnCount; c++) values.push(cellText(row.getCell(c).value));
            rows.push(values);
        });
        const width = Math.max(0, ...rows.map((r) => r.length));
        const keep = [...Array(width).keys()].filter((c) => rows.some((r) => (r[c] ?? '').trim() !== ''));
        const trimmed = rows.map((r) => keep.map((c) => r[c] ?? '')).filter((r) => r.some((v) => v.trim() !== ''));
        parts.push(`## ${sheet.name}\n\n${trimmed.length ? mdTable(trimmed) : '*(empty sheet)*'}`);
    });
    return tidy(parts.join('\n\n'));
}

async function run(source) {
    const status = $('#status');
    status.textContent = 'Converting…';
    try {
        let md;
        if (mode === 'excel') md = await excelToMd(source);
        else if (mode === 'html') md = await htmlToMd(source);
        else md = csvToMd(source);
        show(md);
        status.textContent = '';
    } catch (err) {
        status.innerHTML = `<span class="error">Could not convert: ${esc(err.message)}</span>`;
    }
}

$('#file')?.addEventListener('change', async () => {
    const file = $('#file').files[0];
    if (!file) return;
    baseName = file.name.replace(/\.[^.]+$/, '');
    if (mode === 'excel') {
        if (!/\.xlsx$|\.xlsm$/i.test(file.name)) {
            $('#status').innerHTML = '<span class="error">Please choose an .xlsx file. For old .xls files, open them in Excel and "Save as" .xlsx.</span>';
            return;
        }
        run(await file.arrayBuffer());
    } else {
        const text = await file.text();
        if ($('#input')) $('#input').value = text;
        run(text);
    }
});
$('#convert')?.addEventListener('click', () => run($('#input').value));
