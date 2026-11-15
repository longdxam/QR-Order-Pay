import { useQuery } from '@tanstack/react-query';
import type { PublicMenuResponse } from '@may-cafe/contracts';
import { api, unwrap } from '../../lib/api';

/** GuestLayout invalidate key này khi nhận `menu.updated`/kết nối lại. */
export const PUBLIC_MENU_QUERY_KEY = ['menu'] as const;

/**
 * Thực đơn công khai (`GET /categories`). Một nguồn duy nhất cho Menu, AI Barista và Tặng quà để mọi
 * nơi đọc cùng cache với cùng kiểu dữ liệu lấy từ `@may-cafe/contracts`.
 */
export function usePublicMenu({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: PUBLIC_MENU_QUERY_KEY,
    enabled,
    queryFn: async () => unwrap<PublicMenuResponse>(await api.get('/categories')),
  });
}
