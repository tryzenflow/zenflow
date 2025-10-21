export const gradients = [
  "linear-gradient(90deg, hsla(152, 100%, 50%, 1) 0%, hsla(186, 100%, 69%, 1) 100%)",
  "linear-gradient(90deg, hsla(217, 100%, 50%, 1) 0%, hsla(186, 100%, 69%, 1) 100%)",
  "linear-gradient(90deg, hsla(339, 100%, 55%, 1) 0%, hsla(197, 100%, 64%, 1) 100%)",
  "linear-gradient(90deg, hsla(197, 100%, 63%, 1) 0%, hsla(294, 100%, 55%, 1) 100%)",
  "linear-gradient(90deg, hsla(33, 100%, 53%, 1) 0%, hsla(58, 100%, 68%, 1) 100%)",
  "linear-gradient(90deg, hsla(333, 100%, 53%, 1) 0%, hsla(33, 94%, 57%, 1) 100%)",
  "linear-gradient(90deg, hsla(238, 100%, 71%, 1) 0%, hsla(295, 100%, 84%, 1) 100%)",
  "linear-gradient(90deg, hsla(94, 100%, 70%, 1) 0%, hsla(0, 100%, 77%, 1) 100%)",
  "linear-gradient(90deg, hsla(239, 100%, 67%, 1) 0%, hsla(187, 100%, 89%, 1) 100%)",
  "linear-gradient(90deg, hsla(141, 81%, 87%, 1) 0%, hsla(41, 88%, 75%, 1) 50%, hsla(358, 82%, 71%, 1) 100%)",
  "linear-gradient(90deg, hsla(175, 79%, 63%, 1) 0%, hsla(82, 96%, 57%, 1) 100%)",
  "linear-gradient(90deg, hsla(211, 66%, 87%, 1) 0%, hsla(348, 67%, 88%, 1) 50%, hsla(272, 26%, 72%, 1) 100%)",
  "linear-gradient(90deg, hsla(141, 54%, 86%, 1) 0%, hsla(333, 73%, 85%, 1) 50%, hsla(211, 58%, 79%, 1) 100%)",
  "linear-gradient(90deg, hsla(139, 70%, 75%, 1) 0%, hsla(63, 90%, 76%, 1) 100%)",
  "linear-gradient(90deg, hsla(179, 83%, 64%, 1) 0%, hsla(338, 75%, 64%, 1) 50%, hsla(14, 92%, 86%, 1) 100%)",
];

export const getGradientIndex = (text: string) => {
  const encoder = new TextEncoder();
  const utf8Codes = encoder.encode(text);
  return gradients[
    utf8Codes.reduce((acc, code) => acc + code, 0) % gradients.length
  ];
};
