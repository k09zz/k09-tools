// Single-record DNS checkers (SPF, DMARC, DKIM, MX, Gmail/Yahoo sender rules).
// The page picks the checker with <body data-mode="...">.
import { auditDomain, countSpfLookups, DKIM_SELECTORS, effectiveAll, normalizeDomain, parseTags } from './audit.js';
import { DohClient } from './doh.js';

const $ = (s) => document.querySelector(s);
// DNS records come from arbitrary domains: always escape before inserting as HTML.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pill = (text, kind) => `<span class="pill ${kind}">${esc(text)}</span>`;
const issueList = (issues) => (issues.length
    ? `<ul class="issues">${issues.map((i) => `<li class="${esc(i.severity)}"><strong>${esc(i.message)}</strong>${i.fix ? `<span class="fix">Fix: ${esc(i.fix)}</span>` : ''}</li>`).join('')}</ul>`
    : '<p>No problems found.</p>');
const table = (rows) => `<div class="table-wrap"><table><tbody>${rows.map(([k, v]) => `<tr><th style="text-align:left;white-space:nowrap">${k}</th><td>${v}</td></tr>`).join('')}</tbody></table></div>`;
const card = (title, pills, body) => `<div class="card"><div style="font-size:20px;font-weight:700">${esc(title)}</div><div style="margin:6px 0 12px">${pills}</div>${body}</div>`;
const upsell = (domain) => `<p class="hint">Want the full picture? <a href="../dmarc-spf-dkim-checker/?domain=${encodeURIComponent(domain)}">Run the complete SPF + DKIM + DMARC audit</a> for an A–F grade.</p>`;

async function checkSpf(dns, domain) {
    const txt = await dns.txt(domain);
    if (txt.status === 'nxdomain') return card(domain, pill('domain not found', 'bad'), '<p>Check the spelling.</p>');
    const recs = txt.records.filter((r) => /^v=spf1(\s|$)/i.test(r));
    const issues = [];
    if (!recs.length) {
        issues.push({ severity: 'critical', message: 'No SPF record found.', fix: 'Create one with the free SPF record generator (link below) and add it as a TXT record at the root of your domain.' });
        return card(domain, pill('no SPF record', 'bad'), issueList(issues) + '<p><a href="../spf-record-generator/">Open the SPF record generator →</a></p>');
    }
    if (recs.length > 1) issues.push({ severity: 'critical', message: `${recs.length} SPF records found. Receivers treat this as a permanent error, so SPF fails.`, fix: 'Merge them into one "v=spf1 ..." record.' });
    const record = recs[0];
    const all = await effectiveAll(dns, record);
    const { count, problems } = await countSpfLookups(dns, record);
    if (all === '+all') issues.push({ severity: 'critical', message: '"+all" lets anyone on the internet send as your domain.', fix: 'Change it to "~all" or "-all".' });
    else if (all === '?all') issues.push({ severity: 'warning', message: '"?all" (neutral) gives no protection.', fix: 'Change it to "~all" or "-all".' });
    else if (!all) issues.push({ severity: 'warning', message: 'The record has no "all" at the end.', fix: 'End it with "~all" or "-all".' });
    if (count > 10) issues.push({ severity: 'critical', message: `SPF needs ${count} DNS lookups; the limit is 10, so SPF fails (permerror).`, fix: 'Remove includes you no longer use, or see the guide on fixing too many DNS lookups.' });
    else if (count >= 9) issues.push({ severity: 'info', message: `${count} of 10 DNS lookups used. You're close to the limit.`, fix: 'Remove unused includes before adding new services.' });
    for (const p of problems) issues.push({ severity: 'warning', message: `SPF ${p}.`, fix: 'Fix or remove that term.' });
    if (record.length > 255) issues.push({ severity: 'info', message: `The record is ${record.length} characters, so it must be split into several quoted strings of up to 255 characters.`, fix: 'Most DNS panels do this for you; check that yours does.' });
    const includes = [...record.matchAll(/(?:^|\s)[+\-~?]?include:(\S+)/gi)].map((m) => `<code>${esc(m[1])}</code>`);
    const pills = [
        pill(recs.length === 1 ? 'SPF record found' : 'multiple records', recs.length === 1 ? 'good' : 'bad'),
        pill(`${count}/10 lookups`, count > 10 ? 'bad' : count >= 9 ? 'warn' : 'good'),
        pill(all ?? 'no "all"', all === '-all' || all === '~all' ? 'good' : 'warn'),
    ].join(' ');
    return card(domain, pills, `<pre>${esc(record)}</pre>${table([
        ['DNS lookups', `${count} of 10`],
        ['Ends with', esc(all ?? 'nothing')],
        ['Includes', includes.join(' ') || 'none'],
    ])}<h3>Problems &amp; fixes</h3>${issueList(issues)}${count > 10 ? '<p><a href="../guides/spf-too-many-dns-lookups/">How to fix "too many DNS lookups" →</a></p>' : ''}${upsell(domain)}`);
}

