import React, { useState } from 'react';
import { Language } from '../types';
import { translations } from '../utils/translations';

interface InputFormProps {
  onSubmit: (request: string) => void;
  isLoading: boolean;
  lang: Language;
  setLang: (lang: Language) => void;
}

const InputForm: React.FC<InputFormProps> = ({ onSubmit, isLoading, lang, setLang }) => {
  const [request, setRequest] = useState('');
  const [year, setYear] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [trim, setTrim] = useState('');
  const [tireSize, setTireSize] = useState('');
  const [tireSizeError, setTireSizeError] = useState(false);

  const t = translations[lang];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Construct the combined request using distinct labels for the AI parser
    const parts = [];
    
    if (year || make || model) {
        parts.push(`Vehicle: ${year} ${make} ${model} ${trim}`.trim());
    }
    
    if (tireSize) {
        parts.push(`Size: ${tireSize}`.trim());
    }

    if (request) {
        parts.push(`Request: ${request}`.trim());
    }
    
    const combinedRequest = parts.join(' | ');

    if (combinedRequest) {
      onSubmit(combinedRequest);
    }
  };

  const handleTireSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTireSize(e.target.value);
    // Clear error immediately when user starts correcting it
    if (tireSizeError) setTireSizeError(false);
  };

  const handleTireSizeBlur = () => {
    if (!tireSize) return;
    // Regex matches formats like: 225/45R17, P225/45R17, LT245/75R16, 225/45ZR17
    // Allows case-insensitive matching
    const regex = /^(?:[A-Z]{1,3})?\d{3}\/\d{2}[A-Z]{1,2}\d{2}$/i;
    setTireSizeError(!regex.test(tireSize));
  };

  const handleExampleClick = (text: string) => {
    setRequest(text);
  };

  const examples = [
    "Michelin Pilot Sport 4S",
    "265/70R17 All-Terrain Tires",
    "Quiet highway tires for SUV"
  ];

  // Form is valid if we have minimal vehicle info OR a request string (product name or description)
  // AND there are no validation errors
  const isFormValid = ((year && make && model) || request.trim().length > 2) && !tireSizeError;

  return (
    <div className="w-full max-w-4xl mx-auto relative">
      {/* Language Toggle */}
      <div className="absolute top-0 right-0 -mt-10 mb-2 flex gap-2">
        <button 
          onClick={() => setLang('en')} 
          className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${lang === 'en' ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'}`}
        >
          EN
        </button>
        <button 
          onClick={() => setLang('fr')} 
          className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${lang === 'fr' ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'}`}
        >
          FR
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-xl p-8 border-t-4 border-red-600">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter mb-3 uppercase">
             {t.title}
          </h1>
          <p className="text-slate-500 text-lg font-medium max-w-2xl mx-auto">
             {t.subtitle}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          
          {/* Vehicle & Size Fields Section */}
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">{t.vehicleSection}</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t.year}</label>
                    <input 
                    type="text" 
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    placeholder="2023"
                    className="w-full p-2 text-sm border border-slate-200 rounded focus:border-red-600 focus:ring-0 outline-none transition-all font-bold text-slate-700 bg-white"
                    disabled={isLoading}
                    />
                </div>
                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t.make}</label>
                    <input 
                    type="text" 
                    value={make}
                    onChange={(e) => setMake(e.target.value)}
                    placeholder="Ford"
                    className="w-full p-2 text-sm border border-slate-200 rounded focus:border-red-600 focus:ring-0 outline-none transition-all font-bold text-slate-700 bg-white"
                    disabled={isLoading}
                    />
                </div>
                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t.model}</label>
                    <input 
                    type="text" 
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="F-150"
                    className="w-full p-2 text-sm border border-slate-200 rounded focus:border-red-600 focus:ring-0 outline-none transition-all font-bold text-slate-700 bg-white"
                    disabled={isLoading}
                    />
                </div>
                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t.trim}</label>
                    <input 
                    type="text" 
                    value={trim}
                    onChange={(e) => setTrim(e.target.value)}
                    placeholder="Lariat"
                    className="w-full p-2 text-sm border border-slate-200 rounded focus:border-red-600 focus:ring-0 outline-none transition-all font-bold text-slate-700 bg-white"
                    disabled={isLoading}
                    />
                </div>
                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t.tireSize}</label>
                    <input 
                    type="text" 
                    value={tireSize}
                    onChange={handleTireSizeChange}
                    onBlur={handleTireSizeBlur}
                    placeholder={t.tireSizePlaceholder}
                    className={`w-full p-2 text-sm border rounded focus:ring-0 outline-none transition-all font-bold text-slate-700 bg-white
                        ${tireSizeError ? 'border-red-500 focus:border-red-600' : 'border-slate-200 focus:border-red-600'}`}
                    disabled={isLoading}
                    />
                    {tireSizeError && <span className="text-[10px] text-red-500 font-bold mt-1 block animate-pulse">{t.invalidTireSize}</span>}
                </div>
            </div>
          </div>

          {/* Natural Language Section */}
          <div className="relative group">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">{t.needsSection}</h3>
            <textarea
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder={t.placeholder}
              className="w-full p-5 pr-12 text-lg border-2 border-slate-200 rounded-md focus:border-red-600 focus:ring-0 outline-none transition-all resize-none h-32 text-slate-800 placeholder:text-slate-300 bg-white font-medium shadow-sm"
              disabled={isLoading}
            />
            <div className="absolute bottom-4 right-4 text-slate-300 group-focus-within:text-red-500 transition-colors pointer-events-none">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
              </svg>
            </div>
          </div>

          <button
            type="submit"
            disabled={!isFormValid || isLoading}
            className={`w-full py-4 px-6 rounded-md font-bold text-lg text-white shadow-md transition-all transform active:scale-[0.99] uppercase tracking-wide
              ${!isFormValid || isLoading 
                ? 'bg-slate-300 cursor-not-allowed' 
                : 'bg-red-600 hover:bg-red-700 hover:shadow-lg'}`}
          >
            {isLoading ? t.scanning : t.searchBtn}
          </button>
        </form>

        <div className="mt-8">
          <p className="text-xs text-slate-400 font-bold mb-3 text-center uppercase tracking-widest">{t.examples}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {examples.map((ex, i) => (
              <button
                key={i}
                onClick={() => handleExampleClick(ex)}
                className="text-xs sm:text-sm bg-slate-100 hover:bg-slate-200 hover:text-red-700 text-slate-600 py-2 px-4 rounded transition-colors border border-transparent hover:border-slate-300 font-medium"
              >
                "{ex}"
              </button>
            ))}
          </div>
        </div>
      </div>
      
      <div className="mt-10 grid grid-cols-3 gap-6 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
        <div className="flex flex-col items-center gap-3">
            <div className="p-3 bg-white rounded-full shadow-sm border border-slate-100 text-red-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
            <span>{t.expertSearch}</span>
        </div>
        <div className="flex flex-col items-center gap-3">
            <div className="p-3 bg-white rounded-full shadow-sm border border-slate-100 text-slate-700">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <span>{t.verifiedFitment}</span>
        </div>
        <div className="flex flex-col items-center gap-3">
            <div className="p-3 bg-white rounded-full shadow-sm border border-slate-100 text-slate-700">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>
            </div>
            <span>{t.inventoryMatch}</span>
        </div>
      </div>
    </div>
  );
};

export default InputForm;