import type { LegalLang } from "../legal/legal.types";

export type LandingIcon =
  | "calendar"
  | "sparkles"
  | "bell"
  | "wifi-off"
  | "globe"
  | "lock"
  | "trending"
  | "graduation";

export interface LandingCopy {
  htmlLang: string;
  title: string;
  description: string;
  /** Card text on the share image. */
  shareTitle: string;
  badge: string;
  headline: string;
  /** The highlighted second half of the headline. */
  accent: string;
  lead: string;
  download: string;
  howLink: string;
  downloadNote: string;
  languageName: string;
  languageShort: string;
  syncsFrom: string;
  sources: string[];
  howLabel: string;
  how: { title: string; body: string }[];
  featuresLabel: string;
  features: { icon: LandingIcon; title: string; body: string }[];
  shotsLabel: string;
  stepsLabel: string;
  steps: string[];
  installNote: string;
  faqLabel: string;
  faq: { q: string; a: string }[];
  finalTitle: string;
  finalBody: string;
  privacyLink: string;
  termsLink: string;
  rightsReserved: string;
  /** Text drawn inside the illustrated phone. */
  mock: {
    day: string;
    today: string;
    lecture: string;
    lab: string;
    exam: string;
    task: string;
    auto: string;
    chipTitle: string;
    chipBody: string;
    placedTitle: string;
    placedBody: string;
    label: string;
  };
}

