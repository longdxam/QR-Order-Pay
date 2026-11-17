# Lời văn trình bày — kiến trúc, thiết kế và các chức năng chung

Đọc liền mạch khoảng 15 phút (phần chung khoảng 10 phút, hai chức năng kho và khuyến mãi khoảng 5 phút). Câu in nghiêng trong ngoặc là gợi ý thao tác, không đọc.

---

## 1. Mở đầu

Em xin chào thầy cô. 
Đề tài của nhóm em là xây dựng 1 hệ thống gọi món qua QR cho quán ca phe
Khách ngồi vào bàn, quét QR là gọi món ngay trên điện thoại, không cần cài ứng dụng. Nhân viên thu tiền trước khi pha, quầy pha chế nhận đơn theo thời gian thực, quản lý theo dõi doanh thu và tình trạng hệ thống. Ba nhóm người dùng có ba cổng riêng: khách ở cổng 8080, nhân viên ở 8081, quản lý ở 8082.
Em xin trình bày kiến trúc, thiết kế và các chức năng chung của đề tài như sau

## 2. Kiến trúc tổng thể

*(Mở ảnh docs/hinh-trinh-bay/1-cong-nghe-va-cac-tang.png.)* Frontend dùng React, Vite và TypeScript. Backend dùng Express, TypeScript và MongoDB. Realtime dùng Socket.IO, Redis lo giới hạn tần suất và hàng đợi. Mã nguồn là một monorepo gồm client, server và packages/contracts. Phần contracts chứa schema Zod dùng chung cho hai phía, nên frontend và backend luôn kiểm tra dữ liệu theo cùng một định nghĩa.

*(Mở docs/so-do-kien-truc.html, chỉ vào sơ đồ.)* Hệ thống chạy bằng Docker Compose. Nginx tách ba cổng: khách đi vào cụm Guest API, nhân viên và quản lý đi vào cụm Internal API, mỗi cụm hai instance. Nhờ vậy lúc quán đông, truy cập của khách không làm chậm màn hình thu tiền và pha chế. Ngoài ra có ba worker chạy nền, lo tác vụ theo lịch, phát sự kiện realtime và tạo báo cáo. MongoDB chạy replica set để dùng transaction, vì đặt đơn, thu tiền và giữ kho phải cùng thành công hoặc cùng thất bại.

*(Quay lại ảnh 1, chỉ cột bên phải.)* Backend chia bốn tầng: route lo xác thực và phân quyền, controller đọc request, service chứa nghiệp vụ, repository là nơi duy nhất truy vấn MongoDB. Lint có bước kiểm tra ranh giới, gọi thẳng database sai tầng là báo lỗi.

*(Mở ảnh 2-transactional-outbox.png.)* Với realtime, nhóm em dùng transactional outbox. Sự kiện được ghi vào database trong cùng transaction với đơn hàng, rồi worker mới phát qua Socket.IO. Đơn đã lưu thì chắc chắn sự kiện sẽ được phát, kể cả khi server gặp sự cố giữa chừng.

## 3. Nguyên tắc thiết kế

*(Mở ảnh 3-nguyen-tac-thiet-ke.png.)* Có ba nguyên tắc chính. Một là backend là nguồn sự thật: giá, trạng thái và quyền đều do server quyết định, giá client gửi lên bị bỏ qua. Hai là lưu bản chụp: đơn lưu tên và giá tại lúc đặt, hóa đơn chốt rồi không sửa được, nên đổi giá sau này không ảnh hưởng hóa đơn cũ. Ba là chống trùng và tranh chấp: đặt đơn và thu tiền có Idempotency-Key nên bấm hai lần vẫn chỉ tạo một bản ghi; mỗi đơn có version nên hai nhân viên cùng cập nhật thì chỉ một người thành công.

## 4. Đăng nhập và phân quyền

Tiếp theo em trình bày các chức năng chung, chia theo ba vai trò: khách hàng, nhân viên và quản trị viên.

*(Mở trang đăng nhập cổng nhân viên.)* Khách hàng không cần tài khoản, chỉ cần quét QR. Nhân viên và quản trị viên đăng nhập bằng email và mật khẩu; mật khẩu băm bằng bcrypt, access token chỉ nằm trong bộ nhớ, refresh token nằm trong cookie HttpOnly và đổi mới mỗi lần dùng. Hệ thống có hai vai trò STAFF và ADMIN, quyền được kiểm tra ở server cho từng API, và mỗi vai trò chỉ vào được cổng của mình. Ai cũng có trang tài khoản cá nhân để sửa tên, đổi mật khẩu và đăng xuất khỏi mọi thiết bị; đăng nhập sai nhiều lần bị giới hạn.