const DMARC_TAGS = {
    v: 'Version (must be DMARC1)',
    p: 'Policy for your domain: none = monitor only, quarantine = spam folder, reject = block',
    sp: 'Policy for subdomains (defaults to p)',
    pct: 'Percent of failing mail the policy applies to (default 100)',
    rua: 'Where daily aggregate reports are sent',
    ruf: 'Where per-message failure reports are sent (few receivers send them)',
    adkim: 'DKIM alignment: r = relaxed (default), s = strict',
    aspf: 'SPF alignment: r = relaxed (default), s = strict',
    fo: 'When failure reports are generated',
    ri: 'Seconds between aggregate reports (default 86400)',
    np: 'Policy for subdomains that do not exist',
    t: 'Testing mode flag',
};

async function checkDmarc(dns, domain) {
    const txt = await dns.txt(`_dmarc.${domain}`);
    const recs = txt.records.filter((r) => /^v=DMARC1/i.test(r));
    const issues = [];
    if (!recs.length) {
        issues.push({ severity: 'critical', message: 'No DMARC record. Gmail and Yahoo require one from bulk senders, and without it anyone can spoof your domain.', fix: `Add a TXT record at _dmarc.${domain}: "v=DMARC1; p=none; rua=mailto:dmarc@${domain}".` });
        return card(domain, pill('no DMARC record', 'bad'), issueList(issues) + '<p><a href="../dmarc-record-generator/">Create one with the DMARC record generator →</a></p>' + upsell(domain));
    }
    if (recs.length > 1) issues.push({ severity: 'critical', message: 'More than one DMARC record, so receivers ignore all of them.', fix: 'Keep exactly one record at _dmarc.' });
    const record = recs[0];
    const tags = parseTags(record);
    const p = (tags.p || '').toLowerCase();
    if (!['none', 'quarantine', 'reject'].includes(p)) issues.push({ severity: 'critical', message: 'The record has no valid "p=" policy, so it is ignored.', fix: 'Add "p=none", "p=quarantine" or "p=reject".' });
    else if (p === 'none') issues.push({ severity: 'warning', message: 'Policy is "none": spoofed email is reported but still delivered.', fix: 'Once reports show all your real senders pass, move to quarantine, then reject.' });
    if (!tags.rua) issues.push({ severity: 'warning', message: 'No "rua" report address, so you never see who sends as your domain.', fix: `Add "rua=mailto:dmarc@${domain}".` });
    const pct = tags.pct ? Number(tags.pct) : 100;
    if (pct < 100 && p !== 'none') issues.push({ severity: 'info', message: `The policy applies to only ${pct}% of failing mail.`, fix: 'Raise pct to 100 when you are confident.' });
    for (const addr of (tags.rua || '').split(',').map((s) => s.trim().replace(/^mailto:/i, '').split('!')[0]).filter(Boolean)) {
        const rd = addr.split('@')[1]?.toLowerCase();
        if (rd && rd !== domain && !rd.endsWith(`.${domain}`)) {
            const auth = await dns.txt(`${domain}._report._dmarc.${rd}`);
            if (!auth.records.some((r) => /^v=DMARC1/i.test(r))) issues.push({ severity: 'info', message: `Reports go to another domain (${rd}) that has not published permission to receive them, so some receivers will skip sending.`, fix: `Normal for most DMARC report services. If you run ${rd}, add a TXT record "v=DMARC1" at ${domain}._report._dmarc.${rd}.` });
        }
    }
    const rows = Object.entries(tags).map(([k, v]) => [`<code>${esc(k)}</code>`, `<code>${esc(v)}</code><div class="hint">${esc(DMARC_TAGS[k] ?? 'Unknown tag')}</div>`]);
    const kind = p === 'reject' || p === 'quarantine' ? 'good' : 'warn';
    return card(domain, `${pill(`p=${p || '?'}`, kind)} ${pill(tags.rua ? 'reports on' : 'no reports', tags.rua ? 'good' : 'warn')}`,
        `<pre>${esc(record)}</pre>${table(rows)}<h3>Problems &amp; fixes</h3>${issueList(issues)}${p === 'none' ? '<p><a href="../guides/dmarc-none-to-reject/">How to move safely from p=none to p=reject →</a></p>' : ''}${upsell(domain)}`);
}

