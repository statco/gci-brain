import React, { useEffect } from 'react';
import type { TireProduct, Language } from '../types';
import { translations } from '../utils/translations';

interface SuccessViewProps {
  selectedTire: {
    tire: TireProduct;
    quantity: number;
    withInstallation: boolean;
    total: number;
    orderNumber?: string;
    installer?: {
      name: string;
      phone: string;
      city: string;
    };
  };
  onReset: () => void;
  lang: Language;
  mapsLoaded?: boolean;
}

const SuccessView: React.FC<SuccessViewProps> = ({ selectedTire, onReset, lang }) => {
  const t = translations[lang];
  const isFr = lang === 'fr';
  const { tire, quantity, withInstallation, total, orderNumber, installer } = selectedTire;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-12 animate-fade-in">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-xl overflow-hidden">

        {/* Success header */}
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 p-8 text-center text-white">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-9 h-9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-black uppercase tracking-tight mb-1">
            {isFr ? 'Commande confirmée !' : 'Order Confirmed!'}
          </h1>
          {orderNumber && (
            <p className="text-green-100 font-mono text-sm">{orderNumber}</p>
          )}
        </div>

        <div className="p-6 space-y-5">
          {/* Order summary */}
          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase font-semibold mb-2">
              {isFr ? 'Récapitulatif' : 'Order Summary'}
            </p>
            <p className="font-bold text-slate-900">{tire.brand} {tire.model}</p>
            <p className="text-sm text-slate-600">{tire.size} × {quantity}</p>
            <div className="flex justify-between mt-3 pt-3 border-t border-slate-200">
              <span className="font-bold text-slate-900">{isFr ? 'Total' : 'Total'}</span>
              <span className="font-black text-lg text-slate-900">${total.toFixed(2)}</span>
            </div>
          </div>

          {/* Confirmation email notice */}
          <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl p-4">
            <span className="text-2xl">📧</span>
            <div>
              <p className="font-semibold text-blue-900 text-sm">
                {isFr ? 'Confirmation envoyée par courriel' : 'Confirmation sent to your email'}
              </p>
              <p className="text-xs text-blue-600 mt-0.5">
                {isFr
                  ? 'Vérifiez votre boîte de réception pour les détails.'
                  : 'Check your inbox for order details.'}
              </p>
            </div>
          </div>

          {/* Installer contact — only if installation was chosen */}
          {withInstallation && installer && (
            <div className="border-2 border-red-100 bg-red-50 rounded-xl p-4">
              <p className="text-xs text-red-600 uppercase font-bold mb-3">
                📅 {isFr ? 'Prochaine étape : Prendre rendez-vous' : 'Next Step: Book Your Appointment'}
              </p>
              <p className="font-bold text-slate-900 mb-1">{installer.name}</p>
              <p className="text-sm text-slate-600 mb-3">{installer.city}</p>

              <div className="space-y-2">
                <a
                  href={`tel:${installer.phone.replace(/\D/g,'')}`}
                  className="flex items-center gap-3 bg-white border border-red-200 rounded-lg px-4 py-3 hover:bg-red-50 transition group"
                >
                  <span className="text-xl">📞</span>
                  <div>
                    <p className="text-xs text-slate-400 font-semibold uppercase">
                      {isFr ? 'Appeler pour un rendez-vous' : 'Call to book'}
                    </p>
                    <p className="font-bold text-slate-900 group-hover:text-red-600 transition">
                      {installer.phone}
                    </p>
                  </div>
                </a>
              </div>

              <p className="text-xs text-slate-400 mt-3">
                {isFr
                  ? `Mentionnez votre numéro de commande ${orderNumber ?? ''} lors de votre appel.`
                  : `Mention your order number ${orderNumber ?? ''} when you call.`}
              </p>
            </div>
          )}

          {/* Delivery only */}
          {!withInstallation && (
            <div className="flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
              <span className="text-2xl">🚚</span>
              <div>
                <p className="font-semibold text-slate-900 text-sm">
                  {isFr ? 'Livraison gratuite partout au Canada' : 'Free shipping across Canada'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isFr
                    ? 'Délai habituel : 2 à 5 jours ouvrables selon votre province.'
                    : 'Typical delivery: 2–5 business days depending on your province.'}
                </p>
              </div>
            </div>
          )}

          {/* Reset button */}
          <button
            onClick={onReset}
            className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl hover:bg-slate-700 transition uppercase tracking-wide text-sm"
          >
            {t.startOver || (isFr ? 'Nouvelle recherche' : 'New Search')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SuccessView;
