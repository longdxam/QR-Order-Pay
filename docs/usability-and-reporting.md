# Luồng khách, vận hành và báo cáo — 15/11/2026

## Khách

- Thực đơn giữ hero toàn màn hình khi duyệt. Có từ khóa hoặc bộ lọc áp dụng thì chỉ giữ thanh công cụ gọn, kết quả nằm ngay bên dưới; không dựng ảnh nền/caption/gradient hero trong chế độ tìm. Xóa tìm kiếm và bộ lọc khôi phục hero.
- Bộ lọc kết hợp từ khóa, không còn ép câu tìm thành “món”. Mở/đóng panel không bật/tắt điều kiện đang chọn. Tóm tắt điều kiện vẫn hiện trong kết quả khi panel đã đóng; **Xem toàn bộ thực đơn** xóa cả hai.
- AI bắt đầu bằng ô trống có placeholder. Chip chỉ điền khi người dùng bấm, không gửi câu mẫu tự động. Khách chưa vào bàn bấm **Quét QR để đặt** ở modal sẽ đóng modal và đi `/t`, kể cả món chưa có cấu hình chọn hợp lệ; không thêm giỏ hoặc gọi API đặt đơn.
- Ảnh: kiểm tra bản đang chạy cho thấy **20/20 món đã có asset WebP nội bộ hợp lệ**, không tái hiện được dữ liệu “12 món thiếu ảnh” trong catalog hiện tại. Không thêm ảnh giả hay sửa dữ liệu món. Catalog chuyển sang tải ảnh ngay, có alt theo tên; URL Unsplash thay tham số kích thước vẫn dùng bản nội bộ cùng ảnh. Hero, catalog, modal và AI dùng chung bộ phân giải ảnh. `node scripts/audit-menu-images.mjs [origin]` kiểm đủ món công khai, HTTP/content-type/magic bytes; PIL kiểm giải mã các file hiện có. Kiểm này không chứng minh hình chụp thực tế của món hoặc layout trên thiết bị.

## Vận hành và đăng nhập

- **Bàn & phiên → Chờ thanh toán** là nơi chính nhận tiền, có anchor `#awaiting-payments`. KDS chỉ có liên kết gọn tới đó khi có đơn chờ thu; không có quy trình thu tiền thứ hai tại KDS. **Khoản thu** là lịch sử/đối soát/điều chỉnh, có liên kết rõ tới nơi nhận tiền.
- Bốn cột pha chế nằm trước lịch sử hủy. Lịch sử ở disclosure dưới cùng, đóng mặc định; yêu cầu hủy đang chờ vẫn hiện nổi bật để xử lý kịp thời.
- `VITE_SHOW_DEMO_CREDENTIALS=false` mặc định: form trống, ẩn hướng dẫn tài khoản/mật khẩu demo. Chỉ đặt `true` khi muốn trình diễn. Đây là **cờ build của frontend**, cần build lại web sau khi đổi; Compose và client Dockerfile đã truyền cờ. Không đổi tài khoản hoặc mật khẩu đã lưu trong DB.

## Cách đọc báo cáo

- Thời gian tính theo **Asia/Ho_Chi_Minh**, gồm trọn từ ngày đầu đến ngày cuối đã chọn. So sánh là khoảng liền trước có cùng số ngày lịch; không suy ra doanh thu tương lai từ khoảng trống.
- **Thực thu ròng** = tiền thu − hoàn thực tế + điều chỉnh, theo thời điểm từng giao dịch Payment. Biểu đồ cột có đủ mọi ngày, điền 0 khi không có sự kiện; không nối spline qua nhiều ngày trống. Theo giờ cộng giao dịch cùng giờ trong toàn khoảng chọn. Cột xanh là ròng dương, đỏ là âm; âm có thể do hoàn/điều chỉnh vượt thu. Có đường 0, tooltip tiền/ngày/giờ và mục **Cách đọc**.
- **Theo phương thức**: tiền vào theo phương thức thu, tiền hoàn theo phương thức hoàn thực tế; đổi phương thức ghi giảm bên cũ/tăng bên mới. Tổng Ròng các phương thức bằng KPI thực thu ròng. Trường thiếu phương thức không được gán giả thành tiền mặt.
- **Đơn tạo / giờ cao điểm**: đếm tất cả đơn tạo trong kỳ, gồm chờ thanh toán và đã hủy; độc lập với ngày thu tiền. **Tỉ lệ hủy** = số đơn có trạng thái hiện tại CANCELLED trong nhóm đơn tạo trong kỳ / tổng nhóm đó. Không có đơn thì chưa có mẫu, không ghi tỉ lệ 0% giả.
- **Tiền món theo danh mục**: cộng lineTotal snapshot của đơn PAID chưa hủy, theo ngày tạo; trước ưu đãi/hoàn/điều chỉnh tài chính. Dùng danh mục hiện tại vì dữ liệu đơn cũ không có snapshot danh mục; sản phẩm/danh mục không còn tra được vào Chưa phân loại. Đây là chỉ số cơ cấu món, **không phải thực thu ròng**, không cộng hai chỉ số với nhau.
- Kỳ trước có ròng 0 hoặc âm chỉ so chênh lệch tiền, không tính phần trăm tăng trưởng gây hiểu nhầm. Kỳ không có dữ liệu hiện trạng thái rỗng; có thu và hoàn bằng nhau vẫn là dữ liệu thật, vẫn vẽ biểu đồ.
- CSV có cùng số liệu ngày/giờ, cơ cấu món, phương thức và kỳ trước; số tiền âm giữ kiểu số, tên giống công thức spreadsheet được escape. In/PDF theo nội dung trang.

Kiểm thử dùng DB replica set tạm. Smoke bản chạy dùng Lightpanda, chỉ xác nhận DOM/network, không khẳng định render trực quan, quét camera, zoom Safari hay cảm ứng điện thoại thật. **Giới hạn cụ thể:** lệnh fill ô ngày native của Lightpanda đổi DOM value nhưng không phát change handler React; chưa xác minh thao tác chọn ngày native bằng browser. Test jsdom xác nhận handler đổi khoảng và 5 trạng thái rỗng; worker/API xác nhận kỳ rỗng có đủ ngày và không có mẫu tỉ lệ hủy. Không dùng Chrome/Chromium thay thế. Không seed/reset, không tạo đơn/thu/hoàn hoặc đổi catalog để kiểm trên quán.
