# Bộ nhớ dự án — Mây Café

Cập nhật: 23/09/2026.

## Ý định và phạm vi của người dùng

- Đây là bài tập lớn Lập trình Web cho một quán cà phê.
- Yêu cầu gần nhất: hoàn thiện luồng hiện có, sau đó tạo file Markdown để ghi nhớ dự án.
- Ưu tiên quy trình QR → vào bàn → chọn/AI gợi ý món → đặt món → pha chế → thanh toán → hóa đơn → đánh giá.
- Không tự mở rộng thành nhiều chi nhánh, giao hàng, quản lý kho nguyên liệu hay thanh toán online.
- Link tham khảo người dùng cung cấp: https://claude.ai/code/artifact/717f123b-c0bd-4b23-9671-59cf4faf0f99
- Chưa đọc được artifact: công cụ web không mở được URL, runtime Browser không có browser khả dụng. Không coi giao diện đã được đối chiếu với mẫu.

## Kiến trúc cần nhớ

- npm workspaces: client (React/Vite/TypeScript), server (Express/Mongoose/TypeScript), packages/contracts (Zod).
- MongoDB phải chạy replica set để dùng transaction; compose.yaml đã có cấu hình.
- Khách không đăng ký tài khoản. Mỗi thiết bị có participantId riêng trong tableSession.
- Staff xử lý và thu tiền chung theo phiên bàn; khách chỉ xem đơn/hóa đơn của thiết bị mình.
- Socket.IO dùng room staff, session:<sessionId>, guest:<sessionId>:<participantId>.
- Backend là nơi quyết định giá, trạng thái và quyền truy cập.

## Những gì đã hoàn thiện trong lần này

### Vào bàn và QR

- GET /staff/tables cho STAFF/ADMIN, chỉ trả thông tin bàn cần dùng. Sửa lỗi trang staff gọi API chỉ cho admin.
- GET /table-sessions/current trả tên/mã bàn, trạng thái OPEN/CHECKOUT; sau đóng phiên trả receiptAvailable.
- Quét lại cùng bàn khi phiên còn hiệu lực giữ participantId để không mất quyền xem các đơn trước.
- JoinPage nhận token hoặc URL chứa /t/<token>, xóa cache dữ liệu phiên trước và gắn giỏ đúng phiên.
- AdminTables tạo ảnh QR bằng qrcode, có tải PNG. Token được đổi thủ công; ảnh chỉ hiển thị sau thao tác đổi token.
- Cookie mặc định host-only; .env.example để COOKIE_DOMAIN trống, dùng Vite proxy cho API/socket.
- Khách quét QR khi bàn trống thì server tự mở phiên (`ensureActiveSession`): phiên có `source:'GUEST'`, ghi audit `tableSession.autoOpened`, đẩy realtime cho Staff, idempotent và chống đua bằng cách bắt lỗi E11000 rồi đọc lại phiên vừa tạo, nên hai khách quét cùng lúc vẫn về chung một phiên.
- POST /table-sessions/join trả thêm `created` (true khi phiên vừa được mở); 403 chỉ còn khi `GUEST_AUTO_OPEN=false` và bàn chưa có phiên.
- Staff "Mở bàn" trên bàn đã có phiên trả về phiên hiện hữu với `created:false` thay vì 409 như trước.
- Trang staff hiện badge "Tự mở" cho phiên do khách mở.

### Phiên tự mở rỗng

- `server/src/services/idleSessionSweeper.ts` chạy mỗi 5 phút trong `server.ts`, đóng phiên `OPEN` + `source:'GUEST'` không có đơn nào ngoài CANCELLED quá `SESSION_IDLE_TIMEOUT_MIN` phút.
- Mặc định hết hạn sau 60 phút; `0` là tắt hẳn sweeper. Phiên bị đóng có `closedReason:'IDLE'`, thu hồi guest session và ghi audit `tableSession.idleClosed`.

### Đặt món, AI và pha chế

