import { Plus, Sparkles } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import type { Category, FormState, TagSuggestions } from './model';

const controlCls =
  'rounded-md border border-control bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary';
const inputCls = `w-full ${controlCls}`;

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

/** Form thÃªm/sá»­a mÃ³n (controlled). Chá»‰ hiá»ƒn thá»‹ vÃ  bÃ¡o thay Ä‘á»•i; lÆ°u/gá»£i Ã½ tag do trang cha thá»±c hiá»‡n. */
export function ProductForm({
  form,
  onChange,
  categories,
  saving,
  onSubmit,
  onCancel,
  tagSuggestions,
  suggesting,
  onSuggestTags,
  onAddTags,
}: {
  form: FormState;
  onChange: (next: FormState) => void;
  categories: Category[];
  saving: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  tagSuggestions: TagSuggestions | null;
  suggesting: boolean;
  onSuggestTags: () => void;
  onAddTags: (tags: string[]) => void;
}): JSX.Element {
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Field label="Tên món">
        <input
          className={inputCls}
          required
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
        />
      </Field>
      <Field label="Mô tả">
        <textarea
          className={inputCls + ' min-h-20'}
          required
          value={form.description}
          onChange={(e) => onChange({ ...form, description: e.target.value })}
        />
      </Field>
      <Field label="URL ảnh">
        <input
          className={inputCls}
          required
          value={form.image}
          onChange={(e) => onChange({ ...form, image: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Giá cơ bản (VND)">
          <input
            className={inputCls}
            type="number"
            min={0}
            required
            value={form.basePrice}
            onChange={(e) => onChange({ ...form, basePrice: e.target.value })}
          />
        </Field>
        <Field label="Danh mục">
          <select
            className={inputCls}
            aria-label="Danh mục"
            required
            value={form.categoryId}
            onChange={(e) => onChange({ ...form, categoryId: e.target.value })}
          >
            <option value="">-- chọn --</option>
            {categories.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
                {!c.isActive ? ' (đã ẩn)' : ''}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Tags (phân cách dấu phẩy)">
        <input
          className={inputCls}
          placeholder="best-seller, signature"
          value={form.tagInput}
          onChange={(e) => onChange({ ...form, tagInput: e.target.value })}
        />
      </Field>
      <div className="space-y-2 rounded-md border border-border p-3" data-testid="ai-tag-panel">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Tag giúp AI và tìm kiếm hiểu món (mát lạnh, tỉnh táo…). Chọn rồi bấm Lưu.
          </p>
          <Button
            size="sm"
            variant="outline"
            type="button"
            disabled={suggesting || !form.name.trim()}
            onClick={() => onSuggestTags()}
          >
            <Sparkles className="h-3 w-3" />
            {suggesting ? 'Đang gợi ý…' : 'AI gợi ý tag'}
          </Button>
        </div>
        {tagSuggestions ? (
          tagSuggestions.tags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={tagSuggestions.mode === 'llm' ? 'success' : 'warning'}>
                {tagSuggestions.mode === 'llm' ? 'AI' : 'Theo mô tả'}
              </Badge>
              {tagSuggestions.tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted"
                  aria-label={`Thêm tag ${tag}`}
                  onClick={() => onAddTags([tag])}
                >
                  + {tag}
                </button>
              ))}
              <button
                type="button"
                className="text-xs font-medium text-primary underline"
                onClick={() => onAddTags(tagSuggestions.tags)}
              >
                Thêm tất cả
              </button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Không có tag mới để gợi ý.</p>
          )
        ) : null}
      </div>
      <div>
        <p className="text-sm font-medium mb-1">Size / giá</p>
        <div className="space-y-1">
          {form.variants.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                // Không dùng inputCls ở hàng size/giá: w-full của nó thắng w-20 và đè ô giá còn ~0px.
                className={controlCls + ' w-20 shrink-0'}
                placeholder="Tên"
                value={v.name}
                onChange={(e) => {
                  const next = [...form.variants];
                  next[i] = { ...v, name: e.target.value };
                  onChange({ ...form, variants: next });
                }}
              />
              <input
                className={controlCls + ' min-w-0 flex-1'}
                type="number"
                min={0}
                placeholder="Giá"
                value={v.price}
                onChange={(e) => {
                  const next = [...form.variants];
                  next[i] = { ...v, price: Number(e.target.value) };
                  onChange({ ...form, variants: next });
                }}
              />
              <button
                type="button"
                className="text-xs text-danger"
                onClick={() =>
                  onChange({ ...form, variants: form.variants.filter((_, idx) => idx !== i) })
                }
              >
                Xoá
              </button>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            type="button"
            onClick={() =>
              onChange({
                ...form,
                variants: [
                  ...form.variants,
                  { name: 'L', price: Number(form.basePrice) + 5000, isAvailable: true },
                ],
              })
            }
          >
            <Plus className="h-3 w-3" /> Thêm size
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isAvailable}
            onChange={(e) => onChange({ ...form, isAvailable: e.target.checked })}
          />
          Đang bán
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isFeatured}
            onChange={(e) => onChange({ ...form, isFeatured: e.target.checked })}
          />
          Nổi bật
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isArchived}
            onChange={(e) => onChange({ ...form, isArchived: e.target.checked })}
          />
          Đã xóa mềm
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" type="button" onClick={() => onCancel()}>
          Huỷ
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Đang lưu...' : 'Lưu'}
        </Button>
      </div>
    </form>
  );
}
