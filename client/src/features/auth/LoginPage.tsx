import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Coffee, LogIn } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { api, getErrorMessage, unwrap } from '../../lib/api';
import { useAuth, type AuthUser } from './useAuth';
import { useToast } from '../../components/ui/useToast';
import { getPortalMode } from '../../lib/portals';

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuth((s) => s.setSession);
  const { toast } = useToast();
  const portal = getPortalMode();
  const [email, setEmail] = useState(portal === 'admin' ? 'admin@maycafe.vn' : 'staff.a@maycafe.vn');
  const [password, setPassword] = useState('MayCafe@2025');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await unwrap(
        await api.post<{ accessToken: string; user: AuthUser }>('/auth/login', { email, password }),
      );
      if (portal === 'admin' && data.user.role !== 'ADMIN') {
        try {
          await api.post('/auth/logout');
        } catch {
          // The portal still refuses the role even if the cleanup request fails.
        }
        throw new Error('Cổng này chỉ dành cho quản trị viên.');
      }
      setSession(data.accessToken, data.user);
      toast({ title: `Xin chào, ${data.user.name}`, tone: 'success' });
      const defaultTarget = portal === 'admin' ? '/admin' : portal === 'staff' ? '/staff' : data.user.role === 'ADMIN' ? '/admin' : '/staff';
      const target = (location.state as { from?: string } | null)?.from ?? defaultTarget;
      navigate(target, { replace: true });
    } catch (e) {
      toast({ title: 'Đăng nhập thất bại', description: getErrorMessage(e), tone: 'danger' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md p-6">
        <div className="flex items-center gap-2 text-primary">
          <Coffee className="h-5 w-5" />
          <span className="text-xs uppercase tracking-wider font-semibold">Mây Café</span>
        </div>
        <h1 className="mt-2 font-display text-2xl font-semibold">Đăng nhập nội bộ</h1>
        <p className="mt-1 text-sm text-muted-foreground">Dành cho nhân viên và quản trị viên.</p>

        <form className="mt-5 space-y-3" onSubmit={submit}>
          <label className="block text-sm font-medium">
            Email
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-1" />
          </label>
          <label className="block text-sm font-medium">
            Mật khẩu
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="mt-1" />
          </label>
          <Button type="submit" className="w-full" disabled={loading}>
            <LogIn className="h-4 w-4" /> {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </Button>
        </form>

        <p className="mt-4 text-xs text-muted-foreground">
          Demo: admin@maycafe.vn / MayCafe@2025 (ADMIN) hoặc staff.a@maycafe.vn / MayCafe@2025 (STAFF).
        </p>
      </Card>
    </div>
  );
}
