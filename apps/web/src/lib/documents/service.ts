// Prisma-backed DocumentService.
//
// Step 3 is a foundation slice:
//   - Persists the `Document` row + `DocumentChunk` rows. `embedding`
//     stays null. No retrieval / no orchestrator wiring.
//   - The validated rich metadata block (issuer / testMethod / etc.) is
//     NOT persisted in this slice — the existing Prisma `Document` model
//     has no metadata column. A follow-up migration will add one. Until
//     then the API accepts and validates the field so callers can be
//     written against the stable shape.
//
// Error surface:
//   `DocumentServiceError` with a typed `code`. The API route translates
//   `database_unavailable` to a 503 and other failures to 500, never to
//   a silent in-memory fallback (Step 3 documents only make sense when
//   actually persisted).

import type { PrismaClient } from "@prisma/client";

import { getPrismaClient } from "../db";
import { chunkText, type Chunk } from "./chunker";
import type { CreateDocumentRequest } from "./schemas";

export type DocumentServiceErrorCode =
  | "database_unavailable"
  | "internal_error";

export class DocumentServiceError extends Error {
  constructor(
    public readonly code: DocumentServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DocumentServiceError";
  }
}

export type DocumentSummary = {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  category: string | null;
  version: string | null;
  status: string;
  chunkCount: number;
  createdAt: number;
};

const LIST_DEFAULT_LIMIT = 20;
const LIST_MAX_LIMIT = 100;

function clampListLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return LIST_DEFAULT_LIMIT;
  const n = Math.floor(value);
  if (n <= 0) return LIST_DEFAULT_LIMIT;
  return Math.min(n, LIST_MAX_LIMIT);
}

// Translate raw Prisma / driver errors into typed service errors. Anything
// that looks like a connection / initialization failure — including a
// missing or unparseable DATABASE_URL — becomes `database_unavailable` so
// the route can answer 503 with a clear "configure the database" message
// rather than a generic 500.
function wrapDbError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  const name = (err as { name?: unknown })?.name;
  const code = (err as { code?: unknown })?.code;

  const looksUnreachable =
    // PrismaClientInitializationError covers both missing-env and
    // connection-refused at construction / first-query time. Any P10XX
    // error code is in the initialization / connection family.
    name === "PrismaClientInitializationError" ||
    (typeof code === "string" && /^P10\d{2}$/.test(code)) ||
    // Defensive substring match against the most common runtime messages
    // (network failures, missing env vars, datasource-url validation
    // errors). Keeps the 503 path working even if Prisma adds a new
    // error subclass we haven't pinned on yet.
    /Can't reach database server|connection refused|getaddrinfo|ECONNREFUSED|ENOTFOUND|database does not exist|Environment variable .* not found|DATABASE_URL|datasource .* not found|invalid `?DATABASE_URL`?/i.test(
      message,
    );

  if (looksUnreachable) {
    throw new DocumentServiceError("database_unavailable", message);
  }
  throw new DocumentServiceError("internal_error", message);
}

export class DocumentService {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  async create(
    input: CreateDocumentRequest,
  ): Promise<{ id: string; chunkCount: number }> {
    const sizeBytes = Buffer.byteLength(input.content, "utf8");
    const chunks: Chunk[] = chunkText(input.content);
    if (chunks.length === 0) {
      // Defensive: schema requires non-empty content, but if the chunker
      // ever emits 0 chunks we want a typed error, not a silent insert of
      // a chunkless Document row.
      throw new DocumentServiceError(
        "internal_error",
        "chunker produced 0 chunks from non-empty content",
      );
    }

    try {
      const created = await this.prisma.document.create({
        data: {
          filename: input.filename,
          originalName: input.originalName ?? input.filename,
          mimeType: input.mimeType,
          sizeBytes,
          category: input.category ?? null,
          version: input.version ?? null,
          status: "chunked",
          chunks: {
            create: chunks.map((c) => ({
              chunkIndex: c.index,
              content: c.content,
              pageNumber: c.pageNumber ?? null,
              // metadata + embedding intentionally left null until a
              // follow-up migration adds richer storage.
            })),
          },
        },
        select: { id: true },
      });
      return { id: created.id, chunkCount: chunks.length };
    } catch (err) {
      wrapDbError(err);
    }
  }

  async list(limit?: number): Promise<DocumentSummary[]> {
    const take = clampListLimit(limit);
    try {
      const rows = await this.prisma.document.findMany({
        orderBy: { createdAt: "desc" },
        take,
        select: {
          id: true,
          filename: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          category: true,
          version: true,
          status: true,
          createdAt: true,
          _count: { select: { chunks: true } },
        },
      });
      return rows.map((r) => ({
        id: r.id,
        filename: r.filename,
        originalName: r.originalName,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        category: r.category,
        version: r.version,
        status: r.status,
        chunkCount: r._count.chunks,
        createdAt: r.createdAt.getTime(),
      }));
    } catch (err) {
      wrapDbError(err);
    }
  }
}
