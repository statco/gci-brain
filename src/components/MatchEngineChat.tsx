import React, { useState, useEffect, useRef } from 'react';

type Language = 'en' | 'fr';
type Phase = 'form' | 'loading' | 'chat';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const GCI_CHEVRON = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 60" width="22" height="30">
    <polygon points="0,15 22,15 22,0 44,30 22,60 22,45 0,45" fill="#B8192E" />
  </svg>
);

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '10px 0' }}>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="animate-bounce"
          style={{
            width: 8, height: 8, borderRadius: '50%',
            backgroundColor: '#B8192E', display: 'inline-block',
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </div>
  );
}

function renderText(text: string) {
  return text.split('\n').flatMap((line, lineIdx, arr) => {
    // Strip heading markers (###, ##, #)
    let processed = line.replace(/^#{1,3}\s*/, '');
    // Replace leading dash bullets with •
    processed = processed.replace(/^-\s+/, '\u2022 ');

    // Handle **bold** inline
    const parts = processed.split(/(\*\*[^*]+\*\*)/g);
    const inline: React.ReactNode[] = parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={lineIdx + '-' + i}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });

    // Preserve newlines between lines (pre-wrap handles rendering)
    return lineIdx < arr.length - 1 ? [...inline, '\n'] : inline;
  });
}

const UI = {
  en: {
    title: 'Find My Tires',
    vehicle: 'Your Vehicle',
    vehiclePh: 'e.g. 2021 Toyota Corolla',
    location: 'Your Location',
    locationPh: 'e.g. Montreal, QC',
    tireType: 'Tire Type',
    submit: 'Find My Tires',
    followUpPh: 'Ask a follow-up question\u2026',
    send: 'Send',
    startOver: 'Start Over',
    winter: 'Winter',
    allSeason: 'All-Season',
    summer: 'Summer',
  },
  fr: {
    title: 'Trouver mes pneus',
    vehicle: 'Votre v\u00e9hicule',
    vehiclePh: 'ex. Toyota Corolla 2021',
    location: 'Votre localisation',
    locationPh: 'ex. Montreal, QC',
    tireType: 'Type de pneu',
    submit: 'Trouver mes pneus',
    followUpPh: 'Posez une question de suivi\u2026',
    send: 'Envoyer',
    startOver: 'Recommencer',
    winter: 'Hiver',
    allSeason: 'Quatre-saisons',
    summer: 'Ete',
  },
};

