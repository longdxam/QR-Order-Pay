# Báo cáo kiểm thử tải P5B

Cập nhật: 22/09/2026. Commit nền: `f540338`; worktree có thay đổi P1–P6 chưa commit tại thời điểm đo.

## Môi trường và topology

| Thành phần     | Cấu hình                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Máy host       | Windows 11 Home 10.0.26200; AMD Ryzen 7 5800HS; 16 logical processors; RAM 15,4 GiB                                |
| Docker Desktop | Engine 29.7.2; VM được cấp 4 CPU và khoảng 5,79 GiB RAM                                                            |
| Runtime        | Node.js 24.19.0; npm 11.17.0; image k6 `grafana/k6:latest`, k6 2.2.0                                               |
| Ứng dụng       | Baseline lịch sử: Nginx → 2 Node backend → MongoDB 7 replica set một node + Redis 7 + 1 worker                     |
| Dataset        | Database riêng `maycafe_benchmark`, 200 sản phẩm tổng hợp, 1 bàn sức chứa 10.000, token chỉ dùng local             |
| Máy tạo tải    | Container k6 chạy trên cùng Docker Desktop host; kết quả gồm cả tranh chấp CPU/RAM giữa generator và hệ thống đích |

MongoDB, Redis và backend không publish cổng ra host. Redis dùng AOF và `noeviction`. Profile benchmark chỉ nâng `RATE_LIMIT_GUEST_MUTATION_MAX=100000` vì mọi VU đi qua cùng IP container; giới hạn production vẫn là 60/phút.

## Kịch bản và ngưỡng chốt trước

- `menu.js`: warm-up 10 giây, sau đó 15 giây ở từng bậc 25 → 50 → 100 → 200 → 400 → 600 → 700 RPS.
- `menu-constant.js`: warm-up 5 giây ở tối đa 25 RPS, đo 20 giây tại một mức cố định.
- `guest-flow.js`: 20 VU trong 60 giây; mỗi VU có cookie/participant riêng, vào bàn đúng một lần rồi 80% đọc đơn và 20% tạo đơn hợp lệ, nghỉ 1 giây giữa vòng.
- `realtime.js`: 100 guest riêng, 100 kết nối Socket.IO WebSocket giữ 15 giây.
- Ngưỡng: lỗi bất ngờ <1%; p95 đọc menu/đơn <500 ms; p95 ghi <1.000 ms; fixed-arrival không được dropped iteration; realtime p95 connect <2.000 ms.
- AI live không nằm trong tải lớn để tránh chi phí/provider rate limit; được kiểm tra riêng ở `docs/ai-evaluation.md`.

Lệnh mẫu và các biến cấu hình nằm trong `scripts/load/README.md`. Raw summary không chứa secret được lưu tại `.cache/load/*.json`; thư mục này bị Git bỏ qua.

## Kết quả menu đọc

Mỗi response menu 200 sản phẩm khoảng 131 KiB. Kết quả ramp là offered load tăng đến 700 RPS, không phải 700 RPS đạt được.

| Topology  | HTTP response hoàn tất | Achieved trung bình toàn lượt |    p95 | Non-200 | Dropped |
| --------- | ---------------------: | ----------------------------: | -----: | ------: | ------: |
| 1 backend |                 25.568 |                    218,61 RPS | 6,93 s |  75,30% |     742 |
| 2 backend |                 24.385 |                    200,68 RPS | 9,10 s |  60,78% |   1.738 |

Hai backend tăng số response thành công từ 6.314 lên 9.562 và giảm tỷ lệ lỗi, nhưng không đạt mục tiêu. Achieved RPS toàn lượt thấp hơn vì request bị xếp hàng lâu hơn; không coi đây là bằng chứng scale tuyến tính.

Các lượt cố định trên hai backend xác định điểm bền vững thực đo:

