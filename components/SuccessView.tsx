import React, { useState, useEffect } from 'react';
import type { TireProduct, Language } from '../types';
import { translations } from '../utils/translations';
import { airtableService } from '../services/airtableService';

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

interface Installer {
  id: string;
  name: string;
  address: string;
  city: string;
  province: string;
  phone: string;
  calendlyLink?: string;
  distance: number;
  pricePerTire?: number;
  rating?: number;
}

// Calculate distance between two points
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

// Fetch installers from Airtable
const fetchInstallers = async (userLat?: number, userLng?: number): Promise<Installer[]> => {
  console.log('Fetching installers from Airtable...', { lat: userLat, lng: userLng });
  
  try {
    const installers = await airtableService.findNearbyInstallers(
      userLat || 48.2368, // Default to Rouyn-Noranda
      userLng || -79.0228,
      100 // 100km radius
    );

    return installers.map(installer => {
      // Calculate distance if we have coordinates
      let distance = 0;
      if (userLat && userLng && installer.fields.Lattitude && installer.fields.Longitude) {
        distance = calculateDistance(userLat, userLng, installer.fields.Lattitude, installer.fields.Longitude);
      }

      return {
        id: installer.id,
        name: installer.fields.Name,
        address: installer.fields.Address,
        city: installer.fields.City,
        province: installer.fields.Province,
        phone: installer.fields.Phone || '',
        calendlyLink: installer.fields.CalendlyLink,
        pricePerTire: installer.fields.PricePerTire,
        rating: installer.fields.Rating,
        distance: distance,
      };
    });
  } catch (error) {
    console.error('Error fetching installers from Airtable:', error);
    
    // Fallback to mock data
    return [
      {
        id: '1',
        name: 'GCI Tire - Rouyn-Noranda',
        address: '123 Avenue Principale',
        city: 'Rouyn-Noranda',
        province: 'QC',
        phone: '(819) 555-0100',
        calendlyLink: 'https://calendly.com/gci-tire',
        distance: 0,
      }
    ];
  }
};

