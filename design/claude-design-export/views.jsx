// views.jsx — Top-level screens
// Loaded as a Babel script; exports to window.

const { useState: useStateV, useEffect: useEffectV, useRef: useRefV } = React;

/* ─── Chat View — the primary screen ──────────────────
   Walks through 6 stages of AI review with realistic timing.
   stage values:
     0 = empty / suggestions
     1..3 = each AI generating
     4 = meeting synthesis
     5 = verifying
     6 = final answer ready
*/

function ChatView({ initialPrompt, autorun, tweaks }) {
  const [stage, setStage] = useStateV(initialPrompt ? 1 : 0);
  const [composerVal, setComposerVal] = useStateV('');
  const [question, setQuestion] = useStateV(initialPrompt || '');
  const [questionTime, setQuestionTime] = useStateV('14:30');
  const scrollerRef = useRefV(null);

  // re-init when initialPrompt changes (sidebar history switch)
  useEffectV(() => {
    setQuestion(initialPrompt || '');
    setStage(initialPrompt ? (autorun === false ? 6 : 1) : 0);
  }, [initialPrompt]);

  // Auto-advance stages
  useEffectV(() => {
    if (!autorun) return;
    if (stage === 0 || stage >= 6) return;
    const timings = { 1: 1400, 2: 1600, 3: 1400, 4: 1800, 5: 1600 };
    const t = setTimeout(() => setStage(s => Math.min(6, s + 1)), timings[stage] || 1800);
    return () => clearTimeout(t);
  }, [stage, autorun]);

  // Smooth-scroll when stage changes
  useEffectV(() => {
    if (!scrollerRef.current) return;
    setTimeout(() => {
      scrollerRef.current.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' });
    }, 80);
  }, [stage]);

  const handleSend = (text) => {
    setQuestion(text);
    setComposerVal('');
    const now = new Date();
    setQuestionTime(now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0'));
    setStage(1);
  };

  // Stage helpers
  const aiState = (n) => stage < n ? 'pending' : stage === n ? 'streaming' : 'done';

  const stagesDone = stage >= 6;
  const currentStep = Math.min(6, stage);

  return (
    <>
      <Topbar
        title="새 검토 시작"
        crumb={question ? '진행 중인 검토' : null}
        status={stage > 0 && stage < 6 ? STEPS[currentStep-1]?.label + ' 단계 진행 중' : (stagesDone ? '업체 발송 준비 완료' : null)}
      />

      <div className="content" ref={scrollerRef}>
        <div className="container">

          {/* Empty state */}
          {stage === 0 && (
            <>
              <div className="hero">
                <div className="mark"><span>HM</span></div>
                <h2>특수도료 AI 검토 시스템</h2>
                <p>
                  특수도료·불연·단열·차열·방오 코팅 관련 질문을 입력하면,<br/>
                  3개의 AI가 회의하여 내부 기술자료 기준으로 검증된 답변을 생성합니다.
                </p>
              </div>

              <div className="section-title">
                <h2>예시 검토 시작</h2>
                <span className="sub">자주 묻는 업체 문의 유형</span>
              </div>
              <div className="suggestions">
                {SUGGESTIONS.map((s, i) => {
                  const IcoCmp = Icons[s.ic];
                  return (
                    <button key={i} className="sugg" onClick={() => handleSend(SAMPLE_Q)}>
                      <div className="ico"><IcoCmp /></div>
                      <div>
                        <b>{s.title}</b>
                        <span>{s.sub}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* Conversation */}
          {stage > 0 && (
            <div className="chat">
              {/* user bubble */}
              <div className="msg msg-user fade-in">
                <div className="bubble">
                  <div>{question}</div>
                  <div className="msg-meta"><span className="who">기술검토팀</span><span className="time">{questionTime}</span></div>
                </div>
              </div>

              {/* system stepper */}
              <div className="msg msg-system fade-in">
                <div className="avatar-sys"><span>HM</span></div>
                <div className="bubble">
                  <div className="msg-meta">
                    <span className="who">특수도료 AI 검토 시스템</span>
                    <span className="time">방금 전</span>
                  </div>
                  <StepperCard current={currentStep} done={stagesDone} />

                  {/* AI cards appear from stage 1 onward */}
                  {stage >= 1 && (
                    <div className="ai-grid">
                      <AiOpinionCard
                        kind="gemini" name="Gemini" version="2.5 Pro"
                        opinion={AI_OPINIONS.gemini}
                        state={aiState(1)}
                      />
                      <AiOpinionCard
                        kind="claude" name="Claude" version="Sonnet 4.5"
                        opinion={AI_OPINIONS.claude}
                        state={aiState(2)}
                      />
                      <AiOpinionCard
                        kind="gpt" name="GPT" version="5 Turbo"
                        opinion={AI_OPINIONS.gpt}
                        state={aiState(3)}
                      />
                    </div>
                  )}

                  {/* Meeting synthesis at stage >= 4 */}
                  {stage >= 4 && <SynthCard meeting={MEETING} />}

                  {/* Verify at stage >= 5 */}
                  {stage >= 5 && <VerifyCard verifyRows={VERIFY} fadeIn />}

                  {/* Final answer at stage >= 6 */}
                  {stage >= 6 && (
                    <FinalAnswerCard paragraphs={FINAL_ANSWER} fadeIn />
                  )}

                  {/* Status footer when mid-stream */}
                  {stage > 0 && stage < 6 && (
                    <div style={{marginTop:14, padding:'12px 14px', background:'var(--navy-50)',
                      border:'1px solid var(--navy-200)', borderRadius:8, fontSize:12.5,
                      color:'var(--navy-900)', display:'flex', alignItems:'center', gap:10}}>
                      <span className="ai-streaming" style={{padding:0}}>
                        <i style={{background:'var(--navy-900)'}}></i>
                        <i style={{background:'var(--navy-900)'}}></i>
                        <i style={{background:'var(--navy-900)'}}></i>
                      </span>
                      <span>
                        <b>{STEPS[currentStep-1]?.label}</b> 단계 진행 중 — {STEPS[currentStep-1]?.sub}을(를) 수행하고 있습니다.
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <Composer
        value={composerVal}
        setValue={setComposerVal}
        onSend={handleSend}
        disabled={stage > 0 && stage < 6}
        placeholder={stage > 0 && stage < 6 ? 'AI 검토가 진행 중입니다…' : '질문을 입력하세요…'}
      />
    </>
  );
}

/* ─── History list view ──────────────────────────── */
function HistoryView({ onOpen }) {
  return (
    <>
      <Topbar title="최근 검토 기록" crumb={HISTORY.length + '건'} />
      <div className="content">
        <div className="container">
          <div className="toolbar">
            <div className="search">
              <Icons.Search />
              <input placeholder="검토 기록 검색"/>
            </div>
            <button className="filter"><Icons.Filter /> 상태</button>
            <button className="filter"><Icons.Filter /> 날짜</button>
          </div>

          <div className="list-card">
            {HISTORY.map(h => (
              <div className="list-item" key={h.id} onClick={() => onOpen(h.id)}>
                <div className="ic"><Icons.FileText /></div>
                <div className="body">
                  <b>{h.title}</b>
                  <span>{h.date} · DRAFT-2026-{h.id.replace('h','').padStart(3,'0')}</span>
                  <div className="preview">{h.preview}</div>
                </div>
                <div style={{display:'flex', flexDirection:'column', gap:6, alignItems:'flex-end'}}>
                  {h.status === 'sent'   && <span className="badge solid">발송 완료</span>}
                  {h.status === 'review' && <span className="badge">내부 검토 중</span>}
                  {h.status === 'draft'  && <span className="badge outline">초안</span>}
                  <span className="right">v1.{Math.floor(Math.random()*5)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Docs management view ───────────────────────── */
function DocsView() {
  const tabs = ['전체 문서', '기술자료', '시험성적서', '카탈로그', '적용 사례'];
  const [tab, setTab] = useStateV(tabs[0]);

  const filtered = tab === '전체 문서' ? DOCS : DOCS.filter(d => d.cat === tab);

  const counts = {
    '전체 문서': DOCS.length,
    '기술자료': DOCS.filter(d=>d.cat==='기술자료').length,
    '시험성적서': DOCS.filter(d=>d.cat==='시험성적서').length,
    '카탈로그': DOCS.filter(d=>d.cat==='카탈로그').length,
    '적용 사례': DOCS.filter(d=>d.cat==='적용 사례').length,
  };

  return (
    <>
      <Topbar title="내부 기술자료 관리" crumb={DOCS.length + '개 문서'} />
      <div className="content">
        <div className="container wide">

          <div className="upload">
            <div className="ic"><Icons.Upload /></div>
            <div>
              <b>문서를 업로드하세요</b>
              <span>기술자료 · 시험성적서 · 카탈로그 · 적용 사례 (PDF, DOCX 지원, 최대 50 MB)</span>
            </div>
            <button className="btn primary"><Icons.Plus /> 문서 업로드</button>
          </div>

          <div className="tabs">
            {tabs.map(t => (
              <button key={t} className={'tab' + (tab===t ? ' is-active' : '')} onClick={() => setTab(t)}>
                {t} <span className="num">{counts[t]}</span>
              </button>
            ))}
          </div>

          <div className="toolbar">
            <div className="search">
              <Icons.Search />
              <input placeholder="문서명 검색"/>
            </div>
            <button className="filter">전체 <Icons.ChevronDown /></button>
            <button className="filter" style={{marginLeft:'auto'}}>
              <Icons.Grid />
            </button>
          </div>

          <div className="tbl">
            <table className="docs">
              <thead>
                <tr>
                  <th style={{width:'48%'}}>문서명</th>
                  <th>분류</th>
                  <th>버전</th>
                  <th>업로드 일시</th>
                  <th style={{width:40}}>관리</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(d => (
                  <tr key={d.id}>
                    <td className="doc-name">
                      <div className="doc-ic"><span>{d.ext}</span></div>
                      <div>
                        <div>{d.name}</div>
                        <div className="doc-meta">{d.size} · 최근 사용 3일 전</div>
                      </div>
                    </td>
                    <td><span className="badge">{d.cat}</span></td>
                    <td><span className="ver">{d.ver}</span></td>
                    <td><span className="dt">{d.date}</span></td>
                    <td className="actions">
                      <button className="ic-btn"><Icons.MoreVertical /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Inbox / Sent answers view ─────────────────── */
function InboxView() {
  const items = [
    { id:'i1', title:'EV 배터리팩 단열 패드 적용 답변', to:'㈜ 셀텍에너지 기술팀', date:'2026-05-26 15:02', status:'sent',
      preview:'귀사의 EV 배터리 팩 단열 패드에 당사 불연·단열 코팅제 적용은 기술적으로 가능성이 있으며…' },
    { id:'i2', title:'불연도료 30분 내화 등급 안내', to:'대일건설 기술팀', date:'2026-05-25 11:40', status:'sent',
      preview:'당사 불연 코팅제는 KS F 2271 기준 30분 내화 시험성적을 보유하고 있으며 외부 화염 노출 시…' },
    { id:'i3', title:'차열도료 옥상 적용 사례 회신', to:'서울복합소재', date:'2026-05-23 17:20', status:'review',
      preview:'옥상 슬래브 콘크리트 면 적용 시 일사반사율 0.83 이상 확보 가능하나, 부착 조건은 시공 환경에 따라…' },
    { id:'i4', title:'식품 설비용 방오 코팅제 적합성', to:'한국식품기계', date:'2026-05-21 12:10', status:'draft',
      preview:'SUS304 표면 적용 시 식품 위생법 적합성에 대한 추가 검토가 필요하며, 현재 시험성적서 확보 일정은…' },
    { id:'i5', title:'유리 차열 코팅 UV 차단율 답변', to:'코리아글래스', date:'2026-05-19 10:35', status:'sent',
      preview:'강화유리 외창 적용 시 자외선 차단율 99% 이상, 가시광선 투과율 70% 수준을 유지할 수 있으며…' },
  ];
  return (
    <>
      <Topbar title="업체 발송 답변 보관함" crumb="발송 완료 22 · 초안 4 · 검토 중 2" />
      <div className="content">
        <div className="container">
          <div className="toolbar">
            <div className="search">
              <Icons.Search />
              <input placeholder="업체명, 제목, 내용으로 검색"/>
            </div>
            <button className="filter">전체 상태 <Icons.ChevronDown /></button>
            <button className="filter">최근 30일 <Icons.ChevronDown /></button>
          </div>

          <div className="list-card">
            {items.map(it => (
              <div className="list-item" key={it.id}>
                <div className="ic"><Icons.Mail /></div>
                <div className="body">
                  <b>{it.title}</b>
                  <span>{it.to} · {it.date}</span>
                  <div className="preview">{it.preview}</div>
                </div>
                <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6}}>
                  {it.status === 'sent'   && <span className="badge solid">발송 완료</span>}
                  {it.status === 'review' && <span className="badge warn">검토 중</span>}
                  {it.status === 'draft'  && <span className="badge outline">초안</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Settings view ─────────────────────────────── */
function SettingsView() {
  return (
    <>
      <Topbar title="설정" crumb="시스템 환경 및 검토 정책" />
      <div className="content">
        <div className="container">

          <div className="section-title">
            <h2>검토 정책</h2>
            <span className="sub">기본 검토 항목 및 표현 가이드</span>
          </div>
          <div className="answer-card">
            <div className="answer-body" style={{padding:'8px 0'}}>
              {[
                {l:'단정 표현 차단', sub:'"100%, 완벽한, 영구" 등의 단정 표현을 자동 검출하여 수정 권장'},
                {l:'단일 답변 톤', sub:'전문적이고 신중한 톤으로 통일 (B2B 기술 답변 기준)'},
                {l:'시험성적서 인용 필수', sub:'기술적 수치 인용 시 시험성적서 또는 기술자료 번호 명시'},
                {l:'내부 검토 요청 대상', sub:'위험도 중간 이상 답변은 자동으로 기술검토팀 알림'},
              ].map((row, i) => (
                <div key={i} style={{padding:'14px 22px', borderBottom: i<3 ? '1px solid var(--line-100)' : 'none',
                  display:'flex', alignItems:'center', gap:14}}>
                  <div style={{flex:1}}>
                    <b style={{fontSize:13.5, fontWeight:600, display:'block', marginBottom:3}}>{row.l}</b>
                    <span style={{fontSize:12.5, color:'var(--ink-500)'}}>{row.sub}</span>
                  </div>
                  <Toggle defaultOn />
                </div>
              ))}
            </div>
          </div>

          <div className="section-title">
            <h2>참여 AI 모델</h2>
            <span className="sub">검토 회의에 참여하는 외부 AI 구성</span>
          </div>
          <div className="ai-grid" style={{gridTemplateColumns:'repeat(3, 1fr)'}}>
            {[
              {kind:'gemini', name:'Gemini', ver:'2.5 Pro', role:'기술 검토 1'},
              {kind:'claude', name:'Claude', ver:'Sonnet 4.5', role:'기술 검토 2'},
              {kind:'gpt',    name:'GPT',    ver:'5 Turbo',  role:'기술 검토 3'},
            ].map((a,i) => (
              <div className="ai-card" key={i}>
                <div className="ai-card-h">
                  <div className="ai-mark">{aiAvatar(a.kind)}</div>
                  <b>{a.name}</b>
                  <span className="ver">{a.ver}</span>
                </div>
                <div className="ai-section">
                  <div className="lbl">역할</div>
                  <div style={{fontSize:13, color:'var(--ink-700)'}}>{a.role} · 의견 카드 생성</div>
                </div>
                <div className="ai-section">
                  <div className="lbl">상태</div>
                  <span className="badge solid">연결됨</span>
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
    </>
  );
}

function Toggle({ defaultOn }) {
  const [on, setOn] = useStateV(defaultOn);
  return (
    <button
      onClick={() => setOn(v => !v)}
      style={{
        width:42, height:24, borderRadius:999, border:0,
        background: on ? 'var(--navy-900)' : 'var(--navy-300)',
        position:'relative', cursor:'pointer', transition:'background .15s',
        padding:0, flex:'none',
      }}
    >
      <span style={{
        position:'absolute', top:3, left: on ? 21 : 3,
        width:18, height:18, borderRadius:'50%', background:'#fff',
        transition:'left .15s', boxShadow:'0 1px 3px rgba(0,0,0,.2)',
      }}/>
    </button>
  );
}

Object.assign(window, { ChatView, HistoryView, DocsView, InboxView, SettingsView });
