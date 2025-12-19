// src/components/InstallerApplicationForm.tsx
import React, { useState } from 'react';
import { submitInstallerApplication } from '../services/airtableService';

const PROVINCES = ['QC', 'ON', 'AB', 'BC', 'MB', 'SK', 'NS', 'NB', 'PE', 'NL', 'YT', 'NT', 'NU'];
const PAYMENT_METHODS = ['E-transfer', 'Bank Transfer', 'Cheque'];

export default function InstallerApplicationForm() {
  const [formData, setFormData] = useState({
    businessName: '',
    contactName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    province: 'QC',
    postalCode: '',
    serviceRadius: 50,
    licenseNumber: '',
    insuranceExpiry: '',
    calendarLink: '',
    paymentMethod: 'E-transfer',
    bankInfo: '',
    hourlyRate: '',
    notes: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus('idle');

    try {
      const result = await submitInstallerApplication({
        ...formData,
        serviceRadius: Number(formData.serviceRadius),
        hourlyRate: formData.hourlyRate ? Number(formData.hourlyRate) : undefined,
      });

      if (result.success) {
        setSubmitStatus('success');
        // Reset form
        setFormData({
          businessName: '',
          contactName: '',
          email: '',
          phone: '',
          address: '',
          city: '',
          province: 'QC',
          postalCode: '',
          serviceRadius: 50,
          licenseNumber: '',
          insuranceExpiry: '',
          calendarLink: '',
          paymentMethod: 'E-transfer',
          bankInfo: '',
          hourlyRate: '',
          notes: '',
        });
      } else {
        setSubmitStatus('error');
        setErrorMessage(result.error || 'Une erreur est survenue');
      }
    } catch (error) {
      setSubmitStatus('error');
      setErrorMessage('Erreur de connexion. Veuillez réessayer.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Success view
  if (submitStatus === 'success') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-2xl w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-black text-slate-900 mb-2">Application Soumise!</h2>
          <p className="text-slate-600 mb-6">
            Merci pour votre demande. Notre équipe examinera votre candidature et vous contactera dans les 48 heures.
          </p>
          <button
            onClick={() => setSubmitStatus('idle')}
            className="bg-red-600 text-white px-6 py-3 rounded font-bold hover:bg-red-700 transition"
          >
            Soumettre Une Autre Application
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-12 h-12 bg-red-600 rounded flex items-center justify-center text-white font-black text-2xl">G</div>
            <div>
              <div className="font-black text-2xl text-slate-900">GCI TIRE</div>
              <div className="text-xs font-bold text-red-600 tracking-widest">RÉSEAU D'INSTALLATEURS</div>
            </div>
          </div>
          <h1 className="text-3xl font-black text-slate-900 mb-2">Joignez Notre Réseau</h1>
          <p className="text-slate-600">
            Devenez un installateur certifié GCI Tire et accédez à un flux constant de clients
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-lg p-8">
          {submitStatus === 'error' && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded p-4 text-red-800">
              <strong>Erreur:</strong> {errorMessage}
            </div>
          )}

          {/* Business Information */}
          <div className="mb-8">
            <h3 className="text-lg font-bold text-slate-900 mb-4 pb-2 border-b">Informations de l'Entreprise</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  Nom de l'Entreprise *
                </label>
                <input
                  type="text"
                  name="businessName"
                  value={formData.businessName}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="Garage ABC Inc."
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  Nom du Contact *
                </label>
                <input
                  type="text"
                  name="contactName"
                  value={formData.contactName}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="Jean Tremblay"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  Email *
                </label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="contact@garage.com"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  Téléphone *
                </label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="819-XXX-XXXX"
                />
              </div>
            </div>
          </div>

          {/* Location */}
          <div className="mb-8">
            <h3 className="text-lg font-bold text-slate-900 mb-4 pb-2 border-b">Localisation</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  Adresse Complète *
                </label>
                <input
                  type="text"
                  name="address"
                  value={formData.address}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="123 Rue Principale"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">
                    Ville *
                  </label>
                  <input
                    type="text"
                    name="city"
                    value={formData.city}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    placeholder="Rouyn-Noranda"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">
                    Province *
                  </label>
                  <select
                    name="province"
                    value={formData.province}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  >
                    {PROVINCES.map(prov => (
                      <option key={prov} value={prov}>{prov}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">
                    Code Postal *
                  </label>
                  <input
                    type="text"
                    name="postalCode"
                    value={formData.postalCode}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    placeholder="J9X 5E4"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  Rayon de Service (km) *
                </label>
                <input
                  type="number"
                  name="serviceRadius"
                  value={formData.serviceRadius}
                  onChange={handleChange}
                  required
                  min="1"
                  className="w-full px-4 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
                <p className="text-xs text-slate-500 mt-1">Distance maximale pour les installations</p>
              </div>
            </div>
          </div>

          {/* Credentials */}
          <div className="mb-8">
            <h3 className="text-lg font-bold text-slate-900 mb-4 pb-2 border-b">Accréditations</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  Numéro de Licence
                </label>
                <input
                  type="text"
                  name="licenseNumber"
                  value={formData.licenseNumber}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="NEQ ou # de licence"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  Expiration de l'Assurance
                </label>
                <input
                  type="date"
                  name="insuranceExpiry"
                  value={formData.insuranceExpiry}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Payment & Calendar */}
          <div className="mb-8">
            <h3 className="text-lg font-bold text-slate-900 mb-4 pb-2 border-b">Paiement & Calendrier</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  Lien Calendrier (Google Calendar, Calendly, etc.)
                </label>
                <input
                  type="url"
                  name="calendarLink"
                  value={formData.calendarLink}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="https://calendly.com/votre-lien"
                />
                <p className="text-xs text-slate-500 mt-1">Les clients pourront réserver directement</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">
                    Méthode de Paiement *
                  </label>
                  <select
                    name="paymentMethod"
                    value={formData.paymentMethod}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  >
                    {PAYMENT_METHODS.map(method => (
                      <option key={method} value={method}>{method}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">
                    Taux Horaire Souhaité (CAD)
                  </label>
                  <input
                    type="number"
                    name="hourlyRate"
                    value={formData.hourlyRate}
                    onChange={handleChange}
                    min="0"
                    step="0.01"
                    className="w-full px-4 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    placeholder="25.00"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  Informations Bancaires
                </label>
                <textarea
                  name="bankInfo"
                  value={formData.bankInfo}
                  onChange={handleChange}
                  rows={3}
                  className="w-full px-4 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="Institution, Transit, Compte (confidentiel)"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="mb-8">
            <label className="block text-sm font-bold text-slate-700 mb-2">
              Notes Additionnelles
            </label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows={4}
              className="w-full px-4 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-red-500 focus:border-transparent"
              placeholder="Certifications, équipements spéciaux, expérience..."
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-red-600 text-white py-4 rounded font-bold text-lg hover:bg-red-700 transition disabled:bg-slate-400 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Envoi en cours...' : 'Soumettre ma Candidature'}
          </button>

          <p className="text-xs text-slate-500 text-center mt-4">
            En soumettant ce formulaire, vous acceptez de recevoir des communications de GCI Tire concernant les opportunités d'installation.
          </p>
        </form>
      </div>
    </div>
  );
}
