import { PRIVACY_EN } from "./content/privacy.en";
import { PRIVACY_VI } from "./content/privacy.vi";
import { TERMS_EN } from "./content/terms.en";
import { TERMS_VI } from "./content/terms.vi";
import type {
  LegalChrome,
  LegalDoc,
  LegalLang,
  LegalPage,
} from "./legal.types";

/** Bump when either document changes in substance; shown at the top of each page. */
export const LEGAL_UPDATED = "2026-10-13";

export const LEGAL_DOCS: Record<LegalPage, Record<LegalLang, LegalDoc>> = {
  privacy: { en: PRIVACY_EN, vi: PRIVACY_VI },
  terms: { en: TERMS_EN, vi: TERMS_VI },
};

const MONTHS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function parts(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

export const LEGAL_CHROME: Record<LegalLang, LegalChrome> = {
  en: {
    htmlLang: "en",
    updatedLabel: "Last updated",
    privacyLink: "Privacy Policy",
    termsLink: "Terms of Service",
    languageName: "English",
    languageShort: "EN",
    contentsLabel: "Contents",
    siteTitle: (title) => `Zenflow ${title}`,
    formatDate: (iso) => {
      const { y, m, d } = parts(iso);
      return `${MONTHS_EN[m - 1]} ${d}, ${y}`;
    },
  },
  vi: {
    htmlLang: "vi",
    updatedLabel: "Cập nhật lần cuối",
    privacyLink: "Chính sách quyền riêng tư",
    termsLink: "Điều khoản dịch vụ",
    languageName: "Tiếng Việt",
    languageShort: "VI",
    contentsLabel: "Mục lục",
    siteTitle: (title) => `${title} của Zenflow`,
    formatDate: (iso) => {
      const { y, m, d } = parts(iso);
      return `${d} tháng ${m}, ${y}`;
    },
  },
};
