// Email-authentication audit for one domain. `dns` is any object with txt/mx/cname methods
// returning { status, records } (see DnsClient), so tests can pass a fake.

// Selectors used by common senders. DKIM keys can't be listed, only probed, so "not found" means
// "not under these common names", not "missing".
export const DKIM_SELECTORS = [
    'google', 'selector1', 'selector2', 'default', 'k1', 'k2', 'k3', 's1', 's2', 'dkim', 'mail',
    'smtp', 'mandrill', 'mxvault', 'zoho', 'zmail', 'protonmail', 'protonmail2', 'protonmail3',
    'everlytickey1', 'everlytickey2', 'mailjet', 'pm', 'sig1', 'fm1', 'fm2', 'fm3', 'hs1', 'hs2',
    'cm', 'krs', 'amazonses', 'mesmtp', 'ctct1', 'ctct2', 'sm', 'key1',
    // Google's own domains use dated selectors.
    '20230601', '20221208', '20210112', '20161025',
];

const SPF_LOOKUP_LIMIT = 10;

export function normalizeDomain(raw) {
    let s = String(raw ?? '').trim().toLowerCase();
    if (!s) return null;
    if (s.includes('@')) s = s.slice(s.lastIndexOf('@') + 1);
    s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#:\s]/)[0].replace(/\.$/, '');
    return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(s) ? s : null;
}