## 5. Chức năng của khách hàng

*(Quét QR của một bàn bằng điện thoại.)* Ở mỗi bàn có một QR cố định chứa mã bàn kèm chữ ký HMAC, nên không sửa link để vào bàn khác được. Khách quét mã thì server tự mở phiên phục vụ cho bàn. Nhiều người cùng quét thì vào chung phiên, nhưng mỗi điện thoại chỉ xem và hủy được đơn của mình, và quyền của khách bị thu hồi khi phiên đóng.

*(Gõ "tra dao it ngot", bấm một bộ lọc, rồi hỏi AI "món chua chua dưới 50k".)* Trên menu, khách tìm món bằng tiếng Việt không dấu, lọc theo danh mục, hoặc nhờ AI Barista gợi ý. AI theo nguyên tắc chỉ đề xuất, backend quyết định: mô hình chỉ hiểu ý khách, còn món được chọn và kiểm tra giá, tồn kho từ menu thật. AI lỗi thì tự chuyển sang chấm điểm theo luật, và AI không bao giờ tự đặt đơn.

*(Tùy chỉnh một món, thêm vào giỏ, đặt món.)* Khách chọn size, đường, đá, topping, giá cập nhật ngay, nhưng server luôn tính lại khi đặt; nếu giá vừa đổi hay món vừa hết, khách được báo để xác nhận lại. Sau khi đặt, khách theo dõi trạng thái đơn theo thời gian thực. Chưa trả tiền thì khách tự hủy được; đã trả mà chưa pha thì gửi yêu cầu hủy; đang pha thì không hủy được nữa.

*(Bấm Gọi nhân viên.)* Khách có thể gọi nhân viên hoặc yêu cầu thanh toán ngay trên điện thoại. Sau khi được phục vụ, khách xem hóa đơn và đánh giá đơn từ một đến năm sao, mỗi đơn một lần.

## 6. Chức năng của nhân viên

*(Đăng nhập cổng 8081, mở Bàn & phiên.)* Nhân viên làm việc trên cổng 8081, với các chức năng phục vụ tại quầy.

Thứ nhất là quản lý bàn và phiên phục vụ: xem bàn nào đang có khách, xem QR của bàn, chuyển khách sang bàn khác và đóng phiên khi khách về.

*(Mở trang Yêu cầu.)* Thứ hai là xử lý yêu cầu: khi khách gọi nhân viên, yêu cầu hiện ngay trên màn hình; xử lý xong bấm hoàn tất và hệ thống ghi lại người xử lý. Nhân viên cũng duyệt các yêu cầu hủy đơn của khách.

*(Thu tiền một đơn.)* Thứ ba là thu tiền. Khách đặt món xong, đơn hiện ở mục chờ thanh toán để nhân viên thu. Khi một nhân viên đang thu tiền bàn nào, người khác bị chặn để tránh thu trùng. Đơn đã thu mà chưa pha thì nhân viên hoàn tiền được: đơn bị hủy và nguyên liệu trả về kho. Thu nhầm thì không sửa thẳng số liệu, mà tạo yêu cầu điều chỉnh, gồm hủy khoản thu, đổi phương thức hoặc chuyển sang đơn khác, để quản trị viên duyệt.

*(Mở KDS, chuyển đơn qua từng bước.)* Thứ tư là màn hình pha chế KDS. Chỉ đơn đã thu tiền mới vào KDS, gồm bốn cột: đã nhận, đang pha, sẵn sàng, đã phục vụ. Đơn nằm quá 5 phút ở bước nhận hoặc sẵn sàng, hay quá 10 phút ở bước pha, sẽ bị đánh dấu chậm. Server không cho nhảy cóc hay lùi trạng thái. Khi một món tạm hết, nhân viên cũng có thể tắt món đó ngay để khách không đặt được.

*(Đóng phiên, in hóa đơn.)* Thứ năm là hóa đơn: đóng phiên thì hệ thống chốt hóa đơn cố định cho cả bàn, nhân viên in ngay từ trình duyệt và khách xem lại được trên điện thoại.

*(Chốt ca với số tiền lệch.)* Cuối cùng là ca thu ngân. Đầu ca nhân viên nhập tiền đầu ca, cuối ca nhập tiền đếm được. Hệ thống tự tính số tiền lẽ ra phải có; nếu lệch thì phải ghi lý do mới chốt được, và còn bàn đang thu dở thì không chốt được.

## 7. Chức năng của quản trị viên

*(Đăng nhập cổng 8082.)* Quản trị viên làm việc trên cổng 8082, lo phần quản lý và theo dõi.

