import React from 'react';
import { ProcessingLog, ProcessingStage } from '../types';

interface ProcessingOverlayProps {
  logs: ProcessingLog[];
}

const ProcessingOverlay: React.FC<ProcessingOverlayProps> = ({ logs }) => {
  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-90 z-50 flex flex-col items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-lg shadow-2xl p-8 max-w-md w-full relative overflow-hidden border-t-4 border-red-600">
        
        <h3 className="text-2xl font-black text-slate-900 mb-6 text-center uppercase tracking-tight">Finding Your Perfect Fit</h3>
        
        <div className="space-y-6">
          {logs.map((log, index) => (
            <div key={index} className="flex items-center space-x-4">
              <div className="relative flex-shrink-0">
                {/* Status Indicator */}
                <div className={`w-8 h-8 rounded flex items-center justify-center border-2 transition-all duration-500
                  ${log.status === 'completed' ? 'bg-green-50 border-green-500 text-green-600' : 
                    log.status === 'active' ? 'bg-red-50 border-red-600 text-red-600' : 
                    'bg-slate-50 border-slate-200 text-slate-300'}`}>
                  
                  {log.status === 'completed' && (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                  )}
                  {log.status === 'active' && (
                     <svg className="w-5 h-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                       <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                       <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                     </svg>
                  )}
                  {log.status === 'pending' && (
                    <div className="w-2 h-2 rounded-full bg-slate-300" />
                  )}
                </div>
                {/* Connector Line */}
                {index < logs.length - 1 && (
                  <div className={`absolute top-8 left-1/2 -ml-[1px] w-0.5 h-6 
                    ${logs[index+1].status !== 'pending' ? 'bg-red-200' : 'bg-slate-100'}`} 
                  />
                )}
              </div>
              
              <div className="flex-1">
                <p className={`text-sm font-bold transition-colors duration-300
                  ${log.status === 'active' ? 'text-red-700' : 
                    log.status === 'completed' ? 'text-slate-900' : 'text-slate-400'}`}>
                  {log.message}
                </p>
                {log.status === 'active' && (
                   <p className="text-xs text-red-500 mt-1 font-medium animate-pulse">Processing data...</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ProcessingOverlay;