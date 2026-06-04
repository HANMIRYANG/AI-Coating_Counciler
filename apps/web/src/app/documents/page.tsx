"use client";

// 내부 기술자료 관리 (/documents)
//
// 업로드 경로 3종:
//   1) 인라인 텍스트  : text/plain · text/markdown (POST /api/documents, ≤256KB)
//   2) 파일 추출      : PDF/DOCX/이미지 → text-layer 추출 + OCR fallback
//                       (POST /api/documents/parse, 소형 파일용)
//   3) 대용량 원본    : 브라우저 → Vercel Blob 직접 업로드 후 지연 추출
//                       (POST /api/documents/blob/upload → POST /api/documents/:id/extract)
// 그리고 목록(GET /api/documents) · 키워드 검색(GET /api/documents/search).
// 이 경로는 Prisma(Postgres) 전용이라 DB 미구성 시 API 가 503 을 반환하며,
// 이 화면은 그 메시지를 그대로 노출한다.
//
// 문서 삭제/수정, 임베딩·벡터(의미 기반) 검색은 이번 범위 밖(별도 작업).
//
// 서버 전용 모듈(@prisma/client 를 끌어오는 service.ts/search.ts)을 client
// 번들에 넣지 않기 위해 응답 타입은 로컬에 다시 선언한다. blobStorage 는 zod
// 만 의존하는 순수 헬퍼라 클라이언트 번들에 안전하게 포함된다.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { upload } from "@vercel/blob/client";
import { AppShell } from "@/components/design/CouncilDesign";
import {
  MAX_ORIGINAL_BLOB_BYTES,
  buildOriginalBlobPathname,
  isSupportedOriginalMime,
} from "@/lib/documents/blobStorage";

// EvidenceDocumentType 값과 동일(빈 값 = 미지정). 서버 Zod 를 import 하지
// 않도록 client 측에 고정 목록으로 둔다.
const DOCUMENT_TYPES = [
  "",
  "test_report",
  "certification",
  "sds",
  "msds",
  "tds",
  "technical_datasheet",
  "internal_memo",
  "catalog",
  "other",
] as const;

type DocMeta = {
  productName?: string;
  documentType?: string;
  version?: string;
  issuedDate?: string;
  issuer?: string;
  testMethod?: string;
  substrate?: string;
  coatingThickness?: string;
  temperatureCondition?: string;
};

type DocSummary = {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  category: string | null;
  version: string | null;
  status: string;
  metadata: DocMeta | null;
  chunkCount: number;
  createdAt: number;
};

type SearchResult = {
  documentId: string;
  filename: string;
  chunkId: string;
  chunkIndex: number;
  snippet: string;
  metadata: DocMeta | null;
  score: number;
};

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function pruneMeta(meta: DocMeta): DocMeta {
  const out: DocMeta = {};
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === "string" && v.trim().length > 0) {
      out[k as keyof DocMeta] = v.trim();
    }
  }
  return out;
}

