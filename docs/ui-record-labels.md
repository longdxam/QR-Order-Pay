# Thông tin dễ nhận biết thay cho mã bản ghi — 16/11/2026

Theo yêu cầu tối ưu giao diện, mã tự sinh của bản ghi không còn dùng làm tiêu đề, nội dung thẻ, nhãn lựa chọn hay thông báo cho người dùng.

| Màn hình                                    | Thông tin hiển thị                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Đặt bàn (khách/Staff/Admin)                 | Tên khách, bàn, số khách, giờ đến/kết thúc, trạng thái; dialog Xử lý/Hủy lịch đặt và xác nhận giữ chỗ không có DB-…                   |
| Đơn khách, KDS, chờ thanh toán, yêu cầu hủy | Bàn + thời điểm đặt theo giờ Việt Nam, tên/số lượng món, số tiền và trạng thái; bỏ MC… khỏi tiêu đề và câu xác nhận                   |
| Hóa đơn                                     | Bàn, người thu, thời điểm chốt và khoản thanh toán; bỏ cột/input mã hóa đơn, tiêu đề modal dùng Chi tiết hóa đơn                      |
| Khoản thu/điều chỉnh                        | Bàn, thời điểm thu, phương thức, số tiền; chi tiết không lộ payment/order/session ID; chọn đơn nhận khoản thu bằng bàn + ngày giờ đặt |
| Ca thu ngân, hiệu suất                      | Người mở/chốt, thời gian và trạng thái; bỏ mã CA…                                                                                     |
| Bàn/chuyển bàn/quà                          | Tên bàn, số chỗ, người gửi đã cho phép hiển thị; bỏ mã bàn lặp với tên                                                                |
| Ảnh cốc/latte art và tem                    | Tên món, size, số lượng/cốc, nơi phục vụ; không có mã đơn hoặc chỉ số dòng; tên file PNG dùng tên món                                 |
| Thành viên, đánh giá, kho                   | Lịch sử điểm theo loại/thời điểm, nhận xét theo bàn/thời gian, di chuyển kho theo nội dung; bỏ mã đơn/ID thô                          |
| Vận hành                                    | Tên/chức năng tác vụ, trạng thái, thời gian và thông báo lỗi; bỏ instance/worker/job/aggregate ID khỏi nội dung hiển thị              |

Mã voucher và QR/link vào bàn là công cụ người dùng nhập, quét hoặc chia sẻ để thực hiện chức năng; vẫn có ở đúng chỗ sử dụng. React keys, giá trị option, URL API, requestId/idempotency, khóa tra cứu, các mã đã lưu và snapshot hóa đơn giữ nguyên. Đây là thay đổi cách trình bày, không xóa hay đổi mã trong dữ liệu.

`recordLabels.ts` dùng bàn + ngày/giờ/giây theo Asia/Ho_Chi_Minh, không lấy ID làm fallback. API tra cứu điều chỉnh bổ sung tên bàn/thời điểm tạo; danh sách yêu cầu hủy bổ sung thông tin bàn/thời điểm để Staff nhận biết đúng đơn. Thao tác vẫn dùng đúng ID nội bộ; không dùng nhãn người đọc làm khóa.

Kiểm chứng: 217 client + 144 server unit + 278 integration đạt; test mới chọn giữa hai đơn cùng bàn/cùng tiền ở hai thời điểm và xác nhận payload vẫn chứa đúng targetOrderId. Test API kiểm tên bàn/thời điểm bổ sung; các kiểm tra phiên bản, quyền, chống ghi trùng và tiền vẫn đạt. Build/deploy bốn API A/B + web/PWA76; không thay worker hoặc dữ liệu.

Lightpanda kiểm DOM/network 26 màn Staff/Admin và menu public, modal đặt bàn/hóa đơn, chi tiết khoản thu mở ra; không còn các mẫu mã tự sinh trong text. Không ghi nghiệp vụ (chỉ auth và tác vụ đọc báo cáo), không pageerror/5xx. Hash trước/sau giữ nguyên ở orders/payments/bills/paymentcorrections/products/tables/reservations. Không dùng DOM làm chứng cứ render trực quan, bộ chọn ngày native, in tem/hóa đơn vật lý hoặc điện thoại thật.
