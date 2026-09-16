import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { QrCode, Sparkles } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { api, getErrorMessage, unwrap } from '../../lib/api';
import { useToast } from '../../components/ui/Toast';
import { useDocumentTitle } from '../../components/ui/EmptyState';
import { useQueryClient } from '@tanstack/react-query';
import { useCart } from '../../store/cart';
import { disconnectSocket } from '../../lib/socket';

export function JoinPage(): JSX.Element {
  useDocumentTitle('Vào bàn');
  const navigate = useNavigate();
  const { token } = useParams<{ token?: string }>();
  const [value, setValue] = useState(token ?? '');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const autoTried = useRef(false);
  const qc = useQueryClient();

  async function join(t: string): Promise<void> {
    if (!t.trim()) {
      toast({ title: 'Vui lòng nhập mã QR', tone: 'danger' });
      return;
    }
    setLoading(true);
    try {
      let tableToken = t.trim();
      if (tableToken.includes('/t/')) tableToken = tableToken.split('/t/')[1]!.split(/[?#]/)[0]!;
      const joined = unwrap<{ participantId: string; tableSessionId: string }>(
        await api.post('/table-sessions/join', { tableToken }),
      );
      disconnectSocket();
      useCart.getState().setSession(joined.tableSessionId, joined.participantId);
      qc.removeQueries({ queryKey: ['my-orders'] });
      qc.removeQueries({ queryKey: ['receipt'] });
      qc.removeQueries({ queryKey: ['guest-session'] });
      toast({ title: 'Đã vào bàn', description: 'Bạn có thể bắt đầu chọn món.', tone: 'success' });
      navigate('/menu');
    } catch (e) {
      toast({ title: 'Không vào được bàn', description: getErrorMessage(e), tone: 'danger' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token && !autoTried.current) {
      autoTried.current = true;
      void join(token);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="card max-w-md w-full p-6">
        <div className="flex items-center gap-2 text-primary">
          <Sparkles className="h-5 w-5" />
          <span className="text-sm font-medium uppercase tracking-wider">Mây Café</span>
        </div>
        <h1 className="mt-3 font-display text-2xl font-semibold">Quét QR hoặc nhập mã bàn</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mở camera, quét QR trên bàn — hoặc dán mã QR vào ô bên dưới để vào phiên phục vụ.
        </p>
        <form
          className="mt-5 space-y-3"
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            void join(value);
          }}
        >
          <label className="block text-sm font-medium">
            Mã QR
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Vd: xYzAbC123…"
              className="mt-1"
            />
          </label>
          <Button type="submit" disabled={loading} className="w-full">
            <QrCode className="h-4 w-4" /> {loading ? 'Đang vào...' : 'Vào bàn'}
          </Button>
        </form>
        <div className="mt-5 rounded-xl border border-dashed border-foreground/15 p-3 text-xs text-muted-foreground">
          Trong bản demo, dán token QR in ra khi chạy <code className="font-mono">npm run seed</code> hoặc
          dán liên kết <code className="font-mono">/t/&lt;token&gt;</code> vào trình duyệt.
        </div>
      </div>
    </div>
  );
}
