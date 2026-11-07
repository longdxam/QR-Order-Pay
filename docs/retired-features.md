# Gỡ chức năng ngày 07/11/2026

Đã gỡ theo yêu cầu: #2 mini-game Ai trả tiền, #6 Takeaway/Pre-order Pickup, #8 AI Freestyle ngoài thực đơn giá cố định, #12 Smart Insights và gợi ý bán kèm.

- Xóa màn hình, menu điều hướng, module client, controller/service API và contracts tạo mới tương ứng; ngừng polling/thông báo đơn mang đi và event game. Các API đã gỡ trả 404, kể cả upload ảnh dành riêng cho pickup.
- AI Barista chỉ còn gợi ý món từ thực đơn, vẫn kiểm tùy chỉnh, giá, ngân sách và caffeine/sữa. Dashboard doanh thu/báo cáo vận hành hiện có tiếp tục hoạt động.
- Giữ đặt bàn theo giờ (#10), kho/công thức, voucher/thành viên/điểm, lịch ca, tặng quà, Jukebox, ảnh cốc/latte art, gọi món tại bàn, KDS, thu/hoàn/điều chỉnh tiền, ca thu ngân và hóa đơn.
- Giỏ lưu từ phiên bản cũ loại bỏ riêng món Freestyle khi nâng phiên bản storage; giữ món thực đơn và identity phiên bàn. API từ chối token Freestyle cũ thay vì âm thầm đổi thành món thực đơn.
- Không xóa hay viết lại dữ liệu nghiệp vụ. Các trường snapshot món và fulfillment trên đơn/hóa đơn, cách đối soát tiền, cùng xử lý kết thúc đơn cũ còn được giữ để đọc lịch sử và hoàn tất đơn đã có. Không thể tạo đơn mang đi/Freestyle mới.
- Giữ nguyên ID/checksum migration cũ và index bảo vệ đơn/hóa đơn. Schema mini-game/Freestyle phục vụ migration nằm riêng ở `server/scripts/legacyFeatureModels.ts`, không được app import.
- Tăng service-worker cache lên v41 để bản build mới không dùng bundle giao diện cũ. URL màn hình đã gỡ dùng fallback của portal, không còn tải module tính năng.

Tài liệu mini-game/pickup/freestyle/smart-insights cũ chỉ là lịch sử. Kiểm tra browser của repository phải dùng Lightpanda; DOM/network không chứng minh layout, cảm ứng, camera, loa hoặc máy in thực tế.

Kiểm chứng: 526 ca hồi quy khác nhau đã đạt (109 unit, 254 integration, 163 client); lint/typecheck/build và OpenAPI hợp lệ. Lightpanda xác nhận DOM/network của luồng gọi món tại bàn đến đối soát và các mục điều hướng còn lại, không có request tới API đã gỡ. Chưa nghiệm thu trực quan/thiết bị thật. Chi tiết bằng chứng và các lượt chạy lại ở [test-report.md](test-report.md). Chưa triển khai lại Docker production-local/public.
