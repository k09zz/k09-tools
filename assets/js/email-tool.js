import { classify } from './classify.js';
import { loadDisposableDomains } from './disposable.js';
import { DohClient } from './doh.js';
import { extractEmails, parseEmail } from './syntax.js';

const LIMIT = 100;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KIND = { ok: 'good', risky: 'warn', invalid: 'bad', unknown: 'muted' };
let lastResults = [];

async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
    }));
    return out;
}

function toCsv(rows) {
    const q = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
    const head = ['email', 'status', 'reasons', 'suggestion', 'mail_server', 'disposable', 'role_account', 'free_provider'];
    return [head.join(','), ...rows.map((r) => [r.email, r.status, r.reasons.join('; '), r.suggestion ?? '', r.mailServer ?? '', r.isDisposable, r.isRoleAccount, r.isFreeProvider].map((v) => q(String(v))).join(','))].join('\n');
}

function render(results, truncated, dupes) {
    const counts = { ok: 0, risky: 0, invalid: 0, unknown: 0 };
    for (const r of results) counts[r.status]++;
    const rows = results.map((r) => `<tr>
        <td class="email">${esc(r.email)}</td>
        <td><span class="pill ${KIND[r.status]}">${esc(r.status)}</span></td>
        <td>${esc(r.reasons.join('; ') || '-')}${r.suggestion ? `<br><strong>Did you mean ${esc(r.suggestion)}?</strong>` : ''}</td>
      </tr>`).join('');
    return `
      <div class="summary">
        <span class="pill good">${counts.ok} ok</span><span class="pill warn">${counts.risky} risky</span>
        <span class="pill bad">${counts.invalid} invalid</span>${counts.unknown ? `<span class="pill muted">${counts.unknown} unknown</span>` : ''}
        ${dupes ? `<span class="hint">${dupes} duplicate(s) removed</span>` : ''}
      </div>
      ${truncated ? `<p class="hint">Only the first ${LIMIT} unique emails were checked. <a href="https://apify.com/k09/email-list-cleaner">Check the whole list on Apify</a>.</p>` : ''}
      <div class="table-wrap"><table><thead><tr><th>Email</th><th>Status</th><th>Why</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="actions">
        <button type="button" class="secondary" id="dl-csv">Download CSV</button>
        <button type="button" class="secondary" id="copy-ok">Copy "ok" emails</button>
      </div>`;
}

$('#validate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('#status');
    const btn = $('#validate-btn');
    const raw = extractEmails($('#emails').value);
    // Also keep malformed tokens with an "@" (e.g. "bad@@mail.com") so users see why they're invalid.
    const malformed = $('#emails').value.split(/[\s,;]+/).filter((s) => s.includes('@') && !raw.some((r) => s.includes(r)));
    const entries = [...raw, ...malformed];
    if (!entries.length) {
        status.innerHTML = '<span class="error">Paste at least one email address.</span>';
        return;
    }
    const seen = new Set();
    const unique = [];
    for (const p of entries.map(parseEmail)) {
        const key = p.syntaxValid ? p.email : p.input.trim().toLowerCase();
        if (!seen.has(key)) { seen.add(key); unique.push(p); }
    }
    const dupes = entries.length - unique.length;
    const batch = unique.slice(0, LIMIT);

    btn.disabled = true;
    status.textContent = `Checking ${batch.length} email(s)…`;
    $('#result').innerHTML = '';
    try {
        const [disposable, dns] = [await loadDisposableDomains(), new DohClient()];
        const domains = [...new Set(batch.filter((p) => p.syntaxValid).map((p) => p.domain))];
        const statuses = await mapLimit(domains, 6, (d) => dns.mailStatus(d));
        const byDomain = new Map(domains.map((d, i) => [d, statuses[i]]));
        lastResults = batch.map((p) => classify(p, p.syntaxValid ? byDomain.get(p.domain) : null, disposable));
        $('#result').innerHTML = render(lastResults, unique.length > LIMIT, dupes);
        status.textContent = '';
        $('#dl-csv').addEventListener('click', () => {
            const url = URL.createObjectURL(new Blob([toCsv(lastResults)], { type: 'text/csv' }));
            Object.assign(document.createElement('a'), { href: url, download: 'email-validation.csv' }).click();
            URL.revokeObjectURL(url);
        });
        $('#copy-ok').addEventListener('click', async (ev) => {
            await navigator.clipboard.writeText(lastResults.filter((r) => r.status === 'ok').map((r) => r.email).join('\n'));
            ev.target.textContent = 'Copied';
        });
    } catch (err) {
        status.innerHTML = `<span class="error">Something went wrong: ${esc(err.message)}. Please try again.</span>`;
    } finally {
        btn.disabled = false;
    }
});
