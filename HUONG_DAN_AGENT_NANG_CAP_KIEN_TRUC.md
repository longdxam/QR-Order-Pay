# Hướng dẫn AI agent nâng cấp kiến trúc và thiết kế — Mây Café

Ngày soạn: 20/09/2026.

## 1. Nhiệm vụ và cách sử dụng

Bạn là agent triển khai các cải tiến cho bài tập lớn Lập trình Web Mây Café. Hãy đọc hết tài liệu này, kiểm tra repository, lập kế hoạch và triển khai theo từng giai đoạn có kiểm chứng. Không chỉ đưa ra một bản đề xuất mới.

Mục tiêu: ứng dụng cloud có cấu trúc dễ bảo trì, khả năng mở rộng có thể chứng minh, giám sát hoạt động, tìm kiếm menu thông minh và AI hỗ trợ giải thích bất thường. Sản phẩm phải vẫn dễ chạy, dễ demo và phù hợp phạm vi một quán cà phê.

Tài liệu này là **đặc tả công việc đề xuất**, không phải xác nhận các tính năng đã được triển khai hoặc kiểm thử. Chỉ cập nhật trạng thái hoàn thành sau khi có bằng chứng.

Thứ tự thực hiện: **P0 khảo sát → P1 nền tảng → P2 triển khai → P3 giám sát → P4 AI/tìm kiếm → P5 đa instance và kiểm thử tải → P6 nghiệm thu**. Có thể chạy kiểm thử tải cơ sở từ P3, trước khi có nhiều instance.

Nếu chưa có cloud account, domain hoặc khóa AI, tiếp tục hoàn thiện cấu hình, ứng dụng và bản demo local. Ghi rõ phần chưa xác minh; chỉ yêu cầu thông tin hoặc quyền còn thiếu cho bước phụ thuộc. Không tự tạo tài nguyên có phí khi chưa được người dùng cho phép.

## 2. Đọc và xác minh bối cảnh trước khi sửa

Đọc `AGENTS.md` áp dụng nếu có, sau đó:

1. `PROJECT_MEMORY.md` — phạm vi và quyết định nghiệp vụ gần nhất.
2. `package.json`, các workspace package, `compose.yaml`, `.env.example`.
3. `docs/architecture.md`, `docs/database.md`, `docs/api/`.
4. `docs/ai-design.md`, `docs/ai-evaluation.md`.
5. `docs/test-report.md`, `docs/design-system.md`, `docs/demo-script.md`.
6. Code và test liên quan trực tiếp đến thay đổi.

Kiểm tra `git status` trước khi làm; bảo toàn thay đổi có sẵn của người dùng. Không chạy seed, reset database, xóa volume hay dọn dữ liệu demo để có môi trường sạch. Dùng database riêng cho test và benchmark.

Thông tin nền tại thời điểm soạn:

- npm workspaces: `client` React/Vite/TypeScript; `server` Express/Mongoose/TypeScript; `packages/contracts` Zod.
- MongoDB replica set phục vụ transaction; `compose.yaml` hiện chủ yếu chạy MongoDB.
- Có Socket.IO, polling dự phòng, Pino, idempotency đặt đơn/thanh toán, snapshot `Bill` và AI fallback.
- `idleSessionSweeper.ts` hiện có lịch chạy trong process backend; cần xử lý khi nhân bản backend.
- Bộ nhớ ngày 17/09 ghi integration 26/26 và E2E thủ công 14/14. Đây là kết quả lịch sử, không thay thế lần chạy mới.
- `docs/test-report.md` mang ngày 16/09 và có số liệu cũ hơn. `docs/ai-design.md` còn mô tả fallback món rẻ nhất khi không khớp, khác ràng buộc trong bộ nhớ mới. Xác minh bằng code/test rồi cập nhật tài liệu; không khôi phục hành vi sai theo tài liệu cũ.
- Theo bộ nhớ, DB demo có dữ liệu tại B03/B04, gồm đơn `MCX29XD`. Không tự sửa/xóa chúng.

Các điểm vào chính cần kiểm tra:

```text
server/src/routes/index.ts
server/src/controllers/{tableSessionController,orderController,paymentController,receiptController}.ts
server/src/services/{tableSessionService,orderService,paymentService,aiService,idleSessionSweeper}.ts
server/src/realtime/socket.ts
server/src/infrastructure/
server/src/models/Bill.ts
client/src/lib/{socket,api}.*
client/src/layouts/
client/src/features/{guest,staff,admin,ai}/
packages/contracts/
```

