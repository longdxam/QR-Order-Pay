# Quyết định kiến trúc — Mây Café

Cập nhật: 20/09/2026. Ghi nhận lựa chọn kiến trúc theo từng đợt, kèm phương án thay thế và đánh đổi. Chỉ ghi những gì đã triển khai trong code và đã kiểm chứng bằng test; phần chưa làm ghi rõ ở cuối từng mục.

## AD-001 — Ranh giới module giữ nguyên phân tầng thư mục (P1)

**Ngày:** 20/09/2026 · **Trạng thái:** đã triển khai trong phạm vi P1

**Bối cảnh:** Backend là modular monolith Express/Mongoose; hiện tổ chức theo phân tầng `controllers → services → repositories → models`. Câu hỏi là có nên di chuyển code theo thư mục nghiệp vụ (auth/, payment/...) hay không.

**Quyết định:** Giữ nguyên layout phân tầng, xác lập ranh giới module bằng quy ước đặt tên và điểm xuất nhập (exports) của `packages/contracts`. Không di chuyển file hàng loạt vì không tạo giá trị chứng minh được trong đợt này và làm nhiễu git blame.

**Ranh giới module hiện tại:**

| Module                             | Server                                                                                                                                                          | Client                                                                   | Contracts dùng chung                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| auth                               | `controllers/authController.ts`, `services/authService.ts`, `repositories/userRepository.ts`, `repositories/refreshSessionRepository.ts`, `middlewares/auth.ts` | `features/auth/` (useAuth, LoginPage, RequireAuth)                       | `loginRequestSchema`, `authUserSchema`, `authResponseSchema`                    |
| catalog/menu                       | `controllers/menuController.ts`, `controllers/adminController.ts` (phần product/topping/category)                                                               | `features/guest/MenuPage.tsx`, `features/admin/Products.tsx`             | `productSchema`, `categorySchema`, `toppingSchema`                              |
| table-session                      | `controllers/tableSessionController.ts`, `services/tableSessionService.ts`, `services/idleSessionSweeper.ts`                                                    | `features/staff/Tables.tsx`                                              | `tableSessionSchema`, `joinTableRequestSchema`, `openTableSessionRequestSchema` |
| order                              | `controllers/orderController.ts`, `services/orderService.ts`                                                                                                    | `features/guest/CartPage.tsx`, `features/staff/KDS.tsx`                  | `placeOrderRequestSchema`, `orderSchema`, `updateOrderStatusRequestSchema`      |
| payment/receipt                    | `controllers/paymentController.ts`, `controllers/receiptController.ts`, `services/paymentService.ts`, `models/Bill.ts`                                          | `features/staff/Tables.tsx` (thu tiền), `features/guest/ReceiptPage.tsx` | `paymentRequestSchema`, `paymentMethodSchema`, `billSchema`                     |
| review                             | `controllers/orderController.ts` (review), `controllers/adminController.ts` (listReviews)                                                                       | `features/guest/ReceiptPage.tsx`, `features/admin/Reviews.tsx`           | `reviewRequestSchema`                                                           |
| AI                                 | `controllers/aiController.ts`, `services/aiService.ts`                                                                                                          | `features/ai/AISheet.tsx`                                                | `aiRecommendRequestSchema`, `aiRecommendResponseSchema`                         |
| operations (thanh toán/monitor...) | `services/idleSessionSweeper.ts`, `realtime/socket.ts`, `infrastructure/`                                                                                       | `layouts/`, `lib/socket.ts`                                              | (chưa có contract riêng)                                                        |

**Nguồn quyết định dữ liệu:** backend quyết định giá, quyền và trạng thái; client chỉ hiển thị và gửi ý định. `Bill` là snapshot bất biến chốt khi thu tiền; receipt tính từ `Order` với ownership theo `participantId`/`receiptToken`.

**Đánh đổi:** ranh giới bằng quy ước không có compiler bắt buộc như tách package; bù lại bằng contracts schema dùng chung và test hồi quy. Việc tách package nội bộ chỉ cân nhắc khi P2/P5 yêu cầu build riêng.

