# Kịch bản video: kiến trúc, thiết kế và các chức năng chung

Thời lượng dự kiến khoảng 16 phút, chia 7 cảnh. Mỗi cảnh gồm hai phần:

- **Màn hình:** những gì cần mở hoặc bấm trong lúc nói.
- **Lời nói:** đọc gần nguyên văn, có thể đổi giọng cho tự nhiên.

Trong các cảnh, màn hình **Khách** nghĩa là cổng khách (8080), không phải nhân vật.

---

## Chuẩn bị trước khi quay

1. Bật hệ thống bằng `scripts\public-web.ps1`. Kiểm tra cả 3 cổng đều mở được: Khách 8080, Staff 8081, Admin 8082.
2. Đăng nhập sẵn hai cửa sổ:
   - Staff: `staff.a@maycafe.vn`
   - Admin: `admin@maycafe.vn`

   **Không quay cảnh gõ mật khẩu.**
3. Mở sẵn một cửa sổ khổ điện thoại (DevTools 390px) hoặc dùng điện thoại thật.
4. Mở sẵn sơ đồ kiến trúc trong [architecture.md](architecture.md) và VS Code với cây thư mục `server/src`.
5. Chuẩn bị một bàn trống để demo vào bàn.
6. **Dọn dữ liệu demo trước khi quay.** Hiện có 10 đánh giá chữ rác và mục `[DEMO #11]` bị lỗi font, nếu để nguyên sẽ lộ trên Admin. Nếu chưa dọn kịp, tránh lia camera qua trang Đánh giá và thẻ bàn đó.
7. Tắt thông báo hệ điều hành. Đặt zoom trình duyệt 110–125% để chữ đọc được trên video.

---

## Cảnh 1 — Mở đầu (0:00–1:00)

**Màn hình:** trang menu của cổng Khách, sau đó chuyển sang sơ đồ ba cổng.

**Lời nói:**

> Em xin trình bày phần kiến trúc, thiết kế và các chức năng chung của hệ thống gọi món qua QR cho quán cà phê Fantastic Cafe.
>
> Ý tưởng chính: khách ngồi vào bàn, quét mã QR là gọi được món ngay trên điện thoại, không cần cài app hay tạo tài khoản. Nhân viên thu tiền trước khi pha, quầy pha chế nhận đơn theo thời gian thực, quản lý xem doanh thu và tình trạng hệ thống.
>
> Hệ thống có ba nhóm người dùng, tương ứng ba cổng riêng: **Khách** ở cổng 8080, **Nhân viên** ở 8081 và **Quản lý** ở 8082.
>
> Em sẽ đi qua ba phần: kiến trúc tổng thể, thiết kế dữ liệu và bảo mật, rồi demo các chức năng theo đúng hành trình của một đơn hàng.

---

## Cảnh 2 — Kiến trúc tổng thể (1:00–3:30)

**Màn hình:** sơ đồ trong `docs/architecture.md`, sau đó VS Code với các thư mục `client`, `server`, `packages/contracts`.

**Lời nói:**

> Về công nghệ: frontend dùng **React, Vite, TypeScript**, quản lý dữ liệu server bằng TanStack Query. Backend dùng **Express, TypeScript và MongoDB** qua Mongoose. Realtime dùng **Socket.IO**, Redis lo rate limit và hàng đợi.
>
> Repo là một monorepo với ba phần. `client` là giao diện. `server` là API. `packages/contracts` chứa các schema **Zod** dùng chung, nhờ vậy frontend và backend kiểm tra dữ liệu theo cùng một định nghĩa và không bị lệch nhau.
>
> *(chỉ vào sơ đồ)* Khi chạy thật, hệ thống dùng Docker Compose. Nginx tách ba cổng. Khách đi vào cụm **Guest API**; nhân viên và quản lý đi vào cụm **Internal API**. Mỗi cụm có hai instance. Lưu lượng của khách vì vậy không làm chậm màn hình thu tiền hay pha chế của nhân viên.
>
> Ngoài API còn có ba worker chạy nền: một worker lên lịch như tự đóng phiên bị bỏ quên, một worker phát sự kiện realtime, và một worker tạo báo cáo.
>
> MongoDB chạy ở chế độ **replica set** vì nhóm em cần **transaction**: thu tiền, đặt đơn, trừ kho phải cùng thành công hoặc cùng thất bại.

