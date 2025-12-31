// utils/loadGoogleMaps.ts

let loadPromise: Promise<void> | null = null;

export const loadGoogleMaps = (apiKey: string): Promise<void> => {
  // If already loaded, return resolved promise
  if (window.google?.maps) {
    console.log('✅ Google Maps already loaded');
    return Promise.resolve();
  }

  // If already loading, return existing promise
  if (loadPromise) {
    console.log('⏳ Google Maps already loading...');
    return loadPromise;
  }

  console.log('🗺️ Loading Google Maps API...');

  loadPromise = new Promise((resolve, reject) => {
    if (!apiKey) {
      reject(new Error('Google Maps API key is required'));
      return;
    }

    // Create a unique callback name
    const callbackName = `initGoogleMaps_${Date.now()}`;

    // Define the callback function that Google will call
    (window as any)[callbackName] = () => {
      console.log('✅ Google Maps API loaded successfully via callback');
      delete (window as any)[callbackName]; // Clean up
      resolve();
    };

    // Create script tag with callback parameter
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=${callbackName}&libraries=places`;
    script.async = true;
    script.defer = true;

    script.onerror = () => {
      console.error('❌ Failed to load Google Maps API script');
      delete (window as any)[callbackName];
      loadPromise = null;
      reject(new Error('Failed to load Google Maps script'));
    };

    document.head.appendChild(script);
    console.log('📡 Google Maps script tag added to page');
  });

  return loadPromise;
};