export default function MatchEngineChat() {
  const [phase, setPhase] = useState<Phase>('form');
  const [lang, setLang] = useState<Language>('en');
  const [vehicle, setVehicle] = useState('');
  const [location, setLocation] = useState('');
  const [tireType, setTireType] = useState('Winter');
  const [messages, setMessages] = useState<Message[]>([]);
  const [followUp, setFollowUp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const t = UI[lang];

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const yr = p.get('year') || '';
    const mk = p.get('make') || '';
    const mo = p.get('model') || '';
    if (yr || mk || mo) setVehicle([yr, mk, mo].filter(Boolean).join(' '));
    const langParam = p.get('lang');
    if (langParam === 'fr' || langParam === 'en') setLang(langParam);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, phase]);

  async function fetchResponse(history: Message[]) {
    setIsLoading(true);
    setPhase('loading');

    try {
      console.log('[MatchEngine] submitting tireType:', tireType);
      const response = await fetch('/api/matchEngine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle,
          location,
          tireType,
          language: lang,
          conversationHistory: history.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errData.error || 'HTTP ' + response.status);
      }

      const data = await response.json();
      const reply: string = data.reply || '';
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
      setPhase('chat');
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: lang === 'fr'
            ? "Une erreur s'est produite. Veuillez r\u00e9essayer."
            : 'An error occurred. Please try again.',
        },
      ]);
      setPhase('chat');
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit() {
    const userMsg: Message = {
      role: 'user',
      content: vehicle + ' | ' + location + ' | ' + tireType,
    };
    setMessages([userMsg]);
    fetchResponse([]);
  }

  function handleFollowUp() {
    if (!followUp.trim()) return;
    const userMsg: Message = { role: 'user', content: followUp.trim() };
    const updatedHistory = [...messages, userMsg];
    setMessages(updatedHistory);
    setFollowUp('');
    fetchResponse(updatedHistory);
  }

  function handleStartOver() {
    setPhase('form');
    setMessages([]);
    setFollowUp('');
    setVehicle('');
    setLocation('');
    setTireType('Winter');
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 16px',
    backgroundColor: '#1c1c1c',
    border: '1px solid #2a2a2a',
    borderRadius: 8,
    color: '#fff',
    fontSize: 15,
    outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#888',
    marginBottom: 6,
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0E0E0E', color: '#fff', display: 'flex', flexDirection: 'column' }}>
      {/* Nav */}
      <nav style={{ backgroundColor: '#0E0E0E', borderBottom: '1px solid #1a1a1a', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 30 }}>
        <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 60" height="34">
            <polygon points="0,15 22,15 22,0 44,30 22,60 22,45 0,45" fill="#B8192E" />
            <text x="55" y="24" fontFamily="'Arial Black','Arial',sans-serif" fontSize="17" fontWeight="900" fill="#FFFFFF" letterSpacing="1">AI MATCH</text>
            <text x="56" y="42" fontFamily="'Arial Narrow','Arial',sans-serif" fontSize="10" fontWeight="400" fill="#666" letterSpacing="3">BY GCI TIRES</text>
          </svg>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              onClick={() => setLang(lang === 'en' ? 'fr' : 'en')}
              style={{ background: 'none', border: '1px solid #333', borderRadius: 6, color: '#aaa', padding: '4px 10px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
            >
              {lang === 'en' ? 'FR' : 'EN'}
            </button>
            {phase !== 'form' && (
              <button
                onClick={handleStartOver}
                style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}
              >
                {t.startOver}
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Main */}
      <div style={{ flex: 1, maxWidth: 760, margin: '0 auto', width: '100%', padding: '32px 24px 120px' }}>

        {/* FORM PHASE */}
        {phase === 'form' && (
          <div style={{ backgroundColor: '#161616', borderRadius: 16, padding: '32px 28px', boxShadow: '0 4px 32px rgba(0,0,0,0.5)' }}>
            <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 28, letterSpacing: '-0.02em' }}>
              {t.title}
            </h1>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <label style={labelStyle}>{t.vehicle}</label>
                <input
                  style={inputStyle}
                  value={vehicle}
                  onChange={e => setVehicle(e.target.value)}
                  placeholder={t.vehiclePh}
                />
              </div>
              <div>
                <label style={labelStyle}>{t.location}</label>
                <input
                  style={inputStyle}
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  placeholder={t.locationPh}
                />
              </div>
              <div>
                <label style={labelStyle}>{t.tireType}</label>
                <select
                  style={{ ...inputStyle, cursor: 'pointer' }}
                  value={tireType}
                  onChange={e => setTireType(e.target.value)}
                >
                  <option value="Winter">{t.winter}</option>
                  <option value="All-Season">{t.allSeason}</option>
                  <option value="Summer">{t.summer}</option>
                </select>
              </div>
              <button
                onClick={handleSubmit}
                disabled={!vehicle.trim() || !location.trim()}
                style={{
                  backgroundColor: vehicle.trim() && location.trim() ? '#B8192E' : '#3a1a1a',
                  color: vehicle.trim() && location.trim() ? '#fff' : '#666',
                  border: 'none', borderRadius: 10, padding: '14px 24px',
                  fontSize: 15, fontWeight: 800, cursor: vehicle.trim() && location.trim() ? 'pointer' : 'not-allowed',
                  letterSpacing: '0.04em', textTransform: 'uppercase', transition: 'background 0.2s',
                }}
              >
                {t.submit}
              </button>
            </div>
          </div>
        )}

        {/* LOADING + CHAT PHASE */}
        {(phase === 'loading' || phase === 'chat') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                  alignItems: 'flex-start',
                  gap: 10,
                }}
              >
                {msg.role === 'assistant' && (
                  <div style={{ flexShrink: 0, marginTop: 4 }}>{GCI_CHEVRON}</div>
                )}
                <div
                  style={{
                    maxWidth: '80%',
                    padding: '12px 16px',
                    borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '4px 18px 18px 18px',
                    backgroundColor: msg.role === 'user' ? '#B8192E' : '#1c1c1c',
                    fontSize: 15,
                    lineHeight: 1.65,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {msg.role === 'assistant' ? renderText(msg.content) : msg.content}
                </div>
              </div>
            ))}

            {/* Loading bubble */}
            {phase === 'loading' && (
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flexShrink: 0, marginTop: 4 }}>{GCI_CHEVRON}</div>
                <div
                  style={{
                    maxWidth: '80%', padding: '12px 16px',
                    borderRadius: '4px 18px 18px 18px',
                    backgroundColor: '#1c1c1c', fontSize: 15, lineHeight: 1.65,
                  }}
                >
                  <TypingDots />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Follow-up input bar */}
      {phase === 'chat' && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          backgroundColor: '#111', borderTop: '1px solid #1e1e1e',
          padding: '14px 24px',
        }}>
          <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', gap: 10 }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={followUp}
              onChange={e => setFollowUp(e.target.value)}
              placeholder={t.followUpPh}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleFollowUp(); } }}
              disabled={isLoading}
            />
            <button
              onClick={handleFollowUp}
              disabled={!followUp.trim() || isLoading}
              style={{
                backgroundColor: followUp.trim() && !isLoading ? '#B8192E' : '#2a2a2a',
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '12px 20px', fontWeight: 800, cursor: followUp.trim() && !isLoading ? 'pointer' : 'not-allowed',
                fontSize: 14, letterSpacing: '0.04em', textTransform: 'uppercase',
              }}
            >
              {t.send}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
