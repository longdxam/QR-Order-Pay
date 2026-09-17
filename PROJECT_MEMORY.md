# Bộ nhớ dự án — Mây Café

Cập nhật: 17/09/2026.

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
- Khách quét QR khi bàn trống thì server tự mở phiên (`ensureActiveSession`): phiên có `source:'GUEST'`, ghi audit `tableSession.autoOpened`, idempotent và chống đua bằng cách bắt lỗi E11000 rồi đọc lại phiên vừa tạo, nên hai khách quét cùng lúc vẫn về chung một phiên.
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
- GET /receipts/current đã bỏ field nội bộ (`idempotencyKey`, `requestHash`, `statusHistory`, `version`, `__v`) nhưng vẫn tính từ `Order`.
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

## Kiểm chứng ngày 17/09/2026

- Typecheck server + client: PASS.
- Integration server: 26/26 PASS — 18 test trong `orderFlow.test.ts` và 8 test trong `sessionAutoOpen.test.ts`, chạy trên MongoMemoryReplSet thật.
- `server/vitest.config.ts` phải tách mỗi file test sang process riêng (`isolate: true`, `singleFork: false`, `maxForks: 1`): nhiều file test dùng chung một mongoose instance gây `OverwriteModelError`.
- E2E curl trên server thật + MongoDB thật: 14/14 PASS — join bàn trống 200 `created:true` → đặt đơn 201 → thu tiền 201 kèm `billId` → gọi lại 200 cùng `billId` → quét lại QR ra phiên mới rồi đặt đơn 201; cookie cũ 401; receipt không lộ field nội bộ.
- Browser QA: PASS — khách vào thẳng `/menu` thấy tên bàn và đặt được đơn qua UI; trang staff hiện badge "Tự mở".
- Test bao phủ thêm: tự mở phiên + audit khi quét QR bàn trống, replay thanh toán kèm `billId`, đóng phiên rồi mở phiên mới, sweeper idle đóng phiên + thu hồi guest session.
- Test unit server chạy ở bước xác minh cuối; chưa ghi số ở đây.
- Chưa chạy lại production build và test UI component trong lần này (lần trước: build PASS, Vite còn cảnh báo bundle JS lớn hơn 500 kB; UI 4/4 PASS).
- Lint chưa đạt: client chưa có ESLint config; server còn lỗi có sẵn trong auth.ts (namespace) và seed.ts (unused/console/prefer-const). Không tắt rule để che lỗi.
- Chưa gọi AI live bên ngoài; chỉ kiểm chứng logic fallback/ràng buộc nội bộ.
- Integration dùng database tạm riêng; riêng E2E thủ công có tạo dữ liệu thật trong DB demo (xem mục "Việc còn lại và ranh giới").
- Npm có báo dependency vulnerabilities; chưa áp dụng npm audit fix --force để tránh nâng cấp phá tương thích.

## Chạy và demo

1. npm ci
2. Tạo server/.env từ .env.example, cấu hình MongoDB replica set.
3. npm run db:up → npm run db:wait → npm run seed (seed chỉ dành cho dữ liệu demo; có thể thay dữ liệu hiện tại).
4. npm run dev.
5. Admin vào Bàn & QR, đổi token và tải ảnh QR.
6. Staff vào Bàn & phiên, mở bàn.
7. Khách quét QR/vào link → chọn món hoặc hỏi AI → giỏ → gửi đơn.
8. KDS: nhận → đang pha → sẵn sàng → đã phục vụ.
9. Khách yêu cầu thanh toán; staff chuyển CHECKOUT → kiểm tra & thu tiền → xác nhận số tiền đã nhận.
10. Khách tự chuyển /receipt → xem/in hóa đơn → đánh giá.
11. Có thể thử hai browser profile/thiết bị cùng bàn để kiểm tra phân tách đơn.

Demo LAN: PUBLIC_APP_URL phải là địa chỉ frontend mà điện thoại truy cập (ví dụ http://192.168.1.10:5173); COOKIE_DOMAIN để trống; VITE_API_BASE_URL=/api/v1 và VITE_SOCKET_URL=/ dùng proxy. Khởi động lại server/client khi đổi env. Không đưa secret vào file này.

Biến môi trường mới trong `.env.example`: `GUEST_AUTO_OPEN=true` (cho khách tự mở phiên khi quét QR bàn trống) và `SESSION_IDLE_TIMEOUT_MIN=60` (số phút trước khi sweeper đóng phiên khách bỏ trống; `0` là tắt sweeper). Muốn rollback hành vi tự mở phiên chỉ cần đặt `GUEST_AUTO_OPEN=false` — không phải revert code.

## Việc còn lại và ranh giới

- Kiểm tra trực quan ở 375/768/1440px, quét ảnh QR thực, test mất mạng và demo trên hai thiết bị.
- Dọn cấu hình/lỗi lint sẵn có; tách bundle nếu muốn.
- CRUD quản trị đầy đủ, lịch sử đơn admin, dashboard bộ lọc/export, voucher, upload ảnh, PWA chưa thuộc đợt hoàn thiện luồng này.
- Chưa triển khai tự refresh access token ở frontend; token staff hiện theo cơ chế persist cũ, có thể phải đăng nhập lại khi hết hạn.
- Không xem docs cũ hay số lượng tính năng trong README là bằng chứng đã test: ưu tiên file này và docs/test-report.md.
- Index tableSession mới one_active_session_per_table bảo đảm chỉ một OPEN/CHECKOUT mỗi bàn. Với DB cũ có dữ liệu trùng phiên hoạt động, cần xử lý dữ liệu trước khi tạo index; không tự xóa dữ liệu.
- Phiên bản API OpenAPI đã bổ sung staff tables và receipt endpoints. Hợp đồng response mới hiện được khai báo tại client/controller, chưa đưa hết vào packages/contracts.
- E2E thủ công 17/09/2026 đã tạo dữ liệu thật trong DB demo: bàn `B03` đã thu tiền, bàn `B04` còn 1 đơn PENDING `MCX29XD` kèm phiên mới do auto-open. Người dùng tự dọn nếu cần; không tự xóa dữ liệu.
- Các câu hỏi §11 của issue đã chốt: Q1 mặc định `GUEST_AUTO_OPEN=true` kèm công tắc; Q2 bật idle timeout 60 phút; Q3 vẫn cho nhiều guest session song song theo thiết bị (giữ nguyên); Q4 `Bill` dùng cho `staffBill`, còn `/receipts/current` vẫn tính từ `Order` nhưng đã lọc field nội bộ; Q5 không thêm van "xác nhận đơn đầu tiên".
- Các finding khác trong `audit_2026-09-16.md` §12 nằm ngoài phạm vi issue này, mới chỉ ghi nhận chứ chưa sửa.

## Nguồn đã tra cứu khi triển khai

- qrcode API và Promise toDataURL: https://github.com/soldair/node-qrcode
- Socket.IO client options/cookies: https://socket.io/docs/v4/client-options/
