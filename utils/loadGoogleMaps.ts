// utils/loadGoogleMaps.ts

let isLoading = false;
let isLoaded = false;

export const loadGoogleMaps = (apiKey: string): Promise<void> => {
  // If already loaded, resolve immediately
  if (isLoaded && window.google?.maps) {
    console.log('✅ Google Maps already loaded');
    return Promise.resolve();
  }

  // If currently loading, wait for it
  if (isLoading) {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (window.google?.maps) {
          clearInterval(checkInterval);
          isLoaded = true;
          resolve();
        }
      }, 100);
    });
  }

  // Start loading
  isLoading = true;

  return new Promise((resolve, reject) => {
    if (!apiKey) {
      reject(new Error('Google Maps API key is required'));
      return;
    }

    console.log('🗺️ Loading Google Maps API...');

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      console.log('✅ Google Maps API loaded successfully');
      isLoaded = true;
      isLoading = false;
      resolve();
    };

    script.onerror = () => {
      console.error('❌ Failed to load Google Maps API');
      isLoading = false;
      reject(new Error('Failed to load Google Maps'));
    };

    document.head.appendChild(script);
  });
};
