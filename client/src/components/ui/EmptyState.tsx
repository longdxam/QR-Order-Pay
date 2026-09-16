import { type ReactNode, useEffect } from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10">
      {icon ? <div className="mb-3 text-primary">{icon}</div> : null}
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps): JSX.Element {
  return (
    <EmptyState
      title="Đã có lỗi xảy ra"
      description={message}
      action={
        onRetry ? (
          <button className="btn-outline" onClick={onRetry}>
            Thử lại
          </button>
        ) : null
      }
    />
  );
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} — Mây Café`;
    return () => {
      document.title = 'Mây Café — QR Ordering & AI Barista';
    };
  }, [title]);
}
