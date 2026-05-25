import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import ShopifySync from './components/ShopifySync';
import UpdateCollectionSeo from './components/UpdateCollectionSeo';
import FixRedirects from './components/FixRedirects';
import UpdateSeo from './components/UpdateSeo';
import ShopifyFixDashboard from './components/ShopifyFixDashboard';
import FixAltTags from './components/FixAltTags';
import FixFrenchContent from './components/FixFrenchContent';
import FixProductDescriptions from './components/FixProductDescriptions';
import FixThemeContent from './components/FixThemeContent';
import FixTitles from './components/FixTitles';
import DuplicateSkuAudit from './components/DuplicateSkuAudit';
import ReviewsModeration from './components/ReviewsModeration';
import TranslateContentCard from './components/TranslateContentCard';
import WalmartManualShip from './components/WalmartManualShip';
import TagBackfillCtSync from './components/TagBackfillCtSync';
import React, { useState, useEffect } from 'react';
import '@maptiler/sdk/dist/maptiler-sdk.css';
import InputForm from './components/InputForm';
import ProcessingOverlay from './components/ProcessingOverlay';
import TireCard from './components/TireCard';
import CheckoutModal from './components/CheckoutModal';
import InstallerSelect from './components/InstallerSelect';
import InstallerPortal from './InstallerPortal';
import SuccessView from './components/SuccessView';
import ReviewsModal from './components/ReviewsModal';
import ComparisonModal from './components/ComparisonModal';
import FavoritesModal from './components/FavoritesModal';
import { getTireRecommendations } from './services/geminiService';
import { verifyFitmentForProducts, fetchFitmentSizes } from './services/wheelSizeService';
import type { ProcessingLog, TireProduct, Language, VehicleInput } from './types';
import { translations } from './utils/translations';
import { AppStates, ProcessingStages } from './utils/appStates';

