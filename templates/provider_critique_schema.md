# Provider Critique Schema

```json
{
  "providerId": "gemini | claude | openai",
  "agreements": ["string"],
  "disagreements": ["string"],
  "unsupportedClaims": [
    {
      "targetProviderId": "string",
      "claim": "string",
      "reason": "string",
      "recommendedFix": "string"
    }
  ],
  "unsafePhrasesFound": [
    {
      "targetProviderId": "string",
      "phrase": "string",
      "reason": "string",
      "saferAlternative": "string"
    }
  ],
  "missingEvidenceFound": ["string"],
  "recommendedCorrections": ["string"],
  "providerSpecificCritiques": [
    {
      "targetProviderId": "string",
      "strengths": ["string"],
      "weaknesses": ["string"],
      "mustFix": ["string"]
    }
  ],
  "confidenceAdjustment": 0.0
}
```
