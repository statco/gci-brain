import { useEffect, useRef } from 'react';
import * as maptilersdk from '@maptiler/sdk';
import '@maptiler/sdk/dist/maptiler-sdk.css';

interface Installer {
  id: string;
  name: string;
  address: string;
  city: string;
  province: string;
  phone: string;
  distance: number;
  pricePerTire?: number;
  rating?: number;
  lat?: number;
  lng?: number;
}

interface InstallerMapProps {
  installers: Installer[];
  userLocation?: { lat: number; lng: number };
}

const InstallerMap: React.FC<InstallerMapProps> = ({ installers, userLocation }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<maptilersdk.Map | null>(null);

  const defaultCenter: [number, number] = [
    userLocation?.lng ?? -79.0228,
    userLocation?.lat ?? 48.2368,
  ];

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    maptilersdk.config.apiKey = import.meta.env.VITE_MAPTILER_API_KEY || '';

    const map = new maptilersdk.Map({
      container: mapRef.current,
      style: maptilersdk.MapStyle.STREETS,
      center: defaultCenter,
      zoom: 9,
    });

    mapInstance.current = map;

    map.on('load', () => {
      // User location marker
      if (userLocation) {
        new maptilersdk.Marker({ color: '#3b82f6' })
          .setLngLat([userLocation.lng, userLocation.lat])
          .setPopup(new maptilersdk.Popup().setHTML('<strong>Your location</strong>'))
          .addTo(map);
      }

      // Installer markers
      installers.forEach(inst => {
        if (!inst.lat || !inst.lng) return;
        const popup = new maptilersdk.Popup({ offset: 25 }).setHTML(`
          <div style="font-family:sans-serif;min-width:160px">
            <strong style="font-size:14px">${inst.name}</strong><br/>
            <span style="font-size:12px;color:#666">${inst.city}, ${inst.province}</span><br/>
            ${inst.pricePerTire ? `<span style="font-size:13px;font-weight:600;color:#dc2626">$${inst.pricePerTire}/tire</span><br/>` : ''}
            ${inst.distance > 0 ? `<span style="font-size:11px;color:#888">${inst.distance.toFixed(1)} km away</span>` : ''}
          </div>
        `);
        new maptilersdk.Marker({ color: '#dc2626' })
          .setLngLat([inst.lng, inst.lat])
          .setPopup(popup)
          .addTo(map);
      });

      // Fit bounds to show all markers
      if (installers.length > 0) {
        const coords = installers
          .filter(i => i.lat && i.lng)
          .map(i => [i.lng!, i.lat!] as [number, number]);
        if (userLocation) coords.push([userLocation.lng, userLocation.lat]);
        if (coords.length > 1) {
          const bounds = coords.reduce(
            (b, c) => b.extend(c),
            new maptilersdk.LngLatBounds(coords[0], coords[0])
          );
          map.fitBounds(bounds, { padding: 60 });
        }
      }
    });

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, []);

  return (
    <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: '200px' }} />
  );
};

export default InstallerMap;
