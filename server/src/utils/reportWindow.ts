export const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** Số ngày mặc định của Dashboard; trang khách dùng cùng giá trị cho "món bán chạy". */
export const DEFAULT_REPORT_DAYS = 30;

export function startOfDayVietnam(date: Date): Date {
  const vietnam = new Date(date.getTime() + VIETNAM_OFFSET_MS);
  return new Date(
    Date.UTC(vietnam.getUTCFullYear(), vietnam.getUTCMonth(), vietnam.getUTCDate()) -
      VIETNAM_OFFSET_MS,
  );
}

export function endOfDayVietnam(date: Date): Date {
  return new Date(startOfDayVietnam(date).getTime() + DAY_MS - 1);
}

/** [from, until) của kỳ mặc định: từ 0h ngày (hôm nay − 29) đến hết hôm nay, giờ Việt Nam. */
export function defaultReportWindow(now = new Date()): { from: Date; until: Date } {
  const from = startOfDayVietnam(new Date(now.getTime() - (DEFAULT_REPORT_DAYS - 1) * DAY_MS));
  const until = new Date(endOfDayVietnam(now).getTime() + 1);
  return { from, until };
}
