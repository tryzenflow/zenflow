import type { Lang } from "../config";

/** Feature icons, drawn in `components/Icon.astro`. */
export type IconName =
  | "calendar"
  | "sunrise"
  | "sliders"
  | "dial"
  | "cloud-off"
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

/** VI and EN copy: casual, the way DLU students talk. Keep both languages in step. */
export const COPY: Record<Lang, Copy> = {
  vi: {
    htmlLang: "vi",
    ogLocale: "vi_VN",
    title: "Zenflow: lên lịch học auto, khỏi lo deadline",
    description:
      "Zenflow lấy thời khóa biểu DLU rồi tự xếp task vào giờ trống, trước deadline. App Android cho sinh viên DLU.",
    shareTitle: "Lên lịch học auto, khỏi lo deadline",
    shareAlt: "Zenflow, lên lịch học auto, khỏi lo deadline",
    languageName: "Tiếng Việt",
    languageShort: "VI",
    skip: "Tới nội dung chính",
    badge: "Dành riêng cho sinh viên DLU",
    headline: "Cứ quăng task vào.",
    accent: "Zenflow lo phần giờ giấc.",
    lead: "Lịch học, lịch thi, bài tập gom hết về một chỗ. Thêm task kèm deadline là Zenflow tự nhét vào giờ trống, né giờ học.",
    download: "Tải cho Android",
    downloadShort: "Tải app",
    howLink: "Xem nó chạy sao",
    downloadNote: "Free. Đăng nhập bằng mail @dlu.edu.vn là xong.",
    syncsFrom: "Đồng bộ từ",
    sources: ["LMS DLU", "Cổng sinh viên"],
    demo: {
      day: "T3 14",
      today: "Hôm nay",
      hint: "Chạm vào task để xếp lịch",
      reset: "Làm lại",
      placed: "Xếp xong rồi nè",
      allPlaced: "Xong hết trước deadline",
      minutes: "phút",
      due: "Deadline T6",
      beforeExam: "trước giờ thi",
      beforeDeadline: "trước deadline",
      label: "Ngày mẫu có giờ học, một buổi thi và mấy task đang chờ xếp",
      fixed: [
        { title: "Giải tích 2", kind: "lecture", start: t(8), end: t(9, 30) },
        { title: "Thực hành CSDL", kind: "lecture", start: t(10), end: t(11, 30) },
        { title: "Thi giữa kỳ Vật lý", kind: "exam", start: t(13, 30), end: t(15) },
        { title: "Deadline báo cáo", kind: "assignment", start: t(17), end: t(17, 30) },
      ],
      tasks: [
        { id: "physics", title: "Ôn Vật lý", minutes: 45, deadline: t(13, 30), reason: "exam" },
        { id: "report", title: "Viết báo cáo thực hành", minutes: 60, deadline: t(17), reason: "deadline" },
        { id: "essay", title: "Viết tiểu luận", minutes: 90, deadline: t(21), reason: "deadline" },
      ],
    },
    shotsLabel: "Nhìn thử nè",
    shotsTitle: "Cả tuần gọn trong một màn hình",
    week: {
      days: ["T2", "T3", "T4", "T5", "T6", "T7", "CN"],
      label: "Lịch tuần Zenflow có giờ học, một buổi thi và các task đã xếp",
    },
    howLabel: "Từ thời khóa biểu tới kế hoạch, ba bước là xong",
    how: [
      {
        title: "Kết nối một lần",
        body: "Link LMS với cổng sinh viên. Lịch học, lịch thi, bài tập tự nhảy vào.",
      },
      {
        title: "Thêm task",
        body: "Gõ tên task, chọn deadline. Vậy thôi.",
      },
      {
        title: "Zenflow tìm giờ",
        body: "Tự chọn giờ trống, né giờ học với task khác, tới giờ thì nhắc bạn.",
      },
    ],
    blipsLabel: "Sắp có",
    blipsTitle: "Gặp hội Blip",
    blipsBody: "Làm xong task để ấp một bé Blip.",
    featuresLabel: "Làm ra cho đúng kiểu sinh viên xoay xở",
    features: [
      {
        icon: "sunrise",
        title: "Xếp lịch xịn",
        body: "Task vào đúng giờ trống trước deadline, không bao giờ đè lên giờ học hay giờ thi.",
      },
      {
        icon: "calendar",
        title: "Luôn mới nhất",
        body: "Đổi lịch học hay dời lịch thi, lịch và lời nhắc đổi theo liền.",
      },
      {
        icon: "sliders",
        title: "Hiểu nhịp của bạn",
        body: "Kéo task sang giờ khác, Zenflow nhớ luôn khung giờ bạn thích.",
      },
      {
        icon: "dial",
        title: "Nhắc đúng lúc",
        body: "Ping trước mỗi buổi, và khi có gì thay đổi.",
      },
      {
        icon: "cloud-off",
        title: "Rớt mạng vẫn xem được",
        body: "Mấy ngày đã tải vẫn mở được khi mất sóng.",
      },
      {
        icon: "lock",
        title: "Riêng tư",
        body: "Mật khẩu được mã hóa. Ngắt kết nối là xóa sạch.",
      },
    ],
    finalTitle: "Hết cảnh chạy deadline sấp mặt.",
    finalBody: "Để Zenflow tìm giờ giùm bạn.",
    qrLabel: "Quét mã để tải về máy",
    stepsLabel: "Cài trong 3 bước",
    steps: [
      "Bấm Tải cho Android.",
      "Mở file và cho phép cài từ nguồn này.",
      "Đăng nhập bằng mail @dlu.edu.vn.",
    ],
    installNote:
      "Android có thể hỏi cho phép cài từ trình duyệt hay app quản lý file. Bình thường thôi, vì app chưa lên Google Play.",
    faqLabel: "Hỏi nhanh đáp gọn",
    faq: [
      {
        q: "Ai xài được Zenflow?",
        a: "Sinh viên có mail @dlu.edu.vn. Đăng nhập bằng mã gửi về mail đó.",
      },
      {
        q: "Sao phải nhập mật khẩu LMS với cổng sinh viên?",
        a: "Để đọc lịch học, lịch thi và bài tập giùm bạn. Mật khẩu được mã hóa, ngắt kết nối là xóa. Chỉ kết nối được đúng mã sinh viên của bạn.",
      },
      {
        q: "Có bản iPhone không?",
        a: "Chưa có nha. Giờ Zenflow mới có trên Android.",
      },
      {
        q: "Sao không có trên Google Play?",
        a: "Zenflow đang dùng thử nên bạn cài thẳng từ file. Có bản mới là app báo liền.",
      },
      {
        q: "Mất mạng có xài được không?",
        a: "Xem được mấy ngày đã tải. Thêm hay dời task thì cần có mạng.",
      },
    ],
    privacyLink: "Chính sách riêng tư",
    termsLink: "Điều khoản sử dụng",
    contact: "Liên hệ",
    rightsReserved: "Bảo lưu mọi quyền.",
  },
  en: {
    htmlLang: "en",
    ogLocale: "en_US",
    title: "Zenflow: drop your tasks, it finds the time",
    description:
      "Zenflow pulls in your DLU timetable and slots your tasks around classes and deadlines. Android app for DLU students.",
    shareTitle: "Drop your tasks. Zenflow finds the time.",
    shareAlt: "Zenflow, drop your tasks and it finds the time",
    languageName: "English",
    languageShort: "EN",
    skip: "Skip to content",
    badge: "Made for DLU students",
    headline: "Drop your tasks in.",
    accent: "Zenflow finds the time.",
    lead: "Classes, exams and assignments on one calendar. Add a task with a deadline and Zenflow squeezes it in around your classes.",
    download: "Get it for Android",
    downloadShort: "Get the app",
    howLink: "See how it works",
    downloadNote: "Free. Just sign in with your @dlu.edu.vn email.",
    syncsFrom: "Syncs from",
    sources: ["DLU LMS", "Student portal"],
    demo: {
      day: "Tue 14",
      today: "Today",
      hint: "Tap a task to place it",
      reset: "Start over",
      placed: "Sorted",
      allPlaced: "All done before the deadlines",
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
    shotsLabel: "Sneak peek",
    shotsTitle: "Your whole week, sorted",
    week: {
      days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      label: "Zenflow week view with classes, an exam and placed tasks",
    },
    howLabel: "Timetable to plan in three steps",
    how: [
      {
        title: "Connect once",
        body: "Link your LMS and student portal. Classes, exams and assignments just show up.",
      },
      {
        title: "Add a task",
        body: "Type it and pick a deadline. That's it.",
      },
      {
        title: "Zenflow finds the time",
        body: "It grabs a free slot that dodges classes and other tasks, then pings you.",
      },
    ],
    blipsLabel: "Coming soon",
    blipsTitle: "Meet the Blips",
    blipsBody: "Finish tasks to hatch one.",
    featuresLabel: "Built for how students actually plan",
    features: [
      {
        icon: "sunrise",
        title: "Smart slots",
        body: "Tasks land in free time before the deadline, never on top of a class or an exam.",
      },
      {
        icon: "calendar",
        title: "Always up to date",
        body: "Timetable changed or exam moved? Your calendar and reminders follow.",
      },
      {
        icon: "sliders",
        title: "Gets your rhythm",
        body: "Move a task and Zenflow remembers the hours you like.",
      },
      {
        icon: "dial",
        title: "Pings that matter",
        body: "A nudge before each session, and when something moves.",
      },
      {
        icon: "cloud-off",
        title: "Works offline",
        body: "Days you've loaded stay readable with no signal.",
      },
      {
        icon: "lock",
        title: "Private by default",
        body: "Your password is encrypted. Disconnect and it's gone.",
      },
    ],
    finalTitle: "No more deadline panic.",
    finalBody: "Let Zenflow find the time.",
    qrLabel: "Scan to grab it on your phone",
    stepsLabel: "Install in 3 steps",
    steps: [
      "Tap Get it for Android.",
      "Open the file and allow installs from this source.",
      "Sign in with your @dlu.edu.vn email.",
    ],
    installNote:
      "Android might ask you to allow installs from your browser or files app. Totally normal for apps outside Google Play.",
    faqLabel: "Quick questions",
    faq: [
      {
        q: "Who can use Zenflow?",
        a: "Students with a @dlu.edu.vn email. Sign in with a code we send there.",
      },
      {
        q: "Why does it want my LMS and portal password?",
        a: "To read your timetable, exams and assignments for you. It's encrypted, and disconnecting deletes it. You can only connect your own student ID.",
      },
      {
        q: "Is there an iPhone version?",
        a: "Not yet. Zenflow is Android only for now.",
      },
      {
        q: "Why isn't it on Google Play?",
        a: "Zenflow is in early access, so you install the file directly. The app tells you when there's a new version.",
      },
      {
        q: "Does it work offline?",
        a: "You can read days you've already loaded. Adding or moving tasks needs a connection.",
      },
    ],
    privacyLink: "Privacy policy",
    termsLink: "Terms of service",
    contact: "Contact",
    rightsReserved: "All rights reserved.",
  },
};
