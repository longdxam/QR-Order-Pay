# Hướng dẫn cải tiến Mây Café: kiến trúc, hệ thống và chức năng

Ngày lập: 23/09/2026.

Trạng thái: **kế hoạch triển khai, chưa phải báo cáo hoàn thành**. Việc tạo tài liệu này không đồng nghĩa các thay đổi bên dưới đã được triển khai hoặc kiểm thử. Các endpoint, trường dữ liệu và file ghi là “đề xuất” chưa mặc nhiên tồn tại.

Tiến độ 23/09/2026: toàn bộ A1–A3, B1–B4, C1–C7 và D1 đã được triển khai và nghiệm thu local. Audit/outbox bao phủ các mutation nghiệp vụ và catalog; queue Redis, migration/restore, các luồng chức năng mới cùng failure/concurrency tests đều có bằng chứng trong các tài liệu được liên kết ở cuối file.

## 1. Mục tiêu và phạm vi

Hoàn thiện hệ thống gọi món tại bàn theo luồng QR → vào bàn → chọn món/AI → đặt món → pha chế → thanh toán → hóa đơn → đánh giá. Ưu tiên tính đúng đắn của nghiệp vụ, khả năng phục hồi khi lỗi và hiệu quả sử dụng tại quán.

Giữ React/Vite/TypeScript, Express/Mongoose/TypeScript, MongoDB replica set, Redis, Socket.IO và Zod contracts. Giữ kiến trúc modular monolith; có thể tách process theo loại tải nhưng chưa cần tách microservice.

Các chức năng mới trong tài liệu phục vụ một quán. Đa chi nhánh, giao hàng, kho nguyên liệu, cổng thanh toán online, tài khoản khách hàng và giỏ cộng tác không thuộc đợt này.

### Tài liệu cần đọc trước khi triển khai

1. [PROJECT_MEMORY.md](PROJECT_MEMORY.md): bối cảnh và trạng thái mới nhất.
2. [Kiến trúc](docs/architecture.md) và [quyết định kiến trúc](docs/architecture-decisions.md).
3. [Báo cáo kiểm thử](docs/test-report.md), [tiến độ nâng cấp](docs/upgrade-progress.md).
4. [Triển khai](docs/deployment.md) và [hiệu năng](docs/performance-report.md) khi thay đổi hạ tầng hoặc hiệu năng.

Đối chiếu tài liệu với code trước khi sửa. Một số ghi chú cũ chưa đồng bộ; không dùng số test lịch sử làm kết quả cho thay đổi mới.

### Các bất biến phải giữ

- Backend quyết định giá, quyền truy cập, trạng thái và số tiền phải thu.
- Mỗi bàn chỉ có tối đa một phiên `OPEN` hoặc `CHECKOUT`.
- Khách chỉ xem đơn, hóa đơn và đánh giá thuộc `participantId` của mình.
- Đặt món và thanh toán giữ idempotency; gửi lại không tạo thêm đơn hoặc khoản thu.
- Chỉ nhận đơn khi phiên `OPEN`; thanh toán yêu cầu `CHECKOUT` và đơn đã `SERVED`/`CANCELLED`.
- `Payment`, chốt `Bill`, đóng phiên và thu hồi quyền đặt món phải nhất quán trong transaction.
- Bill đã chốt không được sửa để phản ánh thay đổi menu hoặc thao tác vận hành về sau.
- PWA giữ giỏ khi mất mạng nhưng không tự gửi mutation khi mạng trở lại.
- Các portal Guest/Staff/Admin tiếp tục kiểm tra quyền tại backend, không chỉ dựa vào giao diện hoặc Nginx.

## 2. Lộ trình và phụ thuộc

| Đợt                     | Mã    | Công việc                                     | Điều kiện bắt đầu                                |
| ----------------------- | ----- | --------------------------------------------- | ------------------------------------------------ |
| 1 — Độ tin cậy          | A1    | Outbox và audit nguyên tử                     | Xác định transaction của từng nghiệp vụ          |
| 1 — Độ tin cậy          | A2    | Worker độc lập, lease, retry, shutdown        | Chốt giao nhận sự kiện với A1                    |
| 1 — Độ tin cậy          | A3    | Realtime chống lặp và đồng bộ lại             | Có event envelope từ A1                          |
| 2 — Nhất quán           | B1    | Receipt từ Bill snapshot                      | Có test quyền và dữ liệu phiên cũ                |
| 2 — Nhất quán           | B2    | Báo giá giỏ hàng trước khi đặt                | Tách được hàm định giá dùng chung                |
| 2 — Nhất quán           | B3    | Contracts, DTO và ranh giới module            | Thực hiện dần cùng A/B, tránh đổi file hàng loạt |
| 2 — Vận hành dữ liệu    | B4    | Migration, backup và restore                  | Database kiểm thử riêng                          |
| 3 — Chức năng ưu tiên   | C1–C3 | KDS, báo hết món, lịch sử hóa đơn             | Đợt 1–2 ổn định                                  |
| 3 — Chức năng tiếp theo | C4–C6 | Yêu cầu hủy, chuyển bàn, đối soát ca          | Hoàn thành mô hình nghiệp vụ từng tính năng      |
| 3 — AI                  | C7    | Gợi ý giải thích được, kiểm tra cấu hình cuối | Metadata đủ để áp dụng ràng buộc                 |
| Kiểm chứng              | D1    | Failure tests, hiệu năng và tài liệu          | Chạy theo từng thay đổi, tổng hợp cuối đợt       |

