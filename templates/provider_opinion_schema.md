# Provider Opinion Schema

```json
{
  "providerId": "gemini | claude | openai",
  "summary": "string",
  "technicalAssessment": [
    {
      "claim": "string",
      "assessment": "string",
      "confidence": 0.0,
      "basis": "string",
      "missingEvidence": ["string"]
    }
  ],
  "evidenceBackedClaims": ["string"],
  "assumptions": ["string"],
  "missingEvidence": ["string"],
  "risks": [
    {
      "risk": "string",
      "severity": "low | medium | high | critical",
      "reason": "string"
    }
  ],
  "unsafePhrases": [
    {
      "phrase": "string",
      "reason": "string",
      "saferAlternative": "string"
    }
  ],
  "recommendedAnswer": "string",
  "confidenceScore": 0.0,
  "followUpQuestions": ["string"]
}
```
