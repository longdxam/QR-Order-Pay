# Playbook điều phối CoDev cho Mây Café

Cập nhật: 20/09/2026.

## Lệnh kích hoạt

Khi người dùng nhắn **"hãy thực hiện giao việc cho codev và kiểm soát"**, hãy đọc toàn bộ file này và thực hiện quy trình bên dưới.

Mục đích là dùng CoDev làm coding worker trong chính workspace, còn AI điều phối chịu trách nhiệm phân rã việc, giới hạn phạm vi, kiểm tra thay đổi và quyết định có giao vòng tiếp theo hay không.

Không coi output do CoDev tự báo là bằng chứng hoàn thành. Chỉ kết luận sau khi đã kiểm tra diff, chạy xác minh phù hợp và đối chiếu điều kiện nghiệm thu.

## 1. Trạng thái đã kiểm chứng

Trên máy này CoDev đã được cài với CLI native:

```text
C:\Users\longd\AppData\Roaming\npm\codev.cmd
```

Package được phát hiện là `codev-code` 1.18.23-4. PowerShell có thể chặn shim `codev.ps1`, vì vậy luôn gọi trực tiếp file `.cmd` bằng:

```powershell
& 'C:\Users\longd\AppData\Roaming\npm\codev.cmd' --help
```

Provider `aigw` đã có credential. Các model từng được CLI liệt kê gồm:

```text
aigw/MiniMax/MiniMax-M3
aigw/zai-org/GLM-5.3-Flash
```

Đã chạy thành công một task chỉ đọc bằng model `aigw/zai-org/GLM-5.3-Flash`: CoDev đọc `PROJECT_MEMORY.md` và `HUONG_DAN_AGENT_NANG_CAP_KIEN_TRUC.md`, rồi báo ba rủi ro đa instance. Sau task, `git status --short` chỉ có file hướng dẫn do AI điều phối tạo từ trước; CoDev không sửa project.

Không in credential, không đọc `auth.json`, không đưa API key vào prompt, log hoặc file trong repository.

## 2. Nguyên tắc quyền hạn

- Không dùng `--auto`. Cờ này tự phê duyệt các quyền không bị chặn rõ ràng.
- Không truyền `--pure` trừ khi nhiệm vụ thực sự cần tắt plugin; nó có thể thay đổi năng lực agent.
- Không dùng agent `explore` với `codev run`: ở bản CLI đã kiểm tra, đó là subagent và CLI sẽ fallback về agent mặc định.
- Agent mặc định `build` có cấu hình quyền rộng. Việc không dùng `--auto` không đủ để biến nó thành sandbox, vì policy agent có thể đã cho phép thao tác. Mọi task sửa code phải nêu phạm vi file, hành động cấm và tiêu chí dừng.
- Không giao cho CoDev quyền xóa dữ liệu, reset Git, thay đổi cấu hình cloud, cài package, sửa `.env`, đọc secret, gửi request ra dịch vụ ngoài hoặc deploy nếu người dùng chưa yêu cầu cụ thể.
- Không chạy `npm run seed`, `docker compose down -v`, `git reset --hard`, `git clean`, `npm audit fix --force` hay lệnh phá hủy tương tự như một phần "tự dọn môi trường".
- Với các thay đổi lớn, bắt đầu bằng task khảo sát/plan chỉ đọc. Chỉ giao task sửa sau khi AI điều phối xác định được file cần sửa và test cần chạy.
- Chỉ giao **một gói thay đổi độc lập mỗi phiên**. Không giao đồng thời hai CoDev worker trong cùng worktree.

Nếu có thể thay đổi cấu hình CoDev theo yêu cầu rõ ràng của người dùng, ưu tiên tạo một agent primary riêng có tool tối thiểu thay vì dựa vào `build`. CLI hỗ trợ:

```powershell
& 'C:\Users\longd\AppData\Roaming\npm\codev.cmd' agent create --help
```