Tên/path dạng gợi ý phải được kiểm tra bằng danh sách file thực tế trước khi sử dụng.

## 3. Các bất biến nghiệp vụ phải giữ

- Luồng chính: QR → vào phiên bàn → chọn/tùy chỉnh món hoặc hỏi AI → đặt món → pha chế → phục vụ → thanh toán → hóa đơn → đánh giá.
- Khách không cần tài khoản. Mỗi thiết bị có `participantId`; khách chỉ thấy đơn/hóa đơn của mình, staff thu tiền theo toàn phiên bàn.
- Backend quyết định giá, quyền và trạng thái. Client, cache và AI không phải nguồn quyết định số tiền.
- Chỉ một phiên OPEN/CHECKOUT trên mỗi bàn; giữ unique index và cơ chế chống race khi auto-open.
- CHECKOUT chặn đặt thêm món. Thanh toán chỉ hợp lệ khi trạng thái món và tổng tiền đáp ứng quy tắc hiện có.
- Giữ transaction và idempotency: cùng key/cùng payload không tạo lại giao dịch; cùng key/khác payload trả lỗi xung đột.
- `Bill` đã chốt là snapshot bất biến. Receipt tiếp tục tuân thủ ownership và cơ chế token riêng; không đổi nguồn receipt từ Order sang Bill trong đợt này nếu chưa có lý do và thiết kế tương thích rõ ràng.
- Cookie HttpOnly, thời hạn phiên, thu hồi phiên và phân quyền REST/Socket phải tiếp tục hoạt động.
- Giữ AI fallback; không có kết quả phù hợp thì nói rõ, không tự nới điều kiện bắt buộc của khách.
- Mặc định giữ `GUEST_AUTO_OPEN=true`, timeout phiên rỗng 60 phút, nhiều thiết bị cùng bàn, không thêm bước duyệt đơn đầu tiên.

Không mở rộng sang nhiều chi nhánh, giao hàng, kho nguyên liệu, cổng thanh toán online, Kubernetes hoặc hệ microservices độc lập trong phạm vi này.

## 4. Kiến trúc đích

Giữ **modular monolith**: một backend với các ranh giới nghiệp vụ rõ ràng, có thể chạy nhiều bản sao cùng code. Không tách mỗi module thành một dịch vụ mạng.

```text
Khách / Staff / Admin
        |
        | HTTPS, cùng origin cho frontend, API và Socket
        v
Reverse proxy / Load balancer ----> Frontend đã build
        |
        +----> Backend A ----+
        +----> Backend B ----+----> MongoDB replica set
                            +----> Redis khi bật multi-instance

Worker định kỳ -------------> MongoDB / dữ liệu tổng hợp
        |
        +----> AI provider, có timeout và fallback

Backend / Worker ----> Logs + Metrics ----> Dashboard / cảnh báo
```

Chế độ cơ bản: một backend, MongoDB và worker theo cấu hình đã chọn. Chế độ nâng cao: hai backend, adapter realtime và cơ chế rate limit dùng chung; worker chỉ có một chủ thực thi hoặc có khóa phù hợp.

Hai container trên cùng máy chỉ minh họa cân bằng tải và lỗi process. Không mô tả là chịu được sự cố cả máy. Replica set một node hỗ trợ transaction nhưng không mang lại dự phòng máy chủ.

## 5. P0 — Khảo sát và đo đường cơ sở

### Công việc

- Liệt kê phần đã có, thiếu, sai lệch tài liệu và điểm nghẽn có bằng chứng.
- Kiểm tra version Node và dependency thực tế; dùng lockfile hiện có. Không nâng cấp hàng loạt chỉ để làm mới công nghệ.
- Chạy kiểm tra nền theo scripts thực tế, ghi kết quả và lỗi tồn tại trước thay đổi.
- Kiểm tra logger, middleware lỗi, health endpoint, rate limiter, AI provider, state transition và query trước khi bổ sung thứ tương tự.
- Viết backlog nhỏ theo các giai đoạn dưới đây, ghi quyết định kiến trúc quan trọng vào `docs/architecture-decisions.md`.

