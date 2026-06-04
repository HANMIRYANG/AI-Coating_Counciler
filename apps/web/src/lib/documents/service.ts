// Prisma-backed DocumentService.
//
//   - Persists the `Document` row + `DocumentChunk` rows. Each chunk is
//     embedded at intake on a BEST-EFFORT basis (embeddings.ts): on any
//     embedder failure the embedding is left null and the document still
//     persists — keyword search keeps working and the chunk becomes a backfill
//     target (`backfillEmbeddings`).
//   - The validated rich metadata block (issuer / testMethod / etc.) is
//     persisted into `Document.metadata`.
//   - Retrieval: `search()` (keyword), `vectorSearch()` (embedding cosine), and
//     `hybridSearch()` (both, merged). Wired into the council via the evidence
//     bundle preflight.
//   - Blob originals: `recordOriginalUpload()` stores metadata as
//     `needs_extraction`; text is extracted + chunked on demand via the lazy
//     extract route.
//
// Error surface:
//   `DocumentServiceError` with a typed `code`. The API route translates
//   `database_unavailable` to a 503 and other failures to 500, never to
//   a silent in-memory fallback (Step 3 documents only make sense when
//   actually persisted).

import { Prisma, type PrismaClient } from "@prisma/client";

import { getPrismaClient } from "../db";
import { chunkText, type Chunk } from "./chunker";
import type { CreateDocumentRequest, DocumentMetadata } from "./schemas";
import { toOriginalBlobMetadata } from "./blobStorage";
import { isParseableMime } from "./extract";
import { isOcrSupportedMime } from "./ocr";
import {
  buildChunkWhere,
  buildDocumentMetadataWhere,
  buildSnippet,
  clampSearchLimit,
  normalizeQuery,
  rankCandidates,
  SEARCH_CANDIDATE_CAP,
  type DocumentSearchResult,
  type SearchCandidate,
  type SearchDocumentsRequest,
} from "./search";
import { buildEmbedder, type Embedder } from "./embeddings";
import {
  chunkEmbeddingModel,
  decodeEmbedding,
  embeddingStamp,
  encodeEmbedding,
  maxVectorCandidates,
  mergeHybrid,
  rankByCosine,
  type VectorCandidate,
} from "./vectorSearch";

export type DocumentServiceErrorCode =
  | "database_unavailable"
  | "internal_error"
  | "not_found"
  | "not_extractable";

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
  metadata: DocumentMetadata | null;
  chunkCount: number;
  createdAt: number;
};

export type DocumentOriginalForExtraction = {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  category: string | null;
  version: string | null;
  metadata: DocumentMetadata | null;
  originalBlobUrl: string;
  originalBlobPath: string | null;
  originalBlobContentType: string | null;
  originalBlobSizeBytes: number | null;
};

const LIST_DEFAULT_LIMIT = 20;
const LIST_MAX_LIMIT = 100;

function clampListLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return LIST_DEFAULT_LIMIT;
  const n = Math.floor(value);
  if (n <= 0) return LIST_DEFAULT_LIMIT;
  return Math.min(n, LIST_MAX_LIMIT);
}

const BACKFILL_DEFAULT_LIMIT = 100;
const BACKFILL_MAX_LIMIT = 500;

function clampBackfillLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return BACKFILL_DEFAULT_LIMIT;
  }
  const n = Math.floor(value);
  if (n <= 0) return BACKFILL_DEFAULT_LIMIT;
  return Math.min(n, BACKFILL_MAX_LIMIT);
}

