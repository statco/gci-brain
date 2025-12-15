import React, { useState, useEffect } from 'react';
import InputForm from './components/InputForm';
import ProcessingOverlay from './components/ProcessingOverlay';
import TireCard from './components/TireCard';
import CheckoutModal from './components/CheckoutModal';
import SuccessView from './components/SuccessView';
import ReviewsModal from './components/ReviewsModal';
import ComparisonModal from './components/ComparisonModal';
import FavoritesModal from './components/FavoritesModal';
import { getTireRecommendations } from './services/geminiService';
import { AppState, ProcessingLog, ProcessingStage, TireProduct, Language } from './types';
import { translations } from './utils/translations';

// UPDATE THIS VERSION WHENEVER YOU DEPLOY A NEW BUILD TO FORCE STATE RESET
const APP_VERSION = '2.2.0'; 

function App() {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  const [recommendations, setRecommendations] = useState<TireProduct[]>([]);
  const [selectedTire, setSelectedTire] = useState<{ tire: TireProduct; quantity: number; withInstallation: boolean; total: number } | null>(null);

  // New Features State
  const [favorites, setFavorites] = useState<TireProduct[]>([]);
  const [compareList, setCompareList] = useState<TireProduct[]>([]);
  const [activeModal, setActiveModal] = useState<'reviews' | 'compare' | 'favorites' | null>(null);
  const [reviewTire, setReviewTire] = useState<TireProduct | null>(null);
  const [lang, setLang] = useState<Language>('en');
  const [isNewVersion, setIsNewVersion] = useState(false);

  // Debugging & Versioning
  useEffect(() => {
    console.log(`GCI Tire Match App v${APP_VERSION} Loaded`);
  }, []);

  // 1. Load state from local storage on mount (Persistence) with Version Check
  useEffect(() => {
    const savedVersion = localStorage.getItem('gci_app_version');
    const savedState = localStorage.getItem('gci_app_state_v2');

    // If version mismatch, clear old state to ensure users see the new app structure
    if (savedVersion !== APP_VERSION) {
        console.log("New version detected. Clearing stale cache.");
        localStorage.removeItem('gci_app_state_v2');
        localStorage.setItem('gci_app_version', APP_VERSION);
        setIsNewVersion(true);
        // We preserve favorites if possible in a real app, but for now we reset to ensure cleanliness
    } else if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        
        // Restore language preference
        if (parsed.lang) setLang(parsed.lang);

        // Restore favorites and compare list
        if (parsed.favorites) setFavorites(parsed.favorites);
        if (parsed.compareList) setCompareList(parsed.compareList);

        // Only restore main app flow if not in a transient state
        if (parsed.appState && parsed.appState !== AppState.IDLE && parsed.appState !== AppState.PROCESSING && parsed.appState !== AppState.ERROR) {
           setAppState(parsed.appState);
           if (parsed.recommendations) setRecommendations(parsed.recommendations);
           if (parsed.selectedTire) setSelectedTire(parsed.selectedTire);
        }
      } catch (e) {
        console.error("Failed to load state", e);
      }
    }
  }, []);

  // 2. Save state to local storage on change
  useEffect(() => {
    const stateToSave = {
      // If currently processing, save as IDLE to avoid getting stuck on reload
      appState: (appState === AppState.PROCESSING || appState === AppState.ERROR) ? AppState.IDLE : appState, 
      recommendations,
      selectedTire,
      favorites,
      compareList,
      lang
    };
    localStorage.setItem('gci_app_state_v2', JSON.stringify(stateToSave));
    localStorage.setItem('gci_app_version', APP_VERSION);
  }, [appState, recommendations, selectedTire, favorites, compareList, lang]);

  // 3. Sync language with URL parameters (Shopify integration) - Priority over storage
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
    }
  }, []);

  const t = translations[lang];

  const startProcessing = async (request: string) => {
    setAppState(AppState.PROCESSING);
    
    // Initialize logs
    const initialLogs: ProcessingLog[] = [
      { stage: ProcessingStage.ANALYZING, message: lang === 'en' ? "Consulting expert databases..." : "Consultation des bases d'experts...", status: 'active' },
      { stage: ProcessingStage.VALIDATING, message: lang === 'en' ? "Verifying fitment with DriveRightData..." : "Vérification DriveRightData...", status: 'pending' },
      { stage: ProcessingStage.INVENTORY, message: lang === 'en' ? "Checking GCI Tire inventory..." : "Vérification de l'inventaire GCI...", status: 'pending' }
    ];
    setLogs(initialLogs);

    try {
      const products = await getTireRecommendations(request, lang);

      // Simulation Steps
      setLogs(prev => prev.map(log => 
        log.stage === ProcessingStage.ANALYZING ? { ...log, status: 'completed' } :
        log.stage === ProcessingStage.VALIDATING ? { ...log, status: 'active' } : log
      ));
      await new Promise(resolve => setTimeout(resolve, 1500));

      setLogs(prev => prev.map(log => 
        log.stage === ProcessingStage.VALIDATING ? { ...log, status: 'completed' } :
        log.stage === ProcessingStage.INVENTORY ? { ...log, status: 'active' } : log
      ));
      await new Promise(resolve => setTimeout(resolve, 1200));

      setLogs(prev => prev.map(log => ({ ...log, status: 'completed' })));
      await new Promise(resolve => setTimeout(resolve, 500));

      setRecommendations(products);
      setAppState(AppState.RESULTS);

    } catch (error) {
      console.error(error);
      setAppState(AppState.ERROR);
      alert("We encountered an issue finding tires. Please try again.");
      setAppState(AppState.IDLE);
    }
  };

  const handleSelectTire = (tire: TireProduct, quantity: number, withInstallation: boolean, total: number) => {
    setSelectedTire({ tire, quantity, withInstallation, total });
    setAppState(AppState.CHECKOUT);
  };

  const handlePurchaseComplete = () => {
    setAppState(AppState.SUCCESS);
  };

  const resetApp = () => {
    setAppState(AppState.IDLE);
    setRecommendations([]);
    setSelectedTire(null);
    setCompareList([]);
    setLogs([]);
    // Note: We intentionally do NOT clear favorites here
  };

  // Feature Handlers
  const toggleFavorite = (tire: TireProduct) => {
    if (favorites.some(f => f.id === tire.id)) {
      setFavorites(favorites.filter(f => f.id !== tire.id));
    } else {
      setFavorites([...favorites, tire]);
    }
  };

  const toggleCompare = (tire: TireProduct) => {
    if (compareList.some(c => c.id === tire.id)) {
      setCompareList(compareList.filter(c => c.id !== tire.id));
    } else {
      if (compareList.length >= 3) {
        alert("You can compare up to 3 tires at a time.");
        return;
      }
      setCompareList([...compareList, tire]);
    }
  };

  const openReviews = (tire: TireProduct) => {
    setReviewTire(tire);
    setActiveModal('reviews');
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 pb-20 relative font-sans flex flex-col">
      
      {/* Header / Nav */}
      <nav className="bg-white border-b border-slate-200 py-4 px-6 mb-8 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
            <div className="flex items-center gap-2 cursor-pointer group" onClick={resetApp}>
                <div className="w-10 h-10 bg-red-600 rounded flex items-center justify-center text-white font-black text-xl shadow-sm relative overflow-hidden">
                    <span className="relative z-10">G</span>
                    <div className="absolute inset-0 bg-gradient-to-tr from-red-700 to-red-500"></div>
                </div>
                <div className="flex flex-col leading-none">
                    <span className="font-black text-lg tracking-tighter text-slate-900">GCI TIRE</span>
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-red-600 tracking-widest">AI MATCH 2.0</span>
                        {isNewVersion && <span className="bg-blue-600 text-white text-[8px] px-1 rounded uppercase font-bold animate-pulse">New</span>}
                    </div>
                </div>
            </div>
            
            <div className="flex items-center gap-6">
                <button 
                  onClick={() => setActiveModal('favorites')}
                  className="relative text-slate-600 hover:text-red-600 transition-colors"
                  title="View Favorites"
                >
                   <svg className="w-6 h-6" fill={favorites.length > 0 ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                   {favorites.length > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 text-white text-[10px] rounded-full flex items-center justify-center font-bold">{favorites.length}</span>}
                </button>
                <a href="https://www.gcitires.com" className="hidden sm:block text-sm font-bold text-slate-600 hover:text-red-600 transition-colors uppercase tracking-wide">
                    {t.backStore}
                </a>
                {appState !== AppState.IDLE && (
                    <button onClick={resetApp} className="text-sm font-bold text-slate-500 hover:text-slate-800 uppercase tracking-wide">{t.startOver}</button>
                )}
            </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 flex-grow w-full">
        
        {appState === AppState.IDLE && (
          <div className="animate-fade-in-up mt-10">
            <InputForm onSubmit={startProcessing} isLoading={false} lang={lang} setLang={setLang} />
          </div>
        )}

        {appState === AppState.PROCESSING && (
          <ProcessingOverlay logs={logs} />
        )}

        {appState === AppState.RESULTS && (
          <div className="animate-fade-in-up">
            <div className="flex justify-between items-end mb-8 border-b border-slate-200 pb-4">
               <div>
                  <h2 className="text-3xl font-black text-slate-900 mb-2 uppercase tracking-tight">{t.resultsTitle}</h2>
                  <p className="text-slate-500 font-medium">{t.resultsSubtitle}</p>
               </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {recommendations.map((tire) => (
                <TireCard 
                    key={tire.id} 
                    tire={tire} 
                    onSelect={handleSelectTire}
                    isFavorite={favorites.some(f => f.id === tire.id)}
                    onToggleFavorite={toggleFavorite}
                    isCompareSelected={compareList.some(c => c.id === tire.id)}
                    onToggleCompare={toggleCompare}
                    onShowReviews={openReviews}
                    lang={lang}
                />
              ))}
            </div>
          </div>
        )}

        {/* Floating Compare Bar */}
        {compareList.length > 0 && appState === AppState.RESULTS && (
          <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-slate-900 text-white px-6 py-4 rounded shadow-2xl z-40 flex items-center gap-6 animate-fade-in-up border-b-4 border-red-600">
            <span className="font-bold text-sm">{compareList.length} tire{compareList.length > 1 ? 's' : ''} selected</span>
            <div className="h-4 w-px bg-slate-700"></div>
            <button 
              onClick={() => setActiveModal('compare')}
              className="font-bold text-red-500 hover:text-red-400 text-sm uppercase tracking-wider"
            >
              {t.compare}
            </button>
            <button onClick={() => setCompareList([])} className="text-slate-500 hover:text-white">
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        )}

        {appState === AppState.CHECKOUT && selectedTire && (
          <CheckoutModal 
            tire={selectedTire.tire}
            quantity={selectedTire.quantity}
            withInstallation={selectedTire.withInstallation}
            total={selectedTire.total}
            onConfirm={handlePurchaseComplete}
            onCancel={() => setAppState(AppState.RESULTS)}
            lang={lang}
          />
        )}

        {appState === AppState.SUCCESS && selectedTire && (
           <SuccessView 
              selectedTire={selectedTire}
              onReset={resetApp}
              lang={lang}
           />
        )}
      </main>

      <footer className="mt-20 py-10 bg-slate-900 text-slate-400 text-center">
         <div className="max-w-7xl mx-auto px-6">
            <p className="font-black text-2xl text-white mb-2">GCI TIRE</p>
            <p className="text-sm mb-6">Expert Service. Guaranteed Fitment. Best Prices.</p>
            <div className="border-t border-slate-800 pt-6 flex justify-center gap-8 text-xs uppercase tracking-widest font-bold mb-4">
               <a href="#" className="hover:text-white transition-colors">{t.installerOnboarding} <span className="text-red-600 ml-1">{t.joinNetwork}</span></a>
               <a href="#" className="hover:text-white transition-colors">Privacy</a>
               <a href="#" className="hover:text-white transition-colors">Terms</a>
            </div>
            <p className="text-[10px] text-slate-600 font-mono">v{APP_VERSION} (Live Build)</p>
         </div>
      </footer>

      {/* Modals */}
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
    </div>
  );
}

export default App;