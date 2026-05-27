// Prompt builders for each round.
//
// Every prompt enforces:
//   - Korean output
//   - strict JSON-only response (no prose outside the JSON object)
//   - the domain safety policy (no 단정 표현)
//   - clear schema separation between evidence / assumption / missing / risk

import type {
  CritiqueInput,
  InitialOpinionInput,
  SynthesisInput,
  TaskType,
} from "./types";
import { DOMAIN_SAFETY_POLICY_SUMMARY, UNSAFE_PHRASES_KO } from "./safety";

const JSON_RULES_KO = `반드시 다음 규칙을 지키세요.
- 응답은 오직 단 하나의 JSON 객체여야 합니다. 그 외 텍스트(설명, 인사, 코드블록 표시)를 포함하지 마세요.
- 누락 필드가 없도록 모든 키를 채우세요. 빈 항목은 빈 배열 [] 또는 빈 문자열 ""을 사용하세요.
- 한국어로 응답하세요.
- 단정·과장 표현을 사용하지 마세요. 위험 표현은 unsafePhrases 필드로 분리하세요.`;

export const KNOWN_DANGEROUS_PHRASES_LIST = UNSAFE_PHRASES_KO.join(", ");

/**
 * Per-taskType behavior guidance.
 *
 * The Round 1/2/3 JSON schemas stay the same across task types. What
 * changes is HOW the AI uses those fields. This helper returns a Korean
 * guidance block that the prompt builders inline into the system prompt.
 *
 * Safety guardrails (`computeRiskLevel`, `detectUnsafePhrases`) are NOT
 * weakened for any task type — ideation may propose options, but it must
 * never make certified performance / regulatory claims without evidence.
 */
