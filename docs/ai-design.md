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

Xem `docs/ai-evaluation.md` để biết 15+ tình huống kiểm thử và kết quả quan sát.
