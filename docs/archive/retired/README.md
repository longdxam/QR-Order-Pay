# Tài liệu tính năng đã ngừng

Các tài liệu dưới đây chỉ giữ lịch sử thiết kế và kiểm thử trước ngày **07/11/2026**, không phải hướng dẫn tính năng đang chạy:

- [Mang đi / đặt trước nhận tại quầy](pickup.md)
- [Mini-game Ai trả tiền](mini-game.md)
- [AI Freestyle ngoài thực đơn](freestyle.md)
- [Smart Insights](smart-insights.md)

Không có màn hình hoặc API tạo mới cho các tính năng này. Schema/migration và snapshot cũ còn giữ để đọc dữ liệu, đối soát và hoàn tất lịch sử; không xóa sổ tiền để làm sạch giao diện.

Khoản thu Staff/Admin mặc định chỉ hiện khoản thu tại bàn. Tab **Lịch sử đã lưu trữ** chứa khoản thu của loại đơn cũ, ghi **Đơn lịch sử** khi không có bàn; chi tiết vẫn giữ mã đơn và thời gian thu. Đếm và phân trang được lọc trên server. Các khoản thu này vẫn thuộc sổ tiền và báo cáo tổng; mục lưu trữ không tạo lại chức năng gọi món đã gỡ.

Xem [phạm vi hiện hành](../../retired-features.md) và [README dự án](../../../README.md).
