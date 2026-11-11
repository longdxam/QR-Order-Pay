# Bối cảnh thiết kế Fantastic Cafe

Nguồn: README, contracts, model/service và giao diện hiện có. Áp dụng cho cả Khách, Nhân viên và Quản trị theo yêu cầu ngày 13/10/2026.

## Mục đích và ưu tiên

Tên sản phẩm trong [README](../README.md): **Fantastic Cafe — QR Ordering & AI Barista**. Đây là hệ thống MERN đặt đồ uống qua QR tại bàn cho một quán cà phê, có AI Barista tư vấn từ menu thật; mục tiêu là bài tập lớn Lập trình Web với dữ liệu thật, kiến trúc phân tầng, kiểm thử và tài liệu.

Luồng hiện tại dùng **QR tĩnh → thực đơn → tùy chỉnh món**. User đã yêu cầu gỡ trang chủ `/home` ngày09/11/2026; vào bàn đến thẳng `/menu`, URLHome cũ chuyển sang menu, không còn banner hoặc mục Trang chủ. Root/PWA trở về `/t` để vào bàn; logo mở thực đơn. Các số liệu doanh thu thuộc cổng quản trị và đứng sau thao tác phục vụ/quản lý trong thứ bậc giao diện.

## Hình dạng nghiệp vụ quyết định bố cục

### Trang thực đơn theo ảnh tham chiếu

Chỉ báo món tối đa6chấm trắng, có nút bấm và aria-current. Khi quá6món, giữ chấm đầu/đích mónđầu, chấmcuối/đích móncuối và4vịtrí thật quanh món hiện tại; không chia nhóm làm sáng chấmcuối sớm. Chấmcuối chỉ sáng khi active đúngmóncuối; đổi lọc cập nhật lại danh sách/vịtrí. Chấm nằm giữa sát đáy, có vùng chạm24px, không mở cấu hình khi bấm. Hai nút chuyển món chỉ còn nét chevron ‹ › trắng24px có bóng nhẹ, vùng chạm46px trong suốt; bỏ nền/viền tròn. Chừa32px dưới caption cho hàng chấm, theo cùng biến khoảngđáy tránh dock/giỏ.

Theo yêu cầu mới nhất ngày09/11/2026, hero không có thẻ món; hai dấu chuyển trước/sau đặt riêng ở mép trái/phải, giữa chiều cao ảnh. Chuyển vòng đầu/cuối, không autoplay; khóa hai nút khi chỉ1món, không hiện khi rỗng/loading. Hỗ trợ phím trái/phải trong nhóm nút, giữ focus; thông tin aria-live đồng bộ ảnh/tên/mô tả/giá với món đang xem. Bộ lọc chỉ điều hướng trong kết quả hiện tại.

Bên dưới hero có `MenuCatalog.tsx` với section `#menu-catalog`. Mặc định tiêu đề “Thực đơn đầy đủ”, hiển thị toàn bộ món chưa archived chia theo danh mục (kể cả món tạm hết); chọn danh mục ở hero vẫn giữ danh sách đầy đủ khi không tìm kiếm. Khi có từ khóa hoặc bộ lọc tìm kiếm, section đổi thành “Kết quả tìm kiếm” và chỉ hiển thị các món từ `/menu/search`, ánh xạ về catalog hiện tại, loại món archived. Nhập từ khóa mới bỏ danh mục đang chọn để tránh mất kết quả khác nhóm. Ô tìm kiếm là form: Enter/phím Tìm trên điện thoại hoặc nút kính lúp gửi ngay, cuộn tới section và chuyển focus vào kết quả (tôn trọng reduced motion). Gõ tiếp vẫn cập nhật kết quả theo debounce350ms; không tự cuộn khi chỉ đang gõ. Pending/lỗi/không khớp đều hiển thị ngay ở danh sách, không trộn món từ kết quả cũ hoặc danh sách đầy đủ. Nút “Xem toàn bộ thực đơn” xóa từ khóa và bộ lọc. Nút “↓ Thực đơn” vẫn là anchor tới section focusable với scroll-margin84px tránh header. Card có ảnh thật lazy, tên/mô tả/giá từ size rẻ nhất còn bán; bấm mở ProductDetailModal hiện tại, món tạm hết hiển thị nhãn và không chọn được. Lưới4/3/2cột desktop/tablet/mobile, nền ngà/thẻ trắng, padding đáy140px tránh giỏ/dock.

