import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../../lib/api';

export const BEST_SELLER_COUNT = 10;

/** Id món bán nhiều nhất (đơn đã trả tiền, 90 ngày gần nhất), đã xếp hạng. Lỗi thì trả rỗng. */
export function useBestSellerIds() {
  return useQuery({
    queryKey: ['menu', 'best-sellers', BEST_SELLER_COUNT],
    staleTime: 60_000,
    queryFn: async () =>
      unwrap<{ productIds: string[] }>(
        await api.get(`/products/best-sellers?limit=${BEST_SELLER_COUNT}`),
      ).productIds,
  });
}
