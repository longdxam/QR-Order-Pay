import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api, getErrorMessage, unwrap } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';

export function TableDisplaySetup({
  tableId,
  tableName,
  admin = false,
}: {
  tableId: string;
  tableName: string;
  admin?: boolean;
}): JSX.Element {
  const [qr, setQr] = useState<{ url: string; image: string } | null>(null);
  const [message, setMessage] = useState('');
  const load = useMutation({
    mutationFn: async () => {
      const data = unwrap<{ url: string }>(
        await api.get(`/${admin ? 'admin' : 'staff'}/tables/${tableId}/qr`),
      );
      return { url: data.url, image: await QRCode.toDataURL(data.url, { width: 600, margin: 3 }) };
    },
    onSuccess: (data) => {
      setQr(data);
      setMessage('');
    },
  });
  return (
    <>
      <Button size="sm" variant="outline" disabled={load.isPending} onClick={() => load.mutate()}>
        {load.isPending ? 'Đang lấy QR…' : 'Xem QR tĩnh'}
      </Button>
      {load.isError && (
        <p role="alert" className="text-sm text-danger">
          {getErrorMessage(load.error)}
        </p>
      )}
      <Modal
        open={!!qr}
        onOpenChange={(open) => {
          if (!open) setQr(null);
        }}
        title={`QR tĩnh · ${tableName}`}
        className="table-qr-modal"
      >
        {qr && (
          <>
            <div className="min-h-0 space-y-3 overflow-y-auto">
              <p className="text-sm text-muted-foreground">QR cố định dùng lại qua các phiên.</p>
              <img
                src={qr.image}
                alt={`QR vào ${tableName}`}
                className="mx-auto block h-auto w-full max-w-[min(18rem,38dvh)]"
              />
              <input
                aria-label="Link vào bàn"
                readOnly
                value={qr.url}
                className="w-full rounded border p-2 text-sm"
                onFocus={(e) => e.target.select()}
              />
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-2 border-t pt-3 text-center text-sm sm:grid-cols-3">
              <a
                className="rounded-xl bg-primary px-4 py-2 text-primary-foreground"
                href={qr.image}
                download={`QR-${tableName}.png`}
              >
                Tải ảnh QR
              </a>
              <a
                className="rounded-xl border px-4 py-2"
                href={qr.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Mở link vào bàn
              </a>
              <Button
                variant="outline"
                className="col-span-2 sm:col-span-1"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(qr.url)
                    .then(() => setMessage('Đã sao chép link.'))
                    .catch(() => setMessage('Chọn ô link và sao chép thủ công.'));
                }}
              >
                Sao chép link
              </Button>
            </div>
            {message && (
              <p role="status" className="shrink-0 text-sm">
                {message}
              </p>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
