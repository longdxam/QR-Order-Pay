import { useEffect, useRef, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';

type ConnectionState = 'online' | 'offline' | 'restored';

export function NetworkStatus(): JSX.Element | null {
  const [state, setState] = useState<ConnectionState>(() =>
    navigator.onLine ? 'online' : 'offline',
  );
  const restoreTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const clearRestoreTimer = () => {
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
    };
    const handleOffline = () => {
      clearRestoreTimer();
      setState('offline');
    };
    const handleOnline = () => {
      clearRestoreTimer();
      setState((previous) => (previous === 'offline' ? 'restored' : 'online'));
      restoreTimer.current = setTimeout(() => setState('online'), 3_000);
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      clearRestoreTimer();
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  if (state === 'online') return null;

  const restored = state === 'restored';
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium shadow ${restored ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-amber-950'}`}
    >
      {restored ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
      {restored
        ? 'Đã kết nối lại.'
        : 'Mất kết nối mạng. Thao tác chưa gửi sẽ được giữ để bạn thử lại.'}
    </div>
  );
}
