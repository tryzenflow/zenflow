import type { LegalDoc } from "../legal.types";

export const PRIVACY_EN: LegalDoc = {
  title: "Privacy Policy",
  description:
    "What Zenflow collects, why, who sees it, how long it is kept, and how to ask for your data to be corrected or deleted.",
  intro:
    "Zenflow is a calendar and study planner that finds time for your tasks. This policy explains what we collect, why, who sees it, and the choices you have. We have tried to keep it plain; if something is unclear, write to us at {{email}}.",
  sections: [
    {
      heading: "1. Who we are",
      body: [
        'Zenflow is operated by Tran Thai Anh ("we", "us"), an individual developer, at zenflow.alphatrann.com. We decide how and why your personal data is used, so we are the controller of it. Zenflow is an early-stage project.',
      ],
    },
    {
      heading: "2. What we collect",
      body: [
        "Information you give us:",
        {
          list: [
            "Account: your email address, name, time zone, language, and settings such as default reminder time and notification choice.",
            "Your planner: sessions, tasks, classes, exams and assignments with their titles, notes, times, durations, deadlines, tags, repeat rules and reminders.",
            "Files and images you attach to notes.",
            "Optional campus connections: the sign-in details for your university student portal and learning system (see section 4), and the timetable, exams and coursework we import with them.",
          ],
        },
        "Information created as you use Zenflow:",
        {
          list: [
            "Scheduling activity: when you create, move, resize or keep a session, and which suggested slot you accepted. We use it to learn the times that suit you (see section 5).",
            "Notifications we send you and whether you opened them.",
            "Push notification token and device type (iOS or Android), if you allow notifications.",
            "Sign-in state: a login code (kept for 15 minutes) and a session cookie (kept up to 7 days of inactivity).",
            "Technical data: IP address, app version and request details in server logs, used for security, rate limiting and fixing faults.",
          ],
        },
        "We do not collect your phone number, location, contacts or payment details, and we only read files and photos you choose to attach. The app has no advertising or third-party tracking code.",
      ],
    },
    {
      heading: "3. How we use it",
      body: [
        {
          list: [
            "To run the service: sign you in, store and show your planner, place tasks into free time, send reminders and notifications.",
            "To personalise scheduling: learn which times you tend to prefer.",
            "To keep Zenflow secure and reliable: prevent abuse, limit repeated requests, monitor performance, find and fix bugs.",
            "To contact you about your account or this policy when needed. We do not send marketing email.",
          ],
        },
        "We rely on your consent and on what is needed to provide the service you asked for. We do not sell your data and we do not use it for advertising.",
      ],
    },
    {
      heading: "4. Campus connections (optional)",
      body: [
        "If you connect your university portal or learning system, we store the sign-in details you provide and use them only to fetch your timetable, exams and coursework on your behalf. They are encrypted before storage with a key unique to you, and the master keys that protect those keys are kept outside the database. We do not use them for anything else.",
        "To save load on those systems, imported class and course schedules are shared in a common cache among students enrolled in the same section or course. That cache holds the schedule itself, not your credentials, and we link you to a section only to show you its schedule.",
        "You can disconnect at any time in the app. Disconnecting deletes the stored credentials. Imported items remain in your planner until you delete them.",
        "Zenflow is independent. It is not run, endorsed or supported by any university.",
      ],
    },
    {
      heading: "5. Personalised scheduling",
      body: [
        "Zenflow learns from how you use it, for example the hours at which you keep or move sessions, to suggest better slots over time. This uses statistical models that run on our own servers, and the data stays within the service. Some users may be randomly shown suggestions from a different method so we can compare which works better. No decision with legal or similar significant effect is made about you this way; suggestions are only proposals about your own calendar.",
      ],
    },
    {
      heading: "6. Who we share it with",
      body: [
        "Only people and companies that help us run Zenflow, and only what they need:",
        {
          list: [
            "Hosting and storage providers that run our servers, database and file storage.",
            "An email delivery provider, to send login codes and account email.",
            "Apple Push Notification service and Google Firebase Cloud Messaging, to deliver push notifications to your device. They receive your device token and the notification content.",
          ],
        },
        "We may also disclose information if the law or a valid legal request requires it, or to protect the safety and rights of our users and of Zenflow. We do not sell or rent your personal data.",
      ],
    },
    {
      heading: "7. Where it is stored and how we protect it",
      body: [
        "Data is processed on servers operated for Zenflow and by our service providers, which may be in a different country from yours. Connections to Zenflow use HTTPS. Credentials for campus connections are encrypted at rest; login codes and sessions are held in a short-lived store; access to production systems is limited to the operator. No system is perfectly secure, and we cannot guarantee absolute security. If a breach affecting you occurs, we will tell you and the authorities as the law requires.",
      ],
    },
    {
      heading: "8. How long we keep it",
      body: [
        {
          list: [
            "Your account and planner: until you delete your account.",
            "Login codes: 15 minutes. Sessions: expire after 7 days without use.",
            "Server logs: about 7 days.",
            "Backups: kept for up to 14 days, so deleted data can remain in a backup for that long before it expires.",
          ],
        },
      ],
    },
    {
      heading: "9. Your choices and rights",
      body: [
        "You can correct your name, time zone, language and reminder settings in the app, turn notifications off, and disconnect campus connections. You may also ask us to give you a copy of your data, correct it, restrict or object to its use, withdraw consent, or delete your account and data. Email {{email}} from the address on your account; we will answer within 30 days. Withdrawing consent or deleting your data may mean we can no longer provide the service.",
        "If you are unhappy with how we handle your data, you can also complain to the data protection authority where you live.",
      ],
    },
    {
      heading: "10. Children",
      body: [
        "Zenflow is not meant for anyone under 16. If you believe a child under 16 has given us personal data, email us and we will delete it.",
      ],
    },
    {
      heading: "11. Cookies",
      body: [
        "We use one essential session cookie to keep you signed in. We do not use analytics or advertising cookies.",
      ],
    },
    {
      heading: "12. Changes to this policy",
      body: [
        "We may update this policy as Zenflow changes. The date at the top shows the latest version. For significant changes we will tell you in the app or by email before they take effect.",
      ],
    },
    {
      heading: "13. Contact",
      body: ["Questions or requests about your data: {{email}}."],
    },
  ],
};
