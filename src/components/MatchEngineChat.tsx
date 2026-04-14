import React, { useState, useEffect, useRef } from 'react';

type Language = 'en' | 'fr';
type Phase = 'form' | 'loading' | 'chat';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface TireCard {
  id: number;
  brand: string;
  model: string;
  size: string;
  price: number;
  image: string;
  handle: string;
}

interface CardState {
  qty: number;
  install: boolean;
}

const LOADING_STEPS: Record<Language, string[]> = {
  en: [
    'Consulting expert databases\u2026',
    'Verifying fitment\u2026',
    'Checking GCI inventory\u2026',
  ],
  fr: [
    'Consultation des bases de donn\u00e9es\u2026',
    'V\u00e9rification de la compatibilit\u00e9\u2026',
    "V\u00e9rification de l\u2019inventaire GCI\u2026",
  ],
};

const INSTALL_PRICE = 15;

const GCI_CHEVRON = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 60" width="22" height="30">
    <polygon points="0,15 22,15 22,0 44,30 22,60 22,45 0,45" fill="#B8192E" />
  </svg>
);

function LoadingSteps({ lang }: { lang: Language }) {
  const [activeStep, setActiveStep] = useState(0);
  const steps = LOADING_STEPS[lang];

  useEffect(() => {
    const t1 = setTimeout(() => setActiveStep(1), 800);
    const t2 = setTimeout(() => setActiveStep(2), 1600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div
      style={{
        backgroundColor: '#161616',
        border: '1px solid #2a2a2a',
        borderRadius: 14,
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        maxWidth: '80%',
      }}
    >
      {steps.map((step, i) => {
        const isDone = i < activeStep;
        const isActive = i === activeStep;
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              opacity: i <= activeStep ? 1 : 0.28,
              transition: 'opacity 0.45s ease',
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                flexShrink: 0,
                backgroundColor: isDone ? '#16a34a' : isActive ? '#B8192E' : '#232323',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background-color 0.45s ease',
              }}
            >
              {isDone ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <polyline
                    points="2,6 5,9 10,3"
                    stroke="#fff"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : isActive ? (
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    backgroundColor: '#fff',
                    animation: 'gciBlink 1s ease-in-out infinite',
                  }}
                />
              ) : (
                <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#444' }} />
              )}
            </div>
            <span
              style={{
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                color: i <= activeStep ? '#fff' : '#555',
                transition: 'color 0.45s ease',
              }}
            >
              {step}
            </span>
          </div>
        );
      })}

      <style>{`
        @keyframes gciBlink {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(0.75); }
        }
      `}</style>
    </div>
  );
}