Mỗi mã là một hạng mục bàn giao riêng. Ưu tiên hoàn thành A1–A3 và B1–B2 trước khi mở nhiều chức năng mới. Không gom toàn bộ lộ trình thành một thay đổi lớn.

## 3. A1 — Transactional outbox và audit nguyên tử

### Hiện trạng và vấn đề

`orderService.ts` và `paymentService.ts` commit nghiệp vụ rồi mới gọi `auditRepository.log`. Controller tiếp tục gửi notification sau khi service trả về. Nếu process dừng giữa các bước, có thể thiếu audit/sự kiện dù đơn hoặc thanh toán đã tồn tại. Audit lỗi sau commit cũng có thể làm HTTP trả lỗi cho nghiệp vụ đã thành công.

### Hướng triển khai

1. Bổ sung model/repository outbox. Trường đề xuất: `eventId`, `eventType`, `schemaVersion`, `aggregateType`, `aggregateId`, `aggregateVersion`, `occurredAt`, `payload`, `status`, `attempts`, `nextAttemptAt`, `leaseOwner`, `leaseUntil`, `publishedAt`.
2. Tạo unique index cho `eventId`, index phục vụ tìm sự kiện đến hạn. Payload chỉ chứa dữ liệu cần thiết, không chứa cookie, token hoặc secret.
3. Cho `auditRepository.log` nhận MongoDB session. Ghi audit quan trọng và outbox trong cùng transaction với nghiệp vụ. Audit thao tác bị từ chối có thể là bản ghi riêng, không giả định nghiệp vụ đã commit.
4. Với chuyển trạng thái đang cập nhật ngoài transaction, bổ sung ranh giới transaction phù hợp để trạng thái, audit và outbox cùng thành công hoặc cùng rollback.
5. Sinh định danh sự kiện ổn định cho một thao tác; tính đến callback transaction có thể chạy lại. Replay cùng idempotency key không tạo thêm sự kiện nghiệp vụ.
6. Relay chỉ lấy outbox đã commit và còn đến hạn, claim nguyên tử bằng lease, rồi đưa vào queue với cùng `eventId`. Chỉ đánh dấu đã chuyển giao sau khi queue nhận thành công.
7. Nếu process dừng sau enqueue nhưng trước đánh dấu, lần sau có thể enqueue lại. Consumer phải xử lý lặp an toàn; không hứa “exactly once”.
8. Chuyển các luồng đã dùng outbox khỏi cơ chế controller phát trực tiếp để tránh hai đường phát trùng không kiểm soát. Kiểm kê cả đặt/hủy/chuyển đơn, thanh toán, phiên bàn, yêu cầu phục vụ và đổi menu.
9. Outbox hết lượt retry phải còn dấu vết để điều tra và phát lại. Chỉ áp dụng retention cho bản ghi đã hoàn tất theo chính sách, không tự xóa bản ghi chưa chuyển giao.

Outbox bảo vệ khoảng trống MongoDB → queue; queue ACK và trình duyệt nhận sự kiện là các bước khác nhau. Không coi enqueue thành công là mọi client đã nhận.

### File trọng tâm

- `server/src/services/{orderService,paymentService,tableSessionService,serviceRequestService}.ts`
- `server/src/repositories/auditRepository.ts`, `server/src/infrastructure/unitOfWork.ts`
- `server/src/controllers/{orderController,paymentController,tableSessionController}.ts`
- `server/src/services/notificationService.ts`, `server/src/worker.ts`
- File mới đề xuất: `models/OutboxEvent.ts`, `repositories/outboxRepository.ts`, `services/outboxRelay.ts`.

### Nghiệm thu

- Transaction lỗi: không có đơn/payment mới, audit thành công hoặc outbox mồ côi.
- Dừng process sau commit trước enqueue: khởi động lại vẫn chuyển được sự kiện.
- Gửi lại cùng request: một nghiệp vụ; sự kiện trùng không gây tác dụng phụ mới.
- Queue tạm lỗi không làm mất bản ghi sự kiện đã commit. Giữ nguyên chính sách limiter hiện tại khi Redis lỗi; A1 không tự cho mutation bỏ qua limiter.
- Audit nghiệp vụ không còn lỗi sau commit làm đổi kết quả HTTP thành thất bại.

