import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, QrCode, RefreshCw, Check } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { Modal } from '../../components/ui/Modal';
import { api, getErrorMessage, unwrap } from '../../lib/api';
import { ErrorState } from '../../components/ui/EmptyState';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';
import { useToast } from '../../components/ui/useToast';

interface Table {
  _id: string;
  code: string;
  name: string;
  capacity: number;
  isActive: boolean;
}

interface RotateResult {
  tableId: string;
  publicToken: string;
  url: string;
}

export function AdminTables(): JSX.Element {
  useDocumentTitle('Bàn & QR');
  const { toast } = useToast();
  const qc = useQueryClient();
  const [rotateResult, setRotateResult] = useState<RotateResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrImage, setQrImage] = useState('');
  useEffect(() => {
    let cancelled = false;
    setQrImage('');
    if (rotateResult) void QRCode.toDataURL(rotateResult.url, { width: 360, margin: 4, errorCorrectionLevel: 'M' })
      .then((url) => { if (!cancelled) setQrImage(url); })
      .catch(() => { if (!cancelled) toast({ title: 'Chưa tạo được ảnh QR', tone: 'danger' }); });
    return () => { cancelled = true; };
  }, [rotateResult, toast]);

  const query = useQuery({
    queryKey: ['admin-tables-full'],
    queryFn: async () => unwrap(await api.get<{ tables: Table[] }>('/admin/tables')),
  });

  const rotate = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.post<RotateResult>(`/admin/tables/${id}/rotate-token`)),
    onSuccess: (data) => {
      setRotateResult(data);
      setCopied(false);
      void qc.invalidateQueries({ queryKey: ['admin-tables-full'] });
    },
    onError: (e: unknown) => toast({ title: 'Lỗi', description: getErrorMessage(e), tone: 'danger' }),
  });

  async function copyUrl(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: 'Không thể copy', description: 'Hãy chọn và copy thủ công.', tone: 'info' });
    }
  }

  if (query.isLoading) return <Skeleton className="h-64" />;
  if (query.isError) return <ErrorState message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold">Bàn & QR</h1>
      <p className="text-sm text-muted-foreground">
        Bấm <span className="font-semibold">Xoay QR</span> để cấp một liên kết mới cho bàn. Khách quét liên kết này bằng điện thoại
        để vào phiên của bàn (chỉ Staff mở phiên thì khách mới đặt món được).
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {query.data?.tables.map((t) => (
          <Card key={t._id} className="p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-display font-semibold truncate">{t.name}</p>
              <p className="text-xs text-muted-foreground">Mã {t.code} · {t.capacity} chỗ</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge tone={t.isActive ? 'success' : 'danger'}>{t.isActive ? 'Hoạt động' : 'Tạm khoá'}</Badge>
              <Button
                size="sm"
                variant="outline"
                disabled={rotate.isPending}
                onClick={() => rotate.mutate(t._id)}
                title="Xoay QR — cấp token mới"
              >
                <QrCode className="h-4 w-4" /> <RefreshCw className="h-3 w-3" />
                <span className="hidden sm:inline">Xoay QR</span>
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Modal open={!!rotateResult} onOpenChange={(o) => !o && setRotateResult(null)} title="Liên kết QR mới">
        {rotateResult && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Đặt ảnh QR này tại bàn để khách quét bằng camera điện thoại. Mã QR cũ đã bị thu hồi.
            </p>
            {qrImage ? <div className="text-center space-y-2">
              <p className="font-semibold">Mây Café · {query.data?.tables.find((t) => t._id === rotateResult.tableId)?.name}</p>
              <img src={qrImage} alt="Mã QR vào bàn" className="mx-auto w-64 max-w-full" />
              <a className="inline-block underline text-primary" href={qrImage} download={`may-cafe-${query.data?.tables.find((t) => t._id === rotateResult.tableId)?.code ?? 'ban'}.png`}>Tải PNG để in mã QR</a>
            </div> : <p>Đang tạo ảnh QR...</p>}
            <div className="rounded-md border border-border bg-muted/40 p-3 break-all text-sm font-mono">
              {rotateResult.url}
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => copyUrl(rotateResult.url)}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Đã copy' : 'Copy liên kết'}
              </Button>
              <Button variant="outline" onClick={() => window.open(rotateResult.url, '_blank')}>
                Mở thử
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Lưu ý: nếu deploy qua LAN, đặt <code className="px-1 py-0.5 rounded bg-muted">PUBLIC_APP_URL</code> trong{' '}
              <code className="px-1 py-0.5 rounded bg-muted">server/.env</code> thành địa chỉ IP LAN (vd{' '}
              <code>http://192.168.1.10:5173</code>) trước khi xoay, để điện thoại khách mở được link.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
