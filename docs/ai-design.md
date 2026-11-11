# AI Barista — thiết kế & vận hành

## Mục tiêu

Khách nhập câu tiếng Việt tự nhiên ("mình thích vị chua nhẹ, không cà phê, dưới 50 nghìn", "buồn ngủ quá"), hệ thống trả tối đa ba món đang bán có ảnh, giá và lý do đã kiểm chứng. Chi phí token mỗi lần hỏi **không phụ thuộc số món trong menu**: model không bao giờ nhận menu, chỉ nhận câu của khách và một danh sách tag giới hạn.

## Kiến trúc

```
Client ─► POST /api/v1/ai/recommendations
             │
             ▼
       aiService.recommend(input)
             │  chuẩn hóa ngân sách/caffeine/sữa/ít ngọt từ câu + checkbox
             │  parseMenuSearchIntent (luật, bỏ dấu, sửa lỗi gõ ≥4 chữ)
             ▼
   (B) Bộ định tuyến: còn từ nào luật + từ vựng menu không giải thích được?
             │
     ┌───────┴──────────────────────────┐
     │ không / AI_MODE≠live             │ có, AI_MODE=live
     ▼                                  ▼
 route=rules                    (A) model trích điều kiện (JSON):
 (0 token)                          nhóm, khẩu vị, tag từ vựng, từ khóa,
     │                              ngân sách, caffeine/sữa, câu chào
     │                                  │  lỗi/timeout/sai schema → route=llm_fallback
     │                                  ▼
     │                          gộp: model chỉ được THÊM ràng buộc,
     │                          không nới ràng buộc khách/checkbox
     └───────────┬──────────────────────┘
                 ▼
   Lọc cứng từ MongoDB (đang bán, size, ngân sách, caffeine/sữa xác nhận)
   → rankMenuProducts (từ khóa/tag mềm, nhóm "bất kỳ", khẩu vị, featured, giá)
   → top 3 + lý do/evidence do backend viết từ dữ liệu thật
```

- `mode` giữ hợp đồng cũ cho UI: `llm` khi model đã trích ý thành công, `fallback` cho mọi trường hợp còn lại. `route` (mới, tùy chọn) cho biết `rules`, `llm` hay `llm_fallback`.
- (C) Tag món được làm giàu **ngoài luồng khách hỏi**: Admin bấm "AI gợi ý tag" trong form sửa món → `POST /admin/products/ai-tag-suggestions` → chọn tag → bấm Lưu (PATCH có audit). Tag nằm trong `Product.tags`, nên tìm kiếm menu, bộ định tuyến và xếp hạng AI đều dùng được.

`AI_MODE` chỉ điều khiển Barista và gợi ý tag. `ANOMALY_AI_MODE` điều khiển riêng phần giải thích anomaly và mặc định `fallback`; bật Barista live không bật inference anomaly.

## Provider

`HttpAIProvider` POST `${AI_BASE_URL}/chat/completions` (mặc định `https://api.openai.com/v1/chat/completions`), dùng Bearer authentication, `model`, `messages`, `temperature` và `response_format: { type: 'json_object' }`. Chỉ chọn endpoint/model thực sự hỗ trợ đủ hợp đồng Chat Completions này, gồm JSON-object mode; tên provider không tự chọn giao thức hoặc adapter.

Timeout `AI_TIMEOUT_MS` (mặc định 15 giây). Lỗi runtime như timeout, network, HTTP hoặc output không hợp lệ → Barista fallback minh bạch; không retry.

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

P4A menu search luôn chạy pipeline xác định, không gọi LLM và không cần API key. AI Barista là luồng riêng, có thể bật live qua `AI_MODE=live`; backend vẫn kiểm soát menu, giá và ràng buộc trong mọi chế độ.

## Skill và hooks

`server/src/ai/baristaSkill.ts` chứa hai system instruction:

1. `BARISTA_INTENT_PROMPT` — model chỉ phân tích nhu cầu. Input: `{prompt, preferences, budget, tagVocabulary}`. Output: `{groupsInclude, groupsExclude, flavors, tags, keywords, noCaffeine, noDairy, lowSugar, maxBudget, message, followUpQuestion?}`. Model không thấy menu nên không thể nêu tên/giá/ID món.
2. `MENU_TAG_PROMPT` — gắn 2–5 tag cho **một** món, nguyên văn từ bộ từ vựng.

`server/src/ai/menuTagVocabulary.ts` là bộ từ vựng cố định (mát lạnh, ấm nóng, tỉnh táo, thư giãn, ngày nóng, ngày mưa, đậm vị, chua nhẹ, hương trái cây…). Không có tag sức khỏe/dị ứng; caffeine/sữa vẫn nằm ở `ingredientMetadata`. `tagVocabulary` gửi cho model = bộ cố định + tag đang có trong menu, **giới hạn 60**.

`server/src/ai/baristaHooks.ts`:

- `afterBaristaResponse` parse JSON (chấp nhận JSON lẫn trong prose), giá trị enum lạ bị bỏ thay vì làm hỏng cả intent, giới hạn độ dài danh sách, bỏ nhóm vừa include vừa exclude. Sai shape → `AI schema invalid` → rules.
- `afterMenuTagResponse` chỉ giữ tag thuộc bộ từ vựng, chuẩn hóa/khử trùng lặp, tối đa 5. Service bỏ thêm `tỉnh táo` nếu metadata không xác nhận caffeine.

