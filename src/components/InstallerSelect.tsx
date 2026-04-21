import React, { useState, useEffect } from 'react';
import type { TireProduct, Language } from '../types';
import { airtableService } from '../services/airtableService';
import InstallerMap from './InstallerMap';

const GCI_CUT = 0.20; // 20% admin fee

interface Installer {
  id: string;
  name: string;
  address: string;
  city: string;
  province: string;
  phone: string;
  pricePerTire: number;
  distance: number;
  lat?: number;
  lng?: number;
  rating?: number;
}

interface InstallerSelectProps {
  tire: TireProduct;
  quantity: number;
  lang: Language;
  mapsLoaded: boolean;
  onSelect: (installer: Installer, installTotal: number) => void;
  onBack: () => void;
  onSkip: () => void;
}

const InstallerSelect: React.FC<InstallerSelectProps> = ({
  tire, quantity, lang, mapsLoaded, onSelect, onBack, onSkip
}) => {
  const [installers, setInstallers] = useState<Installer[]>([]);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Installer | null>(null);
  const isFr = lang === 'fr';

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      pos => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        loadInstallers(loc.lat, loc.lng);
      },
      () => loadInstallers(48.2368, -79.0228) // fallback: Rouyn-Noranda
    );
  }, []);

  async function loadInstallers(lat: number, lng: number) {
    try {
      const raw = await airtableService.findNearbyInstallers(lat, lng, 300);
      const mapped: Installer[] = (Array.isArray(raw) ? raw : [])
        .map((r: any) => {
          const d = r.fields || r;
          return {
            id: r.id || '',
            name: d.Name || d.name || 'Installer',
            address: d.Address || d.address || '',
            city: d.City || d.city || '',
            province: d.Province || d.province || '',
            phone: d.Phone || d.phone || '',
            pricePerTire: Number(d.PricePerTire || d.pricePerTire || d['Price Per Tire'] || 20),
            distance: r.distance || 0,
            lat: d.Latitude || d.latitude || d.lat,
            lng: d.Longitude || d.longitude || d.lng,
            rating: d.Rating || d.rating,
          };
        })
        .filter((i: Installer) => i.name !== 'Installer' || i.phone);
      setInstallers(mapped);
    } catch (e) {
      console.error('Failed to load installers', e);
    }
    setLoading(false);
  }

  function installTotal(installer: Installer) {
    return installer.pricePerTire * quantity;
  }

  function handleConfirm() {
    if (!selected) return;
    onSelect(selected, installTotal(selected));
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-4 flex items-center gap-3">
        <button onClick={onBack} className="text-slate-400 hover:text-slate-600">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">
            {isFr ? 'Choisir un installateur' : 'Choose an Installer'}
          </h2>
          <p className="text-xs text-slate-500">
            {tire.brand} {tire.model} × {quantity}
          </p>
        </div>
        <button
          onClick={onSkip}
          className="ml-auto text-xs text-slate-400 hover:text-red-500 underline"
        >
          {isFr ? 'Livraison seulement →' : 'Delivery only →'}
        </button>
      </div>

      {/* Map */}
      {mapsLoaded && installers.length > 0 && (
        <div className="h-48 bg-slate-200">
          <InstallerMap installers={installers} userLocation={userLocation || undefined} />
        </div>
      )}

      {/* Installer list */}
      <div className="px-4 pt-4 space-y-3">
        {loading && (
          <div className="text-center py-12 text-slate-400">
            <div className="w-8 h-8 border-4 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            {isFr ? 'Recherche des installateurs...' : 'Finding installers near you...'}
          </div>
        )}

        {!loading && installers.length === 0 && (
          <div className="text-center py-12">
            <p className="text-slate-600 font-semibold mb-1">
              {isFr ? 'Aucun installateur disponible' : 'No installers available nearby'}
            </p>
            <p className="text-slate-400 text-sm mb-4">
              {isFr
                ? 'Choisissez la livraison à domicile ou à votre garagiste.'
                : 'Choose home delivery and ship directly to your garage.'}
            </p>
            <button
              onClick={onSkip}
              className="bg-red-600 text-white font-bold px-6 py-3 rounded-lg hover:bg-red-700 transition"
            >
              {isFr ? 'Continuer sans installation' : 'Continue without installation'}
            </button>
          </div>
        )}

        {installers.map(inst => {
          const isSelected = selected?.id === inst.id;
          const total = installTotal(inst);
          const gciCut = total * GCI_CUT;
          const installerEarns = total - gciCut;

          return (
            <div
              key={inst.id}
              onClick={() => setSelected(isSelected ? null : inst)}
              className={`bg-white rounded-xl border-2 p-4 cursor-pointer transition-all ${
                isSelected
                  ? 'border-red-500 ring-2 ring-red-100'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-slate-900">{inst.name}</span>
                    {inst.rating && (
                      <span className="text-xs text-amber-500 font-semibold">★ {inst.rating}</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500">{inst.address}, {inst.city}</p>
                  {inst.distance > 0 && (
                    <p className="text-xs text-slate-400 mt-0.5">{inst.distance.toFixed(1)} km {isFr ? 'de vous' : 'away'}</p>
                  )}
                  <p className="text-xs text-slate-400 mt-1">📞 {inst.phone}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-slate-400 uppercase font-semibold">
                    {isFr ? 'Installation' : 'Install'}
                  </p>
                  <p className="text-xl font-black text-slate-900">
                    ${inst.pricePerTire.toFixed(2)}<span className="text-xs font-normal text-slate-400">/tire</span>
                  </p>
                  <p className="text-sm text-slate-600 font-semibold">
                    ${total.toFixed(2)} {isFr ? 'total' : 'total'}
                  </p>
                </div>
              </div>

              {isSelected && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>{quantity} × ${inst.pricePerTire.toFixed(2)}</span>
                    <span>${total.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-green-600 font-semibold">
                    <span>✓ {isFr ? 'Inclus : montage + équilibrage' : 'Includes: mount + balance'}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sticky confirm bar */}
      {selected && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 flex items-center gap-4">
          <div className="flex-1">
            <p className="text-xs text-slate-500 uppercase font-semibold">
              {isFr ? 'Installation avec' : 'Install with'} {selected.name}
            </p>
            <p className="text-lg font-black text-slate-900">
              ${installTotal(selected).toFixed(2)}
              <span className="text-xs font-normal text-slate-400 ml-1">
                ({quantity} {isFr ? 'pneus' : 'tires'})
              </span>
            </p>
          </div>
          <button
            onClick={handleConfirm}
            className="bg-red-600 text-white font-bold px-6 py-3 rounded-lg hover:bg-red-700 transition"
          >
            {isFr ? 'Confirmer →' : 'Confirm →'}
          </button>
        </div>
      )}
    </div>
  );
};

export default InstallerSelect;
