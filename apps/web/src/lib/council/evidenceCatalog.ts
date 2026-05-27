// Lightweight evidence catalog data + display helpers.
//
// This module is intentionally Zod-free so it can be pulled into the
// client bundle (the home-page readiness panel imports from here). The
// matching Zod schemas live in `evidence.ts` for server-side validation.
//
// SINGLE SOURCE OF TRUTH for:
//   - the list of trust levels
//   - the seed source catalog rows
//   - the short display label for each catalog key
//
// `evidence.ts` re-exports the catalog as `DEFAULT_EVIDENCE_SOURCE_CATALOG`
// after passing it through the Zod schema, so consumers that need a
// validated copy still go through that module.

export const EVIDENCE_TRUST_LEVELS = [
  "uploaded_original",
  "uploaded_copy",
  "official_registry",
  "official_public_page",
  "third_party_reference",
  "unverified_web",
] as const;
export type EvidenceTrustLevel = (typeof EVIDENCE_TRUST_LEVELS)[number];

export type SourceCatalogEntryData = {
  key: string;
  displayName: string;
  scopeNotes: string;
  defaultTrustLevel: EvidenceTrustLevel;
  inclusionWarning: string;
  enabled: boolean;
};

const INCLUSION_WARNING_KO =
  "이 항목이 카탈로그에 포함되었다는 사실 자체로 해당 기관 보고서가 모든 시험 항목 / 모든 클레임에 자동 유효함을 의미하지 않습니다. 각 보고서의 시험 방법, 시험 조건, 인증 범위, 적용 시점 유효성을 KOLAS/KATS 등록부 또는 해당 기관 공식 채널로 사용 시점에 직접 확인해야 합니다.";

/**
 * Seed catalog. Add new KOLAS-accredited laboratories via configuration —
 * do NOT hard-code provider preference here. KCL is one entry among many.
 */
export const EVIDENCE_SOURCE_CATALOG_DATA: readonly SourceCatalogEntryData[] = [
  {
    key: "kolas_kats",
    displayName: "KOLAS / KATS accreditation registry",
    scopeNotes:
      "국가표준 인정기구 / 기술표준원의 공식 등록부. 각 시험소의 인정 범위 / 시험 방법 / 유효 기간을 직접 확인할 수 있습니다.",
    defaultTrustLevel: "official_registry",
    inclusionWarning: INCLUSION_WARNING_KO,
    enabled: true,
  },
  {
    key: "kcl",
    displayName: "한국건설생활환경시험연구원 (KCL)",
    scopeNotes:
      "건축자재, 난연 / 내화 / 환경 / 위생 등 다목적 시험. KS F 등 건축 관련 규격에 자주 인용됨.",
    defaultTrustLevel: "official_public_page",
    inclusionWarning: INCLUSION_WARNING_KO,
    enabled: true,
  },
  {
    key: "ktr",
    displayName: "한국화학융합시험연구원 (KTR)",
    scopeNotes:
      "화학 / 환경 / 화학안전 / 인체 영향 등 화학 분야 시험. SDS / MSDS 관련 검토에 자주 인용됨.",
    defaultTrustLevel: "official_public_page",
    inclusionWarning: INCLUSION_WARNING_KO,
    enabled: true,
  },
  {
    key: "ktc",
    displayName: "한국기계전기전자시험연구원 (KTC)",
    scopeNotes:
      "기계 / 전기 / 전자 / 안전 분야 시험. 자동차 / 배터리 / 가전 등.",
    defaultTrustLevel: "official_public_page",
    inclusionWarning: INCLUSION_WARNING_KO,
    enabled: true,
  },
  {
    key: "fiti",
    displayName: "한국FITI시험연구원 (FITI)",
    scopeNotes: "섬유 / 화학 / 산업용 자재 시험.",
    defaultTrustLevel: "official_public_page",
    inclusionWarning: INCLUSION_WARNING_KO,
    enabled: true,
  },
  {
    key: "katri",
    displayName: "한국의류시험연구원 (KATRI)",
    scopeNotes: "섬유 / 의류 / 산업 자재의 물성 / 화학안전 시험.",
    defaultTrustLevel: "official_public_page",
    inclusionWarning: INCLUSION_WARNING_KO,
    enabled: true,
  },
  {
    key: "kotiti",
    displayName: "KOTITI시험연구원 (KOTITI)",
    scopeNotes: "섬유 / 의류 / 화학 / 환경 시험.",
    defaultTrustLevel: "official_public_page",
    inclusionWarning: INCLUSION_WARNING_KO,
    enabled: true,
  },
  {
    key: "kfi",
    displayName: "한국소방산업기술원 (KFI)",
    scopeNotes:
      "방염 / 내화 / 소방 관련 시험 및 인증. KFI 인정/인증 표기는 발급 범위 내에서만 유효.",
    defaultTrustLevel: "official_public_page",
    inclusionWarning: INCLUSION_WARNING_KO,
    enabled: true,
  },
  {
    key: "kict",
    displayName: "한국건설기술연구원 (KICT)",
    scopeNotes: "건설 자재 / 구조 / 환경 분야 시험 및 연구.",
    defaultTrustLevel: "official_public_page",
    inclusionWarning: INCLUSION_WARNING_KO,
    enabled: true,
  },
  {
    key: "custom",
    displayName: "운영자 추가 KOLAS-accredited laboratory",
    scopeNotes:
      "위 시드 목록에 없는 KOLAS 인정 시험소를 운영자가 sourceCatalog 설정으로 추가하기 위한 자리. enabled=true 로 노출하려면 인정 범위와 displayName 을 운영자가 명시해야 합니다.",
    defaultTrustLevel: "official_public_page",
    inclusionWarning: INCLUSION_WARNING_KO,
    enabled: false,
  },
];

/**
 * Short, screen-friendly label derived from the catalog key. Special-cased
 * for `kolas_kats` which renders with a slash; everything else uses the
 * uppercase of the key.
 */
export function shortSourceLabel(key: string): string {
  if (key === "kolas_kats") return "KOLAS/KATS";
  return key.toUpperCase();
}

/**
 * Display labels for the enabled subset of the catalog.
 *
 * The home-page readiness panel surfaces this list. Because it is derived
 * from `EVIDENCE_SOURCE_CATALOG_DATA`, the UI cannot drift from the
 * catalog: enable a new entry, the label appears; disable one, the label
 * disappears.
 */
export const EVIDENCE_SOURCE_DISPLAY_LABELS: readonly string[] =
  EVIDENCE_SOURCE_CATALOG_DATA.filter((e) => e.enabled).map((e) =>
    shortSourceLabel(e.key),
  );