Thông tin món là chữ nổi không hộp/viền, tên22px desktop/20px mobile, mô tả13px, giá20px; nền thực sự transparent. Một lớp sáng radial loang/blur18px chỉ sau vùng chữ giúp đọc trên ảnh, không dùng tấm nền trắng có cạnh. Giữ link ↓Thựcđơn dẫn tới danh sách đầy đủ. Chạm ảnh (kể cả phần chữ) mở cấu hình món đang xem; không chọn món khi nhấn dấu chuyển, chấm, công cụ hoặc link danh sách. Món tạm hết không mở cấu hình từ ảnh nhưng vẫn vuốt xem được.

Ô tìm món dùng chữ16px ở mọi kích thước, bỏ override11px trên điện thoại để tránh Safari tự zoom khi focus. Giữ nguyên viewport và khả năng pinch zoom của người dùng. Kết quả tìm kiếm chỉ hiển thị từ khóa và “Tìm thấy N món phù hợp.” theo số thẻ thực tế; bỏ giải thích giá/cấu hình, nhóm “Đã hiểu”, “từ khóa tự do” và hướng dẫn sửa câu. Bộ lọc và thuật toán tìm kiếm vẫn hoạt động như trước. Cần kiểm tra tự zoom/thoát bàn phím trên iPhone thật; Lightpanda không xác minh được hành vi Safari này.

Quản lý món Admin có ô tìm theo tên, không phân biệt dấu tiếng Việt/hoa thường và chuẩn hóa khoảng trắng. Lọc trực tiếp danh sách đã tải, giữ nút Sửa/Xóa/Khôi phục trên đúng món; có số kết quả và nút xóa tìm kiếm. Món đã xóa vẫn nằm riêng trong nhóm tương ứng; nhóm tự mở khi khớp từ khóa. Không có kết quả hiển thị rõ thay vì bảng trống. Thống kê đơn ở Vận hành dùng chung phạm vi KDS để tránh lẫn đơn lịch sử của phiên đã đóng hoặc không còn tồn tại.

Vuốt ảnh bằng Pointer Events: vuốt trái→món tiếp, phải→món trước khi ngang>=48px và ngang>1.25×dọc; chuyển ảnh không mở modal. Touch-action pan-y pinch-zoom giữ cuộn dọc và phóng to. Chặn click sau drag/cancel trong600ms, lần chạm mới reset; đa điểm hủy gesture. Không gắn xử lý vào danh mục/tìm kiếm để giữ thao tác cuộn ngang danh mục và nhập liệu.

Danh mục nằm bên trái và cùng hàng với tìm kiếm/lọc/AI trong `.menu-toolbar` trên màn hình từ700px; danh mục co lại và cuộn ngang khi thiếu chỗ, cụm tìm kiếm giữ chiều rộng. Dưới700px, tìm kiếm ở hàng trên và danh mục cuộn ngang ở hàng dưới. Panel lọc vẫn nằm dưới toolbar.

Bố trí mới nhất ngày09/11/2026: thông tin căn đáy trái; mũi tên ở hai mép ảnh và không chiếm hàng dưới chữ. Dùng100dvh trừ header60px để theo chiều cao đang nhìn thấy trên Safari; dưới1024px chừa đáy84px +safe-area, có giỏ148px +safe-area thay136/200px cũ. Caption theo luồng trang tự giãn khi nội dung dài; công cụ/link/mũi tên ở trên lớp chạm ảnh, dock/giỏ vẫn ở lớp riêng bên ngoài.

`/menu` dùng hero ảnh nền phủ màn hình; ảnh, tên, mô tả, danh mục và giá lấy từ catalog. Theo ảnh Coffo ngày09/11/2026, dùng header sáng sticky, nền trắng ngà, chữ nâu cà phê, điểm nhấn vàng be. Giữ font Be Vietnam Pro và thao tác chuyển món chủ động.

`MenuShowcase.tsx`, `MenuPhoto.tsx`, `menuImages.ts`, `menu-showcase.css` là các file chính. `client/public/menu-images/SOURCES.md` ghi nguồn ảnh từ Product.image thật; URL không phải ảnh dùng nền/icon dự phòng, không gán ảnh món khác.