## AD-002 — Refresh access token staff: single-flight, retry một lần (P1)

**Ngày:** 20/09/2026 · **Trạng thái:** đã triển khai, có test unit client

**Bối cảnh:** Access token staff hết hạn 15 phút; trước đây client không tự refresh, staff phải đăng nhập lại. Nhiều request đồng thời 401 không được phép bắn nhiều `/auth/refresh` (refresh token rotate một lần dùng), và logout đang chạy không được bị refresh "hồi sinh" phiên.

**Quyết định** (thuộc `client/src/features/auth/useAuth.ts`):

- **Single-flight:** mọi 401 (không phải auth endpoint, còn có accessToken) hội tụ về đúng một promise `refreshInFlight`; leader gọi `/auth/refresh`, waiter chờ dùng chung kết quả.
- **Retry đúng một lần:** request 401 được đánh dấu `_retry` rồi gửi lại với token mới; nếu retry lại 401 thì thất bại luôn, không refresh lần hai.
- **Bỏ qua refresh** cho: request guest (không có `accessToken` trong store), `/auth/login`, `/auth/logout`, `/auth/refresh` — tránh vòng lặp và tránh dùng refresh cookie của staff cho phiên khách.
- **Không hồi sinh phiên đã đăng xuất:** store có `sessionEpoch` tăng mỗi lần `setSession`/`clearSession`; khi refresh trả về, nếu epoch đã đổi (user logout/đăng nhập khác trong lúc refresh đang chạy) thì bỏ kết quả, không setSession, không retry.
- **Clear phiên hỏng:** refresh thất bại (kể cả response không đạt schema) thì xóa `accessToken`/`user` để UI về trạng thái đăng xuất.
- **Logout clear trước, gọi API sau:** `logout()` dọn state đồng bộ trước khi POST `/auth/logout`, nên request đang chờ refresh không thể ghi đè lên phiên vừa đăng xuất.

**Phương án thay thế:** refresh định kỳ trước khi hết hạn (đặt timer) — bị loại vì phức tạp hoá lifecycle và vẫn cần đường single-flight khi miss; refresh ở service worker — vượt phạm vi.

**Đánh đổi:** request gặp 401 vì lý do khác hết hạn token (ví dụ quyền) vẫn chịu thêm một lần retry vô hại sau refresh; đổi lại đơn giản, không cần phân biệt mã lỗi 401 "hết hạn" và 401 "không quyền".

**Đã kiểm chứng:** `client/src/__tests__/authRefresh.test.ts` — refresh đồng thời dùng chung một lần gọi, refresh thất bại clear phiên, retry tối đa một lần, logout-race không hồi sinh phiên, giữ body + Idempotency-Key khi retry, bỏ qua 401 của guest/auth endpoint.

## AD-003 — requestId do client gửi phải bị chặn định dạng (P1)

**Ngày:** 20/09/2026 · **Trạng thái:** đã triển khai, có test unit server

**Bối cảnh:** `middlewares/error.ts` nhận tuỳ ý header `x-request-id`; giá trị dài/ký tự lạ có thể bẩn log (P3) và phình nhãn metric. Trước đây id tự sinh dùng `Math.random` không phải UUID.

**Quyết định:** chỉ nhận `x-request-id` khớp `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` (tối đa 64 ký tự); ngoài ra server tự sinh `crypto.randomUUID()`. Đây là biên chuẩn bị cho P3 khi requestId vào log/metrics; server không bao giờ tin chuỗi client dài hơn 64 ký tự hay chứa ký tự điều khiển.

**Đã kiểm chứng:** `server/src/__tests__/unit/requestId.test.ts` — giữ id hợp lệ, sinh UUID khi thiếu, thay id quá dài/ký tự không an toàn.

## AD-004 — Hợp đồng auth/payment dùng chung qua packages/contracts (P1)