function renderText(text: string) {
  return text.split('\n').flatMap((line, lineIdx, arr) => {
    let processed = line.replace(/^#{1,3}\s*/, '');
    processed = processed.replace(/^-\s+/, '\u2022 ');
    const parts = processed.split(/(\*\*[^*]+\*\*)/g);
    const inline: React.ReactNode[] = parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={lineIdx + '-' + i}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
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
    verified: 'GCI VERIFIED',
    installation: 'Add Installation',
    perTire: '/tire',
    total: 'Total',
    selectBook: 'SELECT & BOOK',
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
    verified: 'GCI CERTIFI\u00c9',
    installation: 'Ajouter l\u2019installation',
    perTire: '/pneu',
    total: 'Total',
    selectBook: 'S\u00c9LECTIONNER',
  },
};

export default function MatchEngineChat() {
  const [phase, setPhase] = useState<Phase>('form');
  const [lang, setLang] = useState<Language>('en');
  const [vehicle, setVehicle] = useState('');
  const [location, setLocation] = useState('');
  const [tireType, setTireType] = useState('Winter');
  const [messages, setMessages] = useState<Message[]>([]);
  const [tireCards, setTireCards] = useState<TireCard[]>([]);
  const [cardStates, setCardStates] = useState<Record<number, CardState>>({});
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
  }, [messages, tireCards, phase]);

  // Initialise card states whenever a new set of tires arrives
  useEffect(() => {
    if (tireCards.length === 0) return;
    const initial: Record<number, CardState> = {};
    tireCards.forEach(tire => { initial[tire.id] = { qty: 4, install: false }; });
    setCardStates(initial);
  }, [tireCards]);

  function updateCard(id: number, patch: Partial<CardState>) {
    setCardStates(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

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
      if (Array.isArray(data.tires) && data.tires.length > 0) {
        setTireCards(data.tires);
      }
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
    setTireCards([]);
    setCardStates({});
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
    setTireCards([]);
    setCardStates({});
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

            {/* 3-step loading card */}
            {phase === 'loading' && (
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flexShrink: 0, marginTop: 4 }}>{GCI_CHEVRON}</div>
                <LoadingSteps lang={lang} />
              </div>
            )}

            {/* Tire card row */}
            {phase === 'chat' && tireCards.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div
                  style={{
                    display: 'flex',
                    gap: 14,
                    overflowX: 'auto',
                    paddingBottom: 10,
                    scrollbarWidth: 'thin',
                    scrollbarColor: '#333 transparent',
                  }}
                >
                  {tireCards.map(tire => {
                    const cs = cardStates[tire.id] ?? { qty: 4, install: false };
                    const totalPrice = cs.qty * tire.price + (cs.install ? cs.qty * INSTALL_PRICE : 0);
                    const bookUrl = `https://gcitires.com/products/${tire.handle}?qty=${cs.qty}`;

                    return (
                      <div
                        key={tire.id}
                        style={{
                          flexShrink: 0,
                          width: 200,
                          backgroundColor: '#161616',
                          border: '1px solid #2a2a2a',
                          borderRadius: 14,
                          overflow: 'hidden',
                          display: 'flex',
                          flexDirection: 'column',
                        }}
                      >
                        {/* GCI VERIFIED badge */}
                        <div style={{
                          backgroundColor: '#0d1f0d',
                          borderBottom: '1px solid #1a2e1a',
                          padding: '5px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                        }}>
                          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                            <circle cx="6.5" cy="6.5" r="6.5" fill="#16a34a" />
                            <polyline points="3.5,6.5 5.5,8.5 9.5,4.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span style={{ fontSize: 10, fontWeight: 800, color: '#4ade80', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                            {t.verified}
                          </span>
                        </div>

                        {/* Image */}
                        <div style={{ width: '100%', height: 120, backgroundColor: '#0e0e0e', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                          {tire.image ? (
                            <img
                              src={tire.image}
                              alt={`${tire.brand} ${tire.model}`}
                              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            />
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="48" height="48" opacity={0.25}>
                              <circle cx="32" cy="32" r="28" fill="none" stroke="#fff" strokeWidth="4" />
                              <circle cx="32" cy="32" r="10" fill="none" stroke="#fff" strokeWidth="4" />
                            </svg>
                          )}
                        </div>

                        {/* Info + controls */}
                        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 800, color: '#B8192E', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                              {tire.brand}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1.3, marginTop: 2 }}>
                              {tire.model}
                            </div>
                            <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                              {tire.size}
                            </div>
                          </div>

                          <div style={{ fontSize: 13, color: '#aaa' }}>
                            <span style={{ color: '#fff', fontWeight: 700 }}>${tire.price.toFixed(2)}</span>
                            <span style={{ fontSize: 11 }}> / tire</span>
                          </div>

                          {/* Quantity selector */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <button
                              onClick={() => updateCard(tire.id, { qty: Math.max(1, cs.qty - 1) })}
                              style={{
                                width: 26, height: 26, borderRadius: 6,
                                backgroundColor: '#232323', border: '1px solid #333',
                                color: '#fff', fontSize: 16, fontWeight: 700,
                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                lineHeight: 1, padding: 0,
                              }}
                            >−</button>
                            <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', minWidth: 20, textAlign: 'center' }}>
                              {cs.qty}
                            </span>
                            <button
                              onClick={() => updateCard(tire.id, { qty: Math.min(8, cs.qty + 1) })}
                              style={{
                                width: 26, height: 26, borderRadius: 6,
                                backgroundColor: '#232323', border: '1px solid #333',
                                color: '#fff', fontSize: 16, fontWeight: 700,
                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                lineHeight: 1, padding: 0,
                              }}
                            >+</button>
                          </div>

                          {/* Installation checkbox */}
                          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 7, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={cs.install}
                              onChange={e => updateCard(tire.id, { install: e.target.checked })}
                              style={{ marginTop: 2, accentColor: '#B8192E', cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: 11, color: '#aaa', lineHeight: 1.4 }}>
                              {t.installation}
                              <span style={{ color: '#B8192E', fontWeight: 700 }}> +${INSTALL_PRICE.toFixed(2)}{t.perTire}</span>
                            </span>
                          </label>

                          {/* Total */}
                          <div style={{
                            backgroundColor: '#0e0e0e',
                            border: '1px solid #232323',
                            borderRadius: 8,
                            padding: '7px 10px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}>
                            <span style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t.total}</span>
                            <span style={{ fontSize: 15, fontWeight: 900, color: '#fff' }}>${totalPrice.toFixed(2)}</span>
                          </div>

                          {/* SELECT & BOOK button */}
                          <a
                            href={bookUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: 'block',
                              backgroundColor: '#B8192E',
                              color: '#fff',
                              textDecoration: 'none',
                              textAlign: 'center',
                              fontSize: 11,
                              fontWeight: 800,
                              letterSpacing: '0.07em',
                              textTransform: 'uppercase',
                              padding: '9px 0',
                              borderRadius: 8,
                              marginTop: 2,
                            }}
                          >
                            {t.selectBook}
                          </a>
                        </div>
                      </div>
                    );
                  })}
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
