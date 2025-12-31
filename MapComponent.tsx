import React, { useEffect, useRef } from 'react';

const MapComponent: React.FC = () => {
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const initMap = async () => {
      // 1. Check if the loader in index.html has initialized the library
      if (window.google && mapRef.current) {
        try {
          // 2. Import the necessary libraries (Maps and Marker)
          const { Map } = await google.maps.importLibrary("maps") as google.maps.MapsLibrary;
          const { AdvancedMarkerElement } = await google.maps.importLibrary("marker") as google.maps.MarkerLibrary;

          // 3. Create the map instance
          const map = new Map(mapRef.current, {
            center: { lat: 45.5017, lng: -73.5673 }, // Montreal, for example
            zoom: 12,
            mapId: "YOUR_MAP_ID", // Required for Advanced Markers
          });

          // 4. Add a marker
          new AdvancedMarkerElement({
            map: map,
            position: { lat: 45.5017, lng: -73.5673 },
            title: "GCI Tire Location",
          });
        } catch (error) {
          console.error("Error loading Google Maps:", error);
        }
      }
    };

    initMap();
  }, []);

  return (
    <div className="w-full h-[500px] rounded-xl shadow-lg overflow-hidden border border-slate-200">
      <div ref={mapRef} className="w-full h-full" />
    </div>
  );
};

export default MapComponent;
