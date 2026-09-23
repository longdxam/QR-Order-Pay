import { lazy, Suspense } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { ToastProvider } from './components/ui/Toast';
import { NetworkStatus } from './components/ui/NetworkStatus';
import { GuestLayout } from './layouts/GuestLayout';
import { StaffLayout } from './layouts/StaffLayout';
import { AdminLayout } from './layouts/AdminLayout';
import { RequireAuth } from './features/auth/RequireAuth';

const JoinPage = lazy(() =>
  import('./features/guest/JoinPage').then((module) => ({ default: module.JoinPage })),
);
const MenuPage = lazy(() =>
  import('./features/guest/MenuPage').then((module) => ({ default: module.MenuPage })),
);
const CartPage = lazy(() =>
  import('./features/guest/CartPage').then((module) => ({ default: module.CartPage })),
);
const OrdersPage = lazy(() =>
  import('./features/guest/OrdersPage').then((module) => ({ default: module.OrdersPage })),
);
const ReceiptPage = lazy(() =>
  import('./features/guest/ReceiptPage').then((module) => ({ default: module.ReceiptPage })),
);
const AIPage = lazy(() =>
  import('./features/ai/AISheet').then((module) => ({ default: module.AIPage })),
);
const StaffKDS = lazy(() =>
  import('./features/staff/KDS').then((module) => ({ default: module.StaffKDS })),
);
const StaffTables = lazy(() =>
  import('./features/staff/Tables').then((module) => ({ default: module.StaffTables })),
);
const StaffServiceRequests = lazy(() =>
  import('./features/staff/ServiceRequests').then((module) => ({
    default: module.StaffServiceRequests,
  })),
);
const AdminDashboard = lazy(() =>
  import('./features/admin/Dashboard').then((module) => ({ default: module.AdminDashboard })),
);
const AdminProducts = lazy(() =>
  import('./features/admin/Products').then((module) => ({ default: module.AdminProducts })),
);
const AdminCategories = lazy(() =>
  import('./features/admin/Categories').then((module) => ({ default: module.AdminCategories })),
);
const AdminToppings = lazy(() =>
  import('./features/admin/Toppings').then((module) => ({ default: module.AdminToppings })),
);
const AdminTables = lazy(() =>
  import('./features/admin/Tables').then((module) => ({ default: module.AdminTables })),
);
const AdminUsers = lazy(() =>
  import('./features/admin/Users').then((module) => ({ default: module.AdminUsers })),
);
const AdminReviews = lazy(() =>
  import('./features/admin/Reviews').then((module) => ({ default: module.AdminReviews })),
);
const AdminOperations = lazy(() =>
  import('./features/admin/Operations').then((module) => ({ default: module.AdminOperations })),
);
const LoginPage = lazy(() =>
  import('./features/auth/LoginPage').then((module) => ({ default: module.LoginPage })),
);

export function App(): JSX.Element {
  return (
    <ToastProvider>
      <NetworkStatus />
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/" element={<Navigate to="/t" replace />} />
          <Route path="/t" element={<JoinPage />} />
          <Route path="/t/:token" element={<JoinPage />} />

          <Route element={<GuestLayout />}>
            <Route path="/menu" element={<MenuPage />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/receipt" element={<ReceiptPage />} />
            <Route path="/ai" element={<AIPage />} />
          </Route>

          <Route path="/auth/login" element={<LoginPage />} />
          <Route element={<RequireAuth roles={['STAFF', 'ADMIN']} />}>
            <Route element={<StaffLayout />}>
              <Route path="/staff" element={<Navigate to="/staff/kds" replace />} />
              <Route path="/staff/kds" element={<StaffKDS />} />
              <Route path="/staff/tables" element={<StaffTables />} />
              <Route path="/staff/service-requests" element={<StaffServiceRequests />} />
            </Route>
          </Route>

          <Route element={<RequireAuth roles={['ADMIN']} />}>
            <Route element={<AdminLayout />}>
              <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
              <Route path="/admin/dashboard" element={<AdminDashboard />} />
              <Route path="/admin/operations" element={<AdminOperations />} />
              <Route path="/admin/products" element={<AdminProducts />} />
              <Route path="/admin/categories" element={<AdminCategories />} />
              <Route path="/admin/toppings" element={<AdminToppings />} />
              <Route path="/admin/tables" element={<AdminTables />} />
              <Route path="/admin/users" element={<AdminUsers />} />
              <Route path="/admin/reviews" element={<AdminReviews />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ToastProvider>
  );
}

function PageLoading(): JSX.Element {
  return (
    <div
      className="min-h-screen grid place-items-center bg-background"
      role="status"
      aria-live="polite"
    >
      <p className="text-sm text-muted-foreground">Đang tải trang…</p>
    </div>
  );
}
