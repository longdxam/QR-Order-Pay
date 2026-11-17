import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BellRing,
  Coffee,
  Gift,
  ListChecks,
  MessageCircle,
  MoreHorizontal,
  Music2,
  QrCode,
  ReceiptText,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { cn } from '../lib/cn';

const itemClass =
  'relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-center text-[11px] leading-tight transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:text-xs';
const extraClass =
  'flex min-h-20 min-w-0 flex-col items-center justify-center gap-2 rounded-2xl border p-3 text-center text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50';

export function GuestDock({
  active,
  receiptAvailable,
  giftCount,
  supportHref,
  calling,
  onCallStaff,
}: {
  active: boolean;
  receiptAvailable: boolean;
  giftCount: number;
  supportHref: string | null;
  calling: boolean;
  onCallStaff: () => void;
}): JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => setMoreOpen(false), [pathname]);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setMoreOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);
  return (
    <>
      <nav
        aria-label="Điều hướng chính"
        className="guest-dock pointer-events-auto grid grid-cols-5 rounded-3xl border border-border bg-card/95 p-1 shadow-soft backdrop-blur lg:hidden"
      >
        <DockLink to="/menu" label="Thực đơn" icon={<Coffee className="h-5 w-5" />} />
        <DockLink
          to={receiptAvailable ? '/receipt' : '/orders'}
          label={receiptAvailable ? 'Hóa đơn' : 'Đơn của tôi'}
          icon={
            receiptAvailable ? (
              <ReceiptText className="h-5 w-5" />
            ) : (
              <ListChecks className="h-5 w-5" />
            )
          }
        />
        {active ? (
          <button type="button" className={itemClass} disabled={calling} onClick={onCallStaff}>
            <BellRing className="h-5 w-5" />
            Gọi nhân viên
          </button>
        ) : (
          <button type="button" className={itemClass} onClick={() => navigate('/t')}>
            <QrCode className="h-5 w-5" />
            Vào bàn
          </button>
        )}
        <DockLink to="/ai" label="AI Barista" icon={<Sparkles className="h-5 w-5" />} />
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={cn(
            itemClass,
            ['/gifts', '/jukebox', '/member'].includes(pathname) &&
              'bg-accent/20 font-semibold text-primary',
          )}
          onClick={() => setMoreOpen(true)}
        >
          <MoreHorizontal className="h-5 w-5" />
          Thêm
          {giftCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-1 top-0.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground"
            >
              {giftCount > 99 ? '99+' : giftCount}
            </span>
          )}
        </button>
      </nav>
      <Modal open={moreOpen} onOpenChange={setMoreOpen} title="Thêm chức năng">
        <div className="grid grid-cols-2 gap-3">
          {active && (
            <NavLink to="/gifts" className={extraClass} onClick={() => setMoreOpen(false)}>
              <Gift className="h-5 w-5" />
              Tặng quà{giftCount ? ` (${giftCount})` : ''}
            </NavLink>
          )}
          {active && (
            <NavLink to="/jukebox" className={extraClass} onClick={() => setMoreOpen(false)}>
              <Music2 className="h-5 w-5" />
              Chọn nhạc
            </NavLink>
          )}
          <NavLink to="/member" className={extraClass} onClick={() => setMoreOpen(false)}>
            <UserRound className="h-5 w-5" />
            Thành viên
          </NavLink>
          {supportHref && (
            <a href={supportHref} target="_blank" rel="noopener noreferrer" className={extraClass}>
              <MessageCircle className="h-5 w-5" />
              Hỗ trợ CSKH
            </a>
          )}
        </div>
      </Modal>
    </>
  );
}

function DockLink({
  to,
  label,
  icon,
}: {
  to: string;
  label: string;
  icon: ReactNode;
}): JSX.Element {
  return (
    <NavLink
      to={to}
      aria-label={label}
      className={({ isActive }) =>
        cn(
          itemClass,
          isActive
            ? 'bg-accent/20 font-semibold text-primary'
            : 'text-muted-foreground hover:text-foreground',
        )
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}