### Nghiệm thu

Có danh sách thay đổi dự kiến, rủi ro, cách rollback và số liệu kiểm tra cơ sở. Các tính năng có sẵn được tái sử dụng, không tạo triển khai trùng lặp.

## 6. P1 — Củng cố backend và hợp đồng API

### Công việc

- Xác lập module: auth, catalog/menu, table-session, order, payment/receipt, review, AI và operations.
- Giữ phân tầng controller → service → repository. Có thể giữ thư mục phân tầng hiện tại rồi tổ chức ranh giới bằng exports/quy ước; không di chuyển toàn bộ file nếu không tạo giá trị rõ ràng.
- Service không phụ thuộc trực tiếp Express request/response. Chia sẻ logic qua giao diện service, tránh controller gọi controller.
- Đưa request/response schema cần dùng chung vào `packages/contracts`; ưu tiên endpoint đang mở rộng và phần hợp đồng còn thiếu đã ghi trong bộ nhớ.
- Chuẩn hóa lỗi API có mã lỗi ổn định và `requestId`; không làm hỏng client đang dùng response cũ.
- Tập trung các chuyển trạng thái Order/TableSession và kiểm tra quyền; giữ cơ chế chống cập nhật đồng thời, transaction và optimistic version hiện có.
- Sự kiện realtime chỉ phát sau khi transaction thành công. Giữ khả năng đọc lại trạng thái qua API khi reconnect/mất sự kiện.
- Hoàn thiện refresh access token staff nếu code còn thiếu: một refresh đang chạy dùng chung cho các request đồng thời, retry tối đa một lần, thất bại thì đăng xuất, không tạo vòng lặp.
- Sửa lỗi lint nền trong phạm vi cần thiết, không tắt rule rộng hoặc sửa file không liên quan.

### Nghiệm thu

- Kiểm tra hiện có và các test hồi quy liên quan đạt.
- Hai khách cùng bàn không đọc chéo đơn/receipt.
- Retry đặt đơn/thanh toán không tạo bản ghi trùng; tranh chấp đóng phiên/đặt món giữ đúng quy tắc.
- Mô tả được trách nhiệm mỗi module và nguồn quyết định dữ liệu.

## 7. P2 — Đóng gói và triển khai cloud

### Công việc

- Tạo Docker build phù hợp npm workspace và thứ tự build contracts → server/client; dùng lockfile, build nhiều stage, `.dockerignore`, không đưa secret vào image.
- Phục vụ frontend production đã build qua reverse proxy; không dùng Vite dev server làm production server.
- Bổ sung cấu hình production/local-demo riêng, giữ nguyên cách chạy dev hiện có.
- Reverse proxy định tuyến `/api/v1` và Socket.IO, hỗ trợ WebSocket, HTTPS khi triển khai thật. Cấu hình `trust proxy` theo topology thực tế, không tin tùy ý header client gửi.
- Thêm/hoàn thiện liveness và readiness. Liveness phản ánh process còn sống; readiness kiểm tra dependency thiết yếu với timeout ngắn. AI lỗi không được khiến toàn bộ dịch vụ đặt món bị đánh dấu không sẵn sàng.
- Graceful shutdown: ngừng nhận request mới, dừng timer/worker, đóng kết nối sau thời gian chờ giới hạn.
- Tách cấu hình môi trường; validate biến bắt buộc, cookie Secure trên HTTPS, CORS/origin cụ thể. Kiểm tra lại PUBLIC_APP_URL và QR sau khi đổi domain.
- MongoDB phải cho app kết nối đúng địa chỉ replica-set member. Không bê nguyên địa chỉ Docker nội bộ sang mô hình máy khác mà chưa kiểm tra.
- Trong cấu hình public, không mở MongoDB/Redis ra Internet; bật cơ chế xác thực và giới hạn mạng phù hợp.
- Đưa backup, restore thử trên DB riêng và rollback phiên bản app vào runbook. Migration dữ liệu/index phải có kiểm tra trước; không tự sửa dữ liệu trùng bằng cách xóa.
- Chọn một phương án cloud dựa trên tài khoản/ngân sách có sẵn, ghi cấu hình và chi phí ước tính có ngày tham khảo; chưa có thì bàn giao cấu hình sẵn triển khai.

### Nghiệm thu

