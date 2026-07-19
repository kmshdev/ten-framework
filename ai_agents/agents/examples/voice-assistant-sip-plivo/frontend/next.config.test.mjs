import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const config = require("./next.config.js");

describe("health endpoint rewrites", () => {
  it("exposes every TEN health contract through the public frontend", async () => {
    const rewrites = await config.rewrites();
    const destinations = Object.fromEntries(
      rewrites.map(({ source, destination }) => [source, destination]),
    );

    expect(destinations["/livez"]).toBe("http://127.0.0.1:9000/livez");
    expect(destinations["/readyz"]).toBe("http://127.0.0.1:9000/readyz");
    expect(destinations["/health"]).toBe("http://127.0.0.1:9000/health");
  });
});
