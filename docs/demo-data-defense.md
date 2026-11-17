# Dữ liệu trình diễn và câu trả lời bảo vệ — 16/11/2026

## Trả lời khi được hỏi về Dashboard

> Đây là dữ liệu kiểm thử tích lũy, không phải số liệu kinh doanh của một quán thật. Trong khoảng 18/10–16/11/2026 có 29 đơn được tạo, 17 đơn hủy: 12 đơn chưa thu tiền và 5 đơn đã hoàn tiền. Các thao tác này dùng để thử luồng hủy và hoàn, nên 58,6% không đại diện cho tỉ lệ hủy khi vận hành quán. Kỳ này chỉ có giao dịch ghi nhận bằng tiền mặt; chuyển khoản và phương thức khác được hệ thống hỗ trợ, nhưng không có mẫu trong kỳ đang chọn.

Số liệu đối chiếu ngày 16/11, theo giờ Việt Nam:

| Chỉ số                 |  Giá trị | Cách hiểu                                                             |
| ---------------------- | -------: | --------------------------------------------------------------------- |
| Đơn tạo trong kỳ       |       29 | Gồm mọi trạng thái, kể cả chưa thanh toán                             |
| Đơn hủy                |       17 | 12 UNPAID + 5 REFUNDED; trạng thái hiện tại của nhóm đơn tạo trong kỳ |
| Tỉ lệ hủy              |    58,6% | 17/29; không phải tỉ lệ doanh thu bị mất hay khảo sát khách hàng      |
| Tiền đã thu            | 855.000đ | Theo ngày phát sinh khoản thu                                         |
| Tiền đã hoàn           | 263.000đ | 5 khoản hoàn thực tế được ghi nhận trong kỳ                           |
| Điều chỉnh             |       0đ | Theo thời điểm sự kiện tài chính                                      |
| Thực thu ròng          | 592.000đ | 855.000 − 263.000 + 0                                                 |
| Phương thức có dữ liệu | Tiền mặt | Không suy ra hệ thống chỉ hỗ trợ tiền mặt                             |

Trong 17 đơn hủy có 7 đơn mang đi lịch sử từ tính năng đã gỡ; báo cáo tài chính vẫn giữ chúng để đối soát. Tỉ lệ hủy theo **ngày tạo đơn**, tiền theo **ngày thu/hoàn** nên hai nhóm không luôn trùng nhau. Khi đổi khoảng ngày hoặc phát sinh dữ liệu mới, phải lấy lại số từ Dashboard, không học thuộc con số này cho mọi kỳ.

Các ca tự động đã kiểm nhận từng phần bằng BANK_TRANSFER, đổi CASH sang BANK_TRANSFER và chống ghi lại cùng khoản thu với phương thức khác tại `server/src/__tests__/integration/prepaidQr.test.ts`; báo cáo hoàn khác phương thức được kiểm ở `dashboard.test.ts`. Đây là bằng chứng khả năng xử lý, không phải giao dịch ngân hàng thật. Thanh toán là ghi nhận tiền nhân viên đã nhận/hoàn; không khẳng định có tích hợp cổng ngân hàng/online.

## Dữ liệu đã dọn

- **10 đánh giá thử nghiệm** do chủ dự án xác định, chọn bằng đúng ID/nội dung/rating đã kiểm tra, gồm cả nhận xét tích cực và tiêu cực. Lưu nguyên bản vào archive; không đổi lời chê thành lời khen, không tạo đánh giá khách hàng giả. Màn Đánh giá trở về **0 đánh giá, điểm trung bình “—”**, thay cho mức 4,4 không có ý nghĩa đại diện.
- **Bộ #11**: 1 bàn không hoạt động, 1 món 0đ đã archive và 2 bộ đơn/phiên/khoản thu/hóa đơn mẫu 0đ. Chuyển toàn bộ sang archive trong cùng transaction, không để lại liên kết lửng. Danh mục đang được dùng chung được giữ nguyên. Tổng cộng **20 bản ghi** được lưu trữ, giá trị tiền **0đ**.
- Tên `L?ch s?…` đã bị hỏng ngay trong giá trị lưu ở DB; đổi font không khôi phục được dấu đã mất. Bộ nạp cũ truyền file qua pipeline Windows PowerShell có nguy cơ mất Unicode. Hiện import lại bị chặn; script bảo trì chuyển bằng `docker cp` nguyên byte UTF-8.
- Các đơn hủy còn lại, khoản thu có tiền, hóa đơn ngoài bộ mẫu và catalog đang bán giữ nguyên. **17/29 và 592.000đ không đổi sau dọn dữ liệu.** Không sửa trạng thái hoặc tạo giao dịch chuyển khoản giả để làm biểu đồ đẹp hơn.
- Kỳ trước 18/09–17/10 có 2 đơn mẫu 0đ: sau lưu trữ, số đơn tạo giảm 43→41, số đơn có thu giảm 25→23; tiền ròng kỳ trước vẫn **1.655.000đ**. Cần giải thích thay đổi mẫu số này khi so ảnh chụp trước/sau.

## Sao lưu, truy vết và phục hồi

Batch `demo-cleanup-20261116-v1`, lưu ở `demoCleanupBatches`; mỗi bản ghi gốc ở `demoDataArchives` có collection/ID/checksum. Audit `demo.cleanupArchived` do SYSTEM ghi lý do và manifest. Backup đầy đủ trước thao tác: `.cache/maycafe-before-demo-cleanup-20261116.archive.gz`, SHA256 `cf9639c24b4f1a6dfe17697e0efc9ffe080476b215b9cfe61012292a3a734f89`. `.cache` bị gitignore và chứa dữ liệu riêng, không commit hoặc chia sẻ công khai.

Script `scripts/archive-demo-data-20261116.mjs` mặc định chỉ preview. Áp dụng cần `--apply --backup=/path/to/full.archive.gz`, chỉ đúng database `maycafe`, đúng 10 đánh giá và 2 đơn 0đ, từ chối nội dung đã đổi/tham chiếu ngoài. Chạy lại batch đã lưu trữ là no-op. Phục hồi chủ động bằng `--restore`: trả cả 20 bản ghi trong transaction, kiểm checksum, từ chối ghi đè ID đang tồn tại và từ chối xung đột unique index. Không phục hồi tự động sau nghiệm thu vì dữ liệu thử sẽ xuất hiện lại.

Đã thử trên MongoMemoryReplSet với bản sao các bản ghi thực: preview không ghi; thay nội dung hoặc thêm recipe tham chiếu ngoài thì từ chối; archive nguyên tử; khoản thu có tiền giữ nguyên; repeat no-op; restore tạo lại đúng toàn bộ EJSON. Sau thao tác live, hash các bản ghi ngoài phạm vi ở **44 collection** giữ nguyên. Logs `.cache/demo-cleanup-*`, audit trước/sau `.cache/demo-data-audit-{after-,}20261116.json`.
