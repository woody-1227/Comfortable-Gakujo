const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/Comfortable_Gakujo.user.js', 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('    function formatTimeLeft('), source.indexOf('    function installHomeTaskCountdown(')), context);
const deadline = context.homeTaskDeadline;
test('read Japanese deadlines, ranges and full-width dates in Japan time', () => {
    const expected = Date.parse('2026-10-21T23:59:00+09:00');
    for (const text of [
        '課題A 2026/10/21 23:59',
        '提出期間 2026/10/01 09:00 ～ 2026/10/21(水) 23:59',
        '締切：２０２６年１０月２１日（水） ２３：５９',
        '締切日時: 2026/10/21 23:59 登録日時: 2026/10/01 09:00',
    ]) assert.equal(deadline(text), expected, text);
    for (const text of ['未定', '2026/02/30 12:00', '2026/13/01 12:00', '2026/10/21 25:00']) {
        assert.ok(Number.isNaN(deadline(text)), text);
    }
});
test('choose the nearest pending deadline and switch after expiry', () => {
    const entries = ['2026/10/20 10:00', '2026/10/21 10:00', '2026/10/22 10:00', '未定'];
    assert.equal(context.nearestHomeDeadline(entries, Date.parse('2026-10-20T12:00:00+09:00')), deadline(entries[1]));
    assert.equal(context.nearestHomeDeadline(entries, deadline(entries[1])), deadline(entries[2]));
    assert.equal(context.nearestHomeDeadline([], Date.now()), Infinity);
    assert.equal(context.nearestHomeDeadline(entries, deadline(entries[2])), Infinity);
});
test('existing and home countdowns share exact color boundaries and reset styles', () => {
    const timer = { style: {} };
    const day = 86400000;
    context.renderDeadlineCountdown(timer, day - 1000);
    assert.equal(timer.style.color, 'red');
    assert.equal(timer.style.fontWeight, 'bold');
    assert.equal(timer.style.textDecoration, 'underline');
    assert.equal(timer.textContent, '残り 23時間 59分 59秒');
    for (const remaining of [day, 3 * day - 1000]) {
        context.renderDeadlineCountdown(timer, remaining);
        assert.equal(timer.style.color, '#FF8C00');
        assert.equal(timer.style.textDecoration, '');
    }
    context.renderDeadlineCountdown(timer, 3 * day);
    assert.equal(timer.style.color, '');
    assert.equal(timer.style.fontWeight, '');
    context.renderDeadlineCountdown(timer, 0);
    assert.equal(timer.textContent, '締切済み');
    assert.equal(timer.style.color, 'red');
    assert.equal(timer.style.textDecoration, '');
});
test('home countdown shows tenths without changing the task list format', () => {
    const ms = (((6 * 24 + 8) * 60 + 1) * 60 + 58) * 1000 + 399;
    assert.equal(context.formatTimeLeft(ms, true), '残り 6日 08時間 01分 58.3秒');
    assert.equal(context.formatTimeLeft(ms), '残り 6日 08時間 01分 58秒');
    assert.equal(context.formatTimeLeft(60000, true), '残り 00時間 01分 00.0秒');
    assert.equal(context.formatTimeLeft(59999, true), '残り 00時間 00分 59.9秒');
    const timer = { style: {} };
    context.renderDeadlineCountdown(timer, 99, true);
    assert.equal(timer.textContent, '残り 00時間 00分 00.0秒');
    context.renderDeadlineCountdown(timer, 0, true);
    assert.equal(timer.textContent, '締切済み');
});
test('hundredths keep two digits and roll over correctly', () => {
    assert.equal(context.formatTimeLeft(58399, 2), '残り 00時間 00分 58.39秒');
    assert.equal(context.formatTimeLeft(58009, 2), '残り 00時間 00分 58.00秒');
    assert.equal(context.formatTimeLeft(59999, 2), '残り 00時間 00分 59.99秒');
    assert.equal(context.formatTimeLeft(60000, 2), '残り 00時間 01分 00.00秒');
});
test('deadline background temporarily overrides and releases the saved image', () => {
    const visual = { dataset: {}, style: { backgroundImage: 'url(custom.png)' } };
    const day = 86400000;
    for (const [remaining, expected] of [[3 * day, undefined], [3 * day - 1, 'warning'], [day, 'warning'], [day - 1, 'critical'], [0, undefined], [1000, 'critical'], [Infinity, undefined], [NaN, undefined]]) {
        context.updateDeadlineBackground(visual, remaining);
        assert.equal(visual.dataset.cgDeadlineUrgency, expected);
        assert.equal(visual.style.backgroundImage, 'url(custom.png)');
    }
    context.updateDeadlineBackground(null, 1000);
});
