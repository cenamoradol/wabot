import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("health endpoints", () => {
  it("reports the process is alive", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/health/live" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("reports unavailable dependencies", async () => {
    const app = buildApp([async () => { throw new Error("offline"); }]);
    const response = await app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "unavailable" });
    await app.close();
  });
});