### Bộ định tuyến (B)

`needsLanguageModel(keywords, products)`: lấy từ khóa còn lại sau khi luật đã hiểu ngân sách/caffeine/sữa/ít ngọt/khẩu vị/nhóm; bỏ từ chung chung (gì, nào, ngon, hôm nay…). Nếu mọi từ còn lại đều xuất hiện trong tên/mô tả/tag/khẩu vị của menu (cho phép sai 1 ký tự với từ ≥4 chữ) thì trả lời bằng luật, không gọi model. Ví dụ: "trà đào ít ngọt", "không caffeine dưới 40k", "món mát lạnh" (sau khi đã có tag) → rules; "buồn ngủ quá", "uống gì cho bạn gái" → model.

## Output và kiểm chứng nghiệp vụ

Model chỉ trả điều kiện. Backend:

- Gộp điều kiện: `noCaffeine/noDairy/lowSugar` = checkbox/câu **hoặc** model; ngân sách của khách/checkbox thắng, model chỉ bổ sung khi khách chưa nêu; nhóm loại trừ = hợp của luật và model; nhóm ưu tiên là mềm (không còn món trong nhóm thì xét cả menu).
- Lọc cứng từ MongoDB: món đang bán, chưa lưu trữ, danh mục bật, còn size hợp lệ, đủ kho, trong ngân sách; caffeine/sữa phải được metadata xác nhận `false`.
- Xếp hạng bằng `rankMenuProducts` với từ khóa/tag mềm; lấy tối đa 3 món.
- Lý do/evidence do backend viết từ dữ liệu thật (size, giá, ngân sách, metadata, tag khớp "hợp: mát lạnh"); không dùng lời model cho lý do.
- Không còn món hợp lệ thì trả danh sách rỗng và nói rõ; không tự nới ràng buộc.

## Fallback

Khi `AI_MODE` khác `live`, provider lỗi/timeout, JSON sai schema hoặc bộ định tuyến thấy không cần model, cùng một pipeline luật ở trên được dùng với điều kiện chỉ lấy từ câu + checkbox. Khác biệt duy nhất là không có tag/từ khóa/nhóm do model bổ sung, và `message` là câu cố định.

Gợi ý tag (C) khi không live hoặc lỗi dùng luật `ruleTags` theo tên/mô tả/khẩu vị/caffeine (vd "chua" → chua nhẹ, cam/đào/chanh → hương trái cây, caffeine=true → tỉnh táo), trả `mode: "fallback"`.

## Bảo mật

- API key chỉ ở backend environment; không log key, prompt hoặc raw model output.
- Rate limit theo `participantId` (nếu có) hoặc IP; giới hạn prompt ≤ 500 ký tự.
- Validate request với Zod; recommendation được kiểm tra lại từ MongoDB.

## Cấu hình

Mặc định `AI_MODE=fallback` và `ANOMALY_AI_MODE=fallback`; không cần key, không gọi provider. Dev backend đọc `server/.env` (không đọc `.env` ở repo root); tạo/sửa file đó nếu muốn bật live. Production dùng `.env.production` được inject qua Compose. Thay env cần restart API/worker; cấu hình không hot-reload.

Khi chủ động bật Barista live, điền cấu hình riêng của provider trong `server/.env`:

```dotenv
AI_MODE=live
ANOMALY_AI_MODE=fallback
AI_PROVIDER=opencode-zen
AI_BASE_URL=https://opencode.ai/zen/v1
AI_MODEL=space-bunny-free
AI_API_KEY=<provider-issued-key>
AI_TIMEOUT_MS=15000
```

`space-bunny-free` là ví dụ raw model ID được liệt kê cho Zen, không có tiền tố `opencode/`; model list không chứng minh quyền truy cập hoặc JSON-mode hoạt động. Chọn model bằng `AI_MODEL`, không phải UI/request. Khi đổi provider, đổi base URL/model/key cho một model đáp ứng đúng hợp đồng Chat Completions + Bearer + JSON-object mode. Không có cam kết mọi model Zen hoặc mọi cấu hình Azure/Ollama tương thích.

Nếu `AI_MODE` hoặc `ANOMALY_AI_MODE` là `live`, startup yêu cầu `AI_API_KEY` và `AI_MODEL` tường minh; mode không hợp lệ, URL không phải HTTP(S) hợp lệ hoặc timeout không dương cũng làm startup thất bại, không echo giá trị nhạy cảm. Startup không gọi inference; lỗi runtime như model không được cấp quyền sẽ dùng fallback. Smoke live chỉ trên DB demo đã seed, sau khi chủ động cấu hình credential/hạn mức và build contracts:

```bash
npm run build:contracts
npm -w @may-cafe/server exec -- tsx scripts/ai-live-smoke.ts
```

Nếu cả ba case thành công, lệnh gửi đúng một request live cho mỗi case; dừng và thoát khác 0 khi gặp lỗi/case không đạt. Không gọi anomaly. Smoke Zen thật với model yêu cầu `space-bunny-free` đã đạt ba case ngày 06/10/2026; đây không phải đánh giá chất lượng tổng quát hoặc skill-vs-baseline.

Xem `docs/ai-evaluation.md` để biết ma trận P4A, bằng chứng 401 lịch sử, smoke Zen thật và các giới hạn kiểm chứng còn lại.