export function taskTypeGuidance(taskType: TaskType): string {
  switch (taskType) {
    case "application_ideas":
      return `taskType=application_ideas (아이디어 모드)
- 이 모드의 목적은 새로운 코팅 적용 아이디어/사용 사례/실험 계획을 탐색하는 것입니다.
- 단정적 성능 주장이나 인증 표현은 절대 만들지 마세요. 모든 아이디어는 "검토 필요 / 가설 단계" 어조로 작성하세요.
- 다음 필드를 다음과 같이 사용하세요:
  * technicalAssessment: 각 아이디어를 (topic="아이디어 N", detail="대상 적용처 + 기대 효과 + 다음 실험") 형태로 정리.
  * evidenceBackedClaims: 사용자가 명시적으로 제공한 사실에 한정.
  * assumptions: 가능성 / 가설 / 추정. 단정 표현 금지.
  * missingEvidence: 이 아이디어를 입증하기 위해 추가로 필요한 시험/규격/기재 호환성 항목.
  * risks: 안전, 인증, 법령, 시장 위험을 severity와 함께.
  * recommendedAnswer: 추천 아이디어 1~3개와 "다음 실험 1단계"를 짧게.
  * followUpQuestions: 사용자에게 다시 물어봐야 할 핵심 정보.
- 고위험 카테고리(불연/난연/배터리/화재/인증/식품/SDS)에서는 아이디어라도 "현재 자료로는 단정 불가" 를 명시하세요.`;

    case "test_report_interpretation":
      return `taskType=test_report_interpretation (시험성적서 해석 모드)
- 사용자가 시험성적서/시험 결과 표현을 인용 가능한 안전 문구로 정리해 달라고 요청한 모드입니다.
- 다음을 반드시 분리하세요:
  * 시험 방법(test method), 시험 규격(standard code), 시험 조건(온도/습도/시간/하중),
    기재(substrate), 도포 두께(coating thickness), 결과의 적용 범위 / 한계.
- evidenceBackedClaims에는 사용자가 제공한 성적서 텍스트에서 직접 인용 가능한 항목만 넣으세요.
- missingEvidence에는 시험 조건, 적용 범위, 인증 범위 등 누락 정보를 명시하세요.
- recommendedAnswer는 외부에 인용 가능한 "안전한 표현" 1~2개 예시를 제공하세요.
  ("KS F 2271 30분 내화 시험 기준에서 ~ 확인" 처럼 출처/조건을 동반).
- 단정 표현(예: "완전 방지", "영구", "100%")은 반드시 unsafePhrases로 분리하세요.`;

    case "certification_checklist":
      return `taskType=certification_checklist (인증/규격 체크리스트 모드)
- 사용자가 특정 적용 분야에 대해 어떤 인증/규격/시험이 필요한지 정리를 요청한 모드입니다.
- technicalAssessment를 체크리스트 형태로 사용하세요. 각 항목 topic은 규격/인증 이름, detail은 충족 조건과 발급 기관.
- evidenceBackedClaims에는 사용자가 이미 보유한 인증/시험성적서만 포함하세요.
- missingEvidence에는 누락된 필수 인증, 누락된 시험 항목, 누락된 사용 환경 정보를 명시하세요.
  미보유 인증은 절대 "보유" 또는 "확보됨" 같은 단정 표현을 사용하지 마세요.
- recommendedAnswer는 "확보 우선순위 + 인증기관 확인 필요" 어조로 작성하세요.
- 인증 발급 여부, 법령 적합성, 안전 보증은 모두 "인증기관 확인 필요" 로 표현하고 unsafePhrases에 단정 표현이 포함되었는지 점검하세요.`;

    case "document_based_answer":
      return `taskType=document_based_answer (문서 기반 답변 모드)
- 이 모드는 사내 기술자료/시험성적서 등 업로드 문서를 근거로 답변하도록 설계되었습니다.
- 그러나 현재 시스템은 RAG/문서 검색/외부 출처 조회를 아직 구현하지 않았습니다.
  (evidenceMode가 internal_docs 또는 internal_docs_web 이라도 실제 문서 컨텍스트는 전달되지 않습니다.)
- 따라서 이 모드에서는 다음을 반드시 지키세요:
  * evidenceBackedClaims는 사용자가 프롬프트 본문에 직접 적어준 사실에 한정.
  * missingEvidence의 첫 항목은 "사내 문서가 업로드/검색되지 않아 근거가 부족합니다" 로 시작하세요.
  * recommendedAnswer는 "문서가 첨부되면 다시 검토 필요" 어조로 작성하세요.
  * 단정 표현 금지. 임의의 시험 수치/인증 번호를 만들어내지 마세요.`;

    case "risky_phrase_review":
      return `taskType=risky_phrase_review (위험 표현 검토 모드)
- 사용자가 제출한 문구에서 단정/과장/인증 단정 표현을 탐지하고 안전한 대체 표현을 제안하세요.
- unsafePhrases에 발견된 모든 위험 표현을 phrase + reason + recommended 형태로 채우세요.
- recommendedAnswer는 같은 문구의 "안전 버전" 다시 쓰기 예시 1~2개를 제공하세요.
- 평가 결과 위험 표현이 없을 경우에도 unsafePhrases를 [] 로 두고 그 사유를 followUpQuestions에 남기세요.`;

    case "customer_reply":
      return `taskType=customer_reply (업체 답변 작성 모드)
- 외부 업체/고객에게 발송할 정돈된 답변 초안을 작성하세요.
- recommendedAnswer는 외부 발송용 문장으로 작성하되, 시험 조건과 자료 출처를 명시한 한정 표현으로만 작성하세요.
- evidenceBackedClaims/assumptions/missingEvidence 분리를 더 보수적으로 수행하세요.
- 단정 표현은 unsafePhrases로 분리하고, 발송 전 사람 검토가 필요함을 followUpQuestions에 명시하세요.`;

    case "proposal_copy":
      return `taskType=proposal_copy (제안서 문구 작성 모드)
- 제안서 / 카탈로그용 문장을 작성하되, 광고법 / 인증 단정 / 안전 단정 표현을 사용하지 마세요.
- 성능 수치 인용 시 반드시 시험 조건과 시험성적서 번호 출처를 같이 명시하세요.
- 출처/조건 명시가 불가능한 수치는 evidenceBackedClaims가 아닌 assumptions에 두세요.`;

    case "technical_review":
    default:
      return `taskType=technical_review (기술 검토 모드)
- 사용자의 적용 요청을 기존 자료 기준으로 보수적으로 평가하세요.
- evidenceBackedClaims, assumptions, missingEvidence, risks를 명확히 분리하세요.
- 단정 표현은 unsafePhrases로 분리하고, recommendedAnswer는 시험 조건/적용 범위를 동반한 한정 표현으로 작성하세요.`;
  }
}

