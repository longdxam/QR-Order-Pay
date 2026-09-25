# Đánh giá tìm kiếm thông minh và AI Barista

Cập nhật ngày 22/09/2026. Hai luồng `menu/search` và `ai/recommendations` được đánh giá riêng để không nhập nhằng kết quả fallback với kết quả LLM thật.

## P4A — tìm kiếm menu xác định

`POST /api/v1/menu/search` hiện chạy ở `mode: "fallback"`. Backend đọc menu thật từ MongoDB, chuẩn hóa câu tiếng Việt, áp dụng điều kiện cứng rồi mới xếp hạng. Luồng này không cần API key, không giả lập là AI và không dùng giá do client cung cấp.

Giá dùng để lọc là giá thấp nhất của size còn bán cho **một món**. Tổng tiền khi đặt món vẫn được backend tính lại độc lập.

### Ma trận đánh giá

| Nhóm                  | Ví dụ                                     | Bất biến cần giữ                                                       |
| --------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| Có dấu/không dấu      | `cà phê`, `ca phe`, `caphe`               | Cùng nhận ra nhóm cà phê                                               |
| Lỗi gõ nhẹ            | `caphee`, `traa daoo`                     | Sửa trong từ điển giới hạn, không fuzzy toàn câu                       |
| Nhóm/khẩu vị          | `cà phê đậm`, `trà trái cây ít ngọt`      | Đúng nhóm; khẩu vị chỉ dùng để xếp hạng                                |
| Không caffeine        | `không caffeine`, `khong cafein`, `decaf` | Chỉ nhận món có metadata `caffeine=false`; thiếu metadata cũng bị loại |
| Không sữa             | `không sữa`                               | Chỉ nhận món có metadata `dairy=false`; thiếu metadata cũng bị loại    |
| Loại nhóm             | `không cà phê, trà đào`                   | Loại nhóm cà phê; **không** suy diễn thành không caffeine              |
| Ngân sách nghiêm ngặt | `dưới 40 nghìn`                           | Giá mỗi món phải `< 40.000đ`                                           |
| Ngân sách bao gồm     | `không quá 40 nghìn`, `tối đa 40k`        | Giá mỗi món được `<= 40.000đ`                                          |
| Định dạng giá         | `40k`, `40.000đ`, `39,5k`                 | Chuẩn hóa đúng VND                                                     |
| Tình trạng bán        | Món/size ngừng bán                        | Không xuất hiện trong kết quả                                          |
| Không có kết quả      | Từ khóa không khớp                        | Trả danh sách rỗng và thông báo trung thực; không chèn món rẻ nhất     |
| Bộ lọc sửa tay        | Budget/caffeine/dairy trên UI             | Giá trị người dùng sửa ghi đè phần tương ứng đã suy ra                 |

### Kết quả tự động

- Unit search: **25/25 PASS**.
- Top-1 trên 13 truy vấn định trước: **13/13 đúng**.
- 12 ca bất biến/ràng buộc: **12/12 đạt**, không có vi phạm điều kiện cứng.
- Integration kiểm tra endpoint công khai trên MongoDB tạm: câu `ca phe khong sua duoi 40 nghin` chỉ trả món xác nhận `dairy=false`, giá `< 40.000đ`; input rỗng trả 422.

Đây là bộ dữ liệu tổng hợp nhỏ dùng để khóa hồi quy, chưa phải bằng chứng về chất lượng tìm kiếm trên traffic người dùng thật.

### Chế độ live

Tìm kiếm P4A vẫn không gọi LLM; nếu bổ sung sau này, LLM chỉ được phép sinh `MenuSearchIntent`, output phải qua Zod rồi dùng lại đúng hàm lọc/xếp hạng backend hiện tại. Không cho LLM chọn giá, tạo ID sản phẩm hay tự nới điều kiện cứng.

## AI Barista hiện hữu

`POST /api/v1/ai/recommendations` là tính năng gợi ý riêng. Chế độ fallback đã có kiểm thử semantic.

Ngày 22/09/2026 đã thử smoke test live có giới hạn bằng key đọc tạm thời từ `apikey.txt`: ba ca recommendation và một ca giải thích anomaly. Provider trả HTTP 401 cho cả bốn lần; ứng dụng đều chuyển sang fallback an toàn và không làm gián đoạn request chính. Vì không có response live hợp lệ, **không công bố chất lượng, latency hoặc chi phí LLM**. Cần thay key bằng credential hợp lệ rồi chạy lại `server/scripts/ai-live-smoke.ts`.

Provider logger không ghi response body lỗi vì body của nhà cung cấp có thể lặp lại định danh key đã che một phần. Key không được copy vào `.env`, tài liệu, log hay Git; `apikey.txt` đã nằm trong `.gitignore`. AI live chỉ được bật ở môi trường có hạn mức chi phí rõ ràng.

### Evidence và kiểm tra cấu hình cuối — 23/09/2026

Mỗi recommendation nay kèm evidence do backend dựng từ đúng product/variant trong MongoDB: giá được kiểm chứng, ngân sách, caffeine và dairy. Lý do hiển thị không dùng trực tiếp câu khẳng định do LLM tự sinh.

Trước khi thêm món từ AI vào giỏ, client gọi `POST /api/v1/ai/recommendations/validate` với variant/topping cuối cùng. Backend kiểm tra lại availability, topping được phép, tổng giá gồm topping và toàn bộ ràng buộc. Metadata dairy/caffeine chưa biết không được coi là đạt. Integration đã xác nhận variant 45.000đ + topping 8.000đ bị chặn khi ngân sách 40.000đ, đồng thời topping không có metadata dairy không được khẳng định là không sữa.

## Đảm bảo an toàn chung

- Hai endpoint chỉ đọc menu; không thể tạo đơn, hủy đơn, thanh toán hoặc đổi phiên bàn.
- Input qua Zod và shared Redis rate limit; search giới hạn 200 ký tự, AI Barista giới hạn 500 ký tự.
- Câu nhập không được chuyển thành Mongo query, lệnh hệ thống hoặc dữ liệu giá.
- ID/variant/availability/price đều được whitelist và kiểm tra lại từ database.
- Metadata thiếu không được xem là đáp ứng ràng buộc `không caffeine` hoặc `không sữa`.
- Đây là bộ lọc sở thích theo metadata, không phải cam kết y tế hay dị ứng.
