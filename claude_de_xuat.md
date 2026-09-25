# Đề xuất cải tiến Mây Café — hướng dẫn triển khai cho AI

Ngày lập: 23/09/2026. Người lập: Claude, sau khi đọc code tại commit `4e017b0` cùng các thay đổi chưa commit trong worktree.

Cập nhật 24/09/2026: S1–S4 đã triển khai và kiểm chứng (xem `docs/test-report.md`). Bỏ N1 (tách hóa đơn theo từng khách) và N2 (VietQR) theo yêu cầu của người dùng.

Trạng thái: **S1–S4 đã xong** (có test tái hiện chạy đỏ trước khi sửa). Các mục còn lại vẫn là kế hoạch, chưa triển khai. Không mục nào được coi là đã xong khi chưa có test và bằng chứng nghiệm thu.

## 0. Đọc trước khi làm

### Bối cảnh

- Mây Café là hệ thống gọi món tại bàn cho **một** quán. Luồng chính: QR → vào bàn → chọn món/AI → báo giá → đặt món → KDS → thanh toán → Bill → receipt → đánh giá.
- npm workspaces:
  - `client`: React 18, Vite, TanStack Query 5, React Router 7, Zustand.
  - `server`: Express 4, Mongoose 8, Socket.IO 4, Redis.
  - `packages/contracts`: Zod 3.
- Kế hoạch trước trong `HUONG_DAN_CAI_TIEN_KIEN_TRUC_HE_THONG_CHUC_NANG.md` (A1–A3, B1–B4, C1–C7, D1) **đã hoàn thành**. Các phần đã có: outbox, worker tách vai trò, event envelope, Bill snapshot, quote ký HMAC, migration runner, KDS SLA, báo hết món, lịch sử hóa đơn, yêu cầu hủy, chuyển bàn, ca thu ngân, AI evidence. Không làm lại các phần này.
- Nhận định chung: hạ tầng hiện đã phức tạp hơn nhu cầu của một quán (11 container). Đợt này ưu tiên **sửa các lỗi thiết kế cụ thể** và **hoàn thiện nghiệp vụ tiền**. Không thêm thành phần hạ tầng mới nếu không có số đo chứng minh cần thiết.
- Ngoài phạm vi, không làm:
  - Tách hóa đơn hoặc thanh toán một phần theo từng khách; VietQR (người dùng loại ngày 24/09/2026).
  - Đa chi nhánh, giao hàng, kho nguyên liệu, cổng thanh toán online, tài khoản khách hàng (giới hạn từ trước).

### Tài liệu cần đọc

1. `PROJECT_MEMORY.md`: trạng thái mới nhất của dự án.
2. `docs/architecture.md` và `docs/architecture-decisions.md`.
3. `docs/test-report.md`, `docs/upgrade-progress.md`. Đọc thêm `docs/performance-report.md` khi làm K1/K2.
4. Toàn bộ file này.

### Quy tắc bắt buộc

- Chạy `git status` trước khi làm. Worktree đang có khoảng 94 file thay đổi hoặc chưa track, chính là toàn bộ phần A1–D1. Đó là việc của người dùng: **không** reset, checkout, stash hay xóa. Nếu người dùng chưa commit phần này, đề nghị họ làm trước (mục V0) để diff của đợt này còn review được.
- Bỏ qua thư mục `.kilo/worktrees/`. Đó là git worktree của một công cụ khác, đã loại trừ qua `.git/info/exclude`. Không sửa file trong đó. Khi tìm kiếm, loại trừ thư mục này để không nhận kết quả trùng.
- Không đọc ra, in ra hay commit `apikey.txt` hoặc bất kỳ secret nào.
- Không reset hay xóa dữ liệu demo, database, volume. Seed chỉ chạy trên database thử nghiệm.
- Không tạo tài nguyên cloud có phí.
- Không commit/push khi người dùng chưa yêu cầu trong lần làm việc đó.
- Mỗi mã (S1, K1, N3, …) là một thay đổi review được riêng. Không gộp nhiều mã vào một diff lớn.
- Mục có dòng **Cần người dùng chốt** thì phải dừng lại hỏi trước khi code. Không tự đoán quy tắc nghiệp vụ liên quan đến tiền.
- Số dòng ghi trong file này đúng tại thời điểm viết. Mở file và đối chiếu lại trước khi sửa.

### Bất biến phải giữ

- Backend quyết định giá, quyền truy cập, trạng thái và số tiền phải thu.
- Mỗi bàn chỉ có tối đa một phiên `OPEN` hoặc `CHECKOUT`.
- Khách chỉ xem đơn, hóa đơn và đánh giá thuộc `participantId` của mình.
- Đặt món và thanh toán giữ idempotency: gửi lại cùng key không tạo thêm đơn hay khoản thu.
- Transaction đặt món phải tiếp tục ghi lên `TableSession` (tăng `version`). Bỏ bước này thì một đơn có thể chen vào sau khi thanh toán đã đọc danh sách đơn (write skew), để lại đơn mồ côi trong phiên đã `CLOSED`.
- `Payment` và `Bill` đã chốt không bao giờ bị sửa. Mọi điều chỉnh hoặc hoàn tiền là bản ghi bổ sung.
- Realtime chỉ phát qua outbox trong cùng transaction nghiệp vụ.
- PWA giữ giỏ hàng khi mất mạng nhưng không tự gửi mutation khi có mạng lại.
- Cache ở tầng proxy chỉ áp cho endpoint công khai, không phụ thuộc cookie hay quyền.

### Quy ước kỹ thuật

