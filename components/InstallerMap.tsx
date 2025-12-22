import React, { useEffect, useState } from 'react';
import { airtableService, InstallerRecord } from '../services/airtableService';

interface InstallerMapProps {
  userLocation?: { lat: number; lng: number };
  onInstallerSelect?: (installer: InstallerRecord) => void;
}

const InstallerMap: React.FC<InstallerMapProps> = ({
  userLocation,
  onInstallerSelect,
}) => {
  const [installers, setInstallers] = useState<InstallerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [selectedInstaller, setSelectedInstaller] = useState<InstallerRecord | null>(null);

  useEffect(() => {
    loadInstallers();
  }, [userLocation]);

  useEffect(() => {
    if (installers.length > 0 && !map) {
      initializeMap();
    }
  }, [installers]);

  const loadInstallers = async () => {
    try {
      setLoading(true);
      let installersData: InstallerRecord[];

      if (userLocation) {
        // Find nearby installers within 100km
        installersData = await airtableService.findNearbyInstallers(
          userLocation.lat,
          userLocation.lng,
          100
        );
      } else {
        // Get all active installers
        installersData = await airtableService.getActiveInstallers();
      }

      setInstallers(installersData);
      setError(null);
    } catch (err) {
      console.error('Error loading installers:', err);
      setError('Unable to load installers. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const initializeMap = () => {
    const mapElement = document.getElementById('installer-map');
    if (!mapElement || !window.google) return;

    // Center on user location or first installer
    const center = userLocation || {
      lat: installers[0]?.fields.Latitude || 45.5017,
      lng: installers[0]?.fields.Longitude || -73.5673,
    };

    const googleMap = new google.maps.Map(mapElement, {
      zoom: 10,
      center,
      styles: [
        {
          featureType: 'poi',
          elementType: 'labels',
          stylers: [{ visibility: 'off' }],
        },
      ],
    });

    setMap(googleMap);

    // Add user location marker
    if (userLocation) {
      new google.maps.Marker({
        position: userLocation,
        map: googleMap,
        icon: {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#3B82F6">
              <circle cx="12" cy="12" r="8"/>
            </svg>
          `),
          scaledSize: new google.maps.Size(24, 24),
        },
        title: 'Your Location',
      });
    }

    // Add installer markers
    installers.forEach((installer) => {
      if (!installer.fields.Latitude || !installer.fields.Longitude) return;

      const marker = new google.maps.Marker({
        position: {
          lat: installer.fields.Latitude,
          lng: installer.fields.Longitude,
        },
        map: googleMap,
        title: installer.fields.Name,
        icon: {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="#DC2626">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
          `),
          scaledSize: new google.maps.Size(32, 32),
        },
      });

      // Add click listener
      marker.addListener('click', () => {
        setSelectedInstaller(installer);
        if (onInstallerSelect) {
          onInstallerSelect(installer);
        }
      });
    });
  };

  const handleInstallerClick = (installer: InstallerRecord) => {
    setSelectedInstaller(installer);
    if (onInstallerSelect) {
      onInstallerSelect(installer);
    }

    // Center map on selected installer
    if (map && installer.fields.Latitude && installer.fields.Longitude) {
      map.panTo({
        lat: installer.fields.Latitude,
        lng: installer.fields.Longitude,
      });
      map.setZoom(14);
    }
  };

  const calculateDistance = (installer: InstallerRecord): string | null => {
    if (!userLocation || !installer.fields.Latitude || !installer.fields.Longitude) {
      return null;
    }

    const R = 6371; // Earth's radius in km
    const dLat = ((installer.fields.Latitude - userLocation.lat) * Math.PI) / 180;
    const dLon = ((installer.fields.Longitude - userLocation.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((userLocation.lat * Math.PI) / 180) *
        Math.cos((installer.fields.Latitude * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return `${distance.toFixed(1)} km away`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Map Container */}
      <div className="relative h-96 rounded-lg overflow-hidden shadow-lg">
        <div id="installer-map" className="w-full h-full"></div>
      </div>

      {/* Installer List */}
      <div className="grid md:grid-cols-2 gap-4">
        {installers.map((installer) => {
          const distance = calculateDistance(installer);
          const isSelected = selectedInstaller?.id === installer.id;

          return (
            <div
              key={installer.id}
              onClick={() => handleInstallerClick(installer)}
              className={`
                p-4 rounded-lg border-2 cursor-pointer transition-all
                ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50 shadow-lg'
                    : 'border-gray-200 hover:border-blue-300 hover:shadow-md'
                }
              `}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-lg text-gray-900">
                    {installer.fields.Name}
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {installer.fields.Address}
                    <br />
                    {installer.fields.City}, {installer.fields.Province}{' '}
                    {installer.fields.PostalCode}
                  </p>

                  {distance && (
                    <p className="text-sm text-blue-600 mt-2 font-medium">
                      📍 {distance}
                    </p>
                  )}

                  {installer.fields.Rating && (
                    <div className="flex items-center mt-2">
                      <span className="text-yellow-500">
                        {'★'.repeat(Math.floor(installer.fields.Rating))}
                        {'☆'.repeat(5 - Math.floor(installer.fields.Rating))}
                      </span>
                      <span className="ml-2 text-sm text-gray-600">
                        ({installer.fields.Rating.toFixed(1)})
                      </span>
                    </div>
                  )}

                  {installer.fields.PricePerTire && (
                    <p className="text-sm text-gray-700 mt-2">
                      <span className="font-semibold">
                        ${installer.fields.PricePerTire}/tire
                      </span>
                      {' installation'}
                    </p>
                  )}
                </div>

                {installer.fields.CalendlyLink && (
                  <a
                    href={installer.fields.CalendlyLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="ml-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium whitespace-nowrap"
                  >
                    Book Now
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {installers.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          No installers found in your area. Please expand your search radius.
        </div>
      )}
    </div>
  );
};

export default InstallerMap;
