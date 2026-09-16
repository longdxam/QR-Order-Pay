import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';
import type { AuthUser } from './useAuth';

interface Props {
  roles?: Array<AuthUser['role']>;
}

export function RequireAuth({ roles }: Props): JSX.Element {
  const { user, accessToken } = useAuth();
  const location = useLocation();
  if (!user || !accessToken) {
    return <Navigate to="/auth/login" state={{ from: location.pathname }} replace />;
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
