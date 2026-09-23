# Tiến độ nâng cấp có kiểm soát

Ngày bắt đầu: 20/09/2026. Điều phối CoDev theo `HUONG_DAN_DIEU_PHOI_CODEV.md` và nghiệm thu theo `HUONG_DAN_AGENT_NANG_CAP_KIEN_TRUC.md`.

## Baseline do AI điều phối chạy

- Worktree ban đầu: chỉ hai file hướng dẫn mới chưa theo dõi; không có thay đổi source đã theo dõi.
- Runtime local: Node v24.19.0; `.nvmrc` hiện v20.11.0. Cần chốt runtime CI/container và báo khác biệt.
- `npm run typecheck`: PASS (3 workspace).
- `npm run build`: PASS; bundle client khoảng 910 kB, có cảnh báo >500 kB.
- `npm test`: PASS — server unit 6, client 8, integration 26 trên MongoMemoryReplSet tạm.
- `npm run lint`: FAIL sẵn có — 9 lỗi và 7 cảnh báo ở server/client. Không tắt rule để che lỗi.
- Docker: daemon 29.7.2 truy cập được ngoài sandbox; lỗi đọc cấu hình trong sandbox không phải bằng chứng Docker chưa chạy.
- Chưa triển khai cloud; đang chờ thông tin môi trường nếu người dùng có sẵn.

## Giao việc và nghiệm thu

| Gói | Phạm vi                                                          | Trạng thái                                                    |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| P0  | CoDev khảo sát chỉ đọc; coordinator chạy baseline                | Hoàn thành                                                    |
| P1  | Refresh token, request ID, hợp đồng API và lint nền              | Hoàn thành; nghiệm thu local 22/09/2026                       |
| P2  | Production containers, proxy, readiness và shutdown              | Đã nghiệm thu production-local 22/09/2026; chưa deploy cloud  |
| P3  | Logs, metrics và dashboard operations                            | Hoàn thành production-local 22/09/2026                        |
| P4A | Tìm kiếm tiếng Việt có ràng buộc và đánh giá                     | Hoàn thành local và production-local 22/09/2026               |
| P4B | Detector, AI giải thích và cảnh báo                              | Hoàn thành local và production-local 22/09/2026               |
| P5A | Realtime/rate limit/worker nhiều instance                        | Hoàn thành production-local 22/09/2026                        |
| P5B | Load test và báo cáo thực đo                                     | Hoàn thành phép đo; không đạt 600–700 RPS                     |
| P6  | CI, browser QA và tài liệu bàn giao                              | Hoàn thành; GitHub Actions remote PASS, cloud/QR thật còn chờ |
| P7  | Bundle, offline/PWA, dashboard, contracts và dependency security | Hoàn thành local và CI remote 23/09/2026                      |

## Quyết định điều phối

- Một CoDev worker mỗi lần; giao phạm vi cụ thể, không dùng `--auto`, không commit, không đọc secret.
- AI điều phối kiểm tra code/diff, test độc lập và phản hồi lỗi trước khi chấp nhận gói.
- Database demo hiện hữu không thuộc dữ liệu test. Mọi seed/test sử dụng môi trường tạm riêng.
- Chỉ báo tải đạt được khi có kết quả đo; 600–700 RPS là mục tiêu thử nghiệm.
- Các quyết định kỹ thuật chi tiết được cập nhật trong `architecture-decisions.md`.

## Nghiệm thu P1 — 22/09/2026

- Refresh access token phía staff dùng single-flight, retry tối đa một lần và không hồi sinh phiên đã logout.
- `x-request-id` từ client được giới hạn định dạng/độ dài; giá trị không an toàn được thay bằng UUID.
- Hợp đồng auth/payment được đưa vào `packages/contracts` và được cả client/server tiêu thụ.
- Tách `useToast` và `useDocumentTitle` khỏi file component; ESLint server/client đạt với `--max-warnings=0` mà không tắt rule.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- Unit server: 19/19 PASS; client: 14/14 PASS; integration: 26/26 PASS.
- `npm run build`: PASS; bundle client còn cảnh báo lớn, file JS chính 968,73 kB (gzip 286,37 kB).
- Seed vẫn in credential demo trực tiếp cho người vận hành, nhưng QR token/mật khẩu không đi qua structured application logger.

## Nghiệm thu P2 production-local — 22/09/2026

