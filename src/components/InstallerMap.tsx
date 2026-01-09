import React, { useEffect, useRef, useState } from 'react';

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
  lat?: number;       // ✅ FLAT structure
  lng?: number;       // ✅ FLAT structure
}

interface InstallerMapProps {
  installers: Installer[];
  userLocation?: { lat: number; lng: number };
}

const InstallerMap: React.FC<InstallerMapProps> = ({ 
  installers, 
  userLocation
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  const [markers, setMarkers] = useState<google.maps.marker.AdvancedMarkerElement[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Default center (Rouyn-Noranda)
  const defaultCenter = userLocation || { lat: 48.2368, lng: -79.0228 };

  console.log('🗺️ InstallerMap render:', {
    installersCount: installers.length,
    hasGoogle: !!window.google,
    hasMapRef: !!mapRef.current,
    installers
  });

  useEffect(() => {
    // Wait for Google Maps and DOM
    if (!window.google || !mapRef.current) {
      console.log('⏳ Waiting for prerequisites...', {
        hasGoogle: !!window.google,
        hasMapRef: !!mapRef.current
      });
      return;
    }

    const initMap = async () => {
      try {
        console.log('🚀 Starting map initialization...');

        const { Map } = await google.maps.importLibrary("maps") as google.maps.MapsLibrary;
        const { AdvancedMarkerElement } = await google.maps.importLibrary("marker") as google.maps.MarkerLibrary;

        console.log('✅ Google Maps libraries loaded');

        // Create map instance
        let currentMap = mapInstance;
        if (!currentMap) {
          console.log('📍 Creating new map instance...');
          currentMap = new Map(mapRef.current!, {
            center: defaultCenter,
            zoom: 10,
            mapId: 'gci-installers-map',
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
          });
          setMapInstance(currentMap);
          console.log('✅ Map instance created');
        }

        // Clear old markers
        markers.forEach(m => m.map = null);

        const newMarkers: google.maps.marker.AdvancedMarkerElement[] = [];
        const bounds = new google.maps.LatLngBounds();

        // Filter valid installers
        const validInstallers = installers.filter(inst => {
          const hasCoords = inst.lat !== undefined && inst.lng !== undefined && 
                           !isNaN(inst.lat) && !isNaN(inst.lng);
          if (!hasCoords) {
            console.warn('⚠️ Skipping installer without valid coordinates:', inst.name, {
              lat: inst.lat,
              lng: inst.lng
            });
          }
          return hasCoords;
        });

        console.log(`📍 Creating markers for ${validInstallers.length} valid installers`);

        if (validInstallers.length === 0) {
          console.error('❌ No valid installers to display on map');
          setError('No installers with valid coordinates found');
          return;
        }

        // Create markers
        validInstallers.forEach((installer) => {
          const position = { lat: installer.lat!, lng: installer.lng! };

          console.log(`📌 Creating marker for ${installer.name}:`, position);

          // Create custom marker element
          const markerElement = document.createElement('div');
          markerElement.innerHTML = `
            <div style="
              background: #ef4444;
              color: white;
              padding: 8px 14px;
              border-radius: 30px;
              font-weight: 800;
              font-size: 12px;
              box-shadow: 0 4px 10px rgba(0,0,0,0.3);
              cursor: pointer;
              white-space: nowrap;
              border: 2px solid white;
              transition: transform 0.2s ease;
            ">
              📍 ${installer.name}
            </div>
          `;

          // Add hover effect
          markerElement.addEventListener('mouseenter', () => {
            const div = markerElement.querySelector('div') as HTMLElement;
            div.style.transform = 'scale(1.1)';
            div.style.background = '#dc2626';
          });

          markerElement.addEventListener('mouseleave', () => {
            const div = markerElement.querySelector('div') as HTMLElement;
            div.style.transform = 'scale(1)';
            div.style.background = '#ef4444';
          });

          const marker = new AdvancedMarkerElement({
            map: currentMap,
            position: position,
            content: markerElement,
            title: installer.name,
          });

          newMarkers.push(marker);
          bounds.extend(position);
        });

        setMarkers(newMarkers);
        console.log(`✅ Created ${newMarkers.length} markers`);

        // Fit bounds to show all markers
        if (newMarkers.length > 0) {
          currentMap.fitBounds(bounds);
          console.log('📐 Bounds fitted to show all markers');
          
          // Limit max zoom
          const listener = google.maps.event.addListener(currentMap, 'idle', () => {
            const currentZoom = currentMap!.getZoom();
            if (currentZoom && currentZoom > 13) {
              currentMap!.setZoom(13);
              console.log('🔍 Zoom limited to 13');
            }
            google.maps.event.removeListener(listener);
          });
        }

        console.log('✅ Map initialization complete!');

      } catch (err) {
        console.error('❌ Map initialization error:', err);
        setError('Failed to initialize Google Maps. Please refresh the page.');
      }
    };

    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      console.log('⏰ Timer triggered - calling initMap()');
      initMap();
    }, 100);

    return () => {
      console.log('🧹 Cleanup: clearing markers and timer');
      markers.forEach(m => m.map = null);
      clearTimeout(timer);
    };
  }, [installers, userLocation]);

  // Error state
  if (error) {
    return (
      <div className="w-full h-[500px] rounded-xl border-2 border-dashed border-red-200 bg-red-50 flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-red-600 font-black uppercase tracking-widest mb-2">Map Error</p>
          <p className="text-red-500 text-sm max-w-xs">{error}</p>
          <button 
            onClick={() => window.location.reload()} 
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  // Loading state
  if (!window.google) {
    return (
      <div className="w-full h-[500px] rounded-2xl border border-slate-200 overflow-hidden shadow-lg bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-t-4 border-red-600 border-r-4 border-r-transparent mx-auto"></div>
          <p className="mt-4 text-slate-600 font-bold animate-pulse">Loading map...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-[550px] rounded-2xl border border-slate-200 overflow-hidden shadow-2xl bg-slate-50">
      <div ref={mapRef} className="w-full h-full" />
    </div>
  );
};

export default InstallerMap;
