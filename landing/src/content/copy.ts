import type { Lang } from "../config";

/** Feature icons, drawn in `components/Icon.astro`. */
export type IconName =
  | "calendar"
  | "sunrise"
  | "sliders"
  | "dial"
  | "cloud-off"
  | "globe"
  | "lock"
  | "download"
  | "check";

export type SessionKind = "lecture" | "exam" | "assignment" | "task";

export interface DemoCopy {
  day: string;
  today: string;
  hint: string;
  reset: string;
  placed: string;
  allPlaced: string;
  minutes: string;
  due: string;
  beforeExam: string;
  beforeDeadline: string;
  label: string;
  fixed: { title: string; kind: SessionKind; start: number; end: number }[];
  tasks: { id: string; title: string; minutes: number; deadline: number; reason: "exam" | "deadline" }[];
}

export interface Copy {
  htmlLang: string;
  ogLocale: string;
  title: string;
  description: string;
  shareTitle: string;
  shareAlt: string;
  languageName: string;
  languageShort: string;
  skip: string;
  badge: string;
  headline: string;
  accent: string;
  lead: string;
  download: string;
  downloadShort: string;
  howLink: string;
  downloadNote: string;
  syncsFrom: string;
  sources: string[];
  demo: DemoCopy;
  shotsLabel: string;
  shotsTitle: string;
  week: { days: string[]; label: string };
  howLabel: string;
  how: { title: string; body: string }[];
  blipsLabel: string;
  blipsTitle: string;
  blipsBody: string;
  featuresLabel: string;
  features: { icon: IconName; title: string; body: string }[];
  counters: { value: number; label: string }[];
  finalTitle: string;
  finalBody: string;
  qrLabel: string;
  stepsLabel: string;
  steps: string[];
  installNote: string;
  faqLabel: string;
  faq: { q: string; a: string }[];
  privacyLink: string;
  termsLink: string;
  contact: string;
  rightsReserved: string;
}

/** Minutes after midnight, on the 15 minute grid. */
const t = (h: number, m = 0) => h * 60 + m;

