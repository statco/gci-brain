import React from 'react';
import { TireProduct } from '../types';

interface FavoritesModalProps {
  favorites: TireProduct[];
  onClose: () => void;
  onSelect: (tire: TireProduct) => void;
  onRemove: (id: string) => void;
}

const FavoritesModal: React.FC<FavoritesModalProps> = ({ favorites, onClose, onSelect, onRemove }) => {
  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-75 z-50 flex justify-end backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white w-full max-w-md h-full shadow-2xl p-6 overflow-y-auto animate-slide-in-right" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-8 pb-4 border-b border-slate-100">
          <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Saved Tires ({favorites.length})</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {favorites.length === 0 ? (
          <div className="text-center text-slate-500 mt-20">
            <svg className="w-16 h-16 mx-auto text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
            <p className="font-medium">You haven't saved any tires yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {favorites.map(tire => (
              <div key={tire.id} className="border border-slate-200 rounded p-4 flex gap-4 relative bg-white shadow-sm hover:shadow-md transition-shadow">
                <button 
                  onClick={() => onRemove(tire.id)}
                  className="absolute top-2 right-2 text-slate-300 hover:text-red-600 p-1 transition-colors"
                  title="Remove from favorites"
                >
                   <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
                <img src={tire.imageUrl} alt={tire.model} className="w-20 h-20 object-contain rounded bg-white border border-slate-100" />
                <div className="flex-1">
                  <h4 className="font-black text-slate-900 uppercase">{tire.brand}</h4>
                  <p className="text-sm text-slate-600 mb-2 font-medium">{tire.model}</p>
                  <p className="font-bold text-red-600 mb-3">${tire.pricePerUnit}</p>
                  <button 
                    onClick={() => { onSelect(tire); onClose(); }}
                    className="text-xs bg-slate-900 text-white py-2 px-4 rounded font-bold hover:bg-red-600 w-full transition-colors uppercase tracking-wide"
                  >
                    View & Buy
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FavoritesModal;