- **Contracts trước.** Khai báo request/response mới trong `packages/contracts/src/schemas.ts`. Server parse cả input lẫn response trước khi trả; client parse khi cần. Cập nhật `docs/api/openapi.yaml`.
- **Index mới.** Khai báo trong model **và** thêm một migration mới trong `server/scripts/migrate.ts`:
  - Migration là append-only, id dạng `YYYYMMDD-NNN-slug`. Hiện đã có `20260923-001`, `-002`, `-003`.
  - Không sửa migration đã áp dụng vì runner kiểm checksum.
  - Production tắt `autoIndex`, nên index chỉ khai báo trong model sẽ không được tạo trên production.
- **Realtime.** Dùng `outboxRepository.createRealtimeEvents(..., session)` trong transaction. Không emit trực tiếp từ controller.
- **Ranh giới module.** Controller không import model hay unitOfWork; `npm run lint` chạy `server/scripts/check-boundaries.ts` để kiểm tra.
- **Metric Prometheus.** Chỉ dùng nhãn có tập giá trị hữu hạn.

### Lệnh kiểm tra

Chạy từ thư mục gốc:

```powershell
npm run lint
npm run typecheck
npm run test:server
npm run test:client
npm run test:integration
npm run build
npm run test:e2e   # khi đổi UI hoặc luồng xuyên suốt; đọc server/playwright.config.ts trước
```

Ghi riêng số ca PASS, FAIL và SKIP. Ca bị skip vì thiếu `E2E_TABLE_TOKEN` không được tính là PASS. Chỉ chạy benchmark k6 khi làm K1/K2, dùng database `maycafe_benchmark` và ghi rõ điều kiện đo.

## 1. Lộ trình

| Đợt | Mã | Việc | Ưu tiên | Điều kiện |
| --- | --- | --- | --- | --- |
| 0 | V0 | Commit phần A1–D1 đang chờ | Chặn đợt 1 | Người dùng đồng ý |
| 1 | S1 | Feed KDS tải toàn bộ đơn SERVED từ trước tới nay | Cao | — |
| 1 | S2 | Race idempotency có thể tạo đơn trùng | Cao | — |
| 1 | S3 | API đơn trả nguyên document Mongoose | Cao | — |
| 1 | S4 | Nginx chưa nén, SPA chưa có header bảo mật | Cao | — |
| 2 | K1 | Đường đọc menu: bỏ parse/stringify lặp, thêm micro-cache | Vừa | Nên làm sau S4 |
| 2 | K2 | Đo và giảm tranh chấp ghi trên TableSession | Vừa | — |
| 2 | K3 | Polling thích ứng, sửa socket staff, bỏ `socket.on` trực tiếp | Vừa | — |
| 2 | K4 | Khóa rate limit và sticky session phù hợp mạng NAT | Vừa | Bắt buộc trước T1 |
| 2 | K5 | Chính sách lưu giữ outbox/audit | Vừa | Audit cần người dùng chốt |
| 3 | K6 | Báo cáo tài chính lấy từ Payment/Bill | Vừa | Làm trước N3 |
| 3 | N3 | Đền món lỗi, giảm giá, hoàn tiền (append-only) | Vừa | K6 + người dùng chốt |
| 4 | N4 | Báo giá tự động, thời gian chờ ước tính | Thấp | S3 |
| 4 | K7 | Ranh giới module cho tầng service | Thấp | — |
| 4 | T1 | Profile triển khai nhỏ, HTTPS, xác thực Mongo/Redis | Khi deploy | K4 + người dùng chốt |
| 4 | V1 | Sửa tài liệu lệch với code, xóa code chết | Thấp | — |

Thứ tự khuyến nghị: xong đợt 1 (các sửa lỗi nhỏ, rủi ro thấp) rồi mới mở đợt 2. N3 thay đổi dòng tiền, nên phải có K6 trước để báo cáo và ca thu ngân luôn khớp.

## 2. Nhóm S: lỗi thiết kế đã xác định trong code

### S1. Feed KDS tải toàn bộ đơn SERVED từ trước tới nay

**Hiện trạng**

- `orderRepository.listForStaff` (`server/src/repositories/orderRepository.ts`, dòng ~69–75): khi không có tham số `status`, hàm lọc `status ∈ {PENDING, CONFIRMED, PREPARING, READY, SERVED}` mà không giới hạn thời gian, phiên hay số lượng. SERVED là trạng thái cuối, nên tập kết quả tăng mãi theo thời gian vận hành.
- `GET /staff/orders` (`orderController.staffList`) trả toàn bộ document, gồm cả `statusHistory`, `idempotencyKey` và `requestHash`.
- Hai nơi gọi endpoint này, cùng query key `staff-orders`:
  - `client/src/features/staff/KDS.tsx`: poll 10 giây.
  - `client/src/layouts/StaffLayout.tsx`: poll 10 giây, chỉ để đếm số đơn PENDING.
  - Cả hai còn refetch sau mỗi socket event.
- KDS chỉ hiển thị 4 cột PENDING → READY, không dùng đến đơn SERVED.
- Ví dụ: 300 đơn/ngày thì sau một tháng, mỗi lần poll trả khoảng 9.000 đơn, nhân với số thiết bị staff.
- Seed (`server/src/seeds/seed.ts`) còn tạo đơn PENDING/CONFIRMED… ở các ngày cũ, nên KDS demo có thể hiện đơn "trễ" nhiều ngày.

**Hướng làm**