**Ngày:** 20/09/2026 · **Trạng thái:** đã triển khai cả hai phía, có test unit server

**Bối cảnh:** PROJECT_MEMORY ghi response mới được khai báo rải rác ở client/controller, chưa đưa hết vào contracts. Controller tự check `typeof body.amount !== 'number'` thủ công, dễ lệch giữa server và client.

**Quyết định:**

- `packages/contracts`: thêm `paymentMethodSchema`, `paymentRequestSchema` (amount VND nguyên dương, method enum CASH/BANK_TRANSFER/OTHER, expectedVersion nguyên không âm, note ≤ 280) và `authUserSchema`, `authResponseSchema` (accessToken + user id/name/email/role).
- Server **tiêu thụ** schema: `paymentController.confirm` parse body bằng `paymentRequestSchema` (thay check thủ công, lỗi trả 422 VALIDATION_ERROR kèm details như trước); `authController.login/refresh` parse payload trước khi trả để không bao giờ phát hành auth response sai hình.
- Client **tiêu thụ** schema: `useAuth` validate response `/auth/refresh` bằng `authResponseSchema` (response sai → coi như refresh thất bại, clear phiên); `features/staff/Tables.tsx` dùng `PaymentMethod` cho trạng thái method và parse payload thu tiền bằng `paymentRequestSchema` trước khi gửi.

**Đánh đổi:** parse response ở client là kiểm tra hình dạng, không phải nguồn quyết định số tiền — backend vẫn là nguồn chuẩn. Giá, transaction, idempotency và Bill giữ nguyên hành vi.

## Việc chưa làm (không tuyên bố hoàn thành)

- Chưa chuẩn hoá toàn bộ response API còn lại vào contracts (chỉ auth/payment trong đợt này).
- P3 dùng requestId để tra log, không đưa requestId vào nhãn metric vì cardinality không bị chặn.

## AD-005 — Hook dùng chung tách khỏi component UI (P1)

**Ngày:** 22/09/2026 · **Trạng thái:** đã triển khai và lint đạt

`useToast` và `useDocumentTitle` được tách sang module hook riêng; `Toast.tsx` và `EmptyState.tsx` chỉ xuất component. Quyết định này giữ Fast Refresh ổn định và cho phép giữ `react-refresh/only-export-components` ở mức cảnh báo bị chặn thay vì tắt rule.

## AD-006 — Production-local dùng Nginx cùng origin và Compose project riêng (P2)

**Ngày:** 22/09/2026 · **Trạng thái:** đã build và kiểm chứng local container

Frontend production build được Nginx phục vụ; `/api/` và `/socket.io/` proxy sang backend để cookie, CSRF origin và WebSocket dùng cùng origin. Backend/MongoDB không publish cổng host. Compose đặt tên project `maycafe-production` để không recreate container hoặc dùng nhầm volume của stack dev.

Liveness Nginx/backend tách khỏi readiness MongoDB. Backend chỉ tin đúng một proxy hop trong topology này, chờ request đang chạy khi nhận SIGTERM và đóng cưỡng bức connection sau timeout cấu hình. AI không thuộc readiness vì lỗi AI không được làm gián đoạn menu/đặt món.

**Đã kiểm chứng:** image build thành công; ba service healthy; HTTP, SPA deep-link, REST, WebSocket, luồng QR đến receipt và graceful restart đều chạy trên production-local. Chưa triển khai cloud/HTTPS và replica set một node không phải high availability.

## AD-007 — Observability dùng metric theo instance và snapshot database tách biệt (P3)

**Ngày:** 22/09/2026 · **Trạng thái:** đã triển khai và kiểm chứng production-local

Structured HTTP log tiếp tục dùng Pino, bổ sung `instance`, requestId, route mẫu, status và duration; bỏ Morgan để không ghi hai log cho cùng request. Secret/cookie/authorization vẫn bị redact.