*(Mở trang Nhân viên.)* Về con người: quản trị viên tạo tài khoản nhân viên, đổi vai trò, khóa hoặc xóa tài khoản. Tài khoản bị khóa không làm mới được phiên đăng nhập, và quản trị viên không tự khóa chính mình được. Riêng tài khoản quản trị thì chỉ chủ quán, tức tài khoản quản trị đầu tiên, mới được tạo, sửa, khóa hay đổi mật khẩu; quản trị viên khác chỉ quản lý được nhân viên, nên không ai chiếm được quyền của chủ quán.

*(Mở Danh mục, Món, Topping.)* Về thực đơn: quản trị viên quản lý danh mục, món và topping. Mỗi món có ảnh, nhiều size với giá riêng, và thông tin caffeine, sữa dùng cho bộ lọc và AI. Topping gắn được vào nhiều món. Món đã bán được lưu trữ thay vì xóa để không hỏng hóa đơn cũ, và tắt hay bật món thì khách thấy ngay.

*(Mở Bàn & QR tĩnh.)* Về bàn: quản trị viên xem danh sách bàn, tải QR để in, và khi cần thì cấp lại khóa để mã cũ mất hiệu lực ngay.

*(Mở Khoản thu và Hóa đơn.)* Về tiền: quản trị viên duyệt các yêu cầu điều chỉnh khoản thu của nhân viên, tra cứu hóa đơn cũ và xem lịch sử các ca thu ngân cùng số tiền chênh lệch để đối soát. Quản trị viên cũng xem toàn bộ đánh giá của khách.

*(Mở Dashboard, bấm Xuất báo cáo.)* Về thống kê: Dashboard có thực thu ròng, số đơn, giá trị trung bình, so sánh kỳ trước, doanh thu theo ngày, giờ cao điểm, tỉ lệ hủy, doanh thu theo danh mục và phương thức, cùng top món bán chạy. Báo cáo xuất ra file CSV mở bằng Excel, do worker chạy nền tạo nên không làm chậm hệ thống.

*(Chỉ đọc nếu số liệu demo lộ ra.)* Số liệu hiện tại là dữ liệu kiểm thử, tỉ lệ hủy cao vì nhóm em thử nhiều kịch bản hủy và hoàn tiền.

*(Mở trang Vận hành.)* Cuối cùng là giám sát vận hành: trang Vận hành cho thấy từng API và worker còn sống không, kết nối MongoDB và Redis, hàng đợi có kẹt không, và cảnh báo bất thường như tỉ lệ hủy tăng đột biến. Sự kiện lỗi có thể phát lại, mỗi lần đều được ghi nhật ký.

## 8. Kho nguyên liệu theo công thức và tự động báo hết món

Tiếp theo em trình bày chức năng quản lý kho nguyên liệu theo công thức, hay còn gọi là BOM hoặc recipe.

*(Mở Admin, Kho & công thức, tab Nguyên liệu.)* Quản lý khai báo nguyên liệu như cà phê hạt, sữa tươi, đường, kèm đơn vị gram, mililit hoặc cái, và một ngưỡng cảnh báo sắp hết. Mỗi lần nhập hàng, xuất hao hụt hay kiểm kê đều bắt buộc ghi lý do. Thao tác có idempotency key nên mạng lỗi bấm lại cũng không bị ghi hai lần. Nguyên liệu nhập nhầm, chưa từng nhập xuất kho và chưa nằm trong công thức nào thì xóa hẳn được; nguyên liệu đã dùng chỉ được ngừng dùng để giữ lịch sử kho.

*(Mở tab Công thức, chọn một món.)* Với mỗi món và mỗi topping, quản lý khai báo định lượng cho một phần, ví dụ một ly cà phê sữa cần 20 gram cà phê và 30 mililit sữa đặc. Công thức nền dùng chung cho mọi size; size nào khác định lượng thì khai báo công thức riêng để thay thế. Topping cộng thêm định lượng của chính nó.

Điểm quan trọng là kho được tính theo hai con số: tồn thực tế và lượng đang giữ cho đơn. Lượng có thể dùng bằng tồn thực trừ đi phần đang giữ. Khi khách đặt đơn, hệ thống giữ nguyên liệu ngay trong cùng transaction với đơn hàng. Vì vậy nếu chỉ còn đúng một phần cuối mà hai bàn cùng đặt, chỉ một bàn thành công. Khi quầy bấm bắt đầu pha, nguyên liệu mới thật sự bị trừ khỏi kho. Nếu đơn bị hủy trước khi pha, phần giữ được trả lại. Mỗi đơn còn lưu bản chụp định lượng, nên sửa công thức sau đó không ảnh hưởng đơn cũ.

