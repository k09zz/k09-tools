// Small Markdown helpers shared by the converters.

const cell = (v) => String(v ?? '').replace(/\r?\n+/g, '<br>').replace(/\|/g, '\\|').trim();

/** Renders rows as a GitHub-flavored Markdown table. The first row is the header. */
export function mdTable(rows) {
    const width = Math.max(0, ...rows.map((r) => r.length));
    if (!rows.length || !width) return '';
    const pad = (r) => [...r, ...new Array(width - r.length).fill('')].map(cell);
    const [head, ...body] = rows.map(pad);
    return [
        `| ${head.join(' | ')} |`,
        `| ${head.map(() => '---').join(' | ')} |`,
        ...body.map((r) => `| ${r.join(' | ')} |`),
    ].join('\n');
}

/** Collapses runs of blank lines and trims trailing spaces. */
export function tidy(md) {
    return md.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text) {
    const delimiter = sniffDelimiter(text);
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') {
                field += '"';
                i++;
            } else if (c === '"') {
                quoted = false;
            } else {
                field += c;
            }
        } else if (c === '"' && field === '') {
            quoted = true;
        } else if (c === delimiter) {
            row.push(field);
            field = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += c;
        }
    }
    if (field !== '' || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

function sniffDelimiter(text) {
    const firstLine = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'));
    const counts = [',', ';', '\t', '|'].map((d) => [d, firstLine.split(d).length]);
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][1] > 1 ? counts[0][0] : ',';
}

/**
 * Splits Markdown into chunks of at most maxChars, preferring heading boundaries,
 * then paragraph boundaries. Each chunk carries the nearest heading path for context.
 */
export function chunkMarkdown(md, maxChars) {
    if (!maxChars || maxChars <= 0) return [];
    const blocks = md.split(/\n{2,}/);
    const chunks = [];
    const headings = [];
    let current = '';
    let currentHeadings = '';

    const flush = () => {
        if (current.trim()) chunks.push({ index: chunks.length, headings: currentHeadings, text: current.trim() });
        current = '';
    };

    for (const block of blocks) {
        const h = block.match(/^(#{1,6})\s+(.*)$/m);
        if (h && block.trim().startsWith('#')) {
            flush();
            const level = h[1].length;
            headings.length = level - 1;
            headings[level - 1] = h[2].trim();
            currentHeadings = headings.filter(Boolean).join(' > ');
        }
        if (current && current.length + block.length + 2 > maxChars) flush();
        if (!current) currentHeadings = headings.filter(Boolean).join(' > ');
        if (block.length > maxChars) {
            // A single oversized block (e.g. a long table): split on lines.
            for (const piece of splitLong(block, maxChars)) {
                if (current && current.length + piece.length + 1 > maxChars) flush();
                current += (current ? '\n' : '') + piece;
            }
        } else {
            current += (current ? '\n\n' : '') + block;
        }
    }
    flush();
    return chunks;
}

function splitLong(block, maxChars) {
    const out = [];
    let buf = '';
    for (const line of block.split('\n')) {
        if (line.length > maxChars) {
            if (buf) out.push(buf);
            buf = '';
            for (let i = 0; i < line.length; i += maxChars) out.push(line.slice(i, i + maxChars));
            continue;
        }
        if (buf && buf.length + line.length + 1 > maxChars) {
            out.push(buf);
            buf = '';
        }
        buf += (buf ? '\n' : '') + line;
    }
    if (buf) out.push(buf);
    return out;
}