- Server từ chối size hết bán, thiếu size khi món có variants, topping không thuộc món và topping bị lặp.
- Lưu toppingNamesSnapshot trên order item; KDS hiển thị tên bàn và tên topping.
- ProductDetailModal chọn mặc định đường/đá hợp lệ, không cho chọn topping/variant đã hết.
- CartPage giữ Idempotency-Key khi thử lại sau lỗi mạng/5xx với cùng payload; khóa chỉnh giỏ trong lúc gửi.
- Khóa thao tác gửi đơn khi bàn CHECKOUT. Backend vẫn kiểm tra độc lập.
- Transaction đặt đơn ghi lên tableSession để tránh chạy đồng thời với đóng/chuyển phiên.
- KDS khóa nút khi đang chuyển trạng thái; có hủy đơn ở PENDING/CONFIRMED.
- AI có ô ngân sách và chọn không caffeine/không sữa; fallback hiểu một số mẫu tiếng Việt.
- AI lọc menu/variant khả dụng và điều kiện bắt buộc; không tự trả món trái ràng buộc khi không có kết quả.
- Chọn món AI mở bảng tùy chỉnh trước khi thêm giỏ.
- Trang menu có tìm kiếm tiếng Việt qua `POST /menu/search`: hỗ trợ không dấu/typo giới hạn, nhóm món, vị/ít ngọt, budget mỗi món (`dưới` khác `không quá`) và điều kiện caffeine/sữa. Backend lọc/xếp hạng menu thật; UI debounce 350 ms, hủy request cũ, hiện intent và cho sửa bộ lọc rồi mở lại `ProductDetailModal`.
- `không cà phê` chỉ loại nhóm cà phê, không đồng nghĩa `không caffeine`; metadata thiếu không được coi là đáp ứng `không caffeine`/`không sữa`. Search hiện luôn ghi `mode: fallback`; chưa chạy LLM live.

### Realtime và yêu cầu phục vụ

- Socket khách xác thực bằng cookie HttpOnly do browser gửi, không đọc document.cookie.
- Server phát sự kiện sau đặt/hủy/chuyển đơn, thay đổi phiên, thanh toán, yêu cầu phục vụ và cập nhật menu.
- Socket staff kiểm tra tài khoản còn hoạt động và vai trò.
- Hook useSocketEvent giữ đăng ký cả khi socket được tạo sau component hoặc tạo lại.
- Layout làm mới query sau sự kiện và khi kết nối lại; polling còn giữ làm phương án dự phòng.
- Khách có nút gọi nhân viên; trang yêu cầu hiển thị tên bàn.
- Đóng phiên/nghỉ bàn ngắt socket tương ứng. Thu tiền đóng luôn các yêu cầu phục vụ còn mở.

### Thanh toán, hóa đơn, đánh giá

- Staff chuyển bàn CHECKOUT → mở hộp kiểm tra món/tổng tiền → chọn CASH/BANK_TRANSFER/OTHER → xác nhận đã nhận đủ tiền.
- Chuyển khoản vẫn do nhân viên tự kiểm tra; chưa có cổng thanh toán/webhook.
- Sửa lỗi frontend luôn gửi amount=0.
- Server yêu cầu CHECKOUT, tất cả món đã SERVED/CANCELLED, số tiền khớp tổng chưa trả.
- Cùng payment key và cùng dữ liệu trả lại giao dịch cũ; đổi dữ liệu với key cũ trả 409.
- Query hóa đơn/thanh toán lấy toàn bộ đơn trong phiên, không cắt ở giới hạn phân trang 100.
- Đóng phiên trực tiếp chỉ được khi không còn đơn chưa thanh toán; hỗ trợ bàn không gọi món hoặc hủy hết đơn.
- Thu hồi quyền đặt món trong cùng transaction thanh toán.
- Cookie mc_receipt là token độc lập, lưu hash receiptTokenHash trong GuestSession; chỉ cấp quyền xem hóa đơn và đánh giá sau CLOSED.
- GET /receipts/current chỉ trả đơn SERVED/PAID của chính participant; POST /receipts/orders/:id/review kiểm tra ownership và đánh giá một lần.
- Trang /receipt hiển thị chi tiết, tổng tiền, in bằng trình duyệt, form 1–5 sao/nhận xét và trạng thái đã đánh giá.
- Admin có trang /admin/reviews: danh sách đánh giá, điểm trung bình, phân bố 1–5 sao, lọc theo số sao/ngày và phân trang 20 mục. API GET /admin/reviews chỉ cho ADMIN.
- Receipt hết hạn theo GuestSession (12 giờ kể từ join), bị xóa quyền khi rời bàn. Không dùng để gọi thêm món hay mở socket.
- GuestSession cũ từ trước thay đổi chưa có receiptTokenHash: rời bàn và vào một phiên mới để demo trọn luồng.
- Phiên khi thu tiền được chốt thành snapshot `Bill` bất biến: unique theo `tableSessionId`, không có API sửa/xóa, ghi trong cùng transaction với payment và việc đóng phiên (`closedReason:'PAID'`); response payments trả thêm `billId`.
- GET /staff/table-sessions/:id/bill đọc snapshot cho phiên đã đóng, fallback tính động cho phiên cũ chưa có Bill.
- GET /receipts/current đã bỏ field nội bộ (`idempotencyKey`, `requestHash`, `statusHistory`, `version`, `__v`) và dùng `Bill` snapshot bất biến; chỉ phiên legacy chưa có Bill mới fallback về `Order`.
- Phiên `CLOSED` không chặn phiên mới: partial unique index `one_active_session_per_table` chỉ áp cho OPEN/CHECKOUT.

