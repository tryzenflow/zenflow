import { parseCurriculumName } from "@zenflow/shared";

describe("parseCurriculumName", () => {
  it("strips the red star markup and flags the course", () => {
    expect(
      parseCurriculumName(
        'Giáo dục quốc phòng và an ninh 1 <span style="color:red">*</span>',
      ),
    ).toEqual({ name: "Giáo dục quốc phòng và an ninh 1", noCredit: true });
  });

  it("keeps the label of (Thực hành) names", () => {
    expect(
      parseCurriculumName(
        'Giáo dục thể chất 1 (Thực hành) <span style="color:red">*</span>',
      ),
    ).toEqual({ name: "Giáo dục thể chất 1 (Thực hành)", noCredit: true });
  });

  it("leaves plain names alone and decodes entities", () => {
    expect(parseCurriculumName("Triết học Mác - Lênin")).toEqual({
      name: "Triết học Mác - Lênin",
      noCredit: false,
    });
    expect(parseCurriculumName("Anh &amp; Văn")).toEqual({
      name: "Anh & Văn",
      noCredit: false,
    });
  });
});
