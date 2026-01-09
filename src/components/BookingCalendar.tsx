import React, { useState } from 'react';

interface BookingCalendarProps {
  onBook: (date: Date, time: string) => void;
}

const BookingCalendar: React.FC<BookingCalendarProps> = ({ onBook }) => {
  const [selectedDate, setSelectedDate] = useState<number>(0);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Generate next 5 days available for booking
  const dates = Array.from({ length: 5 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i + 1); // Start tomorrow
    return d;
  });

  const timeSlots = [
    "09:00 AM", "10:00 AM", "11:00 AM", 
    "01:00 PM", "02:30 PM", "04:00 PM"
  ];

  const handleConfirm = () => {
    if (selectedTime) {
      setIsSubmitting(true);
      // Simulate API call
      setTimeout(() => {
        onBook(dates[selectedDate], selectedTime);
        setIsSubmitting(false);
      }, 1000);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6 text-left shadow-sm mt-6">
      <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2 uppercase tracking-wide">
        <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
        Schedule Installation
      </h3>
      
      {/* Date Selection */}
      <div className="mb-6">
        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Select Date</label>
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {dates.map((date, idx) => {
            const isSelected = selectedDate === idx;
            return (
              <button
                key={idx}
                onClick={() => setSelectedDate(idx)}
                className={`flex-shrink-0 w-16 h-20 rounded flex flex-col items-center justify-center border-2 transition-all duration-200
                  ${isSelected 
                    ? 'bg-red-600 border-red-600 text-white shadow-md transform scale-105' 
                    : 'bg-white border-slate-200 text-slate-600 hover:border-red-300 hover:text-red-600'}`}
              >
                <span className="text-xs font-bold opacity-80 uppercase">{date.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                <span className="text-xl font-black">{date.getDate()}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Time Selection */}
      <div className="mb-6">
        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Select Time</label>
        <div className="grid grid-cols-3 gap-3">
          {timeSlots.map((time) => (
            <button
              key={time}
              onClick={() => setSelectedTime(time)}
              className={`py-2 px-3 rounded text-sm font-bold border-2 transition-all
                ${selectedTime === time 
                  ? 'bg-red-50 border-red-600 text-red-700' 
                  : 'bg-white border-slate-200 text-slate-600 hover:border-red-200 hover:text-red-600'}`}
            >
              {time}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={handleConfirm}
        disabled={!selectedTime || isSubmitting}
        className={`w-full py-3 rounded font-bold text-white shadow-md transition-all flex items-center justify-center gap-2 uppercase tracking-wide
          ${!selectedTime || isSubmitting
            ? 'bg-slate-300 cursor-not-allowed'
            : 'bg-slate-900 hover:bg-black transform active:scale-95'}`}
      >
        {isSubmitting ? (
             <svg className="w-5 h-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
             </svg>
        ) : (
            <>
                <span>Confirm Appointment</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </>
        )}
      </button>
    </div>
  );
};

export default BookingCalendar;