- Từ hướng dẫn, dựng được môi trường bằng các lệnh có thật trong repo.
- Browser truy cập frontend/API/Socket cùng origin, QR mở đúng phiên, cookie hoạt động qua HTTPS nếu đã deploy.
- Kiểm chứng chuỗi đặt món → KDS → thu tiền → receipt bằng ứng dụng production build.
- Báo cáo rõ đã chạy local container hay đã chạy trên cloud; không đánh đồng hai kết quả.

## 8. P3 — Giám sát và dashboard vận hành

### Công việc

- Tái sử dụng Pino để ghi structured logs: thời gian, mức log, service/instance, requestId, route mẫu, status, duration.
- Không log password, authorization, cookie, token QR/receipt hoặc toàn bộ prompt cá nhân. RequestId từ client phải được kiểm tra định dạng/độ dài hoặc thay bằng ID do server tạo.
- Đo request/giây, lỗi 5xx, lỗi 4xx/429 riêng, histogram latency theo route mẫu, kết nối socket, CPU/RAM và trạng thái dependency.
- Đo nghiệp vụ: đơn tạo mới, đơn hủy, thời gian chờ nhận/pha/phục vụ, phiên đang hoạt động. Quy định rõ thời điểm và mẫu số cho từng metric; replay không được tính là đơn/thanh toán mới.
- Không đưa orderId, participantId, prompt hoặc URL chứa ID vào nhãn metrics; dùng log để tra chi tiết tránh số lượng chuỗi metric tăng vô hạn.
- Với nhiều instance, tránh cộng trùng cùng một thống kê tổng từ DB; giao worker thu thập hoặc chọn phép tổng hợp đúng.
- Có thể dùng Prometheus + Grafana cho kỹ thuật; tích hợp dashboard nghiệp vụ vào admin hiện có bằng Recharts. Không triển khai nhiều bộ dashboard trùng nhiệm vụ.
- Tracing OpenTelemetry là phần mở rộng khi cần theo request qua nhiều thành phần; ưu tiên log + metrics hoạt động trước.
- Dashboard có khoảng thời gian, múi giờ, thời điểm cập nhật và trạng thái thiếu dữ liệu. Dữ liệu lưu UTC, hiển thị theo Asia/Ho_Chi_Minh hoặc cấu hình tương đương.
- Metrics, dashboard và chi tiết log chỉ dành cho người có quyền hoặc mạng nội bộ; không public endpoint nhạy cảm.

### Nghiệm thu

Tạo một lỗi kiểm soát trong môi trường test, tìm được log theo requestId và thấy thay đổi tương ứng trên dashboard. Chỉ số đơn/tiền khớp dữ liệu DB, không tăng gấp đôi khi replay hoặc chạy hai instance.

## 9. P4A — Tìm kiếm menu thông minh

### Thiết kế

Tái sử dụng AI Barista và bộ lọc menu hiện có. Tách phần hiểu truy vấn khỏi phần quyết định kết quả:

```text
Câu tìm kiếm
  → chuẩn hóa tiếng Việt / hiểu ý định
  → điều kiện có schema
  → backend lọc menu, variant và cấu hình hợp lệ
  → xếp hạng
  → kết quả kèm lý do và bộ lọc đã hiểu
```

### Công việc

- Hỗ trợ không dấu, từ đồng nghĩa và lỗi gõ nhẹ với phạm vi kiểm soát được.
- Xử lý câu như “cà phê không sữa dưới 40 nghìn”, “món không caffeine”, “trà trái cây ít ngọt”. Chuẩn hóa 40k/40 nghìn; phân biệt “dưới” và “không quá”.
- Schema ý định gồm từ khóa, nhóm món, maxBudget, điều kiện caffeine/sữa và sở thích vị/đường nếu dữ liệu hỗ trợ. Phân biệt điều kiện bắt buộc và sở thích để xếp hạng.
- Không coi “không cà phê” đồng nghĩa “không caffeine”. Không kết luận không sữa/không caffeine nếu thiếu dữ liệu đáng tin; không đưa cam kết an toàn dị ứng từ suy đoán AI.
- Budget mặc định theo một món và cấu hình đang chọn, hiển thị rõ. Kiểm tra lại tổng giá variant/topping khi tùy chỉnh.
- AI chỉ đề xuất cấu trúc ý định/giải thích; validate schema, giới hạn độ dài, timeout và hậu kiểm ID/giá/khả dụng ở backend. Không thực thi lệnh hoặc query do AI tự sinh.
- Kết quả rỗng phải nói rõ điều kiện không khớp; chỉ gợi ý người dùng tự sửa bộ lọc.
- Khi AI lỗi hoặc không có key, fallback tìm kiếm vẫn dùng được. UI hiển thị chế độ phù hợp, không giả vờ đã gọi AI.
- Debounce input, hủy/bỏ qua response cũ; giới hạn tần suất và chi phí AI. Tái sử dụng modal tùy chỉnh món trước khi thêm giỏ.
- Không mặc định bổ sung vector database cho menu nhỏ. Chỉ thêm embedding sau khi có bằng chứng tìm kiếm hiện tại không đáp ứng và có tập đánh giá.

