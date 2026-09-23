# Triển khai — Mây Café

## Production build local qua reverse proxy

Cấu hình `compose.production.yaml` chạy sáu service:

- `web`: Nginx phục vụ cùng một React production build qua ba portal tách biệt: Guest `8080`, Staff `8081`, Admin `8082`; mỗi cổng chỉ proxy nhóm API đúng vai trò.
- `server-a`, `server-b`: hai Node.js 24 LTS chạy Express/Socket.IO; Nginx round-robin REST và giữ Socket.IO sticky theo địa chỉ client.
- `worker`: cùng image Node.js nhưng chỉ chạy idle-session sweeper và anomaly scheduler; không phục vụ HTTP.
- `mongo`: MongoDB 7 replica set một node; không publish cổng ra host trong cấu hình này.
- `redis`: Redis 7 dùng AOF; làm Socket.IO adapter, rate-limit store và kho aggregate HTTP theo phút; không publish cổng ra host.

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

Không chạy `npm run seed` tự động trong image. Nếu cần dữ liệu demo, thực hiện có chủ ý sau khi kiểm tra đúng database; seed sẽ thay dữ liệu hiện có.

## Health và shutdown

- Public `GET /healthz` là liveness của Nginx/web. Backend có `/healthz` riêng trong private network.
- Backend `GET /readyz` chỉ được gọi trong private network/healthcheck Compose; Nginx không proxy route này. Nó ping MongoDB và Redis với timeout ngắn. Mongo lỗi trả 503; Redis lỗi trả 200 trạng thái `degraded` để menu/read còn phục vụ, trong khi mutation có limiter không tự nới bảo vệ. AI lỗi không làm service mất readiness.
- `SHUTDOWN_TIMEOUT_MS`: thời gian chờ request đang chạy trước khi đóng cưỡng bức connection còn lại.
- `TRUST_PROXY_HOPS=1` chỉ dùng khi backend nằm đúng một hop sau Nginx. Chạy backend trực tiếp phải dùng `0`.

## Metrics và vận hành

- Prometheus scrape `GET /metrics` trực tiếp từ từng service `server-a`/`server-b` trong private network. Nginx không proxy endpoint này.
- Admin xem số liệu vận hành tại `/admin/operations`; API `/api/v1/admin/operations/summary` bắt buộc vai trò `ADMIN`.
- Có thể đặt `INSTANCE_ID`; Compose gán `server-a`, `server-b`, `worker-1` để log/metric phân biệt rõ.
- Quy tắc tổng hợp, định nghĩa metric và cách tránh cộng trùng số liệu database nằm tại [observability.md](observability.md).

## HTTPS/cloud

Khi đặt sau load balancer hoặc reverse proxy HTTPS:

1. Đặt `PUBLIC_APP_URL=https://order.<domain>`, `STAFF_APP_URL=https://staff.<domain>`, `ADMIN_APP_URL=https://admin.<domain>` và `COOKIE_SECURE=true`.
2. Giữ frontend, API và Socket.IO cùng origin; proxy phải hỗ trợ WebSocket upgrade.
3. Không public MongoDB; dùng network riêng và authentication phù hợp với nền tảng.
4. Chỉ đặt `TRUST_PROXY_HOPS` bằng số proxy thực tế, không tin tùy ý `X-Forwarded-For` từ Internet.
5. Thay hai JWT secret bằng secret manager; không đưa chúng vào image hoặc repository.

Repository hiện mới có cấu hình production local. Chưa có bằng chứng đã triển khai cloud hoặc HTTPS thật.

## Kết quả production-local ngày 22/09/2026

- Image server Node.js 24 LTS và web build thành công trên Docker Engine 29.7.2.
- MongoDB, Redis, hai backend và web healthy; worker chạy riêng một bản. Nginx publish `8080`, các dependency/backend chỉ ở mạng nội bộ Compose.
- Frontend, SPA deep-link, REST proxy, readiness và Socket.IO WebSocket đã hoạt động qua cùng origin.
- Luồng seed → QR → order → KDS states → checkout → payment → Bill → receipt đã PASS trên volume riêng.
- SIGTERM đóng backend sạch với exit code 0 trong khoảng 0,5 giây và restart trở lại healthy.
- 20 request health được chia 10/10 qua A/B. Dừng A rồi gửi 20 request: 20/20 được B phục vụ, trung bình khoảng 102 ms, tối đa 1.036 ms sau khi cấu hình retry proxy; đây là failover local, không phải zero downtime hay HA cả máy.
- Shared Redis limiter: 35 lần login sai qua hai backend cho kết quả 30×401 và 5×429. Redis dừng thì menu đọc vẫn 200, mutation được bảo vệ không silently fail-open, readiness báo degraded.
- Smoke test cross-instance: guest socket nối A nhận event từ mutation qua B; thu hồi session ở B làm socket A bị ngắt.

Đây là bằng chứng chạy local container, không phải bằng chứng cloud deployment, HTTPS hay high availability.

## Triển khai cloud còn cần từ chủ dự án

Cấu hình hiện đã sẵn để triển khai nhưng chưa tạo tài nguyên cloud. Trước khi thực hiện cần: nhà cung cấp/tài khoản cloud có quyền tạo dịch vụ, khu vực triển khai, ngân sách hoặc giới hạn chi phí, domain và quyền DNS, lựa chọn MongoDB/Redis managed hay tự quản, secret production (JWT mới; không dùng secret local), cùng quyền GitHub repository nếu muốn CD. Chỉ tạo tài nguyên tính phí sau khi chủ dự án chốt nhà cung cấp và ngân sách.

Sau deploy phải bật HTTPS, `COOKIE_SECURE=true`, đặt ba URL portal và `SERVER_ORIGIN` đúng domain, dùng secret manager, private network cho Mongo/Redis, health check sau release và tag image theo commit. Replica set một node trong Compose không chịu được lỗi host và không phải mô hình database HA cho cloud.

## Backup, restore và rollback

- Trước thay đổi schema/index, tạo backup bằng công cụ MongoDB của môi trường triển khai.
- Thử restore trên database riêng; không kiểm tra restore bằng cách ghi đè database demo/production.
- Image triển khai cần được gắn tag theo commit. Rollback bằng cách chạy lại tag trước đó; thay đổi dữ liệu không tương thích phải có kế hoạch migration ngược riêng.
- Replica set một node chỉ cung cấp transaction, không cung cấp high availability khi máy chủ hỏng.
