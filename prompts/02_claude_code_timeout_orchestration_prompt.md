# Claude Code Timeout / Orchestration Follow-up Prompt

Please focus specifically on timeout, concurrency, partial completion, and round-based orchestration.

The current system must satisfy the following:

1. The session API must return sessionId immediately.
2. AI work must run in a background job or worker-like execution layer.
3. Gemini, Claude, and GPT must run in parallel inside each round.
4. Do not use sequential await between providers.
5. Use Promise.allSettled or an equivalent safe pattern.
6. Each provider call must have an independent timeout.
7. Each round must have a global deadline.
8. The full session must have a session deadline.
9. Provider timeout must be saved as timed_out, not generic failed.
10. If one provider fails or times out, the other providers must continue.
11. If at least two providers succeed in Round 1, proceed to Round 2.
12. If at least two critiques succeed in Round 2, proceed to synthesis.
13. If only one provider succeeds, produce a limited answer with a warning.
14. The UI must show provider status independently.
15. Add mock provider delay/failure configuration.
16. Add tests proving parallel execution.

Please inspect and modify the code accordingly.

Add or improve:
- withTimeout utility
- ProviderExecutionService
- CouncilOrchestrator state transitions
- provider call logs
- round deadline logic
- partial completion logic
- mock provider scenarios
- integration tests

Do not optimize away the Round 2 meeting step. The user explicitly wants:
first, each AI gives its own opinion;
then, the AIs are called again to discuss/critique;
then, a final answer is produced.