1. Viết integration test trước. Tạo nhiều đơn SERVED ở phiên `CLOSED` cũ và vài đơn đang xử lý ở phiên `OPEN`, rồi khẳng định response hiện tại chứa đơn cũ. Test phải đỏ trước khi sửa.
2. Feed mặc định chỉ gồm đơn chưa hoàn tất (`PENDING..READY`) thuộc phiên `OPEN` hoặc `CHECKOUT`. Có thể lấy id các phiên active trước rồi lọc `tableSessionId: { $in: ids }`. Nếu cần màn hình "vừa phục vụ", thêm tham số tường minh (ví dụ `?status=SERVED&since=`) kèm `limit` bắt buộc.
3. Dùng projection, chỉ trả field KDS cần. `statusHistory` chỉ cần `to` và `at` để tính tuổi đơn. Không trả `idempotencyKey`, `requestHash` (xem thêm S3).
4. Trước khi đổi hành vi mặc định, grep `/staff/orders` và `staff-orders` để tìm mọi nơi đang dùng.
5. Thêm index cho truy vấn mới qua migration (ví dụ `{ tableSessionId: 1, status: 1, createdAt: 1 }`) và xác nhận bằng `explain()`.
6. Tiện sửa luôn: `staffGetOne` đang gọi `tableRepository.list()` chỉ để tìm một bàn; đổi sang `findById`.

**Nghiệm thu**

- Response không còn đơn của phiên đã đóng.
- Kích thước response không tăng theo lịch sử.
- KDS và badge PENDING hoạt động như cũ.
- Integration test và client test đạt.

### S2. Gửi lại cùng Idempotency-Key khi request đầu còn đang chạy có thể tạo đơn trùng

**Hiện trạng**

- `placeOrder` (`server/src/services/orderService.ts`, dòng ~56) kiểm tra idempotency **ngoài** transaction, rồi mới insert trong transaction. Hai request cùng key chạy đồng thời đều qua được bước kiểm tra; request thua chạm unique index `(tableSessionId, idempotencyKey)` và nhận lỗi 11000.
- `errorHandler` (`server/src/middlewares/error.ts`, dòng ~21) đổi mọi lỗi 11000 thành 409 `CONFLICT` chung chung.
- `client/src/features/guest/CartPage.tsx` (dòng ~94) bỏ key khi status < 500 nhưng giữ nguyên giỏ. Người dùng bấm gửi lại sẽ dùng key mới, và server tạo **đơn thứ hai**.
- Kịch bản thực tế:
  1. Request đầu chậm quá 20 giây (timeout của axios và `proxy_read_timeout 20s` của Nginx) nhưng Node vẫn xử lý tiếp và commit.
  2. Client giữ key, người dùng bấm thử lại đúng lúc request đầu chưa commit.
  3. Request thứ hai chạm lỗi 11000, nhận 409, client bỏ key, người dùng bấm lần nữa và tạo đơn trùng.
- `confirmPayment` (`server/src/services/paymentService.ts`) có cùng mẫu. Request thua race đọc thấy phiên đã `CLOSED` và nhận 403 "Hãy chuyển bàn sang thanh toán…". Không tạo payment trùng, nhưng thông báo sai.

**Hướng làm**

1. Viết integration test trước:
   - Order: gọi đồng thời hai lần đặt món cùng key và payload (`Promise.all`). Mong muốn: đúng 1 order; cả hai request thành công, một `created:true`, một `created:false`.
   - Payment: kết quả mong muốn là 1 Payment, 1 Bill; request thứ hai trả kết quả replay kèm `billId`.
2. Order: khi transaction lỗi 11000 và `err.keyPattern` chứa `idempotencyKey`, đọc lại bằng `findByIdempotency`, áp đúng các kiểm tra hash/participant của nhánh replay hiện có, rồi trả `created:false`. Nếu 11000 đến từ index `code` (trùng mã đơn) thì sinh mã mới và thử lại, không coi là replay.
3. Payment: khi transaction lỗi vì bất kỳ lý do nào, kiểm tra lại `paymentRepository.findByIdempotency(key)`. Nếu có bản ghi và payload khớp thì trả replay.
4. Client: chỉ bỏ key khi lỗi chứng minh đơn **chưa** được tạo: `VALIDATION_ERROR`, `QUOTE_CHANGED`, `IDEMPOTENCY_CONFLICT`, hoặc 403 do phiên đã đóng. Với 409 `CONFLICT` chung và lỗi mạng thì giữ key. Cập nhật `client/src/__tests__/checkout.test.tsx`.
5. `generateUniqueCode` kiểm tra trùng mã ngoài transaction là không cần thiết khi đã có unique index. Có thể giữ, nhưng vẫn phải xử lý 11000 như bước 2.

**Nghiệm thu**

- Test đồng thời đạt cho cả order và payment.
- Không còn đường nào tạo đơn thứ hai khi thử lại với cùng key.

### S3. API đơn trả nguyên document Mongoose

**Hiện trạng**

- Các endpoint của khách trong `orderController.ts` trả thẳng `OrderDoc`: `POST /orders`, `GET /orders/mine`, `GET /orders/:id`, `POST /orders/:id/cancel`.
- Response vì vậy có cả field nội bộ: `idempotencyKey`, `requestHash`, `version`, `__v`, `tableId`, `statusHistory[].by` (ObjectId nhân viên).
- Receipt đã có DTO trong `receiptService.ts`; đơn thì chưa.
- `staffList` và `staffGetOne` dùng `...o.toObject()` nên cũng lộ các field trên.

**Hướng làm**

1. Grep những field client thực sự dùng trong `client/src/features/guest/{OrdersPage,CartPage}.tsx` và `client/src/features/staff/{KDS,OrderDetailModal}.tsx`.
2. Khai báo `guestOrderSchema` và `staffOrderSchema` trong contracts, liệt kê field tường minh. Viết serializer trong service. Controller parse response bằng schema trước khi trả, giống receipt.
3. DTO khách bỏ `idempotencyKey`, `requestHash`, `__v`, `statusHistory[].by`. Giữ `statusHistory` dạng `{ to, at }` nếu UI hiển thị tiến trình.
4. DTO staff bỏ `idempotencyKey`, `requestHash`, `__v`.
5. Service worker có thể còn phục vụ bundle cũ, nên chỉ bỏ field. Không đổi tên field mà client đang dùng.