### Nghiệm thu

- Có ít nhất 20 truy vấn kiểm thử bao phủ không dấu, typo, phủ định, giá biên, hết món/size và không có kết quả.
- Bộ kiểm thử không có món vi phạm điều kiện bắt buộc; đo chất lượng top-k theo đáp án được xác định trước.
- Ghi kết quả fallback và live riêng. Test live chưa chạy phải được ghi rõ.

## 10. P4B — Phát hiện bất thường và AI giải thích

### Thiết kế

**Bộ phát hiện tạo tín hiệu có bằng chứng; AI giải thích tín hiệu đó.** Giai đoạn đầu dùng quy tắc và thống kê, không gọi đây là mô hình ML đã huấn luyện.

Các tình huống nên hỗ trợ:

| Tín hiệu | Dữ liệu cần dùng | Diễn giải được phép |
| --- | --- | --- |
| API lỗi tăng | Số lỗi/tổng request trong cùng cửa sổ | Endpoint và khoảng thời gian có vấn đề |
| Phản hồi chậm | p95, số mẫu, số request | Độ trễ tăng so với baseline |
| Pha chế chậm | Timestamp chuyển trạng thái và số đơn | Nhóm món/hàng chờ cần kiểm tra |
| Tỷ lệ hủy tăng | Số đơn hủy và tập đơn được định nghĩa rõ | Biến động có đủ dữ liệu để cảnh báo |

### Công việc

- Viết định nghĩa từng detector: cửa sổ thời gian, baseline, số mẫu tối thiểu, ngưỡng và độ nghiêm trọng. Ngưỡng phải cấu hình được.
- Khi dữ liệu ít hoặc chưa có baseline, hiển thị “chưa đủ dữ liệu”; không suy luận lịch sử không tồn tại.
- Dùng job định kỳ, không gọi LLM trên từng HTTP request. Khử trùng cảnh báo bằng detector + đối tượng + cửa sổ thời gian; có cooldown và trạng thái đã xử lý.
- Lưu thời gian phát hiện, khoảng dữ liệu, giá trị quan sát, ngưỡng/baseline, phương pháp và bằng chứng tổng hợp.
- AI nhận dữ liệu tổng hợp tối thiểu, trả JSON có schema: tóm tắt, bằng chứng, giả thuyết nguyên nhân, bước kiểm tra. Không gán độ chắc chắn giả hoặc khẳng định nguyên nhân khi chỉ có tương quan.
- AI không có quyền hủy đơn, hoàn tiền, đổi giá hay tự thay cấu hình. Nội dung người dùng/log được coi là dữ liệu, không phải chỉ thị cho AI.
- Có timeout, hạn mức gọi và lời giải thích theo mẫu khi provider lỗi. Cảnh báo vẫn xuất hiện kể cả khi AI không hoạt động.
- Dashboard ADMIN hiển thị bằng chứng cạnh giải thích; audit việc xác nhận/đóng cảnh báo nếu có thao tác này.

### Nghiệm thu

Dùng dữ liệu synthetic có nhãn trong DB test: tình huống bình thường, spike lỗi, đơn chậm, quá ít mẫu và provider timeout. Báo cáo số cảnh báo đúng/sai và độ trễ phát hiện trên tập này; không suy rộng độ chính xác sang hoạt động quán thật.

## 11. P5A — Cân bằng tải hai backend

### Công việc