**Màn hình:** VS Code, mở lần lượt `routes` → `controllers` → `services` → `repositories`.

> Backend chia bốn tầng:
>
> - **Route** gắn middleware xác thực, phân quyền và rate limit.
> - **Controller** chỉ đọc request và trả response.
> - **Service** chứa toàn bộ nghiệp vụ.
> - **Repository** là nơi duy nhất được truy vấn MongoDB.
>
> Có một script kiểm tra ranh giới chạy cùng lint. Nếu ai đó lỡ gọi thẳng database trong service hay controller, lint sẽ báo lỗi.
>
> Thêm một điểm về realtime. Nếu phát sự kiện ngay trong lúc ghi dữ liệu, server có thể ghi xong nhưng chết trước khi phát, khiến màn hình pha chế không bao giờ thấy đơn. Vì vậy nhóm em dùng **transactional outbox**: sự kiện được ghi vào database **trong cùng transaction** với đơn hàng, rồi worker mới đọc ra và phát qua Socket.IO. Đơn đã lưu thì chắc chắn sẽ có sự kiện.

---

## Cảnh 3 — Thiết kế dữ liệu và nguyên tắc nghiệp vụ (3:30–5:00)

**Màn hình:** thư mục `server/src/models`, mở `Order` và `Bill`.

**Lời nói:**

> Ba nguyên tắc thiết kế xuyên suốt hệ thống.
>
> Thứ nhất, **backend là nguồn sự thật**. Giá, trạng thái đơn và quyền đều do server quyết định. Client gửi giá lên cũng bị bỏ qua, server tự tính lại từ menu trong database.
>
> Thứ hai, **chụp lại thông tin tại thời điểm đặt (snapshot)**. Mỗi món trong đơn lưu tên, size, đơn giá ngay lúc đặt. Hóa đơn khi chốt cũng là bản cố định không sửa được. Mai quản lý đổi giá thì hóa đơn hôm nay vẫn đúng.
>
> Thứ ba, **chống thao tác trùng và tranh chấp**. Mỗi lần đặt đơn hay thu tiền gửi kèm một *Idempotency-Key*. Mạng chập chờn khiến khách bấm hai lần thì server chỉ tạo một đơn. Mỗi đơn còn có trường `version`. Hai nhân viên cùng bấm chuyển trạng thái một đơn thì chỉ một người thành công, người kia nhận thông báo đơn vừa được cập nhật.

---

## Cảnh 4 — Tài khoản, phân quyền và quản trị danh mục (5:00–7:00)

### 4a. Đăng nhập, phân quyền, tài khoản cá nhân

**Màn hình:** trang `/auth/login` của cổng Staff, đăng nhập. Sau đó vào trang tài khoản cá nhân.

**Lời nói:**

> Nhân viên và quản lý đăng nhập bằng email và mật khẩu. Mật khẩu băm bằng **bcrypt**. Sau khi đăng nhập:
>
> - **Access token** chỉ nằm trong bộ nhớ trình duyệt, không lưu localStorage, nên đoạn script lạ khó đánh cắp.
> - **Refresh token** nằm trong cookie HttpOnly và đổi mới mỗi lần làm mới.
>
> Có hai vai trò: **STAFF** và **ADMIN**. Mọi API `/staff` yêu cầu STAFF hoặc ADMIN, mọi API `/admin` chỉ cho ADMIN. Việc kiểm tra quyền làm ở server, nên ẩn nút trên giao diện chỉ để tiện dùng, không phải lớp bảo vệ.
>
> Ở trang tài khoản cá nhân, mỗi người sửa được tên, đổi mật khẩu và **đăng xuất khỏi mọi thiết bị**. Đăng nhập sai nhiều lần bị giới hạn tần suất.

### 4b. Quản lý nhân viên

**Màn hình:** Admin → Nhân viên. Tạo thử một tài khoản, sau đó khóa tài khoản đó.

> Quản lý tạo tài khoản nhân viên, đổi vai trò, khóa hoặc xóa tài khoản. Tài khoản bị khóa không làm mới được phiên đăng nhập nữa. Quản lý cũng không tự khóa hay tự hạ quyền của chính mình được, để tránh bấm nhầm rồi mất quyền quản trị.

### 4c. Danh mục, sản phẩm, topping

**Màn hình:** Admin → Danh mục, rồi Món, mở form sửa một món có nhiều size. Sau đó vào Topping.