Prometheus client dùng registry riêng và các nhãn hữu hạn. HTTP counter có `outcome` để tách 429/4xx/5xx; histogram chỉ dùng method, route mẫu và status class. Business counter chỉ ghi sau kết quả mới thật sự, không ghi khi idempotency replay. Thời gian công đoạn được định nghĩa bằng transition hoàn thành, không suy đoán từ đơn đang mở.

Dashboard `/admin/operations` tách hai scope:

- `instance`: HTTP, process, socket, business counter từ lúc process khởi động;
- `database`: active sessions/orders/service requests query một lần từ MongoDB.

Khi scale, counter/histogram theo instance có thể cộng; snapshot database không được cộng giữa instance. Raw `/metrics` chỉ có trong private backend network, còn JSON dashboard yêu cầu ADMIN.

Runtime được nâng từ Node.js 20 đã EOL lên Node.js 24 LTS để dùng package chính thức `@prometheus-io/client`; `.nvmrc`, root engine và hai Dockerfile dùng cùng major. Chưa triển khai Prometheus/Grafana/log aggregation trên cloud.

## AD-008 — Tìm kiếm menu dùng pipeline xác định, LLM không quyết định kết quả (P4A)

**Ngày:** 22/09/2026 · **Trạng thái:** đã triển khai và kiểm chứng local/production-local

Với menu nhỏ, tìm kiếm dùng chuẩn hóa tiếng Việt, từ điển sửa lỗi giới hạn, `MenuSearchIntent` có schema, bộ lọc cứng và xếp hạng xác định. Không thêm vector database khi chưa có bằng chứng cần thiết. Endpoint công khai có rate limit và giới hạn input 200 ký tự.

Các ràng buộc budget/caffeine/dairy, availability, ID và giá thuộc backend. Giá lọc là variant khả dụng rẻ nhất của một món; `dưới` là biên nghiêm ngặt còn `không quá`/`tối đa` bao gồm biên. `không cà phê` là loại nhóm, không phải cam kết không caffeine. Metadata chưa biết bị loại khỏi kết quả có ràng buộc an toàn.

Client chỉ gửi câu/bộ lọc, debounce và hủy request cũ; kết quả vẫn mở modal cấu hình hiện hữu để backend kiểm tra lại variant/topping khi đặt. Kết quả rỗng giữ nguyên thay vì nới điều kiện ngầm. Chế độ hiện tại ghi rõ `fallback`; nếu thêm LLM, nó chỉ sinh intent/lời giải thích qua schema rồi dùng lại pipeline backend.

**Đã kiểm chứng:** 25 unit search (13 Top-1 + 12 ràng buộc), integration endpoint với MongoDB tạm, lint/typecheck/build và smoke test production-local. Live LLM chưa chạy.

## AD-009 — Detector tạo bằng chứng, AI chỉ giải thích cảnh báo mới (P4B)

**Ngày:** 22/09/2026 · **Trạng thái:** đã triển khai và kiểm chứng local/production-local một instance

Bốn detector xác định so sánh cửa sổ 15 phút với baseline liền trước 60 phút, yêu cầu đủ mẫu ở cả hai. Threshold là max giữa ngưỡng tuyệt đối và baseline nhân hệ số; dữ liệu ít được ghi `INSUFFICIENT_DATA` thay vì suy luận. HTTP dùng observation ring buffer bounded theo instance; trạng thái đơn dùng MongoDB `statusHistory`.

Alert được lưu MongoDB với aggregate evidence và vòng đời OPEN/ACKNOWLEDGED/CLOSED. Unique bucket cùng cooldown tránh tạo lại cùng tín hiệu; thao tác ADMIN có audit. Scheduler chạy định kỳ, không kích hoạt bởi GET dashboard.

LLM (nếu bật live) chỉ nhận aggregate không chứa body/log/secret, output qua Zod và không có quyền hành động. Lỗi/timeout/schema invalid dùng giải thích mẫu; việc phát cảnh báo không phụ thuộc AI. Giới hạn số lời giải thích live mỗi run tránh bùng chi phí.

