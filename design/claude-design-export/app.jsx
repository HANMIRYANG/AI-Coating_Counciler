// app.jsx — root component

const { useState: useStateA, useEffect: useEffectA } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "density": "regular",
  "showProgressOverlay": true,
  "demoMode": "live"
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [view, setView] = useStateA('chat');
  const [activeHistoryId, setActiveHistoryId] = useStateA('current');
  const [chatKey, setChatKey] = useStateA(0); // forces ChatView reset
  const [chatInitialPrompt, setChatInitialPrompt] = useStateA(null);
  const [chatAutorun, setChatAutorun] = useStateA(true);

  // density var
  useEffectA(() => {
    document.documentElement.style.setProperty(
      '--row-pad',
      t.density === 'compact' ? '10px' : t.density === 'comfy' ? '18px' : '14px'
    );
  }, [t.density]);

  const onNewChat = () => {
    setActiveHistoryId('current');
    setChatInitialPrompt(null);
    setChatAutorun(true);
    setChatKey(k => k + 1);
    setView('chat');
  };

  const onOpenHistory = (id) => {
    const item = HISTORY.find(h => h.id === id);
    if (!item) return;
    setActiveHistoryId(id);
    setChatInitialPrompt(item.title);
    // Past items show as fully completed — skip auto-run
    setChatAutorun(false);
    setChatKey(k => k + 1);
    setView('chat');
  };

  // Sidebar history -> chat
  const handleSetActiveHistory = (id) => {
    if (id === activeHistoryId && view === 'chat') return;
    const item = HISTORY.find(h => h.id === id);
    setActiveHistoryId(id);
    setChatInitialPrompt(item ? item.title : null);
    setChatAutorun(false);
    setChatKey(k => k + 1);
  };

  return (
    <div className="app">
      <Sidebar
        view={view}
        setView={(v) => {
          if (v === 'chat') { setActiveHistoryId('current'); }
          setView(v);
        }}
        activeHistoryId={activeHistoryId}
        setActiveHistoryId={handleSetActiveHistory}
        onNewChat={onNewChat}
      />

      <main className="main">
        {view === 'chat'     && <ChatView key={chatKey} initialPrompt={chatInitialPrompt} autorun={chatAutorun} tweaks={t} />}
        {view === 'history'  && <HistoryView onOpen={onOpenHistory} />}
        {view === 'docs'     && <DocsView />}
        {view === 'inbox'    && <InboxView />}
        {view === 'settings' && <SettingsView />}
      </main>

      <TweaksPanel>
        <TweakSection label="검토 흐름" />
        <TweakRadio
          label="데모 진행"
          value={t.demoMode}
          options={['live', 'instant']}
          onChange={(v) => {
            setTweak('demoMode', v);
            if (v === 'instant') {
              // jump straight to final
              setChatAutorun(false);
              setChatInitialPrompt(SAMPLE_Q);
              setChatKey(k => k + 1);
            } else {
              setChatAutorun(true);
              setChatInitialPrompt(null);
              setChatKey(k => k + 1);
            }
          }}
        />
        <TweakButton label="검토 다시 보기" onClick={() => { setChatKey(k => k+1); setChatInitialPrompt(null); setChatAutorun(true); setView('chat'); }} />
        <TweakButton label="예시 질문으로 시작" onClick={() => { setChatInitialPrompt(SAMPLE_Q); setChatAutorun(true); setChatKey(k=>k+1); setView('chat'); }} />

        <TweakSection label="레이아웃" />
        <TweakRadio
          label="여백"
          value={t.density}
          options={['compact','regular','comfy']}
          onChange={(v) => setTweak('density', v)}
        />

        <TweakSection label="화면 이동" />
        <TweakSelect
          label="현재 화면"
          value={view}
          options={[
            {value:'chat',     label:'1. 메인 채팅'},
            {value:'history',  label:'2. 검토 기록'},
            {value:'docs',     label:'3. 기술자료 관리'},
            {value:'inbox',    label:'4. 발송 답변 보관함'},
            {value:'settings', label:'5. 설정'},
          ]}
          onChange={(v) => setView(v)}
        />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
