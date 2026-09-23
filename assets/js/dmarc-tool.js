import { auditDomain, normalizeDomain } from './audit.js';
import { DohClient } from './doh.js';

const $ = (s) => document.querySelector(s);
// DNS records come from arbitrary domains: always escape before inserting as HTML.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pill = (text, kind) => `<span class="pill ${kind}">${esc(text)}</span>`;

function render(r) {
    if (!r.exists) {
        return `<div class="card"><p class="error"><strong>${esc(r.domain)}</strong> does not exist in DNS. Check the spelling.</p></div>`;
    }
    const spfPill = !r.spf.present ? pill('missing', 'bad') : r.spf.all === '-all' ? pill('-all (strict)', 'good')
        : r.spf.all === '~all' ? pill('~all (soft)', 'good') : pill(r.spf.all ?? 'no "all"', 'warn');
    const dmarcPill = !r.dmarc.present ? pill('missing', 'bad') : r.dmarc.policy === 'reject' ? pill('p=reject', 'good')
        : r.dmarc.policy === 'quarantine' ? pill('p=quarantine', 'good') : pill(`p=${r.dmarc.policy ?? '?'}`, 'warn');
    const dkimPill = r.dkim.selectorsFound.length ? pill(`${r.dkim.selectorsFound.length} key(s) found`, 'good')
        : r.dkim.wildcardDns ? pill('unknown (wildcard DNS)', 'muted') : pill('not found', 'warn');
    const bool = (v, yes, no) => (v ? pill(yes, 'good') : pill(no, 'muted'));

    const issues = r.issues.length
        ? `<ul class="issues">${r.issues.map((i) => `<li class="${esc(i.severity)}"><strong>${esc(i.message)}</strong><span class="fix">Fix: ${esc(i.fix)}</span></li>`).join('')}</ul>`
        : '<p>No issues found. Nice work.</p>';

    return `
    <div class="card">
      <div class="summary">
        <div class="grade g-${esc(r.grade)}" aria-label="Grade ${esc(r.grade)}">${esc(r.grade)}</div>
        <div>
          <div style="font-size:20px;font-weight:700">${esc(r.domain)}</div>
          <div>Score ${esc(r.score)}/100 · ${r.meetsBulkSenderBasics ? pill('Meets Gmail/Yahoo basics', 'good') : pill('Does not meet Gmail/Yahoo basics', 'bad')}</div>
        </div>
      </div>
      <div class="checks">
        <div class="check"><div class="label">SPF</div><div class="value">${spfPill}</div>
          ${r.spf.record ? `<pre>${esc(r.spf.record)}</pre><div class="hint">${esc(r.spf.lookups)} of 10 DNS lookups used</div>` : ''}</div>
        <div class="check"><div class="label">DMARC</div><div class="value">${dmarcPill}</div>
          ${r.dmarc.record ? `<pre>${esc(r.dmarc.record)}</pre>` : ''}</div>
        <div class="check"><div class="label">DKIM</div><div class="value">${dkimPill}</div>
          ${r.dkim.selectorsFound.length ? `<div class="hint">Selectors: ${r.dkim.selectorsFound.map((s) => `<code>${esc(s)}</code>`).join(' ')}</div>` : `<div class="hint">Checked ${esc(r.dkim.selectorsChecked)} common selectors</div>`}</div>
        <div class="check"><div class="label">Extras</div>
          <div class="value">${bool(r.mtaSts, 'MTA-STS', 'no MTA-STS')} ${bool(r.tlsRpt, 'TLS-RPT', 'no TLS-RPT')} ${bool(r.bimi, 'BIMI', 'no BIMI')}</div>
          <div class="hint">MX: ${r.mx.length ? r.mx.map(esc).join(', ') : 'none'}</div></div>
      </div>
      <h3>Issues &amp; fixes</h3>
      ${issues}
    </div>`;
}

$('#check-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const domain = normalizeDomain($('#domain').value);
    const out = $('#result');
    const status = $('#status');
    const btn = $('#check-btn');
    if (!domain) {
        status.innerHTML = '<span class="error">Enter a valid domain, like <code>example.com</code> (an email address or URL works too).</span>';
        return;
    }
    btn.disabled = true;
    status.textContent = `Checking ${domain}… (about 45 DNS lookups)`;
    out.innerHTML = '';
    try {
        const result = await auditDomain(new DohClient(), domain);
        out.innerHTML = render(result);
        status.textContent = '';
        history.replaceState(null, '', `?domain=${encodeURIComponent(domain)}`);
    } catch (err) {
        status.innerHTML = `<span class="error">Lookup failed: ${esc(err.message)}. Please try again.</span>`;
    } finally {
        btn.disabled = false;
    }
});

// Support shareable links: ?domain=example.com
const preset = new URLSearchParams(location.search).get('domain');
if (preset) {
    $('#domain').value = preset;
    $('#check-form').requestSubmit();
}
