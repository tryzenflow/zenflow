import { ArgumentsHost } from "@nestjs/common";
import { TooManyRequestsException } from "@limitkit/nest";
import { TooManyRequestsFilter } from "./too-many-requests.filter";

describe("TooManyRequestsFilter", () => {
  it("re-shapes the 429 body into the app's { success, message } envelope", () => {
    const filter = new TooManyRequestsFilter();
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
      }),
    } as unknown as ArgumentsHost;

    const exception = new TooManyRequestsException("Too many requests");
    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: "Too many requests. Please wait a moment and try again.",
    });
  });
});
