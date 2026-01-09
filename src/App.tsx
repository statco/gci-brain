import { BrowserRouter, Routes, Route } from 'react-router-dom';
import InstallerApplicationForm from './components/InstallerApplicationForm';
import React, { useState, useEffect } from 'react';
 
import { useJsApiLoader } from '@react-google-maps/api'; // ✅ ADDED
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

// ✅ ADDED: Google Maps libraries
const GOOGLE_MAPS_LIBRARIES: ("marker" | "maps" | "places")[] = ["marker", "maps", "places"];
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

  // ✅ ADDED: Google Maps loader
  const { isLoaded: mapsLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  // 1. Load state from local storage on mount (Persistence)
  useEffect(() => {
  // Priority 1: Read lang from URL parameter (from Shopify iframe)
  const urlParams = new URLSearchParams(window.location.search);
  const langParam = urlParams.get('lang');
  
  if (langParam === 'fr' || langParam === 'en') {
    setLang(langParam);
    return; // Use URL param and skip localStorage
  }
  
  // Priority 2: Load from localStorage if no URL param
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
    } catch (e) { 
      console.error("Load state failed", e); 
    }
  }
}, []); // Run once on mount

  // 2. Save state to local storage on change
  useEffect(() => {
    const sanitizeTire = (tire: TireProduct): TireProduct => {
      const clone = { ...tire };
      if (clone.visualizationUrl && clone.visualizationUrl.startsWith('data:')) {
        clone.visualizationUrl = undefined;
      }
      return clone;
    };

    const stateToSave = {
      appState: (appState === AppStates.PROCESSING) ? AppStates.IDLE : appState, 
      recommendations: recommendations.map(sanitizeTire),
      selectedTire: selectedTire ? { ...selectedTire, tire: sanitizeTire(selectedTire.tire) } : null,
      favorites: favorites.map(sanitizeTire),
      compareList: compareList.map(sanitizeTire),
      lang
    };
    
    try {
      localStorage.setItem('gci_app_state_v2', JSON.stringify(stateToSave));
    } catch (e) {
      console.warn("LocalStorage Quota Exceeded. Clearing state to recover.", e);
      try {
        const minimalState = { lang, appState: AppStates.IDLE };
        localStorage.setItem('gci_app_state_v2', JSON.stringify(minimalState));
      } catch (e2) {
        // LocalStorage is completely broken or full
      }
    }
  }, [appState, recommendations, selectedTire, favorites, compareList, lang]);

  // 3. Sync language with URL parameters (Shopify integration)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlLang = params.get('lang') || params.get('locale');
    
    if (urlLang) {
      const normalizedLang = urlLang.toLowerCase();
      if (normalizedLang.startsWith('fr')) {
        setLang('fr');
      } else if (normalizedLang.startsWith('en')) {
        setLang('en');
      }

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
           <SuccessView 
              selectedTire={selectedTire}
              onReset={resetApp}
              lang={lang}
              mapsLoaded={mapsLoaded} // ✅ ADDED: Pass mapsLoaded prop
           />
        )}

        {appState === AppStates.ERROR && (
           <div className="flex flex-col items-center justify-center min-h-[50vh] animate-fade-in-up">
              <div className="bg-red-50 p-6 rounded-full mb-4 shadow-sm border border-red-100">
                 <svg className="w-12 h-12 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              </div>
              <h3 className="text-2xl font-black text-slate-900 mb-2">Something went wrong</h3>
              <p className="text-slate-500 mb-8 text-center max-w-md">We encountered an issue processing your request. Please check your connection and try again.</p>
              <button onClick={resetApp} className="bg-slate-900 text-white px-8 py-3 rounded font-bold uppercase tracking-wide hover:bg-slate-800 transition-colors shadow-md">
                 Try Again
              </button>
           </div>
        )}
      </main>

      <footer className="mt-20 py-10 bg-slate-900 text-slate-400 text-center">
         <div className="max-w-7xl mx-auto px-6">
            <p className="font-black text-2xl text-white mb-2">GCI TIRE</p>
            <p className="text-sm mb-6">Expert Service. Guaranteed Fitment. Best Prices.</p>
            <div className="border-t border-slate-800 pt-6 flex justify-center gap-8 text-xs uppercase tracking-widest font-bold mb-4">
               <a href="https://www.gcitires.com/pages/installer-application" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">{t.installerOnboarding} <span className="text-red-600 ml-1">{t.joinNetwork}</span></a>
               <a href="https://www.gcitires.com/policies/privacy-policy" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Privacy</a>
               <a href="https://www.gcitires.com/policies/terms-of-service" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Terms</a>
            </div>
            <p className="text-[10px] text-slate-600 font-mono">v2.3.1 (Maps Integration)</p>
         </div>
      </footer>

      {activeModal === 'reviews' && reviewTire && (
        <ReviewsModal tire={reviewTire} onClose={() => setActiveModal(null)} />
      )}
      
      {activeModal === 'compare' && (
        <ComparisonModal 
          tires={compareList} 
          onClose={() => setActiveModal(null)} 
          onSelect={(tire) => {
            setActiveModal(null);
            handleSelectTire(tire, 4, false, tire.pricePerUnit * 4);
          }}
        />
      )}

      {activeModal === 'favorites' && (
        <FavoritesModal 
          favorites={favorites} 
          onClose={() => setActiveModal(null)}
          onRemove={(id) => setFavorites(favorites.filter(f => f.id !== id))}
          onSelect={(tire) => {
             setActiveModal(null);
             handleSelectTire(tire, 4, false, tire.pricePerUnit * 4);
          }}
        />
      )}
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
