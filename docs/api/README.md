# OpenAPI — Mây Café

File này tóm tắt các nhóm endpoint. File OpenAPI đầy đủ ở `docs/api/openapi.yaml`. Xem nhanh bằng cách import vào Swagger UI hoặc Redocly.

## Quy ước response

Thành công:
```json
{ "success": true, "data": { ... }, "meta": { "page": 1, "limit": 20, "total": 100 } }
```

Lỗi:
```json
{ "success": false, "error": { "code": "PRODUCT_UNAVAILABLE", "message": "..." }, "requestId": "abc" }
```

Status code dùng: 200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500.

## Auth

- `POST /api/v1/auth/login` — body `{ email, password }`, trả `{ accessToken, user }`, set cookie `mc_refresh`.
- `POST /api/v1/auth/refresh` — đọc cookie, xoay token, trả access mới.
- `POST /api/v1/auth/logout` — thu hồi refresh, clear cookie.
- `POST /api/v1/auth/logout-all` — thu hồi mọi refresh của user.
- `GET  /api/v1/auth/me` — cần Bearer.

## Menu (công khai)

- `GET /api/v1/categories` — danh sách danh mục active.
- `GET /api/v1/products` — danh sách món active (có filter `categoryId`, `q`, `tag`).
- `GET /api/v1/products/featured` — món signature.

## Phiên bàn

- `POST /api/v1/table-sessions/join` — body `{ tableToken }`, set cookie `mc_guest`, trả `tableSessionId`, `participantId`.
- `GET  /api/v1/table-sessions/current` — kiểm tra guest session hiện tại.
- `POST /api/v1/table-sessions/leave` — clear cookie.

## Đơn (guest)

- `POST /api/v1/orders` — header `Idempotency-Key` bắt buộc, body `placeOrderRequestSchema`.
- `GET  /api/v1/orders/mine` — chỉ đơn của participant hiện tại.
- `GET  /api/v1/orders/:id` — chỉ đơn của participant.
- `POST /api/v1/orders/:id/cancel` — chỉ khi status PENDING.
- `POST /api/v1/orders/:id/review` — sau SERVED + PAID, 1 lần/đơn.

## Service request

- `POST /api/v1/service-requests` — body `{ type: 'CALL_STAFF' | 'REQUEST_BILL' | 'OTHER', note? }`.

## AI

- `POST /api/v1/ai/recommendations` — body `aiRecommendRequestSchema`, rate-limit 30/5ph.

## Staff

- `GET  /api/v1/staff/orders` — đơn đang xử lý + SERVED.
- `PATCH /api/v1/staff/orders/:id/status` — body `{ status, reason? }`, kiểm tra state machine.
- `POST /api/v1/staff/orders/:id/confirm` — shortcut sang CONFIRMED.
- `GET  /api/v1/staff/table-sessions` — phiên OPEN/CHECKOUT.
- `POST /api/v1/staff/tables/:tableId/sessions` — mở phiên.
- `PATCH /api/v1/staff/table-sessions/:id/status` — body `{ status, expectedVersion }`.
- `GET  /api/v1/staff/table-sessions/:id/bill` — chi tiết bill.
- `POST /api/v1/staff/table-sessions/:id/payments` — header `Idempotency-Key`, body `{ amount, method, expectedVersion, note? }`.
- `GET  /api/v1/staff/service-requests` — yêu cầu OPEN.
- `POST /api/v1/staff/service-requests/:id/resolve`.

## Admin

- `GET  /api/v1/admin/reports/overview?from&to` — KPI + biểu đồ.
- `GET  /api/v1/admin/reports/revenue` — (mở rộng).
- `GET  /api/v1/admin/reports/top-products` — (mở rộng).
- CRUD `/api/v1/admin/products`, `/categories`, `/toppings`.
- `GET  /api/v1/admin/tables`, `GET /api/v1/admin/users`.

## OpenAPI YAML (stub)

```yaml
openapi: 3.0.3
info:
  title: Mây Café API
  version: 1.0.0
  description: QR ordering & AI Barista
servers:
  - url: http://localhost:4000/api/v1
components:
  securitySchemes:
    bearer:
      type: http
      scheme: bearer
      bearerFormat: JWT
    guestCookie:
      type: apiKey
      in: cookie
      name: mc_guest
security:
  - bearer: []
  - guestCookie: []
```
