import React, { useState } from 'react';
import { TireProduct, Language } from '../types';
import { translations } from '../utils/translations';

interface CheckoutModalProps {
  tire: TireProduct;
  quantity: number;
  withInstallation: boolean;
  total: number;
  onConfirm: () => void;
  onCancel: () => void;
  lang: Language;
}

const CheckoutModal: React.FC<CheckoutModalProps> = ({ tire, quantity, withInstallation, total, onConfirm, onCancel, lang }) => {
  const [step, setStep] = useState<'review' | 'redirecting'>('review');
  const t = translations[lang];

  const handleProceedToCheckout = () => {
    setStep('redirecting');

    // COMMERCIAL LOGIC:
    // We strictly use the Variant ID provided by the Shopify API.
    // If for some reason the ID is missing (e.g. fallback data), we redirect to the search page.
    
    const shopDomain = "gcitires-ca.myshopify.com";
    
    if (tire.variantId && tire.variantId !== "0" && !tire.variantId.startsWith("mock")) {
        // Construct Shopify Cart Permalink
        // Format: https://{shop}.myshopify.com/cart/{variant_id}:{quantity}
        const checkoutUrl = `https://${shopDomain}/cart/${tire.variantId}:${quantity}`;
        
        // Immediate redirect for commercial speed
        window.location.href = checkoutUrl;
    } else {
        // Fallback for items that might be out of sync or legacy data
        // Redirects to a search on the store for the specific model
        const searchUrl = `https://${shopDomain}/search?q=${encodeURIComponent(tire.brand + " " + tire.model)}`;
        window.location.href = searchUrl;
    }
  };

  if (step === 'redirecting') {
    return (
        <div className="fixed inset-0 bg-slate-900 bg-opacity-95 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-lg p-10 max-w-sm w-full text-center shadow-2xl">
                <div className="w-16 h-16 mx-auto mb-6 relative">
                     <svg className="w-16 h-16 text-slate-200 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                        <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" className="text-green-600" />
                     </svg>
                </div>
                <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">{t.redirectTitle}</h3>
                <p className="text-slate-500 mt-2 font-medium">{t.redirectMsg}</p>
                <div className="mt-4 text-xs text-slate-400">Transferring to Secure Checkout...</div>
            </div>
        </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-75 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full overflow-hidden animate-fade-in-up border-t-4 border-red-600">
        {/* Header */}
        <div className="bg-white border-b border-slate-200 p-6 flex justify-between items-center">
            <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">{t.reviewSelection}</h2>
            <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        </div>

        {/* Content */}
        <div className="p-6">
            <div className="flex gap-4 mb-6">
                <div className="w-24 h-24 bg-white border border-slate-200 rounded p-2 flex-shrink-0 flex items-center justify-center">
                    <img src={tire.imageUrl} alt={tire.model} className="max-w-full max-h-full object-contain" />
                </div>
                <div>
                    <h3 className="font-black text-slate-900 text-lg uppercase">{tire.brand}</h3>
                    <p className="font-bold text-red-600 mb-1">{tire.model}</p>
                    <div className="flex flex-wrap gap-2 text-xs font-bold mt-2">
                        <span className="bg-slate-100 px-2 py-1 rounded text-slate-600">QTY: {quantity}</span>
                        {withInstallation && <span className="bg-green-100 px-2 py-1 rounded text-green-700 uppercase tracking-wide">Installation Included</span>}
                    </div>
                </div>
            </div>

            <div className="border-t border-slate-100 py-4 space-y-2 mb-6">
                <div className="flex justify-between text-sm text-slate-600 font-medium">
                    <span>Subtotal ({quantity} items)</span>
                    <span>${(tire.pricePerUnit * quantity).toFixed(2)}</span>
                </div>
                {withInstallation && (
                    <div className="flex justify-between text-sm text-slate-600 font-medium">
                        <span>Installation Fees</span>
                        <span>${(tire.installationFeePerUnit * quantity).toFixed(2)}</span>
                    </div>
                )}
                <div className="flex justify-between text-sm text-slate-600 font-medium">
                    <span>Taxes (Calculated at Checkout)</span>
                    <span className="text-slate-400">--</span>
                </div>
                <div className="flex justify-between text-xl font-black text-slate-900 pt-3 border-t border-slate-200 mt-2">
                    <span>Est. Total</span>
                    <span>${total.toFixed(2)}</span>
                </div>
            </div>

            <div className="space-y-4">
                <button 
                    onClick={handleProceedToCheckout}
                    className="w-full bg-red-600 hover:bg-red-700 text-white py-4 rounded font-bold shadow-lg transform active:scale-95 transition-all uppercase tracking-wide text-sm flex items-center justify-center gap-2"
                >
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>
                    {t.proceedCheckout}
                </button>
                <div className="text-center">
                    <p className="text-xs text-slate-400 font-medium">
                        You will be redirected to gcitires.com to complete payment.
                    </p>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default CheckoutModal;