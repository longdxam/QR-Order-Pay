import { useState } from 'react';
import type { GiftTable } from '@may-cafe/contracts';
import type { CartItem } from '../../store/cart';

export type DraftItem = Omit<CartItem, 'clientId'>;

/** Trạng thái form "Gửi quà"; `clearAfterSend` giữ nguyên ô tìm món như trước khi tách. */
export function useGiftDraft(initialShowSender: boolean) {
  const [selected, setSelected] = useState<GiftTable | null>(null);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(6);
  const [showSenderTable, setShowSenderTable] = useState(initialShowSender);

  function clearAfterSend() {
    setItems([]);
    setMessage('');
    setShowSenderTable(false);
    setSelected(null);
  }

  return {
    selected,
    setSelected,
    items,
    setItems,
    message,
    setMessage,
    search,
    setSearch,
    limit,
    setLimit,
    showSenderTable,
    setShowSenderTable,
    clearAfterSend,
  };
}

export type GiftDraft = ReturnType<typeof useGiftDraft>;
