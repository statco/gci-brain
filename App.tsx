import { BrowserRouter, Routes, Route } from 'react-router-dom';
import InstallerApplicationForm from './components/InstallerApplicationForm';
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
import type { ProcessingLog, TireProduct, Language } from './types';
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
    const savedState = localStorage.getItem('gci_app_state_v2');
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        if (parsed.lang) setLang(parsed.lang);
        if (parsed.favorites) setFavorites(parsed.favorites);
        if (parsed.compareList) setCompareList(parsed.compareList);
        if (parsed.appState && ![AppStates.IDLE, AppStates.PROCESSING, AppStates.ERROR].includes(parsed.appState)) {
           setAppState(parsed.appState);
           if (parsed.recommendations) setRecommendations(parsed.recommendations);
           if (parsed.selectedTire) setSelectedTire(parsed.selectedTire);
        }
      } catch (e) { console.error("Load state failed", e); }
    }
  }, []);

  const t = translations[lang];

  const startProcessing = async (request: string) => {
    setAppState(AppStates.PROCESSING);
    setLogs([
      { stage: ProcessingStages.ANALYZING, message: lang === 'en' ? "Consulting expert databases..." : "Consultation des bases d'experts...", status: 'active' },
      { stage: ProcessingStages.VALIDATING, message: lang === 'en' ? "Verifying fitment..." : "Vérification...", status: 'pending' },
      { stage: ProcessingStages.INVENTORY, message: lang === 'en' ? "Checking GCI inventory..." : "Vérification de l'inventaire...", status: 'pending' }
    ]);

    try {
      const products = await getTireRecommendations(request, lang);
      setRecommendations(products);
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
      <nav className="bg-white border-b py-4 px-6 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
            <div className="flex items-center gap-2 cursor-pointer" onClick={resetApp}>
                <div className="w-10 h-10 bg-red-600 rounded flex items-center justify-center text-white font-black">G</div>
                <span className="font-black text-lg tracking-tighter">GCI TIRE</span>
            </div>
            <div className="flex gap-4">
                {appState !== AppStates.IDLE && (
                    <button onClick={resetApp} className="text-sm font-bold text-slate-500 uppercase">{t.startOver}</button>
                )}
            </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 flex-grow w-full">
        {appState === AppStates.IDLE && <InputForm onSubmit={startProcessing} isLoading={false} lang={lang} setLang={setLang} />}
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
            tire={selectedTire.tire} quantity={selectedTire.quantity} withInstallation={selectedTire.withInstallation} total={selectedTire.total}
            onConfirm={() => setAppState(AppStates.SUCCESS)} onCancel={() => setAppState(AppStates.RESULTS)} lang={lang}
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
        <Route path="/installer-application" element={<InstallerApplicationForm />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
