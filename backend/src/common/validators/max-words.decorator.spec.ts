import { validate } from "class-validator";
import { MaxWords } from "./max-words.decorator";

class Fixture {
  @MaxWords(3, { message: "Title must be at most 3 words." })
  title!: string;
}

describe("@MaxWords", () => {
  it("passes when the word count is at or under the limit", async () => {
    const fixture = new Fixture();
    fixture.title = "one two three";
    expect(await validate(fixture)).toHaveLength(0);
  });

  it("fails when the word count exceeds the limit", async () => {
    const fixture = new Fixture();
    fixture.title = "one two three four";
    const errors = await validate(fixture);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toEqual(
      expect.objectContaining({ maxWords: "Title must be at most 3 words." }),
    );
  });

  it("counts words by whitespace, not characters — a long single word is still one word", async () => {
    const fixture = new Fixture();
    fixture.title = "a".repeat(500);
    expect(await validate(fixture)).toHaveLength(0);
  });

  it("collapses repeated/leading/trailing whitespace before counting", async () => {
    const fixture = new Fixture();
    fixture.title = "  one   two  three  ";
    expect(await validate(fixture)).toHaveLength(0);
  });

  it("treats an empty string as zero words (valid)", async () => {
    const fixture = new Fixture();
    fixture.title = "";
    expect(await validate(fixture)).toHaveLength(0);
  });
});