## Các file trọng tâm

- server/src/routes/index.ts
- server/src/controllers/{tableSessionController,orderController,paymentController,receiptController}.ts
- server/src/services/{orderService,paymentService,tableSessionService,aiService}.ts
- server/src/models/Bill.ts, server/src/repositories/billRepository.ts, server/src/services/idleSessionSweeper.ts
- server/src/middlewares/guest.ts
- server/src/realtime/socket.ts
- client/src/lib/socket.ts
- client/src/layouts/{GuestLayout,StaffLayout}.tsx
- client/src/features/staff/{Tables,KDS,ServiceRequests}.tsx
- client/src/features/guest/{JoinPage,CartPage,ProductDetailModal,ReceiptPage}.tsx
- client/src/features/ai/AISheet.tsx
- client/src/features/admin/Tables.tsx

## Kiểm chứng gần nhất — 22/09/2026

- Typecheck server + client + contracts: PASS.
- Lint server + client: PASS, không còn lỗi/cảnh báo và không tắt rule để che lỗi.
- Unit server: 58/58 PASS; client: 14/14 PASS; integration server: 28/28 PASS.
- Production build: PASS; Vite còn cảnh báo bundle JS chính 989,87 kB (gzip 291,75 kB).
- Refresh access token staff đã có single-flight, retry một lần, kiểm soát race logout; có 6 test client chuyên biệt.
- Auth/payment contract dùng chung đã được cả client và server tiêu thụ; requestId client được kiểm tra định dạng/độ dài.
- P2 production-local đã được build và chạy bằng Docker Engine 29.7.2: project riêng `maycafe-production` có MongoDB/Node/Nginx healthy; Nginx publish Guest `8080`, Staff `8081`, Admin `8082`. Frontend, deep-link, API, readiness và WebSocket cùng-origin đã được kiểm tra.
- P3 observability đã hoàn thành production-local: Node.js 24 LTS, structured log không trùng Morgan, Prometheus metrics nội bộ, Admin `/admin/operations`, nhãn route cardinality-safe và payment replay không tăng counter. Lỗi kiểm soát `p3-controlled-error` đã đối chiếu log/dashboard.
- P4A search đã hoàn thành local: 25/25 unit (13/13 Top-1, 12/12 ràng buộc) và integration API qua MongoDB tạm đạt; kết quả fallback/live được ghi riêng trong `docs/ai-evaluation.md`.
- P4B đã hoàn thành local: scheduler detector cho HTTP error/p95, preparation p95 và cancellation rate; baseline/min-sample/threshold cấu hình, alert MongoDB dedupe+cooldown, AI/fallback explanation, ADMIN ACK/CLOSE có audit. HTTP window còn là instance-local nên chưa dùng cho multi-instance trước P5.
- Luồng container đã PASS trên volume riêng: seed → QR join → order → pha chế → checkout → payment → Bill → receipt; graceful SIGTERM exit 0 khoảng 0,5 giây và restart healthy. Chưa deploy cloud/HTTPS và chưa gọi đây là high availability.
- E2E curl 14/14 bên dưới là lịch sử ngày 17/09. Playwright production build đã được chạy mới ngày 22/09 và đạt 9/9 ở ba viewport; xem phần P5/P6 cuối file.
- Integration server mới nhất: 42/42 PASS trên MongoMemoryReplSet thật.
- `server/vitest.config.ts` phải tách mỗi file test sang process riêng (`isolate: true`, `singleFork: false`, `maxForks: 1`): nhiều file test dùng chung một mongoose instance gây `OverwriteModelError`.
- E2E curl trên server thật + MongoDB thật: 14/14 PASS — join bàn trống 200 `created:true` → đặt đơn 201 → thu tiền 201 kèm `billId` → gọi lại 200 cùng `billId` → quét lại QR ra phiên mới rồi đặt đơn 201; cookie cũ 401; receipt không lộ field nội bộ.
- Browser QA: PASS — khách vào thẳng `/menu` thấy tên bàn và đặt được đơn qua UI; trang staff hiện badge "Tự mở".
- Test bao phủ thêm: tự mở phiên + audit khi quét QR bàn trống, replay thanh toán kèm `billId`, đóng phiên rồi mở phiên mới, sweeper idle đóng phiên + thu hồi guest session.
- Test unit/server, UI client, integration, lint, typecheck và build đã được chạy lại ngày 22/09/2026 như số liệu phía trên.
- AI live đã được gọi thử có giới hạn nhưng provider từ chối key với HTTP 401; chỉ fallback/ràng buộc nội bộ được xác nhận đạt, chưa có kết quả LLM live hợp lệ.
- Integration dùng database tạm riêng; riêng E2E thủ công có tạo dữ liệu thật trong DB demo (xem mục "Việc còn lại và ranh giới").
- `npm audit` hiện 0 vulnerability sau khi nâng Vite 8, Vitest 5, React Router 7 và UUID 14; không dùng `npm audit fix --force`.

