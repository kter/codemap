import { logger } from "./logger";

describe("logger", () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;
  let infoSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    debugSpy = jest.spyOn(console, "debug").mockImplementation(() => {});
    infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("warn always logs with level prefix", () => {
    logger.warn("something odd");
    expect(warnSpy).toHaveBeenCalledWith("[WARN] something odd");
  });

  it("error always logs with level prefix", () => {
    logger.error("boom");
    expect(errorSpy).toHaveBeenCalledWith("[ERROR] boom");
  });

  it("appends structured fields as JSON", () => {
    logger.error("request failed", { route: "/analyze", status: 500 });
    expect(errorSpy).toHaveBeenCalledWith(
      '[ERROR] request failed {"route":"/analyze","status":500}',
    );
  });

  it("omits the JSON suffix when fields are empty", () => {
    logger.warn("plain", {});
    expect(warnSpy).toHaveBeenCalledWith("[WARN] plain");
  });

  it("debug and info are silent outside development", () => {
    // Jest runs with NODE_ENV=test, so dev-only levels must not log.
    logger.debug("hidden");
    logger.info("hidden");
    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });
});
