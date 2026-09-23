// Turns pdf.js text items into lines, cells and whitespace-aligned tables.
// Pure functions over plain objects so they can be unit-tested without a PDF.

/**
 * @typedef {{ str: string, x: number, y: number, w: number, size: number }} Item
 *   x/y: left/baseline position in PDF units (y grows upwards); w: width; size: font size.
 * @typedef {{ text: string, x0: number, x1: number }} Cell
 * @typedef {{ y: number, size: number, cells: Cell[] }} Line
 */

/** Converts raw pdf.js text-content items into simple Items. */
export function toItems(pdfItems) {
    const out = [];
    for (const it of pdfItems) {
        if (!it.str || !it.str.trim() || !it.transform) continue;
        const [a, b, c, d, e, f] = it.transform;
        const size = Math.hypot(c, d) || Math.hypot(a, b) || it.height || 10;
        out.push({ str: it.str, x: e, y: f, w: it.width ?? it.str.length * size * 0.5, size });
    }
    return out;
}

/**
 * Groups items into lines (top to bottom), and each line into cells.
 * Items closer than `wordGap` × font size join into one cell (with a space when there is a visible gap);
 * wider gaps start a new cell, which is how columns are detected.
 */
export function buildLines(items, { wordGap = 1.2 } = {}) {
    const sorted = [...items].sort((p, q) => q.y - p.y || p.x - q.x);
    const lines = [];
    for (const it of sorted) {
        const line = lines[lines.length - 1];
        if (line && Math.abs(line.y - it.y) <= Math.max(line.size, it.size) * 0.45) {
            line.items.push(it);
            line.size = Math.max(line.size, it.size);
        } else {
            lines.push({ y: it.y, size: it.size, items: [it] });
        }
    }

    return lines.map(({ y, size, items: lineItems }) => {
        lineItems.sort((p, q) => p.x - q.x);
        const cells = [];
        for (const it of lineItems) {
            const cell = cells[cells.length - 1];
            const gap = cell ? it.x - cell.x1 : Infinity;
            if (cell && gap <= wordGap * size) {
                const needsSpace = gap > size * 0.12 && !cell.text.endsWith(' ') && !it.str.startsWith(' ');
                cell.text += (needsSpace ? ' ' : '') + it.str;
                cell.x1 = Math.max(cell.x1, it.x + it.w);
            } else {
                cells.push({ text: it.str, x0: it.x, x1: it.x + it.w });
            }
        }
        for (const c of cells) c.text = c.text.replace(/\s+/g, ' ').trim();
        return { y, size, cells: cells.filter((c) => c.text) };
    }).filter((l) => l.cells.length);
}

/**
 * Plain text for a page: one line per text line, table cells separated by a tab.
 * Runs of side-by-side prose columns (not tables) are read left column first, then right.
 */
export function linesToText(lines, tables = []) {
    const inTable = new Set(tables.flatMap((t) => range(t.startLine, t.endLine)));
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const run = inTable.has(i) ? 0 : proseColumnRun(lines, i, inTable);
        if (run >= 4) {
            const block = lines.slice(i, i + run);
            out.push(...block.map((l) => l.cells[0].text), '', ...block.map((l) => l.cells[1].text));
            i += run;
        } else {
            out.push(lines[i].cells.map((c) => c.text).join('\t'));
            i++;
        }
    }
    return out.join('\n');
}

// Length of a run of 2-cell lines starting at `start` whose left and right cells start at stable x positions.
function proseColumnRun(lines, start, inTable) {
    const first = lines[start];
    if (first.cells.length !== 2) return 0;
    const tol = first.size;
    let n = 0;
    while (start + n < lines.length && !inTable.has(start + n)) {
        const l = lines[start + n];
        if (l.cells.length !== 2 || Math.abs(l.cells[0].x0 - first.cells[0].x0) > tol
            || Math.abs(l.cells[1].x0 - first.cells[1].x0) > tol) break;
        n++;
    }
    return n;
}

function range(a, b) {
    return Array.from({ length: b - a + 1 }, (_, k) => a + k);
}

/**
 * Finds tables: runs of at least `minRows` consecutive multi-cell lines whose cells line up in
 * at least `minCols` columns. Returns { rows: string[][], startLine, endLine } for each table.
 */
