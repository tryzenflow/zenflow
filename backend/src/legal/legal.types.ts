export type LegalLang = "en" | "vi";
export type LegalPage = "privacy" | "terms";

/** A paragraph, or a bulleted list. `{{email}}` becomes the contact mailto link. */
export type LegalBlock = string | { list: string[] };

export interface LegalSection {
  heading: string;
  body: LegalBlock[];
}

export interface LegalDoc {
  title: string;
  intro: string;
  sections: LegalSection[];
}

/** Chrome around a document, per language. */
export interface LegalChrome {
  htmlLang: string;
  updatedLabel: string;
  privacyLink: string;
  termsLink: string;
  languageName: string;
  /** ISO date formatted for display. */
  formatDate: (iso: string) => string;
}