**Nghiệm thu**

- Test khẳng định response không còn field nội bộ.
- UI khách và staff không đổi hành vi.
- OpenAPI được cập nhật.

### S4. Nginx chưa nén, SPA chưa có header bảo mật

**Hiện trạng**

- `client/Dockerfile` dùng image `nginx:1.27-alpine`. `nginx.conf` mặc định của image tắt gzip, và các file trong `docker/nginx/` không bật lại. Hệ quả: entry JS 389 kB và JSON menu (~131 KiB với 200 món) đi không nén.
- Chỉ `/assets/` có `Cache-Control`. `helmet` chỉ áp cho response API; trang SPA không có CSP, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors`.
- `index.html` và `sw.js` không có `Cache-Control`, nên trình duyệt có thể cache theo heuristic.

**Hướng làm**

1. Bật gzip trong `docker/nginx/default.conf` (thuộc ngữ cảnh http):
   ```
   gzip on;
   gzip_vary on;
   gzip_min_length 1024;
   gzip_comp_level 5;
   gzip_types application/json application/javascript text/css image/svg+xml application/manifest+json;
   ```
   Nếu sau này có CDN hoặc load balancer phía trước, thêm `gzip_proxied any`. Tùy chọn: nén sẵn lúc build rồi dùng `gzip_static on`.
2. Thêm header bảo mật cho cả ba server block (8080/8081/8082), dùng tham số `always`.
   - Lưu ý: `add_header` khai báo trong một `location` sẽ **thay thế toàn bộ** `add_header` kế thừa từ `server`. `/assets/` đang có `add_header Cache-Control`, nên nếu chỉ khai báo ở `server` thì `/assets/` sẽ mất header bảo mật.
   - Cách làm: đặt header vào một file include và include ở mọi level có `add_header`.
3. CSP: bắt đầu bằng `Content-Security-Policy-Report-Only`, chạy Playwright trên cả ba portal để gom vi phạm, rồi mới chuyển sang enforce.
   - Nguồn ngoài hiện có: Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`), ảnh `images.unsplash.com`, ảnh QR dạng `data:`.
   - Radix Dialog có thể chèn thẻ `<style>`, nên có thể cần `style-src 'unsafe-inline'`.
   - Dùng `$http_host` (có kèm cổng), không dùng `$host`, vì WebSocket chạy ở cổng 8080/8081/8082.
   - Gợi ý khởi đầu:
   ```
   default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://images.unsplash.com; connect-src 'self' ws://$http_host wss://$http_host; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
   ```
4. Thêm `location = /index.html` và `location = /sw.js` với `Cache-Control: no-cache`.
5. Chưa thêm HSTS khi chưa có HTTPS (xem T1).

**Nghiệm thu**

- `curl -sI -H "Accept-Encoding: gzip"` qua cổng 8080 trên entry JS và `/api/v1/categories` đều trả `Content-Encoding: gzip`.
- Header bảo mật có ở `/`, ở deep link và ở `/assets/*`.
- Playwright production smoke đạt khi CSP đã enforce, không có lỗi CSP trong console.

## 3. Nhóm K: kiến trúc và hệ thống

### K1. Đường đọc menu: bỏ parse/stringify lặp lại, thêm micro-cache

**Hiện trạng**

- `cachedJson` (`server/src/infrastructure/jsonCache.ts`) lưu chuỗi JSON trong Redis. Nhưng mỗi request lại `JSON.parse` chuỗi đó, rồi `res.json` stringify lại (~131 KiB với 200 món).
- `docs/performance-report.md` được đo trước khi có Redis cache và chỉ ra nút nghẽn ở payload menu lớn và serialize JSON (90 RPS đạt; 100 RPS có p95 3,26 giây trên topology cũ). Cache Redis hiện tại bỏ được lượt đọc Mongo, nhưng vẫn còn chi phí parse và stringify ở mỗi request.

**Hướng làm**

1. Cache sẵn body response hoàn chỉnh (chuỗi `{"success":true,"data":...}`) cùng một ETag tính một lần lúc nạp cache (hash của body).
   - Controller gửi bằng `res.type('application/json').set('ETag', etag).send(body)`. Khi ETag đã được đặt, Express tự trả 304 lúc `If-None-Match` khớp.
   - Khi Redis lỗi (generation là `'local'`), vẫn nạp từ Mongo và tính ETag từ body. Không dùng generation làm ETag.
2. Đặt `Cache-Control: no-cache` cho menu để trình duyệt luôn revalidate và nhận 304.
3. Thêm micro-cache ở Nginx, chỉ ở portal Guest và chỉ cho `GET /api/v1/categories`, `/api/v1/products`, `/api/v1/products/featured`.
   - Cấu hình: `proxy_cache_path` (ngữ cảnh http), TTL 2–3 giây, `proxy_cache_lock on`, `proxy_cache_use_stale updating error timeout`.
   - Giữ nguyên `limit_req` và các proxy header. Tách phần proxy chung ra file include để không phải lặp.
   - Không bật `proxy_ignore_headers Set-Cookie`: mặc định Nginx không cache response có Set-Cookie.
4. Ghi rõ vào tài liệu độ trễ tối đa để thay đổi availability đến tay khách: TTL micro-cache cộng TTL Redis. Backend vẫn kiểm tra lại khi báo giá và khi đặt món.
5. Đo lại bằng `scripts/load/menu-constant.js` trên cùng dataset. Ghi commit, topology và máy phát tải. Không tuyên bố con số chưa đo.

**Nghiệm thu**

- Response giống hệt trước (so sánh JSON).
- Server trả 304 khi request gửi `If-None-Match` khớp.
- Kết quả đo mới được ghi vào `docs/performance-report.md` kèm điều kiện đo.

