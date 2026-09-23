import { FREE_PROVIDERS, ROLE_LOCAL_PARTS, TLD_FIXES, TYPO_TARGETS } from './lists.js';

// Browser equivalent of Node's url.domainToASCII (IDN -> punycode).
const domainToASCII = (d) => { try { return new URL(`http://${d}`).hostname; } catch { return ''; } };

// RFC 5322 "atext" characters allowed in an unquoted local part (dots handled separately).
const LOCAL_PART_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD_RE = /^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

// Pulls anything that looks like an email out of free text (pasted lists, CSV files).
const EXTRACT_RE = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9¡-￿](?:[A-Za-z0-9¡-￿-]*[A-Za-z0-9¡-￿])?(?:\.[A-Za-z0-9¡-￿](?:[A-Za-z0-9¡-￿-]*[A-Za-z0-9¡-￿])?)+/g;

export function extractEmails(text) {
    return text.match(EXTRACT_RE) ?? [];
}

/**
 * Cleans up a raw entry and checks its syntax.
 * Returns { input, email, local, domain, syntaxValid, reason }.
 */
export function parseEmail(raw) {
    const input = String(raw ?? '');
    let s = input.trim();
    s = s.replace(/^mailto:/i, '').replace(/^<(.*)>$/, '$1').replace(/[.,;:]+$/, '').trim();

    const fail = (reason) => ({ input, email: s.toLowerCase(), local: null, domain: null, syntaxValid: false, reason });

    if (!s) return fail('empty');
    const at = s.lastIndexOf('@');
    if (at === -1) return fail('missing @');
    if (s.indexOf('@') !== at) return fail('more than one @');

    const local = s.slice(0, at);
    const rawDomain = s.slice(at + 1).replace(/\.$/, '');
    if (!local) return fail('missing local part');
    if (!rawDomain) return fail('missing domain');
    if (local.length > 64) return fail('local part longer than 64 characters');
    if (!LOCAL_PART_RE.test(local)) return fail('invalid characters or dots in local part');

    const domain = domainToASCII(rawDomain.toLowerCase());
    if (!domain) return fail('invalid domain');
    if (domain.length > 253) return fail('domain too long');
    const labels = domain.split('.');
    if (labels.length < 2) return fail('domain has no top-level domain');
    if (!labels.every((l) => l.length <= 63 && LABEL_RE.test(l))) return fail('invalid domain label');
    if (!TLD_RE.test(labels[labels.length - 1])) return fail('invalid top-level domain');

    const email = `${local.toLowerCase()}@${domain}`;
    if (email.length > 254) return fail('address longer than 254 characters');

    return { input, email, local: local.toLowerCase(), domain, syntaxValid: true, reason: null };
}

export function isRoleAccount(local) {
    const base = local.split('+')[0];
    return ROLE_LOCAL_PARTS.has(base) || ROLE_LOCAL_PARTS.has(base.replace(/[._]/g, ''));
}

export function isFreeProvider(domain) {
    return FREE_PROVIDERS.has(domain);
}

// Optimal string alignment distance (Levenshtein plus adjacent transpositions).
export function editDistance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
            }
        }
    }
    return d[a.length][b.length];
}

/**
 * Suggests a corrected domain for likely typos.
 * Returns { domain, confidence } or null. "high" suggestions are always reported;
 * "low" ones only when the domain cannot receive mail (decided by the caller).
 */
export function suggestDomain(domain) {
    if (FREE_PROVIDERS.has(domain)) return null;

    const labels = domain.split('.');
    const tld = labels[labels.length - 1];
    if (TLD_FIXES[tld]) {
        const fixed = [...labels.slice(0, -1), TLD_FIXES[tld]].join('.');
        return { domain: fixed, confidence: 'high' };
    }

    let best = null;
    for (const target of TYPO_TARGETS) {
        const dist = editDistance(domain, target);
        if (dist === 0 || dist > 2) continue;
        // Only near-misses of longer provider names are confident; a short domain one or two
        // edits from "aol.com" may well be a real, different domain.
        const highLimit = target.length >= 11 ? 2 : 1;
        const confidence = target.length >= 9 && dist <= highLimit ? 'high' : 'low';
        if (!best || dist < best.dist || (dist === best.dist && confidence === 'high')) {
            best = { domain: target, confidence, dist };
        }
    }
    return best ? { domain: best.domain, confidence: best.confidence } : null;
}
