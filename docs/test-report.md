# Test report — cập nhật 23/09/2026

## Kết quả đã chạy

| Kiểm tra                                  | Kết quả                                                             |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `npm run lint`                            | PASS — server và client, 0 lỗi/0 cảnh báo                           |
| `npm run typecheck`                       | PASS — client, server, contracts                                    |
| `npm run test:server`                     | PASS — 58/58 unit test                                              |
| `npm run test:client`                     | PASS — 14/14 test trên 3 file                                       |
| `npm run test:integration`                | PASS — 29/29 test trên MongoMemoryReplSet tạm                       |
| `npm run test:e2e` (frontend preview mới) | PASS 7, SKIP 4 cần API/token — responsive và PWA offline reload đạt |
| `npm run build`                           | PASS — contracts, server và client production build                 |
| `npm audit`                               | PASS — 0 vulnerability                                              |

Route-level code splitting đưa entry client xuống 382,54 kB, gzip 117,26 kB. Chunk lớn nhất là Dashboard 385,02 kB, gzip 102,55 kB; build không còn cảnh báo chunk lớn hơn 500 kB.

## Phạm vi bằng chứng

- Unit server: crypto/token, request ID an toàn, controller tiêu thụ contract auth/payment, health/readiness và HTTP shutdown.
- Unit observability: route template không lộ ID/URL thật, HTTP metrics, socket gauge, business counter và thời gian công đoạn.
- Unit tìm kiếm P4A: 25/25 ca; 13/13 truy vấn Top-1 định trước và 12/12 ca ràng buộc về phủ định, budget biên, metadata, hết món/size, typo và kết quả rỗng.
- Unit anomaly P4B: normal, spike 5xx, HTTP p95, pha chế p95, hủy tăng, ít mẫu và provider timeout; 4/4 anomaly đúng, 0/4 false alert ở window normal.
- Client: checkout/review, QR auto-open và refresh token single-flight; bao gồm retry một lần, refresh đồng thời, refresh lỗi, race logout và giữ `Idempotency-Key` khi retry.
- Integration: hai khách cùng bàn, ownership, giá server-side, idempotency, state machine, thanh toán, Bill/receipt/review, Socket.IO, phiên QR tự mở/idle sweeper, tìm kiếm menu và anomaly ADMIN/dedupe/audit trên MongoDB thật.
- Integration chỉ dùng database tạm do `mongodb-memory-server` tạo; không seed hoặc xóa database demo của người dùng.
- Dashboard aggregation được kiểm tra với 105 đơn PAID để bảo đảm không bị giới hạn phân trang 100; lọc ngày dùng múi giờ `Asia/Ho_Chi_Minh`.

## Browser/responsive QA

- Playwright chạy trên isolated benchmark production build qua Nginx tại `http://localhost:8081`.
- Ở 375×812, 768×1024 và 1440×900: trang nhập QR, form đăng nhập và menu sau link QR mô phỏng đều hiện control chính, không tràn ngang, không có uncaught page error.
- Link `/t/benchmark-table-token-local-only` tạo guest cookie rồi điều hướng `/menu`; đây là token benchmark, không phải quét bằng camera hay QR in thật.
- Suite mới có 11 ca. Lượt frontend preview ngày 23/09 đạt 7 ca không cần backend, gồm reload PWA khi offline rồi nhận trạng thái kết nối lại; 4 ca menu/hai thiết bị được skip vì Docker/API benchmark không chạy.
- Runtime Browser tích hợp ban đầu không khởi tạo được kernel assets (`os error 3`), nên dùng Playwright trong repo làm fallback có thể tái chạy. Không coi đây là kiểm tra trực quan thủ công trên nhiều browser engine.

## Production container — đã kiểm chứng 22/09/2026

- Docker Engine 29.7.2: build thành công image Node.js 24 LTS và Nginx 1.27.
- `mongo`, `redis`, `server-a`, `server-b`, `web`: healthy; `worker` chạy entrypoint job riêng trong project Compose `maycafe-production`.
- HTTP qua `http://localhost:8080`: frontend, `/staff/kds` deep-link, `/api/v1/health`, `/api/v1/products` đều trả 200.
- `/readyz` trong backend trả 200 với MongoDB `ready`; WebSocket kết nối qua Nginx bằng transport `websocket`.
- Luồng production-local đạt: QR join → order → bốn trạng thái → checkout → payment → Bill snapshot → receipt đúng tổng tiền.
- SIGTERM: server exit code 0 sau khoảng 495 ms và healthy lại sau restart.
- P3: raw metrics chỉ truy cập nội bộ; Admin operations đúng quyền. Lỗi kiểm soát 404 được đối chiếu cùng requestId trong log và làm client-error counter tăng đúng một.
- Seed và luồng kiểm tra chỉ dùng volume production-local riêng; không ghi vào database dev/demo hiện có.
- P5A: REST chia 10/10 qua A/B; 30 auth attempt dùng chung limiter rồi 5 request tiếp theo nhận 429; cross-instance Socket event/revocation PASS; dừng A cho 20/20 request đi qua B, tối đa 1.036 ms; Redis outage giữ menu read 200 và readiness degraded.
- P5B: fixed menu đạt đến 90 RPS (p95 96,48 ms), không đạt từ 100 RPS và không đạt mục tiêu ramp 600–700. Guest 20 VU không lỗi dữ liệu nhưng write p95 4,15 giây, vượt ngưỡng 1 giây. Realtime 100/100 kết nối, p95 324,05 ms. Chi tiết ở `performance-report.md`.
- Load test phát hiện benchmark seed làm mất unique index sau `dropDatabase`; đã sửa seed dựng lại index. Lượt chính thức sau sửa giữ đúng một phiên active cho 20/100 guest đồng thời và không dùng số liệu cũ bị sai bất biến.
- AI live smoke gửi ba recommendation + một anomaly explanation nhưng provider trả 401; bốn ca fallback an toàn. Chưa có bằng chứng AI live hợp lệ.

## Chưa kiểm chứng

- Quét QR bằng camera thật và in QR thực tế.
- AI live hợp lệ: key hiện tại bị provider từ chối 401; cần key mới rồi chạy lại smoke test.
- Cloud deployment và HTTPS thật. GitHub Actions run #1 trên commit `b61a8f0` đã PASS cả ba job; đây không phải bằng chứng cloud runtime.
- Quét trình duyệt khác Chromium, network throttling chi tiết và rà soát trực quan bằng mắt vẫn là bước bổ sung.
- Ca browser hai thiết bị mới chưa chạy lại trên production-local vì Docker Desktop đang tắt; ownership/hai participant vẫn được integration MongoDB thật bao phủ.