### K2. Đo và giảm tranh chấp ghi trên TableSession khi đặt món

**Hiện trạng**

- `placeOrder` tăng `version` của TableSession trong transaction để tuần tự hóa với checkout, thanh toán và chuyển bàn. Cách làm này **đúng** và phải giữ (xem mục Bất biến).
- `server/src/infrastructure/unitOfWork.ts` dùng `session.withTransaction` với cấu hình mặc định. Khi nhiều khách cùng bàn đặt món đồng thời, các transaction gặp WriteConflict và bị thử lại.
- Kịch bản benchmark đặt 20 VU vào **cùng một bàn** cho write p95 4,15 giây. Đây là trường hợp xấu nhất; một bàn thật hiếm khi có quá 4 người cùng bấm gửi một lúc.

**Hướng làm**

1. Thêm metric đếm số lần callback transaction chạy, theo tên thao tác. Tên thao tác là tập cố định (`order.place`, `payment.confirm`, …). Ví dụ API: `unitOfWork.withTransaction(work, { operation })`.
2. Đọc code driver trong `node_modules/mongodb` (bản đi kèm Mongoose 8) để xác định `withTransaction` có chờ (backoff) giữa các lần thử lại không. Nếu không có:
   - Tự viết vòng retry: `startTransaction` → `work` → `commitTransaction`.
   - Bắt các nhãn `TransientTransactionError` và `UnknownTransactionCommitResult`.
   - Chờ jitter tăng theo cấp số nhân (ví dụ 5–100 ms) và giới hạn tổng thời gian.
3. Chỉ khi số đo cho thấy cần: thêm khóa Redis ngắn theo `tableSessionId` quanh transaction đặt món (`SET NX PX`, chờ có jitter), để các transaction cùng bàn không chạy chồng. Khóa này chỉ là tối ưu; tính đúng vẫn do version và transaction bảo đảm, nên khóa hết hạn không làm sai dữ liệu.
4. Thêm kịch bản k6 sát thực tế hơn: nhiều bàn, mỗi bàn 1–3 khách, tổng tải tương đương kịch bản cũ. So sánh với kịch bản một bàn.
5. Chạy `npm -w @may-cafe/server run check:benchmark` sau mỗi lượt đo để xác nhận bất biến.

**Nghiệm thu**

- Có số liệu retry trước và sau khi sửa.
- Write p95 của kịch bản thực tế được ghi lại.
- Không bỏ version guard.
- Các integration test hiện có vẫn đạt.

### K3. Polling thích ứng, sửa socket staff, bỏ `socket.on` trực tiếp

**Hiện trạng**

- Client poll theo chu kỳ cố định, bất kể socket đang kết nối hay không:

  | Phía | Endpoint / dữ liệu | Chu kỳ |
  | --- | --- | --- |
  | Khách | `/table-sessions/current` (`GuestLayout.tsx`) | 10 giây |
  | Khách | `/orders/mine` | 15 giây |
  | Staff | danh sách đơn, danh sách bàn | 10 giây |
  | Staff | yêu cầu phục vụ, yêu cầu hủy | 8 giây |

- Mỗi event phía staff invalidate cả 4 query key (hàm `refresh` trong `StaffLayout.tsx`).
- `connectStaffSocket` dùng khóa danh tính `staff:${accessToken}` (`client/src/lib/socket.ts`, dòng ~62). Mỗi lần access token được làm mới (khoảng 15 phút một lần khi đang dùng), socket bị ngắt và tạo lại.
- `KDS.tsx`, `ServiceRequests.tsx` và `OrdersPage.tsx` gọi `getSocket()` rồi `socket.on` trực tiếp. Cách này bỏ qua `RealtimeEventGate` (khử trùng event, so version) và không đăng ký lại khi socket được tạo mới. Hiện vẫn chạy được chỉ vì layout cũng lắng nghe cùng các event đó.
- Server cho socket staff join room `staff:${userId}` nhưng không dùng room này. Khi khóa tài khoản hay đổi quyền, socket đang mở không bị ngắt.

**Hướng làm**

1. Viết một hook dùng chung, ví dụ `useRealtimeInterval(fastMs, slowMs)`: khi socket đang kết nối thì poll chậm (gợi ý 60 giây); mất kết nối thì poll nhanh (10 giây). Không bỏ hẳn polling.
2. Map từng event sang đúng query key cần làm mới, thay vì invalidate tất cả. Gộp các event dồn dập (debounce ~250 ms).
3. Thay `getSocket().on` bằng `useSocketEvent`, hoặc bỏ hẳn nếu layout đã xử lý event đó.
4. Socket staff: đặt khóa danh tính theo `userId`; truyền `auth` dạng callback, đọc access token mới nhất từ store mỗi lần reconnect.
5. Khi admin khóa tài khoản, đổi role hoặc gọi `logout-all`: ghi một outbox event để realtime worker `disconnectSockets` room `staff:<userId>`. Worker đã làm việc tương tự để ngắt room phiên khách trong `server/src/services/backgroundJobWorker.ts`.

**Nghiệm thu**

- Số request nền giảm khi socket khỏe (đo trong 5 phút).
- Khi mất socket, dữ liệu vẫn tự cập nhật nhờ polling.
- Làm mới token không làm socket reconnect.
- Khóa tài khoản ngắt socket trong vài giây.
- `client/src/__tests__/socket.test.ts` được mở rộng cho các hành vi trên.

### K4. Khóa rate limit và sticky session phù hợp mạng NAT của quán

**Hiện trạng**