- Đã thêm liveness `/healthz`, readiness `/readyz` kiểm tra MongoDB với timeout và test hồi quy.
- `trust proxy` chuyển sang `TRUST_PROXY_HOPS`, mặc định `0`; graceful shutdown chờ request với `SHUTDOWN_TIMEOUT_MS` rồi mới đóng cưỡng bức connection còn lại.
- Đã tạo Docker build nhiều stage cho server/client, Nginx cùng-origin, `compose.production.yaml` và `docs/deployment.md`.
- Cấu hình Compose đã qua `docker compose ... config --quiet`; image server và web build thành công trên Docker Engine 29.7.2.
- Sửa hai lỗi chỉ lộ khi build image: thiếu `tsconfig.base.json` trong build context và entrypoint server phải là `dist/src/server.js`.
- Ba service `mongo`, `server`, `web` chạy trong project riêng `maycafe-production`, đều healthy; chỉ Nginx publish cổng `8080`, MongoDB không mở cổng host.
- Đã kiểm tra frontend, SPA deep-link, API proxy, Mongo readiness và WebSocket upgrade qua Nginx.
- Đã chạy xuyên luồng trên database production-local riêng: seed → QR join → đặt món → CONFIRMED/PREPARING/READY/SERVED → CHECKOUT → Payment → Bill snapshot → receipt.
- SIGTERM/graceful shutdown kết thúc với exit code 0 trong khoảng 0,5 giây; backend khởi động lại và trở về healthy.
- Stack hiện chạy tại `http://localhost:8080`, có 24 món/5 danh mục từ seed demo trong volume riêng. Chưa deploy cloud/HTTPS và không tuyên bố high availability.

Log chẩn đoán local nằm ở `.cache/codev-control/` (Git bỏ qua). Chỉ dùng log tổng hợp đã loại secret khi bàn giao.

## Nghiệm thu P3 observability — 22/09/2026

- Pino log JSON có service/instance, requestId, route mẫu, status và duration; bỏ Morgan trùng lặp, giữ redaction authorization/cookie/password/token/secret.
- Registry Prometheus đo HTTP counter/latency, 4xx/429/5xx, socket, dependency, process CPU/RAM/event loop, business event và ba thời gian công đoạn đơn.
- Nhãn route dùng template hoặc `unmatched`, không chứa orderId/participantId/prompt/query/URL thật; unit test khóa quy tắc cardinality này.
- Business counter chỉ tăng sau kết quả mới; integration test xác nhận payment replay giữ nguyên `payment_confirmed`.
- Admin có trang `/admin/operations`, phân biệt số theo instance với snapshot database; thời gian hiển thị Asia/Ho_Chi_Minh và có trạng thái “Chưa đủ dữ liệu”.
- `/metrics` chỉ truy cập trong backend network của Compose; qua Nginx `/metrics` trả SPA, không lộ dữ liệu Prometheus. Admin summary bắt buộc vai trò ADMIN.
- Lỗi kiểm soát `p3-controlled-error` trả 404: tìm được log đúng requestId/route/status và client error trên dashboard tăng 3→4.
- Runtime local/container chốt Node.js 24 LTS; image production-local ba service healthy. Chưa có Prometheus/Grafana/log aggregation cloud và không tuyên bố cloud observability.

## Nghiệm thu P4A tìm kiếm menu — 22/09/2026

- Thêm hợp đồng `MenuSearchIntent` dùng chung và endpoint `POST /api/v1/menu/search`; backend quyết định ID, giá, availability và xếp hạng từ menu MongoDB thật.
- Hiểu câu có/không dấu, một tập lỗi gõ giới hạn, nhóm cà phê/trà/trái cây, vị/ít ngọt, không sữa/không caffeine và ngân sách VND. `dưới` dùng `<`, `không quá`/`tối đa` dùng `<=`, phạm vi là một món.
- `không cà phê` loại nhóm cà phê nhưng không bị suy diễn thành `không caffeine`; metadata thiếu không đáp ứng điều kiện không sữa/không caffeine.
- UI debounce 350 ms, hủy request cũ bằng `AbortSignal`, hiển thị intent/chế độ, có bộ lọc sửa tay và tái sử dụng modal tùy chỉnh món.
- Unit search 25/25, gồm 13/13 Top-1 và 12/12 ca ràng buộc; integration endpoint trên MongoDB tạm đạt. Live LLM không chạy và được ghi tách biệt với fallback.
- Toàn bộ lint/typecheck/build, 52 unit server, 14 client và 27 integration đều đạt. Production-local được rebuild và smoke test riêng; không có vector database.

## Nghiệm thu P4B detector và giải thích — 22/09/2026

- Job định kỳ đánh giá bốn tín hiệu: HTTP 5xx, HTTP p95, pha chế p95 và tỷ lệ hủy; tất cả có window, baseline, mẫu tối thiểu, ngưỡng tuyệt đối + hệ số baseline cấu hình qua env.
- Thiếu current/baseline trả `INSUFFICIENT_DATA`; không suy diễn là bình thường. Alert lưu window, observed/threshold/baseline, sample count, method và aggregate evidence.
- Detector+target được khử trùng theo bucket unique và cooldown. ADMIN xem, đánh dấu đã xem/đóng trên dashboard operations; thao tác ghi AuditLog.
- LLM chỉ giải thích aggregate cho alert mới với schema và hạn mức; timeout/off/no key dùng fallback, alert vẫn tồn tại. Không có quyền nghiệp vụ.
- Synthetic: 4/4 anomaly được nhận đúng, 0/4 false alert ở cửa sổ bình thường, 4/4 detector ít mẫu trả chưa đủ dữ liệu; provider timeout fallback đạt. Integration xác nhận quyền, cooldown dedupe, ACK và audit.
- HTTP window vẫn theo instance; P5 phải chuyển scheduler/aggregate sang worker/store dùng chung trước khi scale hai backend.

