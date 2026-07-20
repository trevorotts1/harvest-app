import { DEFAULT_TIME_WINDOWS, isWithinAWindow, nextAvailableWindowSlot } from './scheduling-windows';

describe('scheduling-windows — §11.5 "time-of-day windows configurable"', () => {
  test('nextAvailableWindowSlot fills same-day windows before spilling to the next day', () => {
    const from = new Date('2026-07-20T00:00:00Z'); // a Monday
    const slot0 = nextAvailableWindowSlot(from, 0);
    const slot1 = nextAvailableWindowSlot(from, 1);
    const slot2 = nextAvailableWindowSlot(from, 2);
    const slot3 = nextAvailableWindowSlot(from, 3); // wraps to day 2
    expect(slot0.getUTCHours()).toBe(DEFAULT_TIME_WINDOWS[0].startHour);
    expect(slot1.getUTCHours()).toBe(DEFAULT_TIME_WINDOWS[1].startHour);
    expect(slot2.getUTCHours()).toBe(DEFAULT_TIME_WINDOWS[2].startHour);
    expect(slot3.getUTCDate()).toBe(from.getUTCDate() + 1);
    expect(slot3.getUTCHours()).toBe(DEFAULT_TIME_WINDOWS[0].startHour);
  });

  test('isWithinAWindow correctly classifies inside/outside the default windows', () => {
    expect(isWithinAWindow(new Date('2026-07-20T09:00:00Z'))).toBe(true);
    expect(isWithinAWindow(new Date('2026-07-20T23:00:00Z'))).toBe(false);
  });
});
