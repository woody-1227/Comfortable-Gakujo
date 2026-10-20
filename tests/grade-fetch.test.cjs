const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync('src/Comfortable_Gakujo.user.js', 'utf8');
function setup() {
    const cookies = new Map([['cg_grade_save_enabled', '1']]);
    let page;
    const context = vm.createContext({
        URL, URLSearchParams, FormData, TextEncoder, Uint8Array, crypto: webcrypto,
        location: { href: 'https://gakujo.shizuoka.ac.jp/lcu-web/home', origin: 'https://gakujo.shizuoka.ac.jp' },
        document: {}, console: { warn() {} },
        getCookie: name => cookies.get(name),
        setCookie: (name, value) => cookies.set(name, value),
        showUpdateNotice() {},
    });
    vm.runInContext(source.slice(source.indexOf('    // Resolve only'), source.indexOf('    function showUpdateNotice()')) +
        source.slice(source.indexOf('    async function sha256('), source.indexOf('    function startComfortableGakujo()')), context);
    context.explicitSubmission = () => ({});
    context.fetchPage = async () => {
        if (page instanceof Error) throw page;
        return { doc: page, url: context.location.href };
    };
    return { context, cookies, setPage(value) { page = value; } };
}
function gradePage(rows) {
    const table = {
        querySelector: () => ({}),
        querySelectorAll: () => rows.map(row => ({ querySelectorAll: () => row.map(([label, text]) => ({
            getAttribute: () => label, textContent: text,
        })) })),
    };
    return { getElementById: () => table, querySelectorAll: () => [] };
}
const row = grade => [['科目名', '数学'], ['評価', grade], ['成績報告時期', '2026年度 前期']];
test('first fetch and legacy migration establish a baseline; a changed individual grade notifies', async () => {
    const state = setup();
    state.cookies.set('cg_grade', 'old-chart-hash');
    state.setPage(gradePage([row('良')]));
    await state.context.checkGradeUpdates();
    assert.match(state.cookies.get('cg_grade'), /^detail-v1:/);
    assert.equal(state.cookies.has('cg_grade_updated'), false);
    await state.context.checkGradeUpdates();
    assert.equal(state.cookies.has('cg_grade_updated'), false);
    state.setPage(gradePage([row('優')]));
    await state.context.checkGradeUpdates();
    assert.equal(state.cookies.get('cg_grade_updated'), '1');
});
test('network errors and missing detail tables preserve the baseline', async () => {
    const state = setup();
    state.cookies.set('cg_grade', 'detail-v1:previous');
    for (const page of [new Error('offline'), { getElementById: () => null, querySelectorAll: () => [] }]) {
        state.setPage(page);
        await state.context.checkGradeUpdates();
        assert.equal(state.cookies.get('cg_grade'), 'detail-v1:previous');
        assert.equal(state.cookies.has('cg_grade_updated'), false);
    }
});
test('disabled notifications do not request pages', async () => {
    const state = setup();
    state.cookies.delete('cg_grade_save_enabled');
    state.context.fetchPage = () => assert.fail('unexpected fetch');
    await state.context.checkGradeUpdates();
});
test('row order and presentation whitespace do not change the snapshot', () => {
    const { context } = setup();
    const a = gradePage([row('良'), row('優')]);
    const b = gradePage([row(' 優\n'), row('良')]);
    assert.equal(JSON.stringify(context.gradeSnapshot(a)), JSON.stringify(context.gradeSnapshot(b)));
});
test('fetch submits form fields and CSRF tokens without navigating', async () => {
    const { context } = setup();
    // Restore the real fetch helper, which the comparison tests replace.
    vm.runInContext(source.slice(source.indexOf('    async function fetchPage('), source.indexOf('    async function openCreditInfo(')), context);
    const doc = { querySelector: () => null };
    context.DOMParser = class { parseFromString() { return doc; } };
    let sent;
    context.fetch = async (url, options) => {
        sent = { url, options };
        return { ok: true, url: url.href, text: async () => '<html></html>' };
    };
    const data = new FormData();
    data.append('_csrf', 'fresh-token');
    data.append('filter', '前期');
    await context.fetchPage({ url: new URL('https://gakujo.shizuoka.ac.jp/lcu-web/detail'), method: 'POST', data });
    assert.equal(sent.options.body.get('_csrf'), 'fresh-token');
    assert.equal(sent.options.body.get('filter'), '前期');
    assert.equal(sent.options.credentials, 'same-origin');
    assert.equal(sent.options.cache, 'no-store');
    await context.fetchPage({ url: new URL('https://gakujo.shizuoka.ac.jp/lcu-web/detail'), method: 'GET', data });
    assert.equal(sent.url.searchParams.get('filter'), '前期');
    assert.equal(sent.options.body, undefined);
    context.fetch = async () => ({ ok: false, status: 500 });
    await assert.rejects(context.fetchPage({ url: sent.url, method: 'GET', data }));
});
test('real portal submitFormButton uses the formid token fields and POST target', () => {
    const { context } = setup();
    context.FormData = class extends URLSearchParams { constructor(form) { super(form.fields); } };
    const form = { fields: { _csrf: 'fresh-token' }, getAttribute: () => null };
    const attributes = { onclick: "submitFormButton($(this), '/lcu-web/SC_10004B00_01/forward', '', '');return false;", formid: 'BaseForm' };
    const control = { getAttribute: key => attributes[key] || null, matches: () => false, closest: () => null };
    const request = context.pageSubmission({ getElementById: id => id === 'BaseForm' ? form : null }, context.location.href, control);
    assert.equal(request.method, 'POST');
    assert.equal(request.url.pathname, '/lcu-web/SC_10004B00_01/forward');
    assert.equal(request.data.get('_csrf'), 'fresh-token');
    attributes.onclick = "submitFormButton($(this), 'https://example.org/forward', '', '')";
    assert.throws(() => context.pageSubmission({ getElementById: () => form }, context.location.href, control));
});
