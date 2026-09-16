# Mây Café — QR Ordering & AI Barista

Trạng thái triển khai và ghi nhớ cho lần làm việc tiếp theo: [PROJECT_MEMORY.md](PROJECT_MEMORY.md).
Kết quả kiểm chứng mới nhất: [docs/test-report.md](docs/test-report.md).

Một hệ thống MERN (MongoDB + Express + React + Node.js) đặt đồ uống qua QR tại bàn, tích hợp AI Barista tư vấn món. Mục tiêu là bài tập lớn Lập trình Web: chạy trên dữ liệu thật, kiến trúc phân tầng rõ ràng, giao diện chỉn chu, có kiểm thử, OpenAPI và tài liệu bảo vệ.

## Tính năng chính

- Quét QR / nhập mã → vào phiên bàn (do nhân viên mở).
- Thực đơn đa danh mục, tùy chỉnh size/đường/đá/topping, ghi chú.
- AI Barista gợi ý món từ menu thật theo sở thích & ngân sách (có fallback minh bạch khi không có API key).
- Giỏ hàng theo thiết bị, idempotency khi gửi đơn.
- KDS (Kitchen Display) với 4 cột trạng thái: Chờ xác nhận → Đã nhận → Đang pha → Sẵn sàng → Đã phục vụ.
- Realtime qua Socket.IO cho cả guest và staff.
- Thanh toán tại quầy với xác nhận của Staff, đóng phiên, hóa đơn.
- Hóa đơn riêng theo thiết bị và đánh giá sau thanh toán, không cấp lại quyền đặt món.
- Admin tạo ảnh QR để tải PNG/in; khách có thể dán token hoặc liên kết QR để vào bàn.
- Dashboard doanh thu (30 ngày), biểu đồ ngày/giờ, top sản phẩm.
- Đánh yêu cầu gọi nhân viên và yêu cầu thanh toán.
- Phân quyền ADMIN/STAFF/GUEST kiểm tra cả HTTP và socket.

## Stack

- **Server**: Express + Mongoose + TypeScript, JWT, bcryptjs, Socket.IO, Zod, Pino.
- **Client**: Vite + React + TypeScript, Tailwind, Radix UI, TanStack Query, Zustand, Recharts, Lucide.
- **AI**: OpenAI-compatible (mặc định) với fallback rule-based dựa trên menu.
- **Tests**: Vitest + Supertest.

## Cài đặt nhanh

```bash
npm ci
npm run db:up          # khởi MongoDB replica set
npm run db:wait        # đợi sẵn sàng
npm run seed           # seed dữ liệu demo, in QR token cho mỗi bàn
npm run dev            # chạy client + server
```

- Server: `http://localhost:4000`
- Client: `http://localhost:5173`

## Tài khoản demo (mật khẩu `MayCafe@2025`)

- `admin@maycafe.vn` (ADMIN)
- `staff.a@maycafe.vn` (STAFF)
- `staff.b@maycafe.vn` (STAFF)

Khi seed, mỗi bàn sẽ in ra một token QR. Dùng token đó tại `/t/<token>` để vào phiên.

## Scripts

| Lệnh | Mô tả |
| --- | --- |
| `npm run dev` | Chạy client + server song song |
| `npm run build` | Build production cả client + server |
| `npm run typecheck` | TypeScript typecheck toàn bộ |
| `npm run lint` | ESLint client + server |
| `npm run test` | Unit + integration tests |
| `npm run seed` | Seed lại dữ liệu demo |
| `npm run db:up` / `db:down` | Khởi/dừng MongoDB |

## Cấu trúc thư mục

```
.
├── client/                 # Vite + React
├── server/                 # Express + Mongoose
├── packages/contracts/     # Zod schema + DTO dùng chung
├── docs/                   # tài liệu dự án
├── scripts/mongo-init.js   # replica set bootstrap
├── compose.yaml            # MongoDB replica set
└── .env.example
```

Xem chi tiết tại `docs/architecture.md`, `docs/api/openapi.yaml`, `docs/ai-design.md`.

## Bảo mật & vận hành

- Mật khẩu hash bằng bcrypt.
- Access token ngắn hạn (memory), refresh token xoay được, lưu cookie HttpOnly.
- CSRF guard cho mutation của guest theo Origin/Referer.
- Ownership kiểm tra ở service: guest không đọc/huỷ đơn của thiết bị khác.
- Idempotency key bắt buộc khi tạo đơn và thanh toán.
- Rate limit cho login, mutation guest và AI.
- Structured logging với request ID.

## Hạn chế đã biết

- AI Barista fallback hoạt động đầy đủ với từ khoá tiếng Việt phổ biến (chua, đắng, ngọt, không caffeine, không sữa, ít ngọt, trái cây). Chế độ LLM cần `AI_API_KEY`.
- Thanh toán chỉ hỗ trợ "xác nhận tại quầy" trong P0.
- QR là tĩnh; bản nâng cấp P2 sẽ hỗ trợ xoay token thường xuyên.
  Hiện admin đã đổi token thủ công và tải được ảnh QR; chưa có xoay theo lịch.