Ảnh nền dùng lớp phủ ngà10% đồng đều và căn giữa. Ô “Hôm nay uống gì?”, thẻ ngang và thanh tiến trình/bộ đếm cũ vẫn đã bỏ. Không chuyển món sang article ảnh riêng. Preload hai ảnh liền kề, animation tắt theo reduced-motion. Bố cục, hiệu ứng trong suốt và khả năng đọc thực tế chưa nghiệm thu trực quan bằng Lightpanda.

Thanh Guest desktop gom logo/tên bàn, navigation và tài khoản/rời bàn vào cùng một hàng `lg:flex-nowrap`, bỏ nav order-last/basis-full/viền trên. Navigation vẫn có overflow-x-auto khi hẹp; mobile dùng dock như trước. Riêng menu đặt header min-height60px, padding dọc8px, nav padding8×10px. Khoảng đầu thực đơn24px; khoảng tools/nội dung32px desktop và24px mobile. Chiều cao tối thiểu hero tính `100dvh - 60px`, vẫn chừa chỗ cho giỏ nổi/dock. Không coi CSS min-height là chứng minh chiều cao render thực tế; cần kiểm trường hợp đăng nhập tại bàn có đủ liên kết trên màn hình thật.

### Cửa sổ và bề mặt khách đồng bộ với thực đơn

Theo yêu cầu ngày 09/11/2026, cả ba portal dùng nền trắng ngà/chữ nâu cà phê/vàng be, thay theme khách xanh đậm trước đó. `styles/guest-surfaces.css` định nghĩa bề mặt trắng, viền, overlay mờ, header/đóng, thẻ gợi ý và dock; token chung nằm ở `index.css`. `useGuestTheme` giới hạn kiểu riêng và áp cả cửa sổ Radix ở body. Staff/Admin có sidebar trắng và vùng đăng nhập be nhạt. Khi in dùng giấy trắng/chữ nâu đậm. PWA và thanh màu trình duyệt cũng dùng nền ngà.

AI Barista dùng nội dung/preset sẵn có, nhãn mô tả khẩu vị rõ ràng, trạng thái chọn và đang hỏi, kết quả có ảnh catalog qua MenuPhoto, lý do/size/caffeine/sữa/giá và nhãn fallback từ API. Kết quả mới cuộn vào vùng xem, header cửa sổ dài giữ nút đóng. Size/đường/đá, bộ lọc, giỏ/phiếu đơn, đánh giá và vào bàn kế thừa cùng bảng màu. QR vẫn là ảnh đen trắng có nền trắng của thư viện qrcode.

- **Khách:** danh mục → món → size/đường/đá/topping → giỏ → đơn. Product chứa ảnh, mô tả, basePrice, variants, allowedOptions, isAvailable/isArchived/isFeatured. Danh mục và món là cấu trúc chính của trang menu; AI Barista là hỗ trợ chọn món.
- **Nhân viên:** hàng chờ thu tiền → các cột KDS → phục vụ. Đơn mới `AWAITING_PAYMENT / UNPAID`; nhận đủ tiền mới `PENDING / PAID`. KDS dùng các nhãn **Chờ xác nhận**, **Đã nhận**, **Đang pha**, **Sẵn sàng**. Không đưa đơn chưa trả tiền vào hàng pha chế.
- **Quản trị:** bàn/QR, món/danh mục/topping, hóa đơn, nhân viên, đánh giá và báo cáo. Các thao tác quản lý dùng route và quyền hiện có; số liệu lấy API/report job thật.
- **Phiên bàn:** `OPEN`, `CHECKOUT`, `CLOSED`; một phiên hoạt động cho mỗi bàn. Đánh giá gắn với đơn `SERVED + PAID`, mỗi đơn một lần; đánh giá không kết thúc phiên. Chỉ đóng phiên mới chốt Bill và thu hồi quyền gọi món.

## File quan trọng

[InternalShell.tsx](../client/src/components/layout/InternalShell.tsx) dùng chung Staff/Admin. Thanh bên desktop thu gọn logo36px, menu38px/mục, gap2px; tên tài khoản và icon đăng xuất nằm cùng một hàng, giữ aria-label/title và link tài khoản. Header nội bộ min56px thay76px. Mobile vẫn có bộ chọn Tất cả chức năng, đóng sau chọn/Escape. Staff ưu tiên Bàn & phiên → KDS → Yêu cầu → Ca thu ngân → Khoản thu → Hết món → Đặt bàn → Lịch & chấm công → Ảnh cốc → Jukebox. Admin ưu tiên Dashboard → Vận hành → Bàn → Đặt bàn → Hóa đơn → Khoản thu rồi menu/kho/nhân sự và chức năng bổ trợ. Bỏ các đoạn giới thiệu tĩnh dưới tiêu đề ở trang nội bộ; giữ lỗi/trạng thái dữ liệu, quy định trong mục trợ giúp và hướng dẫn có tác dụng quyết định thao tác.

