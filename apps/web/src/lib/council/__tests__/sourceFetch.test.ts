import { describe, it, expect } from "vitest";
import { trustLevelForUrl, trustLevelForHost } from "../sourceWhitelist";
import {
  fetchSource,
  fetchSources,
  htmlToText,
  isBlockedHost,
} from "../sourceFetch";

function htmlResponse(
  html: string,
  init: { status?: number; contentType?: string } = {},
) {
  return new Response(html, {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "text/html; charset=utf-8" },
  });
}

describe("sourceWhitelist", () => {
  it("maps registries to official_registry", () => {
    expect(trustLevelForUrl("https://www.law.go.kr/x")).toBe(
      "official_registry",
    );
    expect(trustLevelForUrl("https://knab.go.kr/")).toBe("official_registry");
  });

  it("maps institutions to official_public_page (subdomains included)", () => {
    expect(trustLevelForUrl("https://www.kcl.re.kr/a")).toBe(
      "official_public_page",
    );
    expect(trustLevelForUrl("https://icis.mcee.go.kr/sds")).toBe(
      "official_public_page",
    );
    expect(trustLevelForUrl("https://ul.com/ul94")).toBe(
      "official_public_page",
    );
  });

  it("defaults unknown / look-alike domains to unverified_web", () => {
    expect(trustLevelForUrl("https://example.com")).toBe("unverified_web");
    // look-alike must NOT match the suffix rule
    expect(trustLevelForHost("kcl.re.kr.attacker.com")).toBe("unverified_web");
    expect(trustLevelForHost("evilkcl.re.kr")).toBe("unverified_web");
  });
});

describe("isBlockedHost (SSRF guard)", () => {
  it("blocks loopback / private / metadata hosts", () => {
    for (const h of [
      "localhost",
      "127.0.0.1",
      "10.0.0.5",
      "192.168.1.1",
      "172.16.0.1",
      "169.254.169.254",
      "::1",
    ]) {
      expect(isBlockedHost(h)).toBe(true);
    }
  });
  it("allows public hosts", () => {
    expect(isBlockedHost("kcl.re.kr")).toBe(false);
    expect(isBlockedHost("ul.com")).toBe(false);
  });
});

describe("htmlToText", () => {
  it("strips scripts/styles/tags and decodes entities", () => {
    const out = htmlToText(
      "<style>a{}</style><h1>난연 &amp; 시험</h1><script>x()</script><p>본문</p>",
    );
    expect(out).toBe("난연 & 시험 본문");
  });
});

describe("fetchSource", () => {
  it("blocks non-http(s) and private hosts before fetching", async () => {
    expect((await fetchSource("ftp://x/y")).ok).toBe(false);
    const r = await fetchSource("http://127.0.0.1/secret");
    expect(r).toMatchObject({ ok: false, reason: "blocked" });
  });

  it("returns parse_error for a malformed URL", async () => {
    expect(await fetchSource("not a url")).toMatchObject({
      ok: false,
      reason: "parse_error",
    });
  });

  it("extracts title + snippet + trust level on success", async () => {
    const fetchImpl = async () =>
      htmlResponse(
        "<title>KCL 난연 시험</title><body><p>도포 두께 100㎛ 시험 결과</p></body>",
      );
    const r = await fetchSource("https://www.kcl.re.kr/report", { fetchImpl });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.title).toBe("KCL 난연 시험");
      expect(r.snippet).toContain("도포 두께");
      expect(r.trustLevel).toBe("official_public_page");
    }
  });

  it("maps 4xx/5xx and unsupported content types", async () => {
    expect(
      await fetchSource("https://ul.com/x", {
        fetchImpl: async () => htmlResponse("", { status: 404 }),
      }),
    ).toMatchObject({ ok: false, reason: "http_4xx" });

    expect(
      await fetchSource("https://ul.com/x", {
        fetchImpl: async () => htmlResponse("", { status: 503 }),
      }),
    ).toMatchObject({ ok: false, reason: "http_5xx" });

    expect(
      await fetchSource("https://ul.com/x.pdf", {
        fetchImpl: async () =>
          new Response("%PDF", {
            status: 200,
            headers: { "content-type": "application/pdf" },
          }),
      }),
    ).toMatchObject({ ok: false, reason: "unsupported_content" });
  });

  it("maps an abort to a timeout reason", async () => {
    const fetchImpl = async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    };
    expect(await fetchSource("https://ul.com/x", { fetchImpl })).toMatchObject({
      ok: false,
      reason: "timeout",
    });
  });
});

describe("fetchSources", () => {
  it("truncates to the per-session cap and preserves order", async () => {
    const urls = Array.from({ length: 10 }, (_, i) => `https://ul.com/${i}`);
    const fetchImpl = async (u: string) =>
      htmlResponse(`<title>${u}</title><p>body ${u}</p>`);
    const results = await fetchSources(urls, { fetchImpl, concurrency: 3 });
    // default MAX_SOURCES_PER_SESSION = 6
    expect(results).toHaveLength(6);
    expect(results[0]).toMatchObject({ ok: true, url: "https://ul.com/0" });
  });

  it("marks sources unreachable once the budget is exhausted", async () => {
    let t = 1000;
    const now = () => t;
    const fetchImpl = async (u: string) => {
      t += 100; // each fetch advances the clock
      return htmlResponse(`<title>${u}</title><p>x</p>`);
    };
    const urls = ["https://ul.com/a", "https://ul.com/b", "https://ul.com/c"];
    const results = await fetchSources(urls, {
      fetchImpl,
      concurrency: 1,
      budgetMs: 150,
      now,
    });
    // First fetch fits the budget; later ones time out.
    expect(results[0].ok).toBe(true);
    expect(results.some((r) => !r.ok)).toBe(true);
  });
});