export const LANDING: Record<LegalLang, LandingCopy> = {
  en: {
    htmlLang: "en",
    title: "Zenflow: the study planner that finds the time",
    description:
      "Zenflow imports your DLU timetable and places your tasks around classes and deadlines. Android app for DLU students.",
    shareTitle: "The study planner that finds the time",
    badge: "Made for DLU students",
    headline: "Tell Zenflow what needs doing.",
    accent: "It finds the time.",
    lead: "Your lectures, exams and assignments land on one calendar. Add a task with a deadline and Zenflow slots it in around your classes.",
    download: "Download for Android",
    howLink: "See how it works",
    downloadNote: "Free. Sign in with your @dlu.edu.vn email.",
    languageName: "English",
    languageShort: "EN",
    syncsFrom: "Syncs from",
    sources: ["DLU LMS", "Student portal"],
    howLabel: "From timetable to plan in three steps",
    how: [
      {
        title: "Connect once",
        body: "Link your LMS and student portal. Your timetable, exams and assignments appear on their own.",
      },
      {
        title: "Add what you need to do",
        body: "Type a task and pick a deadline. That is all Zenflow needs.",
      },
      {
        title: "Zenflow finds the time",
        body: "It picks a free slot that avoids classes and other tasks, then reminds you.",
      },
    ],
    featuresLabel: "Built around how students plan",
    features: [
      {
        icon: "sparkles",
        title: "Smart placement",
        body: "Tasks land in free slots before the deadline, never on top of a lecture or an exam.",
      },
      {
        icon: "calendar",
        title: "Always current",
        body: "When your timetable or an exam changes, your calendar and reminders change with it.",
      },
      {
        icon: "trending",
        title: "Learns your rhythm",
        body: "Move a task and Zenflow remembers the hours you prefer.",
      },
      {
        icon: "bell",
        title: "Reminders that matter",
        body: "A nudge before each session, and when something moves.",
      },
      {
        icon: "wifi-off",
        title: "Works offline",
        body: "Your saved days stay readable without signal.",
      },
      {
        icon: "globe",
        title: "Vietnamese and English",
        body: "Switch language any time.",
      },
      {
        icon: "lock",
        title: "Private by design",
        body: "Your password is stored encrypted. Disconnect and it is deleted.",
      },
    ],
    shotsLabel: "A look inside",
    stepsLabel: "Install in 3 steps",
    steps: [
      "Tap Download for Android.",
      "Open the file and allow installs from this source.",
      "Sign in with your @dlu.edu.vn email.",
    ],
    installNote:
      "Android may ask you to allow installs from your browser or files app. That is normal for apps outside Google Play.",
    faqLabel: "Questions",
    faq: [
      {
        q: "Who can use Zenflow?",
        a: "Students with a @dlu.edu.vn email. Sign in with a code we send to it.",
      },
      {
        q: "Why does it ask for my LMS and portal password?",
        a: "To read your timetable, exams and assignments for you. The password is stored encrypted, and disconnecting an account deletes it.",
      },
      {
        q: "Is there an iPhone version?",
        a: "Not yet. Zenflow is Android only for now.",
      },
      {
        q: "Why isn't it on Google Play?",
        a: "Zenflow is in early access, so you install the file directly. New versions are offered inside the app.",
      },
      {
        q: "Does it work offline?",
        a: "You can read days you have already loaded. Adding or moving tasks needs a connection.",
      },
    ],
    finalTitle: "Stop juggling deadlines.",
    finalBody: "Let Zenflow find the time.",
    privacyLink: "Privacy policy",
    termsLink: "Terms of service",
    rightsReserved: "All rights reserved.",
    mock: {
      day: "Tue 14",
      today: "Today",
      lecture: "Calculus 2",
      lab: "Database lab",
      exam: "Physics midterm",
      task: "Write essay",
      auto: "Auto",
      chipTitle: "Exam time changed",
      chipBody: "Physics midterm, 13:30",
      placedTitle: "Placed for you",
      placedBody: "Thu 19:30, before the deadline",
      label:
        "Zenflow calendar with lectures, an exam and an automatically placed task",
    },
  },
  vi: {
    htmlLang: "vi",
    title: "Zenflow: lịch học tự tìm giờ cho bạn",
    description:
      "Zenflow lấy thời khóa biểu DLU và xếp việc của bạn quanh giờ học và hạn nộp. Ứng dụng Android cho sinh viên DLU.",
    shareTitle: "Lịch học tự tìm giờ cho bạn",
    badge: "Dành cho sinh viên DLU",
    headline: "Cứ nói việc cần làm.",
    accent: "Zenflow tìm giờ cho bạn.",
    lead: "Lịch học, lịch thi và bài tập nằm trên một lịch. Thêm việc kèm hạn nộp, Zenflow sẽ xếp vào chỗ trống quanh giờ học.",
    download: "Tải cho Android",
    howLink: "Xem cách hoạt động",
    downloadNote: "Miễn phí. Đăng nhập bằng email @dlu.edu.vn.",
    languageName: "Tiếng Việt",
    languageShort: "VI",
    syncsFrom: "Đồng bộ từ",
    sources: ["LMS DLU", "Cổng sinh viên"],
    howLabel: "Từ thời khóa biểu đến kế hoạch trong ba bước",
    how: [
      {
        title: "Kết nối một lần",
        body: "Liên kết LMS và cổng sinh viên. Lịch học, lịch thi và bài tập tự hiện lên.",
      },
      {
        title: "Thêm việc cần làm",
        body: "Gõ tên việc và chọn hạn nộp. Zenflow chỉ cần vậy.",
      },
      {
        title: "Zenflow tìm giờ",
        body: "Nó chọn khung giờ trống, tránh giờ học và việc khác, rồi nhắc bạn.",
      },
    ],
    featuresLabel: "Làm ra cho cách sinh viên lên kế hoạch",
    features: [
      {
        icon: "sparkles",
        title: "Xếp lịch thông minh",
        body: "Việc được xếp vào giờ trống trước hạn nộp, không bao giờ đè lên giờ học hay giờ thi.",
      },
      {
        icon: "calendar",
        title: "Luôn cập nhật",
        body: "Khi thời khóa biểu hoặc lịch thi đổi, lịch và lời nhắc đổi theo.",
      },
      {
        icon: "trending",
        title: "Học theo thói quen",
        body: "Kéo một việc sang giờ khác, Zenflow nhớ khung giờ bạn thích.",
      },
      {
        icon: "bell",
        title: "Nhắc đúng lúc",
        body: "Nhắc trước mỗi buổi và khi có gì thay đổi.",
      },
      {
        icon: "wifi-off",
        title: "Dùng được khi mất mạng",
        body: "Những ngày đã tải vẫn xem được khi không có sóng.",
      },
      {
        icon: "globe",
        title: "Tiếng Việt và tiếng Anh",
        body: "Đổi ngôn ngữ bất cứ lúc nào.",
      },
      {
        icon: "lock",
        title: "Riêng tư từ thiết kế",
        body: "Mật khẩu được lưu mã hóa. Ngắt kết nối là xóa.",
      },
    ],
    shotsLabel: "Xem thử",
    stepsLabel: "Cài đặt trong 3 bước",
    steps: [
      "Nhấn Tải cho Android.",
      "Mở tệp và cho phép cài từ nguồn này.",
      "Đăng nhập bằng email @dlu.edu.vn.",
    ],
    installNote:
      "Android có thể hỏi cho phép cài từ trình duyệt hoặc ứng dụng tệp. Đây là chuyện bình thường với ứng dụng ngoài Google Play.",
    faqLabel: "Câu hỏi thường gặp",
    faq: [
      {
        q: "Ai dùng được Zenflow?",
        a: "Sinh viên có email @dlu.edu.vn. Đăng nhập bằng mã chúng tôi gửi đến email đó.",
      },
      {
        q: "Vì sao cần mật khẩu LMS và cổng sinh viên?",
        a: "Để đọc thời khóa biểu, lịch thi và bài tập giúp bạn. Mật khẩu được lưu mã hóa, và ngắt kết nối tài khoản sẽ xóa nó.",
      },
      {
        q: "Có bản cho iPhone không?",
        a: "Chưa có. Hiện Zenflow chỉ có cho Android.",
      },
      {
        q: "Vì sao không có trên Google Play?",
        a: "Zenflow đang trong giai đoạn dùng thử sớm nên bạn cài trực tiếp từ tệp. Bản mới sẽ được báo ngay trong ứng dụng.",
      },
      {
        q: "Có dùng được khi mất mạng không?",
        a: "Bạn xem được những ngày đã tải. Thêm hoặc dời việc cần có kết nối.",
      },
    ],
    finalTitle: "Đừng tự xoay xở với hạn nộp nữa.",
    finalBody: "Để Zenflow tìm giờ cho bạn.",
    privacyLink: "Chính sách riêng tư",
    termsLink: "Điều khoản sử dụng",
    rightsReserved: "Bảo lưu mọi quyền.",
    mock: {
      day: "T3 14",
      today: "Hôm nay",
      lecture: "Giải tích 2",
      lab: "Thực hành CSDL",
      exam: "Thi giữa kỳ Vật lý",
      task: "Viết tiểu luận",
      auto: "Tự động",
      chipTitle: "Giờ thi đã đổi",
      chipBody: "Thi giữa kỳ Vật lý, 13:30",
      placedTitle: "Đã xếp cho bạn",
      placedBody: "Thứ 5 19:30, trước hạn nộp",
      label:
        "Lịch Zenflow có giờ học, một buổi thi và một việc được xếp tự động",
    },
  },
};

/**
 * Screenshots in `landing/assets/`, served at `/landing/<file>`. Written by
 * `pnpm --filter mobile e2e:screenshots`; a shot whose file is missing is left out of the page.
 */
export const SHOTS: { file: string; alt: Record<LegalLang, string> }[] = [
  {
    file: "week.webp",
    alt: {
      en: "Week view with lectures and tasks on the calendar",
      vi: "Lịch tuần có giờ học và việc cần làm",
    },
  },
  {
    file: "month.webp",
    alt: {
      en: "Month view showing busy days at a glance",
      vi: "Lịch tháng cho thấy những ngày bận",
    },
  },
  {
    file: "new-task.webp",
    alt: {
      en: "Adding a task with a deadline",
      vi: "Thêm việc kèm hạn nộp",
    },
  },
  {
    file: "settings.webp",
    alt: {
      en: "Settings with LMS and portal connection",
      vi: "Cài đặt với kết nối LMS và cổng sinh viên",
    },
  },
];

export const DEFAULT_APK_URL =
  "https://github.com/tryzenflow/releases/releases/latest/download/zenflow-android.apk";