export function buildInitialOpinionMessages(
  providerLabel: string,
  input: InitialOpinionInput,
) {
  const system = `${DOMAIN_SAFETY_POLICY_SUMMARY}

당신은 한국 특수도료/기능성 코팅제 제조사의 기술검토팀 보조 AI(${providerLabel})입니다.
사용자 질문에 대해 다른 AI의 영향을 받지 않고 독립 의견을 작성하세요.

${taskTypeGuidance(input.taskType)}

${JSON_RULES_KO}

응답 JSON 스키마:
{
  "providerId": "openai" | "anthropic" | "gemini",
  "summary": string,
  "technicalAssessment": [{ "topic": string, "detail": string }],
  "evidenceBackedClaims": string[],
  "assumptions": string[],
  "missingEvidence": string[],
  "risks": [{ "description": string, "severity": "low"|"medium"|"high"|"critical" }],
  "unsafePhrases": [{ "phrase": string, "reason"?: string, "recommended"?: string }],
  "recommendedAnswer": string,
  "confidenceScore": number,
  "followUpQuestions": string[]
}

특히 다음 한국어 표현은 unsafePhrases에 반드시 포함하세요: ${KNOWN_DANGEROUS_PHRASES_LIST}`;

  const user = `taskType: ${input.taskType}
evidenceMode: ${input.evidenceMode}
사용자 질문:
${input.userPrompt}`;

  return { system, user };
}

export function buildCritiqueMessages(
  providerLabel: string,
  input: CritiqueInput,
) {
  const opinionsBlock = input.opinions
    .map(
      (o, i) =>
        `--- 의견 #${i + 1} from ${o.providerId} ---\nsummary: ${o.summary}\nrecommendedAnswer: ${o.recommendedAnswer}\nevidenceBackedClaims: ${JSON.stringify(o.evidenceBackedClaims)}\nassumptions: ${JSON.stringify(o.assumptions)}\nmissingEvidence: ${JSON.stringify(o.missingEvidence)}\nunsafePhrases: ${JSON.stringify(o.unsafePhrases)}`,
    )
    .join("\n\n");

  const system = `${DOMAIN_SAFETY_POLICY_SUMMARY}

당신은 한국 특수도료/기능성 코팅제 제조사의 기술검토 회의 참여 AI(${providerLabel})입니다.
다른 AI의 Round 1 의견을 검토하고, 회의록 형태의 비판/보강 의견을 작성하세요.
스스로의 이전 의견도 비판 대상입니다.

${taskTypeGuidance(input.taskType)}

${JSON_RULES_KO}

응답 JSON 스키마:
{
  "providerId": "openai" | "anthropic" | "gemini",
  "agreements": string[],
  "disagreements": string[],
  "unsupportedClaims": [{ "claim": string, "attributedTo"?: "openai"|"anthropic"|"gemini", "reason"?: string }],
  "unsafePhrasesFound": [{ "phrase": string, "reason"?: string, "recommended"?: string }],
  "missingEvidenceFound": string[],
  "recommendedCorrections": string[],
  "providerSpecificCritiques": [{ "targetProviderId": "openai"|"anthropic"|"gemini", "critique": string }],
  "confidenceAdjustment": number
}

위험 표현은 ${KNOWN_DANGEROUS_PHRASES_LIST} 등이 포함되어 있는지 반드시 점검하세요.`;

  const user = `taskType: ${input.taskType}
사용자 질문:
${input.userPrompt}

다른 AI들의 Round 1 의견:
${opinionsBlock}`;

  return { system, user };
}