// Approximate RSA key size from the base64 public key length (SubjectPublicKeyInfo DER).
function keyInfo(record) {
    const tags = parseTags(record);
    const k = (tags.k || 'rsa').toLowerCase();
    const p = (tags.p || '').replace(/\s+/g, '');
    if (!p) return { revoked: true, k };
    const bytes = Math.floor((p.length * 3) / 4);
    const bits = k === 'ed25519' ? 256 : bytes > 520 ? 4096 : bytes > 390 ? 3072 : bytes > 260 ? 2048 : bytes > 130 ? 1024 : 512;
    return { revoked: false, k, bits };
}

async function checkDkim(dns, domain) {
    const custom = ($('#selector')?.value || '').trim().toLowerCase().replace(/\._domainkey.*$/, '');
    const selectors = custom ? [custom] : DKIM_SELECTORS;
    const probe = async (sel) => {
        const name = `${sel}._domainkey.${domain}`;
        const [txt, cname] = await Promise.all([dns.txt(name), dns.cname(name)]);
        const rec = txt.records.find((r) => /(^|;)\s*(v=DKIM1|k=|p=)/i.test(r));
        return { sel, record: rec ?? null, cname: cname.records[0] ?? null };
    };
    const canary = custom ? null : await probe(`zz${Math.random().toString(36).slice(2, 10)}`);
    if (canary && (canary.record || canary.cname)) {
        return card(domain, pill('wildcard DNS', 'warn'), '<p>This domain answers every DKIM name, so selectors cannot be detected by guessing. Enter your selector above (find it as <code>s=</code> in the DKIM-Signature header of an email you sent).</p>');
    }
    const found = (await Promise.all(selectors.map(probe))).filter((r) => r.record || r.cname);
    if (!found.length) {
        const msg = custom
            ? `No DKIM key at <code>${esc(custom)}._domainkey.${esc(domain)}</code>.`
            : `No DKIM key under ${selectors.length} common selectors. It may use a custom selector: send yourself an email, open the original/raw message, find <code>DKIM-Signature</code> and enter the <code>s=</code> value above.`;
        return card(domain, pill('no key found', 'warn'), `<p>${msg}</p>${upsell(domain)}`);
    }
    const rows = found.map((f) => {
        if (!f.record) return [`<code>${esc(f.sel)}</code>`, `CNAME to <code>${esc(f.cname)}</code> (key hosted by your email provider) ${pill('delegated', 'good')}`];
        const info = keyInfo(f.record);
        const status = info.revoked ? pill('revoked (empty p=)', 'bad')
            : info.k === 'rsa' && info.bits < 1024 ? pill(`~${info.bits}-bit: too weak`, 'bad')
            : info.k === 'rsa' && info.bits < 2048 ? pill(`~${info.bits}-bit: upgrade to 2048`, 'warn')
            : pill(`${info.k.toUpperCase()} ~${info.bits}-bit`, 'good');
        return [`<code>${esc(f.sel)}</code>`, `${status}<pre style="margin-top:6px">${esc(f.record)}</pre>`];
    });
    return card(domain, pill(`${found.length} DKIM key${found.length > 1 ? 's' : ''} found`, 'good'), table(rows) + upsell(domain));
}

const MX_PROVIDERS = [
    [/aspmx\.l\.google\.com$|googlemail\.com$|\.google\.com$/, 'Google Workspace / Gmail'],
    [/mail\.protection\.outlook\.com$|outlook\.com$|hotmail\.com$/, 'Microsoft 365 / Outlook'],
    [/zoho\.(com|eu|in)$/, 'Zoho Mail'],
    [/protonmail\.ch$|proton\.me$/, 'Proton Mail'],
    [/messagingengine\.com$/, 'Fastmail'],
    [/yahoodns\.net$/, 'Yahoo'],
    [/icloud\.com$|me\.com$/, 'iCloud Mail'],
    [/secureserver\.net$/, 'GoDaddy'],
    [/pphosted\.com$/, 'Proofpoint'],
    [/mimecast\.com$/, 'Mimecast'],
    [/barracudanetworks\.com$/, 'Barracuda'],
    [/amazonaws\.com$/, 'Amazon SES / WorkMail'],
    [/mailgun\.org$/, 'Mailgun'],
    [/sendgrid\.net$/, 'SendGrid'],
    [/emailsrvr\.com$/, 'Rackspace'],
    [/ovh\.net$/, 'OVH'],
    [/ionos\.|1and1\./, 'IONOS'],
    [/improvmx\.com$/, 'ImprovMX (forwarding)'],
    [/forwardemail\.net$/, 'Forward Email'],
    [/yandex\.(net|ru)$/, 'Yandex'],
    [/titan\.email$/, 'Titan'],
];
const providerOf = (host) => MX_PROVIDERS.find(([re]) => re.test(host))?.[1] ?? '';

