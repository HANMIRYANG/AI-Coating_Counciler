// components.jsx — Shared UI building blocks
// Loaded as a Babel script; exports to window.

const { useState, useEffect, useMemo, useRef, useCallback } = React;

/* ─── Sidebar ───────────────────────────────────────── */
function Sidebar({ view, setView, activeHistoryId, setActiveHistoryId, onNewChat }) {
  const navItems = [
    { id: 'chat',    label: '검토 채팅',            ic: 'Sparkles', count: null },
    { id: 'history', label: '최근 검토 기록',        ic: 'History',  count: HISTORY.length },
    { id: 'docs',    label: '내부 기술자료 관리',    ic: 'Database', count: DOCS.length },
    { id: 'inbox',   label: '업체 발송 답변 보관함', ic: 'Inbox',    count: 24 },
    { id: 'settings',label: '설정',                 ic: 'Settings', count: null },
  ];

  return (
    <aside className="sb">
      <div className="sb-brand">
        <div className="sb-mark"><span>HM</span></div>
        <div className="sb-name">
          <b>특수도료 AI 검토</b>
          <span>HANMIR COATINGS</span>
        </div>
      </div>

      <button className="sb-cta" onClick={onNewChat}>
        <Icons.Plus /> 새 검토 시작
      </button>

      <nav className="sb-nav">
        {navItems.map(it => {
          const IcoCmp = Icons[it.ic];
          return (
            <button
              key={it.id}
              className={'sb-item' + (view === it.id ? ' is-active' : '')}
              onClick={() => setView(it.id)}
            >
              <IcoCmp className="ico" />
              {it.label}
              {it.count != null && <span className="count">{it.count}</span>}
            </button>
          );
        })}
      </nav>

      <div className="sb-section">최근 검토 기록</div>
      <div className="sb-hist">
        {HISTORY.slice(0, 4).map(h => (
          <button
            key={h.id}
            className={'sb-hist-item' + (activeHistoryId === h.id && view === 'chat' ? ' is-active' : '')}
            onClick={() => { setActiveHistoryId(h.id); setView('chat'); }}
          >
            <b>{h.title}</b>
            <span>{h.date}</span>
          </button>
        ))}
        <button className="sb-hist-item" onClick={() => setView('history')}>
          <b style={{color:'rgba(255,255,255,.55)', fontWeight:400, fontSize:'12px'}}>더보기 →</b>
        </button>
      </div>

      <div className="sb-foot">
        <div className="sb-avatar">KH</div>
        <div>
          <b>김한미 기술검토팀</b>
          <span>technical@hanmir.co.kr</span>
        </div>
      </div>
    </aside>
  );
}

/* ─── Topbar ───────────────────────────────────────── */
function Topbar({ title, crumb, status, right }) {
  return (
    <div className="topbar">
      <h1>{title}</h1>
      {crumb && <div className="crumb">/ <b>{crumb}</b></div>}
      <div className="tb-actions">
        {status && (
          <div className="tb-pill"><span className="dot"></span>{status}</div>
        )}
        {right}
        <button className="tb-ic-btn" title="기술자료"><Icons.BookOpen /></button>
        <button className="tb-ic-btn" title="알림"><Icons.Bell /></button>
        <button className="tb-ic-btn" title="계정"><Icons.User /></button>
      </div>
    </div>
  );
}

/* ─── Stepper ───────────────────────────────────────── */
const STEPS = [
  { n: 1, label: 'Gemini',   sub: '의견 생성' },
  { n: 2, label: 'Claude',   sub: '의견 생성' },
  { n: 3, label: 'GPT',      sub: '의견 생성' },
  { n: 4, label: 'AI 회의',  sub: '의견 정리' },
  { n: 5, label: '내부자료', sub: '검증' },
  { n: 6, label: '최종 답변', sub: '생성' },
];

