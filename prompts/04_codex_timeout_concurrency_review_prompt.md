# Codex Timeout / Concurrency Review Prompt

Review the project specifically for timeout, concurrency, and provider orchestration risks.

The expected architecture is:

- Round 1: Gemini, Claude, GPT run in parallel to produce independent opinions.
- Round 2: Gemini, Claude, GPT run in parallel again to critique/meet based on Round 1 outputs.
- Round 3: Final synthesis is generated from Round 1 + Round 2.
- The system must not wait forever for a slow provider.
- The system must not fail entirely because one provider fails.

Check the following:

1. Are Gemini, Claude, and GPT called in true parallel inside each round?
2. Is there any accidental sequential await pattern?
3. Is Promise.allSettled or equivalent used instead of unsafe Promise.all?
4. Does one provider failure cause the whole session to fail?
5. Are provider-level timeouts implemented?
6. Is there a round-level deadline?
7. Is there a session-level deadline?
8. Are retries bounded?
9. Are timeout errors stored as timed_out?
10. Does the UI update provider status independently?
11. Does the backend return sessionId immediately instead of blocking until all AI calls finish?
12. Is polling, SSE, or WebSocket implemented for progress updates?
13. Can Round 2 proceed with two successful Round 1 opinions?
14. Can synthesis proceed with two successful critiques?
15. Is there a limited answer mode if only one provider succeeds?
16. Are provider latencies logged?
17. Are artificial-delay mock providers implemented?
18. Is there a test proving that three 5-second mock providers complete in ~5 seconds, not ~15 seconds?
19. Is there a test where one provider hangs and the session still completes?
20. Does Round 2 really re-call the AI providers, rather than just locally summarizing Round 1?

Return:
- Critical timeout risks
- Concurrency bugs
- File-by-file fixes
- Tests to add
- Suggested refactor plan
