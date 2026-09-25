# Biên bản diễn tập migration, backup và restore — 23/09/2026

## Phạm vi và môi trường

- Docker Engine 29.7.2, image `mongo:7` và `redis:7-alpine`.
- Tất cả container dùng tên riêng và không gắn volume lâu dài; Mongo nguồn, Mongo restore đích và Redis DB đều cô lập, không kết nối hay thay đổi database demo của người dùng.
- Dữ liệu MongoDB tổng hợp: một `TableSession`, một `Order`, một `Payment`, một `Bill` liên kết cùng phiên.

## Migration production

Đã chạy entrypoint đã biên dịch `node server/dist/scripts/migrate.js` với `NODE_ENV=production` trên database tạm:

1. Lượt đầu áp dụng `20260923-001-reliability-indexes`, `20260923-002-payment-shift-index` và `20260923-003-declared-model-indexes`.
2. Lượt hai bỏ qua đúng cả ba migration đã ghi nhận, không báo sai checksum và không tạo lại dữ liệu.

Kết quả: **PASS** — production runner tồn tại trong artifact build, lock/checksum ổn định giữa các lần chạy và migration idempotent.

## Backup và restore

Các bước đã chạy trong container cô lập:

1. Trên replica set nguồn: `mongodump --archive=/tmp/maycafe-drill-oplog.archive.gz --gzip --oplog` để tạo snapshot point-in-time.
2. Tính SHA-256 của archive: `91de9a1c50886475d2977ce7189df13c04cfb8020be5deff2696adca3c00f58d`.
3. Trên replica set đích rỗng, container/volume riêng: `mongorestore --archive=... --gzip --drop --oplogReplay`. Namespace được giữ nguyên vì MongoDB Tools không hỗ trợ replay oplog cùng namespace rename.
4. Kiểm tra count và bất biến sau restore.

Kết quả: **PASS** — oplog replay áp dụng thành công; 5 document khôi phục (4 business document và 1 migration state), 0 document lỗi; mỗi collection `tablesessions`, `orders`, `payments`, `bills` có đúng một document; 0 Bill trùng `tableSessionId`; 0 Payment mồ côi. Có đủ các index bắt buộc trên TableSession, Order, Payment, Bill và OutboxEvent; migration state ghi đủ 3 migration.

## Redis queue recovery

Đã chạy `npm run test:queue-drill` với Redis DB 15 cô lập, lease 250 ms và giới hạn một lần thử:

- Một report đang ở processing không chặn realtime worker claim và ACK notification.
- ACK bằng token/owner khác bị từ chối.
- Job bị bỏ lại sau claim được reclaim khi lease hết hạn rồi worker khác ACK thành công.
- Job lỗi đi vào dead-letter, được replay nguyên tử, claim lại và ACK thành công.
- Cuối bài diễn tập: realtime/report pending = 0, realtime/report processing = 0, dead-letter = 0.

Kết quả: **PASS**.

## Dọn dẹp và giới hạn

Ba container drill đã được dừng và xóa tự động; không tạo volume lâu dài. Script PowerShell vận hành trong `scripts/db/` không chạy trực tiếp trên host vì host không cài `mongodump`, `mongorestore` và `mongosh`; các lệnh tương đương và các bất biến mà script dùng đã được thực thi bằng chính tool MongoDB 7 trong container. Trước khi dùng production cần cấu hình lịch chạy, kho lưu trữ mã hóa và cảnh báo theo runbook.
