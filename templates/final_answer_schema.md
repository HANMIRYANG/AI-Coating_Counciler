# Final Answer Schema

```json
{
  "conclusion": "string",
  "finalMarkdown": "string",
  "businessReadyAnswer": "string",
  "internalMemo": "string",
  "evidenceBackedClaims": ["string"],
  "assumptions": ["string"],
  "missingEvidence": ["string"],
  "unsafePhrases": [
    {
      "phrase": "string",
      "reason": "string",
      "saferAlternative": "string"
    }
  ],
  "recommendedSafeWording": ["string"],
  "riskLevel": "low | medium | high | critical",
  "confidenceScore": 0.0,
  "followUpQuestions": ["string"],
  "unresolvedDisagreements": ["string"],
  "providerParticipation": {
    "round1Succeeded": ["gemini", "claude", "openai"],
    "round2Succeeded": ["gemini", "claude", "openai"],
    "timedOut": [],
    "failed": []
  }
}
```