function StepperCard({ current, onJump, done }) {
  return (
    <div className="stepper-card">
      <h3>
        {!done && <span className="pulse"></span>}
        AI 검토 진행 상태
        {done && <span className="done-tag">검토 완료</span>}
      </h3>
      <div className="stepper">
        {STEPS.map((s, i) => {
          const idx = i + 1;
          const state =
            idx < current ? 'is-done' :
            idx === current ? (done ? 'is-done' : 'is-active') :
            'is-pending';
          return (
            <div
              key={s.n}
              className={'step ' + state}
              onClick={() => onJump && onJump(idx)}
            >
              <div className="step-bubble">
                {state === 'is-done' ? <Icons.Check size={14} stroke={2.4}/> : s.n}
              </div>
              <div className="step-label">{s.label}</div>
              <div className="step-sub">{s.sub}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── AI Opinion Card ─────────────────────────────── */
function AiOpinionCard({ kind, name, version, opinion, state }) {
  // state: 'pending' | 'streaming' | 'done'
  const cls =
    'ai-card' +
    (state === 'pending' ? ' is-pending' : '') +
    (state === 'streaming' ? ' is-streaming' : '');
  return (
    <div className={cls}>
      <div className="ai-card-h">
        <div className="ai-mark">{aiAvatar(kind)}</div>
        <b>{name} 의견</b>
        <span className="ver">{version}</span>
      </div>

      {state === 'pending' && (
        <div className="ai-section">
          <div className="ai-streaming"><i></i><i></i><i></i></div>
          <div style={{color:'var(--ink-400)', fontSize:'12px'}}>대기 중…</div>
        </div>
      )}

      {state === 'streaming' && (
        <div className="ai-section">
          <div className="lbl">의견 생성 중</div>
          <div style={{display:'flex', flexDirection:'column', gap:6}}>
            <span className="skel" style={{width:'88%'}}></span>
            <span className="skel" style={{width:'72%'}}></span>
            <span className="skel" style={{width:'80%'}}></span>
            <span className="skel" style={{width:'60%'}}></span>
          </div>
        </div>
      )}

      {state === 'done' && (
        <>
          <div className="ai-section">
            <div className="lbl">주요 주장</div>
            <ul>{opinion.main.map((t,i)=><li key={i}>{t}</li>)}</ul>
          </div>
          <div className="ai-section">
            <div className="lbl">주의할 표현</div>
            <ul>{opinion.caution.map((t,i)=><li key={i}>{t}</li>)}</ul>
          </div>
          <div className="ai-section">
            <div className="lbl">검증 필요 항목</div>
            <ul>{opinion.verify.map((t,i)=><li key={i}>{t}</li>)}</ul>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Meeting / Synthesis Card ──────────────────────── */
function SynthCard({ meeting }) {
  return (
    <div className="synth-card fade-in">
      <div className="synth-h">
        <Icons.Users size={18} />
        <b>AI 회의 결과</b>
        <span className="badge solid" style={{background:'rgba(255,255,255,.13)', borderColor:'rgba(255,255,255,.18)'}}>3개 AI 합의</span>
      </div>
      <div className="synth-grid">
        <div className="synth-col">
          <div className="lbl"><span className="lbl-dot"></span>공통점</div>
          <ul>{meeting.common.map((t,i)=><li key={i}>{t}</li>)}</ul>
        </div>
        <div className="synth-col">
          <div className="lbl"><span className="lbl-dot"></span>차이점</div>
          <ul>{meeting.diff.map((t,i)=><li key={i}>{t}</li>)}</ul>
        </div>
        <div className="synth-col">
          <div className="lbl"><span className="lbl-dot"></span>최종 판단</div>
          <div className="synth-judgment">{meeting.judgment}</div>
        </div>
      </div>
    </div>
  );
}

/* ─── Verify Card ─────────────────────────────────── */
function VerifyCard({ verifyRows, fadeIn }) {
  return (
    <div className={'verify-card' + (fadeIn ? ' fade-in' : '')}>
      <div className="verify-h">
        <Icons.ShieldCheck size={18} />
        <b>내부 기술자료 검증 결과</b>
        <span className="sub">· 6개 항목 검증</span>
        <span className="status">
          <Icons.Check size={11} stroke={2.6}/> 검증 완료
        </span>
      </div>
      <div className="verify-body">
        <div className="verify-rows">
          {verifyRows.map((r, i) => {
            const IcoCmp = Icons[r.ic];
            return (
              <div className="verify-row" key={i}>
                <div className="row-ic"><IcoCmp /></div>
                <div className="row-lbl">
                  <b>{r.label}</b>
                  {r.sub}
                </div>
                <div className="row-val">{r.v}</div>
                <div className="row-chk">
                  {r.ok ? <Icons.CheckCircle /> : <Icons.AlertTriangle />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="verify-summary">
          <div className="verify-shield"><Icons.ShieldCheck /></div>
          <h4>검증 완료</h4>
          <p>내부 기술자료와 일치하며,<br/>표현에 유의사항이 없습니다.</p>
          <div className="verify-meta">
            <div>
              <span className="l">검증 일시</span>
              <span className="v">2026-05-26 14:42</span>
            </div>
            <div>
              <span className="l">담당자</span>
              <span className="v">기술검토팀</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Final Answer Card ───────────────────────────── */
function FinalAnswerCard({ fadeIn, paragraphs }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className={'final-wrap' + (fadeIn ? ' fade-in' : '')}>
      {/* Fitness */}
      <div className="fitness-card">
        <div className="fitness-left">
          <div className="fitness-shield"><Icons.ShieldCheck /></div>
          <div className="fitness-text">
            <b>발송 가능</b>
            <span>내부 기술자료 검증 완료 및 표현 적합</span>
          </div>
        </div>
        <div className="fitness-checks">
          <div><Icons.Check stroke={2.6} /> 내부 검증 완료</div>
          <div><Icons.Check stroke={2.6} /> 표현 적합</div>
          <div><Icons.Check stroke={2.6} /> 과장 표현 없음</div>
        </div>
      </div>

      {/* Answer */}
      <div className="answer-card">
        <div className="answer-h">
          <Icons.FileText size={16}/>
          <b>최종 답변 (업체 발송용)</b>
          <span className="meta">DRAFT-2026-0526-014</span>
        </div>
        <div className="answer-body">
          {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
        </div>
        <div className="answer-actions">
          <button className="btn" onClick={handleCopy}>
            <Icons.Copy /> {copied ? '복사됨' : '복사하기'}
          </button>
          <button className="btn"><Icons.Mail /> 메일용으로 변환</button>
          <button className="btn"><Icons.Download /> PDF 저장</button>
          <button className="btn primary" style={{marginLeft:'auto'}}>
            <Icons.Users /> 내부 검토 요청
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Composer ───────────────────────────────────── */
function Composer({ value, setValue, onSend, disabled, placeholder }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [value]);

  const send = () => {
    if (!value.trim() || disabled) return;
    onSend(value.trim());
  };

  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          ref={ref}
          value={value}
          placeholder={placeholder || '질문을 입력하세요…'}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
        />
        <div className="composer-actions">
          <button className="composer-chip"><Icons.Paperclip /> 파일 첨부</button>
          <button className="composer-chip"><Icons.Database /> 내부 자료 참조</button>
          <button className="composer-chip"><Icons.Sparkles /> 톤 가이드</button>
          <button className="composer-send" onClick={send} disabled={disabled || !value.trim()}>
            <Icons.Send />
          </button>
        </div>
      </div>
      <div className="composer-hint">
        <span>3개의 AI가 의견을 교환한 후 내부 기술자료와 대조하여 답변합니다.</span>
        <span><kbd>Enter</kbd> 전송 · <kbd>Shift + Enter</kbd> 줄바꿈</span>
      </div>
    </div>
  );
}

Object.assign(window, {
  Sidebar, Topbar, StepperCard, AiOpinionCard, SynthCard, VerifyCard,
  FinalAnswerCard, Composer, STEPS,
});
