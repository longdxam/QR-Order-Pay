# Frontend reference notes

## Nguồn tham khảo

- [PatrickJS/awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules) — thư viện quy tắc cho agent; tham khảo cách tổ chức mã và quy ước component.
- [Quy tắc React, TypeScript, shadcn/ui](https://github.com/PatrickJS/awesome-cursorrules/blob/main/rules/cursor-ai-react-typescript-shadcn-ui-cursorrules-p.mdc) — ngày truy cập 2026-09-16.
- [Quy tắc Tailwind + shadcn/ui](https://github.com/PatrickJS/awesome-cursorrules/blob/main/rules/tailwind-shadcn-ui-integration-cursorrules-prompt-.mdc) — ngày truy cập 2026-09-16.
- [sharkqwy/v0prompt](https://github.com/sharkqwy/v0prompt) — README tự mô tả là prompt v0 được reverse-engineer; tham khảo tài liệu cộng đồng, không xem là đặc tả chính thức của Vercel.

## Quy tắc áp dụng

1. **TypeScript strict** — không `any` tràn lan, không tắt kiểm tra kiểu.
2. **Component tách file theo feature** — không nhồi nhiều trách nhiệm.
3. **Props có kiểu rõ ràng** — interface ngay trên file.
4. **Không hardcode chuỗi trong JSX** — đưa ra constants khi dùng nhiều lần.
5. **Tailwind tokens** — không hardcode màu, dùng class `bg-primary`, `text-foreground`, ...
6. **Accessibility** — nút icon có `aria-label`, dialog quản lý focus.
7. **Responsive mobile-first** — kiểm tra 375/768/1440.

## Điều chỉnh cho dự án

- Dự án **KHÔNG** dùng Next.js — dùng React SPA + Vite + Express.
- **KHÔNG** dùng shadcn/ui scaffold đầy đủ — dùng Radix primitives + Tailwind + Lucide để giữ dependency nhỏ, vẫn accessible.
- **KHÔNG** dùng ảnh placeholder / path giả — dùng URL Unsplash cho ảnh món thật.
- **KHÔNG** copy toàn bộ system prompt từ v0prompt — chỉ giữ nguyên tắc "component hoàn chỉnh, đủ import".
- **KHÔNG** dừng xác nhận từng component — triển khai liên tục đến khi đạt P0 + P1.