function TireMatchApp() {
  const [appState, setAppState] = useState<AppStates>(AppStates.IDLE);
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  const [recommendations, setRecommendations] = useState<TireProduct[]>([]);
  const [selectedTire, setSelectedTire] = useState<{ tire: TireProduct; quantity: number; withInstallation: boolean; total: number } | null>(null);
  const [selectedInstaller, setSelectedInstaller] = useState<any>(null);
  const [favorites, setFavorites] = useState<TireProduct[]>([]);
  const [compareList, setCompareList] = useState<TireProduct[]>([]);
  const [activeModal, setActiveModal] = useState<'reviews' | 'compare' | 'favorites' | null>(null);
  const [reviewTire, setReviewTire] = useState<TireProduct | null>(null);
  const [lang, setLang] = useState<Language>('en');
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);

    const langParam = urlParams.get('lang') as Language | null;
    const resolvedLang: Language = (langParam === 'fr' || langParam === 'en') ? langParam : 'en';
    if (langParam === 'fr' || langParam === 'en') {
      setLang(langParam);
    }

    const yearParam  = urlParams.get('year');
    const makeParam  = urlParams.get('make');
    const modelParam = urlParams.get('model');

    if (yearParam && makeParam && modelParam) {
      const vehicle: VehicleInput = { year: yearParam, make: makeParam, model: modelParam };
      const request = `Vehicle: ${yearParam} ${makeParam} ${modelParam}`;
      startProcessing(request, vehicle, resolvedLang);
      return;
    }

    const savedState = localStorage.getItem('gci_app_state_v2');
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        if (parsed.lang && !langParam) setLang(parsed.lang);
        if (parsed.favorites)   setFavorites(parsed.favorites);
        if (parsed.compareList) setCompareList(parsed.compareList);
        if (parsed.appState === AppStates.RESULTS) {
          setAppState(AppStates.RESULTS);
          if (parsed.recommendations) setRecommendations(parsed.recommendations);
        }
      } catch (e) { console.error('Load state failed', e); }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const t = translations[lang];

  const startProcessing = async (request: string, vehicle?: VehicleInput, langOverride?: Language) => {
    const activeLang = langOverride ?? lang;
    setAppState(AppStates.PROCESSING);
    setChatMessages([]);
    setChatInput('');
    setLogs([
      { stage: ProcessingStages.ANALYZING, message: activeLang === 'en' ? "Consulting expert databases..." : "Consultation des bases d'experts...", status: 'active' },
      { stage: ProcessingStages.VALIDATING, message: activeLang === 'en' ? "Verifying fitment..." : "Vérification...", status: 'pending' },
      { stage: ProcessingStages.INVENTORY, message: activeLang === 'en' ? "Checking GCI inventory..." : "Vérification de l'inventaire...", status: 'pending' }
    ]);

    try {
      const oemSizes = await fetchFitmentSizes(vehicle, request);
      const products = await getTireRecommendations(request, activeLang, oemSizes);
      const verifiedProducts = await verifyFitmentForProducts(vehicle, products, request, oemSizes);
      setRecommendations(verifiedProducts);
      setAppState(AppStates.RESULTS);
    } catch (error) { setAppState(AppStates.ERROR); }
  };

  const resetApp = () => {
    setSelectedInstaller(null);
    setAppState(AppStates.IDLE);
    setRecommendations([]);
    setSelectedTire(null);
    setChatMessages([]);
    setChatInput('');
  };

  const sendChat = async () => {
    const q = chatInput.trim();
    if (!q || isChatLoading) return;
    const updated = [...chatMessages, { role: 'user' as const, content: q }];
    setChatMessages(updated);
    setChatInput('');
    setIsChatLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          tires: recommendations,
          conversationHistory: chatMessages,
          language: lang,
        }),
      });
      const data = await res.json();
      setChatMessages([...updated, { role: 'assistant', content: data.reply || '...' }]);
    } catch {
      setChatMessages([...updated, { role: 'assistant', content: lang === 'fr' ? 'Désolé, une erreur est survenue.' : 'Sorry, something went wrong.' }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 pb-20 relative flex flex-col">
      <nav className="py-4 px-6 sticky top-0 z-30 shadow-sm" style={{ backgroundColor: '#0E0E0E' }}>
        <div className="max-w-7xl mx-auto flex justify-between items-center">
            <div className="flex items-center cursor-pointer" onClick={resetApp}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 60" height="34">
                  <polygon points="0,15 22,15 22,0 44,30 22,60 22,45 0,45" fill="#B8192E"/>
                  <text x="55" y="24" fontFamily="'Arial Black','Arial',sans-serif" fontSize="17" fontWeight="900" fill="#FFFFFF" letterSpacing="1">AI MATCH</text>
                  <text x="56" y="42" fontFamily="'Arial Narrow','Arial',sans-serif" fontSize="10" fontWeight="400" fill="#444466" letterSpacing="3">BY GCI TIRES</text>
                </svg>
            </div>
            <div className="flex gap-4">
                {appState !== AppStates.IDLE && (
                    <button onClick={resetApp} className="text-sm font-bold text-slate-500 uppercase">{t.startOver}</button>
                )}
            </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 flex-grow w-full">
        {appState === AppStates.IDLE && <InputForm onSubmit={(req, veh) => startProcessing(req, veh)} isLoading={false} lang={lang} setLang={setLang} />}
        {appState === AppStates.PROCESSING && <ProcessingOverlay logs={logs} />}
        {appState === AppStates.RESULTS && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mt-10">
              {recommendations.map((tire) => (
                <TireCard
                  key={tire.id}
                  tire={tire}
                  onSelect={(t, q, inst, tot) => {
                    setSelectedTire({ tire: t, quantity: q, withInstallation: inst, total: tot });
                    if (inst) {
                      setAppState(AppStates.INSTALLER_SELECT);
                    } else {
                      setAppState(AppStates.CHECKOUT);
                    }
                  }}
                  lang={lang}
                />
              ))}
            </div>

            {recommendations.length > 0 && (
              <div style={{ maxWidth: 720, margin: '48px auto 0', borderTop: '1px solid #e2e8f0', paddingTop: 28 }}>
                <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2, color: '#94a3b8', marginBottom: 16, textTransform: 'uppercase' }}>
                  {lang === 'fr' ? 'Questions sur ces pneus ?' : 'Questions about these tires?'}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                  {chatMessages.map((m, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                      <div style={{
                        maxWidth: '80%', padding: '10px 14px',
                        borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                        backgroundColor: m.role === 'user' ? '#B8192E' : '#1e293b',
                        color: '#fff', fontSize: 14, lineHeight: 1.6,
                      }}>
                        {m.content}
                      </div>
                    </div>
                  ))}
                  {isChatLoading && (
                    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                      <div style={{ padding: '10px 14px', borderRadius: '16px 16px 16px 4px', backgroundColor: '#1e293b', color: '#94a3b8', fontSize: 14 }}>
                        {lang === 'fr' ? 'En train de répondre...' : 'Thinking...'}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendChat()}
                    placeholder={lang === 'fr' ? 'Posez une question sur ces pneus...' : 'Ask a question about these tires...'}
                    style={{
                      flex: 1, padding: '10px 14px', borderRadius: 8,
                      border: '1px solid #e2e8f0', fontSize: 14, outline: 'none',
                      backgroundColor: '#fff', color: '#0f172a',
                    }}
                  />
                  <button
                    onClick={sendChat}
                    disabled={!chatInput.trim() || isChatLoading}
                    style={{
                      padding: '10px 20px', borderRadius: 8, border: 'none',
                      backgroundColor: chatInput.trim() && !isChatLoading ? '#B8192E' : '#cbd5e1',
                      color: '#fff', fontWeight: 700, fontSize: 14,
                      cursor: chatInput.trim() && !isChatLoading ? 'pointer' : 'not-allowed',
                      transition: 'background-color 0.2s',
                    }}
                  >
                    {lang === 'fr' ? 'Envoyer' : 'Send'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {appState === AppStates.INSTALLER_SELECT && selectedTire && (
          <InstallerSelect
            tire={selectedTire.tire}
            quantity={selectedTire.quantity}
            lang={lang}
            mapsLoaded={true}
            onSelect={(installer, installTotal) => {
              setSelectedInstaller(installer);
              setSelectedTire(prev => prev ? {
                ...prev,
                total: prev.tire.pricePerUnit * prev.quantity + installTotal
              } : prev);
              setAppState(AppStates.CHECKOUT);
            }}
            onBack={() => setAppState(AppStates.RESULTS)}
            onSkip={() => {
              setSelectedInstaller(null);
              setSelectedTire(prev => prev ? { ...prev, withInstallation: false } : prev);
              setAppState(AppStates.CHECKOUT);
            }}
          />
        )}
        {appState === AppStates.CHECKOUT && selectedTire && (
          <CheckoutModal
            tire={selectedTire.tire}
            quantity={selectedTire.quantity}
            withInstallation={selectedTire.withInstallation}
            total={selectedTire.total}
            onConfirm={(orderNum: string) => {
              setSelectedTire(prev => prev ? { ...prev, orderNumber: orderNum, installer: selectedInstaller } : prev);
              setAppState(AppStates.SUCCESS);
            }}
            onCancel={() => setAppState(selectedInstaller ? AppStates.INSTALLER_SELECT : AppStates.RESULTS)}
            selectedInstaller={selectedInstaller}
            lang={lang}
          />
        )}
        {appState === AppStates.SUCCESS && selectedTire && (
           <SuccessView selectedTire={selectedTire} onReset={resetApp} lang={lang} />
        )}
      </main>
    </div>
  );
}

function App() {
  if (window.location.pathname.includes('installer-portal')) {
    return <InstallerPortal />;
  }
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TireMatchApp />} />
        <Route path="/brain" element={<Dashboard />} />
        <Route path="/sync" element={<ShopifySync />} />
        <Route path="/collection-seo" element={<UpdateCollectionSeo />} />
        <Route path="/fix-redirects" element={<FixRedirects />} />
        <Route path="/update-seo" element={<UpdateSeo />} />
        <Route path="/fix" element={<ShopifyFixDashboard />} />
        <Route path="/fix-alt-tags" element={<FixAltTags />} />
        <Route path="/fix-french" element={<FixFrenchContent />} />
        <Route path="/fix-descriptions" element={<FixProductDescriptions />} />
        <Route path="/fix-theme" element={<FixThemeContent />} />
        <Route path="/fix-titles" element={<FixTitles />} />
        <Route path="/duplicate-sku-audit" element={<DuplicateSkuAudit />} />
        <Route path="/reviews" element={<ReviewsModeration />} />
        <Route path="/translate" element={<TranslateContentCard />} />
        <Route path="/walmart-ship" element={<WalmartManualShip />} />
        <Route path="/tag-backfill-ct-sync" element={<TagBackfillCtSync />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
