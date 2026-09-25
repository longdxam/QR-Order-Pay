# Test report — cập nhật 24/09/2026

## Kết quả đã chạy

| Kiểm tra                                  | Kết quả                                                             |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `npm run lint`                            | PASS — server và client, 0 lỗi/0 cảnh báo                           |
| `npm run typecheck`                       | PASS — client, server, contracts                                    |
| `npm run test:server`                     | PASS — 69/69 unit test trên 12 file                                 |
| `npm run test:client`                     | PASS — 19/19 test trên 4 file                                       |
| `npm run test:integration`                | PASS — 46/46 test trên MongoMemoryReplSet tạm                       |
| `npm run test:queue-drill`                | PASS — isolation, reclaim, owner ACK và dead-letter replay          |
| `npm run test:e2e` (frontend preview mới) | PASS 7, SKIP 4 cần API/token — responsive và PWA offline reload đạt |
| `npm run build`                           | PASS — contracts, server và client production build                 |
| `docker compose ... config --quiet`       | PASS — migration gate và ba worker role hợp lệ                      |
| `npm audit`                               | PASS — 0 vulnerability                                              |

Route-level code splitting giữ entry client ở 389,20 kB, gzip 118,78 kB. Chunk lớn nhất là Dashboard 384,70 kB, gzip 102,48 kB; build không còn cảnh báo chunk lớn hơn 500 kB.

## Sửa lỗi S1–S4 (`claude_de_xuat.md`) — 24/09/2026

Mỗi lỗi có test tái hiện chạy đỏ trên code cũ trước khi sửa:

| Mã | Test | Trước khi sửa | Sau khi sửa |
| --- | --- | --- | --- |
| S1 | `lists only unfinished orders of active visits in the staff feed` | feed trả cả đơn phiên đã đóng | chỉ đơn chưa xong của phiên OPEN/CHECKOUT |
| S2 | `replays an order when the same key races past the idempotency pre-check` | 409 CONFLICT | 200, `created:false`, 1 đơn |
| S2 | `replays a payment when the same key races past the idempotency pre-check` | 403 "chuyển bàn sang thanh toán" | 200, `replayed:true`, 1 Payment, 1 Bill |
| S2 | client `keeps the order key after $code only when the order may exist` | giỏ đổi key sau mọi lỗi 4xx | chỉ đổi key khi `IDEMPOTENCY_CONFLICT` |
| S3 | `never exposes internal order fields to guests or staff` | lộ `idempotencyKey` | DTO `guestOrderSchema`/`staffOrderSchema` |

S4 kiểm tra trên production-local (image `web` build từ HEAD `4e017b0` để khớp backend đang chạy, kèm cấu hình Nginx mới):

