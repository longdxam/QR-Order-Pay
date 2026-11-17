import { Users } from 'lucide-react';
import type { WorkforceWeek } from '@may-cafe/contracts';
import { Button } from '../../../components/ui/Button';
import { WorkforcePeaksPanel } from '../WorkforceExtras';
import { stamp, time, type Editor } from './format';

/** Admin: nhu cầu nhân sự theo khung giờ và mức đã xếp/đang chấm công. */
export function CoveragePanel({
  data,
  busy,
  onOpen,
}: {
  data: WorkforceWeek;
  busy: boolean;
  onOpen: (editor: Editor) => void;
}): JSX.Element {
  const openPolicy = (rules: WorkforceWeek['policy']['rules']) =>
    onOpen({
      kind: 'policy',
      version: data.policy.version,
      rules,
      capacity: data.policy.ordersPerStaffHour,
    });
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button variant="outline" disabled={busy} onClick={() => openPolicy(data.policy.rules)}>
          <Users className="mr-2 h-4 w-4" />
          Cấu hình nhu cầu
        </Button>
      </div>
      <WorkforcePeaksPanel
        data={data.peaks}
        rules={data.policy.rules}
        busy={busy}
        onUse={(rule) => openPolicy([...data.policy.rules, rule])}
      />
      {!data.coverage.length ? (
        <p className="rounded-2xl border bg-card p-5">
          Chưa có khung nhu cầu. Thêm khung giờ để kiểm tra thiếu người.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.coverage.map((c) => (
            <article
              key={c.startsAt}
              className={`rounded-2xl border bg-card p-4 ${c.shortage || (c.presentNow !== null && c.presentNow < c.required) ? 'border-danger' : ''}`}
            >
              <h2 className="font-semibold">{c.label}</h2>
              <p className="text-sm">
                {stamp(c.startsAt)} – {time(c.endsAt)}
              </p>
              <p className="mt-2">
                Đã xếp {c.scheduled}/{c.required} người
                {c.shortage ? ` · Thiếu ${c.shortage}` : ' · Đủ lịch'}
              </p>
              {c.presentNow !== null ? (
                <p className={c.presentNow < c.required ? 'text-danger' : 'text-success'}>
                  Đang chấm công {c.presentNow}/{c.required} người
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
