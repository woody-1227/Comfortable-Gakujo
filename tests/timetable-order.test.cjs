const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/Comfortable_Gakujo.user.js', 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('    function formatClassPeriod('), source.indexOf('    function installReferenceTimetableOrder(')), context);
function node(tag) {
    return { tagName: tag.toUpperCase(), children: [], dataset: {}, appendChild(child) {
        if (child.parentElement) {
            const siblings = child.parentElement.children;
            siblings.splice(siblings.indexOf(child), 1);
        }
        child.parentElement = this;
        this.children.push(child);
        return child;
    }, replaceChildren(fragment) {
        this.children = [];
        for (const child of [...fragment.children]) this.appendChild(child);
    } };
}
function makeSelect(options, value) {
    const select = node('select');
    select.ownerDocument = { createDocumentFragment: () => node('fragment'), createElement: node };
    Object.defineProperty(select, 'options', { get() {
        return this.children.flatMap(child => child.tagName === 'OPTGROUP' ? child.children : [child]);
    } });
    for (const [value, label] of options) select.appendChild(Object.assign(node('option'), { value, textContent: label }));
    select.value = value;
    return select;
}
test('group weekdays, sort periods, label all meetings, and keep the selected course', () => {
    const select = makeSelect([
        ['', ''], ['22222222_C1', 'Friday'], ['33333333_C1', 'Intensive'],
        ['11111111_C1', 'Monday late'], ['44444444_C1', 'Monday early'],
    ], '22222222_C1');
    const timetable = { year: '2026', semester: '後期',
        order: new Map([['22222222C1', 405], ['11111111C1', 5], ['44444444C1', 1]]),
        slots: new Map([
            ['22222222C1', [{ order: 405, day: 4, period: '5・6時限' }]],
            ['11111111C1', [{ order: 5, day: 0, period: '5・6時限' }, { order: 105, day: 1, period: '5・6時限' }]],
            ['44444444C1', [{ order: 1, day: 0, period: '1・2時限' }]],
        ]),
    };
    assert.equal(context.sortReferenceOptions(select, timetable, '2026', '後期'), true);
    assert.deepEqual(select.children.filter(n => n.tagName === 'OPTGROUP').map(g => g.label), ['月曜日', '金曜日', '曜日・時限未確認']);
    assert.deepEqual(select.options.map(o => o.value), ['', '44444444_C1', '11111111_C1', '22222222_C1', '33333333_C1']);
    assert.equal(select.options[2].textContent, '月曜 3コマ、火曜 3コマ｜Monday late');
    assert.equal(select.value, '22222222_C1');
    // Repeated observer callbacks must leave the DOM intact and avoid duplicate labels.
    const groups = [...select.children];
    context.sortReferenceOptions(select, timetable, '2026', '後期');
    assert.deepEqual(select.children, groups);
    assert.equal(context.sortReferenceOptions(select, timetable, '2025', '後期'), false);
    assert.deepEqual(select.options.map(o => o.textContent), ['', 'Friday', 'Intensive', 'Monday late', 'Monday early']);
    assert.equal(select.children.some(n => n.tagName === 'OPTGROUP'), false);
    assert.equal(select.value, '22222222_C1');
});
test('registration table IDs map to course values and repeated slots are deduplicated', () => {
    const cell = (day, ids) => ({ id: `week${day}`, querySelectorAll: () => ids.map(id => ({ id })) });
    const rows = [
        { querySelector: () => ({ textContent: '５・６時限' }), querySelectorAll: () => [cell(2, ['202611111111C1'])] },
        { querySelector: () => ({ textContent: '1・2時限' }), querySelectorAll: () => [cell(1, ['202611111111C1', '202622222222C1'])] },
        { querySelector: () => ({ textContent: '1・2時限' }), querySelectorAll: () => [cell(1, ['202611111111C1'])] },
    ];
    const doc = { querySelectorAll: () => rows, querySelector: selector => ({ textContent: selector.includes('.year') ? '2026年度' : '後期' }) };
    const timetable = context.collectTimetableOrder(doc);
    assert.equal(timetable.year, '2026');
    assert.equal(timetable.semester, '後期');
    assert.equal(timetable.order.get('11111111C1'), 1);
    assert.equal(timetable.order.size, 2);
    assert.equal(timetable.slots.get('11111111C1').length, 2);
    assert.equal(timetable.slots.get('11111111C1')[0].period, '5・6時限');
});

test('two consecutive periods form one class slot', () => {
    for (let slot = 1; slot <= 7; slot++) {
        assert.equal(context.formatClassPeriod(`${slot * 2 - 1}・${slot * 2}時限`), `${slot}コマ`);
    }
    assert.equal(context.formatClassPeriod('３・４時限'), '2コマ');
    assert.equal(context.formatClassPeriod('1～6時限'), '1・2・3コマ');
    assert.equal(context.formatClassPeriod('集中'), '集中');
});