Trang Admin Vận hành mở bằng trạng thái kết nối,4số liệu bàn/đơn/yêu cầu/chờ lâu nhất, tiến độ đơn và tác vụ cần xử lý. Hàng đợi lỗi có trạng thái loading/error/retry thật, không hiển thị nhầm rỗng khi API lỗi; nút thử lại vẫn gọi endpoint cũ, refresh cả summary/failures/anomalies. Cảnh báo bất thường vẫn ở phần chính, các chỉ số/evidence có mục mở rộng. MongoDB/Redis/HTTP/bộ nhớ/workers/outbox/sự kiện/thời gian công đoạn nằm trong Chi tiết kỹ thuật đóng mặc định; giữ phạm vi instance so với database. Kiểm trạng thái worker theo heartbeat và đủ3role (hoặcroleall), không coi idle/không có tiến độ là mất kết nối. Bố cục/kích thước thực tế vẫn cần kiểm trực quan ngoài Lightpanda.

| File                                                                                                                                                                                                      | Vai trò                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [README.md](../README.md), [PROJECT_MEMORY.md](../PROJECT_MEMORY.md)                                                                                                                                      | Mục đích, phạm vi, luồng mới nhất và những giới hạn đã biết        |
| [client/src/App.tsx](../client/src/App.tsx)                                                                                                                                                               | Route, portal Khách/Staff/Admin và áp theme khách                  |
| [client/src/styles/index.css](../client/src/styles/index.css), [tailwind.config.js](../client/tailwind.config.js)                                                                                         | Token màu/chữ, phiếu gọi món, sheet, spacing và component styles   |
| [client/src/layouts](../client/src/layouts)                                                                                                                                                               | Điều hướng và trạng thái phiên/kết nối theo vai trò                |
| [client/src/features/guest/MenuPage.tsx](../client/src/features/guest/MenuPage.tsx), [ProductDetailModal.tsx](../client/src/features/guest/ProductDetailModal.tsx)                                        | Catalog theo danh mục và tùy chọn món từ dữ liệu thật              |
| [client/src/features/guest/TableDisplayPage.tsx](../client/src/features/guest/TableDisplayPage.tsx), [JoinPage.tsx](../client/src/features/guest/JoinPage.tsx)                                            | QR có hạn, link vào bàn và lỗi tham gia phiên                      |
| [client/src/features/staff/KDS.tsx](../client/src/features/staff/KDS.tsx), [AwaitingPayments.tsx](../client/src/features/staff/AwaitingPayments.tsx)                                                      | Các công đoạn và nhận tiền từng đơn                                |
| [client/src/features/admin](../client/src/features/admin)                                                                                                                                                 | Quản lý catalog/bàn/nhân viên, hóa đơn và số liệu thực             |
| [packages/contracts/src/schemas.ts](../packages/contracts/src/schemas.ts)                                                                                                                                 | Trạng thái, quyền, phương thức thanh toán và DTO dùng chung        |
| [server/src/models/Product.ts](../server/src/models/Product.ts), [TableSession.ts](../server/src/models/TableSession.ts)                                                                                  | Cấu trúc món, lựa chọn và vòng đời phiên                           |
| [server/src/services/orderService.ts](../server/src/services/orderService.ts), [paymentService.ts](../server/src/services/paymentService.ts), [reviewService.ts](../server/src/services/reviewService.ts) | Điều kiện đặt, nhận tiền, chuyển công đoạn và đánh giá             |
| [compose.production.yaml](../compose.production.yaml), [docker/nginx/default.conf](../docker/nginx/default.conf)                                                                                          | Portal Khách 8080, Staff 8081, Admin 8082 và tách API theo vai trò |

## Nhận diện cần kế thừa

Sau feedback thiếu tương phản trên tất cả màn hình ngày 09/11/2026, dùng chữ và primary nâu đậm hơn, viền điều khiển riêng, focus đặc. Nút chính, mục đang chọn, đường/đá và AI preset dùng primary/chữ trắng; thẻ món đang xem có vòng viền nâu. Be vẫn dùng trang trí; chữ/biểu tượng nhấn và dữ liệu biểu đồ dùng accent-ink. Xem tỷ lệ màu pha alpha trong `design-system.md`; không coi DOM/CSS của Lightpanda là nghiệm thu render trực quan.

