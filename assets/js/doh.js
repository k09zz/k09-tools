// DNS lookups from the browser via DNS-over-HTTPS (Cloudflare, falling back to Google).
// Same interface as the Actors' DNS client: txt/mx/cname -> { status, records }.

const PROVIDERS = [
    (name, type) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    (name, type) => `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
];
const TYPE = { A: 1, CNAME: 5, MX: 15, TXT: 16, AAAA: 28 };

async function query(name, type) {
    let lastError;
    for (const url of PROVIDERS) {
        try {
            const res = await fetch(url(name, type), { headers: { accept: 'application/dns-json' } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            if (json.Status === 3) return { status: 'nxdomain', records: [] };
            if (json.Status !== 0) throw new Error(`DNS status ${json.Status}`);
            return { status: 'ok', answers: (json.Answer ?? []).filter((a) => a.type === TYPE[type]) };
        } catch (err) {
            lastError = err;
        }
    }
    return { status: 'error', records: [], error: lastError?.message };
}

// TXT data arrives as one or more quoted strings: "v=spf1 ..." "more"
const unquoteTxt = (data) => (data.match(/"((?:[^"\\]|\\.)*)"/g) ?? [data]).map((s) => s.replace(/^"|"$/g, '').replace(/\\"/g, '"')).join('');

export class DohClient {
    constructor() {
        this.cache = new Map();
    }

    #cached(key, fn) {
        if (!this.cache.has(key)) this.cache.set(key, fn());
        return this.cache.get(key);
    }

    txt(name) {
        return this.#cached(`TXT ${name}`, async () => {
            const r = await query(name, 'TXT');
            if (r.status !== 'ok') return r;
            const records = r.answers.map((a) => unquoteTxt(a.data));
            return { status: records.length ? 'ok' : 'nodata', records };
        });
    }

    mx(name) {
        return this.#cached(`MX ${name}`, async () => {
            const r = await query(name, 'MX');
            if (r.status !== 'ok') return r;
            const records = r.answers.map((a) => {
                const [priority, exchange] = a.data.split(/\s+/);
                return { priority: Number(priority), exchange: (exchange ?? '').replace(/\.$/, '') };
            }).sort((a, b) => a.priority - b.priority);
            return { status: records.length ? 'ok' : 'nodata', records };
        });
    }

    cname(name) {
        return this.#cached(`CNAME ${name}`, async () => {
            const r = await query(name, 'CNAME');
            if (r.status !== 'ok') return r;
            const records = r.answers.map((a) => a.data.replace(/\.$/, ''));
            return { status: records.length ? 'ok' : 'nodata', records };
        });
    }

    /** Mail-server check in the shape the email classifier expects. */
    async mailStatus(domain) {
        const mx = await this.mx(domain);
        if (mx.status === 'nxdomain') return { mailStatus: 'no-domain', mxHosts: [] };
        if (mx.status === 'error') return { mailStatus: 'unknown', mxHosts: [], error: mx.error };
        const hosts = mx.records.filter((r) => r.exchange && r.exchange !== '.').map((r) => r.exchange.toLowerCase());
        if (hosts.length) return { mailStatus: 'mx', mxHosts: hosts };
        if (mx.records.length) return { mailStatus: 'null-mx', mxHosts: [] };
        // No MX: RFC 5321 falls back to the address record.
        for (const type of ['A', 'AAAA']) {
            const r = await query(domain, type);
            if (r.status === 'ok' && r.answers.length) return { mailStatus: 'implicit', mxHosts: [] };
        }
        return { mailStatus: 'no-mail', mxHosts: [] };
    }
}
