import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, getErrorMessage, unwrap } from '../../lib/api';
import { dynamicQrResponseSchema } from '@may-cafe/contracts';
import { Button } from '../../components/ui/Button';

export function TableDisplayPage(): JSX.Element {
  const [token] = useState(() => window.location.hash.slice(1));
  const [qr, setQr] = useState<{
    image: string;
    tableName: string;
    url: string;
  } | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!token) {
      setError('Chưa cấu hình màn hình. Nhân viên mở Bàn & phiên để cấp liên kết màn hình.');
      return;
    }
    let stopped = false;
    let refreshTimer: number;
    const refresh = async () => {
      // Hide old QR while refreshing, including when a request fails/offline.
      setQr(null);
      setCopyMessage('');
      try {
        const response = await api.get('/table-displays/qr', {
          headers: { 'X-Table-Display-Token': token },
        });
        const data = dynamicQrResponseSchema.parse(unwrap(response));
        if (data.expiresAt !== null)
          throw new Error(
            'Màn hình hiện tại chỉ dùng QR cố định. Vui lòng lấy lại QR từ Bàn & phiên.',
          );
        const image = await QRCode.toDataURL(data.url, {
          width: 480,
          margin: 3,
          errorCorrectionLevel: 'M',
        });
        if (stopped) return;
        setError('');
        setQr({ image, tableName: data.tableName, url: data.url });
      } catch (cause) {
        if (stopped) return;
        setError(getErrorMessage(cause));
        refreshTimer = window.setTimeout(() => void refresh(), 5_000);
      }
    };
    void refresh();
    return () => {
      stopped = true;
      window.clearTimeout(refreshTimer);
    };
  }, [token, reload]);
  async function copyLink(): Promise<void> {
    if (!qr) {
      setReload((value) => value + 1);
      return;
    }
    try {
      await navigator.clipboard.writeText(qr.url);
      setCopyMessage('Đã sao chép link vào bàn.');
    } catch {
      linkInput.current?.focus();
      linkInput.current?.select();
      setCopyMessage('Đã chọn link. Nhấn Ctrl+C hoặc chọn Sao chép để lấy link.');
    }
  }
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6 text-center">
      <div className="w-full max-w-lg space-y-4">
        <p className="font-display text-3xl font-semibold">Fantastic Cafe</p>
        <h1 className="text-2xl font-semibold">{qr?.tableName ?? 'Màn hình bàn'}</h1>
        {qr ? (
          <>
            <img
              src={qr.image}
              alt={`QR vào ${qr.tableName}`}
              className="mx-auto w-full max-w-96 rounded-2xl"
            />
            <p className="text-lg">Quét để gọi món · Wi-Fi hoặc 4G</p>
            <p role="status">QR cố định · Dùng lại qua các phiên · Có thể in tại bàn</p>
            <div className="space-y-2">
              <div className="flex flex-wrap justify-center gap-2">
                <a
                  href={qr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  Mở link vào bàn
                </a>
                <Button variant="outline" onClick={() => void copyLink()}>
                  Sao chép link
                </Button>
                <a
                  href={qr.image}
                  download={`QR-${qr.tableName}.png`}
                  className="inline-flex items-center rounded-full border px-4 py-2 text-sm font-semibold"
                >
                  Tải ảnh QR
                </a>
              </div>
              <input
                ref={linkInput}
                aria-label="Link vào bàn"
                readOnly
                value={qr.url}
                onFocus={(event) => event.target.select()}
                className="w-full rounded-xl border border-control bg-card px-3 py-2 text-sm"
              />
              <p className="text-sm text-muted-foreground">
                Mở link để vào bàn trên máy này. QR cố định giữ nguyên qua các phiên.
              </p>
              {copyMessage ? (
                <p role="status" className="text-sm">
                  {copyMessage}
                </p>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              Thanh toán từng đơn trước khi pha chế. Đã vào bàn thì không cần quét lại.
            </p>
          </>
        ) : (
          <p role="status">{error || 'Đang lấy QR mới…'}</p>
        )}
        {error ? <Button onClick={() => setReload((value) => value + 1)}>Thử lại</Button> : null}
      </div>
    </main>
  );
}