- Thêm profile/config chạy A và B sau reverse proxy; log instanceId để chứng minh request đến cả hai process.
- Danh tính, idempotency và dữ liệu nghiệp vụ nằm trong kho dùng chung, không phụ thuộc RAM riêng một process.
- Dùng Socket.IO adapter tương thích để gửi sự kiện qua các instance. Nếu giữ HTTP long-polling thì cấu hình sticky session; Redis adapter không tự thay thế yêu cầu này.
- Kiểm tra cả emit và thu hồi/ngắt kết nối guest trên instance khác. Không để client đã bị thu hồi tiếp tục nhận dữ liệu.
- Chuyển rate limiter cần hiệu lực toàn hệ thống sang store dùng chung. Xử lý IP proxy đúng; không vô tình gom tất cả khách thành một IP hoặc cho phép giả IP để vượt hạn mức.
- Cho idle sweeper/anomaly scheduler chạy trong worker riêng một replica ở bản demo, hoặc dùng lease/lock có TTL, ownership và gia hạn nếu cần nhiều worker. Vẫn cần cập nhật dữ liệu idempotent/atomic, vì khóa không thay thế transaction.
- Kiểm tra trường hợp sweeper chạy trùng thời điểm khách đặt món; không được đóng phiên có đơn hợp lệ.
- Quy định hành vi Redis mất kết nối: báo degraded, bảo toàn quy tắc nghiệp vụ và dùng polling/reconnect phù hợp. Không im lặng nới lỏng rate limit bảo vệ auth/AI.
- Cache menu là tùy chọn sau khi đo: có TTL và invalidation khi cập nhật menu; đặt món luôn xác minh giá/khả dụng từ nguồn chuẩn.

### Nghiệm thu

- Khách nối A, staff nối B vẫn nhận đúng sự kiện và quyền truy cập.
- Tắt A trong môi trường demo: B tiếp tục nhận request khi proxy phát hiện lỗi; client reconnect và đồng bộ lại dữ liệu.
- Retry request không tạo đơn/Bill/thanh toán trùng. Ghi nhận khoảng gián đoạn thực tế, không tuyên bố zero downtime khi chưa đo.
- Chạy hai instance không nhân đôi job, metric nghiệp vụ hoặc cảnh báo.

## 12. P5B — Kiểm thử tải và mục tiêu 600–700 request/giây

### Nguyên tắc

600–700 request/giây là **mục tiêu thử nghiệm**, không phải năng lực đã có hoặc điều kiện bắt buộc để mọi tính năng khác được nghiệm thu. Đạt hay không phụ thuộc endpoint, cấu hình, dataset và tải đọc/ghi. Không thêm server chỉ dựa trên con số mong muốn.

Phân biệt máy tạo tải và server ứng dụng. Chỉ chia tải sinh request sang nhiều máy khi máy tạo tải hiện tại đã là giới hạn; tổng hợp đúng kết quả và công bố tổng tải thực tế.

### Công việc

- Viết kịch bản k6 hoặc công cụ tương đương trong `scripts/load/`, có cấu hình target và dữ liệu test riêng.
- Tạo sẵn dữ liệu benchmark có kích thước công bố; dùng cookie/token và participant riêng, không dùng chung cookie làm sai mô hình nhiều khách.
- Có ba kịch bản: đọc menu; luồng khách hợp lệ có đọc/ghi; realtime nhiều kết nối. Trình tự nghiệp vụ phải hợp lệ, không bắn thanh toán ngẫu nhiên vào đơn chưa phục vụ.
- Khai báo tỷ lệ request từng endpoint. Có thể dùng hỗn hợp ví dụ 80% đọc, 15% thao tác khách và 5% staff, nhưng phải mô tả cách duy trì trạng thái nghiệp vụ.
- Chạy đường cơ sở, sau đó tăng theo bậc 25 → 50 → 100 → 200 → 400 → 600 → 700 RPS nếu môi trường còn đáp ứng. Cấu hình thời gian warm-up, mỗi bậc và thời gian đo, giữ giống nhau khi so sánh.
- Đo offered load, achieved RPS, dropped iterations, p50/p95/p99, lỗi bất ngờ, 429, CPU/RAM và tài nguyên DB. Số người dùng đồng thời không đồng nghĩa RPS.
- Ngưỡng tham khảo ban đầu cho API thường: lỗi bất ngờ <1%, p95 đọc <500 ms, p95 ghi <1.000 ms. Đây là mục tiêu đề xuất, không là kết quả hay cam kết; chốt trước khi benchmark, không sửa để che lần chạy thất bại.
- Đo AI live riêng với giới hạn ngân sách; dùng mock/fallback cho tải lớn và gắn nhãn rõ. Kết quả mock không đại diện độ trễ/chi phí provider thật.
- Đánh giá rate limit riêng. Nếu cần profile benchmark điều chỉnh hạn mức, chỉ áp dụng môi trường test, công bố khác biệt với production và không tự tắt bảo vệ ở môi trường public.
- So sánh một và hai backend trên tài nguyên được mô tả: nếu tổng CPU/RAM thay đổi phải nêu rõ. Kiểm tra index/query và nghẽn DB trước khi kết luận cần scale thêm.
- Kiểm tra dữ liệu sau chạy: đơn/Bill/payment không trùng, tổng tiền khớp, không có đơn trái trạng thái hoặc lộ dữ liệu khách khác.
- Load test chỉ trên môi trường thuộc quyền kiểm soát và trong giới hạn dịch vụ được phép; dừng nếu ảnh hưởng môi trường dùng thật.

