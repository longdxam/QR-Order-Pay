import type { WorkforceWeek } from '@may-cafe/contracts';

const COLUMNS = [
  'Nhân viên',
  'Lịch / Thực tế (giờ)',
  'Vắng / Trễ / Chưa ra',
  'Nhận / Pha / Sẵn sàng / Giao',
  'Ngoài ca',
  'Pha TB (phút)',
  'Sao đơn đã giao',
];

/** Hiệu suất tuần theo nhân viên: giờ làm, chuyên cần và thao tác KDS. */
export function MetricsTable({
  data,
  admin,
}: {
  data: WorkforceWeek;
  admin: boolean;
}): JSX.Element {
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Chỉ ghi nhận thao tác KDS từ khi bật tính năng. Mỗi công đoạn tính cho người bấm; thời gian
        pha từ Bắt đầu pha → Sẵn sàng tính cho người bắt đầu pha, theo tuần hoàn tất pha. Sao là
        đánh giá đơn do người đó giao, kèm số mẫu; không phải điểm cá nhân.
      </p>
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Hiệu suất nhân viên trong tuần đã chọn</caption>
          <thead className="bg-muted">
            <tr>
              {COLUMNS.map((h) => (
                <th className="whitespace-nowrap p-3" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.metrics.map((m) => (
              <tr key={m.staffId} className="border-t">
                <th scope="row" className="whitespace-nowrap p-3">
                  {m.staffName}
                </th>
                <td className="p-3">
                  {(m.scheduledMinutes / 60).toFixed(1)} / {(m.workedMinutes / 60).toFixed(1)}
                </td>
                <td className="p-3">
                  {m.absentShifts} / {m.lateShifts} / {m.openAttendances}
                </td>
                <td className="p-3">
                  {m.confirmed} / {m.preparing} / {m.ready} / {m.served}
                </td>
                <td className="p-3">{m.outsideShiftActions}</td>
                <td className="whitespace-nowrap p-3">
                  {m.averagePreparationMinutes === null
                    ? 'Chưa có mẫu'
                    : `${m.averagePreparationMinutes} (${m.preparationSamples} mẫu)`}
                </td>
                <td className="whitespace-nowrap p-3">
                  {m.averageOrderRating === null
                    ? 'Chưa có mẫu'
                    : `${m.averageOrderRating}/5 (${m.reviewedOrders} đơn)`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.metrics.length ? <p>Chưa có dữ liệu trong tuần này.</p> : null}
      <p className="text-sm text-muted-foreground">
        Giờ thực tế được chia theo ranh giới tuần; ca chưa ra không tự cộng giờ. Thao tác ngoài ca
        vẫn ghi nhận. Điều chỉnh chấm công không đổi người/ca đã gắn với thao tác KDS.
      </p>
      {admin ? (
        <p className="text-sm">
          Đối soát chênh lệch tiền xem tại tab Đối soát ca thu ngân. Lịch làm không chia chênh lệch
          tiền cho từng nhân viên.
        </p>
      ) : null}
    </section>
  );
}