- `guestJoinLimiter` lấy khóa là hash của `tableToken` trong body (`server/src/routes/index.ts`, dòng ~68–73). Mỗi token ngẫu nhiên có một bucket mới, nên việc thử token sai không bị giới hạn ở tầng app; chỉ còn Nginx chặn khoảng 15 request/giây mỗi IP. Token bàn đủ dài (seed dùng `randomToken(24)`) nên rất khó đoán trúng; rủi ro chính là tải lên database.
- Khóa rate limit ở Nginx lấy từ cookie `mc_guest` (`docker/nginx/default.conf`) mà không xác thực cookie. Client đổi cookie giả là có bucket mới.
- `aiLimiter` (đặt trước `loadGuest`), limiter của menu search và `guestMutationLimiter` đều khóa theo IP. Khi deploy cloud, mọi khách trong quán đi ra cùng một IP NAT, nên cả quán chung 20 lượt AI mỗi phút.
- Upstream socket dùng `hash $remote_addr consistent`. Cùng lý do NAT, mọi khách của quán dồn về một backend.

**Hướng làm**

1. Thêm limiter theo IP chỉ đếm lượt join thất bại, dùng `skipSuccessfulRequests: true` của express-rate-limit 7 (ví dụ 30 lần mỗi 10 phút).
2. Chuyển AI limiter xuống sau `loadGuest`/`requireGuest` và khóa theo `req.guest.id`; có thể thêm trần theo `tableSessionId`. Với menu search: thêm `loadGuest`, khóa theo guest đã xác thực khi có, fallback về IP.
3. Nginx: thêm một zone theo `$binary_remote_addr` làm trần thô (hai `limit_req` cùng áp dụng), đặt ngưỡng đủ cho cả quán sau NAT. Ghi cách tính ngưỡng vào `docs/deployment.md`.
4. Sticky socket của khách dùng `$guest_limit_key` (cookie, fallback IP) thay cho `$remote_addr`.

**Nghiệm thu**

- Gửi 50 token sai từ một IP thì bị 429 sau ngưỡng; token đúng không bị ảnh hưởng.
- Hai khách khác nhau dùng chung một IP có hạn mức AI riêng.
- Có unit test cho các keyGenerator.

### K5. Chính sách lưu giữ dữ liệu vận hành

**Hiện trạng**

- `OutboxEvent` không có TTL. Mỗi đơn đi hết vòng đời tạo khoảng 10 bản ghi (2 event khi tạo đơn và 2 event cho mỗi lần trong 4 lần chuyển trạng thái), chưa kể event thanh toán và phiên bàn.
- `AuditLog` chưa có chính sách lưu giữ.
- `GuestSession` và kết quả report đã có TTL.

**Hướng làm**

1. Thêm TTL partial index cho outbox đã phát: `{ publishedAt: 1 }`, `expireAfterSeconds` = 7 ngày, `partialFilterExpression: { status: 'PUBLISHED' }`. Khai báo trong model và thêm migration mới. Không xóa event `FAILED` hay `PENDING`.
2. AuditLog: chưa đặt TTL. **Cần người dùng chốt:** thời gian lưu giữ, và có cần xuất lưu trữ trước khi xóa không.
3. Trang Admin operations hiển thị số outbox theo từng trạng thái để theo dõi.

**Nghiệm thu**

- Migration chạy lại an toàn.
- `getIndexes()` cho thấy đúng các option.
- Replay event `FAILED` vẫn hoạt động.

### K6. Báo cáo tài chính lấy từ Payment/Bill thay vì Order

**Hiện trạng**

- Dashboard (`dashboardService` → `orderRepository.paidAnalytics`) gom `Order` theo `createdAt`, lọc `paymentStatus: 'PAID'`.
- Ca thu ngân dùng `Payment.paidAt`; Bill là snapshot bất biến.
- Hệ quả: đơn tạo lúc 23:50, thu tiền lúc 00:10 bị dashboard và ca thu ngân tính vào hai ngày khác nhau.
- N3 (điều chỉnh, hoàn tiền) sẽ làm lệch thêm nếu báo cáo tiếp tục đọc từ Order.

**Hướng làm**

1. Doanh thu = tổng Payment `SUCCESS` theo `paidAt` (múi giờ `Asia/Ho_Chi_Minh`), trừ các khoản hoàn tiền (khi có N3) theo thời điểm hoàn.
2. Top món và doanh thu theo món: lấy từ `bills.orders.items` theo `closedAt`. Phiên legacy chưa có Bill thì fallback về Order và ghi rõ trong response.
3. Tách rõ hai nhãn: "doanh thu thu được" (tiền) và "số đơn tạo" (vận hành).
4. Kiểm tra đã có index `paidAt` của Payment (khai báo trong model) và index cho `bills.closedAt`.

**Nghiệm thu**

- Có integration test cho đơn qua nửa đêm.
- Tổng doanh thu một ngày bằng tổng Payment của các ca trong ngày đó.
- CSV và bản in giữ đúng số.

### K7. Ranh giới module cho tầng service

**Hiện trạng:** `server/scripts/check-boundaries.ts` chỉ chặn controller import model hoặc UoW. Tầng service vẫn đọc/ghi trực tiếp model của module khác; ví dụ `paymentService.ts` import `OrderModel`, `ServiceRequestModel`, `CancelRequestModel` và `UserModel`.

**Hướng làm**

1. Lập bản đồ module → các model mà module đó sở hữu.
2. Mở rộng script ở chế độ cảnh báo để liệt kê vi phạm.
3. Chuyển dần sang repository hoặc public service của module sở hữu, chỉ khi đang sửa file đó. Không di chuyển file hàng loạt.

**Nghiệm thu:** script liệt kê được vi phạm; CI bảo đảm số vi phạm không tăng.

## 4. Nhóm N: nghiệp vụ

