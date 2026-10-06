/** Translate only known generated framing; user and upstream titles stay intact. */
export function localizeNotification<
  T extends { eventName: string; title: string; content: string },
>(row: T, lang?: string): T {
  if (lang !== "VI_VN") return row;
  let { title, content } = row;
  if (/^(assignment|exam|lecture)\./.test(row.eventName)) {
    title = title
      .replace(/^New assignment: /, "Bài tập mới: ")
      .replace(/^New exam: /, "Lịch thi mới: ")
      .replace(/^Updated: /, "Đã cập nhật: ")
      .replace(/^Lectures removed: /, "Đã xóa lịch học: ");
    if (title.startsWith("You have ")) {
      title = title
        .slice(9)
        .replace(
          /(\d+|a|an) new (exams?|assignments?|lectures?)/g,
          (_, n: string, noun: string) =>
            `${n === "a" || n === "an" ? "1" : n} ${noun.startsWith("exam") ? "lịch thi" : noun.startsWith("assignment") ? "bài tập" : "buổi học"} mới`,
        )
        .replace(
          /(\d+|a|an) changes? to your (exams|assignments|lectures)/g,
          (_, n: string, noun: string) =>
            `${n === "a" || n === "an" ? "1" : n} thay đổi về ${noun === "exams" ? "lịch thi" : noun === "assignments" ? "bài tập" : "lịch học"}`,
        )
        .replace(
          /(\d+|a|an) (exams?|assignments?|lectures?) removed/g,
          (_, n: string, noun: string) =>
            `${n === "a" || n === "an" ? "1" : n} ${noun.startsWith("exam") ? "lịch thi" : noun.startsWith("assignment") ? "bài tập" : "buổi học"} đã xóa`,
        )
        .replace(/ from the portal$/, " từ cổng sinh viên")
        .replace(/ from LMS$/, " từ LMS");
      title = `Bạn có ${title}`;
    }
    const copy: Record<string, string> = {
      "Synced from DLU. Tap to see it on your calendar.":
        "Đã đồng bộ từ DLU. Nhấn để xem trên lịch của bạn.",
      "Synced from DLU. Tap to see the next one on your calendar.":
        "Đã đồng bộ từ DLU. Nhấn để xem buổi tiếp theo trên lịch của bạn.",
      "Synced from DLU. It's no longer on your calendar.":
        "Đã đồng bộ từ DLU. Mục này đã được xóa khỏi lịch của bạn.",
      "Synced from DLU. They're no longer on your calendar.":
        "Đã đồng bộ từ DLU. Các mục này đã được xóa khỏi lịch của bạn.",
      "Added from your LMS. Plan the work that leads up to it.":
        "Đã thêm từ LMS. Hãy lên kế hoạch hoàn thành bài tập.",
      "Added from your portal. Plan revision sessions before it.":
        "Đã thêm từ cổng sinh viên. Hãy lên lịch ôn tập trước kỳ thi.",
      "The portal moved this class.":
        "Cổng sinh viên đã thay đổi lịch học này.",
      "These classes were taken off your DLU timetable.":
        "Các buổi học này đã được xóa khỏi thời khóa biểu DLU của bạn.",
    };
    content = copy[content] ?? content;
  } else if (row.eventName === "reminder.fired") {
    const match = title.match(
      /^(Exam|Due|Class|Task starts|Event starts) in (.+?): ([\s\S]+)$/,
    );
    if (match) {
      const [, kind, originalLead, sessionTitle] = match;
      const lead = originalLead
        .replace(/days?/g, "ngày")
        .replace(/hours?/g, "giờ")
        .replace(/minutes?/g, "phút");
      const label: Record<string, string> = {
        Exam: "Thi sau",
        Due: "Đến hạn sau",
        Class: "Buổi học sau",
        "Task starts": "Công việc bắt đầu sau",
        "Event starts": "Sự kiện bắt đầu sau",
      };
      title = `${label[kind]} ${lead}: ${sessionTitle}`;
      // Only replace framing surrounding the exact session title.
      const prefix =
        kind === "Exam"
          ? "Your exam starts at "
          : `${sessionTitle}${kind === "Due" ? " is due at " : kind === "Class" ? " begins at " : " starts at "}`;
      if (content.startsWith(prefix)) {
        let rest = content
          .slice(prefix.length)
          .replace(
            /\. Time for a last look at your notes\.$/,
            ". Hãy xem lại ghi chú trước khi thi.",
          )
          .replace(
            /\. Make sure it's submitted before the deadline\.$/,
            ". Hãy nộp bài trước hạn.",
          );
        const date = rest.match(
          /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),? (\d+) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec), (\d{2}:\d{2})/,
        );
        if (date) {
          const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
          const months = [
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec",
          ];
          const index = weekdays.indexOf(date[1]);
          rest =
            `${index === 6 ? "Chủ nhật" : `Thứ ${index + 2}`}, ${date[2]}/${months.indexOf(date[3]) + 1}, ${date[4]}` +
            rest.slice(date[0].length).replace(/^ (in|at) /, " tại ");
        }
        content = `${kind === "Exam" ? "Kỳ thi" : sessionTitle}${kind === "Due" ? " đến hạn lúc " : " bắt đầu lúc "}${rest}`;
      }
    }
  } else if (row.eventName.startsWith("sync_conflict.")) {
    const label = (value: string) =>
      value === "your timetable"
        ? "thời khóa biểu"
        : value === "your exam schedule"
          ? "lịch thi"
          : value;
    title = title.replace(
      /^Schedule conflicts after syncing (.+)$/,
      (_, source: string) => `Lịch bị trùng sau khi đồng bộ ${label(source)}`,
    );
    content = content.replace(
      /^After syncing with (.+), we detected (.+) with your own tasks\. Reschedule them all\?$/,
      (_, source: string, count: string) =>
        `Sau khi đồng bộ ${label(source)}, đã phát hiện ${count.replace(/conflicts?/g, "lịch trùng")} với các công việc của bạn. Sắp xếp lại tất cả?`,
    );
  }
  return { ...row, title, content };
}
