import { classify } from './classify.js';
import { isDisposable, loadDisposableDomains } from './disposable.js';
import { DohClient } from './doh.js';
import { parseEmail } from './syntax.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dns = new DohClient();
const MAIL_TEXT = {
    implicit: 'none listed (mail would fall back to the web server)',
    'null-mx': 'none: the domain says it accepts no email',
    'no-mail': 'none',
    'no-domain': 'none: the domain does not exist',
    unknown: 'lookup failed',
};

$('#dea-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = $('#addr').value.trim();
    const status = $('#status');
    const out = $('#result');
    // Accept a bare domain by checking a placeholder mailbox on it.
    const parsed = parseEmail(raw.includes('@') ? raw : `check@${raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`);
    if (!parsed.syntaxValid) {
        status.innerHTML = `<span class="error">That doesn't look like an email address or domain (${esc(parsed.reason)}).</span>`;
        out.innerHTML = '';
        return;
    }
    $('#dea-btn').disabled = true;
    status.textContent = `Checking ${parsed.domain}…`;
    try {
        const [list, mail] = await Promise.all([loadDisposableDomains(), dns.mailStatus(parsed.domain)]);
        const r = classify(parsed, mail, list);
        const disposable = isDisposable(parsed.domain, list);
        const verdict = disposable
            ? '<span class="pill bad">Disposable</span> This domain belongs to a temporary email service.'
            : '<span class="pill good">Not disposable</span> This domain is not on the disposable list.';
        const extras = r.reasons.filter((x) => !/disposable/.test(x));
        out.innerHTML = `<div class="card">
            <div style="font-size:20px;font-weight:700;margin-bottom:6px">${esc(parsed.domain)}</div>
            <p style="margin:0 0 8px">${verdict}</p>
            ${extras.length ? `<p class="hint">Also: ${esc(extras.join('; '))}</p>` : ''}
            ${r.suggestion && raw.includes('@') ? `<p><strong>Did you mean ${esc(r.suggestion)}?</strong></p>` : ''}
            <p class="hint">Mail servers: ${mail.mxHosts.length ? esc(mail.mxHosts.slice(0, 3).join(', ')) : esc(MAIL_TEXT[mail.mailStatus] ?? mail.mailStatus)}</p>
          </div>`;
        status.textContent = '';
    } catch (err) {
        status.innerHTML = `<span class="error">Lookup failed: ${esc(err.message)}. Please try again.</span>`;
    } finally {
        $('#dea-btn').disabled = false;
    }
});
