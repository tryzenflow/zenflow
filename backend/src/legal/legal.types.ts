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
  /** One sentence for search results and link previews. */
  description: string;
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
  /** Short label for the language switch, e.g. EN. */
  languageShort: string;
  /** Footer copyright line after the name, e.g. "All rights reserved." */
  rightsReserved: string;
  contentsLabel: string;
  /** Page `<title>`: "Zenflow | <document title>". */
  siteTitle: (title: string) => string;
  /** ISO date formatted for display. */
  formatDate: (iso: string) => string;
}
