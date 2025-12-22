import React, { useState, useEffect } from 'react';
import { airtableService, InstallerRecord } from '../services/airtableService';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  tireProduct: {
    id: string;
    title: string;
    price: number;
    size: string;
    brand: string;
    imageUrl?: string;
  };
  quantity?: number;
  userLocation?: { lat: number; lng: number };
}

const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  tireProduct,
  quantity = 4,
  userLocation,
}) => {
  const [deliveryOption, setDeliveryOption] = useState<'home' | 'installer'>('home');
  const [selectedInstaller, setSelectedInstaller] = useState<InstallerRecord | null>(null);
  const [nearbyInstallers, setNearbyInstallers] = useState<InstallerRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [customerInfo, setCustomerInfo] = useState({
    name: '',
    email: '',
    phone: '',
  });

  useEffect(() => {
    if (isOpen && userLocation) {
      loadNearbyInstallers();
    }
  }, [isOpen, userLocation]);

  const loadNearbyInstallers = async () => {
    if (!userLocation) return;

    try {
      const installers = await airtableService.findNearbyInstallers(
        userLocation.lat,
        userLocation.lng,
        50 // 50km radius
      );
      setNearbyInstallers(installers);
      if (installers.length > 0) {
        setSelectedInstaller(installers[0]);
      }
    } catch (error) {
      console.error('Error loading installers:', error);
    }
  };

  const calculateTotal = () => {
    const tireTotal = tireProduct.price * quantity;
    const installationTotal =
      deliveryOption === 'installer' && selectedInstaller
        ? (selectedInstaller.fields.PricePerTire || 0) * quantity
        : 0;
    return tireTotal + installationTotal;
  };

  const handleCheckout = async () => {
    setLoading(true);

    try {
      // Prepare cart items
      const cartItems = [
        {
          variantId: tireProduct.id,
          quantity: quantity,
        },
      ];

      // If installation selected, create job in Airtable
      if (deliveryOption === 'installer' && selectedInstaller) {
        await airtableService.createInstallationJob({
          CustomerName: customerInfo.name,
          CustomerEmail: customerInfo.email,
          CustomerPhone: customerInfo.phone,
          InstallerId: selectedInstaller.id,
          TireProduct: `${tireProduct.brand} ${tireProduct.size} - ${tireProduct.title}`,
          Quantity: quantity,
          InstallationPrice: (selectedInstaller.fields.PricePerTire || 0) * quantity,
          Status: 'Pending',
        });

        // Add installation service to cart
        // Note: You'll need to create a "Installation Service" product in Shopify
        // with variants for each installer
        cartItems.push({
          variantId: `installation-${selectedInstaller.id}`, // Replace with actual variant ID
          quantity: 1,
        });
      }

      // Redirect to Shopify checkout
      const checkoutUrl = await createShopifyCheckout(cartItems, customerInfo);
      window.location.href = checkoutUrl;
    } catch (error) {
      console.error('Checkout error:', error);
      alert('Failed to create checkout. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Helper function to create Shopify checkout
  const createShopifyCheckout = async (
    items: any[],
    customer: any
  ): Promise<string> => {
    // This should use your Shopify service
    // For now, returning a placeholder
    return 'https://your-store.myshopify.com/checkout';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      ></div>

      {/* Modal */}
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="relative bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
            <h2 className="text-2xl font-bold text-gray-900">Complete Your Order</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-6 space-y-6">
            {/* Product Summary */}
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center space-x-4">
                {tireProduct.imageUrl && (
                  <img
                    src={tireProduct.imageUrl}
                    alt={tireProduct.title}
                    className="w-20 h-20 object-cover rounded"
                  />
                )}
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">{tireProduct.title}</h3>
                  <p className="text-gray-600">{tireProduct.size}</p>
                  <p className="text-sm text-gray-500">Quantity: {quantity}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-gray-900">
                    ${(tireProduct.price * quantity).toFixed(2)}
                  </p>
                  <p className="text-sm text-gray-500">${tireProduct.price}/tire</p>
                </div>
              </div>
            </div>

            {/* Customer Information */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Your Information</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="Full Name"
                  value={customerInfo.name}
                  onChange={(e) =>
                    setCustomerInfo({ ...customerInfo, name: e.target.value })
                  }
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={customerInfo.email}
                  onChange={(e) =>
                    setCustomerInfo({ ...customerInfo, email: e.target.value })
                  }
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
                <input
                  type="tel"
                  placeholder="Phone Number"
                  value={customerInfo.phone}
                  onChange={(e) =>
                    setCustomerInfo({ ...customerInfo, phone: e.target.value })
                  }
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>
            </div>

            {/* Delivery Options */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Delivery & Installation</h3>
              <div className="space-y-3">
                {/* Home Delivery */}
                <label
                  className={`
                    flex items-start p-4 border-2 rounded-lg cursor-pointer transition-all
                    ${
                      deliveryOption === 'home'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-blue-300'
                    }
                  `}
                >
                  <input
                    type="radio"
                    name="delivery"
                    value="home"
                    checked={deliveryOption === 'home'}
                    onChange={(e) => setDeliveryOption(e.target.value as 'home')}
                    className="mt-1"
                  />
                  <div className="ml-3 flex-1">
                    <div className="font-semibold">Home Delivery</div>
                    <p className="text-sm text-gray-600 mt-1">
                      Tires delivered to your address. You arrange installation separately.
                    </p>
                    <p className="text-sm font-semibold text-green-600 mt-2">FREE</p>
                  </div>
                </label>

                {/* Professional Installation */}
                <label
                  className={`
                    flex items-start p-4 border-2 rounded-lg cursor-pointer transition-all
                    ${
                      deliveryOption === 'installer'
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-blue-300'
                    }
                  `}
                >
                  <input
                    type="radio"
                    name="delivery"
                    value="installer"
                    checked={deliveryOption === 'installer'}
                    onChange={(e) => setDeliveryOption(e.target.value as 'installer')}
                    className="mt-1"
                  />
                  <div className="ml-3 flex-1">
                    <div className="font-semibold flex items-center">
                      Professional Installation
                      <span className="ml-2 px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                        RECOMMENDED
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      Tires delivered to certified installer. Includes mounting, balancing, and
                      disposal.
                    </p>
                    {selectedInstaller && (
                      <p className="text-sm font-semibold text-blue-600 mt-2">
                        +${(selectedInstaller.fields.PricePerTire || 0) * quantity} installation
                      </p>
                    )}
                  </div>
                </label>
              </div>
            </div>

            {/* Installer Selection */}
            {deliveryOption === 'installer' && nearbyInstallers.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold mb-3">Select Installer</h3>
                <div className="space-y-3">
                  {nearbyInstallers.slice(0, 3).map((installer) => (
                    <label
                      key={installer.id}
                      className={`
                        flex items-center p-4 border-2 rounded-lg cursor-pointer transition-all
                        ${
                          selectedInstaller?.id === installer.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-blue-300'
                        }
                      `}
                    >
                      <input
                        type="radio"
                        name="installer"
                        checked={selectedInstaller?.id === installer.id}
                        onChange={() => setSelectedInstaller(installer)}
                        className="mt-1"
                      />
                      <div className="ml-3 flex-1">
                        <div className="font-semibold">{installer.fields.Name}</div>
                        <p className="text-sm text-gray-600">
                          {installer.fields.City}, {installer.fields.Province}
                        </p>
                        {installer.fields.Rating && (
                          <div className="flex items-center mt-1">
                            <span className="text-yellow-500 text-sm">
                              {'★'.repeat(Math.floor(installer.fields.Rating))}
                            </span>
                            <span className="ml-1 text-sm text-gray-600">
                              ({installer.fields.Rating.toFixed(1)})
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-gray-900">
                          ${installer.fields.PricePerTire}/tire
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Order Summary */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-gray-600">
                <span>Tires ({quantity}x)</span>
                <span>${(tireProduct.price * quantity).toFixed(2)}</span>
              </div>
              {deliveryOption === 'installer' && selectedInstaller && (
                <div className="flex justify-between text-gray-600">
                  <span>Installation ({quantity}x)</span>
                  <span>
                    ${((selectedInstaller.fields.PricePerTire || 0) * quantity).toFixed(2)}
                  </span>
                </div>
              )}
              <div className="border-t border-gray-300 pt-2 mt-2">
                <div className="flex justify-between text-xl font-bold">
                  <span>Total</span>
                  <span>${calculateTotal().toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Checkout Button */}
            <button
              onClick={handleCheckout}
              disabled={
                loading ||
                !customerInfo.name ||
                !customerInfo.email ||
                !customerInfo.phone ||
                (deliveryOption === 'installer' && !selectedInstaller)
              }
              className="w-full py-4 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Processing...
                </span>
              ) : (
                `Proceed to Checkout • $${calculateTotal().toFixed(2)}`
              )}
            </button>

            <p className="text-xs text-gray-500 text-center">
              You'll be redirected to Shopify to complete your purchase securely.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CheckoutModal;