`agent create` ghi cấu hình nên không thực hiện chỉ để thử. Khi tạo, dùng `--mode primary`; task review chỉ cấp `read,glob,grep,bash`, task code chỉ thêm `edit` khi cần. Vẫn phải review sau mỗi lần chạy.

## 3. Chuẩn bị trước mỗi task

Thực hiện tuần tự:

1. Đọc `PROJECT_MEMORY.md`, tài liệu yêu cầu liên quan và file hướng dẫn phù hợp. Với cải tiến kiến trúc đọc thêm `HUONG_DAN_AGENT_NANG_CAP_KIEN_TRUC.md`.
2. Kiểm tra chỉ dẫn agent áp dụng bằng `rg --files -g AGENTS.md` từ workspace trở xuống; đọc hết mọi file tìm được trong đường dẫn có liên quan.
3. Kiểm tra trạng thái ban đầu:

```powershell
git status --short
git diff --check
```

4. Liệt kê chính xác file/module/test liên quan bằng `rg` hoặc đọc code. Không suy đoán path.
5. Viết task contract ngắn theo mẫu ở mục 4.
6. Chọn model. Mặc định dùng model `aigw/zai-org/GLM-5.3-Flash` đã kiểm chứng. Kiểm tra lại danh sách model nếu cần:

```powershell
& 'C:\Users\longd\AppData\Roaming\npm\codev.cmd' models
```

7. Nếu task có khả năng sửa file, nêu trước cách xác minh, lệnh test và điều kiện rollback. Nếu dữ liệu demo hoặc schema database bị ảnh hưởng, dừng để báo người dùng trước khi cho agent làm thay đổi đó.

## 4. Task contract bắt buộc

Mỗi prompt gửi CoDev phải có đủ các phần sau, viết ngắn và cụ thể.

```text
Vai trò: Bạn là coding worker của dự án Mây Café.

Mục tiêu: <một kết quả cụ thể, có thể kiểm tra>.

Bối cảnh phải đọc: <file/path cụ thể>.

Phạm vi được phép: chỉ sửa <danh sách file hoặc module>.

Không được: không sửa .env/secret, không cài package, không đổi dependency,
không chạy seed, không xóa/reset Git, không deploy, không sửa file ngoài phạm vi.

Ràng buộc nghiệp vụ: <các bất biến liên quan từ PROJECT_MEMORY.md>.

Xác minh được phép chạy: <danh sách lệnh test/typecheck/build>.

Tiêu chí đạt: <hành vi + test/diff mong đợi>.

Báo cáo cuối: tóm tắt, file thay đổi, lệnh đã chạy/kết quả,
hạn chế hoặc phần chưa kiểm chứng. Không commit.
```

Không nhét toàn bộ repository hoặc tài liệu dài vào prompt. Chỉ yêu cầu CoDev đọc file có liên quan. Với task ghi code, nhắc nó kiểm tra mã hiện tại trước để tái sử dụng pattern có sẵn.

Ví dụ task chỉ đọc:

```text
Read-only task. Read PROJECT_MEMORY.md, docs/architecture.md and server/src/realtime/socket.ts.
Do not edit/create files, run tests, read .env files or use network. Report in Vietnamese:
three concrete risks of running Socket.IO on two backend instances and one validation for each.
```

Ví dụ task sửa nhỏ:

```text
Implement only the existing health/readiness endpoint behavior described in docs/deployment.md.
Read the existing server bootstrap, config and error middleware first. Only change the server files
strictly needed and tests directly covering them. Do not modify dependencies, Docker, .env, database
or routes unrelated to health checks. AI failure must not make readiness fail. Run the named unit test
and server typecheck. Do not commit. Report changed files, commands and results.
```

## 5. Cách chạy CoDev

`codev run` nhận task qua positional argument, **không dùng `--prompt`**. Cú pháp đã kiểm chứng:

```powershell
& 'C:\Users\longd\AppData\Roaming\npm\codev.cmd' run `
  --agent build `
  --model 'aigw/zai-org/GLM-5.3-Flash' `
  --format default `
  '<TASK CONTRACT>'
```