async function checkMx(dns, domain) {
    const mx = await dns.mx(domain);
    if (mx.status === 'nxdomain') return card(domain, pill('domain not found', 'bad'), '<p>Check the spelling.</p>');
    if (mx.status === 'error') throw new Error(mx.error || 'DNS error');
    const hosts = mx.records.filter((r) => r.exchange && r.exchange !== '.');
    if (!hosts.length) {
        const nullMx = mx.records.length > 0;
        return card(domain, pill(nullMx ? 'null MX: accepts no mail' : 'no MX records', nullMx ? 'muted' : 'warn'),
            `<p>${nullMx ? 'This domain publishes a "null MX", meaning it deliberately accepts no email.' : 'No MX records. Senders fall back to the domain\'s A record, which usually means email to this domain bounces.'}</p>`);
    }
    const provider = [...new Set(hosts.map((h) => providerOf(h.exchange)).filter(Boolean))].join(', ');
    const rows = hosts.map((h) => [`Priority ${esc(h.priority)}`, `<code>${esc(h.exchange)}</code>${providerOf(h.exchange) ? ` <span class="hint">${esc(providerOf(h.exchange))}</span>` : ''}`]);
    return card(domain, `${pill(`${hosts.length} mail server${hosts.length > 1 ? 's' : ''}`, 'good')} ${provider ? pill(provider, 'muted') : ''}`,
        `${table(rows)}<p class="hint">Lower priority numbers are tried first.</p>${upsell(domain)}`);
}

async function checkBulk(dns, domain) {
    const r = await auditDomain(dns, domain);
    if (!r.exists) return card(domain, pill('domain not found', 'bad'), '<p>Check the spelling.</p>');
    const spfOk = r.spf.present && r.spf.all !== '+all' && (r.spf.lookups ?? 0) <= 10;
    const rows = [
        ['SPF record that passes', spfOk ? pill('yes', 'good') : pill('no', 'bad'), 'All senders'],
        ['DKIM signing key published', r.dkim.selectorsFound.length ? pill('yes', 'good') : r.dkim.wildcardDns ? pill('can\'t tell', 'muted') : pill('not found', 'warn'), 'All senders (SPF or DKIM); both for bulk senders'],
        ['DMARC record (p=none or stricter)', r.dmarc.present && r.dmarc.policy ? pill(`yes, p=${r.dmarc.policy}`, 'good') : pill('no', 'bad'), 'Bulk senders (5,000+/day)'],
        ['DMARC reports enabled (rua)', r.dmarc.rua ? pill('yes', 'good') : pill('no', 'warn'), 'Recommended'],
        ['Mail server (MX) for replies/bounces', r.mx.length ? pill('yes', 'good') : pill('no', 'warn'), 'Recommended'],
        ['From-address alignment', pill('check a sent email', 'muted'), 'Bulk senders'],
        ['One-click unsubscribe header', pill('check your email tool', 'muted'), 'Bulk senders'],
        ['Spam rate under 0.3%', pill('check Postmaster Tools', 'muted'), 'All senders'],
    ].map(([a, b, c]) => [esc(a), `${b} <span class="hint">${esc(c)}</span>`]);
    const verdict = r.meetsBulkSenderBasics ? pill('DNS requirements met', 'good') : pill('DNS requirements not met', 'bad');
    const blockers = r.issues.filter((i) => i.severity !== 'info');
    return card(domain, verdict, `${table(rows)}<h3>What to fix</h3>${issueList(blockers)}<p class="hint">The last three rules depend on how you send, not on DNS, so no DNS checker can confirm them.</p>${upsell(domain)}`);
}

const CHECKERS = { spf: checkSpf, dmarc: checkDmarc, dkim: checkDkim, mx: checkMx, bulk: checkBulk };

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
    status.textContent = `Checking ${domain}…`;
    out.innerHTML = '';
    try {
        out.innerHTML = await CHECKERS[document.body.dataset.mode](new DohClient(), domain);
        status.textContent = '';
        const sel = $('#selector')?.value.trim();
        history.replaceState(null, '', `?domain=${encodeURIComponent(domain)}${sel ? `&selector=${encodeURIComponent(sel)}` : ''}`);
    } catch (err) {
        status.innerHTML = `<span class="error">Lookup failed: ${esc(err.message)}. Please try again.</span>`;
    } finally {
        btn.disabled = false;
    }
});

// Shareable links: ?domain=example.com (&selector=google on the DKIM page)
const params = new URLSearchParams(location.search);
if (params.get('selector') && $('#selector')) $('#selector').value = params.get('selector');
if (params.get('domain')) {
    $('#domain').value = params.get('domain');
    $('#check-form').requestSubmit();
}
