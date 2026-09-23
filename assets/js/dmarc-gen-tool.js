const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i;

function mailtoList(raw) {
    const list = raw.split(/[\s,;]+/).filter(Boolean);
    const bad = list.filter((e) => !EMAIL_RE.test(e.replace(/^mailto:/i, '')));
    return { value: list.map((e) => `mailto:${e.replace(/^mailto:/i, '')}`).join(','), bad };
}

function update() {
    const domain = $('#domain').value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'example.com';
    const tags = [`v=DMARC1`, `p=${$('#p').value}`];
    const sp = $('#sp').value;
    if (sp) tags.push(`sp=${sp}`);
    const pct = Number($('#pct').value);
    if ($('#p').value !== 'none' && pct < 100) tags.push(`pct=${pct}`);
    const rua = mailtoList($('#rua').value);
    const ruf = mailtoList($('#ruf').value);
    if (rua.value) tags.push(`rua=${rua.value}`);
    if (ruf.value) tags.push(`ruf=${ruf.value}`, 'fo=1');
    if ($('#strict').checked) tags.push('adkim=s', 'aspf=s');

    $('#host').textContent = `_dmarc.${domain}`;
    $('#record').textContent = tags.join('; ');
    const notes = [];
    if (!rua.value) notes.push('No report address: you won\'t see who is sending as your domain. Adding one is strongly recommended.');
    if ([...rua.bad, ...ruf.bad].length) notes.push(`Not a valid email: ${esc([...rua.bad, ...ruf.bad].join(', '))}`);
    const external = [...new Set([rua.value, ruf.value].join(',').split(',').filter(Boolean)
        .map((m) => m.split('@')[1]?.toLowerCase()).filter((d) => d && d !== domain && !d.endsWith(`.${domain}`)))];
    if (external.length && domain !== 'example.com') {
        notes.push(`Reports go to another domain (${esc(external.join(', '))}): it must publish an authorization record (<code>${esc(domain)}._report._dmarc.&lt;their domain&gt;</code>). DMARC reporting services do this for you.`);
    }
    if ($('#p').value === 'reject' && !rua.value) notes.push('Using p=reject without reports is risky: you won\'t notice if legitimate mail starts failing.');
    $('#notes').innerHTML = notes.map((n) => `<div class="hint">${n}</div>`).join('');
    $('#pct-wrap').style.display = $('#p').value === 'none' ? 'none' : '';
    $('#pct-label').textContent = `${pct}%`;
}

document.querySelector('#dmarc-form').addEventListener('input', update);
$('#copy').addEventListener('click', async (e) => { await navigator.clipboard.writeText($('#record').textContent); e.target.textContent = 'Copied'; });
update();
