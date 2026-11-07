import { useEffect } from 'react';

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} — Fantastic Cafe`;
    return () => {
      document.title = 'Fantastic Cafe — QR Ordering & AI Barista';
    };
  }, [title]);
}