Người dùng đã loại hai mục khỏi phạm vi ngày 24/09/2026: N1 (tách hóa đơn, thanh toán theo từng khách) và N2 (VietQR). Không triển khai và không đề xuất lại. Thanh toán giữ nguyên hành vi hiện tại: một lần thu cho toàn bộ đơn của phiên. Mã N3, N4 giữ nguyên để khớp với các trao đổi trước.

### N3. Đền món lỗi, giảm giá, hoàn tiền (append-only)

**Hiện trạng**

- Sau khi đơn `SERVED`, không có cách nào điều chỉnh. Payment và Bill bất biến là đúng.
- Enum `REFUNDED` có trong `Order.paymentStatus`, `Payment.status` và contracts, nhưng không có code nào dùng.

**Cần người dùng chốt trước**

- Ai được duyệt: chỉ ADMIN, hay cả STAFF trong một hạn mức?
- Có cho giảm theo phần trăm không? Hạn mức tối đa là bao nhiêu?
- Hoàn tiền mặt có lấy từ két của ca hiện tại không?

**Thiết kế đề xuất**

- **Trước khi thu tiền:** thêm aggregate `Adjustment` gắn với phiên.
  - Loại `COMP` (đền món lỗi) gắn với dòng món; loại `DISCOUNT` là số tiền cố định hoặc phần trăm.
  - Mỗi bản ghi có lý do, người tạo, người duyệt và version.
  - Số phải thu = tổng đơn SERVED − tổng điều chỉnh. Bill snapshot có thêm các dòng điều chỉnh.
- **Sau khi thu tiền:** thêm aggregate `Refund` tham chiếu Payment và Bill.
  - Tổng hoàn không vượt quá số đã thu trừ số đã hoàn.
  - Gắn vào ca hiện tại như một khoản tiền ra.
  - Không đổi `Payment.status`, không sửa Bill.
- **Enum `REFUNDED`:** đề xuất không dùng trạng thái này trên Payment/Order mà tính từ các bản ghi Refund. Gỡ enum ở một bước dọn dẹp riêng, sau khi kiểm tra client.
- K6 phải trừ hoàn tiền; màn hình ca thu ngân hiển thị tiền hoàn.

**Nghiệm thu**

- Không có lệnh update nào lên Payment hay Bill đã chốt.
- Hoàn vượt số đã thu bị chặn.
- Hai người duyệt đồng thời chỉ tạo một kết quả.
- Báo cáo và ca thu ngân khớp nhau.

### N4. Trải nghiệm khách: báo giá tự động, thời gian chờ ước tính

**Hiện trạng**

- `CartPage.tsx` dùng một nút cho hai bước: bấm lần 1 gọi `/orders/quote`, bấm lần 2 mới đặt món.
- `OrdersPage` chỉ hiện trạng thái đơn, không có thời gian chờ ước tính.

**Hướng làm**

1. Tự gọi báo giá khi khách vào giỏ và mỗi khi giỏ đổi (debounce ~400 ms, hủy request cũ). Khi báo giá hợp lệ, nút chính là "Gửi đơn".
   - Giữ bước xác nhận khi nhận `QUOTE_CHANGED` hoặc giá thay đổi.
   - Giữ quy tắc idempotency key hiện tại: giỏ đổi thì dùng key mới.
2. Thời gian sẵn sàng ước tính: server tính từ số đơn đang chờ phía trước và trung vị thời gian pha gần đây (lấy từ `statusHistory`), rồi trả một con số trong DTO đơn của khách (S3).
   - Không lộ đơn của khách khác.
   - Gắn nhãn "ước tính" trên UI.

**Nghiệm thu**

- Khách chỉ cần một chạm để gửi đơn sau khi đã thấy tổng tiền.
- Giá đổi vẫn buộc khách xác nhận lại.
- `client/src/__tests__/checkout.test.tsx` được cập nhật.

## 5. Nhóm T: triển khai

### T1. Profile triển khai vừa cỡ một quán, HTTPS, xác thực datastore

**Hiện trạng**

- `compose.production.yaml` chạy 4 API, 3 worker, migrate, web, Mongo và Redis. Giới hạn RAM của các container ứng dụng cộng lại khoảng 3 GB, chưa tính MongoDB/Redis, nên không vừa một VPS nhỏ. Báo cáo hiệu năng cũng cho thấy thêm backend trên cùng một host không tăng năng lực tương ứng.
- Chưa có HTTPS; `COOKIE_SECURE` mặc định là `false`.
- Service worker (PWA) và thông báo trình duyệt chỉ chạy trên HTTPS hoặc `localhost`. Vì vậy khi demo qua `http://192.168.x.x` trên điện thoại, tính năng offline và thông báo âm thầm không hoạt động.
- MongoDB và Redis chưa bật xác thực; hiện chỉ an toàn nhờ nằm trong mạng Docker nội bộ.

**Cần người dùng chốt trước:** nơi triển khai (VPS, cloud hay máy tại quán), tên miền, ngân sách. Không tạo tài nguyên có phí.

**Hướng làm**

1. Tạo Compose profile `small`: 1 API `TRAFFIC_CLASS=unified` (relay outbox chạy trong API), 1 worker `WORKER_ROLE=all`, Mongo, Redis, Nginx. Giữ topology hiện tại làm profile `scale-demo`. Ghi bảng RAM/CPU của từng profile.
2. TLS:
   - Có tên miền: dùng Let's Encrypt.
   - Demo LAN: dùng `mkcert`, nếu người dùng chấp nhận cài CA lên điện thoại.
   - Sau khi có TLS: đặt `COOKIE_SECURE=true`, bật HSTS, cập nhật `PUBLIC_APP_URL`, `STAFF_APP_URL`, `ADMIN_APP_URL`.
