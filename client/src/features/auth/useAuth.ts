import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, unwrap } from '../../lib/api';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'STAFF';
}

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  setSession: (token: string, user: AuthUser) => void;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      setSession(token, user) {
        set({ accessToken: token, user });
      },
      async logout() {
        try {
          await api.post('/auth/logout');
        } catch {
          // ignore network errors on logout
        }
        set({ accessToken: null, user: null });
      },
    }),
    {
      name: 'mc-auth',
      partialize: (state) => ({ accessToken: state.accessToken, user: state.user }),
    },
  ),
);

api.interceptors.request.use((config) => {
  const token = useAuth.getState().accessToken;
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

export async function fetchMe(): Promise<void> {
  const data = await unwrap(await api.get<AuthUser>('/auth/me'));
  useAuth.getState().setSession(useAuth.getState().accessToken ?? '', data);
}