### Báo cáo bắt buộc

`docs/performance-report.md` ghi ngày, commit, OS/runtime, CPU/RAM, topology, cấu hình Mongo/Redis, dataset, công cụ/lệnh, endpoint mix, warm-up, thời lượng, thresholds, kết quả đạt/không đạt và giới hạn. Lưu raw output không chứa secret trong vị trí artifact được mô tả.

Không đạt 700 RPS: báo mức tải bền vững thực đo, nút nghẽn có bằng chứng và đề xuất bước tiếp theo. Không đổi sang API health/menu cache rồi gán kết quả cho toàn hệ thống.

## 13. Thiết kế giao diện và trải nghiệm xuyên suốt

- Tái sử dụng design system, UI primitives, màu sắc và typography hiện có; bảo đảm tương phản, focus bàn phím và nhãn điều khiển.
- Khách: tìm kiếm dễ thấy, bộ lọc đã hiểu có thể sửa, trạng thái kết nối, loading/empty/error và retry rõ ràng. Không yêu cầu khách hiểu thuật ngữ Redis, anomaly hay trace.
- Staff: giữ luồng KDS/bàn gọn, thông báo chậm phục vụ nếu có phải hỗ trợ thao tác, không làm nghẽn màn hình với biểu đồ kỹ thuật.
- Admin: tách chỉ số kinh doanh, vận hành và cảnh báo; mỗi cảnh báo có số liệu, khoảng thời gian, mức độ và hành động kiểm tra.
- Phân biệt dữ liệu thật, dữ liệu demo và dữ liệu chưa có; không dùng số ngẫu nhiên để dashboard trông hoàn chỉnh.
- Xác minh màn hình chính ở 375/768/1440 px, không tràn ngang, modal/nút dùng được trên điện thoại. Kiểm tra reconnect, request chậm và nhấn gửi nhiều lần.

## 14. CI/CD, kiểm thử và bàn giao

### Pipeline

- Tạo workflow cho nền tảng Git thực tế; nếu chưa xác định có thể chuẩn bị cấu hình mẫu và ghi rõ chưa kích hoạt.
- CI dùng Node tương thích repo và `npm ci`, chạy lint, typecheck, unit/client/integration và production build. Tách job nếu cần môi trường Mongo replica set.
- Các script hiện có tại lúc soạn:

```text
npm run lint
npm run typecheck
npm run test:server
npm run test:client
npm run test:integration
npm run build
npm run test:e2e
```

- Đọc cấu hình trước khi chạy E2E; sự tồn tại của script không chứng minh suite đã được cấu hình đầy đủ. Không chạy test trỏ vào DB người dùng.
- Giữ cách cô lập Vitest/Mongoose phù hợp; bộ nhớ ghi `isolate: true`, `singleFork: false`, `maxForks: 1` để tránh dùng chung model giữa các file integration.
- Chỉ triển khai bản đã qua kiểm tra; image có tag theo commit, secret lấy từ môi trường triển khai, có health check sau deploy và phiên bản để rollback.

### Bộ kiểm thử trọng tâm

