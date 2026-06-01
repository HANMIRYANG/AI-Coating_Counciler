"use client";

// 내부 기술자료 관리 (/documents)
//
// text/plain · text/markdown 문서를 업로드(POST /api/documents)하고, 목록
// (GET /api/documents)과 키워드 검색(GET /api/documents/search)을 제공한다.
// 이 경로는 Prisma(Postgres) 전용이라 DB 미구성 시 API 가 503 을 반환하며,
// 이 화면은 그 메시지를 그대로 노출한다.
//
// PDF/DOCX(Blob) 업로드, 문서 삭제/수정은 이번 범위 밖(별도 작업).
//
// 서버 전용 모듈(@prisma/client 를 끌어오는 service.ts/search.ts)을 client
// 번들에 넣지 않기 위해 응답 타입은 로컬에 다시 선언한다.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AppShell } from "@/components/design/CouncilDesign";

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

  // ── 목록 ───────────────────────────────────────────────────
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [listErr, setListErr] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);

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
              PDF/DOCX 업로드와 문서 삭제는 아직 지원하지 않습니다.
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
                {uploading ? "업로드 중..." : "업로드"}
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