export function buildSynthesisMessages(
  providerLabel: string,
  input: SynthesisInput,
) {
  const opinionsBlock = input.opinions
    .map(
      (o, i) =>
        `--- 의견 #${i + 1} from ${o.providerId} ---\n${JSON.stringify(o, null, 2)}`,
    )
    .join("\n\n");

  const critiquesBlock = input.critiques
    .map(
      (c, i) =>
        `--- 비판 #${i + 1} from ${c.providerId} ---\n${JSON.stringify(c, null, 2)}`,
    )
    .join("\n\n");

  const system = `${DOMAIN_SAFETY_POLICY_SUMMARY}

당신은 한국 특수도료/기능성 코팅제 제조사의 기술검토 회의 최종 합성 AI(${providerLabel})입니다.
Round 1 의견과 Round 2 비판을 종합하여 다음 두 가지 답변을 만드세요.
1) 업체 발송용(businessReadyAnswer): 외부 고객사에게 보낼 수 있는 정돈된 문장.
2) 내부 검토 메모(internalMemo): 근거/추정/누락/위험 표현을 명확히 분리.

${taskTypeGuidance(input.taskType)}

${JSON_RULES_KO}

응답 JSON 스키마:
{
  "conclusion": string,
  "finalMarkdown": string,
  "businessReadyAnswer": string,
  "internalMemo": string,
  "evidenceBackedClaims": string[],
  "assumptions": string[],
  "missingEvidence": string[],
  "unsafePhrases": [{ "phrase": string, "reason"?: string, "recommended"?: string }],
  "recommendedSafeWording": string[],
  "riskLevel": "low"|"medium"|"high"|"critical",
  "confidenceScore": number,
  "followUpQuestions": string[],
  "unresolvedDisagreements": string[],
  "providerSummary": [{ "providerId": "openai"|"anthropic"|"gemini", "status": string, "latencyMs"?: number }]
}`;

  const user = `taskType: ${input.taskType}
사용자 질문:
${input.userPrompt}

Round 1 의견:
${opinionsBlock}

Round 2 비판:
${critiquesBlock}`;

  return { system, user };
}

/**
 * Thrown when no parseable JSON object can be extracted from raw LLM output.
 * Carries the original raw text so the orchestrator can persist it on the
 * call record for debugging.
 */
export class JsonParseError extends Error {
  constructor(
    message: string,
    public readonly rawText: string,
  ) {
    super(message);
    this.name = "JsonParseError";
  }
}

/**
 * Thrown by provider adapters when the LLM responded with valid JSON but the
 * shape did not satisfy the Zod schema. Carries both raw text and the
 * partially-parsed JSON so the call record can show both.
 */
export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly rawText: string,
    public readonly parsed: unknown,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

/**
 * Balanced JSON object extraction.
 *
 * Strategy (in order):
 *   1. Look for ```json``` / ``` ``` fences. Try every fence body in
 *      document order; the first one that yields a balanced JSON object
 *      wins. This handles "first code fence is non-JSON, second one is".
 *   2. Otherwise scan the entire text for the first balanced `{...}`.
 *
 * Brace-balancing is string- and escape-aware, so JSON values like
 * `"unterminated"}` inside a string do NOT confuse depth counting.
 *
 * Tolerates one common LLM quirk: trailing commas before `}` / `]`.
 *
 * Throws `JsonParseError` (with the original raw text) on failure so the
 * orchestrator can classify the call as `schema_invalid` and persist the raw
 * text for offline debugging.
 */
export function extractJsonObject(raw: string): {
  raw: string;
  parsed: unknown;
} {
  if (!raw || !raw.trim()) {
    throw new JsonParseError("empty response", raw ?? "");
  }

  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  const fenceBodies: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = fenceRegex.exec(raw)) !== null) fenceBodies.push(m[1]);

  const candidates: string[] = [];
  for (const body of fenceBodies) {
    const balanced = findBalancedJsonObject(body);
    if (balanced) candidates.push(balanced);
  }
  // Whole-text fallback comes last so fence content is preferred.
  const whole = findBalancedJsonObject(raw);
  if (whole) candidates.push(whole);

  if (candidates.length === 0) {
    throw new JsonParseError("no JSON object found in response", raw);
  }

  let lastError: unknown;
  for (const body of candidates) {
    try {
      return { raw, parsed: JSON.parse(stripTrailingCommas(body)) };
    } catch (err) {
      lastError = err;
    }
  }
  throw new JsonParseError(
    lastError instanceof Error
      ? `JSON.parse failed: ${lastError.message}`
      : "JSON.parse failed",
    raw,
  );
}

/**
 * Walk `text` to find the first substring `{...}` whose braces balance,
 * respecting string boundaries and `\\` escapes. Returns null if none found.
 */
function findBalancedJsonObject(text: string): string | null {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;

    let depth = 0;
    let inString = false;
    let escape = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (inString) {
        if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return text.slice(i, j + 1);
      }
    }
  }
  return null;
}

function stripTrailingCommas(s: string): string {
  // Only strip commas that are immediately followed by ] or } (ignoring whitespace).
  return s.replace(/,(\s*[}\]])/g, "$1");
}
