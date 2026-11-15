import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarDays, Clock3, Users, Check, Armchair } from 'lucide-react';
import {
  reservationCreateSchema,
  type Reservation,
  type ReservationCreate,
  type ReservationAvailability,
} from '@may-cafe/contracts';
import { api, unwrap, getErrorMessage, getAxiosError, generateRequestId } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/EmptyState';
import { localTime, readPending, savePending, vnTime } from './format';

/**
 * Form Ä‘áº·t bÃ n: tÃ¬m bÃ n trá»‘ng theo giá»/sá»‘ khÃ¡ch rá»“i gá»­i vá»›i requestId cá»‘ Ä‘á»‹nh. Khi chÆ°a rÃµ káº¿t quáº£
 * (máº¡ng/5xx), yÃªu cáº§u Ä‘Æ°á»£c giá»¯ trong sessionStorage Ä‘á»ƒ thá»­ láº¡i nguyÃªn vÄƒn.
 */
export function ReservationForm({
  storageKey,
  prefix,
  initialName,
  initialPhone,
  onDone,
}: {
  storageKey: string;
  prefix: string;
  initialName: string;
  initialPhone: string;
  onDone: () => void;
}): JSX.Element {
  const recovered = useRef(readPending(storageKey)),
    [when, setWhen] = useState(
      recovered.current
        ? localTime(new Date(recovered.current.startsAt))
        : localTime(new Date(Math.ceil((Date.now() + 30 * 60000) / 900000) * 900000)),
    ),
    [partySize, setPartySize] = useState(recovered.current?.partySize ?? 2),
    [name, setName] = useState(recovered.current?.name ?? initialName),
    [phone, setPhone] = useState(recovered.current?.phone ?? initialPhone),
    [note, setNote] = useState(recovered.current?.note ?? ''),
    [tableId, setTableId] = useState(recovered.current?.tableId ?? ''),
    [criteria, setCriteria] = useState<{ startsAt: string; partySize: number } | null>(null),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(!!recovered.current),
    [success, setSuccess] = useState<Reservation | null>(null);
  const attempt = useRef<ReservationCreate | null>(recovered.current),
    requestId = useRef(recovered.current?.requestId ?? generateRequestId());
  const available = useQuery({
    queryKey: ['reservation-availability', prefix, criteria],
    queryFn: async () =>
      unwrap<ReservationAvailability>(
        await api.get(`${prefix}/availability`, { params: criteria }),
      ),
    enabled: !!criteria,
    refetchInterval: 15000,
  });
  const submit = useMutation({
    mutationFn: async () => {
      if (!attempt.current) {
        if (!criteria || !tableId) throw new Error('Chọn giờ và bàn còn trống.');
        const parsed = reservationCreateSchema.safeParse({
          requestId: requestId.current,
          tableId,
          startsAt: criteria.startsAt,
          partySize,
          name,
          phone,
          note,
        });
        if (!parsed.success)
          throw new Error(parsed.error.issues[0]?.message ?? 'Kiểm tra thông tin đặt bàn.');
        attempt.current = parsed.data;
        savePending(storageKey, parsed.data);
      }
      return unwrap<{ reservation: Reservation }>(await api.post(prefix, attempt.current));
    },
    onSuccess: (data) => {
      savePending(storageKey, null);
      attempt.current = null;
      requestId.current = generateRequestId();
      setUncertain(false);
      setError('');
      setSuccess(data.reservation);
      setTableId('');
      setCriteria(null);
      onDone();
    },
    onError: (e) => {
      setError(getErrorMessage(e));
      const status = getAxiosError(e)?.response?.status;
      const pending = !!attempt.current && (!status || status >= 500);
      setUncertain(pending);
      if (!pending) {
        attempt.current = null;
        savePending(storageKey, null);
        if (criteria) void available.refetch();
      }
    },
  });
  const locked = uncertain || submit.isPending;
  const resetSearch = () => {
    setCriteria(null);
    setTableId('');
    setSuccess(null);
    setError('');
  };
  useEffect(() => {
    if (
      available.data &&
      tableId &&
      !uncertain &&
      !available.data.tables.some((t) => t.id === tableId)
    )
      setTableId('');
  }, [available.data, tableId, uncertain]);
  return (
    <Card className="overflow-hidden border-primary/20 p-5 sm:p-7">
      <div className="mb-6 flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <CalendarDays className="h-6 w-6" />
        </span>
        <div>
          <h2 className="text-xl font-semibold">Chọn giờ, chọn chỗ.</h2>
          <p className="mt-1 text-xs text-muted-foreground">Giờ Việt Nam · Không cần quét QR</p>
        </div>
      </div>
      {success ? (
        <div role="status" className="mb-5 rounded-2xl border border-success/30 bg-success/10 p-4">
          <p className="font-semibold">Đã giữ chỗ · {success.code}</p>
          <p className="mt-1 text-sm">
            {success.tableName} · {vnTime(success.startsAt)} · {success.partySize} khách
          </p>
          <p className="mt-2 text-sm">Đến quầy để check-in, sau đó quét QR tại bàn.</p>
        </div>
      ) : null}
      <fieldset disabled={locked} className="min-w-0 space-y-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_140px_auto] sm:items-end">
          <label className="space-y-2 text-sm font-semibold">
            <span className="flex items-center gap-2">
              <Clock3 className="h-4 w-4" />
              Ngày & giờ đến
            </span>
            <Input
              type="datetime-local"
              aria-label="Ngày và giờ đến (giờ Việt Nam)"
              value={when}
              step={60}
              onChange={(e) => {
                setWhen(e.target.value);
                resetSearch();
              }}
            />
          </label>
          <label className="space-y-2 text-sm font-semibold">
            <span className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Số khách
            </span>
            <Input
              aria-label="Số khách"
              type="number"
              min={1}
              max={30}
              step={1}
              value={partySize}
              onChange={(e) => {
                setPartySize(Number(e.target.value));
                resetSearch();
              }}
            />
          </label>
          <Button
            className="h-12"
            disabled={
              !when ||
              !Number.isInteger(partySize) ||
              partySize < 1 ||
              partySize > 30 ||
              available.isFetching
            }
            onClick={() => {
              try {
                const startsAt = new Date(`${when}:00+07:00`).toISOString();
                if (criteria?.startsAt === startsAt && criteria.partySize === partySize)
                  void available.refetch();
                setCriteria({ startsAt, partySize });
                setTableId('');
                setError('');
                setSuccess(null);
              } catch {
                setError('Chọn ngày và giờ hợp lệ.');
              }
            }}
          >
            Tìm bàn trống
          </Button>
        </div>
        {criteria ? (
          <section aria-label="Bàn còn trống">
            {available.isFetching && !available.data ? (
              <p role="status">Đang tìm bàn…</p>
            ) : available.isError ? (
              <ErrorState
                message={getErrorMessage(available.error)}
                onRetry={() => available.refetch()}
              />
            ) : available.data ? (
              <>
                <p className="mb-3 text-sm text-muted-foreground">
                  {vnTime(available.data.startsAt)} → {vnTime(available.data.endsAt)}
                </p>
                {available.data.tables.length ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {available.data.tables.map((t) => (
                      <button
                        type="button"
                        key={t.id}
                        aria-pressed={tableId === t.id}
                        aria-label={`${t.name} · ${t.capacity} chỗ`}
                        onClick={() => {
                          setTableId(t.id);
                          setError('');
                        }}
                        className={`relative flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl border p-4 transition hover:border-primary ${tableId === t.id ? 'border-primary bg-primary/10' : 'border-control bg-muted/20'}`}
                      >
                        <Armchair className="h-7 w-7 text-primary" />
                        <strong>{t.name}</strong>
                        <span className="text-xs text-muted-foreground">{t.capacity} chỗ</span>
                        {tableId === t.id ? (
                          <Check className="absolute right-3 top-3 h-4 w-4 text-primary" />
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-2xl border border-dashed p-6 text-center text-muted-foreground">
                    Chưa có bàn phù hợp. Hãy thử giờ khác.
                  </p>
                )}
              </>
            ) : null}
          </section>
        ) : null}
        {tableId ? (
          <div className="space-y-4 border-t border-border pt-5">
            <h3 className="font-semibold">Thông tin nhận bàn</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm">
                Tên người đặt
                <Input
                  aria-label="Tên người đặt"
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="space-y-2 text-sm">
                SĐT liên hệ
                <Input
                  aria-label="SĐT đặt bàn"
                  type="tel"
                  value={phone}
                  maxLength={24}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
            </div>
            <label className="block space-y-2 text-sm">
              Ghi chú
              <Input
                aria-label="Ghi chú đặt bàn"
                value={note}
                maxLength={280}
                placeholder="Ví dụ: cần ghế cho bé"
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>
        ) : null}
      </fieldset>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {uncertain ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Chưa rõ kết quả gửi. Thử lại cùng yêu cầu để tránh đặt trùng.
        </p>
      ) : null}
      {tableId ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <p className="text-xs text-muted-foreground">60 phút/lượt · Trễ 15 phút sẽ nhả chỗ</p>
          <Button size="lg" disabled={submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending
              ? 'Đang giữ chỗ…'
              : uncertain
                ? 'Thử lại cùng yêu cầu'
                : 'Xác nhận đặt bàn'}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
