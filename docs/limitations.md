# Hạn chế đã biết

Trạng thái mới nhất 16/09/2026: xem [bộ nhớ dự án](../PROJECT_MEMORY.md) và [test report](test-report.md). Luồng thanh toán, hóa đơn/đánh giá và realtime đã có kiểm thử tích hợp; chưa kiểm tra trực quan trên browser thật.

- **AI live chưa verify trong môi trường dev** vì thiếu API key. Đã có fallback rule-based và adapter sẵn sàng; live mode sẽ chạy khi set `AI_MODE=live` + `AI_API_KEY`.
- **MongoDB cần replica set** để dùng transaction; compose.yaml đã cấu hình nhưng cần Docker Desktop chạy. Test integration dùng `mongodb-memory-server` để thay thế.
- **Ảnh món lấy từ Unsplash** — chưa upload asset riêng. Có thể thay bằng pipeline upload trong P2.
- **Chưa chạy Playwright E2E** — flow đã thiết kế trong `docs/test-report.md`; cần cài browser và viết script.
- **Chưa có Vercel/Netlify deployment** — README hướng dẫn chạy local; production deploy cần thêm reverse proxy + HTTPS config.
- **Thanh toán online chưa tích hợp** — chỉ "xác nhận tại quầy" trong P0. P2 sẽ thêm sandbox (Stripe/MoMo/VNPay).
- **QR đổi thủ công** — admin đã đổi token và tải ảnh PNG; chưa xoay/thu hồi theo lịch.
- **Không có giỏ cộng tác** — mỗi thiết bị có giỏ riêng (theo yêu cầu P0).
- **Chưa có PWA offline** — phụ thuộc P2.
- **Dashboard chỉ có 30 ngày mặc định** — chưa có export CSV/PDF.
- **Không có analytics nâng cao cho chủ quán** — chỉ KPI cơ bản + top sản phẩm.
