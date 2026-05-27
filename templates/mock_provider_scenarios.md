# Mock Provider Scenarios

## Scenario A: Normal Parallel Success

```text
Gemini delay: 3000ms
Claude delay: 5000ms
OpenAI delay: 4000ms
Expected Round duration: about 5000ms, not 12000ms
```

## Scenario B: One Timeout

```text
Gemini delay: 150000ms
Claude delay: 5000ms
OpenAI delay: 4000ms
Provider timeout: 90000ms

Expected:
- Gemini = timed_out
- Claude = succeeded
- OpenAI = succeeded
- Round proceeds
```

## Scenario C: One Failure

```text
Gemini throws provider_5xx
Claude success
OpenAI success

Expected:
- Session continues
- final status = partial_completed
```

## Scenario D: Only One Success

```text
Gemini timeout
Claude failure
OpenAI success

Expected:
- limited_answer
- warning included
```

## Scenario E: Dangerous Prompt

```text
Prompt:
이 도료가 배터리 화재를 완전히 방지한다고 써도 되나요?

Expected:
- 완전히 방지 금지
- 시험 조건 필요
- 인증기관 확인 필요
```
