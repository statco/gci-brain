import React, { useEffect, useRef, useState } from 'react';

interface Installer {
  id: string;
  name: string;
  address: string;
  city: string;
  province: string;
  postalCode?: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
  distance?: number;
  pricePerTire?: number;
  rating?: number;
}

interface InstallerMapProps {
  installers: Installer[];
  onSelectInstaller: (installer: Installer) => void;
  userLocation?: { lat: number; lng: number };
  mapsLoaded: boolean; 
}

const InstallerMap: React.FC<InstallerMapProps> = ({ 
  installers, 
  onSelectInstaller, 
  userLocation,
  mapsLoaded 
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  const [markers, setMarkers] = useState<google.maps.marker.AdvancedMarkerElement[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Default center based on your project logs (Rouyn-Noranda area)
  const defaultCenter = userLocation || { lat: 48.2359, lng: -79.0242 };

  useEffect(() => {
    // CRITICAL GUARD: Only run when the script is loaded AND the div exists in the DOM
    if (!mapsLoaded || !mapRef.current) return;

    const initMap = async () => {
      try {
        const { Map } = await google.maps.importLibrary("maps") as google.maps.MapsLibrary;
        const { AdvancedMarkerElement } = await google.maps.importLibrary("marker") as google.maps.MarkerLibrary;

        // 1. Create the Map Instance if it doesn't exist yet
        let currentMap = mapInstance;
        if (!currentMap) {
          currentMap = new Map(mapRef.current!, {
            center: defaultCenter,
            zoom: 10,
            mapId: 'gci-installers-map', // Ensure this ID is a "Vector" map in Google Console
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
          });
          setMapInstance(currentMap);
        }

        // 2. Clear old markers before drawing new ones to prevent duplicates
        markers.forEach(m => m.map = null);

        const newMarkers: google.maps.marker.AdvancedMarkerElement[] = [];
        const bounds = new google.maps.LatLngBounds();

        // 3. Add pins for each installer
        installers.forEach((installer) => {
          if (!installer.coordinates) return;

          // Create a custom HTML element for the marker
          const markerElement = document.createElement('div');
          markerElement.innerHTML = `
            <div style="
              background: #ef4444;
              color: white;
              padding: 6px 14px;
              border-radius: 30px;
              font-weight: 800;
              font-size: 12px;
              box-shadow: 0 4px 10px rgba(0,0,0,0.3);
              cursor: pointer;
              white-space: nowrap;
              border: 2px solid white;
              transition: transform 0.2s ease, background 0.2s ease;
            ">
              📍 ${installer.name}
            </div>
          `;

          const marker = new AdvancedMarkerElement({
            map: currentMap,
            position: installer.coordinates,
            content: markerElement,
            title: installer.name,
          });

          // Handle Selection
          markerElement.addEventListener('click', () => {
            onSelectInstaller(installer);
            currentMap?.panTo(installer.coordinates!);
            currentMap?.setZoom(14);
            
            // Visual feedback: Highlight selected pin
            markerElement.querySelector('div')!.style.background = '#2563eb';
          });

          newMarkers.push(marker);
          bounds.extend(installer.coordinates);
        });

        setMarkers(newMarkers);

        // 4. Auto-fit the camera to show all markers
        if (newMarkers.length > 0) {
          currentMap.fitBounds(bounds);
          
          // Refine zoom level if it's too close/too far
          const listener = google.maps.event.addListener(currentMap, 'idle', () => {
            const currentZoom = currentMap!.getZoom();
            if (currentZoom && currentZoom > 15) currentMap!.setZoom(15);
            google.maps.event.removeListener(listener);
          });
        }

      } catch (err) {
        console.error('❌ Map Initialization Error:', err);
        setError('Google Maps could not initialize. Check your Map ID and API restrictions.');
      }
    };

    initMap();

    // Cleanup: Clear markers when the component is destroyed
    return () => {
      markers.forEach(m => m.map = null);
    };
  }, [mapsLoaded, installers, userLocation]); // Dependencies ensure fresh data shows on map

  if (error) {
    return (
      <div className="w-full h-[500px] rounded-xl border-2 border-dashed border-red-200 bg-red-50 flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-red-600 font-black uppercase tracking-widest mb-2">Map Error</p>
          <p className="text-red-500 text-sm max-w-xs">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-[550px] rounded-2xl border border-slate-200 overflow-hidden shadow-2xl bg-slate-50 relative">
      {/* Loading Overlay */}
      {!mapsLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm z-20">
          <div className="animate-spin rounded-full h-10 w-10 border-t-4 border-red-600 border-r-4 border-r-transparent"></div>
          <p className="mt-4 text-slate-600 font-bold animate-pulse">Initializing Secure Map...</p>
        </div>
      )}
      <div ref={mapRef} className="w-full h-full" />
    </div>
  );
};

export default InstallerMap;