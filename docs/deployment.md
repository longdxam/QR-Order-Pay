# Triển khai — Mây Café

## Production build local qua reverse proxy

Cấu hình `compose.production.yaml` chạy tám service:

- `web`: Nginx phục vụ cùng một React production build qua ba portal tách biệt: Guest `8080`, Staff `8081`, Admin `8082`; mỗi cổng chỉ proxy nhóm API đúng vai trò.
- `server-guest-a`, `server-guest-b`: pool Node.js 24 LTS chỉ nhận traffic từ portal Guest qua Nginx.
- `server-internal-a`, `server-internal-b`: pool Node.js 24 LTS riêng cho Staff/Admin, có `cpu_shares` cao gấp ba pool Guest để được ưu tiên khi CPU tranh chấp.
- `worker`: cùng image Node.js nhưng không phục vụ HTTP; xử lý hàng đợi báo cáo/CSV, thông báo realtime, idle-session sweeper và anomaly scheduler.
- `mongo`: MongoDB 7 replica set một node; không publish cổng ra host trong cấu hình này.
- `redis`: Redis 7 dùng AOF; làm Socket.IO adapter/emitter, hàng đợi worker có retry/dead-letter, cache menu, rate-limit store và kho aggregate HTTP theo phút; không publish cổng ra host.

Pool Guest và Internal dùng chung MongoDB/Redis nhưng không dùng chung Node process. Compose giới hạn mặc định mỗi API ở `0.75 CPU / 384 MiB`; Guest có `cpu_shares=512`, Internal có `cpu_shares=1536`. Worker và Nginx cũng có giới hạn riêng. Có thể chỉnh các biến `GUEST_API_*`, `INTERNAL_API_*`, `WORKER_*`, `WEB_*` trong môi trường theo cấu hình máy.

Nginx 1.27 dùng Docker DNS resolver động cho bốn upstream. Khi một backend container được recreate và đổi IP, mapping Guest/Internal được cập nhật mà không cần restart Nginx; app-level traffic guard vẫn trả 404 nếu proxy bị cấu hình gọi chéo.

Compose đặt project name cố định `maycafe-production`, tách container/network/volume khỏi `compose.yaml` dùng cho môi trường dev.

Tạo `.env.production` (đã được Git bỏ qua):

```dotenv
PUBLIC_APP_URL=http://localhost:8080
STAFF_APP_URL=http://localhost:8081
ADMIN_APP_URL=http://localhost:8082
COOKIE_SECURE=false
JWT_ACCESS_SECRET=<chuỗi ngẫu nhiên tối thiểu 32 ký tự>
JWT_REFRESH_SECRET=<chuỗi ngẫu nhiên khác, tối thiểu 32 ký tự>
AI_MODE=fallback
```

Khởi động và kiểm tra:

```bash
docker compose -f compose.production.yaml --env-file .env.production up -d --build
docker compose -f compose.production.yaml ps
curl http://localhost:8080/healthz
curl http://localhost:8080/api/v1/health
curl http://localhost:8081/healthz
curl http://localhost:8082/healthz
```

Các portal local:

- Guest/QR: `http://localhost:8080`
- Staff/KDS: `http://localhost:8081`
- Admin: `http://localhost:8082`

Nginx trả `404` nếu gọi Staff/Admin API từ cổng Guest hoặc gọi chéo API giữa hai portal nội bộ. Backend vẫn kiểm tra JWT và role; tách cổng chỉ là thêm một lớp cô lập, không thay thế phân quyền. Refresh cookie dùng tên riêng theo portal để Staff và Admin có thể đăng nhập đồng thời trên cùng máy.

Traffic Guest có hai lớp chống spam: Nginx giới hạn burst/connection theo guest cookie (fallback theo IP trước khi có cookie), còn Express + Redis giới hạn join theo token bàn, gọi món theo `tableSessionId`, và yêu cầu phục vụ theo bàn. Mặc định: join `20/phút`, gọi món `12/phút`, yêu cầu phục vụ `6/phút`; tất cả có thể chỉnh bằng biến `RATE_LIMIT_GUEST_*`.

Menu/sản phẩm công khai được cache Redis mặc định 60 giây. Mọi thay đổi product/category/topping từ Admin tăng cache generation ngay, nên request kế tiếp không đọc catalog cũ. Nếu Redis lỗi, menu vẫn đọc trực tiếp MongoDB; mutation được bảo vệ không tự fail-open.

Dashboard Admin dùng hàng đợi worker qua `POST /api/v1/admin/reports/overview/jobs` và poll `GET /api/v1/admin/reports/jobs/:id`. Cả JSON và CSV đều được tạo ngoài API process, kết quả giữ mặc định 15 phút. Thông báo realtime cũng vào queue ưu tiên cao hơn report; worker phát qua Socket.IO Redis emitter. Job lỗi được retry rồi chuyển dead-letter.

Không chạy `npm run seed` tự động trong image. Nếu cần dữ liệu demo, thực hiện có chủ ý sau khi kiểm tra đúng database; seed sẽ thay dữ liệu hiện có.

## Health và shutdown

