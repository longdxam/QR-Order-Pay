# Backup, restore và migration

Mục tiêu vận hành hiện tại: RPO tối đa 24 giờ, RTO 2 giờ. Production chạy backup point-in-time bằng `mongodump --oplog` trên replica set mỗi ngày, mã hóa kho lưu trữ ngoài máy chủ ứng dụng, giữ 7 bản hằng ngày và 4 bản hằng tuần. Tài khoản chuyên dụng dùng quyền backup chỉ đọc cần thiết cho database và oplog, không có quyền ghi/xóa dữ liệu ứng dụng.

## Quy trình

1. Local chạy `npm run db:migrate`; artifact production chạy `npm run db:migrate:prod`. `compose.production.yaml` có service `migrate` hoàn tất thành công trước API/worker. Runner có lock, checksum và preflight dữ liệu trùng; chạy lại an toàn. Production đã tắt Mongoose `autoIndex`.
2. Backup: `./scripts/db/backup.ps1 -MongoUri '<replica-set-backup-uri>' -SourceDatabase 'maycafe' -OutputDirectory '<dedicated-backup-dir>'`. Archive toàn deployment để `--oplog` bảo đảm một mốc nhất quán; manifest ghi database nguồn, SHA-256 và cơ chế consistency.
3. Restore drill: tạo **MongoDB deployment/volume riêng, rỗng và có host khác cluster nguồn**, sau đó chạy `./scripts/db/restore-test.ps1 -Archive '<archive>' -TargetUri '<isolated-replica-set-uri>' -ConfirmIsolatedDeployment yes`.
4. MongoDB Tools không cho replay oplog đồng thời với lọc/đổi tên namespace. Vì vậy script restore toàn archive nguyên namespace vào deployment cô lập, dùng `--oplogReplay --drop`, từ chối cluster đích có identity trùng cluster nguồn, rồi kiểm database ứng dụng ghi trong manifest: count, Bill trùng theo phiên, Payment mồ côi và các index bắt buộc.
5. Ghi ngày, archive, thời gian restore, kết quả JSON và người thực hiện vào biên bản. Không chạy restore drill trên cùng deployment với production; cờ xác nhận không thay thế việc kiểm tra URI/volume đích.

Lần drill gần nhất ngày 23/09/2026 đã đạt trên MongoDB 7; xem `docs/restore-drill-2026-09-23.md`. Host phát triển chưa cài MongoDB Database Tools, vì vậy drill dùng tool chính thức trong container cô lập; máy backup production vẫn phải cài/pin đúng phiên bản tool và theo dõi exit code.

Rollback code chỉ an toàn khi phiên bản cũ đọc được các field bổ sung. Không xóa backlog outbox/queue khi rollback; giữ consumer tương thích schema event v1 cho đến khi backlog đã drain. Migration xóa/đổi tên field phải là một đợt riêng sau thời gian tương thích và cần runbook rollback riêng.

Kết quả report trong Redis có TTL `BACKGROUND_JOB_RESULT_TTL_SECONDS` và trần `BACKGROUND_JOB_RESULT_MAX_BYTES`; job đang `QUEUED`/`PROCESSING` không bị TTL xóa giữa chừng. Theo dõi Redis RAM/key count và queue age tại Admin Operations trước khi quyết định tách cache, limiter và queue sang các Redis riêng.
