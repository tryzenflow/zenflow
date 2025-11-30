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
  "audio",
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

      a: [
        "href",
        "data-filename",
        "data-filesize",
        "data-type",
        "target",
        "rel",
        "class",
      ],

      // keep classes for styling
      div: ["class", "style"],
      span: ["class", "style"],

      img: ["src"],
      video: ["src", "controls"],
      audio: ["src", "controls"],
    },
  });
};