export default function DocumentsPage() {
  // ── 업로드 폼 ──────────────────────────────────────────────
  const [filename, setFilename] = useState("");
  const [mimeType, setMimeType] = useState<"text/plain" | "text/markdown">(
    "text/markdown",
  );
  const [content, setContent] = useState("");
  const [meta, setMeta] = useState<DocMeta>({});
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // ── 파일 추출 업로드 (PDF/DOCX/이미지, 인라인 parse) ────────
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseMsg, setParseMsg] = useState<string | null>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);

  // ── 대용량 원본 업로드 (Vercel Blob client-upload) ─────────
  const [blobFile, setBlobFile] = useState<File | null>(null);
  const [blobUploading, setBlobUploading] = useState(false);
  const [blobMsg, setBlobMsg] = useState<string | null>(null);
  const [blobErr, setBlobErr] = useState<string | null>(null);

  // ── 목록 ───────────────────────────────────────────────────
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [listErr, setListErr] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [extractMsg, setExtractMsg] = useState<string | null>(null);
  const [extractErr, setExtractErr] = useState<string | null>(null);

  // ── 검색 ───────────────────────────────────────────────────
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListErr(null);
    try {
      const res = await fetch("/api/documents", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message ?? json?.error ?? `HTTP ${res.status}`);
      }
      setDocs((json.documents as DocSummary[]) ?? []);
    } catch (e) {
      setListErr(errMessage(e));
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  async function submitUpload(e: FormEvent) {
    e.preventDefault();
    if (uploading) return;
    setUploadErr(null);
    setUploadMsg(null);
    if (filename.trim().length < 1 || content.trim().length < 1) {
      setUploadErr("파일명과 내용을 입력하세요.");
      return;
    }
    setUploading(true);
    try {
      const cleanedMeta = pruneMeta(meta);
      const body = {
        filename: filename.trim(),
        mimeType,
        content,
        ...(Object.keys(cleanedMeta).length > 0
          ? { metadata: cleanedMeta }
          : {}),
      };
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message ?? json?.error ?? `HTTP ${res.status}`);
      }
      setUploadMsg(`업로드 완료 — 청크 ${json.chunkCount ?? "?"}개 생성됨.`);
      setFilename("");
      setContent("");
      setMeta({});
      await loadList();
    } catch (e) {
      setUploadErr(errMessage(e));
    } finally {
      setUploading(false);
    }
  }

  async function submitParse() {
    if (parsing) return;
    setParseErr(null);
    setParseMsg(null);
    if (!file) {
      setParseErr("PDF 또는 DOCX 파일을 선택하세요.");
      return;
    }
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const cleanedMeta = pruneMeta(meta);
      if (Object.keys(cleanedMeta).length > 0) {
        fd.append("metadata", JSON.stringify(cleanedMeta));
      }
      const res = await fetch("/api/documents/parse", {
        method: "POST",
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message ?? json?.error ?? `HTTP ${res.status}`);
      }
      const method = json.extractionMethod === "ocr" ? "OCR" : "텍스트 레이어";
      setParseMsg(
        `추출 완료 — ${json.kind?.toUpperCase() ?? ""} · 방식: ${method} · 청크 ${json.chunkCount ?? "?"}개 · ${json.extractedChars ?? "?"}자` +
          (json.pageCount ? ` · ${json.pageCount}p` : ""),
      );
      setFile(null);
      await loadList();
    } catch (e) {
      setParseErr(errMessage(e));
    } finally {
      setParsing(false);
    }
  }

  async function submitBlobUpload() {
    if (blobUploading) return;
    setBlobErr(null);
    setBlobMsg(null);
    if (!blobFile) {
      setBlobErr("업로드할 원본 파일을 선택하세요.");
      return;
    }
    // 토큰 발급 전 클라이언트에서 형식/크기를 미리 검증(서버
    // validateOriginalUpload 와 동일한 계약).
    if (!isSupportedOriginalMime(blobFile.type)) {
      setBlobErr(
        `지원하지 않는 형식입니다(${blobFile.type || "알 수 없음"}). PDF/DOCX/이미지(PNG·JPEG·TIFF)를 선택하세요.`,
      );
      return;
    }
    if (blobFile.size > MAX_ORIGINAL_BLOB_BYTES) {
      setBlobErr(
        `파일이 너무 큽니다(${(blobFile.size / 1024 / 1024).toFixed(1)}MB > ${(MAX_ORIGINAL_BLOB_BYTES / 1024 / 1024).toFixed(0)}MB).`,
      );
      return;
    }
    setBlobUploading(true);
    try {
      await upload(buildOriginalBlobPathname(blobFile.name), blobFile, {
        access: "private",
        handleUploadUrl: "/api/documents/blob/upload",
        clientPayload: JSON.stringify({
          filename: blobFile.name,
          contentType: blobFile.type,
          sizeBytes: blobFile.size,
        }),
      });
      setBlobMsg(
        "업로드 완료. Vercel 환경에서는 자동 등록(onUploadCompleted) 후 아래 목록에 " +
          "needs_extraction 상태로 나타나며 '추출/OCR' 로 추출합니다. 로컬 개발 서버에서는 " +
          "등록 웹훅이 발화하지 않아 목록에 나타나지 않습니다(대용량 경로는 Vercel 프리뷰에서 검증).",
      );
      setBlobFile(null);
      await loadList();
    } catch (e) {
      setBlobErr(errMessage(e));
    } finally {
      setBlobUploading(false);
    }
  }

  async function runLazyExtract(id: string) {
    if (extractingId) return;
    setExtractingId(id);
    setExtractErr(null);
    setExtractMsg(null);
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(id)}/extract`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message ?? json?.error ?? `HTTP ${res.status}`);
      }
      setExtractMsg(
        `청크 ${json.chunkCount ?? "?"}개 추출됨 (방식: ${
          json.extractionMethod === "ocr" ? "OCR" : "텍스트 레이어"
        })`,
      );
      await loadList();
    } catch (e) {
      setExtractErr(errMessage(e));
    } finally {
      setExtractingId(null);
    }
  }

  async function runSearch(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (query.length < 1) {
      setResults(null);
      return;
    }
    setSearching(true);
    setSearchErr(null);
    try {
      const res = await fetch(
        `/api/documents/search?q=${encodeURIComponent(query)}`,
        { cache: "no-store" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message ?? json?.error ?? `HTTP ${res.status}`);
      }
      setResults((json.results as SearchResult[]) ?? []);
    } catch (e) {
      setSearchErr(errMessage(e));
      setResults(null);
    } finally {
      setSearching(false);
    }
  }

  const setMetaField = (k: keyof DocMeta, v: string) =>
    setMeta((m) => ({ ...m, [k]: v }));

  const canRunLazyExtract = (d: DocSummary) =>
    d.status === "needs_extraction" ||
    (d.chunkCount === 0 &&
      (d.mimeType === "application/pdf" ||
        d.mimeType ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        d.mimeType.startsWith("image/")));

  return (
    <AppShell
      active="docs"
      title="내부 기술자료 관리"
      status="문서 업로드 · 검색"
    >
      <div className="content">
        <div className="container wide">
          <div className="hero">
            <h2>내부 기술자료 관리</h2>
            <p>
              TDS/SDS/시험성적서 등 사내 문서를 텍스트로 업로드하면 결정적
              청킹 후 키워드 검색 근거로 사용됩니다. 검토 화면에서 근거 모드를
              <b> 사내 자료 사용</b>으로 선택하면 이 문서들이 근거 후보로
              제공됩니다.
            </p>
            <p className="readiness-note">
              ※ 이 화면은 Postgres(Prisma) 연결이 필요합니다. DB 미구성 시
              아래 작업은 <code>database_unavailable(503)</code> 로 안내됩니다.
              PDF/DOCX/이미지 추출 업로드를 지원합니다. 문서 삭제/수정과
              임베딩·벡터(의미 기반) 검색은 아직 지원하지 않습니다.
            </p>
          </div>

          {/* ── 업로드 ─────────────────────────────────────── */}
          <div className="section-title">
            <h2>문서 업로드</h2>
            <span className="sub">text/plain · text/markdown (≤256KB)</span>
          </div>
          <form
            onSubmit={submitUpload}
            style={{ display: "grid", gap: 10, marginBottom: 8 }}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="파일명 (예: HE-850A_TDS.md)"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                disabled={uploading}
                style={{ flex: "2 1 240px", padding: 8 }}
              />
              <select
                value={mimeType}
                onChange={(e) =>
                  setMimeType(e.target.value as "text/plain" | "text/markdown")
                }
                disabled={uploading}
                style={{ flex: "1 1 140px", padding: 8 }}
              >
                <option value="text/markdown">text/markdown</option>
                <option value="text/plain">text/plain</option>
              </select>
            </div>

            <textarea
              placeholder="문서 본문을 붙여넣으세요..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={uploading}
              rows={8}
              style={{ width: "100%", padding: 8, fontFamily: "inherit" }}
            />

            <details>
              <summary style={{ cursor: "pointer" }}>
                메타데이터 (선택) — 제품/유형/기관/시험 정보
              </summary>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 8,
                  marginTop: 8,
                }}
              >
                <input
                  type="text"
                  placeholder="제품명 (productName)"
                  value={meta.productName ?? ""}
                  onChange={(e) => setMetaField("productName", e.target.value)}
                  disabled={uploading}
                  style={{ padding: 8 }}
                />
                <select
                  value={meta.documentType ?? ""}
                  onChange={(e) => setMetaField("documentType", e.target.value)}
                  disabled={uploading}
                  style={{ padding: 8 }}
                >
                  {DOCUMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t === "" ? "문서 유형 (documentType)" : t}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="발급 기관 (issuer)"
                  value={meta.issuer ?? ""}
                  onChange={(e) => setMetaField("issuer", e.target.value)}
                  disabled={uploading}
                  style={{ padding: 8 }}
                />
                <input
                  type="text"
                  placeholder="시험 방법 (testMethod)"
                  value={meta.testMethod ?? ""}
                  onChange={(e) => setMetaField("testMethod", e.target.value)}
                  disabled={uploading}
                  style={{ padding: 8 }}
                />
                <input
                  type="text"
                  placeholder="기재 (substrate)"
                  value={meta.substrate ?? ""}
                  onChange={(e) => setMetaField("substrate", e.target.value)}
                  disabled={uploading}
                  style={{ padding: 8 }}
                />
                <input
                  type="text"
                  placeholder="도포 두께 (coatingThickness)"
                  value={meta.coatingThickness ?? ""}
                  onChange={(e) =>
                    setMetaField("coatingThickness", e.target.value)
                  }
                  disabled={uploading}
                  style={{ padding: 8 }}
                />
              </div>
            </details>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className="btn primary" type="submit" disabled={uploading}>
                {uploading ? "업로드 중..." : "텍스트 업로드"}
              </button>
              {uploadMsg && (
                <span style={{ color: "var(--ok, #2a7)" }}>{uploadMsg}</span>
              )}
            </div>
            {uploadErr && (
              <div className="form-error" role="alert">
                업로드 실패: {uploadErr}
              </div>
            )}

            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
                borderTop: "1px solid var(--line, #ddd)",
                paddingTop: 10,
              }}
            >
              <span className="muted">또는 파일 추출 (PDF/DOCX/이미지):</span>
              <input
                type="file"
                accept=".pdf,.docx,.png,.jpg,.jpeg,.webp,.tiff,.tif,.gif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp,image/tiff,image/gif"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={parsing}
              />
              <button
                className="btn"
                type="button"
                onClick={submitParse}
                disabled={parsing || !file}
              >
                {parsing ? "추출 중..." : "파일 추출 업로드"}
              </button>
              {parseMsg && (
                <span style={{ color: "var(--ok, #2a7)" }}>{parseMsg}</span>
              )}
            </div>
            <p className="readiness-note">
              PDF/DOCX는 텍스트 레이어를 우선 추출하고, 텍스트가 없으면 OCR로
              대체합니다. 이미지는 OCR로 처리합니다(OCR은 서버에
              <code>DOCUMENT_OCR_PROVIDER</code> 설정 필요 — 미설정 시 503으로
              안내). 위 메타데이터는 텍스트/파일 추출 업로드에 적용됩니다.
            </p>
            {parseErr && (
              <div className="form-error" role="alert">
                추출 실패: {parseErr}
              </div>
            )}

            {/* ── 대용량 원본 업로드 (Vercel Blob) ─────────────── */}
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
                borderTop: "1px solid var(--line, #ddd)",
                paddingTop: 10,
              }}
            >
              <span className="muted">대용량 원본 업로드 (Blob):</span>
              <input
                type="file"
                accept=".pdf,.docx,.png,.jpg,.jpeg,.tiff,.tif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/tiff"
                onChange={(e) => setBlobFile(e.target.files?.[0] ?? null)}
                disabled={blobUploading}
              />
              <button
                className="btn"
                type="button"
                onClick={submitBlobUpload}
                disabled={blobUploading || !blobFile}
              >
                {blobUploading ? "업로드 중..." : "원본 업로드"}
              </button>
            </div>
            <p className="readiness-note">
              4.5MB를 초과하는 대용량 원본(PDF/DOCX/이미지, ≤25MB)은 이 경로로
              브라우저에서 Vercel Blob에 직접 업로드한 뒤, 목록에서
              <b> 추출/OCR</b>로 텍스트를 추출합니다(<code>BLOB_READ_WRITE_TOKEN</code>
              필요). 이 경로에는 위 메타데이터가 적용되지 않습니다.
            </p>
            {blobMsg && (
              <div style={{ color: "var(--ok, #2a7)" }}>{blobMsg}</div>
            )}
            {blobErr && (
              <div className="form-error" role="alert">
                원본 업로드 실패: {blobErr}
              </div>
            )}
          </form>

          {/* ── 검색 ───────────────────────────────────────── */}
          <div className="section-title">
            <h2>문서 검색</h2>
            <span className="sub">청크 키워드 검색 (스니펫 ≤160자)</span>
          </div>
          <form
            onSubmit={runSearch}
            style={{ display: "flex", gap: 8, marginBottom: 8 }}
          >
            <input
              type="text"
              placeholder="검색어 (예: 난연 두께 시험)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ flex: "1 1 auto", padding: 8 }}
            />
            <button className="btn" type="submit" disabled={searching}>
              {searching ? "검색 중..." : "검색"}
            </button>
          </form>
          {searchErr && (
            <div className="form-error" role="alert">
              검색 실패: {searchErr}
            </div>
          )}
          {results && (
            <div style={{ marginBottom: 8 }}>
              {results.length === 0 ? (
                <p className="muted">검색 결과가 없습니다.</p>
              ) : (
                <ul>
                  {results.map((r) => (
                    <li key={r.chunkId} style={{ marginBottom: 6 }}>
                      <b>
                        {r.filename} #{r.chunkIndex}
                      </b>
                      <span className="muted"> · score {r.score}</span>
                      <div>{r.snippet}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ── 목록 ───────────────────────────────────────── */}
          <div className="section-title">
            <h2>업로드된 문서</h2>
            <span className="sub">
              {listLoading ? "불러오는 중..." : `총 ${docs.length}건`}
            </span>
          </div>
          {listErr && (
            <div className="form-error" role="alert">
              목록 로드 실패: {listErr}
            </div>
          )}
          {extractMsg && (
            <div style={{ color: "var(--ok, #2a7)", marginBottom: 8 }}>
              {extractMsg}
            </div>
          )}
          {extractErr && (
            <div className="form-error" role="alert">
              추출/OCR 실패: {extractErr}
            </div>
          )}
          {!listLoading && !listErr && docs.length === 0 && (
            <p className="muted">아직 업로드된 문서가 없습니다.</p>
          )}
          {docs.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th style={{ padding: 6 }}>파일명</th>
                    <th style={{ padding: 6 }}>유형</th>
                    <th style={{ padding: 6 }}>기관</th>
                    <th style={{ padding: 6 }}>청크</th>
                    <th style={{ padding: 6 }}>크기</th>
                    <th style={{ padding: 6 }}>상태</th>
                    <th style={{ padding: 6 }}>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr
                      key={d.id}
                      style={{ borderTop: "1px solid var(--line, #ddd)" }}
                    >
                      <td style={{ padding: 6 }}>{d.filename}</td>
                      <td style={{ padding: 6 }}>
                        {d.metadata?.documentType ?? "—"}
                      </td>
                      <td style={{ padding: 6 }}>
                        {d.metadata?.issuer ?? "—"}
                      </td>
                      <td style={{ padding: 6 }}>{d.chunkCount}</td>
                      <td style={{ padding: 6 }}>
                        {(d.sizeBytes / 1024).toFixed(1)}KB
                      </td>
                      <td style={{ padding: 6 }}>{d.status}</td>
                      <td style={{ padding: 6 }}>
                        {canRunLazyExtract(d) ? (
                          <button
                            className="btn"
                            type="button"
                            onClick={() => void runLazyExtract(d.id)}
                            disabled={extractingId !== null}
                          >
                            {extractingId === d.id
                              ? "추출 중..."
                              : "추출/OCR"}
                          </button>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