/** EN and VI copy. Ported from `backend/src/landing/landing.content.ts`; keep both languages in step. */
export const COPY: Record<Lang, Copy> = {
  en: {
    htmlLang: "en",
    ogLocale: "en_US",
    title: "Zenflow: the study planner that finds the time",
    description:
      "Zenflow imports your DLU timetable and places your tasks around classes and deadlines. Android app for DLU students.",
    shareTitle: "The study planner that finds the time",
    shareAlt: "Zenflow, the study planner that finds the time",
    languageName: "English",
    languageShort: "EN",
    skip: "Skip to content",
    badge: "Made for DLU students",
    headline: "Tell Zenflow what needs doing.",
    accent: "It finds the time.",
    lead: "Your lectures, exams and assignments land on one calendar. Add a task with a deadline and Zenflow slots it in around your classes.",
    download: "Download for Android",
    downloadShort: "Download",
    howLink: "See how it works",
    downloadNote: "Free. Sign in with your @dlu.edu.vn email.",
    syncsFrom: "Syncs from",
    sources: ["DLU LMS", "Student portal"],
    demo: {
      day: "Tue 14",
      today: "Today",
      hint: "Tap a task to place it",
      reset: "Start over",
      placed: "Placed for you",
      allPlaced: "All set before the deadlines",
      minutes: "min",
      due: "Due Fri",
      beforeExam: "before the exam",
      beforeDeadline: "before the deadline",
      label: "Demo day with classes, an exam and tasks waiting to be placed",
      fixed: [
        { title: "Calculus 2", kind: "lecture", start: t(8), end: t(9, 30) },
        { title: "Database lab", kind: "lecture", start: t(10), end: t(11, 30) },
        { title: "Physics midterm", kind: "exam", start: t(13, 30), end: t(15) },
        { title: "Lab report due", kind: "assignment", start: t(17), end: t(17, 30) },
      ],
      tasks: [
        { id: "physics", title: "Revise physics", minutes: 45, deadline: t(13, 30), reason: "exam" },
        { id: "report", title: "Finish lab report", minutes: 60, deadline: t(17), reason: "deadline" },
        { id: "essay", title: "Write essay", minutes: 90, deadline: t(21), reason: "deadline" },
      ],
    },
    shotsLabel: "A look inside",
    shotsTitle: "Your whole week, sorted",
    week: {
      days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      label: "Zenflow week view with lectures, an exam and placed tasks",
    },
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
    blipsLabel: "Coming soon",
    blipsTitle: "Meet the Blips",
    blipsBody: "Check off tasks to hatch one.",
    featuresLabel: "Built around how students plan",
    features: [
      {
        icon: "sunrise",
        title: "Smart placement",
        body: "Tasks land in free slots before the deadline, never on top of a lecture or an exam.",
      },
      {
        icon: "calendar",
        title: "Always current",
        body: "When your timetable or an exam changes, your calendar and reminders change with it.",
      },
      {
        icon: "sliders",
        title: "Learns your rhythm",
        body: "Move a task and Zenflow remembers the hours you prefer.",
      },
      {
        icon: "dial",
        title: "Reminders that matter",
        body: "A nudge before each session, and when something moves.",
      },
      {
        icon: "cloud-off",
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
    counters: [
      { value: 96, label: "Slots checked every day" },
      { value: 15, label: "Minutes per slot" },
    ],
    finalTitle: "Stop juggling deadlines.",
    finalBody: "Let Zenflow find the time.",
    qrLabel: "Scan to download on your phone",
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
    privacyLink: "Privacy policy",
    termsLink: "Terms of service",
    contact: "Contact",
    rightsReserved: "All rights reserved.",
  },
  vi: {
    htmlLang: "vi",
    ogLocale: "vi_VN",
    title: "Zenflow: lịch học tự tìm giờ cho bạn",
    description:
      "Zenflow lấy thời khóa biểu DLU và xếp việc của bạn quanh giờ học và hạn nộp. Ứng dụng Android cho sinh viên DLU.",
    shareTitle: "Lịch học tự tìm giờ cho bạn",
    shareAlt: "Zenflow, lịch học tự tìm giờ cho bạn",
    languageName: "Tiếng Việt",
    languageShort: "VI",
    skip: "Đến nội dung chính",
    badge: "Dành cho sinh viên DLU",
    headline: "Cứ nói việc cần làm.",
    accent: "Zenflow tìm giờ cho bạn.",
    lead: "Lịch học, lịch thi và bài tập nằm trên một lịch. Thêm việc kèm hạn nộp, Zenflow sẽ xếp vào chỗ trống quanh giờ học.",
    download: "Tải cho Android",
    downloadShort: "Tải về",
    howLink: "Xem cách hoạt động",
    downloadNote: "Miễn phí. Đăng nhập bằng email @dlu.edu.vn.",
    syncsFrom: "Đồng bộ từ",
    sources: ["LMS DLU", "Cổng sinh viên"],
    demo: {
      day: "T3 14",
      today: "Hôm nay",
      hint: "Chạm vào một việc để xếp lịch",
      reset: "Làm lại",
      placed: "Đã xếp cho bạn",
      allPlaced: "Đã xếp xong trước hạn",
      minutes: "phút",
      due: "Hạn T6",
      beforeExam: "trước giờ thi",
      beforeDeadline: "trước hạn nộp",
      label: "Ngày mẫu có giờ học, một buổi thi và các việc chờ xếp lịch",
      fixed: [
        { title: "Giải tích 2", kind: "lecture", start: t(8), end: t(9, 30) },
        { title: "Thực hành CSDL", kind: "lecture", start: t(10), end: t(11, 30) },
        { title: "Thi giữa kỳ Vật lý", kind: "exam", start: t(13, 30), end: t(15) },
        { title: "Hạn nộp báo cáo", kind: "assignment", start: t(17), end: t(17, 30) },
      ],
      tasks: [
        { id: "physics", title: "Ôn Vật lý", minutes: 45, deadline: t(13, 30), reason: "exam" },
        { id: "report", title: "Viết báo cáo thực hành", minutes: 60, deadline: t(17), reason: "deadline" },
        { id: "essay", title: "Viết tiểu luận", minutes: 90, deadline: t(21), reason: "deadline" },
      ],
    },
    shotsLabel: "Xem thử",
    shotsTitle: "Cả tuần của bạn, gọn gàng",
    week: {
      days: ["T2", "T3", "T4", "T5", "T6", "T7", "CN"],
      label: "Lịch tuần Zenflow có giờ học, một buổi thi và các việc đã xếp",
    },
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
    blipsLabel: "Sắp ra mắt",
    blipsTitle: "Làm quen với Blip",
    blipsBody: "Xong việc để ấp một Blip.",
    featuresLabel: "Làm ra cho cách sinh viên lên kế hoạch",
    features: [
      {
        icon: "sunrise",
        title: "Xếp lịch thông minh",
        body: "Việc được xếp vào giờ trống trước hạn nộp, không bao giờ đè lên giờ học hay giờ thi.",
      },
      {
        icon: "calendar",
        title: "Luôn cập nhật",
        body: "Khi thời khóa biểu hoặc lịch thi đổi, lịch và lời nhắc đổi theo.",
      },
      {
        icon: "sliders",
        title: "Học theo thói quen",
        body: "Kéo một việc sang giờ khác, Zenflow nhớ khung giờ bạn thích.",
      },
      {
        icon: "dial",
        title: "Nhắc đúng lúc",
        body: "Nhắc trước mỗi buổi và khi có gì thay đổi.",
      },
      {
        icon: "cloud-off",
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
    counters: [
      { value: 96, label: "Khung giờ được xét mỗi ngày" },
      { value: 15, label: "Phút mỗi khung giờ" },
    ],
    finalTitle: "Đừng tự xoay xở với hạn nộp nữa.",
    finalBody: "Để Zenflow tìm giờ cho bạn.",
    qrLabel: "Quét mã để tải về điện thoại",
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
    privacyLink: "Chính sách riêng tư",
    termsLink: "Điều khoản sử dụng",
    contact: "Liên hệ",
    rightsReserved: "Bảo lưu mọi quyền.",
  },
};