export function parseTags(record) {
    const tags = {};
    for (const part of record.split(';')) {
        const i = part.indexOf('=');
        if (i > 0) tags[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
    }
    return tags;
}

/** Counts DNS-querying SPF terms recursively (RFC 7208 limit: 10). */
export async function countSpfLookups(dns, record, depth = 0, seen = new Set()) {
    let count = 0;
    const problems = [];
    for (const term of record.split(/\s+/).slice(1)) {
        const t = term.replace(/^[+\-~?]/, '').toLowerCase();
        const [mech, arg] = t.split(/[:=]/, 2);
        if (['a', 'mx', 'ptr', 'exists'].includes(mech)) {
            count++;
            if (mech === 'ptr') problems.push('uses the deprecated "ptr" mechanism');
        } else if (mech === 'include' || mech === 'redirect') {
            count++;
            if (!arg || depth >= 5 || seen.has(arg)) continue;
            seen.add(arg);
            const res = await dns.txt(arg);
            const sub = res.records.find((r) => /^v=spf1(\s|$)/i.test(r));
            if (!sub) {
                problems.push(`${mech} "${arg}" has no SPF record (this makes SPF fail with a permerror)`);
                continue;
            }
            const inner = await countSpfLookups(dns, sub, depth + 1, seen);
            count += inner.count;
            problems.push(...inner.problems);
        }
    }
    return { count, problems };
}

/** The record's final "all" qualifier, following redirect= when the record has no "all" of its own. */
export async function effectiveAll(dns, record, depth = 0) {
    const allTerm = record.match(/(^|\s)([+\-~?]?)all(\s|$)/i);
    if (allTerm) return `${allTerm[2] || '+'}all`;
    const target = record.match(/(^|\s)redirect=(\S+)/i)?.[2];
    if (!target || depth >= 5) return null;
    const next = (await dns.txt(target)).records.find((r) => /^v=spf1(\s|$)/i.test(r));
    return next ? effectiveAll(dns, next, depth + 1) : null;
}

export async function auditDomain(dns, domain) {
    const issues = []; // { severity: "critical" | "warning" | "info", message, fix }
    const add = (severity, message, fix) => issues.push({ severity, message, fix });
    let score = 0;

    // --- MX ---
    const mxRes = await dns.mx(domain);
    const mxHosts = mxRes.records.filter((r) => r.exchange && r.exchange !== '.').map((r) => r.exchange.toLowerCase());
    if (mxRes.status === 'nxdomain') {
        return {
            domain, exists: false, grade: 'F', score: 0, mx: [], issues: [{ severity: 'critical', message: 'Domain does not exist in DNS.', fix: 'Check the spelling or register the domain.' }],
        };
    }
    if (!mxHosts.length) add('info', 'No MX records: this domain cannot receive email.', 'Fine for a send-only domain; otherwise add MX records from your mail provider.');

    // --- SPF (30 points) ---
    const rootTxt = await dns.txt(domain);
    const spfRecords = rootTxt.records.filter((r) => /^v=spf1(\s|$)/i.test(r));
    const spf = { present: spfRecords.length > 0, record: spfRecords[0] ?? null, all: null, lookups: null };
    if (!spfRecords.length) {
        add('critical', 'No SPF record.', 'Add a TXT record at the root, e.g. "v=spf1 include:<your provider> -all".');
    } else if (spfRecords.length > 1) {
        add('critical', `${spfRecords.length} SPF records found; receivers treat this as an error.`, 'Merge them into a single "v=spf1 ..." record.');
    } else {
        score += 15;
        spf.all = await effectiveAll(dns, spf.record);
        if (spf.all === '-all') score += 10;
        else if (spf.all === '~all') score += 8;
        else if (spf.all === '+all') add('critical', 'SPF ends with "+all", which lets anyone send as this domain.', 'Change "+all" to "~all" or "-all".');
        else if (spf.all === '?all') add('warning', 'SPF ends with "?all" (neutral), which gives no protection.', 'Change it to "~all" or "-all".');
        else add('warning', 'SPF has no "all" at the end.', 'End the record with "~all" or "-all".');
        const { count, problems } = await countSpfLookups(dns, spf.record);
        spf.lookups = count;
        if (count > SPF_LOOKUP_LIMIT) add('critical', `SPF needs ${count} DNS lookups (limit is ${SPF_LOOKUP_LIMIT}), so SPF checks fail.`, 'Remove unused includes or flatten the record.');
        else score += 5;
        if (count === SPF_LOOKUP_LIMIT) add('info', `SPF uses ${count} of ${SPF_LOOKUP_LIMIT} allowed DNS lookups; one more include will break it.`, 'Remove includes for services you no longer use before adding new ones.');
        for (const p of problems) add('warning', `SPF ${p}.`, 'Fix or remove that term.');
    }

    // --- DMARC (40 points) ---
    const dmarcTxt = await dns.txt(`_dmarc.${domain}`);
    const dmarcRecords = dmarcTxt.records.filter((r) => /^v=DMARC1/i.test(r));
    const dmarc = { present: dmarcRecords.length > 0, record: dmarcRecords[0] ?? null, policy: null, rua: false, pct: 100 };
    if (!dmarcRecords.length) {
        add('critical', 'No DMARC record. Gmail and Yahoo require one for bulk senders.', `Add a TXT record at _dmarc.${domain}: "v=DMARC1; p=none; rua=mailto:dmarc@${domain}", then tighten to quarantine/reject.`);
    } else if (dmarcRecords.length > 1) {
        add('critical', 'More than one DMARC record; receivers ignore all of them.', 'Keep exactly one record at _dmarc.');
    } else {
        score += 15;
        const tags = parseTags(dmarc.record);
        dmarc.policy = (tags.p || '').toLowerCase() || null;
        dmarc.rua = Boolean(tags.rua);
        dmarc.pct = tags.pct ? Number(tags.pct) : 100;
        if (dmarc.policy === 'reject') score += 20;
        else if (dmarc.policy === 'quarantine') score += 15;
        else if (dmarc.policy === 'none') add('warning', 'DMARC policy is "none": spoofed mail is reported but still delivered.', 'Once reports look clean, move to "p=quarantine", then "p=reject".');
        else add('critical', 'DMARC record has no valid "p=" policy.', 'Add "p=none", "p=quarantine" or "p=reject".');
        if (dmarc.rua) score += 5;
        else add('warning', 'DMARC has no "rua" address, so you get no reports.', `Add "rua=mailto:dmarc@${domain}" (or a DMARC reporting service).`);
        if (dmarc.pct < 100 && dmarc.policy !== 'none') add('info', `DMARC applies to only ${dmarc.pct}% of mail.`, 'Raise pct to 100 when ready.');
    }

    // --- DKIM (20 points) ---
    const probe = async (sel) => {
        const name = `${sel}._domainkey.${domain}`;
        const txt = await dns.txt(name);
        // A key needs non-empty key data; "p=" with nothing after it means the key is revoked.
        if (txt.records.some((r) => /(^|;)\s*p=[A-Za-z0-9+/]/.test(r))) return true;
        // Some providers delegate the key with a CNAME to their own zone.
        return (await dns.cname(name)).status === 'ok';
    };
    // A random selector that no one would use: if it "exists", the zone answers every name (wildcard DNS).
    const canary = `zz${Math.random().toString(36).slice(2, 10)}`;
    const [wildcard, ...hits] = await Promise.all([probe(canary), ...DKIM_SELECTORS.map(probe)]);
    const found = wildcard ? [] : DKIM_SELECTORS.filter((_, i) => hits[i]);
    const dkim = { selectorsFound: found, selectorsChecked: DKIM_SELECTORS.length, wildcardDns: wildcard };
    if (found.length) score += 20;
    else if (wildcard) add('warning', 'DKIM could not be checked: the domain answers every DKIM name (wildcard DNS).', 'Send a test email and check the DKIM-Signature header, or remove the wildcard record.');
    else add('warning', 'No DKIM key found under common selector names (it may exist under a custom name).', 'Enable DKIM signing in your email provider and publish its key.');

    // --- MTA-STS, TLS-RPT, BIMI (10 points) ---
    const mtaSts = (await dns.txt(`_mta-sts.${domain}`)).records.some((r) => /^v=STSv1/i.test(r));
    const tlsRpt = (await dns.txt(`_smtp._tls.${domain}`)).records.some((r) => /^v=TLSRPTv1/i.test(r));
    const bimi = (await dns.txt(`default._bimi.${domain}`)).records.some((r) => /^v=BIMI1/i.test(r));
    if (mtaSts) score += 4;
    else if (mxHosts.length) add('info', 'No MTA-STS policy (encrypts mail delivered to you).', 'Optional: publish MTA-STS to require TLS for inbound mail.');
    if (tlsRpt) score += 3;
    if (bimi) score += 3;
    else if (dmarc.policy === 'quarantine' || dmarc.policy === 'reject') add('info', 'No BIMI record (brand logo in inboxes).', 'Optional: add a BIMI record once DMARC is enforced.');

    const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
    // Gmail/Yahoo bulk-sender basics: SPF or DKIM passing, plus a DMARC record (alignment can't be checked from DNS alone).
    const spfOk = spf.present && spfRecords.length === 1 && spf.all !== '+all' && (spf.lookups ?? 0) <= SPF_LOOKUP_LIMIT;
    const meetsBulkSenderBasics = spfOk && found.length > 0 && dmarc.present && dmarcRecords.length === 1 && Boolean(dmarc.policy);
    const order = { critical: 0, warning: 1, info: 2 };
    issues.sort((a, b) => order[a.severity] - order[b.severity]);
    return { domain, exists: true, grade, score, meetsBulkSenderBasics, mx: mxHosts.slice(0, 5), spf, dmarc, dkim, mtaSts, tlsRpt, bimi, issues };
}