**Đánh đổi:** HTTP history chưa dùng store chung, nên P5 phải đưa detector HTTP và scheduler sang worker/leader duy nhất hoặc kho aggregate chung trước khi chạy nhiều instance. Không tuyên bố mô hình ML hay độ chính xác production từ bộ synthetic.

## AD-010 — Redis chia sẻ realtime/rate limit/HTTP aggregate, worker chạy job duy nhất (P5A)

**Ngày:** 22/09/2026 · **Trạng thái:** đã triển khai và kiểm chứng production-local hai backend

Socket.IO dùng Redis adapter để room/event đi qua mọi backend. Nginx vẫn giữ kết nối Socket.IO sticky theo địa chỉ client, còn REST round-robin và retry sang backend còn sống. Auth, guest mutation, menu search và AI dùng `rate-limit-redis`; controller AI bỏ bộ đếm memory riêng để không tạo giới hạn khác nhau theo instance.

Idle-session sweeper và anomaly scheduler được chuyển khỏi API process sang entrypoint `worker.ts`, Compose chỉ chạy một worker. HTTP observation cần cho anomaly được gom theo bucket phút trong Redis; worker đọc aggregate chung thay cho ring buffer cục bộ. Prometheus process metrics vẫn theo instance.

Redis outage được xử lý có chủ ý: read menu vẫn hoạt động, readiness trả `degraded`, còn endpoint mutation có shared limiter trả lỗi thay vì tự fail-open. Đây là ưu tiên an toàn; Redis vì vậy là dependency vận hành quan trọng dù MongoDB mới là dependency quyết định HTTP readiness 503.

**Đã kiểm chứng trên topology hai API ban đầu:** chia request 10/10 qua A/B; limiter 30 lần dùng chung; event và remote socket revocation khác instance; failover 20/20 request sau khi dừng A; chỉ một worker khởi động. MongoDB vẫn là replica set một node và toàn stack cùng một Docker host, nên không gọi là high availability.

## AD-013 — Tách pool Guest/Internal và chuyển việc nền sang Redis queue

**Quyết định:** cổng Guest chỉ proxy vào `server-guest-a/b`; Staff/Admin chỉ proxy vào `server-internal-a/b`. Compose áp CPU/RAM limit và cho Internal `cpu_shares` cao hơn Guest. Guest dùng limiter Redis theo bàn cộng burst/connection limit ở Nginx. Menu public cache Redis theo generation. Report JSON/CSV và notification realtime đi qua hai queue riêng; worker luôn drain notification trước report, retry tối đa rồi đưa job lỗi vào dead-letter.

**Lý do:** tách cổng đơn thuần không ngăn traffic QR chiếm Node process của nhân viên. Pool/resource class riêng giữ capacity nội bộ tốt hơn trên cùng host; limiter theo bàn chính xác hơn limiter IP trong mạng Wi-Fi NAT. Queue loại aggregation/export khỏi request process và tránh notification trong worker cũ bị no-op vì worker không sở hữu Socket.IO server.

**Đánh đổi:** bốn API process dùng thêm RAM; MongoDB, Redis, Nginx và host vẫn là tài nguyên chung nên không phải hard isolation hay HA. Report UI phụ thuộc worker/Redis và có timeout rõ ràng. Cache menu fail-open về MongoDB để giữ read availability; mutation limiter vẫn không fail-open.

**Đã kiểm chứng 23/09/2026:** health trên `8080` trả `trafficClass=guest`, `8081/8082` trả `internal`; JSON/CSV report job hoàn tất; realtime queue drain sạch; menu tạo cache key Redis; burst 100 request chỉ trả 200/429; join cùng token thử nghiệm trả 20×404 rồi 2×429; cross-portal routes vẫn 404. Nginx dùng Docker DNS resolve động; sau recreate backend mà không restart Nginx, 12/12 request mỗi cổng vẫn vào đúng traffic class.

## AD-011 — Benchmark seed phải dựng lại index sau khi reset database (P5B)

