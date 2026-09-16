# Design system

## Tokens

```css
:root {
  --background: #FAF7F2;
  --foreground: #2B2118;
  --primary: #285943;
  --primary-foreground: #FAF7F2;
  --accent: #C88A4D;
  --muted: #EFEAE2;
  --muted-foreground: #6B5E52;
  --danger: #C0392B;
  --success: #2D8F4E;
}
```

## Typography

- **Sans** (nội dung): Inter, Be Vietnam Pro, system-ui.
- **Display** (tiêu đề): Playfair Display, Be Vietnam Pro, serif.

## Component

- `Button`: variant `primary | accent | outline | ghost | danger`, size `sm | md | lg | icon`, tối thiểu 44×44 px vùng chạm.
- `Card`: rounded-2xl, border mờ, shadow-soft.
- `Modal`: Radix Dialog, có overlay + close button + accessible title.
- `Toast`: Radix Toast Viewport góc phải.
- `Badge`: tone neutral/success/danger/warning/info.
- `Skeleton`: shimmer linear gradient, tôn trọng `prefers-reduced-motion`.

## Responsive

- Mobile first; kiểm tra 375px, 768px, 1440px.
- Mobile: bottom-sheet cho chi tiết món, bottom bar cho giỏ hàng, CTA cố định phía dưới với `safe-bottom` padding.
- Tablet: 2 cột menu.
- Desktop: 3 cột menu, sidebar KDS chia cột, dashboard 4 KPI + 2 biểu đồ.

## Trạng thái UI

Mọi màn hình lấy dữ liệu đều có:

- Loading: Skeleton hoặc spinner nhẹ.
- Error: ErrorState + nút Thử lại.
- Empty: EmptyState với mô tả & CTA.
- Success: nội dung chính.

Animation 150–250ms; tôn trọng `prefers-reduced-motion`.

## Accessibility

- Nút icon có `aria-label`.
- Ảnh món có `alt` (tên món).
- Form có label + thông báo lỗi tại trường.
- Modal quản lý focus trap.
- Không phân biệt trạng thái chỉ bằng màu — luôn có text/Icon kèm theo.
