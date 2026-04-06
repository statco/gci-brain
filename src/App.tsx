import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import InstallerApplicationForm from './components/InstallerApplicationForm';
import ShopifyFixDashboard from './components/ShopifyFixDashboard';
import UpdateCollectionSeo from './components/UpdateCollectionSeo';
import FixFrenchContent from './components/FixFrenchContent';
import FixProductDescriptions from './components/FixProductDescriptions';
import FixAltTags from './components/FixAltTags';
import FixThemeContent from './components/FixThemeContent';
import FixRedirects from './components/FixRedirects';
import FixTitles from './components/FixTitles';
import React, { useState, useEffect } from 'react';
import { useJsApiLoader } from '@react-google-maps/api';
import InputForm from './components/InputForm';
import ProcessingOverlay from './components/ProcessingOverlay';
import TireCard from './components/TireCard';
import CheckoutModal from './components/CheckoutModal';
import SuccessView from './components/SuccessView';
import ReviewsModal from './components/ReviewsModal';
import ComparisonModal from './components/ComparisonModal';
import FavoritesModal from './components/FavoritesModal';
import { getTireRecommendations } from './services/geminiService';
import { verifyFitmentForProducts, fetchFitmentSizes } from './services/wheelSizeService';
import type { ProcessingLog, TireProduct, Language, VehicleInput } from './types';
import { translations } from './utils/translations';
import { AppStates, ProcessingStages } from './utils/appStates';

const LIBRARIES: ("marker" | "maps" | "places")[] = ["marker", "maps", "places"];

function TireMatchApp() {
  const [appState, setAppState] = useState<AppStates>(AppStates.IDLE);
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  const [recommendations, setRecommendations] = useState<TireProduct[]>([]);
  const [selectedTire, setSelectedTire] = useState<{ tire: TireProduct; quantity: number; withInstallation: boolean; total: number } | null>(null);
  const [favorites, setFavorites] = useState<TireProduct[]>([]);
  const [compareList, setCompareList] = useState<TireProduct[]>([]);
  const [activeModal, setActiveModal] = useState<'reviews' | 'compare' | 'favorites' | null>(null);
  const [reviewTire, setReviewTire] = useState<TireProduct | null>(null);
  const [lang, setLang] = useState<Language>('en');

  // ✅ Initialize Google Maps Loader
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
    libraries: LIBRARIES,
  });

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);

    // ── Language (URL takes priority over localStorage) ──────────────────
    const langParam = urlParams.get('lang') as Language | null;
    const resolvedLang: Language = (langParam === 'fr' || langParam === 'en') ? langParam : 'en';
    if (langParam === 'fr' || langParam === 'en') {
      setLang(langParam);
    }

    // ── YMM params from the Shopify YMM finder widget ────────────────────
    // When all three are present: pre-fill vehicle data and auto-trigger
    // the tire search. Stop at RESULTS — never auto-advance to checkout.
    const yearParam  = urlParams.get('year');
    const makeParam  = urlParams.get('make');
    const modelParam = urlParams.get('model');

    if (yearParam && makeParam && modelParam) {
      const vehicle: VehicleInput = { year: yearParam, make: makeParam, model: modelParam };
      const request = `Vehicle: ${yearParam} ${makeParam} ${modelParam}`;
      // Pass resolvedLang so the correct language is used before the lang
      // state update has re-rendered the component.
      startProcessing(request, vehicle, resolvedLang);
      return; // Skip localStorage restore — stale state is irrelevant here
    }

    // ── Restore persisted state (no YMM params) ──────────────────────────
    // Only restore RESULTS, never CHECKOUT or SUCCESS — those states
    // require explicit user action and must not be auto-resumed on load.
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
    setAppState(AppStates.IDLE);
    setRecommendations([]);
    setSelectedTire(null);
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mt-10">
            {recommendations.map((tire) => (
              <TireCard 
                key={tire.id} 
                tire={tire} 
                onSelect={(t, q, inst, tot) => { setSelectedTire({tire:t, quantity:q, withInstallation:inst, total:tot}); setAppState(AppStates.CHECKOUT); }}
                lang={lang}
              />
            ))}
          </div>
        )}
        {appState === AppStates.CHECKOUT && selectedTire && (
          <CheckoutModal 
            tire={selectedTire.tire} 
            quantity={selectedTire.quantity} 
            withInstallation={selectedTire.withInstallation} 
            total={selectedTire.total}
            onConfirm={() => setAppState(AppStates.SUCCESS)} 
            onCancel={() => setAppState(AppStates.RESULTS)} 
            lang={lang}
          />
        )}
        {appState === AppStates.SUCCESS && selectedTire && (
           <SuccessView selectedTire={selectedTire} onReset={resetApp} lang={lang} mapsLoaded={isLoaded} />
        )}
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TireMatchApp />} />
        <Route path="/brain" element={<Dashboard />} />
        <Route path="/installer-application" element={<InstallerApplicationForm />} />
        <Route path="/shopify-fix" element={<ShopifyFixDashboard />} />
        <Route path="/collection-seo" element={<UpdateCollectionSeo />} />
        <Route path="/fix-french" element={<FixFrenchContent />} />
        <Route path="/fix-descriptions" element={<FixProductDescriptions />} />
        <Route path="/fix-alt-tags" element={<FixAltTags />} />
        <Route path="/fix-theme" element={<FixThemeContent />} />
        <Route path="/fix-redirects" element={<FixRedirects />} />
        <Route path="/fix-titles" element={<FixTitles />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