> Danh mục nhóm các món lại, ví dụ cà phê, trà, bánh. Mỗi sản phẩm có ảnh, mô tả, nhiều size với giá riêng và thông tin như có caffeine hay có sữa. Thông tin này dùng cho bộ lọc và AI gợi ý.
>
> Topping quản lý riêng và gắn được vào nhiều món.
>
> Món đã từng được bán sẽ **lưu trữ** thay vì xóa hẳn, để đơn và hóa đơn cũ không bị mất liên kết. Tắt hoặc bật một món, khách thấy cập nhật ngay mà không cần tải lại trang.

---

## Cảnh 5 — Hành trình của khách (7:00–10:30)

### 5a. Quản lý bàn, QR và vào bàn

**Màn hình:** Admin → Bàn & QR tĩnh, bấm **Xem QR tĩnh**. Sau đó dùng điện thoại quét mã, hoặc bấm **Mở link vào bàn** trong cửa sổ khổ điện thoại.

**Lời nói:**

> Mỗi bàn có một mã QR. Mã chứa ID bàn kèm một **chữ ký HMAC** do server tạo, nên khách không tự sửa số bàn trong link để vào bàn khác được.
>
> *(Nói thật về QR động)* Ban đầu nhóm em làm QR động, đổi mỗi 60 giây. Khi thử vận hành, nhóm thấy quán phải đặt màn hình ở từng bàn, khá tốn kém, nên chuyển sang QR cố định có chữ ký để in dán tại bàn. Khi cần vô hiệu mã cũ, ví dụ ai đó chụp lại mã mang đi, quản lý bấm **cấp lại khóa**: mã cũ mất hiệu lực ngay.
>
> Khách quét mã thì server **tự mở phiên phục vụ** cho bàn, nhân viên không cần mở trước. Nhiều người trong nhóm cùng quét thì vào chung một phiên, nhưng **mỗi điện thoại có danh tính riêng**, chỉ thấy và hủy được đơn của mình. Quyền của khách lưu trong cookie HttpOnly và bị thu hồi khi phiên đóng.

### 5b. Xem menu, tìm kiếm, lọc và AI gợi ý

**Màn hình:** trang menu. Gõ "tra dao it ngot" không dấu, bấm thử một bộ lọc. Sau đó mở AI Barista và hỏi "món chua chua dưới 50k".

> Menu có ảnh lớn ở đầu, bên dưới là danh sách đầy đủ theo danh mục. Ô tìm kiếm hiểu được tiếng Việt **không dấu**, chấp nhận gõ sai nhẹ, hiểu cả ngân sách như "dưới 40k" và điều kiện như "không sữa". Bộ lọc dùng kết hợp với tìm kiếm được.
>
> AI Barista là trợ lý gợi ý món, thiết kế theo nguyên tắc **AI chỉ đề xuất, backend quyết định**:
>
> - Câu hỏi khớp luật có sẵn thì trả lời luôn, không gọi model.
> - Câu tự do thì model chỉ trích ra ý định của khách, còn việc chọn món do backend xếp hạng từ menu thật trong database.
> - Mọi món gợi ý đều được kiểm lại giá, size còn bán, tồn kho và điều kiện như không caffeine.
> - Model lỗi hoặc trả sai định dạng thì tự chuyển sang chế độ chấm điểm theo luật.
>
> AI **không bao giờ tự đặt đơn**. Khách phải tự bấm thêm vào giỏ.

### 5c. Gọi nhân viên và xử lý yêu cầu

**Màn hình:** Khách bấm **Gọi nhân viên**. Chuyển sang Staff → Yêu cầu: yêu cầu hiện lên ngay, bấm **Đã xử lý**.

> Khách gọi nhân viên hoặc yêu cầu thanh toán ngay trên điện thoại. Yêu cầu hiện lên màn hình nhân viên theo thời gian thực. Nhân viên xử lý xong bấm hoàn tất, hệ thống ghi lại ai xử lý. Khách không spam được vì có giới hạn tần suất theo bàn.

---

## Cảnh 6 — Đơn hàng, pha chế và giám sát (10:30–13:30)

### 6a. Tùy chỉnh món, giỏ hàng, đặt và hủy, theo dõi đơn

**Màn hình:** Khách chọn một món, đổi size, đường, đá, thêm topping, cho vào giỏ rồi **Đặt món**. Mở trang theo dõi đơn.

