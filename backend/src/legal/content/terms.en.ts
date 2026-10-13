import type { LegalDoc } from "../legal.types";

export const TERMS_EN: LegalDoc = {
  title: "Terms of Service",
  intro:
    "These terms are the agreement between you and Zenflow when you use the Zenflow app and website. By creating an account or using Zenflow you accept them. If you do not agree, please do not use Zenflow. Questions: {{email}}.",
  sections: [
    {
      heading: "1. Who provides Zenflow",
      body: [
        'Zenflow is provided by Tran Thai Anh ("we", "us"), an individual developer. Zenflow is an early-stage project: features may change, and some things may be rough around the edges.',
      ],
    },
    {
      heading: "2. Who can use it",
      body: [
        "You must be at least 16 years old and able to enter into this agreement. You must give us a real email address that you control.",
      ],
    },
    {
      heading: "3. Your account",
      body: [
        "You sign in with a one-time code sent to your email. You are responsible for keeping that mailbox secure and for everything done through your account. Tell us promptly at {{email}} if you think someone else has access to it. One person, one account.",
      ],
    },
    {
      heading: "4. What Zenflow does",
      body: [
        "Zenflow is a calendar and planner. It stores your sessions and tasks and suggests when to do them, using rules and statistical models. It may also import your timetable, exams and coursework if you connect a campus account. See our Privacy Policy for how your data is handled.",
      ],
    },
    {
      heading: "5. Suggestions are not guarantees",
      body: [
        "Scheduling is a convenience, not a promise. Suggestions can be wrong, and imported timetables, exam times and deadlines can be out of date or incomplete. You are responsible for checking important dates, such as exams and submission deadlines, with your school's official sources. We are not liable for a missed class, exam or deadline.",
      ],
    },
    {
      heading: "6. Your content",
      body: [
        "You own what you put into Zenflow. You give us a limited licence to store, process and display it, and to back it up, only so we can run the service for you. Do not upload content that is unlawful, infringes others' rights, or that you have no right to use.",
      ],
    },
    {
      heading: "7. Campus connections",
      body: [
        "You may connect a university portal or learning-system account only if it is your own and you are allowed to use it this way. Check your school's rules first; you are responsible for any consequences under them. Zenflow is independent and is not affiliated with, or endorsed by, any university. Those systems can change or block access at any time, which may stop imports from working. You can disconnect whenever you like, which deletes the stored credentials.",
      ],
    },
    {
      heading: "8. Acceptable use",
      body: [
        "Do not:",
        {
          list: [
            "break the law, or use Zenflow to harm or harass others;",
            "access another person's account or data;",
            "probe, scan, attack, overload or try to bypass the security or rate limits of Zenflow;",
            "scrape or copy the service in bulk, or reverse engineer it except as the law allows;",
            "upload malware or anything meant to disrupt the service.",
          ],
        },
      ],
    },
    {
      heading: "9. Notifications and email",
      body: [
        "We send login codes, reminders and service notices. Push notifications are optional and can be turned off in the app or in your device settings.",
      ],
    },
    {
      heading: "10. Availability and changes",
      body: [
        "We aim to keep Zenflow running but do not promise it will always be available or error-free. We may change, pause or remove features, and we may do maintenance. We may update these terms; for significant changes we will tell you in the app or by email before they apply. Using Zenflow after a change takes effect means you accept it.",
      ],
    },
    {
      heading: "11. Ending your use",
      body: [
        "You can stop using Zenflow at any time and ask us to delete your account at {{email}}. We may suspend or end your access if you break these terms or put the service or others at risk. Sections that by nature should survive, such as ownership, disclaimers and liability, continue afterwards.",
      ],
    },
    {
      heading: "12. Our rights",
      body: [
        "Zenflow, including its software, design, name and logo, belongs to us and is protected by law. These terms give you only the right to use the service as described; no other rights are granted. Open-source components remain under their own licences.",
      ],
    },
    {
      heading: "13. Disclaimer",
      body: [
        'To the fullest extent the law allows, Zenflow is provided "as is" and "as available", without warranties of any kind, whether express or implied, including fitness for a particular purpose and uninterrupted or error-free operation.',
      ],
    },
    {
      heading: "14. Limit of liability",
      body: [
        "To the fullest extent the law allows, we are not liable for indirect or consequential loss, loss of data, or missed classes, exams or deadlines arising from your use of Zenflow, and our total liability for any claim is limited to the amount you paid us for Zenflow in the previous 12 months (which, for a free service, is zero). Nothing in these terms limits liability that cannot lawfully be limited, such as for fraud or intentional wrongdoing, or your rights as a consumer under applicable law.",
      ],
    },
    {
      heading: "15. Governing law and disputes",
      body: [
        "These terms are governed by the laws of Vietnam. If a problem comes up, please contact us first at {{email}} so we can try to fix it. If we cannot, the competent courts of Vietnam will decide it, without affecting any mandatory consumer rights you have where you live.",
      ],
    },
    {
      heading: "16. Contact",
      body: ["Zenflow, operated by Tran Thai Anh. Email: {{email}}."],
    },
  ],
};