## 4. A2 — Worker độc lập và vòng đời job

### Hiện trạng

`backgroundJobWorker.ts` đợi drain realtime rồi xử lý report trong cùng vòng lặp. Một report lâu có thể trì hoãn notification đến sau. Queue đã có processing list, retry và phục hồi khi khởi động, nhưng chưa có lease theo job. Worker hiện tắt healthcheck trong Compose và shutdown chưa đợi job đang chạy hoàn tất.

### Hướng triển khai

1. Tách consumer realtime và report thành process độc lập, dùng chung image/codebase nếu thuận tiện. Report đặt concurrency thấp; realtime có capacity riêng. Giới hạn MongoDB connection pool và concurrency report để tránh report tranh tài nguyên với API.
2. Tách vai trò scheduler khỏi việc nhân bản consumer. Idle sweeper/anomaly scheduler chỉ có một chủ sở hữu tại một thời điểm; nếu cần nhiều bản sao thì dùng lease/leader và kiểm tra idempotency của từng job định kỳ.
3. Claim job nguyên tử; lưu owner, lease token và thời hạn. Heartbeat gia hạn lease; ACK chỉ hợp lệ nếu vẫn giữ lease tương ứng.
4. Reclaim chỉ job đã hết hạn. Không chuyển toàn bộ processing list về pending mỗi lần một worker mới khởi động, vì worker khác có thể đang xử lý.
5. Retry có backoff và jitter; giới hạn attempts; lưu lỗi đã lọc thông tin nhạy cảm vào dead-letter. Có thao tác phát lại có kiểm soát và audit.
6. Khi SIGTERM: ngừng nhận job, đợi công việc đang chạy trong thời hạn cấu hình, sau đó mới đóng Redis/MongoDB. Job chưa ACK phải có thể được nhận lại.
7. Theo dõi heartbeat, tuổi job pending lâu nhất, processing quá hạn, retry, dead-letter và thời gian xử lý. Health của worker phải phản ánh vòng xử lý còn tiến triển; chỉ kiểm tra process tồn tại là chưa đủ.
8. Phân biệt trạng thái report đang chờ/chạy với retention của kết quả. Không để metadata job hết hạn trong khi job còn chờ khiến UI không biết kết quả.

Có thể nâng cấp queue hiện hữu hoặc chọn thư viện queue sau khi đánh giá yêu cầu trên. Nếu đổi giải pháp, cần đường chuyển tiếp cho job cũ và bằng chứng xử lý khi crash; tên thư viện không thay thế tiêu chí nghiệm thu.

### File trọng tâm và nghiệm thu

File: `server/src/infrastructure/backgroundQueue.ts`, `server/src/services/backgroundJobWorker.ts`, `server/src/worker.ts`, `server/src/config/index.ts`, `compose.production.yaml`, `server/src/services/operationsService.ts`, `client/src/features/admin/Operations.tsx`.

- Report bị làm chậm có chủ đích không chặn consumer realtime.
- Dừng worker giữa job: job được reclaim sau khi lease hết hạn.
- Hai consumer không ACK công việc của nhau; duplicate vẫn an toàn.
- Worker ngừng tiến triển xuất hiện cảnh báo; dead-letter có thể tra cứu và phát lại.
- Scheduler không chạy trùng chỉ vì tăng số consumer.

## 5. A3 — Realtime có phiên bản và cơ chế đồng bộ lại

1. Khai báo event envelope dùng chung trong contracts: `eventId`, `eventType`, `schemaVersion`, `entityId`, `entityVersion`, `occurredAt`, `data`.
2. Chỉ so sánh version trong cùng entity; không coi version của đơn là version của phiên bàn.
3. Với sự kiện dùng để cập nhật trực tiếp cache, bỏ sự kiện trùng/cũ và refetch khi phát hiện thiếu version. Với sự kiện chỉ invalidate query, bảo đảm invalidate lặp là an toàn và có thể gộp burst để tránh dồn request.
4. Reconnect luôn lấy snapshot phù hợp quyền từ API. Giữ polling dự phòng; cân nhắc giảm tần suất khi socket khỏe sau khi đã đo.
5. UI phân biệt mất kết nối realtime với mất mạng hoàn toàn; vẫn thể hiện dữ liệu đang có và trạng thái làm mới.
6. Tiếp tục xác thực room và thu hồi quyền. Không replay dữ liệu khách khác chỉ để khôi phục đồng bộ.

File: `server/src/realtime/socket.ts`, `client/src/lib/socket.ts`, `client/src/layouts/{GuestLayout,StaffLayout}.tsx`, `packages/contracts/src/schemas.ts`.

Nghiệm thu: event trùng, đảo thứ tự hoặc bị bỏ lỡ không làm giao diện lùi trạng thái; sau reconnect UI khớp API; guest không nhận đơn của participant khác.

## 6. B1 — Receipt dùng Bill snapshot

