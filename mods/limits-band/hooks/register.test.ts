import { test, expect } from 'claude-code/testing'
import { resetsIn, resetsAtLabel } from './register'

// Built from local time so the expectations hold in any timezone.
const local = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime()
const iso = (t: number) => new Date(t).toISOString()

test('formats reset countdowns with the local reset time', () => {
  const now = local(7, 10) // Wed 7 Oct, 10:00
  expect(resetsIn(iso(local(7, 12, 14)), now)).toBe('resets in 2h 14m (12:14)')
  expect(resetsIn(iso(local(7, 10, 5)), now)).toBe('resets in 5m (10:05)')
  expect(resetsIn(iso(local(8, 9)), now)).toBe('resets in 23h 0m (tomorrow 09:00)')
  expect(resetsIn(iso(local(9, 13)), now)).toBe('resets in 2d 3h (Fri 13:00)')
  expect(resetsIn(undefined, now)).toBe('')
})

test('labels the day by calendar date, not by 24h distance', () => {
  expect(resetsAtLabel(new Date(local(8, 1)), new Date(local(7, 23)))).toBe('tomorrow 01:00')
})