1. QR auto-open đồng thời, cùng bàn cùng phiên; rescan không mất ownership.
2. Hai khách cùng bàn, một khách không truy cập dữ liệu khách còn lại.
3. Giá/variant/topping, CHECKOUT, transition và tranh chấp đặt đơn/đóng phiên.
4. Idempotency đặt đơn/thanh toán qua hai instance, Bill đúng một lần.
5. Socket khác instance, reconnect, thu hồi phiên và fallback polling.
6. Worker chạy lại, hai lượt quét chồng nhau, không nhân đôi tác dụng nghiệp vụ.
7. Tìm kiếm giữ ràng buộc; AI invalid/timeout/off; anomaly ít mẫu và spike có nhãn.
8. Dashboard/metrics đúng quyền; log không lộ credential; refresh token không lặp vô hạn.
9. Luồng browser từ QR đến receipt và đánh giá trên production build.

### Tài liệu bàn giao

Cập nhật hoặc tạo nội dung đúng vai trò, không sao chép những đoạn dài giữa nhiều file:

- `README.md`: cách chạy nhanh và các chế độ.
- `docs/architecture.md`: topology và ranh giới module thực tế.
- `docs/architecture-decisions.md`: lựa chọn, phương án thay thế và đánh đổi.
- `docs/deployment.md`: cấu hình cloud, HTTPS, backup/restore, rollback.
- `docs/observability.md`: metric, dashboard, alert, xử lý lỗi.
- `docs/ai-design.md`, `docs/ai-evaluation.md`: tìm kiếm/anomaly, fallback, dữ liệu và kết quả đánh giá.
- `docs/performance-report.md`: số liệu tải và giới hạn thực đo.
- `docs/test-report.md`: kết quả mới, lệnh và phần chưa kiểm chứng.
- `docs/demo-script.md`: kịch bản trình diễn ngắn, có bước kiểm tra trước demo.
- `.env.example`: biến cấu hình có chú thích, không chứa secret thật.
- `PROJECT_MEMORY.md`: trạng thái mới, quyết định, file quan trọng, lỗi còn lại và việc chưa thực hiện.

## 15. Điều kiện hoàn thành và cách báo cáo

- [ ] P0: đã khảo sát, ghi baseline và xử lý mâu thuẫn tài liệu liên quan.
- [ ] P1: module/contracts/nghiệp vụ có test hồi quy, luồng cũ vẫn hoạt động.
- [ ] P2: production build chạy qua proxy; trạng thái triển khai cloud được ghi đúng.
- [ ] P3: log và dashboard dùng số liệu thật, có phân quyền.
- [ ] P4A: tìm kiếm tiếng Việt và fallback được đánh giá bằng tập truy vấn.
- [ ] P4B: detector có bằng chứng, AI giải thích có fallback, không tự thao tác nghiệp vụ.
- [ ] P5A: hai backend chia sẻ realtime, rate limit và job đúng thiết kế.
- [ ] P5B: báo cáo tải có ngưỡng, cấu hình và kết quả đo; không bắt buộc báo đạt 700 RPS.
- [ ] P6: CI, test, tài liệu, demo và bộ nhớ dự án được cập nhật.

Cuối mỗi giai đoạn báo ngắn: đã thay đổi gì, vì sao, kiểm chứng thế nào, còn hạn chế gì. Không dừng ở một kế hoạch nếu còn công việc đã được phép và có thể thực hiện. Nếu thiếu quyền cloud/key/ngân sách, hoàn thiện phần độc lập và nêu chính xác phần đang chờ.

Khi kết thúc, phân biệt rõ **đã triển khai**, **đã kiểm thử**, **đã chạy cloud**, **chỉ mới chuẩn bị cấu hình** và **chưa làm**. Không gắn nhãn production-ready hoặc high availability chỉ vì chạy được Docker hay hai process.

## 16. Tài liệu kỹ thuật tham khảo

- Socket.IO multi-node, adapter và sticky session: https://socket.io/docs/v4/using-multiple-nodes/
- Nền tảng observability: https://opentelemetry.io/docs/concepts/observability-primer/
- Ngưỡng nghiệm thu kiểm thử tải k6: https://grafana.com/docs/k6/latest/using-k6/thresholds/

Khi lựa chọn package/provider hoặc cấu hình triển khai cụ thể, tra tài liệu chính thức theo version sử dụng; không giả định mọi ví dụ trên mạng tương thích với repository.
