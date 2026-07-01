import React, { useState } from 'react';
import type { TireProduct, Language } from '../types';
import { translations } from '../utils/translations';
import { createCheckout } from '../services/shopifyCheckoutService';
import { resolveInstallationFeeTier } from '../services/installationFeeService';

interface CheckoutModalProps {
  tire: TireProduct;
  quantity: number;
  withInstallation: boolean;
  onCancel: () => void;
  lang: Language;
  selectedInstaller?: any;
}

// FIXED 2026-07-01: This component previously faked checkout entirely —
// generated a local "TM-XXXXXX" order number, wrote an Airtable Installation
// Job, sent a confirmation email, and showed a success screen, WITHOUT ever
// calling Shopify's Cart API or collecting real payment. No real order was
// created for either the tire or the installation fee.
//
// This version builds a real cart (tire + the correct installation-fee
// tier, if selected) and redirects to Shopify's real checkoutUrl, where the
// customer enters payment on Shopify's own secure checkout. Customer name/
// email/phone are collected there natively -- no need to duplicate that here.
//
// The Airtable Installation Job and confirmation email are now created
// SERVER-SIDE, AFTER Shopify confirms payment, by gci-order-hub's
// order-router.ts (orders/paid webhook) -- see extractInstallerMeta() there.
// This avoids dispatching an installer on an order that was never actually
// paid for.
const CheckoutModal: React.FC<CheckoutModalProps> = ({
  tire,
  quantity,
  withInstallation,
  onCancel,
  lang,
  selectedInstaller,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = translations[lang];

  const feeTier = withInstallation && selectedInstaller
    ? resolveInstallationFeeTier(selectedInstaller.pricePerTire)
    : null;

  const handleCheckout = async () => {
    if (!tire.shopifyVariantId) {
      setError(t.checkoutFailed || 'This product is not available for checkout right now.');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const lineItems = [{ variantId: tire.shopifyVariantId, quantity }];
      if (feeTier) {
        // Per-tire fee -- one fee unit per tire, same quantity as the tires.
        lineItems.push({ variantId: feeTier.variantId, quantity });
      }

      const checkoutUrl = await createCheckout(lineItems, {
        withInstallation,
        tireBrand: tire.brand,
        tireModel: tire.model,
        tireSize: tire.size,
        quantity,
        installerId: withInstallation ? selectedInstaller?.id : undefined,
        installerName: withInstallation ? selectedInstaller?.name : undefined,
        fulfillmentType: withInstallation ? 'ship_to_installer' : 'direct_to_customer',
      });

      // Real Shopify checkout -- leaves the SPA. Payment, tax, and the
      // order confirmation are all handled by Shopify from here on.
      window.location.href = checkoutUrl;
    } catch (err) {
      console.error('Checkout error:', err);
      setError(t.checkoutFailed || 'Checkout failed. Please try again.');
      setIsProcessing(false);
    }
  };

  const tireSubtotal = tire.pricePerUnit * quantity;
  const installationSubtotal = feeTier ? feeTier.price * quantity : 0;
  const estimatedSubtotal = tireSubtotal + installationSubtotal;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto animate-fade-in-up">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">
            {t.checkout}
          </h2>
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            disabled={isProcessing}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Order Summary */}
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <h3 className="font-bold text-slate-900 mb-3 uppercase tracking-wide text-sm">
              {t.orderSummaryTitle}
            </h3>

            {/* Tire Details */}
            <div className="flex gap-4 mb-4">
              {tire.imageUrl && (
                <img
                  src={tire.imageUrl}
                  alt={tire.model}
                  className="w-20 h-20 object-contain bg-white rounded border border-slate-200"
                />
              )}
              <div className="flex-1">
                <h4 className="font-bold text-slate-900">{tire.brand} {tire.model}</h4>
                <p className="text-sm text-slate-600">{tire.size}</p>
                <p className="text-sm text-slate-600">{tire.season}</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-slate-900">${tire.pricePerUnit.toFixed(2)}</p>
                <p className="text-xs text-slate-500">× {quantity}</p>
              </div>
            </div>

            {/* Line Items */}
            <div className="space-y-2 border-t border-slate-200 pt-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">
                  {t.tires || 'Tires'} ({quantity}x ${tire.pricePerUnit.toFixed(2)})
                </span>
                <span className="font-semibold text-slate-900">
                  ${tireSubtotal.toFixed(2)}
                </span>
              </div>

              {feeTier && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600 flex items-center gap-1">
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {t.installationAndBalancing} ({quantity}x ${feeTier.price.toFixed(2)})
                  </span>
                  <span className="font-semibold text-slate-900">
                    ${installationSubtotal.toFixed(2)}
                  </span>
                </div>
              )}

              <div className="flex justify-between text-lg font-black border-t-2 border-slate-300 pt-3 mt-2">
                <span className="text-slate-900">{t.subtotal} ({t.estimated || 'estimated'})</span>
                <span className="text-red-600">
                  ${estimatedSubtotal.toFixed(2)}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {t.taxesAndTotalAtCheckout ||
                  'Exact taxes and total are calculated on the next step, at secure Shopify checkout.'}
              </p>
            </div>
          </div>

          {/* Installation Notice */}
          {feeTier && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex gap-3">
                <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <h4 className="font-bold text-green-900 mb-1">
                    {t.installationIncluded}
                  </h4>
                  <p className="text-sm text-green-700">
                    {t.installationDescription}
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={onCancel}
              disabled={isProcessing}
              className="flex-1 px-6 py-3 border-2 border-slate-300 text-slate-700 font-bold rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50 uppercase tracking-wide"
            >
              {t.cancel}
            </button>
            <button
              onClick={handleCheckout}
              disabled={isProcessing}
              className="flex-1 px-6 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:bg-slate-400 uppercase tracking-wide shadow-md hover:shadow-lg"
            >
              {isProcessing ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {t.processing || 'Redirecting to secure checkout...'}
                </span>
              ) : (
                t.completeOrder
              )}
            </button>
          </div>

          {/* Security Notice */}
          <p className="text-xs text-slate-500 text-center">
            {t.secureCheckout}
          </p>
        </div>
      </div>
    </div>
  );
};

export default CheckoutModal;
