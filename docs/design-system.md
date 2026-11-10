# Design system

## Tokens

Từ 09/11/2026, cả ba portal dùng bảng màu sáng theo ảnh Coffo người dùng cung cấp: trắng ngà, nâu cà phê và vàng be. Sau feedback thiếu tương phản trên toàn web, chữ/primary được tăng độ đậm, thêm token viền điều khiển và tách màu be trang trí khỏi màu chữ nhấn. RGB tokens được Tailwind dùng chung; `theme-guest` chỉ giới hạn các kiểu bề mặt khách.

```css
:root {
  --c-background: 248 247 245; /* #F8F7F5 */
  --c-foreground: 37 30 25; /* #251E19 */
  --c-primary: 105 67 44; /* #69432C */
  --c-primary-fg: 255 255 255;
  --c-accent: 206 171 132; /* #CEAB84 */
  --c-accent-fg: 37 30 25;
  --c-accent-ink: 135 81 39; /* #875127 */
  --c-muted: 235 227 218; /* #EBE3DA */
  --c-muted-fg: 87 74 64; /* #574A40 */
  --c-border: 176 154 135; /* #B09A87: phân nhóm card, đường phân cách */
  --c-control: 126 105 88; /* #7E6958: ô nhập, select, nút outline */
  --c-card: 255 255 255;
  --c-card-fg: 37 30 25;
  --c-danger: 167 43 32;
  --c-success: 34 101 58;
}
```

Chữ chính/nền ngà 15,34:1; chữ phụ/nền ngà 7,98:1; chữ phụ/nền muted 6,72:1; trắng/primary 8,61:1; trắng/primary hover 90% trên trắng 6,56:1; chữ trắng 70% trên primary 5,18:1. Accent-ink trên trắng 6,49:1; chữ đậm/be 7,65:1. Viền control trên trắng/ngà/muted đạt 5,19/4,84/4,08:1; nút be dùng viền primary, tương phản 4,01:1 với phần nền be bên trong. Đây là tỷ lệ tính từ token và phép pha alpha, không phải kết quả kiểm ảnh render hay đánh giá accessibility toàn trang.

Nút chính, danh mục đang chọn và sidebar đang chọn dùng nâu đặc/chữ trắng; thẻ món đang xem có viền nâu và số thứ tự nền nâu. Dùng `border-control` cho điều khiển, `border-border` cho bề mặt/đường chia; focus dùng primary đặc. Giữ accent be cho trang trí/nền phụ, dùng `text-accent-ink` cho chữ/biểu tượng cần đọc; biểu đồ cột cũng dùng accent-ink. Trạng thái disabled vẫn giảm opacity để thể hiện chưa thể thao tác.

## Typography

- **Sans** (nội dung): Be Vietnam Pro, system-ui, sans-serif.
- **Display** (tiêu đề): Be Vietnam Pro, system-ui, sans-serif.

## Component

- `Button`: variant `primary | accent | outline | ghost | danger`, size `sm | md | lg | icon`, tối thiểu 44×44 px vùng chạm.
- `Card`: rounded-2xl, border-border rõ ràng, shadow-soft.
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
