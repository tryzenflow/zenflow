import type { LegalDoc } from "../legal.types";

export const PRIVACY_VI: LegalDoc = {
  title: "Chính sách quyền riêng tư",
  description:
    "Zenflow thu thập gì, vì sao, ai được xem, lưu trong bao lâu, và cách yêu cầu chỉnh sửa hoặc xóa dữ liệu của bạn.",
  intro:
    "Zenflow là ứng dụng lịch và lập kế hoạch học tập, tự tìm thời gian cho công việc của bạn. Chính sách này giải thích chúng tôi thu thập gì, vì sao, ai được xem và bạn có những lựa chọn nào. Chúng tôi cố gắng viết dễ hiểu; nếu có điều gì chưa rõ, hãy viết cho chúng tôi tại {{email}}.",
  sections: [
    {
      heading: "1. Chúng tôi là ai",
      body: [
        'Zenflow do Trần Thái Anh ("chúng tôi"), một nhà phát triển cá nhân, vận hành tại usezenflow.com. Chúng tôi quyết định cách thức và mục đích sử dụng dữ liệu cá nhân của bạn, nên là bên kiểm soát dữ liệu. Zenflow là dự án đang ở giai đoạn đầu.',
      ],
    },
    {
      heading: "2. Chúng tôi thu thập gì",
      body: [
        "Thông tin bạn cung cấp:",
        {
          list: [
            "Tài khoản: địa chỉ email, tên, múi giờ, ngôn ngữ và các cài đặt như thời gian nhắc mặc định, tùy chọn thông báo.",
            "Lịch của bạn: buổi làm việc, công việc, lớp học, lịch thi và bài tập cùng tiêu đề, ghi chú, thời gian, thời lượng, hạn chót, thẻ, quy tắc lặp và lời nhắc.",
            "Tệp và hình ảnh bạn đính kèm vào ghi chú.",
            "Kết nối trường (tùy chọn): thông tin đăng nhập cổng sinh viên và hệ thống học tập của trường (xem mục 4), cùng thời khóa biểu, lịch thi và bài tập được nhập từ đó.",
          ],
        },
        "Thông tin phát sinh khi bạn dùng Zenflow:",
        {
          list: [
            "Hoạt động lập lịch: khi bạn tạo, dời, đổi thời lượng hoặc giữ một buổi, và khung giờ gợi ý nào bạn đã chấp nhận. Chúng tôi dùng để học những khung giờ phù hợp với bạn (xem mục 5).",
            "Các thông báo chúng tôi gửi và việc bạn đã mở chúng hay chưa.",
            "Mã thông báo đẩy và loại thiết bị (iOS hoặc Android), nếu bạn cho phép thông báo.",
            "Trạng thái đăng nhập: mã đăng nhập (giữ 15 phút) và cookie phiên (giữ tối đa 7 ngày không hoạt động).",
            "Dữ liệu kỹ thuật: địa chỉ IP, phiên bản ứng dụng và chi tiết yêu cầu trong nhật ký máy chủ, dùng cho bảo mật, giới hạn tần suất và sửa lỗi.",
          ],
        },
        "Chúng tôi không thu thập số điện thoại, vị trí, danh bạ hay thông tin thanh toán của bạn, và chỉ đọc các tệp, ảnh bạn chủ động chọn đính kèm. Ứng dụng không có mã quảng cáo hay theo dõi của bên thứ ba.",
      ],
    },
    {
      heading: "3. Chúng tôi dùng dữ liệu để làm gì",
      body: [
        {
          list: [
            "Vận hành dịch vụ: đăng nhập, lưu và hiển thị lịch, xếp công việc vào thời gian trống, gửi lời nhắc và thông báo.",
            "Cá nhân hóa việc lập lịch: học xem bạn thường thích những khung giờ nào.",
            "Giữ Zenflow an toàn và ổn định: ngăn chặn lạm dụng, giới hạn các yêu cầu lặp lại, theo dõi hiệu năng, tìm và sửa lỗi.",
            "Liên hệ với bạn về tài khoản hoặc chính sách này khi cần. Chúng tôi không gửi email tiếp thị.",
          ],
        },
        "Chúng tôi dựa trên sự đồng ý của bạn và những gì cần thiết để cung cấp dịch vụ bạn yêu cầu. Chúng tôi không bán dữ liệu của bạn và không dùng cho quảng cáo.",
      ],
    },
    {
      heading: "4. Kết nối trường (tùy chọn)",
      body: [
        "Nếu bạn kết nối cổng sinh viên hoặc hệ thống học tập của trường, chúng tôi lưu thông tin đăng nhập bạn cung cấp và chỉ dùng để lấy thời khóa biểu, lịch thi và bài tập thay bạn. Thông tin này được mã hóa trước khi lưu bằng một khóa riêng của bạn, còn các khóa chủ bảo vệ những khóa đó được giữ ngoài cơ sở dữ liệu. Chúng tôi không dùng chúng cho mục đích nào khác.",
        "Để giảm tải cho các hệ thống đó, lịch lớp học và môn học được nhập sẽ dùng chung trong một bộ nhớ đệm giữa các sinh viên cùng học phần hoặc môn học. Bộ nhớ đệm này chứa chính lịch học, không chứa thông tin đăng nhập của bạn, và chúng tôi chỉ gắn bạn với một học phần để hiển thị lịch của học phần đó.",
        "Bạn có thể ngắt kết nối bất cứ lúc nào trong ứng dụng. Ngắt kết nối sẽ xóa thông tin đăng nhập đã lưu. Các mục đã nhập vẫn nằm trong lịch cho đến khi bạn xóa.",
        "Zenflow là độc lập. Zenflow không do trường nào vận hành, bảo trợ hay hỗ trợ.",
      ],
    },
    {
      heading: "5. Lập lịch cá nhân hóa",
      body: [
        "Zenflow học từ cách bạn sử dụng, chẳng hạn những giờ bạn giữ hoặc dời buổi làm việc, để gợi ý khung giờ tốt hơn theo thời gian. Việc này dùng các mô hình thống kê chạy trên máy chủ của chúng tôi và dữ liệu vẫn nằm trong dịch vụ. Một số người dùng có thể được ngẫu nhiên hiển thị gợi ý từ một phương pháp khác để chúng tôi so sánh phương pháp nào hiệu quả hơn. Không có quyết định nào gây hậu quả pháp lý hoặc ảnh hưởng đáng kể tương tự được đưa ra về bạn theo cách này; gợi ý chỉ là đề xuất về lịch của chính bạn.",
      ],
    },
    {
      heading: "6. Chúng tôi chia sẻ với ai",
      body: [
        "Chỉ với những cá nhân, tổ chức giúp chúng tôi vận hành Zenflow, và chỉ phần họ cần:",
        {
          list: [
            "Nhà cung cấp lưu trữ và hạ tầng vận hành máy chủ, cơ sở dữ liệu và kho tệp của chúng tôi.",
            "Nhà cung cấp dịch vụ gửi email, để gửi mã đăng nhập và email tài khoản.",
            "Apple Push Notification service và Google Firebase Cloud Messaging, để gửi thông báo đẩy đến thiết bị của bạn. Họ nhận mã thiết bị và nội dung thông báo.",
          ],
        },
        "Chúng tôi cũng có thể tiết lộ thông tin nếu pháp luật hoặc một yêu cầu pháp lý hợp lệ đòi hỏi, hoặc để bảo vệ sự an toàn và quyền lợi của người dùng và của Zenflow. Chúng tôi không bán hay cho thuê dữ liệu cá nhân của bạn.",
      ],
    },
    {
      heading: "7. Nơi lưu trữ và cách chúng tôi bảo vệ",
      body: [
        "Dữ liệu được xử lý trên máy chủ do chúng tôi vận hành và bởi các nhà cung cấp dịch vụ, có thể ở quốc gia khác với nơi bạn sống. Kết nối đến Zenflow dùng HTTPS. Thông tin đăng nhập cho kết nối trường được mã hóa khi lưu; mã đăng nhập và phiên được giữ trong kho lưu trữ tạm thời; quyền truy cập hệ thống vận hành chỉ giới hạn ở người vận hành. Không hệ thống nào an toàn tuyệt đối và chúng tôi không thể bảo đảm an toàn tuyệt đối. Nếu xảy ra vi phạm ảnh hưởng đến bạn, chúng tôi sẽ thông báo cho bạn và cơ quan có thẩm quyền theo quy định pháp luật.",
      ],
    },
    {
      heading: "8. Chúng tôi lưu giữ trong bao lâu",
      body: [
        {
          list: [
            "Tài khoản và lịch của bạn: cho đến khi bạn xóa tài khoản.",
            "Mã đăng nhập: 15 phút. Phiên: hết hạn sau 7 ngày không sử dụng.",
            "Nhật ký máy chủ: khoảng 7 ngày.",
            "Bản sao lưu: giữ tối đa 14 ngày, nên dữ liệu đã xóa có thể còn trong bản sao lưu đến khi hết hạn.",
          ],
        },
      ],
    },
    {
      heading: "9. Lựa chọn và quyền của bạn",
      body: [
        "Bạn có thể chỉnh sửa tên, múi giờ, ngôn ngữ và cài đặt nhắc trong ứng dụng, tắt thông báo và ngắt kết nối trường. Bạn cũng có thể yêu cầu chúng tôi cung cấp bản sao dữ liệu, chỉnh sửa, hạn chế hoặc phản đối việc sử dụng, rút lại sự đồng ý, hoặc xóa tài khoản và dữ liệu. Hãy gửi email đến {{email}} từ địa chỉ gắn với tài khoản; chúng tôi sẽ phản hồi trong vòng 30 ngày. Việc rút lại sự đồng ý hoặc xóa dữ liệu có thể khiến chúng tôi không thể tiếp tục cung cấp dịch vụ.",
        "Nếu không hài lòng với cách chúng tôi xử lý dữ liệu, bạn cũng có thể khiếu nại với cơ quan bảo vệ dữ liệu nơi bạn sinh sống.",
      ],
    },
    {
      heading: "10. Trẻ em",
      body: [
        "Zenflow không dành cho người dưới 16 tuổi. Nếu bạn cho rằng một trẻ dưới 16 tuổi đã cung cấp dữ liệu cá nhân cho chúng tôi, hãy gửi email và chúng tôi sẽ xóa.",
      ],
    },
    {
      heading: "11. Cookie",
      body: [
        "Chúng tôi dùng một cookie phiên thiết yếu để giữ bạn đăng nhập. Chúng tôi không dùng cookie phân tích hay quảng cáo.",
      ],
    },
    {
      heading: "12. Thay đổi chính sách",
      body: [
        "Chúng tôi có thể cập nhật chính sách này khi Zenflow thay đổi. Ngày ở đầu trang cho biết phiên bản mới nhất. Với thay đổi quan trọng, chúng tôi sẽ thông báo trong ứng dụng hoặc qua email trước khi áp dụng.",
      ],
    },
    {
      heading: "13. Liên hệ",
      body: ["Câu hỏi hoặc yêu cầu về dữ liệu của bạn: {{email}}."],
    },
  ],
};
