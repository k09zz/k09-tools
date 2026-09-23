import { isDisposable } from './disposable.js';
import { isFreeProvider, isRoleAccount, suggestDomain } from './syntax.js';

const MAIL_REASONS = {
    'null-mx': 'domain publishes a null MX record (accepts no email)',
    'no-mail': 'domain has no MX or address records',
    'no-domain': 'domain does not exist',
};

/**
 * Builds the output record for one parsed address.
 * `dns` is the MailDomainChecker result, or null when DNS checks are turned off.
 *
 * status:
 *   "ok"      - passed every check we run (the mailbox itself is NOT verified)
 *   "risky"   - usable, but flagged (disposable, role, possible typo, no MX record)
 *   "invalid" - cannot receive email (bad syntax, missing domain, no mail servers)
 *   "unknown" - the DNS lookup failed; retry later
 */
export function classify(parsed, dns, disposableDomains) {
    const base = {
        input: parsed.input,
        email: parsed.email,
        status: 'invalid',
        reasons: [],
        syntaxValid: parsed.syntaxValid,
        domain: parsed.domain,
        mailServer: null,
        mxHosts: [],
        isDisposable: false,
        isRoleAccount: false,
        isFreeProvider: false,
        suggestion: null,
    };
    if (!parsed.syntaxValid) {
        base.reasons.push(`invalid syntax: ${parsed.reason}`);
        return base;
    }

    const { local, domain } = parsed;
    base.isDisposable = isDisposable(domain, disposableDomains);
    base.isRoleAccount = isRoleAccount(local);
    base.isFreeProvider = isFreeProvider(domain);

    const risky = [];
    const invalid = [];

    if (dns) {
        base.mailServer = dns.mailStatus;
        base.mxHosts = dns.mxHosts.slice(0, 5);
        if (MAIL_REASONS[dns.mailStatus]) invalid.push(MAIL_REASONS[dns.mailStatus]);
        if (dns.mailStatus === 'implicit') risky.push('no MX record; mail would fall back to the address record');
    }

    const guess = suggestDomain(domain);
    const cannotReceive = invalid.length > 0;
    if (guess && (guess.confidence === 'high' || cannotReceive)) {
        base.suggestion = `${local}@${guess.domain}`;
        risky.push(`possible typo of ${guess.domain}`);
    }
    if (base.isDisposable) risky.push('disposable / temporary email domain');
    if (base.isRoleAccount) risky.push('role account (reaches a team, not a person)');

    if (invalid.length) {
        base.status = 'invalid';
        base.reasons = [...invalid, ...risky];
    } else if (risky.length) {
        base.status = 'risky';
        base.reasons = dns?.mailStatus === 'unknown' ? [...risky, `DNS lookup failed (${dns.error ?? 'timeout'})`] : risky;
    } else if (dns?.mailStatus === 'unknown') {
        base.status = 'unknown';
        base.reasons = [`DNS lookup failed (${dns.error ?? 'timeout'})`];
    } else {
        base.status = 'ok';
    }
    return base;
}
