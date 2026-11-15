// Domain time can be fixed in workforce tests without changing MongoDB/network deadlines.
export const workforceClock = { now: () => new Date() };
