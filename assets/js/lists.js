// Static reference lists. The disposable-domain list is loaded separately (see disposable.js).

// Large consumer mailbox providers. Used for the `isFreeProvider` flag and for typo suggestions.
export const FREE_PROVIDERS = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.de', 'yahoo.es', 'yahoo.it',
    'yahoo.ca', 'yahoo.com.au', 'yahoo.co.in', 'yahoo.co.jp', 'ymail.com', 'rocketmail.com',
    'outlook.com', 'outlook.fr', 'outlook.de', 'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de',
    'hotmail.it', 'hotmail.es', 'live.com', 'live.co.uk', 'live.fr', 'msn.com',
    'aol.com', 'icloud.com', 'me.com', 'mac.com',
    'proton.me', 'protonmail.com', 'pm.me', 'tutanota.com', 'tuta.io',
    'gmx.com', 'gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch', 'web.de', 't-online.de', 'freenet.de',
    'mail.com', 'email.com', 'zoho.com', 'zohomail.com', 'yandex.com', 'yandex.ru', 'ya.ru',
    'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'rambler.ru',
    'orange.fr', 'wanadoo.fr', 'free.fr', 'laposte.net', 'sfr.fr',
    'libero.it', 'virgilio.it', 'alice.it', 'tiscali.it',
    'seznam.cz', 'wp.pl', 'o2.pl', 'interia.pl', 'onet.pl',
    'btinternet.com', 'sky.com', 'virginmedia.com', 'ntlworld.com',
    'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'bellsouth.net', 'charter.net', 'cox.net',
    'earthlink.net', 'optonline.net', 'shaw.ca', 'rogers.com', 'sympatico.ca',
    'bigpond.com', 'optusnet.com.au', 'xtra.co.nz',
    'qq.com', '163.com', '126.com', 'sina.com', 'naver.com', 'daum.net', 'hanmail.net',
    'rediffmail.com', 'uol.com.br', 'bol.com.br', 'terra.com.br', 'hey.com', 'fastmail.com',
]);

// Domains we compare against when looking for typos. Kept short on purpose: only
// providers common enough that a near-miss is far more likely a typo than a real domain.
export const TYPO_TARGETS = [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com',
    'live.com', 'msn.com', 'comcast.net', 'protonmail.com', 'googlemail.com',
    'hotmail.co.uk', 'yahoo.co.uk', 'btinternet.com', 'verizon.net', 'sbcglobal.net', 'att.net',
];

// Common mistyped top-level domains, applied to any domain.
export const TLD_FIXES = {
    con: 'com', cmo: 'com', ocm: 'com', vom: 'com', xom: 'com', comm: 'com', coom: 'com', cpm: 'com',
    nte: 'net', ner: 'net', nett: 'net', ogr: 'org', orgg: 'org',
};

// Local parts that usually reach a team or a system rather than one person.
export const ROLE_LOCAL_PARTS = new Set([
    'admin', 'administrator', 'info', 'information', 'contact', 'contactus', 'hello', 'hi', 'team',
    'support', 'help', 'helpdesk', 'service', 'customerservice', 'care', 'sales', 'marketing',
    'billing', 'accounts', 'accounting', 'finance', 'invoices', 'payments', 'orders', 'office',
    'hr', 'jobs', 'careers', 'recruiting', 'press', 'media', 'pr', 'news', 'newsletter',
    'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon', 'postmaster', 'hostmaster',
    'webmaster', 'abuse', 'security', 'privacy', 'legal', 'compliance', 'root', 'sysadmin', 'it',
    'dev', 'devops', 'enquiries', 'enquiry', 'inquiries', 'feedback', 'general', 'reception', 'all',
    'staff', 'everyone', 'list', 'subscribe', 'unsubscribe',
]);