Hiện Staff đọc Bill đã chốt nhưng `receiptController.ts` vẫn query Order. Chuyển receipt phiên đã thanh toán sang cùng nguồn Bill, lọc theo participant ngay tại backend.

1. Tạo receipt service/repository thay cho controller tự query model và tính tổng.
2. Với phiên đã đóng có Bill, lấy các order snapshot thuộc `participantId`, tính tổng phần được phép xem từ snapshot và nối đánh giá qua `orderId`.
3. Không trả tổng toàn bàn, participant khác, payment ID nội bộ hay trường quản trị không cần thiết.
4. Dùng DTO rõ ràng và schema response. Giữ kiểm tra receipt token, thời hạn, trạng thái phiên và quyền đánh giá một lần.
5. Với phiên cũ chưa có Bill, giữ fallback từ Order và test riêng. Không âm thầm tạo lại Bill lịch sử từ dữ liệu có thể đã thay đổi.
6. Nếu cần tên bàn trên hóa đơn bất biến, bổ sung snapshot tên bàn cho Bill mới; Bill cũ dùng fallback được mô tả rõ.

File: `server/src/controllers/receiptController.ts`, `server/src/repositories/billRepository.ts`, `server/src/models/Bill.ts`, `server/src/services/reviewService.ts`, `client/src/features/guest/ReceiptPage.tsx`.

Nghiệm thu: thay đổi menu không đổi receipt; hai guest cùng bàn chỉ xem phần của mình; guest hết quyền bị chặn; phiên cũ chưa có Bill vẫn đọc được; review giữ nguyên ownership.

## 7. B2 — Báo giá giỏ hàng trước khi đặt

### Hành vi mong muốn

Khách được biết giá và availability mới trước khi xác nhận. Nếu giá đổi, món hết hoặc tùy chọn không còn hợp lệ, UI nêu từng dòng bị ảnh hưởng và yêu cầu xác nhận lại. Báo giá không giữ chỗ hay bảo đảm món còn bán đến lúc gửi đơn.

### Thiết kế đề xuất

1. Tách hàm định giá/kiểm tra tùy chọn dùng chung cho quote và place order; không nhân đôi công thức.
2. Thêm endpoint guest `POST /api/v1/orders/quote` với auth, CSRF, rate limit và schema. Response gồm dòng món chuẩn hóa, giá, tổng, lỗi/điểm thay đổi, thời hạn và định danh báo giá.
3. Định danh báo giá phải tham chiếu dữ liệu server lưu hoặc payload có chữ ký; không tin tổng tiền client gửi. Ràng buộc báo giá với participant, phiên bàn và fingerprint của giỏ.
4. Khi đặt, kiểm tra lại quyền phiên, cấu hình món và giá hiện tại. Nếu khác báo giá đã xác nhận, trả lỗi có cấu trúc như `QUOTE_CHANGED`, không âm thầm tạo đơn với giá mới.
5. Chốt chính sách thời điểm đọc catalog: xác thực giá/options và tạo order snapshot từ cùng một lần đọc nhất quán trong transaction. Nếu yêu cầu thay đổi catalog phải chặn mọi order đồng thời, cần thêm cơ chế version/write guard và đo contention; chỉ đọc version không tự tạo khóa.
6. Sửa giỏ làm báo giá cũ không còn hợp lệ. Retry lỗi mạng với cùng payload vẫn giữ idempotency key; xác nhận giỏ/quote mới dùng key mới theo quy tắc rõ ràng.
7. Khi request trước có thể đã thành công nhưng mất response, giải quyết replay nghiệp vụ đã tạo trước khi bắt khách lấy quote mới; vẫn kiểm tra ownership và trạng thái quyền phù hợp. Không tạo đơn thứ hai chỉ vì quote vừa hết hạn.
8. Offline: giữ giỏ, hiển thị cần kết nối để kiểm tra giá/gửi đơn; không background sync mutation.

File: `server/src/services/orderService.ts`, `server/src/controllers/orderController.ts`, `server/src/routes/index.ts`, `packages/contracts/src/schemas.ts`, `client/src/features/guest/CartPage.tsx`, `client/src/store/cart.ts`.

Nghiệm thu: giá đổi trước xác nhận; topping hết bán; quote hết hạn; sửa quantity; quote của guest khác; request timeout nhưng đơn đã tạo; checkout đồng thời với đặt món. Mỗi ca đều không tạo đơn ngoài ý định đã xác nhận hoặc đơn trùng.

## 8. B3 — Contracts, DTO và ranh giới module

Thực hiện từng phần cùng hạng mục đang sửa:

