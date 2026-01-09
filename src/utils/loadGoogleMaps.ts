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
    const callbackName = `initGoogleMaps`;

    // Define the callback function FIRST, before creating script
    (window as any)[callbackName] = () => {
      console.log('✅ Google Maps callback executed!');
      
      // Wait for google.maps to actually exist
      const checkMaps = setInterval(() => {
        if (window.google?.maps) {
          clearInterval(checkMaps);
          console.log('✅ Google Maps API fully loaded');
          delete (window as any)[callbackName]; // Clean up
          resolve();
        }
      }, 10);

      // Timeout after 5 seconds
      setTimeout(() => {
        clearInterval(checkMaps);
        if (!window.google?.maps) {
          console.error('❌ Timeout: google.maps never initialized');
          delete (window as any)[callbackName];
          loadPromise = null;
          reject(new Error('Google Maps timeout'));
        }
      }, 5000);
    };

    // NOW create and add script tag
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=${callbackName}`;
    script.async = true;
    script.defer = true;

    script.onerror = () => {
      console.error('❌ Failed to load Google Maps API script');
      delete (window as any)[callbackName];
      loadPromise = null;
      reject(new Error('Failed to load Google Maps script'));
    };

    document.head.appendChild(script);
    console.log('📡 Google Maps script tag added, waiting for callback...');
  });

  return loadPromise;
};
