// src/components/BookingPage.tsx
import React, { useState, useEffect } from 'react';
import MapComponent from './MapComponent';
import { getInstallers } from '../services/airtableService';
import type { Installer } from '../types';

interface BookingPageProps {
  onInstallerSelect: (installer: Installer) => void;
  onBack: () => void;
  lang: 'en' | 'fr';
}

const BookingPage: React.FC<BookingPageProps> = ({ onInstallerSelect, onBack, lang }) => {
  const [installers, setInstallers] = useState<Installer[]>([]);
  const [selectedInstaller, setSelectedInstaller] = useState<Installer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | undefined>(undefined);

  // Get user location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          console.log('📍 User location detected:', location);
          setUserLocation(location);
        },
        (error) => {
          console.warn('⚠️ Geolocation denied, using default search.', error);
          // Continue without user location
        }
      );
    }
  }, []);

  // Fetch installers
  useEffect(() => {
    const fetchInstallers = async () => {
      try {
        console.log('📡 Fetching installers from Airtable...', { userLocation });
        const data = await getInstallers(userLocation);
        console.log('✅ Fetched installers:', data);
        setInstallers(data);
        setLoading(false);
      } catch (err) {
        console.error('❌ Error fetching installers:', err);
        setError('Failed to load installers');
        setLoading(false);
      }
    };

    // Wait a moment for geolocation to complete, or fetch after timeout
    const timer = setTimeout(() => {
      fetchInstallers();
    }, 1000);

    return () => clearTimeout(timer);
  }, [userLocation]);

  const handleSelectInstaller = (installer: Installer) => {
    setSelectedInstaller(installer);
  };

  const handleConfirm = () => {
    if (selectedInstaller) {
      onInstallerSelect(selectedInstaller);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto mb-4"></div>
          <p className="text-slate-600">
            {lang === 'en' ? 'Loading installers...' : 'Chargement des installateurs...'}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-red-50 p-6 rounded-lg border border-red-200">
          <p className="text-red-600 font-semibold">{error}</p>
          <button onClick={onBack} className="mt-4 text-red-700 underline">
            {lang === 'en' ? 'Go Back' : 'Retour'}
          </button>
        </div>
      </div>
    );
  }

  if (installers.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-yellow-50 p-6 rounded-lg border border-yellow-200 max-w-md">
          <div className="text-center">
            <svg className="w-12 h-12 text-yellow-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h3 className="text-lg font-bold text-slate-900 mb-2">
              {lang === 'en' ? 'No Installers Available' : 'Aucun installateur disponible'}
            </h3>
            <p className="text-slate-600 mb-4">
              {lang === 'en' 
                ? 'There are no installers available in your area at this time.' 
                : 'Il n\'y a aucun installateur disponible dans votre région pour le moment.'}
            </p>
            <button onClick={onBack} className="text-red-600 font-bold underline">
              {lang === 'en' ? 'Go Back' : 'Retour'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up">
      <div className="mb-6">
        <button onClick={onBack} className="text-slate-600 hover:text-slate-900 flex items-center gap-2 font-semibold">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {lang === 'en' ? 'Back to Results' : 'Retour aux résultats'}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
        <h2 className="text-2xl font-black text-slate-900 mb-2 uppercase tracking-tight">
          {lang === 'en' ? 'Select Installation Location' : 'Choisir le lieu d\'installation'}
        </h2>
        <p className="text-slate-500 mb-6">
          {lang === 'en' 
            ? 'Choose an authorized GCI Tire installer near you' 
            : 'Choisissez un installateur GCI Tire autorisé près de chez vous'}
        </p>

        <MapComponent 
          installers={installers}
          selectedInstaller={selectedInstaller}
          onInstallerSelect={handleSelectInstaller}
          userLocation={userLocation}
        />
      </div>

      {/* Installer List */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h3 className="text-lg font-bold text-slate-900 mb-4 uppercase tracking-wide">
          {lang === 'en' ? 'Available Installers' : 'Installateurs disponibles'}
        </h3>
        
        <div className="space-y-3">
          {installers.map(installer => (
            <div 
              key={installer.id}
              onClick={() => handleSelectInstaller(installer)}
              className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                selectedInstaller?.id === installer.id 
                  ? 'border-blue-600 bg-blue-50' 
                  : 'border-slate-200 hover:border-slate-300 hover:shadow-md'
              }`}
            >
              <div className="flex justify-between items-start">
                <div className="flex-grow">
                  <h4 className="font-bold text-slate-900 text-lg">{installer.name}</h4>
                  <p className="text-sm text-slate-600 mt-1">
                    {installer.address}, {installer.city}, {installer.province} {installer.postalCode}
                  </p>
                  <div className="flex gap-4 mt-2">
                    {installer.distance !== undefined && (
                      <p className="text-xs font-semibold text-slate-500">
                        📍 {installer.distance.toFixed(1)} km {lang === 'en' ? 'away' : 'de distance'}
                      </p>
                    )}
                    {installer.pricePerTire && (
                      <p className="text-xs font-semibold text-green-600">
                        ${installer.pricePerTire.toFixed(2)} {lang === 'en' ? 'per tire' : 'par pneu'}
                      </p>
                    )}
                    {installer.rating && (
                      <p className="text-xs font-semibold text-yellow-600">
                        ⭐ {installer.rating.toFixed(1)}
                      </p>
                    )}
                  </div>
                </div>
                {selectedInstaller?.id === installer.id && (
                  <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {selectedInstaller && (
          <button 
            onClick={handleConfirm}
            className="w-full mt-6 bg-red-600 text-white py-4 rounded-lg font-bold uppercase tracking-wide hover:bg-red-700 transition-colors shadow-lg hover:shadow-xl"
          >
            {lang === 'en' ? 'Confirm Installation Location' : 'Confirmer le lieu d\'installation'}
          </button>
        )}
      </div>
    </div>
  );
};

export default BookingPage;