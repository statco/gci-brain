import React from 'react';
import { TireProduct } from '../types';

interface ComparisonModalProps {
  tires: TireProduct[];
  onClose: () => void;
  onSelect: (tire: TireProduct) => void;
}

const ComparisonModal: React.FC<ComparisonModalProps> = ({ tires, onClose, onSelect }) => {
  const features = [
    { label: 'Price', render: (t: TireProduct) => `$${t.pricePerUnit}` },
    { label: 'Rating', render: (t: TireProduct) => `${t.averageRating} ★ (${t.reviewCount})` },
    { label: 'Type', render: (t: TireProduct) => t.type },
    { label: 'Warranty', render: (t: TireProduct) => t.fitmentSpecs.warranty },
    { label: 'Load/Speed', render: (t: TireProduct) => `${t.fitmentSpecs.loadIndex}${t.fitmentSpecs.speedRating}` },
    { label: 'UTQG', render: (t: TireProduct) => t.fitmentSpecs.utqg || 'N/A' },
  ];

  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-75 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Compare Tires</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-red-600 transition-colors">
             <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="overflow-x-auto p-6">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr>
                <th className="p-4 border-b-2 border-slate-200 bg-white min-w-[150px] font-bold text-slate-500 uppercase text-sm">Feature</th>
                {tires.map(tire => (
                  <th key={tire.id} className="p-4 border-b-2 border-slate-200 min-w-[200px]">
                    <div className="flex flex-col items-center text-center">
                      <div className="w-24 h-24 p-2 bg-white border border-slate-100 rounded mb-2 flex items-center justify-center">
                          <img src={tire.imageUrl} alt={tire.model} className="max-w-full max-h-full object-contain" />
                      </div>
                      <span className="font-black text-slate-900 uppercase text-lg">{tire.brand}</span>
                      <span className="text-sm text-red-600 font-bold">{tire.model}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {features.map((feature, idx) => (
                <tr key={idx} className="hover:bg-slate-50 transition-colors">
                  <td className="p-4 border-b border-slate-100 font-bold text-slate-400 text-sm uppercase">{feature.label}</td>
                  {tires.map(tire => (
                    <td key={tire.id} className="p-4 border-b border-slate-100 text-center text-slate-800 font-bold">
                      {feature.render(tire)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className="p-4"></td>
                {tires.map(tire => (
                  <td key={tire.id} className="p-4 text-center">
                    <button 
                      onClick={() => { onSelect(tire); onClose(); }}
                      className="bg-red-600 text-white text-sm py-2 px-6 rounded font-bold hover:bg-red-700 shadow-sm uppercase tracking-wide transition-colors"
                    >
                      Select
                    </button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ComparisonModal;