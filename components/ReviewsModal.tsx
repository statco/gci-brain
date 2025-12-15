import React from 'react';
import { TireProduct } from '../types';

interface ReviewsModalProps {
  tire: TireProduct;
  onClose: () => void;
}

const ReviewsModal: React.FC<ReviewsModalProps> = ({ tire, onClose }) => {
  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-75 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div>
            <h3 className="text-xl font-bold text-slate-800">{tire.brand} {tire.model} Reviews</h3>
            <div className="flex items-center gap-2 mt-1">
               <span className="text-yellow-400 text-lg">{'★'.repeat(Math.round(tire.averageRating))}</span>
               <span className="text-slate-500 text-sm">{tire.averageRating}/5 ({tire.reviewCount} reviews)</span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto">
          {tire.reviews && tire.reviews.length > 0 ? (
            <div className="space-y-6">
              {tire.reviews.map((review) => (
                <div key={review.id} className="border-b border-slate-100 last:border-0 pb-6 last:pb-0">
                  <div className="flex justify-between items-start mb-2">
                    <div className="font-bold text-slate-800">{review.user}</div>
                    <div className="text-xs text-slate-400">{review.date}</div>
                  </div>
                  <div className="flex text-yellow-400 text-sm mb-2">
                    {'★'.repeat(Math.floor(review.rating))}
                    {'☆'.repeat(5 - Math.floor(review.rating))}
                  </div>
                  <p className="text-slate-600 leading-relaxed">"{review.comment}"</p>
                </div>
              ))}
              <button className="w-full py-3 mt-4 text-blue-600 font-medium hover:bg-blue-50 rounded-lg transition-colors">
                Load More Reviews
              </button>
            </div>
          ) : (
            <div className="text-center py-10 text-slate-500">
              No reviews available yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReviewsModal;