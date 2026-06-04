// OCR fallback for scanned/image-only documents.
//
// Vercel-friendly design: no local PDF rasterizer, no Tesseract worker. The
// default engine sends the original bytes to Google Document AI's online
// processor API and returns the extracted text for the existing Neon chunking
// path.

import { createSign } from "crypto";

export const OCR_SUPPORTED_MIME_TO_KIND = {
  "application/pdf": "pdf",
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "image/tiff": "image",
  "image/gif": "image",
} as const;

export type OcrSupportedMime = keyof typeof OCR_SUPPORTED_MIME_TO_KIND;
export type OcrDocumentKind = (typeof OCR_SUPPORTED_MIME_TO_KIND)[OcrSupportedMime];

export type OcrErrorCode =
  | "disabled"
  | "unsupported_type"
  | "invalid_config"
  | "auth_failed"
  | "provider_error"
  | "no_text_extracted";

export class DocumentOcrError extends Error {
  constructor(
    public readonly code: OcrErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DocumentOcrError";
  }
}

export type OcrResult = {
  text: string;
  pageCount?: number;
  provider: "google_document_ai";
};

export type OcrInput = {
  buffer: Buffer;
  mimeType: string;
  filename?: string;
};

export type OcrEngine = (input: OcrInput) => Promise<OcrResult>;

type GoogleDocumentAiConfig = {
  projectId: string;
  location: string;
  processorId: string;
  clientEmail: string;
  privateKey: string;
  processorVersion?: string;
};

type FetchLike = typeof fetch;

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

let cachedGoogleToken:
  | { token: string; expiresAtMs: number; key: string }
  | undefined;

export function isOcrSupportedMime(value: string): value is OcrSupportedMime {
  return value in OCR_SUPPORTED_MIME_TO_KIND;
}

export function documentOcrProvider(): "disabled" | "google_document_ai" {
  const raw = (process.env.DOCUMENT_OCR_PROVIDER ?? "disabled")
    .trim()
    .toLowerCase();
  return raw === "google_document_ai" ? "google_document_ai" : "disabled";
}

export const defaultOcrEngine: OcrEngine = async (input) => {
  if (documentOcrProvider() !== "google_document_ai") {
    throw new DocumentOcrError(
      "disabled",
      "OCR is disabled. Set DOCUMENT_OCR_PROVIDER=google_document_ai and configure Google Document AI credentials.",
    );
  }
  return googleDocumentAiOcr(input);
};

export async function googleDocumentAiOcr(
  input: OcrInput,
  fetchImpl: FetchLike = fetch,
): Promise<OcrResult> {
  if (!isOcrSupportedMime(input.mimeType)) {
    throw new DocumentOcrError(
      "unsupported_type",
      `mimeType '${input.mimeType}' is not supported by OCR fallback.`,
    );
  }

  const cfg = readGoogleDocumentAiConfig();
  const token = await getGoogleAccessToken(cfg, fetchImpl);
  const name = googleProcessorName(cfg);
  const endpoint = `https://${cfg.location}-documentai.googleapis.com/v1/${name}:process`;

  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fieldMask: "text,pages.pageNumber",
      rawDocument: {
        content: input.buffer.toString("base64"),
        mimeType: input.mimeType,
        displayName: input.filename,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const code = res.status === 401 || res.status === 403 ? "auth_failed" : "provider_error";
    throw new DocumentOcrError(
      code,
      `Google Document AI OCR failed (${res.status}): ${body || res.statusText}`,
    );
  }

  const payload = (await res.json()) as {
    document?: { text?: string; pages?: unknown[] };
  };
  const text = normalizeOcrText(payload.document?.text ?? "");
  if (text.length === 0) {
    throw new DocumentOcrError(
      "no_text_extracted",
      "OCR completed but produced no text.",
    );
  }

  return {
    text,
    pageCount: Array.isArray(payload.document?.pages)
      ? payload.document.pages.length
      : undefined,
    provider: "google_document_ai",
  };
}

function readGoogleDocumentAiConfig(): GoogleDocumentAiConfig {
  const cfg: GoogleDocumentAiConfig = {
    projectId: requiredEnv("GOOGLE_DOCUMENT_AI_PROJECT_ID"),
    location: requiredEnv("GOOGLE_DOCUMENT_AI_LOCATION"),
    processorId: requiredEnv("GOOGLE_DOCUMENT_AI_PROCESSOR_ID"),
    clientEmail: requiredEnv("GOOGLE_DOCUMENT_AI_CLIENT_EMAIL"),
    privateKey: normalizePrivateKey(
      requiredEnv("GOOGLE_DOCUMENT_AI_PRIVATE_KEY"),
    ),
    processorVersion: optionalEnv("GOOGLE_DOCUMENT_AI_PROCESSOR_VERSION"),
  };
  return cfg;
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new DocumentOcrError(
      "invalid_config",
      `Missing required OCR environment variable: ${key}`,
    );
  }
  return value;
}

function optionalEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, "\n");
}

function googleProcessorName(cfg: GoogleDocumentAiConfig): string {
  const base = `projects/${cfg.projectId}/locations/${cfg.location}/processors/${cfg.processorId}`;
  return cfg.processorVersion
    ? `${base}/processorVersions/${cfg.processorVersion}`
    : base;
}

async function getGoogleAccessToken(
  cfg: GoogleDocumentAiConfig,
  fetchImpl: FetchLike,
): Promise<string> {
  const key = `${cfg.clientEmail}|${cfg.projectId}`;
  const now = Date.now();
  if (cachedGoogleToken && cachedGoogleToken.key === key && cachedGoogleToken.expiresAtMs - now > 60_000) {
    return cachedGoogleToken.token;
  }

  const assertion = signGoogleJwt(cfg, now);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new DocumentOcrError(
      "auth_failed",
      `Google OAuth token exchange failed (${res.status}): ${text || res.statusText}`,
    );
  }

  const payload = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!payload.access_token) {
    throw new DocumentOcrError(
      "auth_failed",
      "Google OAuth token exchange did not return an access_token.",
    );
  }

  cachedGoogleToken = {
    token: payload.access_token,
    expiresAtMs: now + (payload.expires_in ?? 3600) * 1000,
    key,
  };
  return payload.access_token;
}

function signGoogleJwt(cfg: GoogleDocumentAiConfig, nowMs: number): string {
  const nowSec = Math.floor(nowMs / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: cfg.clientEmail,
    scope: CLOUD_PLATFORM_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(claim)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(cfg.privateKey);
  return `${unsigned}.${base64Url(signature)}`;
}

function base64UrlJson(value: unknown): string {
  return base64Url(Buffer.from(JSON.stringify(value), "utf8"));
}

function base64Url(value: Buffer): string {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function normalizeOcrText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}