## Nghiệm thu P5A đa instance — 22/09/2026

- Compose chạy Nginx, hai API backend, một worker, MongoDB replica set một node và Redis AOF. Socket.IO dùng Redis adapter; limiter auth/guest/search/AI dùng Redis store; AI không còn limiter memory cục bộ.
- HTTP anomaly aggregate được ghi bucket phút vào Redis và chỉ worker chạy detector/sweeper. Dashboard phân biệt dependency MongoDB/Redis và instance.
- 20 request được chia 10/10 cho A/B. Shared auth limiter trả 30×401 rồi 5×429. Guest socket nối A nhận event và remote revocation từ mutation qua B.
- Sau khi dừng A, 20/20 request được B phục vụ, trung bình khoảng 102 ms và tối đa 1.036 ms; không tuyên bố zero downtime. Redis outage: menu đọc 200, readiness degraded, mutation được bảo vệ không fail-open.
- Đây là fault test trong một Docker host. MongoDB một node, Redis một node và Nginx một node vẫn là single points of failure.

## Nghiệm thu P5B load test — 22/09/2026

- Có ba kịch bản k6, dataset benchmark 200 sản phẩm và raw artifact bị Git ignore. Các ngưỡng được giữ nguyên: lỗi <1%, read p95 <500 ms, write p95 <1.000 ms.
- Menu hai backend đạt 50/75/90 RPS; 90 RPS có p95 96,48 ms. 100 RPS p95 3,26 giây; ramp 600–700 không đạt. Không gọi offered load là achieved throughput.
- Guest flow 20 VU/60 giây có 0 lỗi nhưng write p95 4,15 giây nên không đạt. Realtime 100/100 kết nối, p95 324,05 ms, đạt.
- Load test phát hiện seed mất unique index sau reset DB; đã sửa bằng `syncIndexes()` và thêm `check:benchmark`. Sau sửa đúng một active table session, không trùng idempotency key, sai tổng hay trạng thái.
- Báo cáo đầy đủ tại `docs/performance-report.md`; mức bền vững cao nhất đã chứng minh là 90 RPS, không phải 700 RPS.

## Nghiệm thu P6 — 22/09/2026

- Thêm GitHub Actions `.github/workflows/ci.yml`: Node 24 + `npm ci`, lint, typecheck, server/client unit, integration và production build; phân tách quality/integration job.
- Playwright production build đạt 9/9 ở 375/768/1440 cho trang QR, login và menu sau link QR mô phỏng; không tràn ngang/page error. Quét camera/in QR thật được hoãn theo xác nhận người dùng.
- AI live smoke chạy bốn request có giới hạn nhưng key hiện tại bị provider trả 401; fallback an toàn đạt, không tuyên bố live thành công. Logger không ghi provider error body.
- Tài liệu deployment, observability, architecture decision, test, AI, performance, demo và PROJECT_MEMORY được cập nhật. Ghi chú CI chưa chạy ở thời điểm P6 được thay thế bởi run #1 thành công ngày 23/09/2026. Cloud chưa deploy vì chưa chốt provider/account/domain/ngân sách.

## Nghiệm thu P7 — 23/09/2026

- Tách toàn bộ route bằng `React.lazy`; entry production còn 382,54 kB (gzip 117,26 kB), chunk lớn nhất 385,02 kB, không còn cảnh báo 500 kB.
- PWA cache toàn bộ asset production từ Vite manifest, hỗ trợ reload offline; API mutation và Socket.IO bị loại khỏi service-worker cache. Có banner offline/reconnected và Playwright khóa hồi quy cache `Vary`.
- Dashboard có lọc ngày, CSV, in/PDF; backend aggregation toàn bộ đơn PAID theo múi giờ Việt Nam, không còn sai lệch do repository giới hạn 100 dòng. Integration 105 đơn đạt.
- Shared contracts bổ sung join/current table session và transition request; root scripts luôn build contracts trước dev/typecheck/test, tránh CI dùng `dist` cũ không được Git theo dõi.
- Nâng Vite/Vitest/React Router/UUID lên bản vá; `npm audit` từ 8 vulnerability (có 1 critical, 1 high) về 0. Toàn bộ lint/typecheck/unit/integration/build đạt.
- CI thêm dependency audit và Chromium production-frontend smoke. Docker Desktop tắt nên lượt local mới chỉ đạt 7 frontend ca và skip 4 ca cần backend/token; không tuyên bố API-backed 11/11.
- Commit `b61a8f0` đã push lên `main`; GitHub Actions run `35807566033` PASS cả ba job quality/build, integration và browser smoke trên checkout sạch.
