import { useState, useEffect } from 'react';

interface InstallerData {
  id: string;
  name: string;
  email: string;
  phone: string;
  city: string;
  pricePerTire: number;
  status: string;
}

interface Job {
  id: string;
  customer: string;
  tire: string;
  quantity: number;
  installationPrice: number;
  status: string;
  created: string;
}

const GCI_CUT = 0.20;

export default function InstallerPortal() {
  const [token, setToken] = useState<string | null>(null);
  const [installer, setInstaller] = useState<InstallerData | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newPrice, setNewPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Magic link request state
  const [email, setEmail] = useState('');
  const [linkSent, setLinkSent] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token');
    if (t) {
      setToken(t);
      loadPortal(t);
    } else {
      setLoading(false);
    }
  }, []);

  async function loadPortal(t: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/installer-portal?action=verify&token=${t}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Access denied');
      setInstaller(data.installer);
      setJobs(data.jobs || []);
      setNewPrice(String(data.installer.pricePerTire));
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }

  async function sendMagicLink() {
    if (!email) return;
    setSending(true);
    try {
      const res = await fetch('/api/installer-portal?action=generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send link');
      setLinkSent(true);
    } catch (e: any) {
      setError(e.message);
    }
    setSending(false);
  }

  async function savePrice() {
    if (!token || !newPrice) return;
    const price = Number(newPrice);
    if (price < 10 || price > 200) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/installer-portal?action=update&token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pricePerTire: price }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setInstaller(prev => prev ? { ...prev, pricePerTire: price } : prev);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  // ─── Loading ───────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // ─── No token — show magic link request form ───────────────────────────────
  if (!token) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <span className="text-4xl">🔧</span>
          <h1 className="text-2xl font-black text-slate-900 mt-3 mb-1">GCI Installer Portal</h1>
          <p className="text-slate-500 text-sm">Enter your email to receive a secure access link.</p>
        </div>
        {error && <p className="text-red-500 text-sm text-center mb-4">{error}</p>}
        {linkSent ? (
          <div className="text-center bg-green-50 border border-green-200 rounded-xl p-6">
            <span className="text-3xl">📧</span>
            <p className="font-bold text-green-800 mt-2">Link sent!</p>
            <p className="text-sm text-green-600 mt-1">Check your inbox. The link is valid for 7 days.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:border-red-500 focus:outline-none"
              onKeyDown={e => e.key === 'Enter' && sendMagicLink()}
            />
            <button
              onClick={sendMagicLink}
              disabled={sending || !email}
              className="w-full bg-red-600 text-white font-bold py-3 rounded-lg hover:bg-red-700 disabled:opacity-50 transition"
            >
              {sending ? 'Sending…' : 'Send Access Link →'}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  // ─── Token invalid ─────────────────────────────────────────────────────────
  if (error) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
        <span className="text-4xl">⚠️</span>
        <h2 className="text-xl font-bold text-slate-900 mt-3 mb-2">Access Denied</h2>
        <p className="text-slate-500 text-sm mb-6">{error}</p>
        <button
          onClick={() => { setToken(null); setError(null); window.history.replaceState({}, '', '/installer-portal'); }}
          className="bg-red-600 text-white font-bold px-6 py-3 rounded-lg hover:bg-red-700 transition"
        >
          Request New Link
        </button>
      </div>
    </div>
  );

  if (!installer) return null;

  const earnings = jobs
    .filter(j => j.status !== 'Cancelled')
    .reduce((sum, j) => sum + (j.installationPrice * (1 - GCI_CUT)), 0);

  // ─── Portal dashboard ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-slate-900 text-white px-6 py-5 flex items-center gap-4">
        <div>
          <h1 className="font-black text-lg leading-tight">{installer.name}</h1>
          <p className="text-slate-400 text-xs">{installer.city} · GCI Installer Portal</p>
        </div>
        <div className="ml-auto">
          <span className={`text-xs font-bold px-3 py-1 rounded-full ${installer.status === 'Active' ? 'bg-green-900 text-green-300' : 'bg-slate-700 text-slate-300'}`}>
            {installer.status}
          </span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total Jobs', value: jobs.length },
            { label: 'Your Earnings', value: `$${earnings.toFixed(0)}` },
            { label: 'Price/Tire', value: `$${installer.pricePerTire}` },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl p-4 text-center shadow-sm">
              <p className="text-2xl font-black text-slate-900">{s.value}</p>
              <p className="text-xs text-slate-500 mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Price editor */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="font-bold text-slate-900 mb-1">Installation Price</h2>
          <p className="text-xs text-slate-400 mb-4">
            Your price per tire. GCI retains 20% as a platform fee — you keep ${(installer.pricePerTire * 0.80).toFixed(2)} per tire at the current price.
          </p>
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
              <input
                type="number"
                min={10}
                max={200}
                step={1}
                value={newPrice}
                onChange={e => setNewPrice(e.target.value)}
                className="w-full pl-8 pr-4 py-3 border-2 border-slate-200 rounded-lg focus:border-red-500 focus:outline-none font-bold text-lg"
              />
            </div>
            <span className="text-slate-400 text-sm font-medium">per tire</span>
            <button
              onClick={savePrice}
              disabled={saving || Number(newPrice) === installer.pricePerTire}
              className="bg-red-600 text-white font-bold px-5 py-3 rounded-lg hover:bg-red-700 disabled:opacity-40 transition"
            >
              {saving ? '…' : saved ? '✓ Saved' : 'Save'}
            </button>
          </div>
          {Number(newPrice) !== installer.pricePerTire && Number(newPrice) >= 10 && (
            <p className="text-xs text-slate-500 mt-2">
              You will earn <strong>${(Number(newPrice) * 0.80).toFixed(2)}/tire</strong> after 20% GCI fee
            </p>
          )}
        </div>

        {/* Jobs list */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="font-bold text-slate-900 mb-4">Installation Jobs</h2>
          {jobs.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-6">No jobs yet. They'll appear here when customers book with you.</p>
          ) : (
            <div className="space-y-3">
              {jobs.map(job => (
                <div key={job.id} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                  <div>
                    <p className="font-semibold text-slate-900 text-sm">{job.customer}</p>
                    <p className="text-xs text-slate-500">{job.tire} × {job.quantity}</p>
                    <p className="text-xs text-slate-400">{new Date(job.created).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-slate-900 text-sm">
                      ${(job.installationPrice * 0.80).toFixed(2)}
                    </p>
                    <p className="text-xs text-slate-400">your cut</p>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full mt-1 inline-block ${
                      job.status === 'Completed' ? 'bg-green-100 text-green-700' :
                      job.status === 'Cancelled' ? 'bg-red-100 text-red-600' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {job.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Contact */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="font-bold text-slate-900 mb-3">Contact GCI Tires</h2>
          <div className="space-y-2 text-sm text-slate-600">
            <p>📧 <a href="mailto:info@gcitires.ca" className="text-red-600 font-semibold">info@gcitires.ca</a></p>
            <p>📞 <a href="tel:+14384026616" className="text-red-600 font-semibold">(438) 402-6616</a></p>
          </div>
        </div>

      </div>
    </div>
  );
}
