import React, { useState } from 'react';
import { TireProduct, Language } from '../types';
import { translations } from '../utils/translations';
import { addToCartAndGetCheckoutUrl, buildCartPermalink, CartItem } from '../services/shopifyCartService';
import { createInstallationJob } from '../services/airtableService';

interface CheckoutModalProps {
  tire: TireProduct;
  quantity: number;
  withInstallation: boolean;
  total: number;
  onConfirm: () => void;
  onCancel: () => void;
  lang: Language;
}

const CheckoutModal: React.FC<CheckoutModalProps> = ({ 
  tire, 
  quantity, 
  withInstallation, 
  total, 
  onConfirm, 
  onCancel, 
  lang 
}) => {
  const [step, setStep] = useState<'review' | 'redirecting' | 'error'>('review');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const t = translations[lang];

  const handleProceedToCheckout = async () => {
    setStep('redirecting');

    try {
      if (!tire.variantId || tire.variantId.startsWith('mock') || tire.variantId === 'unavailable') {
        throw new Error('This tire is currently unavailable for online purchase. Please contact us for availability.');
      }

      console.log('🛒 Starting checkout process...');

      const cartItems: CartItem[] = [
        {
          variantId: tire.variantId,
          quantity: quantity
        }
      ];

      if (withInstallation) {
        const installationVariantId = import.meta.env.VITE_SHOPIFY_INSTALLATION_PRODUCT_ID;
        
        if (installationVariantId) {
          cartItems.push({
            variantId: installationVariantId,
            quantity: quantity
          });
        }
      }

      console.log('📦 Cart items:', cartItems);

      let checkoutUrl: string;
      
      try {
        console.log('🔄 Using Shopify Buy SDK...');
        checkoutUrl = await addToCartAndGetCheckoutUrl(cartItems);
        console.log('✅ Checkout URL from SDK:', checkoutUrl);
      } catch (sdkError) {
        console.warn('⚠️ SDK failed, using permalink fallback:', sdkError);
        checkoutUrl = buildCartPermalink(cartItems);
        console.log('🔗 Permalink URL:', checkoutUrl);
      }

      // If installation is included, create job in Airtable
      if (withInstallation) {
        console.log('📝 Creating installation job in Airtable...');
        
        try {
          // Extract order ID from checkout URL (if available)
          const checkoutId = checkoutUrl.split('/').pop()?.split('?')[0] || 'PENDING';
          
          const jobResult = await createInstallationJob({
            shopifyOrderId: checkoutId,
            customerName: 'Customer', // Will be updated when order is placed
            customerEmail: 'pending@gcitires.com', // Will be updated when order is placed
            customerAddress: 'To be determined',
            tireBrand: tire.brand,
            tireModel: tire.model,
            tireSize: tire.type,
            quantity: quantity,
            installationFee: tire.installationFeePerUnit * quantity,
            status: 'Pending Payment'
          });

          if (jobResult.success) {
            console.log('✅ Installation job created:', jobResult.recordId);
          } else {
            console.warn('⚠️ Failed to create installation job:', jobResult.error);
            // Don't block checkout if Airtable fails
          }
        } catch (airtableError) {
          console.error('❌ Airtable error (non-blocking):', airtableError);
          // Continue with checkout even if Airtable fails
        }
      }

      const url = new URL(checkoutUrl);
      url.searchParams.append('ref', 'ai_match_v2');
      if (withInstallation) {
        url.searchParams.append('installation', 'true');
      }
      
      const finalUrl = url.toString();
      console.log('🎯 Final checkout URL:', finalUrl);

      setTimeout(() => {
        const newWindow = window.open(finalUrl, '_blank', 'noopener,noreferrer');
        
        if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
          console.warn('⚠️ Popup blocked, redirecting parent page');
          if (window.top) {
            window.top.location.href = finalUrl;
          } else {
            window.location.href = finalUrl;
          }
        } else {
          console.log('✅ Checkout opened in new tab');
        }
        
        onConfirm();
      }, 800);

    } catch (error) {
      console.error('❌ Checkout error:', error);
      setErrorMessage(
        error instanceof Error 
          ? error.message 
          : 'Unable to process checkout. Please try again.'
      );
      setStep('error');
    }
  };

  if (step === 'redirecting') {
    return (
      <div className="fixed inset-0 bg-slate-900 bg-opacity-95 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
        <div className="bg-white rounded-lg p-10 max-w-sm w-full text-center shadow-2xl">
          <div className="w-16 h-16 mx-auto mb-6 relative">
            <svg className="w-16 h-16 text-slate-200 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
              <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" className="text-red-600" />
            </svg>
          </div>
          <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">
            {lang === 'en' ? 'Processing Checkout' : 'Traitement du paiement'}
          </h3>
          <p className="text-slate-500 mt-2 font-medium">
            {lang === 'en' ? 'Redirecting you to secure checkout...' : 'Redirection vers le paiement sécurisé...'}
          </p>
          <div className="mt-4 text-xs text-slate-400">
            {lang === 'en' ? 'Please allow popups if blocked' : 'Veuillez autoriser les popups si bloqués'}
          </div>
        </div>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="fixed inset-0 bg-slate-900 bg-opacity-75 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
        <div className="bg-white rounded-lg shadow-2xl max-w-md w-full overflow-hidden animate-fade-in-up border-t-4 border-red-600">
          <div className="p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-xl font-black text-slate-900 mb-2">
              {lang === 'en' ? 'Checkout Error' : 'Erreur de paiement'}
            </h3>
            <p className="text-slate-600 mb-6">{errorMessage}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setStep('review')}
                className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-900 py-3 rounded font-bold transition-colors"
              >
                {lang === 'en' ? 'Try Again' : 'Réessayer'}
              </button>
              <button
                onClick={onCancel}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded font-bold transition-colors"
              >
                {lang === 'en' ? 'Go Back' : 'Retour'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-75 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full overflow-hidden animate-fade-in-up border-t-4 border-red-600">
        <div className="bg-white border-b border-slate-200 p-6 flex justify-between items-center">
          <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">
            {t.reviewSelection || (lang === 'en' ? 'Review Selection' : 'Réviser la sélection')}
          </h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          <div className="flex gap-4 mb-6">
            <div className="w-24 h-24 bg-white border border-slate-200 rounded p-2 flex-shrink-0 flex items-center justify-center">
              <img src={tire.imageUrl} alt={tire.model} className="max-w-full max-h-full object-contain" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-lg uppercase">{tire.brand}</h3>
              <p className="font-bold text-red-600 mb-1">{tire.model}</p>
              <div className="flex flex-wrap gap-2 text-xs font-bold mt-2">
                <span className="bg-slate-100 px-2 py-1 rounded text-slate-600">
                  {lang === 'en' ? `QTY: ${quantity}` : `QTÉ: ${quantity}`}
                </span>
                {withInstallation && (
                  <span className="bg-green-100 px-2 py-1 rounded text-green-700 uppercase tracking-wide">
                    {lang === 'en' ? 'Installation Included' : 'Installation incluse'}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 py-4 space-y-2 mb-6">
            <div className="flex justify-between text-sm text-slate-600 font-medium">
              <span>{lang === 'en' ? `Subtotal (${quantity} tires)` : `Sous-total (${quantity} pneus)`}</span>
              <span>${(tire.pricePerUnit * quantity).toFixed(2)} CAD</span>
            </div>
            {withInstallation && (
              <div className="flex justify-between text-sm text-slate-600 font-medium">
                <span>{lang === 'en' ? `Installation Service (${quantity}x)` : `Service d'installation (${quantity}x)`}</span>
                <span>${(tire.installationFeePerUnit * quantity).toFixed(2)} CAD</span>
              </div>
            )}
            <div className="flex justify-between text-sm text-slate-600 font-medium">
              <span>{lang === 'en' ? 'Taxes' : 'Taxes'}</span>
              <span className="text-slate-400">{lang === 'en' ? 'Calculated at checkout' : 'Calculé à la caisse'}</span>
            </div>
            <div className="flex justify-between text-xl font-black text-slate-900 pt-3 border-t border-slate-200 mt-2">
              <span>{lang === 'en' ? 'Estimated Total' : 'Total estimé'}</span>
              <span>${total.toFixed(2)} CAD</span>
            </div>
          </div>

          <div className="space-y-4">
            <button 
              onClick={handleProceedToCheckout}
              className="w-full bg-red-600 hover:bg-red-700 text-white py-4 rounded font-bold shadow-lg transform active:scale-95 transition-all uppercase tracking-wide text-sm flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
              {t.proceedCheckout || (lang === 'en' ? 'Proceed to Checkout' : 'Procéder au paiement')}
            </button>
            <div className="text-center">
              <p className="text-xs text-slate-400 font-medium">
                {lang === 'en' ? 'Secure checkout powered by Shopify' : 'Paiement sécurisé par Shopify'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CheckoutModal;
