import { Route, Routes, Navigate } from 'react-router-dom';
import { ToastProvider } from './components/ui/Toast';
import { GuestLayout } from './layouts/GuestLayout';
import { StaffLayout } from './layouts/StaffLayout';
import { AdminLayout } from './layouts/AdminLayout';
import { MenuPage } from './features/guest/MenuPage';
import { CartPage } from './features/guest/CartPage';
import { OrdersPage } from './features/guest/OrdersPage';
import { ReceiptPage } from './features/guest/ReceiptPage';
import { AISheet, AIPage } from './features/ai/AISheet';
import { JoinPage } from './features/guest/JoinPage';
import { StaffKDS } from './features/staff/KDS';
import { StaffTables } from './features/staff/Tables';
import { StaffServiceRequests } from './features/staff/ServiceRequests';
import { AdminDashboard } from './features/admin/Dashboard';
import { AdminProducts } from './features/admin/Products';
import { AdminCategories } from './features/admin/Categories';
import { AdminToppings } from './features/admin/Toppings';
import { AdminTables } from './features/admin/Tables';
import { AdminUsers } from './features/admin/Users';
import { AdminReviews } from './features/admin/Reviews';
import { LoginPage } from './features/auth/LoginPage';
import { RequireAuth } from './features/auth/RequireAuth';

export function App(): JSX.Element {
  return (
    <ToastProvider>
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
    </ToastProvider>
  );
}
