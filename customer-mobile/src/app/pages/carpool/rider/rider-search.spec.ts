import { clampDate, clampSeats, getHorizonDays, getSeatsMax, setHorizonDays, setSeatsMax } from './rider-search';
import { addDays, indiaDate } from './rider-format';

describe('rider seat limit', () => {
  afterEach(() => setSeatsMax(undefined));

  it('falls back to 6 until the server says otherwise', () => {
    expect(getSeatsMax()).toBe(6);
    expect(clampSeats(9)).toBe(6);
  });

  it('follows the limit sent in /carpool/config', () => {
    setSeatsMax(3);
    expect(getSeatsMax()).toBe(3);
    expect(clampSeats(5)).toBe(3);
    expect(clampSeats(2)).toBe(2);
  });

  it('ignores a missing or silly limit', () => {
    setSeatsMax(0);
    expect(getSeatsMax()).toBe(6);
    setSeatsMax(NaN);
    expect(getSeatsMax()).toBe(6);
  });

  it('never goes below one seat', () => {
    setSeatsMax(4);
    expect(clampSeats(0)).toBe(1);
    expect(clampSeats(Number.NaN)).toBe(1);
  });
});

describe('rider search horizon', () => {
  afterEach(() => setHorizonDays(undefined));

  it('falls back to 30 days until the server says otherwise', () => {
    expect(getHorizonDays()).toBe(30);
    expect(clampDate(addDays(indiaDate(), 45))).toBe(addDays(indiaDate(), 30));
  });

  it('follows the days sent in /carpool/config', () => {
    setHorizonDays(7);
    expect(getHorizonDays()).toBe(7);
    expect(clampDate(addDays(indiaDate(), 20))).toBe(addDays(indiaDate(), 7));
    expect(clampDate(addDays(indiaDate(), 5))).toBe(addDays(indiaDate(), 5));
  });

  it('allows a longer window when the admin raises it', () => {
    setHorizonDays(60);
    expect(clampDate(addDays(indiaDate(), 45))).toBe(addDays(indiaDate(), 45));
  });

  it('ignores a missing or silly value', () => {
    setHorizonDays(0);
    expect(getHorizonDays()).toBe(30);
    setHorizonDays(NaN);
    expect(getHorizonDays()).toBe(30);
  });
});
