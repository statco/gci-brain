import React, { useEffect, useRef, useState } from 'react';

interface Installer {
  id: string;
  name: string;
  address: string;
  city: string;
  province: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
  lat?: number;
  lng?: number;
  distance?: number;
}

interface MapComponentsProps {
  installers: Installer[];
  mapsLoaded?: boolean;
}

const MapComponents: React.FC<MapComponentsProps> = ({ installers, mapsLoaded }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);

  // EXTENSIVE LOGGING
  console.log('🔧 MapComponents RENDER:', {
    installersCount: installers?.length,
    installers: installers,
    mapsLoaded,
    hasMapRef: !!mapRef.current,
    hasWindowGoogle: !!window.google
  });

  useEffect(() => {
    console.log('🔄 MapComponents useEffect TRIGGERED');
    console.log('📊 Received installers:', installers);
    
    // Check each installer's coordinates
    installers.forEach((inst, idx) => {
      console.log(`🔍 Installer ${idx}:`, {
        name: inst.name,
        hasCoordinates: !!inst.coordinates,
        coordinates: inst.coordinates,
        lat: inst.lat,
        lng: inst.lng
      });
    });

    if (!mapRef.current) {
      console.warn('⚠️ mapRef.current is null - DOM not ready yet');
      return;
    }

    if (!window.google) {
      console.warn('⚠️ window.google is undefined - Google Maps not loaded');
      return;
    }

    console.log('✅ Prerequisites met - starting map initialization');

    const initMap = async () => {
      try {
        console.log('🗺️ Initializing map with', installers.length, 'installers');
        
        // Use the new importLibrary pattern
        const { Map } = await google.maps.importLibrary("maps") as google.maps.MapsLibrary;
        const { AdvancedMarkerElement } = await google.maps.importLibrary("marker") as google.maps.MarkerLibrary;

        console.log('✅ Google Maps libraries loaded');

        let currentMap = mapInstance;
        
        if (!currentMap) {
          console.log('📍 Creating new map instance...');
          currentMap = new Map(mapRef.current!, {
            center: { lat: 48.2368, lng: -79.0228 },
            zoom: 11,
            mapId: 'gci-installers-map',
            disableDefaultUI: false,
            clickableIcons: false,
          });
          setMapInstance(currentMap);
          console.log('✅ Map instance created');
        }

        // Clear old markers
        markersRef.current.forEach(m => m.map = null);
        markersRef.current = [];
        
        // Filter installers with valid coordinates
        const validInstallers = installers.filter(inst => {
          // Try both coordinate formats
          const coords = inst.coordinates || (inst.lat && inst.lng ? { lat: inst.lat, lng: inst.lng } : null);
          const isValid = coords && !isNaN(coords.lat) && !isNaN(coords.lng);
          
          console.log(`🔎 Installer "${inst.name}" validation:`, {
            hasCoordinates: !!inst.coordinates,
            hasLatLng: !!(inst.lat && inst.lng),
            coords,
            isValid
          });
          
          return isValid;
        });

        console.log(`📍 Found ${validInstallers.length} valid installers out of ${installers.length} total`);

        if (validInstallers.length === 0) {
          console.error('❌ NO VALID INSTALLERS - No markers will be created!');
          console.log('Sample installer structure:', installers[0]);
          return;
        }

        // Create markers
        markersRef.current = validInstallers.map((inst, idx) => {
          const coords = inst.coordinates || { lat: inst.lat!, lng: inst.lng! };
          
          console.log(`📌 Creating marker ${idx + 1}:`, {
            name: inst.name,
            position: coords
          });

          const markerElement = document.createElement('div');
          markerElement.innerHTML = `
            <div style="
              background: #ef4444;
              color: white;
              padding: 8px 12px;
              border-radius: 20px;
              font-weight: 600;
              font-size: 14px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.3);
              cursor: pointer;
              white-space: nowrap;
            ">
              📍 ${inst.name}
            </div>
          `;

          const marker = new AdvancedMarkerElement({
            map: currentMap,
            position: coords,
            content: markerElement,
            title: inst.name,
          });

          console.log(`✅ Marker ${idx + 1} created for ${inst.name}`);
          return marker;
        });

        console.log(`✅ Created ${markersRef.current.length} markers total`);

        // Fit bounds to show all markers
        if (markersRef.current.length > 0) {
          const bounds = new google.maps.LatLngBounds();
          validInstallers.forEach(inst => {
            const coords = inst.coordinates || { lat: inst.lat!, lng: inst.lng! };
            bounds.extend(coords);
          });
          currentMap.fitBounds(bounds);
          
          console.log('📐 Bounds fitted to markers');
          
          // Set max zoom
          google.maps.event.addListenerOnce(currentMap, 'bounds_changed', () => {
            const zoom = currentMap!.getZoom();
            if (zoom && zoom > 13) {
              currentMap!.setZoom(13);
            }
            console.log('🔍 Final zoom level:', currentMap!.getZoom());
          });
        }

        console.log('✅ Map setup complete!');

      } catch (err) {
        console.error("❌ Map initialization error:", err);
      }
    };

    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      console.log('⏰ Timer triggered - calling initMap()');
      initMap();
    }, 100);

    return () => {
      console.log('🧹 Cleanup: clearing timer');
      clearTimeout(timer);
    };
  }, [installers, mapInstance]);

  if (!window.google) {
    console.log('⏳ Showing loading state - Google Maps not ready');
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-900 rounded-xl">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-400">Loading Google Maps...</p>
        </div>
      </div>
    );
  }

  console.log('🎨 Rendering map container');

  return (
    <div className="w-full h-full rounded-xl overflow-hidden border border-slate-200 shadow-lg">
      <div ref={mapRef} className="w-full h-full min-h-[500px]" />
    </div>
  );
};

export default MapComponents;