## Chạy và demo

1. npm ci
2. Tạo server/.env từ .env.example, cấu hình MongoDB replica set.
3. npm run db:up → npm run db:wait → npm run seed (seed chỉ dành cho dữ liệu demo; có thể thay dữ liệu hiện tại).
4. `npm run dev` dùng portal hợp nhất tại `5173`; production-local tách Guest `8080`, Staff `8081`, Admin `8082` qua cùng Nginx.
5. Admin vào Bàn & QR, đổi token và tải ảnh QR.
6. Khách quét QR/vào link để tự mở phiên → chọn món hoặc hỏi AI → giỏ → gửi đơn.
7. Staff vào Bàn & phiên và thấy phiên mới xuất hiện realtime, không cần mở bàn trước.
8. KDS: nhận → đang pha → sẵn sàng → đã phục vụ.
9. Khách yêu cầu thanh toán; staff chuyển CHECKOUT → kiểm tra & thu tiền → xác nhận số tiền đã nhận.
10. Khách tự chuyển /receipt → xem/in hóa đơn → đánh giá.
11. Có thể thử hai browser profile/thiết bị cùng bàn để kiểm tra phân tách đơn.

Demo LAN: PUBLIC_APP_URL phải là địa chỉ frontend mà điện thoại truy cập (ví dụ http://192.168.1.10:5173); COOKIE_DOMAIN để trống; VITE_API_BASE_URL=/api/v1 và VITE_SOCKET_URL=/ dùng proxy. Khởi động lại server/client khi đổi env. Không đưa secret vào file này.

Biến môi trường mới trong `.env.example`: `GUEST_AUTO_OPEN=true` (cho khách tự mở phiên khi quét QR bàn trống) và `SESSION_IDLE_TIMEOUT_MIN=60` (số phút trước khi sweeper đóng phiên khách bỏ trống; `0` là tắt sweeper). Muốn rollback hành vi tự mở phiên chỉ cần đặt `GUEST_AUTO_OPEN=false` — không phải revert code.

## Việc còn lại và ranh giới

- Playwright tự động ở 375/768/1440 đã đạt; PWA reload offline đã có smoke test. Còn quét ảnh QR/camera thật, kiểm tra trực quan thủ công và chạy ca browser hai thiết bị trên backend production-local khi Docker hoạt động.
- Lint hiện đạt 0 lỗi/cảnh báo. Route-level lazy loading giữ entry client ở 389,20 kB (gzip 118,78 kB); chunk lớn nhất là Dashboard 384,70 kB (gzip 102,48 kB), đều dưới ngưỡng 500 kB.
- Dashboard đã có lọc ngày, CSV và in/lưu PDF; aggregation không còn cắt ở 100 đơn. Lịch sử đơn admin, voucher và upload ảnh là mở rộng sản phẩm ngoài luồng cốt lõi hiện tại.
- Đã triển khai tự refresh access token staff ở frontend; access token vẫn chỉ giữ trong memory, refresh token ở cookie HttpOnly.
- Không xem docs cũ hay số lượng tính năng trong README là bằng chứng đã test: ưu tiên file này và docs/test-report.md.
- Index tableSession mới one_active_session_per_table bảo đảm chỉ một OPEN/CHECKOUT mỗi bàn. Với DB cũ có dữ liệu trùng phiên hoạt động, cần xử lý dữ liệu trước khi tạo index; không tự xóa dữ liệu.
- Phiên bản API OpenAPI đã bổ sung staff tables và receipt endpoints. Contracts chung hiện bao phủ thêm join/current table session và request chuyển trạng thái; vẫn chưa chuẩn hóa mọi response quản trị cũ.
- E2E thủ công 17/09/2026 đã tạo dữ liệu thật trong DB demo: bàn `B03` đã thu tiền, bàn `B04` còn 1 đơn PENDING `MCX29XD` kèm phiên mới do auto-open. Người dùng tự dọn nếu cần; không tự xóa dữ liệu.
- Các câu hỏi §11 của issue đã chốt: Q1 mặc định `GUEST_AUTO_OPEN=true` kèm công tắc; Q2 bật idle timeout 60 phút; Q3 vẫn cho nhiều guest session song song theo thiết bị (giữ nguyên); Q4 `Bill` là nguồn cho cả staff bill và `/receipts/current`, có fallback legacy; Q5 không thêm van "xác nhận đơn đầu tiên".
- Các finding khác trong `audit_2026-09-16.md` §12 nằm ngoài phạm vi issue này, mới chỉ ghi nhận chứ chưa sửa.

## Nguồn đã tra cứu khi triển khai

- qrcode API và Promise toDataURL: https://github.com/soldair/node-qrcode
- Socket.IO client options/cookies: https://socket.io/docs/v4/client-options/

## Cập nhật P5/P6 mới nhất — 22/09/2026

Phần này thay thế các ghi chú cũ nói P5/chạy responsive/load/AI live chưa thực hiện.

- Baseline P5 ngày 22/09 dùng Nginx + `server-a` + `server-b` + `worker-1`; số tải/failover bên dưới thuộc topology cũ này. Source production hiện dùng hai pool `server-guest-a/b`, `server-internal-a/b` và ba role `worker-scheduler/realtime/report`; stack runtime cũ cần recreate để nhận topology mới.
- Failover local: 20/20 request qua B khi A dừng, tối đa khoảng 1.036 ms. Redis outage để read menu hoạt động, readiness `degraded`, mutation không tự bỏ limiter. Đây không phải HA cả máy/cloud.
- Load test k6 dùng DB `maycafe_benchmark`, 200 sản phẩm. Menu fixed hai backend đạt cao nhất 90 RPS (p95 96,48 ms); 100 RPS p95 3,26 s; ramp 600–700 không đạt. Guest 20 VU/60 s có 0 lỗi nhưng write p95 4,15 s nên không đạt ngưỡng. Realtime 100/100, connect p95 324,05 ms.
- Load test phát hiện `dropDatabase()` của benchmark seed xóa unique index và cho tạo nhiều phiên active. Seed nay import mọi model + `syncIndexes()` trước dữ liệu; `check:benchmark` xác nhận đúng một active session, không trùng idempotency key, sai tổng hay trạng thái. Không dùng kết quả trước sửa làm bằng chứng.
- Playwright production build đạt 9/9 ở 375×812, 768×1024 và 1440×900 cho join/login/menu sau link QR mô phỏng; không tràn ngang/page error. Camera/in QR thật vẫn để test sau theo yêu cầu người dùng.
- GitHub CI nằm ở `.github/workflows/ci.yml`, dùng Node 24/npm ci và chạy audit, lint, typecheck, server/client tests, integration, build và browser smoke. Run #1 trên commit `b61a8f0` đã PASS cả ba job.
- AI live smoke đã thử 3 recommendation + 1 anomaly explanation với key trong `apikey.txt`, provider trả 401 cả bốn. Fallback an toàn hoạt động; key bị từ chối phải thay trước khi gọi AI live là đạt. `apikey.txt` bị Git ignore; logger không ghi provider error body.
- Báo cáo nguồn chuẩn: `docs/performance-report.md`, `docs/test-report.md`, `docs/deployment.md`, `docs/upgrade-progress.md`, `docs/ai-evaluation.md`.
- Cloud chưa deploy. Cần người dùng chốt provider/account có quyền, region, ngân sách, domain/DNS, Mongo/Redis managed hay tự quản, secrets production và quyền repo cho CD. Không tự tạo tài nguyên có phí.

## Điểm tiếp tục ở phiên làm việc sau

### Cập nhật cải tiến còn lại — 23/09/2026

- Client dùng lazy route; entry production giảm từ khoảng 990 kB xuống 389,20 kB (gzip 118,78 kB), không còn cảnh báo chunk >500 kB.
- PWA production có manifest/service worker, precache theo Vite asset manifest, reload offline đạt; API và Socket.IO không bao giờ được cache. UI báo mất mạng/kết nối lại và giỏ vẫn persist để người dùng tự thử gửi lại.
- Dashboard hỗ trợ khoảng ngày, CSV và in/PDF. Backend dùng MongoDB `$facet` trên toàn bộ đơn PAID, nhóm theo `Asia/Ho_Chi_Minh`; integration 105 đơn khóa hồi quy giới hạn phân trang cũ.
- Contracts chung bổ sung join/current table session và request transition. Script root build contracts trước dev/typecheck/test để checkout sạch và CI không phụ thuộc `dist` cũ.
- Vite 8.3.0, Vitest 5.0.1, React Router 7.18.4 và UUID 14.0.2; `npm audit` 0 vulnerability. Vitest config đã đổi khỏi `poolOptions` bị loại bỏ.
- CI có thêm audit và browser smoke production frontend. Playwright có 11 ca; production-local ba portal đạt 7 ca độc lập dữ liệu, skip 4 ca cần `E2E_TABLE_TOKEN`; offline reload đạt.
- Kiểm tra local mới nhất: lint PASS, typecheck PASS, server 67 unit/client 17/integration 42 PASS, build PASS, Compose config PASS, Playwright trên build mới 7 PASS/4 SKIP. Chưa chạy lại benchmark k6 đầy đủ.
- Production-local tách Guest `8080`, Staff `8081`, Admin `8082` trên cùng Nginx. Proxy chặn route/API gọi chéo; CORS/Socket cho phép đúng ba origin và refresh-cookie Staff/Admin tách tên để đăng nhập đồng thời.
- Traffic `8080` chỉ vào pool Guest; `8081/8082` chỉ vào pool Internal. Bốn API container có CPU/RAM limit; Internal dùng `cpu_shares=1536`, Guest `512`. Health API trả `trafficClass` để smoke routing. Nginx dùng Docker DNS `resolve` động để không giữ IP container cũ sau recreate; app-level guard chặn gọi chéo ngay cả khi bypass proxy.
- Guest được giới hạn hai lớp: Nginx burst/connection trả 429 và shared Redis limiter theo token/phiên bàn (join 20/phút, order 12/phút, service request 6/phút mặc định). Menu public cache Redis 60 giây và invalidation bằng generation khi Admin sửa catalog.
- Worker xử lý queue ưu tiên thông báo realtime trước report, hỗ trợ retry/dead-letter; Admin dashboard và CSV dùng report job async. Smoke local đã xác nhận JSON/CSV `COMPLETED`, realtime queue drain sạch và burst 100 request trả 200/429, không còn 503.

- Xem mục “Cập nhật P5/P6 mới nhất” và `docs/upgrade-progress.md` trước; không chạy lại benchmark nặng nếu không có thay đổi liên quan hiệu năng.
- Production-local hiện đang chạy healthy trên ba portal `8080`/`8081`/`8082`; Mongo/Redis, bốn API pool, web healthy và worker đang chạy. Health, login, cookie isolation, pool routing, worker jobs, rate limit và ma trận route/API đã smoke PASS ngày 23/09/2026.
- Container web của project `maycafe-benchmark` đã dừng để nhường cổng `8081`; Mongo/Redis và volume benchmark không bị xóa, có thể khởi động lại với cổng khác.
- Việc cần người dùng cung cấp tiếp: key AI hợp lệ nếu muốn test live; hoặc lựa chọn cloud/account/region/budget/domain nếu muốn deploy thật. Không yêu cầu lại camera/in QR cho tới khi người dùng muốn thực hiện bước đó.
- Toàn bộ P1–P7 đã commit/push lên `main`; GitHub Actions run #1 (`35807566033`) PASS cả quality/build, integration và production frontend browser smoke.
- Không ghi hoặc in nội dung `apikey.txt`. File này và `.cache/load` đang được Git ignore.

## Cập nhật cải tiến A1 — 23/09/2026

- Đã thêm `OutboxEvent` trong MongoDB và relay chạy ở worker. Relay claim bằng lease, retry exponential có giới hạn, giữ cùng `eventId` khi enqueue Redis và chỉ đánh dấu `PUBLISHED` sau khi queue nhận thành công.
- Order create/cancel/transition, payment, table-session open/reopen/transition/idle-close và service-request create/resolve nay ghi business state, audit và realtime outbox trong cùng transaction. Controller không còn tự phát notification sau commit cho các luồng này.
- Payment/đóng phiên phát event tới room khách rồi consumer mới ngắt socket; khách vẫn nhận `payment.confirmed` trước khi mất kết nối. At-least-once được chấp nhận, nên event có thể trùng khi worker dừng đúng khoảng enqueue/mark.
- `npm run dev` nay chạy thêm worker. API `TRAFFIC_CLASS=unified` có relay cùng process để dev/test vẫn hoạt động; khi Redis không sẵn sàng nhưng Socket.IO local tồn tại, relay phát trực tiếp từ bản ghi outbox.
- Config mới: `OUTBOX_POLL_MS`, `OUTBOX_BATCH_SIZE`, `OUTBOX_LEASE_MS`, `OUTBOX_MAX_ATTEMPTS`, `OUTBOX_RETRY_BASE_MS`, `OUTBOX_RETRY_MAX_MS`.
- Kiểm tra local sau thay đổi: lint PASS, typecheck PASS, server unit 61/61, client 15/15, integration 30/30, production build PASS. Integration có ca ép rollback chứng minh TableSession/AuditLog/OutboxEvent cùng rollback và ca replay chứng minh không sinh thêm event.
- Ghi chú lịch sử này đã được thay thế bởi đợt hoàn tất A1–D1 bên dưới.

## Hoàn tất kế hoạch A1–A3, B1–B4, C1–C7, D1 — 23/09/2026

- Outbox/audit đã bao phủ mutation catalog và availability; Admin operations xem/replay outbox `FAILED` và Redis dead-letter có audit.
- Production tách `worker-scheduler`, `worker-realtime`, `worker-report`; queue dùng atomic claim + owner lease/renew/ACK, reclaim, backoff, dead-letter/replay; scheduler có leader lease, worker heartbeat/progress và telemetry tuổi queue/Redis memory. Redis drill đạt isolation report/realtime, foreign ACK, reclaim và replay.
- Realtime event có envelope ID/schema/entity/version/time; client dedupe bounded, bỏ version cũ và refetch khi reconnect.
- Order dùng quote ký HMAC và một pricing service chung; receipt dùng Bill snapshot bất biến với fallback legacy.
- Module boundary lint chặn controller import model/UoW. Production tắt auto-index; migration runner build có lock/checksum/preflight và được Compose gate trước API/worker.
- Đã thêm KDS SLA, staff availability, Admin bill history/reprint, cancel approval, chuyển bàn, cash shift reconciliation, AI evidence + final configuration validation cùng API/UI/test.
- MongoDB 7 drill: cả 3 migration apply rồi skip idempotent; backup/restore 4 business document và migration state, 0 Bill trùng phiên, 0 Payment mồ côi, đủ index bắt buộc. Biên bản ở `docs/restore-drill-2026-09-23.md`.
- Quality gate cuối: lint/typecheck/build/audit/Compose PASS; server 67/67, client 17/17, integration 42/42. E2E trên production frontend mới đạt 7 PASS/4 SKIP; bốn ca cần token bàn không được tính PASS.

## Sửa lỗi S1–S4 theo `claude_de_xuat.md` — 24/09/2026

- Kế hoạch mới nằm ở `claude_de_xuat.md`; người dùng đã loại N1 (tách hóa đơn theo khách) và N2 (VietQR).
- S1: `GET /staff/orders` chỉ trả đơn PENDING..READY của phiên OPEN/CHECKOUT (`orderService.listOrdersForStaff`); trước đó trả mọi đơn SERVED từ trước tới nay.
- S2: đặt món và thanh toán gặp request cùng Idempotency-Key vượt qua bước kiểm tra trước sẽ trả replay (đơn: bắt 11000 trên `idempotencyKey`; payment: kiểm lại key khi transaction lỗi). Trùng mã đơn thì sinh mã mới. Giỏ hàng chỉ đổi key khi server trả `IDEMPOTENCY_CONFLICT`.
- S3: DTO `guestOrderSchema`/`staffOrderSchema` trong contracts, serializer `server/src/services/orderDto.ts`; API đơn không còn trả `idempotencyKey`, `requestHash`, `__v`; khách không thấy ID nhân viên trong `statusHistory`.
- S4: Nginx bật gzip, header bảo mật và CSP enforce qua `docker/nginx/maycafe-security-headers.inc` (chỉ cho location SPA); `index.html`/`sw.js` no-cache. `img-src` cho mọi `https:` vì ảnh món là URL admin nhập.
- Kiểm chứng: lint/typecheck/build PASS; server 67/67, client 19/19, integration 46/46; E2E 7 PASS/4 SKIP; duyệt ba portal 0 vi phạm CSP.
- Production-local đã dựng lại từ source hiện tại ngày 24/09/2026 theo topology mới (API guest/internal A/B, `worker-scheduler/realtime/report`, migrate); container `worker` cũ đã gỡ. Migration 001–003 áp dụng rồi skip khi chạy lại; số document nghiệp vụ không đổi (101 đơn, 43 payment, 2 bill). Backup trước nâng cấp: `.cache/backup/maycafe-20260924-002643.archive.gz` (SHA-256 `35958d84…31fc6`).
- JWT secret của production-local nằm trong `.env` ở thư mục gốc (bị Git ignore, tạo ngày 24/09/2026 từ giá trị stack đang chạy). `docker compose -f compose.production.yaml up -d` tự đọc file này; không xóa hay đổi giá trị nếu không muốn mọi phiên staff/admin hết hiệu lực. Không in nội dung file.
- Lỗi phát hiện khi chạy stack mới: trang Admin → Hóa đơn gửi bộ lọc rỗng và bị 422. Đã sửa `billHistoryQuerySchema` coi chuỗi rỗng là không lọc; unit test `billHistoryQuery.test.ts`. Server unit nay 69/69.
