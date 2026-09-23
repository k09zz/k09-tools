// Browser version: loads the CC0 community list of disposable email domains.
// https://github.com/disposable-email-domains/disposable-email-domains
const LIST_URL = 'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf';

let cached;
export function loadDisposableDomains() {
    cached ??= fetch(LIST_URL)
        .then((r) => (r.ok ? r.text() : ''))
        .then((text) => new Set(text.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#'))))
        .catch(() => new Set());
    return cached;
}

/** True if the domain or any parent domain (e.g. x.mailinator.com) is on the list. */
export function isDisposable(domain, domains) {
    const labels = domain.split('.');
    for (let i = 0; i < labels.length - 1; i++) {
        if (domains.has(labels.slice(i).join('.'))) return true;
    }
    return false;
}