3. Xác thực datastore:
   - Mongo: bật `--auth` kèm keyFile (replica set có auth bắt buộc keyFile), tạo user ứng dụng với quyền tối thiểu.
   - Redis: `requirepass` hoặc ACL.
   - Truyền secret qua env file không commit, hoặc Docker secrets.
4. Backup: lịch backup trên Linux tương đương `scripts/db/backup.ps1`, có bản sao ngoài máy, và drill restore định kỳ theo `docs/backup-restore-runbook.md`.

**Nghiệm thu**

- Profile `small` chạy healthy và đi hết luồng QR → receipt.
- PWA và thông báo hoạt động trên HTTPS.
- Kết nối Mongo/Redis không kèm credential bị từ chối.

## 6. Nhóm V: dọn dẹp

### V0. Commit phần việc đang chờ (chỉ khi người dùng đồng ý)

- Worktree có khoảng 94 file thay đổi hoặc chưa track thuộc A1–D1. Đề nghị người dùng commit theo nhóm logic (outbox/worker, receipt/quote, migration/backup, chức năng C1–C7, docs) rồi push để CI chạy.
- Repo đang nằm trong thư mục OneDrive. Việc đồng bộ `.git` và `node_modules` có thể gây xung đột; gợi ý người dùng cân nhắc chuyển repo ra một thư mục không đồng bộ. Không tự di chuyển repo.

### V1. Tài liệu lệch với code, code chết

- `docs/architecture-decisions.md` có hai mục `AD-013`. Đổi một mục thành `AD-013B`, đề xuất chọn mục tách pool Guest/Internal ở dòng ~149 vì nó nằm lệch thứ tự. Grep cho thấy không có tham chiếu nào khác ngoài ghi chú trong hướng dẫn cũ. ADR mới bắt đầu từ `AD-019`.
- `AD-001` vẫn ghi receipt được tính từ Order; thực tế đã chuyển sang Bill từ AD-016.
- `docs/architecture.md` ghi React Router DOM v6, trong khi `client/package.json` dùng 7.18.x.
- `requireOpenTableSession` trong `server/src/middlewares/guest.ts` là middleware không làm gì. Kiểm tra không còn nơi nào dùng rồi xóa.
- `/categories` và `/products` dùng chung handler `menu.listMenu`. Giữ cả hai để tương thích và ghi chú trong OpenAPI.
- Enum `REFUNDED`: xử lý theo quyết định ở N3.

## 7. Tùy chọn: chỉ làm khi người dùng yêu cầu

- **O1.** Giao diện khách song ngữ vi/en, gồm cả bản dịch tên và mô tả món.
- **O2.** Upload ảnh món thay cho URL Unsplash: kiểm tra loại và kích thước file, resize sang WebP, lưu trên volume hoặc object storage, phục vụ qua Nginx có cache.
- **O3.** In phiếu bếp và hóa đơn khổ 58/80 mm, bằng CSS in hoặc một agent ESC/POS cục bộ.
- KDS theo từng món hoặc từng quầy vẫn để sau, như kế hoạch trước.

## 8. Bàn giao mỗi mục

1. Ghi ngắn trước khi sửa: vấn đề, hành vi mong muốn, API/data thay đổi, các race có thể xảy ra, và phương án tương thích.
2. Với mục S: viết test tái hiện lỗi (test đỏ) trước, rồi sửa cho test xanh.
3. Chạy các lệnh kiểm tra phù hợp với phạm vi. Không tắt lint rule hay nới kiểm tra quyền để test qua.
4. Sau khi đã kiểm chứng, cập nhật `PROJECT_MEMORY.md`, `docs/test-report.md`, `docs/upgrade-progress.md`, và thêm ADR nếu có quyết định kiến trúc.
5. Ghi kết quả theo mẫu:

```text
Hạng mục: S1 / K1 / N3 / ...
Trạng thái: chưa làm / đang làm / hoàn thành / vướng quyết định
Hành vi đã thay đổi:
File và API/schema liên quan:
Migration và cách rollback:
Kiểm thử đã chạy, kết quả, môi trường:
Ca chưa chạy hoặc bị skip, lý do:
Hạn chế còn lại:
Tài liệu đã cập nhật:
```

## 9. Checklist

- [ ] V0: Người dùng đã commit phần A1–D1 (hoặc xác nhận làm tiếp khi chưa commit).
- [x] S1: Feed KDS chỉ gồm đơn của phiên active; response không tăng theo lịch sử.
- [x] S2: Request cùng key chạy đồng thời trả replay; không tạo đơn hay payment trùng.
- [x] S3: DTO đơn cho khách và staff; không lộ field nội bộ.
- [x] S4: Có gzip, header bảo mật, CSP đã enforce và Playwright đạt.
- [ ] K1: Menu trả body đã cache kèm ETag, có micro-cache, có số đo mới.
- [ ] K2: Có metric retry transaction, có backoff nếu cần, có benchmark sát thực tế.
- [ ] K3: Polling thích ứng; socket staff ổn định qua lần làm mới token; khóa tài khoản ngắt socket.
- [ ] K4: Limiter join đếm lần thất bại; AI/search khóa theo khách; sticky socket theo cookie.
- [ ] K5: TTL cho outbox `PUBLISHED`; có quyết định về lưu giữ audit.
- [ ] K6: Báo cáo tiền lấy từ Payment/Bill, khớp với ca thu ngân.
- [ ] N3: Điều chỉnh và hoàn tiền dạng append-only (nếu được duyệt).
- [ ] N4: Báo giá tự động và thời gian chờ ước tính.
- [ ] K7: Script ranh giới module cho service ở chế độ cảnh báo.
- [ ] T1: Profile `small`, HTTPS, xác thực datastore (khi người dùng quyết định deploy).
- [ ] V1: Tài liệu khớp với code; đã xóa code chết.
