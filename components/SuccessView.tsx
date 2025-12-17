import React, { useState, useEffect } from 'react';
import { TireProduct, Language, Installer } from '../types';
import { fetchInstallers } from '../services/integrationService';
import BookingCalendar from './BookingCalendar';
import { translations } from '../utils/translations';

interface SuccessViewProps {
  selectedTire: {
    tire: TireProduct;
    quantity: number;
    withInstallation: boolean;
    total: number;
  };
  onReset: () => void;
  lang: Language;
}

const SuccessView: React.FC<SuccessViewProps> = ({ selectedTire, onReset, lang }) => {
  const [appointment, setAppointment] = useState<{ date: Date; time: string; installer?: Installer } | null>(null);
  const [installers, setInstallers] = useState<Installer[]>([]);
  const [selectedInstaller, setSelectedInstaller] = useState<Installer | null>(null);
  const [loadingInstallers, setLoadingInstallers] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const t = translations[lang];

  // Persistent Order ID logic
  const [confirmationNumber] = useState(() => {
    const saved = localStorage.getItem('gci_current_order_id');
    if (saved) return saved;
    const newId = `TM-${Math.floor(Math.random() * 1000000)}`;
    localStorage.setItem('gci_current_order_id', newId);
    return newId;
  });

  // Restore Appointment state if exists (for page reloads)
  useEffect(() => {
    const savedAppt = localStorage.getItem('gci_current_appointment');
    if (savedAppt) {
      try {
        const parsed = JSON.parse(savedAppt);
        // Date objects are strings after JSON.parse
        parsed.date = new Date(parsed.date); 
        setAppointment(parsed);
        // Pre-select the installer so if they reschedule, it's there
        if (parsed.installer) setSelectedInstaller(parsed.installer);
      } catch (e) {
        console.error("Failed to restore appointment", e);
      }
    }
  }, []);

  useEffect(() => {
    if (selectedTire.withInstallation) {
      setLoadingInstallers(true);
      fetchInstallers().then(data => {
        setInstallers(data);
        setLoadingInstallers(false);
      });
    }
  }, [selectedTire.withInstallation]);

  const handleBook = (date: Date, time: string) => {
    const newAppointment = { date, time, installer: selectedInstaller || undefined };
    setAppointment(newAppointment);
    localStorage.setItem('gci_current_appointment', JSON.stringify(newAppointment));
  };

  const handleFullReset = () => {
    localStorage.removeItem('gci_current_order_id');
    localStorage.removeItem('gci_current_appointment');
    onReset();
  };

  // Handler for installer onboarding (simulation)
  const handleInstallerJoin = () => {
    const email = prompt(lang === 'fr' ? "Entrez votre email professionnel :" : "Enter your business email:");
    if (email) {
      alert(lang === 'fr' 
        ? "Merci ! Un lien d'intégration a été envoyé à " + email 
        : "Thank you! An onboarding link has been sent to " + email);
    }
  };

  return (
    <div className="max-w-2xl mx-auto mt-10 text-center animate-fade-in-up bg-white p-8 md:p-12 rounded-lg shadow-xl border-t-4 border-green-500">
      <div className="w-20 h-20 md:w-24 md:h-24 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
        <svg className="w-10 h-10 md:w-12 md:h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      
      <h2 className="text-3xl md:text-4xl font-black text-slate-900 mb-4 uppercase tracking-tight">{t.orderConfirmed}</h2>
      <p className="text-lg md:text-xl text-slate-600 mb-8">
        {t.orderReceived} <span className="font-bold text-slate-900">{selectedTire.tire.brand} {selectedTire.tire.model}</span>
      </p>

      <div className="bg-slate-50 p-6 rounded mb-8 text-left max-w-md mx-auto border border-slate-200">
        <div className="flex justify-between items-center mb-4">
            <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide font-bold">Order Number</p>
                <p className="font-mono text-lg font-bold text-slate-800">{confirmationNumber}</p>
            </div>
            <div className="text-right">
                <p className="text-xs text-slate-500 uppercase tracking-wide font-bold">Total Paid</p>
                <p className="font-bold text-slate-800">${(selectedTire.total * 1.08).toFixed(2)}</p>
            </div>
        </div>

        {/* Installation Status Section */}
        <div className="mt-4 pt-4 border-t border-slate-200">
            <p className="text-xs text-slate-500 uppercase tracking-wide font-bold mb-2">{t.installStatus}</p>
            
            {!selectedTire.withInstallation ? (
                <div className="flex items-center gap-2 text-slate-600 bg-white p-3 rounded border border-slate-200">
                    <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
                    <span className="text-sm font-medium">{t.shippedHome}</span>
                </div>
            ) : appointment ? (
                <div className="bg-green-50 border border-green-200 p-4 rounded flex items-start gap-3 animate-fade-in-up">
                    <div className="mt-1 bg-green-100 p-1 rounded-full">
                        <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </div>
                    <div>
                        <p className="text-sm font-bold text-green-800">Appointment Confirmed</p>
                        <p className="text-sm text-green-700 font-medium">
                            {appointment.date.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                            <br />
                            at {appointment.time}
                        </p>
                        {appointment.installer && (
                             <p className="text-xs font-bold text-green-800 mt-1 uppercase">{appointment.installer.name}</p>
                        )}
                        <p className="text-xs text-green-600 mt-1">Calendar Updated & Email Sent</p>
                        <button onClick={() => setAppointment(null)} className="text-[10px] text-green-600 underline mt-2 hover:text-green-800">Reschedule</button>
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="bg-yellow-50 border border-yellow-200 p-3 rounded flex items-center gap-2 text-yellow-800 text-sm font-medium">
                        <svg className="w-5 h-5 text-yellow-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span>{t.bookInstall}</span>
                    </div>

                    {/* Installer Selection */}
                    {!selectedInstaller && (
                      <div className="space-y-2 animate-fade-in-up">
                         <div className="flex justify-between items-end mb-2">
                            <p className="text-xs font-bold text-slate-400 uppercase">Select Authorized Installer</p>
                            
                            {/* View Toggle */}
                            <div className="flex bg-slate-100 rounded p-0.5 border border-slate-200">
                                <button 
                                  onClick={() => setViewMode('list')}
                                  className={`px-3 py-1 text-[10px] font-bold rounded uppercase transition-all ${viewMode === 'list' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
                                >
                                  List
                                </button>
                                <button 
                                  onClick={() => setViewMode('map')}
                                  className={`px-3 py-1 text-[10px] font-bold rounded uppercase transition-all flex items-center gap-1 ${viewMode === 'map' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
                                >
                                  Map
                                </button>
                            </div>
                         </div>

                         {loadingInstallers ? (
                            <div className="text-center py-4"><span className="animate-spin inline-block w-4 h-4 border-2 border-red-600 rounded-full border-t-transparent"></span></div>
                         ) : (
                            <>
                                {/* LIST VIEW */}
                                {viewMode === 'list' && (
                                    <div className="space-y-2">
                                        {installers.map(installer => (
                                        <button 
                                            key={installer.id}
                                            onClick={() => setSelectedInstaller(installer)}
                                            className="w-full text-left p-3 border border-slate-200 rounded hover:border-red-400 hover:bg-slate-50 transition-all group"
                                        >
                                            <div className="flex justify-between">
                                                <span className="font-bold text-slate-800 group-hover:text-red-700">{installer.name}</span>
                                                <span className="text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-500">{installer.distance}</span>
                                            </div>
                                            <div className="text-xs text-slate-500">{installer.address}</div>
                                        </button>
                                        ))}
                                    </div>
                                )}

                                {/* MAP VIEW */}
                                {viewMode === 'map' && (
                                    <div className="relative w-full h-64 bg-slate-200 rounded border border-slate-300 overflow-hidden group">
                                        {/* Mock Map Background - Using a subtle pattern or image */}
                                        <div 
                                            className="absolute inset-0 opacity-40 bg-cover bg-center grayscale"
                                            style={{ backgroundImage: 'url("https://images.unsplash.com/photo-1524661135-423995f22d0b?auto=format&fit=crop&w=600&q=80")' }}
                                        ></div>
                                        
                                        {/* Map Overlay Text (Simulated) */}
                                        <div className="absolute top-2 left-2 bg-white/80 backdrop-blur px-2 py-1 rounded text-[10px] font-bold text-slate-600 shadow-sm pointer-events-none">
                                            Simulated Map View
                                        </div>

                                        {/* Pins */}
                                        {installers.map(installer => (
                                            <div 
                                                key={installer.id}
                                                className="absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer group/pin"
                                                style={{ 
                                                    top: `${installer.mapPosition?.top || 50}%`, 
                                                    left: `${installer.mapPosition?.left || 50}%` 
                                                }}
                                                onClick={() => setSelectedInstaller(installer)}
                                            >
                                                {/* Pin Icon */}
                                                <div className="text-red-600 hover:text-red-700 hover:scale-125 transition-transform filter drop-shadow-md">
                                                   <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                                                </div>
                                                
                                                {/* Tooltip */}
                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/pin:block whitespace-nowrap z-10">
                                                    <div className="bg-slate-900 text-white text-xs py-1 px-2 rounded shadow-lg flex flex-col items-center">
                                                        <span className="font-bold">{installer.name}</span>
                                                        <span className="text-[10px] opacity-80">{installer.distance}</span>
                                                        <div className="w-2 h-2 bg-slate-900 transform rotate-45 -mt-1 absolute -bottom-1"></div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                         )}
                         <div className="text-right mt-2">
                             <button onClick={handleInstallerJoin} className="text-[10px] text-red-600 hover:underline font-bold uppercase">{t.joinNetwork}</button>
                         </div>
                      </div>
                    )}

                    {selectedInstaller && (
                         <div className="bg-slate-900 text-white p-3 rounded flex justify-between items-center animate-fade-in-up">
                            <div>
                               <div className="text-xs text-slate-400 uppercase">Selected Installer</div>
                               <div className="font-bold text-sm">{selectedInstaller.name}</div>
                            </div>
                            <button onClick={() => setSelectedInstaller(null)} className="text-xs text-slate-300 hover:text-white underline">Change</button>
                         </div>
                    )}

                    {selectedInstaller && (
                        <div className="animate-fade-in-up">
                           <BookingCalendar onBook={handleBook} />
                        </div>
                    )}
                </div>
            )}
        </div>
      </div>

      <div className="flex justify-center gap-4">
        <button 
            onClick={handleFullReset}
            className="text-slate-500 hover:text-red-600 font-bold text-sm transition-colors hover:underline uppercase tracking-wide"
        >
            {t.startOver}
        </button>
      </div>
    </div>
  );
};

export default SuccessView;