import { GlobalWorkerOptions, getDocument } from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.min.mjs';
import { buildLines, detectTables, linesToText, toCsv, toItems } from './pdf-layout.js';

GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.min.mjs';

const FREE_PAGES = 20;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const download = (name, text, type) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    URL.revokeObjectURL(url);
};

function tableHtml(rows) {
    const [head, ...body] = rows;
    return `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

async function convert(file) {
    const status = $('#status');
    const out = $('#result');
    out.innerHTML = '';
    status.textContent = `Reading ${file.name}…`;
    const doc = await getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    const pages = Math.min(doc.numPages, FREE_PAGES);
    const allTables = [];
    const texts = [];
    for (let n = 1; n <= pages; n++) {
        status.textContent = `Processing page ${n} of ${pages}…`;
        const page = await doc.getPage(n);
        const lines = buildLines(toItems((await page.getTextContent()).items));
        const tables = detectTables(lines);
        texts.push(`--- Page ${n} ---\n${linesToText(lines, tables)}`);
        tables.forEach((t, k) => allTables.push({ page: n, index: k + 1, rows: t.rows }));
        page.cleanup();
    }
    const base = file.name.replace(/\.pdf$/i, '');
    const text = texts.join('\n\n');
    const emptyText = !text.replace(/--- Page \d+ ---/g, '').trim();

    out.innerHTML = `
      <div class="summary">
        <span class="pill good">${pages} page(s) read</span>
        <span class="pill ${allTables.length ? 'good' : 'muted'}">${allTables.length} table(s) found</span>
        ${doc.numPages > FREE_PAGES ? `<span class="hint">Only the first ${FREE_PAGES} of ${doc.numPages} pages. <a href="https://apify.com/k09/pdf-text-tables">Process the whole file on Apify</a>.</span>` : ''}
      </div>
      ${emptyText ? '<p class="error">No text layer found. This looks like a scanned PDF, which needs OCR.</p>' : ''}
      <div class="actions">
        <button type="button" id="dl-txt">Download text (.txt)</button>
        ${allTables.length ? '<button type="button" class="secondary" id="dl-all">Download all tables (.csv)</button>' : ''}
      </div>
      ${allTables.map((t, i) => `<h3>Table ${i + 1} (page ${t.page}) <button type="button" class="secondary" data-t="${i}" style="padding:4px 10px;font-size:13px">CSV</button></h3>${tableHtml(t.rows)}`).join('')}
      <h3>Text</h3><pre style="max-height:420px;overflow:auto">${esc(text)}</pre>`;
    status.textContent = '';

    $('#dl-txt').addEventListener('click', () => download(`${base}.txt`, text, 'text/plain'));
    $('#dl-all')?.addEventListener('click', () => download(`${base}-tables.csv`,
        allTables.map((t) => `Table ${t.index} (page ${t.page})\r\n${toCsv(t.rows)}`).join('\r\n\r\n'), 'text/csv'));
    out.querySelectorAll('button[data-t]').forEach((b) => b.addEventListener('click', () => {
        const t = allTables[Number(b.dataset.t)];
        download(`${base}-page${t.page}-table${t.index}.csv`, toCsv(t.rows), 'text/csv');
    }));
    await doc.destroy?.();
}

const input = $('#file');
input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
        await convert(file);
    } catch (err) {
        $('#status').innerHTML = `<span class="error">${err?.name === 'PasswordException' ? 'This PDF is password-protected.' : `Could not read this PDF: ${esc(err.message)}`}</span>`;
    }
});