export function detectTables(lines, { minRows = 3, minCols = 2 } = {}) {
    const tables = [];
    let i = 0;
    while (i < lines.length) {
        if (lines[i].cells.length < minCols) {
            i++;
            continue;
        }
        // Grow a block of consecutive multi-cell lines with no large vertical gap.
        let j = i + 1;
        while (j < lines.length && lines[j].cells.length >= minCols && verticalGapOk(lines[j - 1], lines[j], lines.slice(i, j))) j++;
        const block = lines.slice(i, j);
        const table = block.length >= minRows ? blockToTable(block, minCols) : null;
        if (table) tables.push({ ...table, startLine: i, endLine: j - 1 });
        i = j;
    }
    return tables;
}

function verticalGapOk(prev, next, blockSoFar) {
    const gap = prev.y - next.y;
    if (blockSoFar.length < 2) return gap <= prev.size * 3;
    const gaps = blockSoFar.slice(1).map((l, k) => blockSoFar[k].y - l.y);
    const typical = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    return gap <= Math.max(typical * 1.8, prev.size * 1.5);
}

/** Builds column bands from the widest rows, then places every cell into its best band. */
function blockToTable(block, minCols) {
    const maxCells = Math.max(...block.map((l) => l.cells.length));
    const bands = [];
    for (const line of block.filter((l) => l.cells.length === maxCells)) {
        for (const c of line.cells) {
            const hit = bands.find((b) => overlap(b, c) > 0);
            if (hit) {
                hit.x0 = Math.min(hit.x0, c.x0);
                hit.x1 = Math.max(hit.x1, c.x1);
            } else {
                bands.push({ x0: c.x0, x1: c.x1 });
            }
        }
    }
    bands.sort((a, b) => a.x0 - b.x0);
    // Bands that grew into each other are one column.
    const cols = [];
    for (const b of bands) {
        const last = cols[cols.length - 1];
        if (last && b.x0 <= last.x1) last.x1 = Math.max(last.x1, b.x1);
        else cols.push({ ...b });
    }
    if (cols.length < minCols) return null;

    const rows = block.map((line) => {
        const row = new Array(cols.length).fill('');
        for (const c of line.cells) {
            const k = bestColumn(cols, c);
            row[k] = row[k] ? `${row[k]} ${c.text}` : c.text;
        }
        return row;
    });
    // Reject blocks where most rows only fill one column (that's prose, not a table).
    const filled = rows.filter((r) => r.filter(Boolean).length >= minCols).length;
    if (filled / rows.length < 0.6) return null;
    // Reject side-by-side prose columns: table cells are short, sentence fragments are long.
    const wordCounts = rows.flat().filter(Boolean).map((v) => v.split(' ').length).sort((a, b) => a - b);
    if (wordCounts[Math.floor(wordCounts.length / 2)] > 5) return null;
    return { rows, columnCount: cols.length };
}

function overlap(a, b) {
    return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
}

function bestColumn(cols, cell) {
    let best = 0;
    let bestScore = -Infinity;
    cols.forEach((col, k) => {
        const ov = overlap(col, cell);
        // Prefer real overlap; otherwise the nearest column by center distance.
        const score = ov > 0 ? ov : -Math.abs((col.x0 + col.x1) / 2 - (cell.x0 + cell.x1) / 2) - 1e6;
        if (score > bestScore) {
            bestScore = score;
            best = k;
        }
    });
    return best;
}

export function toCsv(rows) {
    return rows.map((r) => r.map((v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\r\n');
}

/** Parses "1-3,5,8-" into a predicate over 1-based page numbers. Empty means all pages. */
export function parsePageRange(spec) {
    if (!spec || !String(spec).trim()) return () => true;
    const parts = String(spec).split(',').map((s) => s.trim()).filter(Boolean).map((p) => {
        const m = p.match(/^(\d*)\s*-\s*(\d*)$/);
        if (m) return [m[1] ? Number(m[1]) : 1, m[2] ? Number(m[2]) : Infinity];
        if (/^\d+$/.test(p)) return [Number(p), Number(p)];
        throw new Error(`Invalid page range "${p}". Use e.g. "1-3,5,10-".`);
    });
    return (n) => parts.some(([a, b]) => n >= a && n <= b);
}
