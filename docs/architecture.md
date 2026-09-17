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

## Luồng vào bàn (join)

`POST /api/v1/table-sessions/join` (`server/src/routes/index.ts`) gắn middleware:

1. `loadGuest` — đọc cookie `mc_guest` (nếu có) để biết phiên hiện tại.
2. `guestCsrfGuard` — kiểm tra Origin/Referer.
3. `guestMutationLimiter` — rate limit 60 request/phút theo IP, tránh tạo `GuestSession` không giới hạn.
4. Controller `tableSession.join` → `ensureActiveSession({ tableId, actor: { type: 'GUEST' } })`.

Hành vi:

- Bàn đang có phiên active → trả về đúng phiên đó kèm guest session mới, `created: false`.
- Bàn chưa có phiên → tự tạo phiên `source: 'GUEST'`, `created: true`, ghi audit `tableSession.autoOpened` (`actorType: 'SYSTEM'`); khách vào được ngay, không cần nhân viên mở trước.
- Hai request `join` đồng thời trên bàn trống → chỉ một `TableSession` được tạo; request thua race bắt `11000`/`ConflictError`, đọc lại phiên vừa tạo và trả `created: false` — không để lộ `409`/`500`.
- `GUEST_AUTO_OPEN=false` → giữ hành vi cũ: `403 FORBIDDEN` *"Bàn chưa mở phiên phục vụ, vui lòng báo nhân viên."* khi bàn chưa có phiên.
- Response dùng **cùng một shape** cho cả hai nhánh: `{ guestSessionId, participantId, tableSessionId, created, table, tableSession }`; `404` khi token sai hoặc bàn bị tắt.

Staff dùng chung `ensureActiveSession` qua `POST /api/v1/staff/tables/:tableId/sessions`: bàn đã có phiên thì trả phiên hiện hữu (`created: false`) thay vì `409 TABLE_SESSION_ALREADY_OPEN`; nếu actor là STAFF và phiên đang `CHECKOUT` thì revert về `OPEN` như hành vi cũ.

## Phân quyền

| Route | Middleware |
| --- | --- |
| `/api/v1/auth/*` | `authLimiter` (rate limit 30/phút) |
| `/api/v1/table-sessions/join` (POST) | `loadGuest` + `guestCsrfGuard` + `guestMutationLimiter` |
| `/api/v1/orders` (POST) | `loadGuest` + `guestCsrfGuard` + `guestMutationLimiter` + `requireGuest` |
| `/api/v1/staff/*` | `requireAuth` + `requireRole('STAFF','ADMIN')` |
| `/api/v1/admin/*` | `requireAuth` + `requireRole('ADMIN')` |
| `/api/v1/ai/*` | `loadGuest` + in-memory rate limit 30/5 phút |

## Quyết định & đánh đổi

- **Express độc lập với Socket.IO** chứ không phải Next.js-only. Socket.IO có middleware xác thực riêng, đối chiếu với `GuestSession`/`RefreshSession`.
- **Không dùng DI framework** — DI bằng constructor/factory. Repository là object có method, dễ stub trong test.
- **UnitOfWork** đơn giản: `mongoose.startSession()` + `withTransaction`. Repository nhận session tùy chọn.
- **Idempotency**: bắt buộc header `Idempotency-Key` cho POST đơn và thanh toán. Hash payload để phát hiện gửi lại khác payload.
- **Snapshot giá/tên món** vào order items để sửa menu không làm đổi hóa đơn cũ.
- **Phiên đã thanh toán → `Bill` bất biến**: khi thanh toán đóng phiên, `billRepository.finalize` ghi một snapshot `Bill` **trong cùng transaction** với `Payment`; `tableSessionId` unique nên chốt đúng một lần kể cả khi retry (trùng khoá `11000` → đọc lại, không ném lỗi). Bill gồm participants, đơn khác `CANCELLED`, tổng tiền và các khoản thu `SUCCESS`; không có API update/delete. `GET /staff/table-sessions/:id/bill` đọc snapshot khi phiên `CLOSED` và đã có Bill, fallback tính động cho phiên cũ.
- **Phiên `CLOSED` không chặn phiên mới**: partial unique index `one_active_session_per_table` chỉ áp trên `status ∈ {OPEN, CHECKOUT}` — bàn vừa chốt bill nhận ngay phiên mới, đây là điều kiện để QR luôn dẫn khách vào được luồng đặt món.
- **Idle sweeper**: định kỳ đóng các phiên tự mở (`source: 'GUEST'`) không có đơn nào quá `SESSION_IDLE_TIMEOUT_MIN` phút, ghi `closedReason: 'IDLE'`; đặt `0` để tắt. Phiên do STAFF mở không bị sweeper đụng tới.
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
