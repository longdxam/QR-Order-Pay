# AI Barista — thiết kế & vận hành

## Mục tiêu

Khách nhập câu tiếng Việt tự nhiên ("mình thích vị chua nhẹ, không cà phê, dưới 50 nghìn"), AI trả 2–3 món đang bán có ảnh, giá và lý do. Khi LLM không khả dụng, hệ thống tự dùng fallback rule-based từ menu thật, ghi rõ `mode: "fallback"` để UI/audit biết.

## Kiến trúc

```
Client  ─► POST /api/v1/ai/recommendations
              │
              ▼
        aiController  (rate limit 30 / 5 phút / guest hoặc IP)
              │
              ▼
        aiService.recommend(input)
              │
              ├── mode === 'off'                 → fallback
              ├── no provider / key              → fallback
              └── HTTP AIProvider.chat(...)      → parse + validate schema
                                                       │
                                                       ▼
                                                  fallback nếu invalid
              │
              ▼
        Validate ID + variant + isAvailable + price + budget
              │
              ▼
        Trả response có cấu trúc
```

## Provider

`HttpAIProvider` gọi OpenAI-compatible API (`AI_BASE_URL` mặc định `https://api.openai.com/v1`). Body gồm `model`, `temperature`, `messages`, và `response_format: { type: 'json_object' }` khi cần JSON.

Timeout `AI_TIMEOUT_MS` (mặc định 15 giây). Lỗi timeout hoặc HTTP không 2xx → fallback.

## P4A — tìm kiếm menu bằng tiếng Việt

Tìm kiếm chính trên trang menu dùng một pipeline xác định, tách biệt với AI Barista:

```
query (tối đa 200 ký tự)
  → bỏ dấu + sửa một số lỗi gõ trong từ điển giới hạn
  → MenuSearchIntent đã kiểm tra bằng Zod
  → điều kiện cứng: nhóm loại trừ, budget, caffeine, dairy, availability
  → xếp hạng: từ khóa, nhóm, khẩu vị, ít ngọt, featured, giá
  → tối đa 12 món từ database
```

- `dưới 40 nghìn` là `< 40.000đ`; `không quá`/`tối đa` là `<= 40.000đ`. Budget luôn áp dụng cho một món với size khả dụng rẻ nhất.
- `không cà phê` chỉ loại nhóm cà phê. Chỉ `không caffeine`, `không cafein` hoặc `decaf` mới bật ràng buộc caffeine.
- Với `không caffeine`/`không sữa`, metadata phải xác nhận chính xác `false`; dữ liệu thiếu không được xem là an toàn.
- Món ngừng bán, lưu trữ hoặc không còn size hợp lệ bị loại trước khi xếp hạng. Không có kết quả thì trả rỗng và nói rõ, không tự chèn món gần đúng.
- Client debounce 350 ms, truyền `AbortSignal` để hủy request cũ và cho phép người dùng sửa trực tiếp budget/caffeine/dairy.

Chế độ hiện tại luôn là `fallback`, không cần API key và không được trình bày như kết quả AI live. Nếu sau này dùng LLM, LLM chỉ phân tích intent hoặc viết lời giải thích; backend vẫn sở hữu toàn bộ lọc, xếp hạng, ID và giá.

## Prompt

```
system: Bạn là AI Barista cho quán cà phê Việt Nam. Trả lời tiếng Việt. CHỈ chọn món từ
        danh sách sản phẩm. KHÔNG tự tạo ID. Trả JSON hợp lệ theo schema:
        {"message": string, "recommendations": [{"productId": string, "variantId": string|null,
        "reason": string}], "followUpQuestion": string?}. Lý do ≤ 25 từ.

user: Khách: {prompt}
     Ngân sách: {budget} VND
     Sở thích: {preferences}
     Danh sách món: [{id, name, basePrice, variants, caffeine, dairy, flavorProfile, tags}, ...]
```

## Schema validate

```ts
{
  message: string,
  recommendations: [{ productId, variantId?, reason }],
  followUpQuestion?: string
}
```

Sau khi parse, backend lọc lại:

- Bỏ mọi ID không tồn tại trong menu.
- Bỏ variant không hợp lệ.
- Bỏ món hết (`isAvailable=false`) hoặc `isArchived=true`.
- Bỏ món vượt `maxBudget` (nếu có).

Cuối cùng bổ sung `unitPrice` từ DB, không dùng giá LLM tự sinh.

## Fallback

Rule-based dựa trên:

- `flavorProfile` chứa "chua", "đắng", "ngọt", "béo".
- `tags` chứa "no-caffeine", "no-dairy", "low-sugar", "fruit".
- Từ khoá trong prompt (chua/đắng/ngọt/trái cây) cộng điểm.
- `isFeatured` cộng điểm.
- Sort theo `score desc, basePrice asc`. Lấy 3 món đầu.

Nếu không match: lấy 3 món rẻ nhất còn bán, nói rõ "chưa có món khớp ràng buộc".

## Bảo mật

- API key chỉ ở backend env. Không log key, không log message nguyên văn.
- Rate limit theo `participantId` (nếu có) hoặc IP.
- Giới hạn prompt ≤ 500 ký tự.
- Validate body với Zod; response thông qua schema đã verify.

## Demo không cần API key

Đặt `AI_MODE=fallback` (mặc định) là hệ thống chạy đầy đủ, không cần `AI_API_KEY`. Khi cần bật LLM thật, set:

```
AI_MODE=live
AI_PROVIDER=openai
AI_MODEL=gpt-4o-mini
AI_API_KEY=sk-...
AI_BASE_URL=https://api.openai.com/v1
```

## Đánh giá

Xem `docs/ai-evaluation.md` để biết ma trận 25 kiểm thử P4A và phạm vi AI Barista đã/chưa được kiểm chứng.