**Ngày:** 22/09/2026 · **Trạng thái:** đã sửa sau khi load test phát hiện vi phạm bất biến

`dropDatabase()` xóa cả dữ liệu lẫn index. Seed benchmark cũ chỉ import ba model nên lượt join đồng thời đã vô tình chạy không có partial unique index của table session và tạo nhiều phiên OPEN cho một bàn. Seed nay đăng ký toàn bộ model rồi chạy `syncIndexes()` trước khi ghi dữ liệu. Script `check:benchmark` kiểm tra idempotency, tổng tiền, trạng thái và đúng một phiên active; nó từ chối database không có chữ `benchmark`.

Không dùng kết quả latency/throughput của lượt seed lỗi làm bằng chứng. Kết quả chính thức và giới hạn được ghi tại `performance-report.md`.

## AD-012 — PWA cache giao diện, không xếp hàng mutation offline (P7)

**Ngày:** 23/09/2026 · **Trạng thái:** đã triển khai và có browser smoke

Service worker precache toàn bộ asset có hash từ Vite manifest và fallback navigation về app shell. API `/api/` và `/socket.io` bị loại hoàn toàn khỏi cache. Khi mất mạng, giao diện/route đã build vẫn tải lại được và giỏ Zustand còn trong local storage, nhưng đặt món/thanh toán/yêu cầu phục vụ không được gửi ngầm.

Quyết định không dùng background sync cho mutation vì quyền phiên, giá, availability và idempotency phải được backend kiểm tra tại thời điểm người dùng chủ động thử lại. Cache match dùng `ignoreVary` vì response asset từ preview/Nginx có thể có header `Vary` khác request precache.

## AD-013 — Dashboard dùng aggregation toàn bộ dữ liệu và ngày Việt Nam (P7)

**Ngày:** 23/09/2026 · **Trạng thái:** đã triển khai và integration đạt

Dashboard không lấy `Order` qua API phân trang để tính biểu đồ. Repository dùng một MongoDB `$facet` cho summary, top sản phẩm, doanh thu theo ngày và theo giờ trên toàn bộ đơn `PAID`; các bucket dùng `Asia/Ho_Chi_Minh`. Khoảng ngày từ UI được đổi thành biên UTC tương ứng ngày Việt Nam.

CSV được tạo phía client từ đúng response đang hiển thị, có chống spreadsheet formula injection; nút In/PDF dùng print dialog của trình duyệt. Integration tạo 105 đơn để khóa hồi quy lỗi cắt ở giới hạn 100 trước đây.

## AD-014 — Transactional outbox cho luồng nghiệp vụ cốt lõi

**Ngày:** 23/09/2026 · **Trạng thái:** đã triển khai và kiểm chứng local

Order create/cancel/transition, payment, table-session open/reopen/transition/idle-close và service-request create/resolve ghi audit cùng các `OutboxEvent` trong chính transaction nghiệp vụ. API không còn phát notification sau commit cho các luồng này. Relay claim event bằng lease, giữ `eventId` ổn định khi đưa sang Redis realtime queue, retry có backoff và giữ event `FAILED` để điều tra khi vượt số lần thử.

Giao nhận là at-least-once: nếu enqueue thành công nhưng cập nhật trạng thái outbox thất bại, event có thể xuất hiện lại. Event chứa aggregate/version để chuẩn bị cho client bỏ sự kiện cũ hoặc refetch ở A3. Khi event đóng phiên được phát vào room khách, consumer ngắt socket sau khi emit để khách nhận sự kiện thanh toán/đóng bàn trước khi mất kết nối.

Production chỉ chạy relay trong worker. Chế độ `unified` chạy thêm relay trong API process; khi Redis không sẵn sàng nhưng Socket.IO cùng process tồn tại, relay phát trực tiếp rồi đánh dấu event. `npm run dev` khởi động cả API, worker và client để scheduler/report vẫn hoạt động.

