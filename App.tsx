import { BrowserRouter, Routes, Route } from 'react-router-dom';
import InstallerApplicationForm from './components/InstallerApplicationForm';
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

// Main AI Match App Component
function TireMatchApp() {
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

  // 1. Load state from local storage on mount (Persistence)
  useEffect(() => {
    const savedState = localStorage.getItem('gci_app_state_v2');
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        
        if (parsed.lang) setLang(parsed.lang);
        if (parsed.favorites) setFavorites(parsed.favorites);
        if (parsed.compareList) setCompareList(parsed.compareList);

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
    const sanitizeTire = (tire: TireProduct): TireProduct => {
      const clone = { ...tire };
      if (clone.visualizationUrl && clone.visualizationUrl.startsWith('data:')) {
        clone.visualizationUrl = undefined;
      }
      return clone;
    };

    const stateToSave = {
      appState: (appState === AppState.PROCESSING) ? AppState.IDLE : appState, 
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
        const minimalState = { lang, appState: AppState.IDLE };
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
    }
  }, []);

  const t = translations[lang];

  const startProcessing = async (request: string) => {
    setAppState(AppState.PROCESSING);
    
    const initialLogs: ProcessingLog[] = [
      { stage: ProcessingStage.ANALYZING, message: lang === 'en' ? "Consulting expert databases..." : "Consultation des bases d'experts...", status: 'active' },
      { stage: ProcessingStage.VALIDATING, message: lang === 'en' ? "Verifying fitment with DriveRightData..." : "Vérification DriveRightData...", status: 'pending' },
      { stage: ProcessingStage.INVENTORY, message: lang === 'en' ? "Checking GCI Tire inventory..." : "Vérification de l'inventaire GCI...", status: 'pending' }
    ];
    setLogs(initialLogs);

    try {
      const products = await getTireRecommendations(request, lang);

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
  };

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
                    <span className="text-xs font-bold text-red-600 tracking-widest">AI MATCH 2.0</span>
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
            
            {recommendations.length > 0 ? (
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
            ) : (
                <div className="bg-white rounded-lg p-10 text-center border border-slate-200 shadow-sm">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 mb-2">No tires found</h3>
                    <p className="text-slate-500 mb-6 max-w-md mx-auto">We couldn't find any tires in our inventory matching your specific criteria. Try broadening your search terms.</p>
                    <button onClick={resetApp} className="text-red-600 font-bold uppercase tracking-wide hover:underline">Try New Search</button>
                </div>
            )}
          </div>
        )}

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

        {appState === AppState.ERROR && (
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
            <p className="text-[10px] text-slate-600 font-mono">v2.3.0 (Live Build)</p>
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
    </div>
  );
}

// Main App with Router
function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Main AI Match Route */}
        <Route path="/" element={<TireMatchApp />} />
        
        {/* Installer Application Route */}
        <Route path="/installer-application" element={<InstallerApplicationForm />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
