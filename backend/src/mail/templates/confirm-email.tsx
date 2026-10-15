import {
  Body,
  Container,
  Font,
  Head,
  Html,
  Img,
  Preview,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";

export interface ConfirmEmailProps {
  otp: string;
  language: string;
  pageTitle: string;
  greeting: string;
  welcome: string;
  instructions: string;
  expires: string;
  ignore: string;
  thanks: string;
  team: string;
  rights: string;
  /** Where the Geist files are served; omit to use the system fallback. */
  fontBaseUrl?: string;
}

const FONTS = [
  { file: "Geist-Regular.ttf", weight: 400 },
  { file: "Geist-SemiBold.ttf", weight: 600 },
  { file: "Geist-ExtraBold.ttf", weight: 800 },
] as const;

const HERO = "linear-gradient(135deg,#ffb074 0%,#ff8e3e 55%,#f0b101 100%)";
const PAGE = "linear-gradient(180deg,#fff3e6 0%,#f6f3ef 100%)";

export function ConfirmEmail(p: ConfirmEmailProps) {
  return (
    <Html lang={p.language}>
      <Head>
        <title>{p.pageTitle}</title>
        <meta name="color-scheme" content="light" />
        {p.fontBaseUrl
          ? FONTS.map((f) => (
              <Font
                key={f.file}
                fontFamily="Geist"
                fallbackFontFamily="Helvetica"
                webFont={{
                  url: `${p.fontBaseUrl}/landing/fonts/${f.file}`,
                  format: "truetype",
                }}
                fontWeight={f.weight}
                fontStyle="normal"
              />
            ))
          : null}
      </Head>
      <Preview>{p.instructions}</Preview>
      <Tailwind>
        <Body
          className="m-0 bg-[#f6f3ef] px-4 py-10 font-sans text-[#0f0d0a]"
          style={{ backgroundImage: PAGE, fontFamily: "Geist, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}
        >
          <Container className="mx-auto max-w-[560px] overflow-hidden rounded-[24px] border border-solid border-[#e8e5df] bg-white">
            <Section
              className="bg-[#ff8e3e] px-8 py-9 text-center"
              style={{ backgroundImage: HERO }}
            >
              <Img
                src="cid:logo"
                alt="Zenflow"
                width="64"
                height="64"
                className="mx-auto mb-3 rounded-full border-2 border-solid border-white"
              />
              <Text className="m-0 text-[26px] font-extrabold leading-8 tracking-tight text-white">
                Zenflow
              </Text>
            </Section>

            <Section className="px-8 pb-2 pt-8">
              <Text className="m-0 mb-2 text-[22px] font-bold leading-7 tracking-tight">
                {p.greeting}
              </Text>
              <Text className="m-0 text-[15px] leading-[26px] text-[#6f665b]">
                {p.welcome}
              </Text>
              <Text className="m-0 mt-3 text-[15px] leading-[26px] text-[#6f665b]">
                {p.instructions}
              </Text>
            </Section>

            <Section className="px-8 py-4">
              <div
                style={{
                  borderRadius: 16,
                  padding: 2,
                  backgroundImage: HERO,
                  backgroundColor: "#ff8e3e",
                }}
              >
                <div
                  style={{
                    borderRadius: 14,
                    background: "#fffaf5",
                    padding: "22px 12px",
                    textAlign: "center",
                    fontFamily:
                      "'Geist Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
                    fontSize: 38,
                    fontWeight: 800,
                    letterSpacing: 10,
                    color: "#973c00",
                  }}
                >
                  {p.otp}
                </div>
              </div>
            </Section>

            <Section className="px-8 pb-8">
              <Text className="m-0 text-[13px] leading-5 text-[#6f665b]">
                {p.expires}
              </Text>
              <Text className="m-0 mt-2 text-[13px] leading-5 text-[#6f665b]">
                {p.ignore}
              </Text>
              <Text className="m-0 mt-5 text-[15px] leading-6">
                {p.thanks}
                <br />
                <strong>{p.team}</strong>
              </Text>
            </Section>
          </Container>
          <Text className="m-0 mt-6 text-center text-[12px] text-[#9a9084]">
            © {new Date().getFullYear()} Zenflow. {p.rights}
          </Text>
        </Body>
      </Tailwind>
    </Html>
  );
}

export default ConfirmEmail;