`--agent build` là primary agent hiện có. Không chọn `explore` cho `run` vì CLI fallback sang default. Không thêm `--auto`.

Để cho output dễ xử lý tự động có thể dùng `--format json`, nhưng phải kiểm tra phiên bản CLI thực tế và lưu ý output có thể là chuỗi sự kiện thay vì một báo cáo cuối. Mặc định dùng `--format default` cho đến khi có parser đã kiểm chứng.

Chỉ dùng `--thinking` khi cần chẩn đoán; reasoning dài làm tăng output/log và không phải bằng chứng thay đổi đúng.

Không truyền `.env` bằng `--file`. Nếu task cần biết cấu hình, dùng `.env.example` hoặc mô tả biến không nhạy cảm trong prompt.

## 6. Vòng kiểm soát bắt buộc sau khi agent trả lời

### 6.1 Kiểm tra phạm vi thay đổi

Ngay khi CoDev hoàn thành, AI điều phối tự kiểm tra:

```powershell
git status --short
git diff --check
git diff --stat
git diff -- <danh sách file agent được phép sửa>
```

Đối chiếu diff với task contract:

- Có file nào ngoài phạm vi không?
- Có secret, token, URL private, dữ liệu demo hoặc file generated không?
- Có thay đổi dependency/lockfile khi task không cho phép không?
- Có đổi quy tắc giá, phân quyền, transaction, idempotency hoặc trạng thái phiên/đơn ngoài ý định không?
- Có log dữ liệu nhạy cảm không?

Nếu phạm vi sai, không tiếp tục giao task mới. Nêu file/hunk cụ thể cần khôi phục hoặc yêu cầu CoDev sửa đúng phạm vi. Không dùng `git reset --hard` để xóa thay đổi của người dùng.

### 6.2 Đọc và review logic

Đọc toàn bộ diff và các code path liên quan, không chỉ đọc báo cáo CoDev. Với Mây Café đặc biệt kiểm tra:

- Backend vẫn là nguồn quyết định giá, quyền và trạng thái.
- Order/payment vẫn idempotent và dùng transaction khi cần.
- Khách không xem chéo đơn/receipt; Socket vẫn kiểm tra cookie/session.
- Event realtime chỉ phát sau commit và client có thể đồng bộ lại qua API.
- Bill bất biến, CHECKOUT, variant/topping và quyền review giữ đúng quy tắc.
- AI chỉ đưa gợi ý/giải thích; backend hậu kiểm mọi dữ liệu ảnh hưởng nghiệp vụ.
- Multi-instance không nhân đôi sweeper, scheduler, alert hay metric nghiệp vụ.

### 6.3 Chạy kiểm chứng độc lập

AI điều phối tự chạy các lệnh tương xứng với diff, không chỉ tin lệnh CoDev đã báo. Ưu tiên lệnh hẹp trước, sau đó mở rộng khi thay đổi ảnh hưởng nhiều module:

```powershell
npm run typecheck
npm run test:server
npm run test:client
npm run test:integration
npm run build
```

Chỉ chạy những lệnh cần thiết và an toàn theo task. Xem `package.json` trước; không coi sự tồn tại script là bằng chứng nó không đụng database người dùng. Integration phải dùng database tạm; không seed/xóa database demo.

Khi task liên quan browser, Socket, QR, deploy hoặc tải, bổ sung kiểm tra chuyên biệt được mô tả trong `HUONG_DAN_AGENT_NANG_CAP_KIEN_TRUC.md`.

### 6.4 Đánh giá kết quả

Phân loại rõ ràng:

| Trạng thái | Điều kiện | Hành động tiếp theo |
| --- | --- | --- |
| Chấp nhận | Diff đúng phạm vi, review đạt, test liên quan pass | Cập nhật tiến độ và giao gói độc lập tiếp theo nếu có |
| Cần sửa | Hành vi/chất lượng/test chưa đạt nhưng phạm vi còn kiểm soát | Gửi task follow-up chỉ nêu lỗi cụ thể, rồi kiểm tra lại |
| Dừng | CoDev sửa vượt phạm vi, có nguy cơ dữ liệu/secret, hoặc test làm hỏng luồng cốt lõi | Báo người dùng, không tự xóa thay đổi không rõ sở hữu |
| Chờ quyền | Cần cloud account, key, cài dependency, deploy hoặc hành động có phí | Hoàn thiện phần local; hỏi đúng thông tin/quyền còn thiếu |

