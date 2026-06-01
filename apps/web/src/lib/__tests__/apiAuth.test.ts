import { describe, it, expect, afterEach } from "vitest";
import { checkWriteAuth } from "../apiAuth";

const original = process.env.API_WRITE_TOKEN;
afterEach(() => {
  if (original === undefined) delete process.env.API_WRITE_TOKEN;
  else process.env.API_WRITE_TOKEN = original;
});

function writeReq(headers?: Record<string, string>) {
  return new Request("http://localhost/api/x", { method: "POST", headers });
}

describe("checkWriteAuth", () => {
  it("allows the write when API_WRITE_TOKEN is unset (open dev/MVP)", () => {
    delete process.env.API_WRITE_TOKEN;
    expect(checkWriteAuth(writeReq())).toBeNull();
  });

  it("allows the write when the header matches the token", () => {
    process.env.API_WRITE_TOKEN = "s3cret";
    expect(
      checkWriteAuth(writeReq({ "x-api-write-token": "s3cret" })),
    ).toBeNull();
  });

  it("rejects with 401 when the token is set but the header is missing/wrong", async () => {
    process.env.API_WRITE_TOKEN = "s3cret";

    const missing = checkWriteAuth(writeReq());
    expect(missing?.status).toBe(401);

    const wrong = checkWriteAuth(writeReq({ "x-api-write-token": "nope" }));
    expect(wrong?.status).toBe(401);
    const body = await wrong!.json();
    expect(body.error).toBe("unauthorized");
  });

  it("treats a blank/whitespace token as unset (open)", () => {
    process.env.API_WRITE_TOKEN = "   ";
    expect(checkWriteAuth(writeReq())).toBeNull();
  });
});