- Các module nghiệp vụ: identity, catalog, table-session, order, billing, review, AI và operations. Ghi rõ module nào sở hữu dữ liệu và public service nào được gọi từ module khác.
- Controller parse request, gọi service, serialize DTO. Service giữ quyết định nghiệp vụ; repository chứa truy cập MongoDB.
- Giảm controller/service truy cập model của module khác; ưu tiên public service/repository interface phù hợp transaction.
- Dùng schema request chung cho query/status/transition thay vì `as never`. Schema TypeScript phải được tiêu thụ lúc nhận input, không chỉ khai báo type.
- Chuẩn hóa response quan trọng: `id` hoặc `_id` theo hợp đồng đã chọn, thời gian, tiền VND nguyên, pagination và error envelope. Có bước tương thích khi client cũ có thể còn được service worker phục vụ.
- Ưu tiên DTO cho order, receipt, bill, report job, service request và response quản trị có dữ liệu nhạy cảm.
- Bổ sung quy tắc kiểm tra import trong CI. Không di chuyển hàng loạt file chỉ để đổi hình thức thư mục.
- Cập nhật OpenAPI cùng contracts và endpoint thực tế; giữ backend là nơi quyết định state transition.

Nghiệm thu: input sai trả lỗi có cấu trúc; DTO không lộ trường nội bộ; client/server dùng cùng schema ở các luồng đã chuyển; CI phát hiện import vượt ranh giới đã quy định.

## 9. B4 — Migration, backup, restore và tương thích triển khai

1. Tạo migration runner có version, lịch sử áp dụng, khả năng chạy lại an toàn và ngăn chạy đồng thời. Ưu tiên thay đổi bổ sung trường/index trước, chuyển code sau, dọn cấu trúc cũ sau cùng.
2. Có bước kiểm tra trước tạo unique index: phát hiện dữ liệu trùng và xuất báo cáo. Không tự xóa bản ghi để ép index thành công.
3. `syncIndexes()` trong seed benchmark không phải quy trình migration production; không chạy seed hoặc đồng bộ xóa index tùy tiện trên DB thật.
4. Tài liệu backup phải chỉ rõ target, cơ chế backup nhất quán cho môi trường đó, vị trí lưu, retention và quyền đọc. Chốt mức mất dữ liệu tối đa chấp nhận được (RPO) và thời gian khôi phục mục tiêu (RTO).
5. Thử restore vào database/volume riêng. Kiểm tra index, số lượng dữ liệu và các bất biến đơn/payment/Bill, không chỉ kiểm tra lệnh restore exit 0.
6. Khi rollback code, đánh giá tương thích schema và event version. Với outbox/queue, giữ hoặc drain job đang chờ bằng consumer tương thích; không xóa backlog hoặc bật lại direct emitter hàng loạt mà không có kế hoạch chống trùng.
7. Theo dõi RAM Redis, queue, cache và kích thước report. Đặt giới hạn payload/thời gian lưu; cân nhắc tách Redis cache khỏi Redis queue/limiter khi số liệu cho thấy cạnh tranh bộ nhớ.

Nghiệm thu: có biên bản restore trên dữ liệu thử nghiệm; migration chạy lại an toàn; dữ liệu trùng bị báo trước; có hướng rollback cho mỗi thay đổi không tương thích.

## 10. C1–C7 — Cải tiến chức năng tại quán

### C1. KDS hiển thị thời gian chờ — ưu tiên cao

- Dựa trên timestamp phía server và `statusHistory` để hiện thời gian chờ nhận, chờ pha, chờ phục vụ; không ghi database mỗi giây để tăng bộ đếm.
- Sắp xếp đơn cũ trước trong từng trạng thái, đánh dấu quá ngưỡng cấu hình, không chỉ dùng màu để truyền đạt cảnh báo.
- Giữ khóa thao tác khi gửi request và version check khi nhiều staff thao tác.
- Nghiệm thu: reload không reset tuổi đơn; hai staff cập nhật đồng thời không ghi đè sai; trạng thái rỗng/loading/lỗi và màn hình nhỏ đều dùng được.
- File: `client/src/features/staff/{KDS,OrderDetailModal}.tsx`, order service/repository và contracts.

### C2. Nhân viên báo hết món — ưu tiên cao

- Tạo quyền/thao tác availability riêng cho món, size, topping; không cấp quyền sửa giá hoặc toàn bộ catalog cho STAFF.
- Ghi audit ai thay đổi gì; cập nhật cache generation và gửi event sau commit. Nếu việc invalidation bị gián đoạn, phải có cơ chế retry/TTL giới hạn thời gian dữ liệu cũ.
- Giỏ/quote chỉ rõ mục bị ảnh hưởng; backend vẫn kiểm tra lại khi đặt.
- Nghiệm thu: staff đổi availability được nhưng không sửa giá; guest không thao tác được; các API instance đọc được menu cập nhật; đơn cũ giữ snapshot.

### C3. Lịch sử hóa đơn cho Admin — ưu tiên cao

