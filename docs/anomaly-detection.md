# Phát hiện bất thường và giải thích P4B

Cập nhật 22/09/2026. Đây là detector theo quy tắc/thống kê có ngưỡng cấu hình, **không phải mô hình ML đã huấn luyện**. Cảnh báo nêu tương quan và bước kiểm tra; không khẳng định nguyên nhân.

## Luồng xử lý

```text
HTTP aggregate theo instance + Order/statusHistory trong MongoDB
  → job định kỳ
  → cửa sổ hiện tại so với baseline liền trước
  → kiểm tra số mẫu tối thiểu và ngưỡng
  → lưu/cập nhật AnomalyAlert có bằng chứng
  → giải thích LLM có schema hoặc template fallback
  → ADMIN xem, xác nhận hoặc đóng; thao tác được audit
```

Job chạy khi server khởi động rồi lặp theo `ANOMALY_INTERVAL_MS`; không gọi detector hoặc LLM theo từng request dashboard. Chỉ cảnh báo mới có thể gọi LLM, tối đa `ANOMALY_AI_MAX_PER_RUN`; cảnh báo vẫn được tạo với giải thích fallback khi AI tắt, thiếu key, timeout hoặc trả schema sai.

## Định nghĩa detector

| Detector | Giá trị quan sát | Baseline/ngưỡng mặc định | Mẫu tối thiểu | Bằng chứng |
| --- | --- | --- | --- | --- |
| `HTTP_ERROR_RATE` | HTTP 5xx / tổng request trong 15 phút | max(10%, baseline × 2) | 20 request ở cả hai cửa sổ | số lỗi/tổng request, tối đa 5 route lỗi nhiều nhất |
| `HTTP_LATENCY_P95` | p95 duration HTTP trong 15 phút | max(1.000 ms, p95 baseline × 2) | 20 request ở cả hai cửa sổ | số request, tối đa 5 route p95 chậm nhất |
| `PREPARATION_P95` | p95 từ PREPARING đến READY; đơn đang pha dùng tuổi hiện tại | max(900 giây, p95 baseline × 2) | 20 công đoạn ở cả hai cửa sổ | số mẫu và thời gian lớn nhất |
| `CANCELLATION_RATE` | đơn của cohort tạo trong cửa sổ đã chuyển CANCELLED trước cuối cửa sổ / tổng cohort | max(25%, baseline × 2) | 20 đơn ở cả hai cohort | số đơn hủy/tổng đơn |

Baseline mặc định là 60 phút ngay trước cửa sổ hiện tại. Nếu một trong hai cửa sổ chưa đủ mẫu, trạng thái là `INSUFFICIENT_DATA`, giá trị quan sát không được công bố như kết luận và không tạo alert.

`WARNING` dùng khi vừa vượt ngưỡng; `CRITICAL` khi giá trị ít nhất gấp đôi ngưỡng. Các threshold được kiểm tra kiểu/range khi process khởi động.

## Khử trùng và vòng đời

- Cảnh báo được định danh theo detector + target + đầu cửa sổ (`bucketKey` unique).
- Trong cooldown mặc định 30 phút, tín hiệu cùng detector/target cập nhật `lastDetectedAt`, cửa sổ và bằng chứng của alert đang mở/đã xem thay vì tạo alert mới.
- Trạng thái: `OPEN → ACKNOWLEDGED → CLOSED`; alert đã đóng không thể mở lại qua API.
- `PATCH /api/v1/admin/anomalies/:id/status` chỉ nhận `ACKNOWLEDGED` hoặc `CLOSED`, yêu cầu ADMIN và ghi `AuditLog`.
- `GET /api/v1/admin/anomalies` trả bốn trạng thái detector gần nhất cùng tối đa 50 alert gần nhất.

## Giải thích AI an toàn

Input AI chỉ gồm detector, target, khoảng thời gian, observed/threshold/baseline, số mẫu, phương pháp và aggregate evidence. Không gửi body request, prompt khách, cookie, token hoặc log thô.

Output bắt buộc qua Zod:

```ts
{
  summary: string,
  evidence: string[],
  hypotheses: string[],
  checks: string[]
}
```

Prompt bắt buộc phân biệt giả thuyết với nguyên nhân và cấm đề xuất tự hủy đơn, hoàn tiền, đổi giá hay thay cấu hình. Template fallback cũng ghi rõ “chưa phải kết luận nguyên nhân”. AI không có endpoint hoặc quyền thực thi thao tác nghiệp vụ.

## Đánh giá synthetic

Tập unit có nhãn gồm cửa sổ bình thường, spike 5xx, p95 HTTP chậm, p95 pha chế chậm, tỷ lệ hủy tăng, quá ít mẫu và provider timeout:

- Cảnh báo mong đợi/phát hiện: **4/4** (`HTTP_ERROR_RATE`, `HTTP_LATENCY_P95`, `PREPARATION_P95`, `CANCELLATION_RATE`).
- Cảnh báo sai trong cửa sổ bình thường: **0/4 detector**.
- Quá ít mẫu: **4/4** detector trả `INSUFFICIENT_DATA`, không phát cảnh báo.
- Provider timeout: alert không mất; giải thích chuyển sang `fallback`.
- Sáu unit case hoàn thành trong khoảng 9 ms ở lượt nghiệm thu; lịch job production là 60 giây nên độ trễ phát hiện thiết kế tối đa xấp xỉ một chu kỳ cộng thời gian query/evaluate. Đây không phải số liệu tải production.
- Integration MongoDB tạm kiểm tra ADMIN/STAFF, lưu bằng chứng, hai lần cùng tín hiệu trong cooldown chỉ có một alert, ACK và AuditLog.

Không suy rộng các kết quả synthetic này thành độ chính xác trên hoạt động quán thật. Sau khi có traffic thật cần hiệu chỉnh ngưỡng theo mùa/giờ và đánh giá lại false-positive.

## Giới hạn trước P5

HTTP observation hiện là ring buffer tối đa 50.000 mẫu theo **một instance**. Order và alert nằm trong MongoDB dùng chung. P5 phải chuyển HTTP aggregate/scheduler sang store/worker dùng chung hoặc cơ chế leader lease trước khi chạy nhiều backend; không được cộng cùng một snapshot database hai lần.
