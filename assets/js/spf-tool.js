import { countSpfLookups } from './audit.js';
import { DohClient } from './doh.js';

// Every include below was checked to resolve to a live SPF record.
export const PROVIDERS = [
    ['Google Workspace / Gmail', '_spf.google.com'],
    ['Microsoft 365 / Outlook', 'spf.protection.outlook.com'],
    ['Amazon SES', 'amazonses.com'],
    ['SendGrid', 'sendgrid.net'],
    ['Mailgun', 'mailgun.org'],
    ['Mailchimp', 'servers.mcsv.net'],
    ['Mailchimp Transactional (Mandrill)', 'spf.mandrillapp.com'],
    ['Brevo (Sendinblue)', 'spf.brevo.com'],
    ['Postmark', 'spf.mtasv.net'],
    ['MailerSend', '_spf.mailersend.net'],
    ['Zoho Mail', 'zohomail.com'],
    ['Fastmail', 'spf.messagingengine.com'],
    ['Proton Mail', '_spf.protonmail.ch'],
    ['Salesforce', '_spf.salesforce.com'],
    ['Zendesk', 'mail.zendesk.com'],
];

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dns = new DohClient();

$('#providers').innerHTML = PROVIDERS.map(([name, inc], i) => `
  <label style="display:flex;gap:8px;align-items:center;margin:4px 0"><input type="checkbox" value="${esc(inc)}" id="p${i}"> ${esc(name)} <code style="font-size:12px">${esc(inc)}</code></label>`).join('');

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^[0-9a-f:]+(\/\d{1,3})?$/i;
const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

function build() {
    const parts = ['v=spf1'];
    const warnings = [];
    if ($('#use-mx').checked) parts.push('mx');
    if ($('#use-a').checked) parts.push('a');
    for (const box of document.querySelectorAll('#providers input:checked')) parts.push(`include:${box.value}`);
    for (const raw of $('#extra').value.split(/[\s,]+/).filter(Boolean)) {
        if (IP_RE.test(raw)) parts.push(`${raw.includes(':') ? 'ip6' : 'ip4'}:${raw}`);
        else if (DOMAIN_RE.test(raw.replace(/^include:/, ''))) parts.push(`include:${raw.replace(/^include:/, '')}`);
        else warnings.push(`Skipped "${raw}": not an IP address, IP range or domain.`);
    }
    parts.push($('#policy').value);
    return { record: parts.join(' '), warnings, mechanisms: parts.length - 2 };
}

let timer;
async function update() {
    const { record, warnings, mechanisms } = build();
    $('#record').textContent = record;
    $('#warnings').innerHTML = warnings.map((w) => `<div class="error">${esc(w)}</div>`).join('');
    $('#lookups').innerHTML = mechanisms ? 'Counting DNS lookups…' : '<span class="pill warn">Pick at least one sender</span>';
    if (record.length > 255) $('#warnings').innerHTML += '<div class="hint">Over 255 characters: split it into several quoted strings in your DNS panel (most panels do this automatically).</div>';
    clearTimeout(timer);
    if (!mechanisms) return;
    timer = setTimeout(async () => {
        const { count, problems } = await countSpfLookups(dns, record);
        const kind = count > 10 ? 'bad' : count >= 9 ? 'warn' : 'good';
        $('#lookups').innerHTML = `<span class="pill ${kind}">${count} of 10 DNS lookups</span> ${count > 10 ? 'Too many: receivers will treat SPF as failing. Remove a sender or ask it for a dedicated IP.' : count >= 9 ? 'Close to the limit.' : ''}`
            + problems.map((p) => `<div class="hint">${esc(p)}</div>`).join('');
    }, 400);
}

document.querySelector('#spf-form').addEventListener('input', update);
$('#copy').addEventListener('click', async (e) => { await navigator.clipboard.writeText($('#record').textContent); e.target.textContent = 'Copied'; });
update();
