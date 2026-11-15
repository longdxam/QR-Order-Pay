import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { Reservation } from '@may-cafe/contracts';
import { api, getErrorMessage, getAxiosError } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { vnTime } from './format';

/** Há»§y (khÃ¡ch/Staff) hoáº·c check-in (Staff) má»™t lá»‹ch Ä‘áº·t; giá»¯ nguyÃªn thao tÃ¡c Ä‘á»ƒ thá»­ láº¡i khi 5xx. */
export function ReservationActions({
  reservation: r,
  prefix,
  staff,
  onClose,
  onDone,
}: {
  reservation: Reservation;
  prefix: string;
  staff: boolean;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(false),
    [now, setNow] = useState(Date.now());
  const attempt = useRef<{
    kind: 'cancel' | 'check-in';
    body: { expectedVersion: number; reason?: string };
  } | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  const submit = useMutation({
    mutationFn: async (kind: 'cancel' | 'check-in') => {
      attempt.current ??= {
        kind,
        body: { expectedVersion: r.version, ...(kind === 'cancel' ? { reason } : {}) },
      };
      return api.post(`${prefix}/${r.id}/${attempt.current.kind}`, attempt.current.body);
    },
    onSuccess: onDone,
    onError: (e) => {
      setError(getErrorMessage(e));
      const status = getAxiosError(e)?.response?.status;
      setUncertain(!status || status >= 500);
      if (status && status < 500) attempt.current = null;
    },
  });
  const busy = submit.isPending || uncertain,
    canCheckIn =
      now >= new Date(r.startsAt).getTime() - 15 * 60000 &&
      now < new Date(r.arrivalDeadline).getTime();
  return (
    <Modal
      open
      title={`${staff ? 'Xử lý' : 'Hủy'} ${r.code}`}
      onOpenChange={(o) => {
        if (!o && !submit.isPending) onClose();
      }}
    >
      <p>
        {r.tableName} · {r.partySize} khách
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {vnTime(r.startsAt)} → {vnTime(r.endsAt)}
      </p>
      {staff ? (
        <p className="mt-4 text-sm">
          Check-in từ 15 phút trước giờ đặt. Bàn phải được dọn và đóng phiên cũ.
        </p>
      ) : null}
      <fieldset disabled={busy} className="mt-5 space-y-4">
        <label className="block text-sm">
          Lý do hủy
          <Input
            aria-label="Lý do hủy lịch"
            value={reason}
            maxLength={280}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          {staff ? (
            <Button disabled={!canCheckIn} onClick={() => submit.mutate('check-in')}>
              Khách đã đến — Check-in
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={reason.trim().length < 3}
            onClick={() => submit.mutate('cancel')}
          >
            Xác nhận hủy lịch
          </Button>
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {uncertain ? (
        <Button
          className="mt-4"
          disabled={submit.isPending}
          onClick={() => submit.mutate(attempt.current!.kind)}
        >
          Thử lại cùng thao tác
        </Button>
      ) : null}
    </Modal>
  );
}
