import React, { useState } from 'react';
import { TireProduct, Language } from '../types';
import { translations } from '../utils/translations';

interface TireCardProps {
  tire: TireProduct;
  onSelect: (tire: TireProduct, quantity: number, withInstallation: boolean, total: number) => void;
  isFavorite: boolean;
  onToggleFavorite: (tire: TireProduct) => void;
  isCompareSelected: boolean;
  onToggleCompare: (tire: TireProduct) => void;
  onShowReviews: (tire: TireProduct) => void;
  lang: Language;
}

const TireCard: React.FC<TireCardProps> = ({ 
  tire, 
  onSelect, 
  isFavorite, 
  onToggleFavorite,
  isCompareSelected,
  onToggleCompare,
  onShowReviews,
  lang
}) => {
  const [quantity, setQuantity] = useState(4);
  const [withInstallation, setWithInstallation] = useState(true);
  const [showFitmentDetails, setShowFitmentDetails] = useState(false);
  
  // Prefer visualization if available, otherwise product image, otherwise empty
  const [activeImage, setActiveImage] = useState(tire.visualizationUrl || tire.imageUrl || "");
  const t = translations[lang];

  // Calculate pricing
  const itemPrice = tire.pricePerUnit;
  const installFee = withInstallation ? 15 : 0;  // ✅ FIXED: Use fixed $15 installation fee per tire
  const totalPerUnit = itemPrice + installFee;
  const displayTotal = totalPerUnit * quantity;

  const incrementQty = () => setQuantity(q => Math.min(q + 1, 12));
  const decrementQty = () => setQuantity(q => Math.max(q - 1, 1));
  const setSetOf4 = () => setQuantity(4);
  const toggleInstallation = () => setWithInstallation(!withInstallation);

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `GCI Tire: ${tire.brand} ${tire.model}`,
          text: `Check out these ${tire.brand} tires I found on GCI Tire AI Match.`,
          url: window.location.href,
        });
      } catch (err) {
        console.log('Error sharing', err);
      }
    } else {
      alert("Link copied to clipboard!");
    }
  };

  const tierColors: Record<string, string> = {
    'Good': 'bg-slate-100 text-slate-600 border-slate-200',
    'Better': 'bg-slate-200 text-slate-700 border-slate-300',
    'Best': 'bg-red-50 text-red-700 border-red-100'
  };

  // Determine which images we have
  const hasVisualization = !!tire.visualizationUrl;
  const hasProductImage = !!tire.imageUrl;
  const hasMultipleImages = hasVisualization && hasProductImage;

  return (
    <div className="bg-white rounded shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden border border-slate-200 flex flex-col h-full relative group">
      
      {/* Image Area */}
      <div className="relative h-64 bg-slate-50 flex items-center justify-center overflow-hidden border-b border-slate-100 group/image">
        
        {/* Main Image Display */}
        {activeImage ? (
            <img 
                src={activeImage} 
                alt={tire.model} 
                className={`h-full w-full ${activeImage === tire.imageUrl ? 'object-contain mix-blend-multiply p-6' : 'object-cover'} transition-all duration-500`} 
            />
        ) : (
            <div className="flex flex-col items-center justify-center text-slate-300">
                <svg className="w-16 h-16 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="text-xs font-bold uppercase tracking-wider">Image Not Available</span>
            </div>
        )}
        
        {/* Match Score Badge */}
        {tire.matchScore && (
          <div className="absolute top-4 left-4 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded shadow-sm z-10 uppercase tracking-wide">
              {tire.matchScore}% Match
          </div>
        )}

        {/* View Switcher Thumbnails - Only show if we have both types */}
        {hasMultipleImages && (
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-2 z-20 bg-white/80 backdrop-blur-md p-1 rounded-full shadow-md border border-slate-200 animate-fade-in-up">
                {tire.visualizationUrl && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); setActiveImage(tire.visualizationUrl!); }}
                        className={`w-8 h-8 rounded-full overflow-hidden border-2 transition-all ${activeImage === tire.visualizationUrl ? 'border-red-600 scale-110 shadow-sm' : 'border-slate-200 opacity-60 hover:opacity-100'}`}
                        title="AI Studio View"
                    >
                        <img src={tire.visualizationUrl} className="w-full h-full object-cover" alt="Studio View" />
                    </button>
                )}
                {tire.imageUrl && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); setActiveImage(tire.imageUrl); }}
                        className={`w-8 h-8 rounded-full overflow-hidden border-2 transition-all ${activeImage === tire.imageUrl ? 'border-red-600 scale-110 shadow-sm' : 'border-slate-200 opacity-60 hover:opacity-100'}`}
                        title="View Product"
                    >
                        <img src={tire.imageUrl} className="w-full h-full object-contain bg-white" alt="Product View" />
                    </button>
                )}
            </div>
        )}

        {/* DriveRight Verified Badge */}
        <div className="absolute top-4 right-14 bg-white/95 backdrop-blur-sm text-green-700 border border-green-200 px-2.5 py-1 rounded-full shadow-md z-10 flex items-center gap-1.5 transform transition-transform hover:scale-105 cursor-help" title="Fitment Verified by DriveRightData">
            <svg className="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span className="text-[10px] font-black uppercase tracking-wide leading-none py-0.5">{t.verifiedFitment}</span>
        </div>

        {/* Actions Top Right */}
        <div className="absolute top-4 right-4 flex flex-col gap-2">
            <button 
                onClick={() => onToggleFavorite(tire)}
                className={`p-2 rounded shadow-sm transition-all border ${isFavorite ? 'bg-red-50 text-red-600 border-red-100' : 'bg-white text-slate-300 border-slate-100 hover:text-red-500 hover:border-red-100'}`}
            >
                <svg className="w-5 h-5" fill={isFavorite ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
            </button>
            <button 
                onClick={handleShare}
                className="p-2 bg-white rounded shadow-sm border border-slate-100 text-slate-300 hover:text-slate-600 transition-colors"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
            </button>
        </div>
        
        {/* Caption Label */}
        {activeImage && (
            <div className="absolute bottom-4 left-4 text-[10px] font-bold text-slate-400 bg-white/90 px-2 py-0.5 rounded backdrop-blur-sm shadow-sm pointer-events-none border border-slate-100">
                {activeImage === tire.visualizationUrl ? 'AI Visualization' : 'Product Image'}
            </div>
        )}
      </div>

      <div className="p-5 flex-1 flex flex-col">
        {/* Header Info */}
        <div className="flex justify-between items-start mb-2">
            <div>
                <div className="flex flex-wrap gap-2 mb-2">
                    {tire.tier && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${tierColors[tire.tier] || 'bg-slate-100 text-slate-600'}`}>
                          {tire.tier} Tier
                      </span>
                    )}
                    {tire.has3PMSF && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-600 uppercase tracking-wider flex items-center gap-1" title="Three-Peak Mountain Snowflake Rated">
                             <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v18m9-9H3m15.364-6.364l-12.728 12.728m0-12.728l12.728 12.728" /></svg>
                            3PMSF
                        </span>
                    )}
                </div>
                <h3 className="font-black text-lg leading-tight text-slate-900 uppercase">{tire.brand}</h3>
                <p className="text-red-600 font-bold">{tire.model}</p>
            </div>
            {/* Reviews */}
            {tire.rating && tire.reviews && (
              <div 
                  className="flex flex-col items-end cursor-pointer group/reviews"
                  onClick={() => onShowReviews(tire)}
              >
                  <div className="flex text-yellow-500 text-sm gap-0.5">
                      {'★'.repeat(Math.round(tire.rating))}
                      <span className="text-slate-200">{'★'.repeat(5 - Math.round(tire.rating))}</span>
                  </div>
                  <span className="text-xs text-slate-400 group-hover/reviews:text-red-600 transition-colors underline decoration-dotted font-medium">
                      {tire.reviews} {t.reviews}
                  </span>
              </div>
            )}
        </div>

        {/* Description */}
        {tire.description && (
          <p className="text-sm text-slate-500 mb-4 line-clamp-2 leading-relaxed">{tire.description}</p>
        )}

        {/* Features */}
        {tire.features && tire.features.length > 0 && (
          <ul className="text-xs text-slate-600 space-y-2 mb-4 flex-1">
              {tire.features.slice(0, 3).map((feature, i) => (
                  <li key={i} className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      <span className="font-medium">{feature}</span>
                  </li>
              ))}
          </ul>
        )}

        {/* Source Link if available */}
        {tire.searchSourceUrl && (
            <a 
                href={tire.searchSourceUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[10px] text-slate-400 flex items-center gap-1 mb-4 hover:text-red-600 truncate max-w-full font-semibold uppercase tracking-wide"
            >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                Found on {tire.searchSourceTitle || 'Web'}
            </a>
        )}

        <div className="border-t border-slate-100 my-4"></div>

        {/* Configuration Area */}
        <div className="mb-5 space-y-3">
             {/* Quantity and Quick Select */}
            <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase">{t.quantity}</span>
                {quantity !== 4 && (
                    <button onClick={setSetOf4} className="text-[10px] font-bold text-red-600 hover:text-red-700 uppercase flex items-center gap-1">
                        {t.setOf4}
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    </button>
                )}
            </div>

            <div className="flex items-center gap-3">
                {/* Quantity Stepper */}
                <div className="flex items-center border border-slate-200 rounded overflow-hidden">
                    <button onClick={decrementQty} className="px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold transition-colors disabled:opacity-50" disabled={quantity <= 1}>-</button>
                    <span className="px-3 py-2 font-bold text-slate-800 bg-white min-w-[2.5rem] text-center border-l border-r border-slate-100">{quantity}</span>
                    <button onClick={incrementQty} className="px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold transition-colors">+</button>
                </div>
                
                {/* Installation Toggle */}
                <div 
                    onClick={toggleInstallation}
                    className={`flex-1 cursor-pointer border rounded px-3 py-2 flex items-center justify-between transition-all select-none
                        ${withInstallation ? 'bg-green-50 border-green-200 ring-1 ring-green-200' : 'bg-white border-slate-200 hover:border-slate-300'}`}
                >
                    <div className="flex items-center gap-2">
                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${withInstallation ? 'bg-green-500 border-green-500' : 'bg-white border-slate-300'}`}>
                            {withInstallation && <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                        </div>
                        <div className="flex flex-col leading-none">
                            <span className={`text-xs font-bold ${withInstallation ? 'text-green-800' : 'text-slate-600'}`}>{t.addInstallation}</span>
                            <span className="text-[10px] text-slate-400 mt-0.5">+$15.00 {t.installFee}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        {/* Pricing */}
        <div className="flex items-end justify-between mb-4">
            <div>
                <p className="text-xs text-slate-400 font-bold uppercase">{t.totalPrice}</p>
                <p className="text-3xl font-black text-slate-900 tracking-tight leading-none">${displayTotal.toFixed(2)}</p>
            </div>
            <div className="text-right">
                 <p className="text-xs text-slate-400 font-bold uppercase">{t.perTire}</p>
                 <p className="font-bold text-slate-600">${tire.pricePerUnit.toFixed(2)}</p>
            </div>
        </div>

        {/* Main Action */}
        <div className="flex gap-2">
            <button 
                onClick={() => onSelect(tire, quantity, withInstallation, displayTotal)}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded font-bold shadow-md hover:shadow-lg transform active:scale-95 transition-all text-sm uppercase tracking-wide"
            >
                {t.selectBook}
            </button>
            <button 
                onClick={() => onToggleCompare(tire)}
                className={`p-3 rounded border-2 font-bold transition-all ${isCompareSelected ? 'bg-red-50 border-red-500 text-red-700' : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'}`}
                title={t.compare}
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
            </button>
        </div>

        {/* Tech Specs Toggle */}
        {tire.fitmentSpecs && (
          <>
            <button 
                onClick={() => setShowFitmentDetails(!showFitmentDetails)}
                className="w-full text-center mt-3 text-xs font-bold text-slate-400 hover:text-red-600 flex items-center justify-center gap-1 uppercase tracking-wide transition-colors"
            >
                {showFitmentDetails ? t.hideSpecs : t.viewSpecs}
                <svg className={`w-3 h-3 transform transition-transform ${showFitmentDetails ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>

            {showFitmentDetails && (
                <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-y-2 gap-x-4 text-xs animate-fade-in-up">
                    <div>
                        <span className="text-slate-400 block font-semibold">Load/Speed</span>
                        <span className="font-bold text-slate-700">{tire.fitmentSpecs.loadIndex}{tire.fitmentSpecs.speedRating}</span>
                    </div>
                    <div>
                        <span className="text-slate-400 block font-semibold">UTQG</span>
                        <span className="font-bold text-slate-700">{tire.fitmentSpecs.utqg || 'N/A'}</span>
                    </div>
                    <div>
                        <span className="text-slate-400 block font-semibold">Warranty</span>
                        <span className="font-bold text-slate-700">{tire.fitmentSpecs.warranty}</span>
                    </div>
                     <div>
                        <span className="text-slate-400 block font-semibold">OEM Match</span>
                        <span className={`font-bold ${tire.fitmentSpecs.oemMatch ? 'text-green-600' : 'text-slate-700'}`}>
                            {tire.fitmentSpecs.oemMatch ? 'Yes' : 'No'}
                        </span>
                    </div>
                </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default TireCard;
