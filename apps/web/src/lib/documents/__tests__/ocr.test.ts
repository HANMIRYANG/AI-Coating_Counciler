import { generateKeyPairSync } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DocumentOcrError,
  documentOcrProvider,
  googleDocumentAiOcr,
  isOcrSupportedMime,
} from "../ocr";

const OLD_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.restoreAllMocks();
});

function configureGoogleOcr(id = "1") {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.DOCUMENT_OCR_PROVIDER = "google_document_ai";
  process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID = `p${id}`;
  process.env.GOOGLE_DOCUMENT_AI_LOCATION = "us";
  process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID = "proc1";
  process.env.GOOGLE_DOCUMENT_AI_CLIENT_EMAIL = `svc${id}@example.com`;
  process.env.GOOGLE_DOCUMENT_AI_PRIVATE_KEY = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
}

describe("document OCR helpers", () => {
  it("detects supported OCR MIME types", () => {
    expect(isOcrSupportedMime("application/pdf")).toBe(true);
    expect(isOcrSupportedMime("image/png")).toBe(true);
    expect(isOcrSupportedMime("text/plain")).toBe(false);
  });

  it("defaults OCR provider to disabled", () => {
    delete process.env.DOCUMENT_OCR_PROVIDER;
    expect(documentOcrProvider()).toBe("disabled");
  });

  it("sends rawDocument bytes to Google Document AI", async () => {
    configureGoogleOcr("1");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token-1", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          document: { text: " OCR text \n", pages: [{}, {}] },
        }),
      });

    const result = await googleDocumentAiOcr(
      {
        buffer: Buffer.from("pdf-bytes"),
        mimeType: "application/pdf",
        filename: "scan.pdf",
      },
      fetchMock as unknown as typeof fetch,
    );

    expect(result).toEqual({
      text: "OCR text",
      pageCount: 2,
      provider: "google_document_ai",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://us-documentai.googleapis.com/v1/projects/p1/locations/us/processors/proc1:process",
    );
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(body.rawDocument).toMatchObject({
      content: Buffer.from("pdf-bytes").toString("base64"),
      mimeType: "application/pdf",
      displayName: "scan.pdf",
    });
  });

  it("maps Google provider failures to typed OCR errors", async () => {
    configureGoogleOcr("2");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token-2", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "server error",
        text: async () => "boom",
      });

    const err = await googleDocumentAiOcr(
      { buffer: Buffer.from("x"), mimeType: "application/pdf" },
      fetchMock as unknown as typeof fetch,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(DocumentOcrError);
    expect(err.code).toBe("provider_error");
  });
});