- gzip: entry JS 389.784 → 118.605 byte; `/api/v1/categories` 22.804 → 3.451 byte.
- Header `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, `Content-Security-Policy` (enforce) có ở `/`, deep link, `/assets/*`, `/sw.js`; `index.html`/`sw.js` `Cache-Control: no-cache`. API chỉ mang header của helmet.
- Duyệt ba portal bằng Chromium (khách, staff đăng nhập + KDS/bàn/hết món/ca, admin đăng nhập + dashboard/món/bàn/operations/hóa đơn + mở dialog): 0 vi phạm CSP, 0 lỗi console. `npm run test:e2e`: 7 PASS, 4 SKIP (thiếu `E2E_TABLE_TOKEN`).

## Dựng lại production-local từ source hiện tại — 24/09/2026

- Backup `maycafe` trước khi nâng cấp (mongodump gzip + SHA-256), ghi số document trước/sau: không đổi.
- `migrate` exit 0: áp dụng `20260923-001..003`, lần chạy lại đều `skip`.
- 11 container healthy; health trả `trafficClass` guest/internal đúng cổng; gọi chéo portal trả 404; ba worker ghi heartbeat.
- Duyệt ba portal: phát hiện `GET /admin/bills` 422 với bộ lọc rỗng → sửa contract, test `billHistoryQuery.test.ts`, build lại; sau đó 0 lỗi console, 0 vi phạm CSP. `npm run test:e2e`: 7 PASS, 4 SKIP.

## Phạm vi bằng chứng

- Unit server: crypto/token, request ID an toàn, controller tiêu thụ contract auth/payment, health/readiness và HTTP shutdown.
- Unit observability: route template không lộ ID/URL thật, HTTP metrics, socket gauge, business counter và thời gian công đoạn.
- Unit tìm kiếm P4A: 25/25 ca; 13/13 truy vấn Top-1 định trước và 12/12 ca ràng buộc về phủ định, budget biên, metadata, hết món/size, typo và kết quả rỗng.
- Unit anomaly P4B: normal, spike 5xx, HTTP p95, pha chế p95, hủy tăng, ít mẫu và provider timeout; 4/4 anomaly đúng, 0/4 false alert ở window normal.
- Client: checkout/review, QR auto-open, refresh token single-flight và realtime event gate; bao gồm retry một lần, refresh đồng thời, refresh lỗi, race logout, giữ `Idempotency-Key`, loại event trùng/cũ và chấp nhận version gap để refetch snapshot.
- Integration: hai khách cùng bàn, ownership, giá server-side, idempotency, state machine, thanh toán, Bill/receipt/review, Socket.IO, phiên QR tự mở/idle sweeper, tìm kiếm menu và anomaly ADMIN/dedupe/audit trên MongoDB thật.
- Transactional outbox: rollback đồng thời business record/audit/event; replay order/payment không sinh thêm event; realtime lifecycle vẫn đến đúng room và sự kiện thanh toán đến trước khi socket phiên bị ngắt.
- Quote/receipt/workflow: quote hết hạn, đổi số lượng/catalog/topping hoặc dùng sai participant đều bị từ chối; Bill snapshot không đổi khi Order bị sửa và receipt cũ vẫn fallback; cấu hình AI cuối chặn topping/variant không hợp lệ, caffeine, sữa và vượt ngân sách.
- Race/failure workflow: hai cập nhật trạng thái, hai yêu cầu hủy, hai lần chuyển cùng bàn đích, payment so với đóng ca và hai lần đóng ca đồng thời đều chỉ cho một kết quả hợp lệ; checkout có yêu cầu hủy chờ duyệt bị chặn; phân trang 105 Bill và phân quyền Admin được kiểm tra.
- Redis drill trên container cô lập: report đang giữ lease không chặn realtime; foreign ACK bị từ chối; job được reclaim sau lease; dead-letter replay đúng queue; cuối bài cả realtime/report pending/processing và dead-letter đều bằng 0.
- Migration/restore drill trên MongoDB 7 cô lập: runner production apply rồi skip idempotent cả 3 migration; archive SHA-256 khôi phục 4 business document và migration state, không Bill trùng phiên, không Payment mồ côi và không thiếu 5 index bắt buộc.
- Integration chỉ dùng database tạm do `mongodb-memory-server` tạo; không seed hoặc xóa database demo của người dùng.
- Dashboard aggregation được kiểm tra với 105 đơn PAID để bảo đảm không bị giới hạn phân trang 100; lọc ngày dùng múi giờ `Asia/Ho_Chi_Minh`.

## Browser/responsive QA

- Playwright chạy trên production frontend vừa build qua Vite preview cô lập tại `http://127.0.0.1:4173`.
- Ở 375×812, 768×1024 và 1440×900: trang nhập QR và form đăng nhập hiện control chính, không tràn ngang, không có uncaught page error.
- Suite có 11 ca. Lượt ngày 23/09 đạt 7 ca không cần backend, gồm reload PWA khi offline rồi nhận trạng thái kết nối lại; 4 ca menu/hai thiết bị được ghi SKIP vì không truyền `E2E_TABLE_TOKEN` vào lượt preview này.
- Runtime Browser tích hợp ban đầu không khởi tạo được kernel assets (`os error 3`), nên dùng Playwright trong repo làm fallback có thể tái chạy. Không coi đây là kiểm tra trực quan thủ công trên nhiều browser engine.

## Production container — đã kiểm chứng 23/09/2026

- Docker Engine 29.7.2: build thành công image Node.js 24 LTS và Nginx 1.27.
- `mongo`, `redis`, `server-guest-a/b`, `server-internal-a/b`, `web`: healthy; `worker` chạy entrypoint job riêng trong project Compose `maycafe-production`.
- HTTP được tách portal: Guest `8080`, Staff `8081`, Admin `8082`; deep-link đúng portal trả 200. Ma trận smoke xác nhận route/API gọi chéo trả 404, còn API đúng portal vẫn áp dụng 401/403 theo JWT/role.
- Staff/Admin login qua origin riêng trả 200 và dùng hai cookie `mc_refresh_staff`/`mc_refresh_admin`, không ghi đè nhau trên cùng host.
- Health API xác nhận `8080 → trafficClass=guest`, `8081/8082 → trafficClass=internal`. Docker inspect xác nhận mỗi API giới hạn 0,75 CPU/384 MiB; Internal có `cpu_shares=1536`, Guest `512`.
- Menu public sinh cache key Redis. Burst 100 request Guest cho 22×200 và 78×429, không có 5xx; join cùng token thử nghiệm cho 20×404 và 2×429, chứng minh limiter shared theo token bàn.
- Worker hoàn tất report JSON (17 ngày dữ liệu) và CSV (859 ký tự); realtime smoke job được xử lý với queue/processing/dead-letter đều về 0.
- `/readyz` trong backend trả 200 với MongoDB `ready`; WebSocket kết nối qua Nginx bằng transport `websocket`.
- Luồng production-local đạt: QR join → order → bốn trạng thái → checkout → payment → Bill snapshot → receipt đúng tổng tiền.
- SIGTERM: server exit code 0 sau khoảng 495 ms và healthy lại sau restart.
- P3: raw metrics chỉ truy cập nội bộ; Admin operations đúng quyền. Lỗi kiểm soát 404 được đối chiếu cùng requestId trong log và làm client-error counter tăng đúng một.
- Seed và luồng kiểm tra chỉ dùng volume production-local riêng; không ghi vào database dev/demo hiện có.
- P5A baseline cũ: REST chia 10/10 qua hai backend; shared limiter, cross-instance Socket và failover đều PASS. Topology hiện đã đổi sang hai pool, nên số failover cũ không được dùng để khẳng định hiệu năng pool mới.
- P5B baseline trước khi tách pool: fixed menu đạt đến 90 RPS (p95 96,48 ms), không đạt từ 100 RPS và không đạt mục tiêu ramp 600–700. Guest 20 VU không lỗi dữ liệu nhưng write p95 4,15 giây, vượt ngưỡng 1 giây. Realtime 100/100 kết nối, p95 324,05 ms. Chưa chạy lại k6 đầy đủ sau thay đổi; chi tiết ở `performance-report.md`.
- Load test phát hiện benchmark seed làm mất unique index sau `dropDatabase`; đã sửa seed dựng lại index. Lượt chính thức sau sửa giữ đúng một phiên active cho 20/100 guest đồng thời và không dùng số liệu cũ bị sai bất biến.
- AI live smoke gửi ba recommendation + một anomaly explanation nhưng provider trả 401; bốn ca fallback an toàn. Chưa có bằng chứng AI live hợp lệ.

## Chưa kiểm chứng

- Quét QR bằng camera thật và in QR thực tế.
- AI live hợp lệ: key hiện tại bị provider từ chối 401; cần key mới rồi chạy lại smoke test.
- Cloud deployment và HTTPS thật. GitHub Actions run #1 trên commit `b61a8f0` đã PASS cả ba job; đây không phải bằng chứng cloud runtime.
- Quét trình duyệt khác Chromium, network throttling chi tiết và rà soát trực quan bằng mắt vẫn là bước bổ sung.
- Ca browser hai thiết bị vẫn skip vì chưa truyền `E2E_TABLE_TOKEN`; ownership/hai participant vẫn được integration MongoDB thật bao phủ. Docker production-local đang chạy.
