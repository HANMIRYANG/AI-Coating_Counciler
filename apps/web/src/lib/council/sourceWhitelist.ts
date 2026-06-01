// Official-domain → trust-level whitelist for external source fetch
// (internal_docs_web). Operator-curated; matches host EXACTLY or as a dotted
// suffix (subdomains included). Anything not listed resolves to
// "unverified_web" — NOT business-citable (internal reference only).
//
// Trust levels feed docs/23 citability rules via evidence.ts helpers
// (isBusinessCitableTrustLevel / canUseEvidenceInBusinessAnswer).

import type { EvidenceTrustLevel } from "./evidenceCatalog";

export const OFFICIAL_DOMAIN_TRUST: Record<string, EvidenceTrustLevel> = {
  // 인정·표준 등록부 / 법령 → official_registry (최상위, 인용 가능)
  "knab.go.kr": "official_registry", // KOLAS 한국인정기구
  "kats.go.kr": "official_registry", // KATS 국가기술표준원
  "standard.go.kr": "official_registry", // e-나라 표준인증 / KS 포털
  "law.go.kr": "official_registry", // 국가법령정보센터

  // 국내 시험·인증 기관 → official_public_page (조건부 인용 가능)
  "kcl.re.kr": "official_public_page", // KCL
  "ktr.or.kr": "official_public_page", // KTR
  "ktc.re.kr": "official_public_page", // KTC
  "fiti.re.kr": "official_public_page", // FITI
  "katri.re.kr": "official_public_page", // KATRI
  "kotiti-global.com": "official_public_page", // KOTITI
  "kfi.or.kr": "official_public_page", // KFI 한국소방산업기술원
  "kict.re.kr": "official_public_page", // KICT 한국건설기술연구원

  // 화학안전 / 소방 / 산업안전 (국내) → official_public_page
  "mcee.go.kr": "official_public_page", // 화학물질안전원 (icis./nics.mcee.go.kr)
  "kosha.or.kr": "official_public_page", // 산업안전보건공단 (MSDS)
  "nfa.go.kr": "official_public_page", // 소방청

  // 국제 규격·화학안전 기관 → official_public_page
  "ul.com": "official_public_page", // UL Solutions (UL 94 등)
  "astm.org": "official_public_page", // ASTM International
  "iso.org": "official_public_page", // ISO
  "iec.ch": "official_public_page", // IEC
  "nfpa.org": "official_public_page", // NFPA
  "unece.org": "official_public_page", // UNECE (UN 38.3 / GHS)
  "echa.europa.eu": "official_public_page", // ECHA (REACH/CLP)
};

/** Resolve a hostname to its whitelist trust level (default unverified_web). */
export function trustLevelForHost(host: string): EvidenceTrustLevel {
  const h = host
    .toLowerCase()
    .replace(/^\[|\]$/g, "") // strip IPv6 brackets
    .replace(/\.$/, ""); // strip trailing dot
  for (const [domain, trust] of Object.entries(OFFICIAL_DOMAIN_TRUST)) {
    if (h === domain || h.endsWith(`.${domain}`)) return trust;
  }
  return "unverified_web";
}

/** Resolve a URL to its whitelist trust level (default unverified_web). */
export function trustLevelForUrl(url: string): EvidenceTrustLevel {
  try {
    return trustLevelForHost(new URL(url).hostname);
  } catch {
    return "unverified_web";
  }
}
