import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, getAxiosError, getErrorMessage } from '../../lib/api';
import { readPending, type Pending } from './giftModel';

/**
 * Gửi các request ghi của trang quà với Idempotency-Key. Request được lưu trước khi POST: nếu mất
 * phản hồi (mạng/5xx) người dùng thử lại đúng request đó; lỗi 4xx thì bỏ request đã lưu.
 */
export function useGiftSubmit(owner: string, onGiftSent: () => void) {
  const qc = useQueryClient();
  const storageKey = `mc-gift-pending:${owner}`;
  const [pending, setPending] = useState<Pending | null>(() => readPending(storageKey));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function submit(action: Pending, onSettled: () => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      // Persist before POST so reloading after a lost response can retry the exact request.
      sessionStorage.setItem(storageKey, JSON.stringify(action));
      setPending(action);
      await api.post(action.url, action.payload, { headers: { 'Idempotency-Key': action.key } });
      sessionStorage.removeItem(storageKey);
      setPending(null);
      onSettled();
      if (action.url === '/gifts') onGiftSent();
      void qc.invalidateQueries({ queryKey: ['gifts'] });
      void qc.invalidateQueries({ queryKey: ['my-orders'] });
    } catch (err) {
      const status = getAxiosError(err)?.response?.status;
      if (status && status < 500) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
        onSettled();
      }
      setError(getErrorMessage(err));
      void qc.invalidateQueries({ queryKey: ['gifts'] });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return { pending, error, setError, busy, submit };
}
