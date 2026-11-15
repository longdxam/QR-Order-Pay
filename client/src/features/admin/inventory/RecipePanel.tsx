import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { IngredientDto, RecipeDto, RecipeSaveInput } from '@may-cafe/contracts';
import { recipeSaveSchema } from '@may-cafe/contracts';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { useToast } from '../../../components/ui/useToast';
import { api, getErrorMessage } from '../../../lib/api';
import { Field } from './Field';
import { selectClass, unitLabel, type Overview, type Target } from './shared';

type DraftLine = { ingredientId: string; quantity: string };
type DraftVariant = { variantId: string; components: DraftLine[] };
const draftLines = (lines: RecipeSaveInput['components']): DraftLine[] =>
  lines.map((c) => ({ ...c, quantity: String(c.quantity) }));

export function RecipePanel({ data, onSaved }: { data: Overview; onSaved: () => void }) {
  const [selection, setSelection] = useState('');
  const [kind, id] = selection.split(':');
  const target = (kind === 'PRODUCT' ? data.products : data.toppings).find((t) => t.id === id);
  const recipe = data.recipes.find((r) => r.targetType === kind && r.targetId === id);
  return (
    <Card className="space-y-4 p-4">
      <p className="text-sm text-muted-foreground">
        Công thức nền áp dụng cho mọi size. Công thức riêng của size thay thế toàn bộ nền. Topping
        có công thức riêng và được cộng thêm khi đặt món. Món chưa bật công thức giữ cách bán hiện
        tại.
      </p>
      <Field label="Món hoặc topping">
        <select
          className={selectClass}
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
        >
          <option value="">Chọn món / topping</option>
          <optgroup label="Món">
            {data.products.map((t) => (
              <option key={t.id} value={`PRODUCT:${t.id}`}>
                {t.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Topping">
            {data.toppings.map((t) => (
              <option key={t.id} value={`TOPPING:${t.id}`}>
                {t.name}
              </option>
            ))}
          </optgroup>
        </select>
      </Field>
      {target && (
        <RecipeEditor
          key={`${selection}:${recipe?.version ?? 0}`}
          target={target}
          kind={kind as 'PRODUCT' | 'TOPPING'}
          recipe={recipe}
          ingredients={data.ingredients}
          onSaved={onSaved}
        />
      )}
    </Card>
  );
}
function RecipeEditor({
  target,
  kind,
  recipe,
  ingredients,
  onSaved,
}: {
  target: Target;
  kind: 'PRODUCT' | 'TOPPING';
  recipe?: RecipeDto;
  ingredients: IngredientDto[];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(recipe?.enabled ?? false);
  const [lines, setLines] = useState<DraftLine[]>(draftLines(recipe?.components ?? []));
  const [variants, setVariants] = useState<DraftVariant[]>(
    (recipe?.variants ?? []).map((v) => ({
      variantId: v.variantId,
      components: draftLines(v.components),
    })),
  );
  const save = useMutation({
    mutationFn: async () => {
      const convert = (items: DraftLine[]) =>
        items.map((c) => ({ ingredientId: c.ingredientId, quantity: Number(c.quantity) }));
      const parsed = recipeSaveSchema.safeParse({
        enabled,
        components: convert(lines),
        variants: variants.map((v) => ({
          variantId: v.variantId,
          components: convert(v.components),
        })),
        expectedVersion: recipe?.version ?? 0,
      });
      if (!parsed.success)
        throw new Error(parsed.error.issues[0]?.message ?? 'Công thức chưa hợp lệ.');
      return api.put(`/admin/inventory/recipes/${kind}/${target.id}`, parsed.data);
    },
    onSuccess: () => {
      onSaved();
      toast({ title: 'Đã lưu công thức', tone: 'success' });
    },
    onError: (e) =>
      toast({ title: 'Chưa lưu được', description: getErrorMessage(e), tone: 'danger' }),
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex flex-wrap justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Áp dụng công thức và kiểm soát kho
        </label>
        <Badge tone={target.effectiveAvailable ? 'success' : 'danger'}>
          {target.effectiveAvailable
            ? 'Có thể bán'
            : target.isAvailable
              ? 'Thiếu nguyên liệu hoặc size tạm hết'
              : 'Đã tạm ngừng bán'}
        </Badge>
      </div>
      <fieldset disabled={save.isPending} className="space-y-4">
        <legend className="mb-2 font-semibold">Công thức nền cho 1 phần</legend>
        <ComponentLines lines={lines} onChange={setLines} ingredients={ingredients} />
        {kind === 'PRODUCT' &&
          target.variants?.map((v) => {
            const custom = variants.find((row) => row.variantId === v.id);
            return (
              <div key={v.id} className="space-y-2 rounded-xl border border-border p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!custom}
                    onChange={(e) =>
                      setVariants(
                        e.target.checked
                          ? [
                              ...variants,
                              { variantId: v.id, components: lines.map((l) => ({ ...l })) },
                            ]
                          : variants.filter((row) => row.variantId !== v.id),
                      )
                    }
                  />
                  Công thức riêng size {v.name}
                </label>
                {custom && (
                  <ComponentLines
                    ingredients={ingredients}
                    lines={custom.components}
                    onChange={(components) =>
                      setVariants(
                        variants.map((row) =>
                          row.variantId === v.id ? { ...row, components } : row,
                        ),
                      )
                    }
                  />
                )}
              </div>
            );
          })}
      </fieldset>
      <Button disabled={save.isPending} type="submit">
        Lưu công thức
      </Button>
    </form>
  );
}
function ComponentLines({
  lines,
  onChange,
  ingredients,
}: {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  ingredients: IngredientDto[];
}) {
  return (
    <div className="space-y-2">
      {lines.map((line, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_6rem_auto] items-end gap-2">
          <Field label={`Nguyên liệu ${index + 1}`}>
            <select
              required
              className={selectClass}
              value={line.ingredientId}
              onChange={(e) =>
                onChange(
                  lines.map((c, i) => (i === index ? { ...c, ingredientId: e.target.value } : c)),
                )
              }
            >
              <option value="">Chọn nguyên liệu</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({unitLabel(i.unit)}){i.isActive ? '' : ' · Ngừng dùng'}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Định lượng ${index + 1}`}>
            <Input
              required
              type="number"
              min="0.001"
              max="1000000000"
              step="0.001"
              value={line.quantity}
              onChange={(e) =>
                onChange(
                  lines.map((c, i) => (i === index ? { ...c, quantity: e.target.value } : c)),
                )
              }
            />
          </Field>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Xóa nguyên liệu ${index + 1}`}
            onClick={() => onChange(lines.filter((_, i) => i !== index))}
          >
            ×
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...lines, { ingredientId: '', quantity: '' }])}
      >
        Thêm dòng nguyên liệu
      </Button>
    </div>
  );
}