const SuccessView: React.FC<SuccessViewProps> = ({ selectedTire, onReset, lang }) => {
  const [installers, setInstallers] = useState<Installer[]>([]);
  const [loadingInstallers, setLoadingInstallers] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const t = translations[lang];

  // Generate random order number
  const orderNumber = `TM-${Math.floor(100000 + Math.random() * 900000)}`;

  // Calculate totals
  const tireSubtotal = selectedTire.tire.pricePerUnit * selectedTire.quantity;
  const installationSubtotal = selectedTire.withInstallation ? 15 * selectedTire.quantity : 0;
  const subtotal = tireSubtotal + installationSubtotal;
  const taxes = subtotal * 0.15;
  const total = subtotal + taxes;

  // Request Location and Fetch Installers
  useEffect(() => {
    if (selectedTire.withInstallation) {
      setLoadingInstallers(true);
      
      const fetchWithLoc = (lat?: number, lng?: number) => {
        if (lat && lng) {
          setUserLocation({ lat, lng });
        }
        
        fetchInstallers(lat, lng).then(data => {
          setInstallers(data);
          setLoadingInstallers(false);
        }).catch(error => {
          console.error('Error fetching installers:', error);
          setLoadingInstallers(false);
        });
      };

      // Try to get user location
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            fetchWithLoc(position.coords.latitude, position.coords.longitude);
          },
          (error) => {
            console.log('Geolocation denied, using default search.', error);
            fetchWithLoc();
          }
        );
      } else {
        fetchWithLoc();
      }
    }
  }, [selectedTire.withInstallation]);

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Success Header */}
        <div className="text-center mb-8 animate-fade-in-up">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-12 h-12 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-4xl font-black text-slate-900 mb-2 uppercase tracking-tight">
            {t.orderConfirmed || 'COMMANDE CONFIRMÉE!'}
          </h1>
          <p className="text-lg text-slate-600">
            {t.orderReceived || 'Votre commande a été reçue.'} <strong>{selectedTire.tire.brand} {selectedTire.tire.model}</strong>
          </p>
        </div>

        {/* Order Details Card */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6 animate-fade-in-up">
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            {/* Order Number */}
            <div>
              <p className="text-sm font-bold text-slate-400 uppercase tracking-wide mb-1">
                {t.orderNumber || 'Order Number'}
              </p>
              <p className="text-2xl font-black text-slate-900">{orderNumber}</p>
            </div>

            {/* Total Paid */}
            <div className="text-right">
              <p className="text-sm font-bold text-slate-400 uppercase tracking-wide mb-1">
                {t.totalPaid || 'Total Paid'}
              </p>
              <p className="text-2xl font-black text-green-600">${total.toFixed(2)}</p>
            </div>
          </div>

          {/* Order Summary */}
          <div className="border-t border-slate-200 pt-4">
            <h3 className="font-bold text-slate-900 mb-3 uppercase tracking-wide text-sm">
              {t.orderSummary || 'Order Summary'}
            </h3>
            
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">
                  {selectedTire.quantity}x {selectedTire.tire.brand} {selectedTire.tire.model} ({selectedTire.tire.size})
                </span>
                <span className="font-semibold text-slate-900">${tireSubtotal.toFixed(2)}</span>
              </div>

              {selectedTire.withInstallation && (
                <div className="flex justify-between">
                  <span className="text-slate-600 flex items-center gap-1">
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Installation & Balancing
                  </span>
                  <span className="font-semibold text-slate-900">${installationSubtotal.toFixed(2)}</span>
                </div>
              )}

              <div className="flex justify-between border-t border-slate-200 pt-2">
                <span className="text-slate-600">Subtotal</span>
                <span className="font-semibold text-slate-900">${subtotal.toFixed(2)}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-600">Taxes (15%)</span>
                <span className="font-semibold text-slate-900">${taxes.toFixed(2)}</span>
              </div>

              <div className="flex justify-between text-lg font-black border-t-2 border-slate-300 pt-2 mt-2">
                <span className="text-slate-900">TOTAL</span>
                <span className="text-green-600">${total.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Installation Section */}
        {selectedTire.withInstallation && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-6 animate-fade-in-up">
            <div className="flex items-start gap-3 mb-4 pb-4 border-b border-slate-200">
              <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-lg mb-1">
                  {t.installationStatus || 'STATUT D\'INSTALLATION'}
                </h3>
                <p className="text-slate-600">
                  {t.installationNotice || 'L\'installation nécessite un rendez-vous. Veuillez sélectionner une heure ci-dessous.'}
                </p>
              </div>
            </div>

            {/* Installers List */}
            <div>
              <h4 className="font-bold text-slate-900 mb-3 uppercase tracking-wide text-sm flex items-center gap-2">
                {t.authorizedInstallers || 'AUTHORIZED INSTALLERS (GROUNDED DATA)'}
                <div className="flex gap-2">
                  <button className="px-3 py-1 text-xs font-bold bg-slate-200 text-slate-700 rounded hover:bg-slate-300">
                    LIST
                  </button>
                  <button className="px-3 py-1 text-xs font-bold bg-slate-100 text-slate-600 rounded hover:bg-slate-200">
                    MAP
                  </button>
                </div>
              </h4>

              {loadingInstallers ? (
                <div className="flex items-center justify-center py-8">
                  <svg className="animate-spin h-8 w-8 text-red-600" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                </div>
              ) : (
                <div className="space-y-3">
                  {installers.length > 0 ? (
                    installers.map((installer) => (
                      <div
                        key={installer.id}
                        className="border border-slate-200 rounded-lg p-4 hover:border-red-300 hover:shadow-md transition-all"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h5 className="font-bold text-slate-900">{installer.name}</h5>
                            <p className="text-sm text-slate-600 mt-1">
                              {installer.address}<br />
                              {installer.city}, {installer.province}
                            </p>
                            <p className="text-sm text-slate-600 mt-1">
                              📞 {installer.phone}
                            </p>
                            
                            {/* ✅ FIXED: Distance Display */}
                            <div className="flex items-center gap-3 mt-2 flex-wrap">
                              {installer.distance !== undefined && installer.distance > 0 && (
                                <p className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">
                                  📍 {installer.distance.toFixed(1)} km away
                                </p>
                              )}
                              {installer.distance === 0 && (
                                <p className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded">
                                  📍 Nearest location
                                </p>
                              )}
                              {installer.pricePerTire && (
                                <p className="text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-1 rounded">
                                  ${installer.pricePerTire.toFixed(2)}/tire
                                </p>
                              )}
                              {installer.rating && (
                                <div className="flex items-center bg-yellow-50 px-2 py-1 rounded">
                                  <span className="text-yellow-500 text-xs">
                                    {'★'.repeat(Math.floor(installer.rating))}
                                  </span>
                                  <span className="ml-1 text-xs font-semibold text-slate-700">
                                    ({installer.rating.toFixed(1)})
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                          {installer.calendlyLink && (
                            <a
                              href={installer.calendlyLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-4 px-4 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors text-sm whitespace-nowrap"
                            >
                              {t.bookAppointment || 'RÉSERVER'}
                            </a>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-slate-500">
                      <p>No installers found in your area.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Next Steps */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6 animate-fade-in-up">
          <h3 className="font-bold text-blue-900 mb-3 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {t.nextSteps || 'Prochaines étapes'}
          </h3>
          <ul className="space-y-2 text-sm text-blue-800">
            <li className="flex items-start gap-2">
              <span className="text-blue-600 font-bold">1.</span>
              <span>Un email de confirmation a été envoyé à votre adresse.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-600 font-bold">2.</span>
              <span>
                {selectedTire.withInstallation 
                  ? 'Réservez votre rendez-vous d\'installation en utilisant le lien ci-dessus.'
                  : 'Vos pneus seront expédiés à votre adresse sous 2-5 jours ouvrables.'}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-600 font-bold">3.</span>
              <span>Vous pouvez suivre votre commande via le lien dans votre email.</span>
            </li>
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 animate-fade-in-up">
          <button
            onClick={onReset}
            className="flex-1 px-6 py-4 bg-slate-900 text-white font-bold rounded-lg hover:bg-slate-800 transition-colors uppercase tracking-wide shadow-md"
          >
            {t.startOver || 'RECOMMENCER'}
          </button>
          <a
            href="https://www.gcitires.com"
            className="flex-1 px-6 py-4 border-2 border-slate-300 text-slate-700 font-bold rounded-lg hover:bg-slate-50 transition-colors uppercase tracking-wide text-center"
          >
            {t.backStore || 'RETOUR À LA BOUTIQUE'}
          </a>
        </div>

        {/* Support */}
        <div className="text-center mt-8 text-sm text-slate-500">
          <p>
            {t.needHelp || 'Besoin d\'aide?'}{' '}
            <a href="mailto:support@gcitires.com" className="text-red-600 hover:underline font-semibold">
              support@gcitires.com
            </a>
            {' '}{t.or || 'ou'}{' '}
            <a href="tel:+18195550100" className="text-red-600 hover:underline font-semibold">
              (819) 555-0100
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default SuccessView;