- Public `GET /healthz` là liveness của Nginx/web. Backend có `/healthz` riêng trong private network.
- Backend `GET /readyz` chỉ được gọi trong private network/healthcheck Compose; Nginx không proxy route này. Nó ping MongoDB và Redis với timeout ngắn. Mongo lỗi trả 503; Redis lỗi trả 200 trạng thái `degraded` để menu/read còn phục vụ, trong khi mutation có limiter không tự nới bảo vệ. AI lỗi không làm service mất readiness.
- `SHUTDOWN_TIMEOUT_MS`: thời gian chờ request đang chạy trước khi đóng cưỡng bức connection còn lại.
- `TRUST_PROXY_HOPS=1` chỉ dùng khi backend nằm đúng một hop sau Nginx. Chạy backend trực tiếp phải dùng `0`.

## Metrics và vận hành

- Prometheus scrape `GET /metrics` trực tiếp từ bốn service `server-guest-*`/`server-internal-*` trong private network. Nginx không proxy endpoint này.
- Admin xem số liệu vận hành tại `/admin/operations`; API `/api/v1/admin/operations/summary` bắt buộc vai trò `ADMIN`.
- Có thể đặt `INSTANCE_ID`; Compose gán `server-guest-a/b`, `server-internal-a/b`, `worker-1` để log/metric phân biệt rõ. Health API trả thêm `trafficClass=guest|internal` để kiểm tra routing.
- Quy tắc tổng hợp, định nghĩa metric và cách tránh cộng trùng số liệu database nằm tại [observability.md](observability.md).

## HTTPS/cloud

Khi đặt sau load balancer hoặc reverse proxy HTTPS:

1. Đặt `PUBLIC_APP_URL=https://order.<domain>`, `STAFF_APP_URL=https://staff.<domain>`, `ADMIN_APP_URL=https://admin.<domain>` và `COOKIE_SECURE=true`.
2. Giữ frontend, API và Socket.IO cùng origin; proxy phải hỗ trợ WebSocket upgrade.
3. Không public MongoDB; dùng network riêng và authentication phù hợp với nền tảng.
4. Chỉ đặt `TRUST_PROXY_HOPS` bằng số proxy thực tế, không tin tùy ý `X-Forwarded-For` từ Internet.
5. Thay hai JWT secret bằng secret manager; không đưa chúng vào image hoặc repository.

Repository hiện mới có cấu hình production local. Chưa có bằng chứng đã triển khai cloud hoặc HTTPS thật.

## Kết quả production-local cập nhật 23/09/2026

- Image server Node.js 24 LTS và web build thành công trên Docker Engine 29.7.2.
- MongoDB, Redis, bốn backend và web healthy; worker chạy riêng một bản. Nginx publish `8080-8082`, các dependency/backend chỉ ở mạng nội bộ Compose.
- Frontend, SPA deep-link, REST proxy, readiness và Socket.IO WebSocket đã hoạt động qua cùng origin.
- Luồng seed → QR → order → KDS states → checkout → payment → Bill → receipt đã PASS trên volume riêng.
- SIGTERM đóng backend sạch với exit code 0 trong khoảng 0,5 giây và restart trở lại healthy.
- Baseline topology hai API ngày 22/09: 20 request health chia 10/10 qua A/B; khi dừng A, 20/20 request được B phục vụ. Đây là số lịch sử trước khi tách Guest/Internal, không dùng để khẳng định throughput topology mới.
- Shared Redis limiter đã được kiểm tra ở cả baseline auth và topology mới: burst Guest chỉ trả 200/429; join cùng hash token bàn đạt đúng ngưỡng 20/phút. Redis dừng thì menu đọc fallback MongoDB, còn mutation không silently fail-open.
- Socket.IO Redis adapter đã qua smoke cross-instance; topology mới bổ sung Redis emitter từ worker và queue notification được drain sạch, không có dead-letter sau payload hợp lệ.

Đây là bằng chứng chạy local container, không phải bằng chứng cloud deployment, HTTPS hay high availability.

## Triển khai cloud còn cần từ chủ dự án

Cấu hình hiện đã sẵn để triển khai nhưng chưa tạo tài nguyên cloud. Trước khi thực hiện cần: nhà cung cấp/tài khoản cloud có quyền tạo dịch vụ, khu vực triển khai, ngân sách hoặc giới hạn chi phí, domain và quyền DNS, lựa chọn MongoDB/Redis managed hay tự quản, secret production (JWT mới; không dùng secret local), cùng quyền GitHub repository nếu muốn CD. Chỉ tạo tài nguyên tính phí sau khi chủ dự án chốt nhà cung cấp và ngân sách.

Sau deploy phải bật HTTPS, `COOKIE_SECURE=true`, đặt ba URL portal và `SERVER_ORIGIN` đúng domain, dùng secret manager, private network cho Mongo/Redis, health check sau release và tag image theo commit. Replica set một node trong Compose không chịu được lỗi host và không phải mô hình database HA cho cloud.

## Backup, restore và rollback

- Trước thay đổi schema/index, tạo backup bằng công cụ MongoDB của môi trường triển khai.
- Thử restore trên database riêng; không kiểm tra restore bằng cách ghi đè database demo/production.
- Image triển khai cần được gắn tag theo commit. Rollback bằng cách chạy lại tag trước đó; thay đổi dữ liệu không tương thích phải có kế hoạch migration ngược riêng.
- Replica set một node chỉ cung cấp transaction, không cung cấp high availability khi máy chủ hỏng.
