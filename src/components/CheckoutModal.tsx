import React, { useState } from 'react';
import type { TireProduct, Language } from '../types';
import { translations } from '../utils/translations';
import { airtableService } from '../services/airtableService';

interface CheckoutModalProps {
  tire: TireProduct;
  quantity: number;
  withInstallation: boolean;
  total: number;
  onConfirm: (orderNumber: string) => void;
  onCancel: () => void;
  lang: Language;
  selectedInstaller?: any;
}

const CheckoutModal: React.FC<CheckoutModalProps> = ({
  tire,
  quantity,
  withInstallation,
  total,
  onConfirm,
  onCancel,
  lang,
  selectedInstaller,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [customerInfo, setCustomerInfo] = useState({
    name: '',
    email: '',
    phone: '',
  });
  const t = translations[lang];

  const handleCheckout = async () => {
    // Validate customer info
    if (!customerInfo.name || !customerInfo.email || !customerInfo.phone) {
      alert(t.pleaseFillAllFields || 'Please fill in all fields');
      return;
    }

    setIsProcessing(true);

    try {
      const orderNumber = `TM-${Math.floor(100000 + Math.random() * 900000)}`;

      // Resolve the installer's loyalty coupon (cached on the installer object,
      // otherwise fetched from Airtable). Non-blocking — null if unavailable.
      let installerCouponCode: string | null = null;
      if (withInstallation && selectedInstaller?.id) {
        installerCouponCode =
          selectedInstaller.couponCode ||
          (await airtableService.getInstallerCouponCode(selectedInstaller.id));
      }

      // Create installation job in Airtable
      if (withInstallation && selectedInstaller) {
        console.log('📝 Creating installation job in Airtable...');

        await airtableService.createInstallationJob({
          CustomerName: customerInfo.name,
          CustomerEmail: customerInfo.email,
          CustomerPhone: customerInfo.phone,
          InstallerId: selectedInstaller.id,
          TireProduct: `${tire.brand} ${tire.model} (${tire.size})`,
          Quantity: quantity,
          InstallationPrice: selectedInstaller.pricePerTire * quantity,
          Status: 'Pending',
          ShopifyOrderId: orderNumber,
          Notes: `Auto-created from AI Match Checkout`,
          CouponIssued: installerCouponCode || undefined,
        });

        console.log('✅ Installation job created successfully');
      }

      // Send confirmation email
      console.log('📧 Sending confirmation email...');
      
      await sendConfirmationEmail({
        to: customerInfo.email,
        name: customerInfo.name,
        orderNumber,
        tire: `${tire.brand} ${tire.model}`,
        quantity,
        total,
        withInstallation,
        installerName: selectedInstaller?.name,
        couponCode: installerCouponCode || undefined,
        lang,
      });

      console.log('✅ Email sent successfully');

      // Simulate checkout delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      onConfirm(orderNumber);
    } catch (error) {
      console.error('Checkout error:', error);
      alert(t.checkoutFailed || 'Checkout failed. Please try again.');
      setIsProcessing(false);
    }
  };

  const tireSubtotal = tire.pricePerUnit * quantity;
  const installationSubtotal = withInstallation && selectedInstaller
    ? selectedInstaller.pricePerTire * quantity
    : 0;
  const subtotal = tireSubtotal + installationSubtotal;
  const taxes = subtotal * 0.15;
  const finalTotal = subtotal + taxes;

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
          {/* Customer Information */}
          <div>
            <h3 className="font-bold text-slate-900 mb-3 uppercase tracking-wide text-sm">
              {t.yourInformation}
            </h3>
            <div className="space-y-3">
              <input
                type="text"
                placeholder={t.fullName || 'Full Name'}
                value={customerInfo.name}
                onChange={(e) => setCustomerInfo({ ...customerInfo, name: e.target.value })}
                className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:border-red-500 focus:outline-none transition-colors"
                required
              />
              <input
                type="email"
                placeholder={t.email || 'Email'}
                value={customerInfo.email}
                onChange={(e) => setCustomerInfo({ ...customerInfo, email: e.target.value })}
                className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:border-red-500 focus:outline-none transition-colors"
                required
              />
              <input
                type="tel"
                placeholder={t.phone || 'Phone Number'}
                value={customerInfo.phone}
                onChange={(e) => setCustomerInfo({ ...customerInfo, phone: e.target.value })}
                className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:border-red-500 focus:outline-none transition-colors"
                required
              />
            </div>
          </div>

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

              {withInstallation && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600 flex items-center gap-1">
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {t.installationAndBalancing} ({quantity}x ${selectedInstaller?.pricePerTire?.toFixed(2) ?? '0.00'})
                  </span>
                  <span className="font-semibold text-slate-900">
                    ${installationSubtotal.toFixed(2)}
                  </span>
                </div>
              )}

              <div className="flex justify-between text-sm border-t border-slate-200 pt-2">
                <span className="text-slate-600">{t.subtotal}</span>
                <span className="font-semibold text-slate-900">
                  ${subtotal.toFixed(2)}
                </span>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-slate-600">{t.taxes}</span>
                <span className="font-semibold text-slate-900">
                  ${taxes.toFixed(2)}
                </span>
              </div>

              <div className="flex justify-between text-lg font-black border-t-2 border-slate-300 pt-3 mt-2">
                <span className="text-slate-900">{t.total}</span>
                <span className="text-red-600">
                  ${finalTotal.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Installation Notice */}
          {withInstallation && (
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
              disabled={isProcessing || !customerInfo.name || !customerInfo.email || !customerInfo.phone}
              className="flex-1 px-6 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:bg-slate-400 uppercase tracking-wide shadow-md hover:shadow-lg"
            >
              {isProcessing ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {t.processing || 'Processing...'}
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

// ✅ UPDATED: Email notification function using Resend API
async function sendConfirmationEmail(data: {
  to: string;
  name: string;
  orderNumber: string;
  tire: string;
  quantity: number;
  total: number;
  withInstallation: boolean;
  installerName?: string;
  couponCode?: string;
  lang: string;
}): Promise<void> {
  try {
    // Call our Vercel API endpoint
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: data.to,
        name: data.name,
        orderNumber: data.orderNumber,
        tire: data.tire,
        quantity: data.quantity,
        total: data.total,
        withInstallation: data.withInstallation,
        installerName: data.installerName,
        couponCode: data.couponCode,
        lang: data.lang,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.details || 'Email send failed');
    }

    const result = await response.json();
    console.log('✅ Email sent successfully:', result.id);
    
  } catch (error) {
    console.error('❌ Email error:', error);
    // Don't throw - email failure shouldn't block checkout
    // The user still gets the success page
  }
}

export default CheckoutModal;
