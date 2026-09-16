# Kiến trúc — Mây Café

## Tổng quan

Hệ thống MERN phân tầng rõ ràng:

```
React client  ──HTTP/Socket──►  Express API
                                  │
                                  ▼
                          Controllers (HTTP)
                                  │
                                  ▼
                          Services (business)
                          ┌───────┴───────┐
                          ▼               ▼
                    Repositories      Providers (AI)
                          │               │
                          ▼               ▼
                     Mongoose ──► MongoDB replica set
                          │
                          ▼
                  UnitOfWork / transactions
```

Một request đặt món đi qua các tầng:

1. **Route** `/api/v1/orders` (`server/src/routes/index.ts`) gắn middleware:
   - `loadGuest` đọc cookie `mc_guest`, sinh `req.guest` (id, tableSessionId, participantId) hoặc null.
   - `guestCsrfGuard` kiểm tra Origin/Referer.
   - `guestMutationLimiter` rate limit theo IP.
   - `requireGuest` chặn nếu chưa có phiên.
2. **Controller** `orderController.place` (`server/src/controllers/orderController.ts`):
   - Parse body với Zod schema `placeOrderRequestSchema`.
   - Bắt buộc header `Idempotency-Key`.
   - Gọi `orderService.placeOrder`.
   - Trả `{ success, data: { order, created } }` với status 201 (mới) hoặc 200 (replay).
3. **Service** `orderService.placeOrder` (`server/src/services/orderService.ts`):
   - Kiểm tra idempotency: nếu đã có đơn với cùng `(tableSessionId, idempotencyKey)`:
     - Cùng hash → trả lại (`created=false`).
     - Khác hash → 409 `IDEMPOTENCY_CONFLICT`.
   - Gọi `guestCanOrder` để chắc chắn phiên còn OPEN.
   - Lấy products + toppings từ DB (server-side pricing).
   - Tính `unitPrice = variant.price + Σ topping.price`, `lineTotal = unitPrice × qty`.
   - Snapshot name, variantName vào order items để không phụ thuộc menu sau này.
   - Tạo đơn trong `unitOfWork.withTransaction` (đảm bảo atomicity).
   - Audit log.
4. **Repository** `orderRepository.createWithSession` truyền `ClientSession` xuống Mongoose.
5. **Realtime:** Sau commit, controller có thể gọi `publishSession` để emit `order.created` (P1 hoàn thiện).
6. **Models** `OrderModel` validate schema, index `(tableSessionId, idempotencyKey)` unique.

## Phân quyền

| Route | Middleware |
| --- | --- |
| `/api/v1/auth/*` | `authLimiter` (rate limit 30/phút) |
| `/api/v1/orders` (POST) | `loadGuest` + `guestCsrfGuard` + `requireGuest` |
| `/api/v1/staff/*` | `requireAuth` + `requireRole('STAFF','ADMIN')` |
| `/api/v1/admin/*` | `requireAuth` + `requireRole('ADMIN')` |
| `/api/v1/ai/*` | `loadGuest` + in-memory rate limit 30/5 phút |

## Quyết định & đánh đổi

- **Express độc lập với Socket.IO** chứ không phải Next.js-only. Socket.IO có middleware xác thực riêng, đối chiếu với `GuestSession`/`RefreshSession`.
- **Không dùng DI framework** — DI bằng constructor/factory. Repository là object có method, dễ stub trong test.
- **UnitOfWork** đơn giản: `mongoose.startSession()` + `withTransaction`. Repository nhận session tùy chọn.
- **Idempotency**: bắt buộc header `Idempotency-Key` cho POST đơn và thanh toán. Hash payload để phát hiện gửi lại khác payload.
- **Snapshot giá/tên món** vào order items để sửa menu không làm đổi hóa đơn cũ.
- **AI fallback** luôn chạy được kể cả khi không có API key. Mỗi response có `mode: 'llm' | 'fallback'` để UI/audit biết.
- **Tailwind + Radix + Lucide** thay cho shadcn/ui scaffold; vẫn giữ nguyên tắc accessible semantic.
- **React Router DOM v6** cho SPA; tách layout theo nhóm người dùng.
- **Zustand** cho giỏ hàng cục bộ; persist qua `localStorage` với key `mc-cart`. Cookie guest quản lý danh tính server-side.
- **TanStack Query** làm data layer client; polling dự phòng khi socket reconnect.

## Thư mục chính

```
server/src/
├── app.ts                 # Express setup, xuất app cho test
├── server.ts              # HTTP + Socket.IO + lifecycle
├── config/                # env loader
├── routes/                # REST endpoints
├── controllers/           # HTTP I/O
├── services/              # business rules
├── repositories/          # Mongo access
├── models/                # Mongoose schemas
├── providers/             # external integrations (AI)
├── realtime/              # Socket.IO setup + publishers
├── infrastructure/        # mongo, logger, UnitOfWork
├── middlewares/           # auth, guest, error
├── errors/                # AppError + subclasses
├── seeds/                 # seed dữ liệu demo
└── __tests__/             # unit + integration

client/src/
├── app/                   # (chỉ main.tsx + App.tsx)
├── components/ui/         # Button, Card, Modal, Toast, ...
├── layouts/               # GuestLayout, StaffLayout, AdminLayout
├── features/
│   ├── guest/             # Menu, Cart, Orders, Join
│   ├── ai/                # AI Barista sheet
│   ├── staff/             # KDS, Tables, Service Requests
│   ├── admin/             # Dashboard, Products, Categories, ...
│   └── auth/              # Login, RequireAuth, useAuth
├── lib/                   # api client, socket client, cart store
└── styles/                # Tailwind + tokens
```
