// components/InstallerMap.tsx
import React, { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../utils/loadGoogleMaps';

interface Installer {
  id: string;
  name: string;
  address: string;
  city: string;
  province: string;
  phone: string;
  lat?: number;
  lng?: number;
  pricePerTire?: number;
  rating?: number;
}

interface InstallerMapProps {
  installers: Installer[];
  userLocation?: { lat: number; lng: number };
}

const InstallerMap: React.FC<InstallerMapProps> = ({ installers, userLocation }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initMap = async () => {
      try {
        // Get API key from environment
        const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
        
        console.log('🔑 API Key check:', apiKey ? `Found (${apiKey.substring(0, 10)}...)` : 'Not found');
        
        if (!apiKey) {
          setError('Google Maps API key not configured');
          setIsLoading(false);
          return;
        }

        // Load Google Maps API
        await loadGoogleMaps(apiKey);

        if (!mapRef.current) {
          setIsLoading(false);
          return;
        }

        // ✅ Import Maps library (modern API)
        console.log('📚 Importing Google Maps library...');
        const { Map } = await google.maps.importLibrary("maps") as google.maps.MapsLibrary;
        const { AdvancedMarkerElement } = await google.maps.importLibrary("marker") as google.maps.MarkerLibrary;
        console.log('✅ Libraries imported successfully');

        // Calculate center point
        const center = userLocation || 
          (installers.length > 0 && installers[0].lat && installers[0].lng
            ? { lat: installers[0].lat, lng: installers[0].lng }
            : { lat: 48.2368, lng: -79.0228 });

        // Initialize map with modern API
        console.log('🗺️ Initializing map at center:', center);
        const newMap = new Map(mapRef.current, {
          center,
          zoom: 10,
          mapId: 'INSTALLER_MAP', // Required for AdvancedMarkerElement
        });

        console.log('✅ Map created successfully');
        setMap(newMap);
        setIsLoading(false);

        // Add user location marker
        if (userLocation) {
          new AdvancedMarkerElement({
            position: userLocation,
            map: newMap,
            title: 'Your Location',
          });
        }

        // Add installer markers
        const bounds = new google.maps.LatLngBounds();
        
        console.log(`📍 Adding ${installers.length} installer markers...`);
        
        installers.forEach((installer) => {
          if (!installer.lat || !installer.lng) {
            console.log(`⚠️ ${installer.name}: Missing coordinates`);
            return;
          }

          const position = { lat: installer.lat, lng: installer.lng };
          console.log(`📌 ${installer.name}: ${position.lat}, ${position.lng}`);
          bounds.extend(position);

          // Create marker with AdvancedMarkerElement
          const marker = new AdvancedMarkerElement({
            position,
            map: newMap,
            title: installer.name,
          });

          // Create info window
          const infoWindow = new google.maps.InfoWindow({
            content: `
              <div style="padding: 12px; font-family: system-ui, -apple-system, sans-serif;">
                <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 700; color: #1e293b;">
                  ${installer.name}
                </h3>
                <p style="margin: 4px 0; font-size: 14px; color: #64748b;">
                  ${installer.address}<br>
                  ${installer.city}, ${installer.province}
                </p>
                <p style="margin: 4px 0; font-size: 14px; color: #64748b;">
                  📞 ${installer.phone}
                </p>
                ${installer.pricePerTire ? `
                  <p style="margin: 8px 0 4px 0; font-size: 14px; font-weight: 600; color: #0f172a;">
                    $${installer.pricePerTire.toFixed(2)}/tire
                  </p>
                ` : ''}
                ${installer.rating ? `
                  <p style="margin: 4px 0; font-size: 14px; color: #f59e0b;">
                    ${'★'.repeat(Math.floor(installer.rating))} (${installer.rating.toFixed(1)})
                  </p>
                ` : ''}
              </div>
            `,
          });

          marker.addListener('click', () => {
            infoWindow.open(newMap, marker);
          });
        });

        // Fit map to show all markers
        if (installers.length > 0) {
          if (userLocation) {
            bounds.extend(userLocation);
          }
          console.log('🎯 Fitting map bounds to show all markers');
          newMap.fitBounds(bounds);
        } else {
          console.log('⚠️ No installers to show on map');
        }
      } catch (err) {
        console.error('Error initializing map:', err);
        setError('Failed to initialize map');
        setIsLoading(false);
      }
    };

    initMap();
  }, [installers, userLocation]);

  if (isLoading) {
    return (
      <div className="w-full h-96 bg-slate-100 rounded-lg flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-red-600 mx-auto mb-2" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-slate-600">Loading map...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-96 bg-slate-100 rounded-lg flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-600 mb-2">{error}</p>
          <p className="text-sm text-slate-500">
            Google Maps API key required
          </p>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={mapRef} 
      className="w-full h-96 rounded-lg border border-slate-300 shadow-md"
    />
  );
};

export default InstallerMap;
