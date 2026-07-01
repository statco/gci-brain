import { useEffect, useState } from 'react';

const ORDER_HUB = 'https://gci-order-hub.vercel.app';

const CARRIERS = [
  { value: 'PUROLATOR', label: 'Purolator' },
  { value: 'OTHER', label: 'GLS' },
  { value: 'UPS', label: 'UPS' },
  { value: 'FEDEX', label: 'FedEx' },
  { value: 'CANADA_POST', label: 'Canada Post' },
  { value: 'DHL', label: 'DHL' },
];

interface OrderRow {
  order_id: string;
  created_at: string;
  customer_name: string;
  customer_address: string;
  po_number: string;
  walmart_ack: string;
  skus: { sku: string; qty: string; price: string }[];
}

export default function WalmartManualShip() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<OrderRow | null>(null);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [carrier, setCarrier] = useState('PUROLATOR');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    fetchOrders();
  }, []);

  async function fetchOrders() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${ORDER_HUB}/api/getPendingOrders`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to fetch orders');
      setOrders(data.orders);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (!selected || !trackingNumber.trim()) return;
    setSubmitting(true);
    setResult(null);
    try {
      const url = `${ORDER_HUB}/api/walmart-ship?orderId=${encodeURIComponent(selected.order_id)}&trackingNumber=${encodeURIComponent(trackingNumber.trim())}&carrier=${encodeURIComponent(carrier)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Ship failed');
      setResult({ success: true, message: `✅ Order ${selected.order_id} marked shipped — tracking ${trackingNumber}` });
      setSelected(null);
      setTrackingNumber('');
      setCarrier('PUROLATOR');
      fetchOrders(); // refresh list
    } catch (e: any) {
      setResult({ success: false, message: `❌ ${e.message}` });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Nav */}
      <nav className="py-4 px-6 shadow-sm sticky top-0 z-30" style={{ backgroundColor: '#0E0E0E' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href="/brain" className="text-slate-400 hover:text-white text-sm">← Brain</a>
            <span className="text-white font-bold text-lg">Walmart Manual Ship</span>
          </div>
          <button
            onClick={fetchOrders}
            className="text-sm text-slate-400 hover:text-white"
          >
            ↻ Refresh
          </button>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-8">

        {/* Result banner */}
        {result && (
          <div className={`mb-6 p-4 rounded-lg text-sm font-medium ${result.success ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            {result.message}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Left — Pending orders list */}
          <div>
            <h2 className="text-slate-700 font-semibold text-sm uppercase tracking-widest mb-3">
              Pending CT Orders {orders.length > 0 && <span className="ml-2 bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs">{orders.length}</span>}
            </h2>

            {loading && (
              <div className="text-slate-500 text-sm py-8 text-center">Loading orders...</div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-4 rounded-lg">{error}</div>
            )}

            {!loading && !error && orders.length === 0 && (
              <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400 text-sm">
                No pending CT orders
              </div>
            )}

            <div className="flex flex-col gap-3">
              {orders.map((order) => (
                <button
                  key={order.order_id}
                  onClick={() => { setSelected(order); setResult(null); }}
                  className={`text-left p-4 rounded-lg border transition-all ${
                    selected?.order_id === order.order_id
                      ? 'border-red-400 bg-red-50 shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-slate-800 text-sm">{order.order_id}</span>
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">PENDING CT</span>
                  </div>
                  <div className="text-xs text-slate-500 mb-2">
                    PO# <span className="font-semibold text-slate-700">{order.po_number || '—'}</span>
                    <span className="mx-2">·</span>
                    {new Date(order.created_at).toLocaleDateString('en-CA')}
                  </div>
                  <div className="text-xs text-slate-600 mb-1">👤 {order.customer_name}</div>
                  {order.skus.map((s, i) => (
                    <div key={i} className="text-xs text-slate-500">
                      <span className="font-mono bg-slate-100 px-1 rounded">{s.sku}</span>
                      {' '}× {s.qty} — <span className="font-medium">${s.price} CAD</span>
                    </div>
                  ))}
                </button>
              ))}
            </div>
          </div>

          {/* Right — Ship form */}
          <div>
            <h2 className="text-slate-700 font-semibold text-sm uppercase tracking-widest mb-3">
              Mark as Shipped
            </h2>

            <div className="bg-white rounded-lg border border-slate-200 p-6">
              {!selected ? (
                <div className="text-slate-400 text-sm text-center py-8">
                  ← Select an order to ship
                </div>
              ) : (
                <div className="flex flex-col gap-5">

                  {/* Selected order summary */}
                  <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                    <div className="text-xs text-slate-500 mb-1">Selected Order</div>
                    <div className="font-semibold text-slate-800">{selected.order_id}</div>
                    <div className="text-xs text-slate-500 mt-1">PO# {selected.po_number || '—'} · {selected.customer_name}</div>
                    {selected.skus.map((s, i) => (
                      <div key={i} className="text-xs font-mono text-slate-600 mt-1">{s.sku} × {s.qty}</div>
                    ))}
                  </div>

                  {/* Carrier */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Carrier</label>
                    <select
                      value={carrier}
                      onChange={(e) => setCarrier(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-red-400"
                    >
                      {CARRIERS.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Tracking number */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Tracking Number</label>
                    <input
                      type="text"
                      value={trackingNumber}
                      onChange={(e) => setTrackingNumber(e.target.value)}
                      placeholder="e.g. 77462805001"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-400"
                    />
                  </div>

                  {/* Buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setSelected(null); setTrackingNumber(''); setResult(null); }}
                      className="flex-1 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={!trackingNumber.trim() || submitting}
                      className="flex-1 py-2 rounded-lg text-white text-sm font-bold transition-colors"
                      style={{ backgroundColor: trackingNumber.trim() && !submitting ? '#B8192E' : '#cbd5e1', cursor: trackingNumber.trim() && !submitting ? 'pointer' : 'not-allowed' }}
                    >
                      {submitting ? 'Shipping...' : 'Mark Shipped'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