export function canExtractOriginalMime(mimeType: string): boolean {
  return isParseableMime(mimeType) || isOcrSupportedMime(mimeType);
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
  private _embedder?: Embedder;

  constructor(
    private readonly prisma: PrismaClient = getPrismaClient(),
    embedder?: Embedder,
  ) {
    this._embedder = embedder;
  }

  // Lazily built so unrelated ops (list/search) never construct an embedder
  // and a bad EMBEDDING_MODEL never breaks them. Injectable for tests.
  private embedder(): Embedder {
    return (this._embedder ??= buildEmbedder());
  }

  // Best-effort: embed chunk contents into per-chunk { embedding bytes, stamp }.
  // On ANY embedder failure (missing key, provider error, timeout) returns all
  // nulls so document creation NEVER blocks — keyword search still works and the
  // chunks become backfill targets.
  private async embedChunksSafe(
    contents: string[],
  ): Promise<Array<{ buf: Buffer; stamp: Record<string, unknown> } | null>> {
    if (contents.length === 0) return [];
    try {
      const embedder = this.embedder();
      const vectors = await embedder.embed(contents);
      if (vectors.length !== contents.length) {
        return contents.map(() => null);
      }
      const stamp = embeddingStamp(embedder);
      return vectors.map((v) => ({ buf: encodeEmbedding(v), stamp }));
    } catch {
      return contents.map(() => null);
    }
  }

  private chunkEmbeddingData(
    embedded: { buf: Buffer; stamp: Record<string, unknown> } | null,
  ): { embedding: Buffer | null; metadata: Prisma.InputJsonValue | typeof Prisma.DbNull } {
    return {
      embedding: embedded?.buf ?? null,
      metadata: embedded
        ? (embedded.stamp as Prisma.InputJsonValue)
        : Prisma.DbNull,
    };
  }

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

    // Best-effort embeddings (outside the DB transaction so a slow embed never
    // holds a write lock). Failure → null embeddings, document still persists.
    const embedded = await this.embedChunksSafe(chunks.map((c) => c.content));

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
          // `input.metadata` is already validated + key-stripped by
          // `DocumentMetadataSchema`; persist it verbatim. When the caller
          // omits it, write SQL NULL (`Prisma.DbNull`) — not a JSON `null`
          // literal — so the nullable JSONB column stays truly empty.
          metadata: input.metadata
            ? (input.metadata as Prisma.InputJsonValue)
            : Prisma.DbNull,
          chunks: {
            create: chunks.map((c, i) => ({
              chunkIndex: c.index,
              content: c.content,
              pageNumber: c.pageNumber ?? null,
              // Per-chunk embedding bytes + an {embeddingModel, embeddingDims}
              // stamp in chunk.metadata (null when embedding was unavailable).
              ...this.chunkEmbeddingData(embedded[i]),
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
          metadata: true,
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
        // Stored verbatim from the validated intake block; null when the
        // document was created without metadata.
        metadata: (r.metadata as DocumentMetadata | null) ?? null,
        chunkCount: r._count.chunks,
        createdAt: r.createdAt.getTime(),
      }));
    } catch (err) {
      wrapDbError(err);
    }
  }

  // Deterministic keyword search over persisted DocumentChunk content,
  // narrowed by optional Document.metadata filters. Foundation only — no
  // embeddings / vector similarity / retrieval-augmented assembly. Pulls a
  // bounded, deterministically-ordered candidate set from the DB and ranks
  // it in-process via the pure helpers in `search.ts`.
  async search(input: SearchDocumentsRequest): Promise<DocumentSearchResult[]> {
    const terms = normalizeQuery(input.q);
    // Defensive: the route already rejects empty queries. With no usable
    // terms there is nothing to match — skip the DB round-trip.
    if (terms.length === 0) return [];

    const limit = clampSearchLimit(input.limit);
    const where = buildChunkWhere(terms, {
      documentType: input.documentType,
      productName: input.productName,
      issuer: input.issuer,
    });

    try {
      const rows = await this.prisma.documentChunk.findMany({
        where,
        take: SEARCH_CANDIDATE_CAP,
        // Stable candidate ordering so the truncation point is deterministic.
        orderBy: [{ documentId: "asc" }, { chunkIndex: "asc" }],
        select: {
          id: true,
          chunkIndex: true,
          content: true,
          document: {
            select: { id: true, filename: true, metadata: true },
          },
        },
      });

      const candidates: SearchCandidate[] = rows.map((r) => ({
        chunkId: r.id,
        chunkIndex: r.chunkIndex,
        content: r.content,
        documentId: r.document.id,
        filename: r.document.filename,
        metadata: (r.document.metadata as DocumentMetadata | null) ?? null,
      }));

      return rankCandidates(candidates, terms, limit);
    } catch (err) {
      wrapDbError(err);
    }
  }

  // Persist a large binary ORIGINAL uploaded to Vercel Blob (Step 14).
  // Creates a Document row holding only the blob metadata — NO chunks yet.
  // Extractable types are registered as `needs_extraction`; text is extracted,
  // chunked, and embedded later on demand via the lazy extract route
  // (`POST /api/documents/:id/extract`). The blob URL is internal and is never
  // surfaced by list / search / evidence.
  async recordOriginalUpload(input: {
    filename: string;
    contentType: string;
    sizeBytes: number;
    blobUrl: string;
    blobPath: string;
    uploadedAt?: Date;
  }): Promise<{ id: string }> {
    const meta = toOriginalBlobMetadata({
      url: input.blobUrl,
      pathname: input.blobPath,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      uploadedAt: input.uploadedAt ?? new Date(),
    });
    try {
      const created = await this.prisma.document.create({
        data: {
          filename: input.filename,
          originalName: input.filename,
          mimeType: input.contentType,
          sizeBytes: input.sizeBytes,
          // Distinct status so these binary originals are never mistaken for
          // the chunked text intake path. Extractable originals are queued
          // lazily: they are not OCR'd at registration time, but can be
          // promoted to `chunked` through the on-demand extraction route.
          status: canExtractOriginalMime(input.contentType)
            ? "needs_extraction"
            : "original_uploaded",
          originalBlobUrl: meta.originalBlobUrl,
          originalBlobPath: meta.originalBlobPath,
          originalBlobSizeBytes: meta.originalBlobSizeBytes,
          originalBlobContentType: meta.originalBlobContentType,
          originalUploadedAt: meta.originalUploadedAt,
        },
        select: { id: true },
      });
      return { id: created.id };
    } catch (err) {
      wrapDbError(err);
    }
  }

  async getOriginalForExtraction(
    id: string,
  ): Promise<DocumentOriginalForExtraction> {
    try {
      const row = await this.prisma.document.findUnique({
        where: { id },
        select: {
          id: true,
          filename: true,
          originalName: true,
          mimeType: true,
          category: true,
          version: true,
          metadata: true,
          originalBlobUrl: true,
          originalBlobPath: true,
          originalBlobContentType: true,
          originalBlobSizeBytes: true,
        },
      });
      if (!row) {
        throw new DocumentServiceError(
          "not_found",
          `document ${id} not found`,
        );
      }
      if (!row.originalBlobUrl) {
        throw new DocumentServiceError(
          "not_extractable",
          `document ${id} does not have an original Blob file`,
        );
      }
      const mimeType = row.originalBlobContentType ?? row.mimeType;
      if (!canExtractOriginalMime(mimeType)) {
        throw new DocumentServiceError(
          "not_extractable",
          `mimeType '${mimeType}' is not supported for on-demand extraction`,
        );
      }
      return {
        id: row.id,
        filename: row.filename,
        originalName: row.originalName,
        mimeType: row.mimeType,
        category: row.category,
        version: row.version,
        metadata: (row.metadata as DocumentMetadata | null) ?? null,
        originalBlobUrl: row.originalBlobUrl,
        originalBlobPath: row.originalBlobPath,
        originalBlobContentType: row.originalBlobContentType,
        originalBlobSizeBytes: row.originalBlobSizeBytes,
      };
    } catch (err) {
      if (err instanceof DocumentServiceError) throw err;
      wrapDbError(err);
    }
  }

  async attachExtractedTextToOriginal(input: {
    id: string;
    content: string;
    category?: string;
    metadata?: DocumentMetadata;
  }): Promise<{ id: string; chunkCount: number }> {
    const chunks: Chunk[] = chunkText(input.content);
    if (chunks.length === 0) {
      throw new DocumentServiceError(
        "internal_error",
        "chunker produced 0 chunks from non-empty extracted content",
      );
    }

    // Best-effort embeddings before the transaction (see create()).
    const embedded = await this.embedChunksSafe(chunks.map((c) => c.content));

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.documentChunk.deleteMany({
          where: { documentId: input.id },
        });
        await tx.document.update({
          where: { id: input.id },
          data: {
            category: input.category ?? null,
            status: "chunked",
            metadata: input.metadata
              ? (input.metadata as Prisma.InputJsonValue)
              : Prisma.DbNull,
            chunks: {
              create: chunks.map((c, i) => ({
                chunkIndex: c.index,
                content: c.content,
                pageNumber: c.pageNumber ?? null,
                ...this.chunkEmbeddingData(embedded[i]),
              })),
            },
          },
        });
      });
      return { id: input.id, chunkCount: chunks.length };
    } catch (err) {
      wrapDbError(err);
    }
  }

  // Deterministic vector retrieval. Order matters for the degradation path:
  // FIRST scan a bounded set of stored embeddings and keep only those produced
  // by the CURRENT embedder; if no comparable candidate exists, return []
  // WITHOUT embedding the query (so an unembedded/mismatched corpus degrades to
  // keyword instantly, with no embeddings API call). Only then embed the query
  // and cosine-rank in-process. Callers (hybridSearch / evidence bundle) treat
  // [] as "fall back to keyword".
  async vectorSearch(
    input: SearchDocumentsRequest,
  ): Promise<DocumentSearchResult[]> {
    const q = input.q.trim();
    if (q.length === 0) return [];

    const embedder = this.embedder();
    const limit = clampSearchLimit(input.limit);
    const document = buildDocumentMetadataWhere({
      documentType: input.documentType,
      productName: input.productName,
      issuer: input.issuer,
    });

    // Scan stored embeddings FIRST and keep only those produced by the current
    // embedder. This runs BEFORE any query-embedding call so that an empty /
    // unembedded / mismatched corpus degrades to keyword instantly — without
    // spending an embeddings API call (and an EMBEDDING_TIMEOUT_MS wait) on the
    // query just to discover there is nothing to compare against.
    const candidates: VectorCandidate[] = [];
    try {
      const rows = await this.prisma.documentChunk.findMany({
        where: { embedding: { not: null }, ...(document ? { document } : {}) },
        take: maxVectorCandidates(),
        orderBy: [{ documentId: "asc" }, { chunkIndex: "asc" }],
        select: {
          id: true,
          chunkIndex: true,
          content: true,
          embedding: true,
          metadata: true,
          document: { select: { id: true, filename: true, metadata: true } },
        },
      });

      for (const r of rows) {
        if (!r.embedding) continue;
        // Skip chunks embedded by a different model (dimension/space mismatch).
        if (chunkEmbeddingModel(r.metadata) !== embedder.id) continue;
        candidates.push({
          chunkId: r.id,
          chunkIndex: r.chunkIndex,
          documentId: r.document.id,
          filename: r.document.filename,
          // No query term to center on — head snippet, bounded like keyword.
          snippet: buildSnippet(r.content, []),
          metadata: (r.document.metadata as DocumentMetadata | null) ?? null,
          vector: decodeEmbedding(Buffer.from(r.embedding)),
        });
      }
    } catch (err) {
      wrapDbError(err);
    }

    // No comparable stored embedding → no point embedding the query.
    if (candidates.length === 0) return [];

    let queryVec: Float32Array | undefined;
    try {
      [queryVec] = await embedder.embed([q]);
    } catch {
      return [];
    }
    if (!queryVec) return [];

    return rankByCosine(candidates, queryVec, limit);
  }

  // Hybrid retrieval: keyword + vector, merged into one deterministic ranking.
  // With no embeddings present, vectorSearch returns [] so this collapses to
  // pure keyword (zero behavior change until a corpus is embedded/backfilled).
  async hybridSearch(
    input: SearchDocumentsRequest,
  ): Promise<DocumentSearchResult[]> {
    const limit = clampSearchLimit(input.limit);
    const [keyword, vector] = await Promise.all([
      this.search(input),
      this.vectorSearch(input),
    ]);
    return mergeHybrid(keyword, vector, limit);
  }

  // Embed chunks that have no stored vector yet (pre-feature chunks, or chunks
  // whose best-effort embedding failed at intake). Bounded per call so it can
  // be invoked repeatedly until `remaining` reaches 0. Model-change re-embed is
  // out of scope here (clear embeddings to force a fresh backfill).
  async backfillEmbeddings(
    opts: { limit?: number } = {},
  ): Promise<{ processed: number; skipped: number; remaining: number }> {
    const take = clampBackfillLimit(opts.limit);
    try {
      const rows = await this.prisma.documentChunk.findMany({
        where: { embedding: null },
        take,
        orderBy: [{ documentId: "asc" }, { chunkIndex: "asc" }],
        select: { id: true, content: true },
      });
      if (rows.length === 0) return { processed: 0, skipped: 0, remaining: 0 };

      const embedded = await this.embedChunksSafe(rows.map((r) => r.content));
      let processed = 0;
      let skipped = 0;
      for (let i = 0; i < rows.length; i++) {
        const e = embedded[i];
        if (!e) {
          skipped++;
          continue;
        }
        await this.prisma.documentChunk.update({
          where: { id: rows[i].id },
          data: {
            embedding: e.buf,
            metadata: e.stamp as Prisma.InputJsonValue,
          },
        });
        processed++;
      }

      const remaining = await this.prisma.documentChunk.count({
        where: { embedding: null },
      });
      return { processed, skipped, remaining };
    } catch (err) {
      wrapDbError(err);
    }
  }
}