**Lời nói:**

> Khi chọn món, khách tùy chỉnh size, mức đường, đá và topping. Giá cập nhật ngay trên màn hình, nhưng khi bấm đặt, server **tính lại toàn bộ**. Nếu trong lúc đó quản lý vừa đổi giá hay một món vừa hết, khách được báo để xác nhận lại chứ không bị tính sai.
>
> Đơn mới ở trạng thái **Chờ thanh toán**. Quán này thu tiền trước rồi mới pha.
>
> Về hủy đơn:
>
> - Chưa trả tiền: khách tự hủy được.
> - Đã trả nhưng chưa pha: khách gửi **yêu cầu hủy**, nhân viên duyệt và hoàn tiền.
> - Đã bắt đầu pha: không hủy được nữa.
>
> Trang theo dõi đơn cập nhật trạng thái theo thời gian thực.

### 6b. KDS và cảnh báo chậm

**Màn hình:** Staff → Khoản thu, thu tiền đơn vừa đặt. Chuyển sang Staff → KDS: đơn xuất hiện. Kéo đơn qua Đã nhận → Đang pha → Sẵn sàng → Đã phục vụ. Chỉ vào một đơn đang đổi màu cảnh báo nếu có.

> KDS là màn hình của quầy pha chế, gồm bốn cột: **Đã nhận, Đang pha, Sẵn sàng, Đã phục vụ**. **Chỉ đơn đã thu tiền mới vào KDS**, nên quầy không pha nhầm đơn chưa trả.
>
> Đơn nằm quá lâu ở một bước thì được đánh dấu **chậm**: quá 5 phút ở bước nhận hoặc sẵn sàng, quá 10 phút ở bước đang pha. Nhờ vậy quản lý ca thấy ngay đơn nào đang bị bỏ quên.
>
> Mỗi bước chuyển trạng thái đều qua máy trạng thái ở server: không nhảy cóc, không lùi bước, có ghi lại ai chuyển.

### 6c. Đánh giá đơn

**Màn hình:** Khách mở hóa đơn sau khi phục vụ, chấm sao. Chuyển sang Admin → Đánh giá.

> Sau khi được phục vụ, khách đánh giá từ 1 đến 5 sao kèm nhận xét. Mỗi đơn chỉ đánh giá một lần. Quản lý xem toàn bộ đánh giá trên Admin.

### 6d. Giám sát vận hành hệ thống

**Màn hình:** Admin → Vận hành.

> Trang Vận hành cho quản lý thấy sức khỏe của chính hệ thống:
>
> - Từng instance API và worker còn sống hay không, kết nối MongoDB và Redis.
> - Hàng đợi sự kiện có bị kẹt không.
> - Các cảnh báo bất thường như tỉ lệ hủy tăng đột biến hay thu tiền lệch.
>
> Sự kiện phát thất bại được liệt kê để **phát lại**, và mỗi lần phát lại đều được ghi nhật ký. Chỗ nào thiếu dữ liệu, trang ghi rõ là thiếu, không tự điền số đẹp.

---

## Cảnh 7 — Tiền và báo cáo (13:30–16:00)

### 7a. Thu tiền, hoàn tiền, điều chỉnh khoản thu

**Màn hình:** Staff → Bàn & phiên, bấm thu tiền cho một bàn. Sau đó vào Khoản thu, mở một khoản thu và bấm **Yêu cầu điều chỉnh**.

**Lời nói:**

> Thu tiền là phần nhóm em cẩn thận nhất.
>
> Khi một nhân viên bắt đầu thu tiền một bàn, hệ thống **giữ quyền thu bàn đó** cho người này. Nhân viên thứ hai mở cùng bàn sẽ bị chặn, tránh thu trùng tiền. Mỗi lần thu có idempotency key, nên bấm hai lần cũng chỉ ghi một khoản.
>
> **Hoàn tiền** áp dụng cho đơn đã thu mà chưa pha. Hoàn tiền xong, hệ thống hủy đơn và trả lại nguyên liệu đã giữ trong kho.
>
> Thu nhầm, như ghi sai phương thức hay ghi vào nhầm đơn, thì không sửa thẳng số liệu. Nhân viên tạo **yêu cầu điều chỉnh** với ba loại: hủy khoản thu, đổi phương thức, chuyển sang đơn khác. Quản lý duyệt thì mới có hiệu lực, và lịch sử giữ đủ bản gốc lẫn bản điều chỉnh.