| Token           | Khách / Nhân viên / Quản trị |
| --------------- | ---------------------------- |
| Nền             | `#F8F7F5`                    |
| Chữ             | `#251E19`                    |
| Primary         | `#69432C`                    |
| Accent          | `#CEAB84`                    |
| Chữ phụ         | `#574A40`                    |
| Chữ nhấn        | `#875127`                    |
| Viền bề mặt     | `#B09A87`                    |
| Viền điều khiển | `#7E6958`                    |
| Card            | `#FFFFFF`                    |
| Font giao diện  | Be Vietnam Pro               |
| Font tiêu đề    | Be Vietnam Pro               |

Các giá trị lấy từ CSS đang triển khai. Theme khách chỉ áp trên portal/path khách, bao gồm cửa sổ Radix. Nút bo tròn với chiều cao 36/40/48 px; card bo `rounded-2xl`, bóng `soft`; modal dùng Radix. Guest có dấu mây SVG, thanh điều hướng dưới trên điện thoại, dòng món có ảnh và phiếu hóa đơn mép răng cưa. Giữ những đặc điểm này khi cải thiện bố cục.

Theo yêu cầu đổi tên và kiểu chữ ngày 13/10/2026, tên hiển thị là **Fantastic Cafe** và cả ba portal dùng **Be Vietnam Pro**, weight 400/500/600/700/800. Font WOFF2 và giấy phép OFL nằm trong `client/public/fonts/`, được phục vụ/cached cùng ứng dụng. Tiêu đề khách dùng weight 700, tiêu đề phụ 600; không dùng font hẹp hoặc serif cũ.

## Nội dung thật

- Heading menu: **Thực đơn** (sr-only ở hero), **Thực đơn đầy đủ** ở danh sách; tìm kiếm **Tìm món**; hỗ trợ **Hỏi AI Barista**.
- Điều hướng khách: **Thực đơn**, **AI Barista**, **Đơn của tôi**, **Gọi nhân viên**; sau đóng phiên chuyển sang **Hóa đơn**.
- Staff ưu tiên **Bàn & phiên**, **KDS**, **Yêu cầu**, **Ca thu ngân**, **Khoản thu**, **Hết món**.
- Admin: **Dashboard**, **Vận hành**, **Hóa đơn**, **Món**, **Danh mục**, **Topping**, **Bàn & QR**, **Nhân viên**, **Đánh giá**.
- Menu public thực tế đọc ngày 13/10/2026 có **Espresso Mây**, **Bạc Xỉu Đá**, **Cà phê Dừa**, **Americano**, **Cappuccino**; tên/giá/ảnh hiển thị vẫn lấy API ở thời điểm dùng, không hardcode từ bản ghi này.
- Thông báo QR: **QR đã hết hạn hoặc bị thu hồi. Vui lòng quét mã mới trên màn hình tại bàn.** Hiển thị đúng lỗi server thay vì dẫn khách dùng QR tĩnh cũ.

## Mục tiêu triển khai

1. Khách thấy món và thao tác chọn/đặt trước phần hỗ trợ; QR/link vào bàn rõ ràng, giữ trải nghiệm dùng một tay trên điện thoại.
2. Nhân viên nhìn rõ đơn chờ thu tiền và các công đoạn, trạng thái/số lượng lấy dữ liệu thật; nhận diện bàn và hành động tiếp theo nổi bật.
3. Quản trị có điều hướng quản lý nhất quán, bàn/QR và catalog dễ truy cập, báo cáo vẫn đúng bộ lọc và quyền.
4. Cả ba portal sử dụng token/component hiện có, hỗ trợ kích thước mobile/tablet/desktop và trạng thái tải/rỗng/lỗi. Không thêm dữ liệu thống kê, chứng thực khách hàng, ưu đãi hoặc tính năng chưa tồn tại.
5. Giữ các điều kiện thanh toán, quyền sở hữu đơn, đánh giá từng đơn, hóa đơn bất biến và phân quyền HTTP/socket. Không mở rộng sang nhiều chi nhánh, giao hàng, kho nguyên liệu hay cổng thanh toán tự động.
