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
  const t = translations[lang];

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
    setAppointment({ date, time, installer: selectedInstaller || undefined });
  };

  const confirmationNumber = React.useMemo(() => `TM-${Math.floor(Math.random() * 1000000)}`, []);

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
                      <div className="space-y-2">
                         <div className="flex justify-between items-end">
                            <p className="text-xs font-bold text-slate-400 uppercase">Select Authorized Installer</p>
                            <button onClick={handleInstallerJoin} className="text-[10px] text-red-600 hover:underline font-bold uppercase">{t.joinNetwork}</button>
                         </div>
                         {loadingInstallers ? (
                            <div className="text-center py-4"><span className="animate-spin inline-block w-4 h-4 border-2 border-red-600 rounded-full border-t-transparent"></span></div>
                         ) : (
                            installers.map(installer => (
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
                            ))
                         )}
                      </div>
                    )}

                    {selectedInstaller && (
                         <div className="bg-slate-900 text-white p-3 rounded flex justify-between items-center">
                            <div>
                               <div className="text-xs text-slate-400 uppercase">Selected Installer</div>
                               <div className="font-bold text-sm">{selectedInstaller.name}</div>
                            </div>
                            <button onClick={() => setSelectedInstaller(null)} className="text-xs text-slate-300 hover:text-white underline">Change</button>
                         </div>
                    )}

                    {selectedInstaller && (
                        <BookingCalendar onBook={handleBook} />
                    )}
                </div>
            )}
        </div>
      </div>

      <div className="flex justify-center gap-4">
        <button 
            onClick={onReset}
            className="text-slate-500 hover:text-red-600 font-bold text-sm transition-colors hover:underline uppercase tracking-wide"
        >
            {t.startOver}
        </button>
      </div>
    </div>
  );
};

export default SuccessView;