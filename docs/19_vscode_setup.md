# 19. VSCode Setup

## 권장 확장

```text
- ESLint
- Prettier
- Prisma
- Tailwind CSS IntelliSense
- GitLens
- Error Lens
```

## Claude Code 사용 순서

1. VSCode에서 폴더 열기
2. Claude Code 실행
3. 아래 파일을 먼저 읽으라고 지시

```text
README.md
CLAUDE.md
docs/03_ai_council_workflow.md
docs/04_timeout_and_parallel_execution_policy.md
docs/05_round_based_orchestration.md
prompts/01_first_claude_code_prompt.md
```

4. `prompts/01_first_claude_code_prompt.md` 전체를 붙여넣기
5. 구현 후 Codex로 검증

---

## 권장 명령어

Claude Code가 실제 프로젝트를 생성한 뒤:

```bash
npm install
npm run dev
npx prisma migrate dev
```

---

## 환경변수

`.env.example`을 `.env`로 복사 후 값을 채웁니다.

개발 초기에는 다음을 권장합니다.

```text
USE_MOCK_PROVIDERS=true
```