- Tìm theo mã hóa đơn, bàn, ngày thanh toán và nhân viên thu tiền; có phân trang, chi tiết snapshot và in lại.
- Nếu bổ sung mã hóa đơn dễ đọc, dùng unique index và quy tắc sinh mã; phân biệt rõ với mã đơn.
- Lấy Bill làm nguồn chi tiết, Payment làm nguồn khoản thu; snapshot thông tin cần giữ ổn định.
- Response và bộ lọc phải có contracts; range ngày theo `Asia/Ho_Chi_Minh`.
- Nghiệm thu: không cắt ở 100 đơn; in lại không đổi số tiền; STAFF/GUEST bị chặn nếu endpoint chỉ dành ADMIN; tìm đúng khi tên bàn hoặc nhân viên đã đổi.

### C4. Yêu cầu hủy sau khi staff nhận đơn — ưu tiên vừa

- Giữ khách tự hủy ở `PENDING`. Với `CONFIRMED`, khách có thể gửi yêu cầu để staff duyệt; chưa mở hủy ở `PREPARING`/`READY`/`SERVED` trong phiên bản đầu.
- Yêu cầu hủy có vòng đời riêng, không đồng nghĩa đơn đã `CANCELLED` hoặc đã trừ tiền.
- Khi duyệt, kiểm tra lại trạng thái/version, quyền, lý do và khả năng đơn đã chuyển sang pha chế. Giải quyết race bằng transaction/conditional update.
- Chống gửi trùng yêu cầu đang mở; quyết định được audit và phát event. Checkout không được bỏ qua yêu cầu còn chờ theo chính sách đã chốt.
- Nghiệm thu: khách khác không gửi hộ; hai staff duyệt không tạo hai kết quả; yêu cầu tới muộn được trả lời rõ, không hủy món đã phục vụ.

### C5. Chuyển bàn trống — ưu tiên vừa

- Phiên bản đầu chỉ chuyển cả phiên sang bàn đang trống; chưa gộp bàn hoặc chia phiên.
- Định danh `tableSessionId` và participant giữ ổn định. Chốt rõ trường bàn nào là lịch sử, trường nào là vị trí hiện tại để KDS và Bill hiển thị đúng.
- Kiểm tra phiên nguồn `OPEN`, bàn đích hoạt động và không có phiên active; cập nhật liên quan trong transaction, dựa thêm unique index để chống đua.
- QR bàn nguồn và bàn đích phải phản ánh vị trí phiên sau chuyển; khách đã tham gia giữ quyền đúng phiên. Quy định rõ ai được mở phiên mới ở bàn nguồn theo hành vi auto-open hiện hữu.
- Cấm chuyển khi checkout/thu tiền; audit nguồn, đích, staff và thời điểm.
- Nghiệm thu: hai thao tác cùng chọn bàn đích chỉ một thành công; đơn không mất; khách cũ tiếp tục xem đúng đơn; QR mới vào đúng phiên; rollback không để cập nhật nửa chừng.

### C6. Đối soát cuối ca — ưu tiên vừa

- Xây dựng khái niệm ca thu ngân có mở/đóng, người phụ trách, tiền đầu ca và thời điểm chốt. Gắn khoản thu với ca tại lúc thanh toán để truy vết ổn định.
- Tổng tiền đã thu dựa vào Payment thành công và `paidAt`, không dùng thời điểm tạo Order. Phân biệt rõ doanh số món và dòng tiền thu theo ca.
- Hiện CASH/BANK_TRANSFER/OTHER, tiền mặt dự kiến, tiền kiểm đếm và chênh lệch kèm lý do. Không coi khoản chuyển khoản là tiền mặt trong két.
- Liệt kê phiên chưa thanh toán để bàn giao; chốt ca và thu tiền đồng thời phải có chính sách rõ để mỗi payment thuộc đúng một ca.
- Không sửa Payment/Bill để làm khớp tiền kiểm đếm; lưu biên bản đối soát riêng, có quyền và audit.
- Nghiệm thu: payment replay không cộng doanh thu hai lần; ca qua nửa đêm; hai người chốt đồng thời; khoản thu xảy ra đúng lúc đóng ca.

### C7. AI gợi ý giải thích được — ưu tiên sau luồng cốt lõi

- Nêu lý do món phù hợp bằng metadata thật, khoảng giá và các ràng buộc được áp dụng.
- Tính lại điều kiện trên cấu hình cuối: size, topping, ngân sách, caffeine và sữa. Không coi metadata chưa biết là đáp ứng điều kiện.
- LLM chỉ sinh intent/lời giải thích đã qua schema; backend xác thực ID, availability, giá và các điều kiện bắt buộc.
- Giữ fallback và phân biệt `mode` rõ ràng. Test live riêng bằng key hợp lệ, có giới hạn số lần/chi phí; không ghi key hoặc body lỗi provider chứa thông tin nhạy cảm.
- Nghiệm thu: topping có sữa không xuất hiện trong cấu hình được khẳng định không sữa; đổi size vượt ngân sách được báo; kết quả rỗng không tự nới điều kiện; timeout vẫn có fallback hợp lệ.
- File: `server/src/services/{aiService,menuSearchService}.ts`, `server/src/providers/aiProvider.ts`, `client/src/features/{ai/AISheet,guest/ProductDetailModal}.tsx`, `docs/ai-evaluation.md`.

