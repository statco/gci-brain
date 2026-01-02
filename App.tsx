import { BrowserRouter, Routes, Route } from 'react-router-dom';
import InstallerApplicationForm from './components/InstallerApplicationForm';
import React, { useState, useEffect } from 'react';
import { useJsApiLoader } from '@react-google-maps/api'; // ✅ Added Loader
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

// Define required Google Maps libraries
const LIBRARIES: ("marker" | "maps" | "places")[] = ["marker", "maps", "places"];

// Main AI Match App Component
function TireMatchApp() {
  const [appState, setAppState] = useState<AppStates>(AppStates.IDLE);
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  const [recommendations, setRecommendations] = useState<TireProduct[]>([]);
  const [selectedTire, setSelectedTire] = useState<{ tire: TireProduct; quantity: number; withInstallation: boolean; total: number } | null>(null);

  // New Features State
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

  // Load state from local storage on mount
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
      } catch (e) {
        console.error("Failed to load state", e);
      }
    }
  }, []);

  // Save state to local storage on change
  useEffect(() => {
    const sanitizeTire = (tire: TireProduct): TireProduct => {
      const clone = { ...tire };
      if (clone.visualizationUrl?.startsWith('data:')) clone.visualizationUrl = undefined;
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
      console.warn("LocalStorage Quota Exceeded", e);
    }
  }, [appState, recommendations, selectedTire, favorites, compareList, lang]);

  const t = translations[lang];

  const startProcessing = async (request: string) => {
    setAppState(AppStates.PROCESSING);
    setLogs([
      { stage: ProcessingStages.ANALYZING, message: lang === 'en' ? "Consulting expert databases..." : "Consultation des bases d'experts...", status: 'active' },
      { stage: ProcessingStages.VALIDATING, message: lang === 'en' ? "Verifying fitment with DriveRightData..." : "Vérification DriveRightData...", status: 'pending' },
      { stage: ProcessingStages.INVENTORY, message: lang === 'en' ? "Checking GCI Tire inventory..." : "Vérification de l'inventaire GCI...", status: 'pending' }
    ]);

    try {
      const products = await getTireRecommendations(request, lang);
      setRecommendations(products);
      setAppState(AppStates.RESULTS);
    } catch (error) {
      setAppState(AppStates.ERROR);
    }
  };

  const handleSelectTire = (tire: TireProduct, quantity: number, withInstallation: boolean, total: number) => {
    setSelectedTire({ tire, quantity, withInstallation, total });
    setAppState(AppStates.CHECKOUT);
  };

  const resetApp = () => {
    setAppState(AppStates.IDLE);
    setRecommendations([]);
    setSelectedTire(null);
    setCompareList([]);
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 pb-20 relative font-sans flex flex-col">
      <nav className="bg-white border-b border-slate-200 py-4 px-6 mb-8 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
            <div className="flex items-center gap-2 cursor-pointer" onClick={resetApp}>
                <div className="w-10 h-10 bg-red-600 rounded flex items-center justify-center text-white font-black text-xl">G</div>
                <div className="flex flex-col leading-none">
                    <span className="font-black text-lg tracking-tighter text-slate-900">GCI TIRE</span>
                    <span className="text-xs font-bold text-red-600 tracking-widest uppercase">AI Match 2.0</span>
                </div>
            </div>
            
            <div className="flex items-center gap-6">
                <button onClick={() => setActiveModal('favorites')} className="relative text-slate-600 hover:text-red-600 transition-colors">
                   <svg className="w-6 h-6" fill={favorites.length > 0 ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                   {favorites.length > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 text-white text-[10px] rounded-full flex items-center justify-center font-bold">{favorites.length}</span>}
                </button>
                <a href="https://www.gcitires.com" className="hidden sm:block text-sm font-bold text-slate-600 hover:text-red-600 uppercase tracking-wide">{t.backStore}</a>
                {appState !== AppStates.IDLE && (
                    <button onClick={resetApp} className="text-sm font-bold text-slate-500 hover:text-slate-800 uppercase tracking-wide">{t.startOver}</button>
                )}
            </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 flex-grow w-full">
        {appState === AppStates.IDLE && (
          <div className="animate-fade-in-up mt-10">
            <InputForm onSubmit={startProcessing} isLoading={false} lang={lang} setLang={setLang} />
          </div>
        )}

        {appState === AppStates.PROCESSING && <ProcessingOverlay logs={logs} />}

        {appState === AppStates.RESULTS && (
          <div className="animate-fade-in-up">
            <h2 className="text-3xl font-black text-slate-900 mb-8 uppercase tracking-tight">{t.resultsTitle}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {recommendations.map((tire) => (
                <TireCard 
                    key={tire.id} 
                    tire={tire} 
                    onSelect={handleSelectTire}
                    isFavorite={favorites.some(f => f.id === tire.id)}
                    onToggleFavorite={(t) => setFavorites(prev => prev.some(f => f.id === t.id) ? prev.filter(f => f.id !== t.id) : [...prev, t])}
                    isCompareSelected={compareList.some(c => c.id === tire.id)}
                    onToggleCompare={(t) => setCompareList(prev => prev.some(c => c.id === t.id) ? prev.filter(c => c.id !== t.id) : [...prev, t])}
                    onShowReviews={(t) => {setReviewTire(t); setActiveModal('reviews');}}
                    lang={lang}
                />
              ))}
            </div>
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
           <SuccessView 
              selectedTire={selectedTire}
              onReset={resetApp}
              lang={lang}
              mapsLoaded={isLoaded} // ✅ Passing Maps Status
           />
        )}

        {appState === AppStates.ERROR && (
           <div className="flex flex-col items-center justify-center min-h-[50vh]">
              <h3 className="text-2xl font-black text-slate-900 mb-2">Something went wrong</h3>
              <button onClick={resetApp} className="bg-slate-900 text-white px-8 py-3 rounded font-bold uppercase">Try Again</button>
           </div>
        )}
      </main>

      {activeModal === 'reviews' && reviewTire && <ReviewsModal tire={reviewTire} onClose={() => setActiveModal(null)} />}
      {activeModal === 'compare' && <ComparisonModal tires={compareList} onClose={() => setActiveModal(null)} onSelect={(t) => handleSelectTire(t, 4, false, t.pricePerUnit * 4)} />}
      {activeModal === 'favorites' && <FavoritesModal favorites={favorites} onClose={() => setActiveModal(null)} onRemove={(id) => setFavorites(f => f.filter(x => x.id !== id))} onSelect={(t) => handleSelectTire(t, 4, false, t.pricePerUnit * 4)} />}
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
