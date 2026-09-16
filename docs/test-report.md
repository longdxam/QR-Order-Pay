# Test report — cập nhật 16/09/2026

## Kết quả đã chạy

| Kiểm tra | Kết quả |
| --- | --- |
| npm run typecheck | PASS — client, server, contracts |
| npm run build | PASS — còn cảnh báo bundle >500 kB |
| Unit server | 6/6 PASS |
| Integration server | 11/11 PASS |
| UI component client | 4/4 PASS |
| npm run lint | FAIL — client thiếu cấu hình; server còn lỗi cũ ở auth.ts/seed.ts |

npm test đã được cập nhật để chạy đủ ba nhóm test. Có thể chạy riêng npm run test:integration.

## Bằng chứng kiểm thử

- server/src/__tests__/unit/crypto.test.ts: hash/verify, JWT, token và TTL.
- server/src/__tests__/integration/orderFlow.test.ts: MongoMemoryReplSet, HTTP thực và Socket.IO thực trên port tạm.
- client/src/__tests__/checkout.test.tsx: React Testing Library + jsdom, mock API.

Integration bao phủ hai khách cùng bàn, API danh sách bàn staff, quét lại giữ danh tính, ownership, trạng thái đơn, giá tại server, idempotency, sai số tiền, đóng bàn còn nợ, món chưa phục vụ, cookie hóa đơn riêng, review một lần, trang/API tổng hợp đánh giá cho admin, hết hạn/rời bàn, phiên mới, socket cookie và sự kiện xuyên luồng, topping/variant không hợp lệ, ràng buộc AI fallback.

UI kiểm tra người dùng phải xác nhận trước khi thu tiền, gửi đúng tổng tiền/phương thức, review qua endpoint receipt và giữ idempotency key khi retry lỗi mạng.

## Chưa kiểm chứng

- Browser E2E và layout trực quan trên điện thoại/desktop: chưa chạy, Browser runtime không có browser khả dụng trong phiên.
- Quét QR bằng camera thật và in thực tế: chưa thử.
- AI live bên ngoài: chưa gọi.
- Không thay đổi/seed database người dùng trong phiên kiểm thử.

Không coi test UI với mock API là browser E2E. Hướng dẫn demo và trạng thái dự án nằm ở ../PROJECT_MEMORY.md.