### Hạng mục để sau

KDS theo từng món/phục vụ một phần đơn chỉ làm khi có nhu cầu cụ thể. Cần mô hình trạng thái item, quy tắc suy ra trạng thái order, quantity đã phục vụ/hủy và tác động thanh toán riêng. Không ghép thay đổi này vào C1.

## 11. D1 — Kiểm thử, hiệu năng và tiêu chí chất lượng

### Ma trận tình huống bắt buộc cho các luồng bị thay đổi

| Tình huống                                    | Kết quả cần chứng minh                                  |
| --------------------------------------------- | ------------------------------------------------------- |
| Dừng API sau commit, trước enqueue            | Nghiệp vụ tồn tại và sự kiện còn đường phục hồi         |
| Dừng relay sau enqueue, trước cập nhật outbox | Có thể trùng event nhưng không trùng tác dụng nghiệp vụ |
| Dừng worker sau claim                         | Job được nhận lại sau lease, không bị mất               |
| Report chạy lâu, khách đặt món                | Realtime consumer tiếp tục xử lý                        |
| Mất response thanh toán, gửi lại cùng key     | Một Payment, một Bill, trả lại kết quả cũ               |
| Hai staff chuyển trạng thái cùng đơn          | Không ghi đè trạng thái mới bằng trạng thái cũ          |
| Khách đặt món đồng thời checkout              | Không nhận đơn sau ranh giới đóng quyền đặt món         |
| Socket mất kết nối hoặc event đảo thứ tự      | Refetch khôi phục đúng trạng thái và quyền              |
| Menu đổi giữa quote và đặt món                | Không âm thầm thu theo giá khác khách xác nhận          |
| Hai thiết bị cùng bàn đọc receipt             | Mỗi thiết bị chỉ thấy phần của mình                     |

Dùng integration với MongoDB replica set và Redis thử nghiệm cho transaction/queue. Mock chỉ phù hợp kiểm tra logic đơn lẻ; không dùng mock để khẳng định khả năng phục hồi khi process bị dừng. Lỗi cưỡng bức chỉ chạy trên stack/database riêng.

### Lệnh kiểm tra hiện có

Chạy từ thư mục gốc, chọn test theo phạm vi trong quá trình làm; trước bàn giao đợt có thay đổi code, chạy các kiểm tra liên quan đầy đủ:

```powershell
npm run lint
npm run typecheck
npm run test:server
npm run test:client
npm run test:integration
npm run build
```

Browser E2E khi có thay đổi UI hoặc luồng xuyên suốt:

```powershell
npm run test:e2e
```

Đọc `server/playwright.config.ts` và hướng dẫn kiểm thử hiện tại trước khi chạy E2E để cấu hình đúng portal/backend. Ghi riêng test PASS, FAIL và SKIP; thiếu `E2E_TABLE_TOKEN` không được ghi thành ca đã đạt. QR/camera thật chỉ kiểm tra khi người dùng muốn thực hiện bước đó.

### Hiệu năng

- Không chạy lại benchmark nặng cho thay đổi tài liệu hoặc UI không liên quan hiệu năng.
- Với thay đổi queue/transaction/query, bắt đầu bằng ca có mục tiêu rồi mới mở rộng khi cần. Dùng database benchmark riêng và bảo đảm index đã tồn tại.
- Tách kịch bản nhiều bàn sử dụng bình thường và nhiều khách cùng một bàn; giữ tổng tải so sánh tương đương khi đánh giá contention.
- Đo API latency, Mongo query/transaction retry, queue lag, event-to-UI latency và tải CPU/RAM. Tách traffic Guest và Internal.
- Ngưỡng đề xuất kế thừa baseline: read p95 <500 ms, write p95 <1.000 ms, lỗi bất ngờ <1%; bổ sung mục tiêu event-to-UI p95 <1.000 ms. Đây là mục tiêu kiểm thử tại tải/môi trường ghi rõ, chưa phải kết quả đã đạt.
- Thống kê 429 do limiter riêng, không gộp thành lỗi server cũng không bỏ qua tác động lên trải nghiệm khách.
- Baseline 90 RPS và write p95 4,15 giây thuộc topology cũ; không dùng để tuyên bố năng lực topology mới. Nếu đo lại, ghi commit, cấu hình, dataset, warm-up, thời lượng và vị trí máy phát tải.
- Sau load test phải kiểm tra bất biến: một phiên active/bàn, không trùng idempotency, không sai tổng, không lệch Payment/Bill. Không bỏ transaction/version guard để cải thiện con số.

## 12. Quy trình thực hiện và bàn giao mỗi hạng mục