## 7. Follow-up và session

Không giao lại toàn bộ task sau một lỗi. Dùng task follow-up nêu chính xác:

- test nào thất bại và output/mã lỗi liên quan;
- file/hunk cần sửa;
- giới hạn không được mở rộng phạm vi;
- lệnh xác minh sau khi sửa.

CoDev có session cục bộ. Có thể xem danh sách session:

```powershell
& 'C:\Users\longd\AppData\Roaming\npm\codev.cmd' session list
```

Nếu có session ID phù hợp, tiếp tục cùng ngữ cảnh:

```powershell
& 'C:\Users\longd\AppData\Roaming\npm\codev.cmd' run `
  --session '<SESSION_ID>' `
  --format default `
  '<FOLLOW-UP TASK CONTRACT>'
```

Chỉ dùng `--continue` khi đã xác định session gần nhất thuộc đúng task/worktree. Nếu không chắc, tạo phiên mới để tránh mang context hoặc chỉ thị cũ sang task khác.

Không xóa session bằng `codev session delete` trừ khi người dùng yêu cầu rõ.

## 8. Phân công phù hợp cho CoDev

Ưu tiên giao các gói độc lập, có kết quả kiểm chứng được:

- Khảo sát code, mapping module/API/test và review rủi ro.
- Dockerfile, compose profile local, health/readiness, graceful shutdown theo đặc tả đã chốt.
- Structured logging, metrics, dashboard hoặc test script với phạm vi rõ.
- Tìm kiếm menu thông minh, test truy vấn tiếng Việt, fallback AI.
- Kịch bản k6, báo cáo benchmark và docs, trên môi trường test riêng.
- Bổ sung test hồi quy cho lỗi có reproduction cụ thể.

AI điều phối giữ các quyết định cần hiểu xuyên suốt dự án:

- thay đổi state machine order/table session/payment;
- transaction, idempotency, ownership receipt và Bill;
- thay đổi mô hình dữ liệu/index/migration;
- cơ chế nhiều instance cho Socket, Redis, rate limit và worker;
- deploy cloud, secret, dữ liệu thật và thao tác phá hủy.

Có thể giao phần implementation của các mục này sau khi kiến trúc đã chốt, nhưng bắt buộc review diff và kiểm thử độc lập kỹ hơn.

## 9. Mẫu báo cáo của AI điều phối cho người dùng

Sau mỗi lượt CoDev, báo ngắn và có bằng chứng:

```text
CoDev đã làm: <mục tiêu>.
Thay đổi: <file/chức năng thực tế>.
Kiểm tra độc lập: <lệnh> → <pass/fail>.
Đánh giá: chấp nhận / cần sửa / dừng.
Giới hạn còn lại: <nếu có>.
```

Không nói “đã hoàn thành” nếu chỉ có output text từ CoDev. Không nói “đã deploy”, “high availability” hay “đạt 700 RPS” nếu chưa có cấu hình và số liệu kiểm chứng được.

## 10. Kết thúc phiên điều phối

Trước khi kết thúc, kiểm tra lại:

```powershell
git status --short
git diff --check
```

Cập nhật `PROJECT_MEMORY.md` và tài liệu liên quan chỉ khi thay đổi đã được xác minh. Nêu rõ phần nào đã triển khai, đã test, chỉ mới chuẩn bị cấu hình hoặc chưa làm.

Mục tiêu của playbook này là tiết kiệm token của AI điều phối bằng cách để CoDev thực hiện các gói công việc rõ ràng, trong khi vẫn giữ review độc lập và quyền quyết định cuối cùng ở AI điều phối.