| Offered load | Measurement responses |      p95 |   Lỗi | Dropped | Kết luận          |
| -----------: | --------------------: | -------: | ----: | ------: | ----------------- |
|       50 RPS |                 1.001 | 24,50 ms |    0% |       0 | Đạt               |
|       75 RPS |                 1.501 | 43,85 ms |    0% |       0 | Đạt               |
|       90 RPS |                 1.801 | 96,48 ms |    0% |       0 | Đạt               |
|      100 RPS |                 2.000 |   3,26 s |    0% |       0 | Không đạt latency |
|      200 RPS |   3.193/4.000 offered |   9,28 s | 1,65% |     808 | Không đạt         |

Mức cao nhất đã kiểm chứng đạt toàn bộ ngưỡng là **90 RPS**. 600–700 RPS đã được đưa vào ramp nhưng không đạt.

## Luồng khách và realtime

| Kịch bản             | Kết quả                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 20 guest VU, 60 giây | 1.025 HTTP; 0 lỗi; read p95 24,28 ms; write p95 4,15 s; 1.004 vòng; **không đạt** ngưỡng p95 ghi 1 giây             |
| 100 WebSocket        | 100/100 kết nối, 0 lỗi; socket connect p95 324,05 ms; WS connecting p95 307,39 ms; giữ kết nối p95 15,31 s; **đạt** |

Sau khi sửa seed dựng lại index, kiểm tra dữ liệu của lượt guest hợp lệ ghi nhận 209 order, 20 guest/participant, đúng 1 phiên bàn đang hoạt động; duplicate idempotency key = 0, sai tổng tiền = 0, trạng thái sai = 0, payment = 0 và bill = 0. Lượt realtime độc lập sau reseed có 100 guest/participant và vẫn đúng 1 phiên bàn hoạt động.

Load test ban đầu đã phát hiện seed dùng `dropDatabase()` làm mất unique index `one_active_session_per_table`. Seed benchmark nay đăng ký mọi model và `syncIndexes()` ngay sau reset; `npm -w @may-cafe/server run check:benchmark` kiểm tra và trả exit code lỗi nếu có trùng key, sai tổng/trạng thái hoặc số phiên active khác 1. Không dùng số liệu guest trước bản sửa trong kết luận.

## Tài nguyên và nút nghẽn

- Ramp một backend: backend tối đa khoảng 111,80% CPU/336,9 MiB; Mongo 13,16%/208 MiB; Redis 3,38%/4,8 MiB; Nginx 17,1%.
- Ramp hai backend: A khoảng 103,47%/355,6 MiB; B 114,68%/385,7 MiB; Mongo có đỉnh 86,45%/215,7 MiB; Redis 3,65%; Nginx 16,46%.
- Bằng chứng phù hợp với nghẽn ở response menu lớn, nhiều lần đọc Mongo/serialize JSON và giới hạn CPU của Docker VM. Thêm backend không loại được áp lực Mongo và chi phí trả payload 131 KiB.
- Luồng ghi có 0 lỗi nhưng latency đuôi cao khi nhiều participant ghi lên cùng một table session; transaction/optimistic serialization bảo vệ bất biến nhưng tạo contention. Đây là đánh đổi cần giữ, không được bỏ transaction để làm đẹp benchmark.

## Kết luận và bước tiếp theo

Mục tiêu 600–700 RPS **không đạt** trên máy đo này. Năng lực bền vững đã chứng minh cho endpoint menu hiện tại là 90 RPS ở p95 96,48 ms; 100 RPS đã vượt ngưỡng. Realtime 100 kết nối đạt; guest write 20 VU không đạt ngưỡng latency dù không mất dữ liệu.

Từ 23/09/2026, production-local đã tách pool Guest/Internal, thêm resource limit, limiter theo bàn, Redis menu cache và worker queue. Vì topology khác baseline trên, các số RPS/p95 này chỉ dùng làm lịch sử; cần chạy lại cùng dataset/ngưỡng trước khi tuyên bố mức tăng throughput. Để tách giới hạn máy tạo tải, chạy k6 trên host/VM khác trước khi kết luận năng lực cloud.