### 7b. Hóa đơn và in

**Màn hình:** Staff → Bàn & phiên, đóng phiên và mở hóa đơn, bấm **In**. Sau đó vào Admin → Hóa đơn.

> Khi nhân viên đóng phiên, hệ thống chốt **hóa đơn** cho cả bàn. Hóa đơn là bản chụp cố định, không sửa được. Nhân viên in trực tiếp từ trình duyệt, khách xem lại trên điện thoại. Quản lý tra cứu toàn bộ hóa đơn cũ ở Admin.

### 7c. Ca thu ngân và đối soát

**Màn hình:** Staff → Ca thu ngân. Mở form chốt ca, nhập số tiền đếm được lệch đi vài nghìn để hệ thống đòi nhập lý do. Sau đó vào Admin xem lịch sử ca.

> Đầu ca, thu ngân mở ca và nhập **tiền đầu ca** trong két. Cuối ca, họ đếm và nhập **tiền thực tế**. Hệ thống tự tính tiền **lẽ ra phải có** bằng tiền đầu ca, cộng tiền mặt thu được, trừ tiền mặt đã hoàn.
>
> Hai con số lệch nhau thì bắt buộc nhập lý do mới chốt được. Còn bàn đang thu dở thì không chốt ca được. Mọi lần chốt ca đều lưu số chênh lệch và người chốt, để quản lý đối soát sau.

### 7d. Thống kê doanh thu, top món, xuất báo cáo

**Màn hình:** Admin → Dashboard, chọn khoảng 30 ngày. Chỉ lần lượt KPI, biểu đồ theo ngày, giờ cao điểm, top món. Bấm **Xuất báo cáo**.

> Dashboard hiển thị:
>
> - **Thực thu ròng**: tiền đã thu, trừ tiền hoàn, cộng điều chỉnh.
> - Số đơn, giá trị trung bình mỗi đơn, so sánh với kỳ trước.
> - Doanh thu theo ngày, có cả những ngày bằng 0 để biểu đồ không bị méo.
> - Giờ cao điểm, tỉ lệ hủy, doanh thu theo danh mục và theo phương thức thanh toán.
> - **Top món bán chạy**.
>
> Biểu đồ nào cũng có phần "Cách đọc".
>
> Nút xuất báo cáo tạo file **CSV** mở được bằng Excel. Báo cáo do **worker chạy nền** tạo, nên xuất dữ liệu lớn cũng không làm chậm các API khác.
>
> *(Nếu số liệu demo lộ ra)* Số liệu hiện tại là dữ liệu kiểm thử: tỉ lệ hủy cao vì nhóm em thử nhiều kịch bản hủy và hoàn tiền, nên không phản ánh một quán thật.

---

## Kết thúc (16:00–16:30)

**Màn hình:** quay lại sơ đồ kiến trúc.

> Tóm lại, hệ thống đi trọn hành trình: quét QR, gọi món, thu tiền, pha chế, hóa đơn, đánh giá, đến báo cáo cho quản lý.
>
> Ba điều nhóm em ưu tiên là **đúng tiền**, **không mất đơn** và **phân quyền rõ ràng**. Đó là lý do có transaction, idempotency, outbox và kiểm tra ranh giới giữa các tầng. Hệ thống có hơn 600 test tự động, gồm cả test chạy trên MongoDB thật có transaction.
>
> Em xin cảm ơn thầy cô đã theo dõi.

---

## Những câu không nên nói trong video

- **Không nói "QR động đổi mỗi 60 giây"** như chức năng đang chạy. Hiện quán dùng QR cố định có chữ ký; QR động là phiên bản cũ (xem cảnh 5a).
- **Không nói "AI hiểu mọi câu hỏi".** AI có thể gợi ý bánh khi khách hỏi đồ uống không caffeine; lỗi này chưa sửa. Chỉ demo những câu đã thử trước.
- **Không nói "có thanh toán online".** Hệ thống chỉ ghi nhận khách đã trả tại quầy (tiền mặt, chuyển khoản, khác).
- **Không khẳng định đã thử trên nhiều điện thoại thật** nếu chưa thử. Nếu quay bằng điện thoại thật, nói đúng loại máy đã dùng.
