import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { IngredientDto, StockMovementInput } from '@may-cafe/contracts';
import {
  ingredientCreateSchema,
  ingredientUpdateSchema,
  stockMovementRequestSchema,
} from '@may-cafe/contracts';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { useToast } from '../../../components/ui/useToast';
import { api, generateIdempotencyKey, getAxiosError, getErrorMessage } from '../../../lib/api';
import { Field } from './Field';
import { number, selectClass, unitLabel } from './shared';
export function IngredientForm({
  ingredient,
  onClose,
  onSaved,
}: {
  ingredient: IngredientDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(ingredient?.name ?? '');
  const [unit, setUnit] = useState('g');
  const [threshold, setThreshold] = useState(String(ingredient?.lowStockThreshold ?? 0));
  const [active, setActive] = useState(ingredient?.isActive ?? true);
  const [unitCost, setUnitCost] = useState(
    ingredient?.unitCost === null || ingredient?.unitCost === undefined
      ? ''
      : String(ingredient.unitCost),
  );
  const save = useMutation({
    mutationFn: async () =>
      ingredient
        ? api.patch(
            `/admin/inventory/ingredients/${ingredient.id}`,
            ingredientUpdateSchema.parse({
              name,
              lowStockThreshold: Number(threshold),
              isActive: active,
              expectedVersion: ingredient.version,
              unitCost: unitCost.trim() === '' ? null : Number(unitCost),
            }),
          )
        : api.post(
            '/admin/inventory/ingredients',
            ingredientCreateSchema.parse({
              name,
              unit,
              lowStockThreshold: Number(threshold),
              unitCost: unitCost.trim() === '' ? null : Number(unitCost),
            }),
          ),
    onSuccess: () => {
      onSaved();
      onClose();
      toast({ title: 'Đã lưu nguyên liệu', tone: 'success' });
    },
    onError: (e) =>
      toast({ title: 'Chưa lưu được', description: getErrorMessage(e), tone: 'danger' }),
  });
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
      title={ingredient ? 'Sửa nguyên liệu' : 'Thêm nguyên liệu'}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Tên nguyên liệu">
          <Input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {!ingredient && (
          <>
            <Field label="Đơn vị cơ sở">
              <select
                className={selectClass}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              >
                <option value="g">Gram (g)</option>
                <option value="ml">Mililit (ml)</option>
                <option value="unit">Đơn vị / cái</option>
              </select>
            </Field>
            <p className="text-xs text-muted-foreground">
              Đơn vị được giữ cố định. Nguyên liệu mới có tồn bằng 0; dùng Nhập kho để ghi nhận tồn
              đầu.
            </p>
          </>
        )}
        <Field label="Ngưỡng cảnh báo sắp hết">
          <Input
            required
            type="number"
            min="0"
            max="1000000000"
            step="0.001"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </Field>
        {ingredient && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Đang dùng
          </label>
        )}
        <Field label={`Giá vốn (đ/${ingredient?.unit ?? unit})`}>
          <Input
            aria-label="Giá vốn nguyên liệu"
            type="number"
            min="0"
            max="10000000"
            step="0.001"
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            placeholder="Để trống nếu chưa biết"
          />
        </Field>
        <p className="text-xs text-muted-foreground">
          Giá vốn dự kiến cho một g/ml/đơn vị cơ sở, không phải giá cả bao/gói. Để trống là chưa
          biết; 0 là miễn phí. Chỉ dùng cho ước tính hiện tại, không sửa chi phí đơn cũ.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={save.isPending} type="submit">
            Lưu nguyên liệu
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function MovementForm({
  ingredient,
  onClose,
  onSaved,
}: {
  ingredient: IngredientDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [type, setType] = useState<StockMovementInput['type']>('RECEIPT');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [frozen, setFrozen] = useState<StockMovementInput | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const save = useMutation({
    mutationFn: (payload: StockMovementInput) =>
      api.post(`/admin/inventory/ingredients/${ingredient.id}/movements`, payload),
    onSuccess: () => {
      onSaved();
      onClose();
      toast({ title: 'Đã ghi nhận biến động kho', tone: 'success' });
    },
    onError: (error) => {
      const status = getAxiosError(error)?.response?.status;
      if (status === undefined || status >= 500 || status === 408) setUncertain(true);
      else {
        setFrozen(null);
        setUncertain(false);
        onSaved();
      }
      toast({
        title: 'Chưa xác nhận được thao tác',
        description: getErrorMessage(error),
        tone: 'danger',
      });
    },
  });
  const busy = save.isPending || uncertain;
  function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const payload =
        frozen ??
        stockMovementRequestSchema.parse({
          type,
          quantity: Number(quantity),
          reason,
          expectedVersion: ingredient.version,
          idempotencyKey: generateIdempotencyKey(),
        });
      setFrozen(payload);
      save.mutate(payload);
    } catch {
      toast({ title: 'Kiểm tra số lượng và lý do (ít nhất 3 ký tự)', tone: 'danger' });
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={`Nhập / xuất: ${ingredient.name}`}
    >
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm">
          Tồn hiện tại: {number(ingredient.onHand)} · Đang giữ: {number(ingredient.reserved)}{' '}
          {unitLabel(ingredient.unit)}
        </p>
        <Field label="Loại thao tác">
          <select
            disabled={busy}
            className={selectClass}
            value={type}
            onChange={(e) => setType(e.target.value as StockMovementInput['type'])}
          >
            <option value="RECEIPT">Nhập kho</option>
            <option value="ISSUE">Xuất khác / hao hụt</option>
            <option value="ADJUSTMENT">Kiểm kê tồn thực tế</option>
          </select>
        </Field>
        <Field label={type === 'ADJUSTMENT' ? 'Tồn thực tế sau kiểm kê' : 'Số lượng'}>
          <Input
            required
            disabled={busy}
            type="number"
            min={type === 'ADJUSTMENT' ? '0' : '0.001'}
            max="1000000000"
            step="0.001"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <Field label="Lý do">
          <Input
            required
            disabled={busy}
            minLength={3}
            maxLength={280}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {type === 'ADJUSTMENT' && (
          <p className="text-xs text-muted-foreground">
            Nhập tổng tồn đã đếm, bao gồm nguyên liệu đang giữ cho đơn. Không được thấp hơn lượng
            đang giữ.
          </p>
        )}
        {uncertain && (
          <p role="alert" className="text-sm text-danger">
            Chưa rõ server đã ghi nhận hay chưa. Thử lại cùng thao tác để tránh ghi trùng.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {uncertain ? 'Thử lại cùng thao tác' : 'Ghi nhận'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
