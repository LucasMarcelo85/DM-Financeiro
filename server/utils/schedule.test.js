import assert from 'node:assert/strict';
import test from 'node:test';
import {
  firstOccurrence,
  occurrenceAfter,
  occurrenceAfterPaid,
  parseISODate,
  payableDues,
  toISODate,
  zonedToUtc,
} from './schedule.js';

const date = (value) => parseISODate(value);
const at = (day, time) => zonedToUtc(date(day), time);

test('one-time until-paid billing falls back to the due date if the early reminder time passed', () => {
  const schedule = {
    recurrence: 'avulsa',
    untilPaid: true,
    dueDate: date('2026-12-10'),
    daysBefore: 3,
    sendTime: '09:00',
  };

  const occurrence = firstOccurrence(schedule, at('2026-12-07', '10:00'));

  assert.equal(toISODate(occurrence.nextDueDate), '2026-12-10');
  assert.equal(occurrence.nextRunAt.getTime(), at('2026-12-10', '09:00').getTime());
});

test('one-time until-paid billing repeats daily after its due date', () => {
  const schedule = {
    recurrence: 'avulsa',
    untilPaid: true,
    dueDate: date('2026-12-10'),
    daysBefore: 2,
    sendTime: '09:00',
  };

  const beforeDue = occurrenceAfter(schedule, at('2026-12-08', '09:01'));
  const afterDue = occurrenceAfter(schedule, at('2026-12-10', '09:01'));

  assert.equal(toISODate(beforeDue.nextDueDate), '2026-12-10');
  assert.equal(beforeDue.nextRunAt.getTime(), at('2026-12-10', '09:00').getTime());
  assert.equal(toISODate(afterDue.nextDueDate), '2026-12-10');
  assert.equal(afterDue.nextRunAt.getTime(), at('2026-12-11', '09:00').getTime());
});

test('monthly until-paid billing repeats daily after due and resumes the next month when paid', () => {
  const schedule = {
    recurrence: 'mensal',
    untilPaid: true,
    dueDate: date('2026-12-10'),
    nextDueDate: date('2026-12-10'),
    daysBefore: 3,
    sendTime: '09:00',
  };

  const overdue = occurrenceAfter(schedule, at('2026-12-10', '09:01'));
  const nextMonth = occurrenceAfterPaid(schedule, at('2026-12-10', '10:00'));

  assert.equal(toISODate(overdue.nextDueDate), '2026-12-10');
  assert.equal(overdue.nextRunAt.getTime(), at('2026-12-11', '09:00').getTime());
  assert.equal(toISODate(nextMonth.nextDueDate), '2027-01-10');
  assert.equal(nextMonth.nextRunAt.getTime(), at('2027-01-07', '09:00').getTime());
});

test('overdue monthly until-paid installments remain payable even when older than the recent history window', () => {
  const schedule = {
    recurrence: 'mensal',
    untilPaid: true,
    dueDate: date('2025-01-10'),
    nextDueDate: date('2025-01-10'),
  };

  assert.ok(payableDues(schedule, date('2026-11-18')).some((due) => toISODate(due) === '2025-01-10'));
});

test('one-time billing without until-paid remains a one-shot schedule', () => {
  const schedule = {
    recurrence: 'avulsa',
    untilPaid: false,
    dueDate: date('2026-12-10'),
    daysBefore: 3,
    sendTime: '09:00',
  };

  assert.equal(firstOccurrence(schedule, at('2026-12-07', '10:00')), null);
});
