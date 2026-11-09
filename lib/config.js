// Round durations (seconds) aur lock window (round start ke kitne sec baad predictions band)
export const DURATIONS = [
  { sec: 300, lock: 120 },
  { sec: 900, lock: 300 },
  { sec: 3600, lock: 900 },
];
// Virtual points (non-cash). Yahin se change kar sakte ho.
export const POINTS = {
  correct: { AP: 50, XP: 10 },
  wrong: { XP: 2 },
  dailyLogin: { AP: 100 },
};
export const MAX_SNAPSHOT_AGE_SEC = 120;
