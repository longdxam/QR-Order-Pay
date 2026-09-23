# Yêu cầu & Use Case — Mây Café

## Actors

- **Guest (khách tại bàn):** Mỗi thiết bị là một danh tính riêng trong phiên bàn. Không cần đăng ký.
- **Staff (nhân viên):** Phục vụ, vận hành bếp/bar, thu tiền.
- **Admin (quản trị):** Quản lý menu, bàn, nhân viên và xem báo cáo.

## Use cases chính

| Mã | Use case | Actor | Mô tả ngắn |
| --- | --- | --- | --- |
| UC-01 | Quét QR / nhập mã vào bàn | Guest | Token hợp lệ tự mở phiên cho bàn trống hoặc tham gia phiên đang hoạt động. |
| UC-02 | Xem menu & tùy chỉnh món | Guest | Chọn size, đường, đá, topping, ghi chú. |
| UC-03 | Hỏi AI Barista | Guest | Nhập khẩu vị/ngân sách, nhận gợi ý có lý do. |
| UC-04 | Đặt món | Guest | Gửi giỏ với idempotency, nhận trạng thái realtime. |
| UC-05 | Huỷ đơn | Guest | Chỉ khi đơn còn PENDING. |
| UC-06 | Yêu cầu nhân viên / thanh toán | Guest | Gửi yêu cầu, Staff nhận và xử lý. |
| UC-07 | Đánh giá đơn | Guest | Sau khi đơn SERVED + PAID, 1–5 sao + nhận xét. |
| UC-08 | Theo dõi phiên bàn | Staff/Admin | Xem realtime các phiên khách tự mở, bàn đang phục vụ và bàn trống. |
| UC-09 | Tiếp nhận & chuyển trạng thái đơn | Staff | Theo state machine. |
| UC-10 | Thu tiền & đóng phiên | Staff | Kiểm tra tổng, ghi Payment, đóng phiên. |
| UC-11 | Quản lý menu | Admin | CRUD danh mục, món, topping, bật/tắt còn bán. |
| UC-12 | Quản lý bàn | Admin | CRUD bàn, xoay token QR (P2). |
| UC-13 | Quản lý nhân viên | Admin | CRUD tài khoản Staff. |
| UC-14 | Xem báo cáo | Admin | Doanh thu, top món, biểu đồ theo ngày/giờ. |

## Acceptance criteria chính

- Guest A không thể đọc/huỷ/đánh giá đơn của Guest B ngay cả khi cùng bàn.
- Đơn gửi 2 lần với cùng `Idempotency-Key` và cùng payload trả cùng đơn (HTTP 200, `created=false`).
- Hai request `PATCH /staff/orders/:id/status` đồng thời chỉ một thành công; cái còn lại trả 409.
- Thay đổi giá trên server không bị client ép; payload chỉ gồm id option.
- Đóng phiên hoàn tất chỉ khi tất cả đơn đã SERVED hoặc CANCELLED; Payment ghi trong transaction.
- AI Barista không trả về món ngoài menu, không vượt ngân sách; trả `mode: "llm"` hoặc `mode: "fallback"` rõ ràng.
