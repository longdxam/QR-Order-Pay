# Observability và dashboard vận hành

Cập nhật: 23/09/2026. Phạm vi hiện tại là hai API Guest, hai API Internal, ba worker theo vai trò, Redis và MongoDB của production-local; chưa triển khai Prometheus/Grafana hoặc hệ thống log tập trung trên cloud.

## Điểm truy cập và phân quyền

- `GET /metrics` trả định dạng Prometheus từ backend. Nginx production **không proxy** đường dẫn này và service backend không publish cổng ra host, nên endpoint chỉ dành cho mạng nội bộ Compose. Nếu triển khai Prometheus, đặt scraper trong private network; không thêm public ingress cho endpoint này.
- `GET /api/v1/admin/operations/summary` yêu cầu access token có vai trò `ADMIN`. Trang `/admin/operations` dùng endpoint này, tự làm mới mỗi 30 giây và hiển thị thời gian theo `Asia/Ho_Chi_Minh`.
- Public `/healthz` kiểm tra Nginx/web; mỗi backend có `/healthz` và `/readyz` trong private network. Readiness ping MongoDB và Redis: Mongo lỗi trả 503; Redis lỗi trả 200 với trạng thái tổng `degraded`, đồng thời limiter mutation không tự fail-open.
- Log JSON đi ra stdout/stderr để runtime thu thập. Tìm request bằng `requestId`; log có `service`, `instance`, route mẫu, status và duration.

## Định nghĩa metric

| Metric / số liệu | Định nghĩa | Phạm vi và cách tổng hợp |
| --- | --- | --- |
| `maycafe_http_requests_total` | Tăng khi response kết thúc; nhãn `method`, route mẫu, `status_class`, `outcome`. `outcome=rate_limited` tách riêng HTTP 429. RPS dùng `rate(...[5m])`. | Counter theo instance; cộng giữa instance. |
| `maycafe_http_request_duration_seconds` | Histogram thời gian từ lúc vào middleware đến khi response kết thúc. Không chứa URL/ID thật. | Histogram theo instance; cộng bucket rồi tính quantile. |
| `maycafe_business_events_total` | Chỉ tăng sau thay đổi nghiệp vụ thành công: đơn mới/hủy/phục vụ, thanh toán mới, phiên mới, yêu cầu phục vụ tạo/đóng. Replay order/payment không tăng. | Counter theo instance; cộng giữa instance. |
| `maycafe_order_stage_duration_seconds` | `acceptance`: PENDING→CONFIRMED; `preparation`: PREPARING→READY; `service`: READY→SERVED. Mỗi transition thành công là một mẫu; đơn chưa hoàn thành công đoạn không nằm trong mẫu số. | Histogram theo instance; cộng bucket giữa instance. |
| `maycafe_socket_connections` | Số socket đã xác thực hiện tại, tách `guest` và `staff`. | Gauge theo instance; cộng để lấy tổng cluster. |
| `maycafe_dependency_ready` | Kết quả readiness gần nhất cho MongoDB và Redis: 1 sẵn sàng, 0 gián đoạn. | Gauge theo dependency/instance; dùng `min` để phát hiện instance lỗi. |
| `maycafe_process_*` | Metric mặc định của Node.js: CPU, RSS/heap, event loop, GC và thông tin runtime. | Theo instance; không cộng các gauge bộ nhớ nếu muốn xem từng instance. |
| Active sessions/orders/service requests | Query trực tiếp MongoDB tại thời điểm mở dashboard Admin. `oldestQueueAgeSeconds` tính từ đơn active cũ nhất. | Scope `database`; khi có nhiều instance phải dùng một giá trị hoặc `max`, tuyệt đối không `sum` các bản sao dashboard. |

Counter trong dashboard là số từ lúc instance khởi động và có `instanceId`, `startedAt`; chúng không được trình bày như tổng lịch sử trong database. Các số hàng đợi có `scope=database` để phân biệt rõ.

Anomaly HTTP là luồng riêng với Prometheus: mỗi API ghi số mẫu, tổng lỗi và histogram duration theo route/status vào bucket Redis theo phút; worker đọc các bucket của current/baseline window rồi đánh giá một lần. Đây là aggregate xấp xỉ p95 bằng bucket, không phải trace từng request. Dữ liệu có TTL; nếu Redis mất, detector báo thiếu dữ liệu thay vì suy diễn bình thường.

## An toàn dữ liệu và cardinality

- Nhãn metrics chỉ có tập giá trị hữu hạn. Route dùng mẫu Express như `/staff/orders/:id/status`; request không khớp dùng `unmatched`.
- Không đưa `orderId`, `participantId`, prompt, query string, QR/receipt token hoặc URL chứa ID vào nhãn.
- Pino redact `authorization`, cookie, `set-cookie`, password, token, API key và secret. Request ID do client gửi bị giới hạn 64 ký tự và tập ký tự an toàn; giá trị khác được thay bằng UUID.
- `INSTANCE_ID` là tùy chọn; nếu bỏ trống, server dùng hostname của máy/container.

## Kiểm chứng production-local 22/09/2026

- Image chạy Node.js 24 LTS; `GET /metrics` bên trong container trả 200 và có HTTP/stage metrics.
- `http://localhost:8080/metrics` trả SPA HTML, không lộ Prometheus endpoint qua Nginx.
- Gửi lỗi kiểm soát 404 với `x-request-id: p3-controlled-error`: log tìm được đúng request ID, route `unmatched`, status 404; `clientErrors` trên Admin summary tăng từ 3 lên 4.
- Admin summary trả `mongodbReady=true`, dữ liệu hàng đợi thật từ MongoDB và `scope=instance`/`scope=database` rõ ràng.
- Unit test kiểm tra route labels không chứa ID/URL thật, socket gauge không âm và stage metrics; integration test xác nhận payment replay không tăng `payment_confirmed` lần hai.
- Với bốn backend chia hai pool, event Socket.IO và thu hồi phiên đi qua Redis adapter; realtime worker phát notification qua Redis emitter. Rate limit và menu cache dùng chung giữa các pool. Scheduler, realtime và report chạy ở ba process riêng; leader lease ngăn nhân đôi scheduler, còn queue owner lease ngăn hai consumer ACK cùng job.
- Admin Operations hiển thị pending/processing, tuổi job cũ nhất, lease processing quá hạn, mẫu retry, Redis RAM/key count và heartbeat/progress/job đang chạy của từng worker. Healthcheck dùng heartbeat TTL; job dài gia hạn lease đồng thời cập nhật tiến triển.