*(Mở tab Lịch sử kho.)* Mọi biến động nhập, xuất, kiểm kê, giữ, trả giữ và xuất pha chế đều nằm trong sổ kho, ghi rõ tồn sau thao tác, đơn liên quan và người thực hiện.

*(Xuất bớt một nguyên liệu cho gần hết, rồi mở menu bên khách.)* Từ dữ liệu kho này, hệ thống tự động báo hết món. Khi nguyên liệu không đủ cho một size, size đó không chọn được nữa; hết cho mọi size thì món tự biến khỏi danh sách bán. Topping thiếu nguyên liệu cũng tự ẩn. Quy tắc này áp dụng ở mọi nơi: menu, tìm kiếm, AI gợi ý và cả bước đặt đơn, nên AI không thể gợi ý một món đã hết. Khi nhập thêm hàng đủ định lượng, món tự bán lại, khách thấy ngay mà không cần tải lại trang. Riêng món quản lý đã chủ động tạm ngừng bán thì không tự bật lại.

## 9. Mã giảm giá và tích điểm thành viên theo số điện thoại

Chức năng tiếp theo là mã giảm giá và tích điểm thành viên.

*(Mở Admin, trang Voucher, tạo một mã.)* Quản lý tạo voucher giảm số tiền cố định hoặc theo phần trăm, kèm các điều kiện: giá trị đơn tối thiểu, mức giảm tối đa, thời gian hiệu lực, tổng số lượt dùng, và có thể yêu cầu phải là thành viên hoặc giới hạn số lượt cho mỗi thành viên. Quản lý cũng chọn voucher có được dùng kèm điểm hay không. Voucher chưa ai dùng thì xóa được; voucher đã dùng trong đơn chỉ được tạm dừng để hóa đơn cũ vẫn đối chiếu được.

*(Bên khách, mở trang Thành viên, đăng ký.)* Khách đăng ký thành viên bằng tên, số điện thoại và mật khẩu. Số điện thoại viết dạng 0 hay +84 đều được quy về cùng một tài khoản. Nhóm em không dùng SMS, nên số điện thoại đóng vai trò tên đăng nhập. Mật khẩu băm bằng bcrypt; nhập sai sáu lần thì tài khoản bị khóa đăng nhập 15 phút.

*(Thêm món vào giỏ, nhập mã và số điểm, bấm Áp dụng ưu đãi.)* Ở giỏ hàng, khách nhập mã voucher và số điểm muốn đổi, bấm áp dụng để xem số tiền được giảm trước khi đặt. Quy tắc như sau: voucher được trừ trước, sau đó mới trừ điểm. Một điểm tương đương 1.000 đồng, và chỉ được đổi tối đa một nửa số tiền còn lại sau voucher. Ví dụ đơn 60 nghìn, voucher giảm 10 nghìn còn 50 nghìn, khách được đổi tối đa 25 điểm.

Mọi con số này đều do server tính. Khi đặt đơn, server tính lại toàn bộ; nếu quản lý vừa sửa voucher, khách được yêu cầu kiểm tra lại. Việc giữ lượt voucher và trừ điểm diễn ra trong cùng transaction với đơn hàng, nên hai người không thể cùng dùng lượt voucher cuối, và một số điểm không bị tiêu hai lần.

Về tích điểm: cứ mỗi 10 nghìn đồng thực trả được một điểm, nhưng chỉ cộng khi đơn vừa đã thanh toán vừa đã được phục vụ. Nếu đơn bị hủy trước khi pha, điểm đã đổi và lượt voucher được trả lại đúng một lần. Hóa đơn ghi riêng từng dòng giảm giá, và giữ nguyên dù voucher bị sửa sau này.

*(Mở Admin, trang Thành viên.)* Quản lý tìm thành viên theo số điện thoại hoặc tên, xem số dư và lịch sử điểm, khóa tài khoản hoặc đặt lại mật khẩu khi khách yêu cầu tại quầy. Không có chức năng sửa tay số dư điểm; mọi thay đổi điểm đều phải đi kèm một đơn hàng cụ thể, nên sổ điểm luôn đối chiếu được.

## 10. Kết thúc

Tóm lại, hệ thống đi trọn hành trình từ quét QR, gọi món, thanh toán, pha chế, hóa đơn, đánh giá đến báo cáo, kèm quản lý kho theo công thức và chương trình khuyến mãi, tích điểm. Ba điều nhóm em ưu tiên là đúng tiền, không mất đơn và phân quyền rõ ràng, được đảm bảo bằng transaction, idempotency, outbox và hơn 600 bài test tự động.

Em xin cảm ơn thầy cô đã lắng nghe.
