import sanitize from "sanitize-html";
const allowedTags = [
  "b",
  "em",
  "strong",
  "i",
  "u",
  "strike",
  "iframe",
  "blockquote",
  "mark",
  "code",
  "pre",
  "img",
  "video",
  "a",
  "p",
  "li",
  "ul",
  "ol",
  "br",
  "span",
  "div",
];

export const sanitizeContent = (content: string) => {
  return sanitize(content, {
    allowedTags,
    allowedIframeDomains: ["www.youtube.com"],
    allowedAttributes: {
      code: ["class"],
      a: ["href"],
      img: ["src"],
      video: ["src", "controls"],
      div: ["style"],
      span: ["style"],
    },
  });
};
