# Demo script — 8 phút

## Chuẩn bị trước

- Ưu tiên production-local: tạo `.env.production` theo `docs/deployment.md`, rồi `docker compose -f compose.production.yaml --env-file .env.production up -d --build`.
- Seed demo là thao tác phá dữ liệu hiện có; chỉ chạy `npm run seed` khi đã xác nhận đúng database demo.
- Mở `http://localhost:8080` và kiểm tra `http://localhost:8080/healthz`.
- Trên điện thoại cùng mạng Wi-Fi, mở `<IP-máy>:5173/t/<token-bàn-01>`. Lấy token từ log khi seed.
- Mở sẵn:
  - 1 tab guest trên điện thoại (hoặc tab ẩn danh).
  - 1 tab guest thứ hai trên trình duyệt khác.
  - 1 tab staff `/staff/kds` (login `staff.a@maycafe.vn / MayCafe@2025`).
  - 1 tab admin `/admin/operations`.

## Kịch bản

| Thời gian | Thao tác | Giá trị |
| --- | --- | --- |
| 0:00–0:30 | Giới thiệu: QR + AI Barista + Realtime + bảo mật | Đặt bối cảnh |
| 0:30–1:30 | Trên admin, đổi trạng thái "Cà phê Sữa Đá" → tạm hết | Quản trị thời gian thực |
| 1:30–3:00 | Trên guest, hỏi AI "Trà ít ngọt, dưới 50 nghìn", chọn Trà Đào, tùy chỉnh size M, đường 30%, topping trân châu | AI gắn menu, tùy chỉnh |
| 3:00–4:00 | Thêm vào giỏ + đặt món; quan sát KDS đồng thời đón đơn mới | Realtime |
| 4:00–5:00 | Trên KDS, chuyển đơn CONFIRMED → PREPARING → READY → SERVED | State machine đúng |
| 5:00–5:45 | Mở thiết bị thứ hai vào cùng bàn, đặt thêm 1 món; chứng minh hai đơn riêng, giỏ riêng | Đa thiết bị |
| 5:45–6:30 | Khách gửi "Yêu cầu thanh toán"; Staff chuyển phiên sang CHECKOUT, xem bill, thu tiền, phiên đóng | Vòng đời phiên |
| 6:30–7:00 | Mở dashboard, lọc 30 ngày, KPI, biểu đồ ngày/giờ, top sản phẩm | Báo cáo từ dữ liệu thật |
| 7:00–7:30 | Mở Operations: instance/dependency/alert có timestamp, dữ liệu thiếu ghi rõ | Observability thật |
| 7:30–8:00 | Hỏi AI ở `AI_MODE=fallback` → response ghi rõ fallback; nêu key live hiện bị provider từ chối 401 | Fallback minh bạch, không giả live |

## Phương án dự phòng khi mất mạng

- Có thể dùng LAN; nếu dùng tunnel/HTTPS phải cập nhật đúng origin, cookie Secure và proxy WebSocket theo `docs/deployment.md`.
- AI fallback luôn hoạt động không cần internet ngoài.
- Realtime: nếu socket mất kết nối, UI vẫn lấy dữ liệu qua REST (TanStack Query refetch mỗi 8–30s tùy trang).

Camera/in QR thật chưa nằm trong kết quả nghiệm thu hiện tại. Khi test sau, dùng domain/IP mà điện thoại truy cập được và xác nhận cookie, redirect `/t/<token>` → `/menu`, Socket.IO reconnect và receipt sau thanh toán.
