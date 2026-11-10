import { Suspense, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ChevronDown, LogOut, Menu } from 'lucide-react';
import { CloudMark } from '../../features/guest/CloudMark';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';

export interface InternalNavItem {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: number | null;
}

export function InternalShell({
  title,
  home,
  nav,
  name,
  role,
  status,
  tools,
  player,
  onLogout,
}: {
  title: string;
  home: string;
  nav: InternalNavItem[];
  name: string;
  role: string;
  status?: ReactNode;
  tools?: ReactNode;
  player?: ReactNode;
  onLogout: () => void | Promise<void>;
}): JSX.Element {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => setMenuOpen(false), [pathname]);
  const accountPath = `${home}/account`;
  const current = nav.find((item) => pathname === item.to);
  const navigation = (mobile = false) => (
    <nav
      id={mobile ? menuId : undefined}
      aria-label={mobile ? 'Tất cả chức năng' : 'Điều hướng chính'}
      onKeyDown={
        mobile
          ? (event) => {
              if (event.key === 'Escape') {
                setMenuOpen(false);
                menuButton.current?.focus();
              }
            }
          : undefined
      }
      className={
        mobile
          ? 'grid max-h-[min(60dvh,calc(100dvh-10rem))] grid-cols-1 gap-2 overflow-y-auto px-4 pb-4 min-[380px]:grid-cols-2 sm:grid-cols-3 lg:hidden'
          : 'flex flex-col gap-0.5'
      }
    >
      {nav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={
            mobile
              ? () => {
                  setMenuOpen(false);
                  menuButton.current?.focus();
                }
              : undefined
          }
          className={({ isActive }) =>
            cn(
              'flex min-w-0 items-center gap-3 rounded-xl text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              mobile ? 'min-h-11 px-3 py-2.5' : 'min-h-[38px] px-3 py-2 text-[13px]',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )
          }
        >
          <span className="shrink-0 [&>svg]:h-[18px] [&>svg]:w-[18px]">{item.icon}</span>
          <span className="min-w-0 flex-1 break-words leading-snug">{item.label}</span>
          {item.badge != null && item.badge > 0 ? (
            <span
              aria-label={`${item.badge} chờ xử lý`}
              className="grid h-6 min-w-6 shrink-0 place-items-center rounded-full bg-accent px-1.5 text-xs font-bold text-accent-foreground tabular-nums"
            >
              {item.badge}
            </span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  );
  return (
    <div className="min-h-dvh bg-background lg:pl-[232px] print:pl-0">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[232px] flex-col border-r border-border bg-card px-4 py-3 text-foreground lg:flex print:hidden">
        <Link
          to={home}
          className="mb-4 flex items-center gap-2.5 rounded-xl px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary/15 bg-accent/20 text-primary">
            <CloudMark className="h-5 w-7" />
          </span>
          <span className="min-w-0">
            <span className="block whitespace-nowrap font-display text-base font-semibold leading-snug">
              Fantastic Cafe
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">{title}</span>
          </span>
        </Link>
        <div className="min-h-0 flex-1 overflow-y-auto">{navigation()}</div>
        <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
          <Link
            to={accountPath}
            aria-label={`Tài khoản của ${name}`}
            title={`${name} · ${role}`}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1 py-1.5 transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/20 text-sm text-primary">
              {name.charAt(0)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">{name}</p>
              <span className="sr-only">{role}</span>
            </div>
          </Link>
          <button
            aria-label="Đăng xuất"
            title="Đăng xuất"
            onClick={() => void onLogout()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur print:hidden">
        <div className="mx-auto flex min-h-[56px] max-w-[1600px] flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2.5 lg:hidden">
            <Link to={home} aria-label="Trang chủ">
              <CloudMark className="h-6 w-8 shrink-0 text-primary" />
            </Link>
            <div className="min-w-0">
              <Link to={home} className="block truncate font-display text-lg font-semibold">
                Fantastic Cafe
              </Link>
              <Link
                to={accountPath}
                aria-label={`Tài khoản của ${name}`}
                className="block truncate rounded text-xs text-muted-foreground hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {name}
              </Link>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-sm lg:flex">
            <span className="text-muted-foreground">{title}</span>
            <span aria-hidden="true" className="text-foreground/25">
              /
            </span>
            <span className="font-semibold">
              {current?.label ?? (pathname === accountPath ? 'Tài khoản của tôi' : title)}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {status}
            {tools}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Đăng xuất"
              onClick={() => void onLogout()}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="px-4 pb-3 lg:hidden">
          <Button
            ref={menuButton}
            variant="outline"
            className="h-auto min-h-11 w-full justify-start rounded-xl px-3 py-2.5"
            aria-label="Chọn chức năng"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setMenuOpen(false);
            }}
          >
            <Menu className="h-4 w-4 shrink-0" />
            <span className="shrink-0">Tất cả chức năng</span>
            <span className="min-w-0 flex-1 truncate text-right text-xs font-normal text-muted-foreground">
              {current?.label ?? (pathname === accountPath ? 'Tài khoản của tôi' : title)}
            </span>
            <ChevronDown
              aria-hidden="true"
              className={cn('h-4 w-4 shrink-0 transition-transform', menuOpen && 'rotate-180')}
            />
          </Button>
        </div>
        {menuOpen ? navigation(true) : null}
      </header>
      <main className="internal-main mx-auto min-w-0 max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {player}
        <Suspense fallback={<p role="status">Đang tải trang…</p>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
