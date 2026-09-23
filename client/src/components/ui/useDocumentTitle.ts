import { useEffect } from 'react';

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} — Mây Café`;
    return () => {
      document.title = 'Mây Café — QR Ordering & AI Barista';
    };
  }, [title]);
}