Mutation catalog/availability cũng dùng transaction audit + outbox; consumer mới invalidate cache sau khi nhận event. Admin operations hiển thị outbox `FAILED`, dead-letter Redis và cho replay có audit. Anomaly vẫn là dữ liệu vận hành riêng, không phải domain event cần outbox.

## AD-015 — Worker tách vai trò và Redis queue có lease sở hữu

**Ngày:** 23/09/2026 · **Trạng thái:** đã triển khai và kiểm chứng bằng Redis drill

Realtime, report và scheduler chạy bằng các `WORKER_ROLE` riêng trong production. Claim chuyển job sang processing và tạo lease trong cùng Lua script; renew, ACK, retry và reclaim đều so khớp token/owner. Retry exponential có jitter, quá số lần vào dead-letter và replay chuyển nguyên tử về queue nguồn. Report state chỉ có TTL khi đã terminal để job dài không biến mất giữa chừng.

Scheduler dùng leader lease để tránh chạy sweeper/detector trùng. Mỗi worker ghi heartbeat có TTL; Docker healthcheck và Admin operations đọc heartbeat thay vì chỉ kiểm process còn tồn tại. Shutdown ngừng claim mới, chờ job đang chạy và đóng dependency có thời hạn.

## AD-016 — Bill snapshot và quote ký là hai ranh giới tài chính

**Ngày:** 23/09/2026 · **Trạng thái:** đã triển khai và integration đạt

Receipt phiên mới chỉ dựng từ Bill snapshot bất biến, đã giữ tên bàn, mã hóa đơn, cashier và payment summary tại thời điểm thanh toán. Phiên legacy chưa có Bill mới fallback về Order và response nêu rõ nguồn. Việc sửa Order/catalog sau thanh toán không đổi receipt.

Đặt món có bước quote ký HMAC gắn guest, phiên bàn, fingerprint giỏ, fingerprint catalog, tổng tiền và hạn dùng. Quote và place dùng chung một pricing service; place đọc/khóa phiên, đọc catalog và tạo Order trong transaction. Catalog hoặc giỏ đổi trả `QUOTE_CHANGED`, buộc người dùng xác nhận lại; idempotency replay vẫn trả kết quả cũ trước khi kiểm quote hết hạn.

## AD-017 — Các workflow vận hành có aggregate và version riêng

**Ngày:** 23/09/2026 · **Trạng thái:** đã triển khai và integration đạt

Cancel request và cash shift là aggregate riêng, có lifecycle/version/index chống thao tác đồng thời. Chuyển bàn giữ nguyên `tableSessionId`/participant, chỉ đổi vị trí hiện tại và cập nhật Order trong transaction; lịch sử nguồn/đích nằm trên session. Availability có endpoint STAFF tối thiểu, không tái sử dụng DTO quản trị giá.

Bill history lọc theo snapshot, phân trang và biên ngày `Asia/Ho_Chi_Minh`. KDS tính tuổi từ `statusHistory`; AI chỉ giải thích từ evidence backend đã xác thực và cấu hình cuối được kiểm lại giá, availability, caffeine/dairy trước khi thêm giỏ.

## AD-018 — Production dùng migration runner và restore drill bắt buộc

**Ngày:** 23/09/2026 · **Trạng thái:** đã triển khai và drill đạt

Mongoose `autoIndex` bị tắt ở production. Compose chạy migration đã build trước API/worker; runner có unique lock, checksum ổn định giữa TypeScript và JavaScript build, preflight dữ liệu xung đột và lịch sử applied. Migration chỉ tiến về trước; rollback ứng dụng phải tương thích schema trong cửa sổ deploy.

Backup dùng archive gzip kèm SHA-256. Restore script chỉ chấp nhận database kết thúc bằng `_restore_test`, rồi kiểm count, Bill trùng phiên, Payment mồ côi và các index bắt buộc. Drill MongoDB 7 ngày 23/09/2026 khôi phục 4 business document cùng migration state, 0 lỗi, đủ 5 index kiểm tra; chi tiết ở `restore-drill-2026-09-23.md`.