1. Đọc memory, kiểm tra `git status`, xác nhận phần nào đã tồn tại và bảo toàn thay đổi chưa commit của người dùng.
2. Ghi ngắn vấn đề, hành vi mong muốn, API/data thay đổi, các race và phương án tương thích trước khi sửa.
3. Thực hiện một hạng mục có thể review; bổ sung test tập trung vào bất biến và lỗi thực tế, không viết test chỉ sao chép implementation.
4. Chạy kiểm tra phù hợp; sửa lỗi phát sinh trong phạm vi thay đổi. Không tắt lint rule hoặc nới kiểm tra quyền để đạt test.
5. Kiểm tra diff và ghi rõ file thay đổi, kết quả kiểm thử, hạn chế còn lại, migration và cách rollback nếu có.
6. Cập nhật `PROJECT_MEMORY.md` cùng tài liệu liên quan sau khi thực sự triển khai và kiểm chứng. Ghi ADR mới với mã không trùng; tài liệu hiện có mục AD-013 bị lặp nên kiểm tra trước khi đánh số tiếp.
7. Chỉ đánh dấu hoàn thành khi tiêu chí nghiệm thu tương ứng có bằng chứng. Commit/push/deploy theo phạm vi người dùng giao ở lần triển khai; bản hướng dẫn này không tự kích hoạt triển khai cloud hoặc tạo tài nguyên có phí.

Không in nội dung `apikey.txt` hoặc secrets. Không reset/xóa dữ liệu demo, database hay volume để tiện kiểm thử. Seed chỉ dùng trên dữ liệu thử nghiệm được xác định rõ; môi trường thật cần quy trình migration/backup riêng.

### Mẫu ghi kết quả

```text
Hạng mục: A1 / A2 / ...
Trạng thái: chưa làm / đang làm / hoàn thành / vướng điều kiện
Hành vi đã thay đổi:
File và API/schema liên quan:
Kiểm thử đã chạy, kết quả và môi trường:
Ca chưa chạy hoặc bị skip, lý do:
Migration và rollback:
Hạn chế còn lại:
Tài liệu đã cập nhật:
```

## 13. Checklist tổng

- [x] A1: Nghiệp vụ, audit quan trọng và outbox nguyên tử; replay an toàn.
- [x] A2: Consumer realtime/report độc lập; lease, retry, reclaim, health và shutdown đạt.
- [x] A3: Event có định danh/version; reconnect khôi phục dữ liệu đúng quyền.
- [x] B1: Receipt dùng Bill snapshot và giữ fallback cho phiên cũ.
- [x] B2: Quote và place order dùng chung định giá; khách xác nhận thay đổi giá.
- [x] B3: Contracts/DTO được dùng thực tế; ranh giới module có kiểm tra.
- [x] B4: Migration an toàn; restore được kiểm chứng trên database riêng.
- [x] C1: KDS hiển thị thời gian chờ và cảnh báo quá hạn.
- [x] C2: Staff đổi availability bằng quyền riêng, có audit/cache invalidation.
- [x] C3: Admin tra cứu và in lại hóa đơn snapshot.
- [x] C4: Yêu cầu hủy có duyệt, chống race và lịch sử.
- [x] C5: Chuyển phiên sang bàn trống nguyên tử, quyền guest giữ đúng.
- [x] C6: Đối soát ca dựa trên khoản thu, không sửa Bill để cân chênh lệch.
- [x] C7: AI giải thích dựa trên dữ liệu thật, kiểm tra cấu hình cuối.
- [x] D1: Failure tests và kiểm tra liên quan đạt; báo cáo phân biệt PASS/FAIL/SKIP.

### Kết quả triển khai — 23/09/2026

Toàn bộ checklist A1–A3, B1–B4, C1–C7 và D1 đã được triển khai trong source. Bằng chứng nghiệm thu chi tiết nằm tại `docs/upgrade-progress.md`, `docs/test-report.md`, `docs/backup-restore-runbook.md` và `docs/restore-drill-2026-09-23.md`. Việc deploy cloud, quét QR bằng camera thật và gọi LLM bằng credential hợp lệ vẫn là kiểm chứng môi trường bên ngoài, không phải phần code còn thiếu của checklist này.

## 14. Tài liệu kỹ thuật tham khảo

- [AWS — Transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html): xử lý khoảng trống giữa commit dữ liệu và phát sự kiện, lưu ý thông điệp trùng.
- [Redis — LMOVE và reliable queue](https://redis.io/docs/latest/commands/lmove/): chuyển nguyên tử pending/processing, xác nhận và thu hồi công việc quá hạn.
- [Socket.IO — Delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/): bảo đảm giao nhận mặc định và cơ chế bổ sung ở tầng ứng dụng.

Các nguồn trên giải thích nguyên lý; khi chọn thư viện hoặc triển khai theo phiên bản cụ thể, đối chiếu lại tài liệu chính thức và lockfile của project.
