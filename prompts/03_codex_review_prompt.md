# Codex Review Prompt

Review this project as a senior TypeScript architect and AI safety reviewer.

Project:
ai-coating-council-starter

The system is a B2B technical review app for functional/special paints and coatings. It uses Gemini, Claude, and GPT in a round-based AI council workflow.

Review the following:

1. Architecture
- Is the Provider Adapter pattern correctly implemented?
- Are API keys only used server-side?
- Is the frontend separated from provider logic?
- Is Prisma schema appropriate for round-based AI sessions?

2. AI Workflow
- Does the system use Round 1 independent opinions?
- Does the system use Round 2 meeting/cross-critique?
- Does the system use Round 3 final synthesis?
- Does it avoid one-shot final answer generation?

3. Safety
- Are evidence-backed claims separated from assumptions?
- Are missing evidence fields required?
- Are unsafe phrases detected?
- Are fireproofing/certification/legal claims handled carefully?
- Are business-ready answer and internal memo separated?

4. Data Persistence
- Are raw responses saved?
- Are parsed JSON responses saved?
- Are schema validation failures logged?
- Are provider latencies and statuses logged?

5. UI
- Can the user see each AI's opinion?
- Can the user see the meeting/critique phase?
- Can the user see final answer, missing evidence, and unsafe phrases?

Return:
- Critical issues
- Medium issues
- File-by-file recommended fixes
- Test plan
- Safety risk assessment
