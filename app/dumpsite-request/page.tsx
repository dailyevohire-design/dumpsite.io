'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function DumpsiteRequestPage() {
  const [form, setForm] = useState({ name:'', phone:'', address:'', city:'', material:'', yards:'', notes:'' });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/dumpsite-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) setSubmitted(true);
      else setError('Something went wrong. Please try again.');
    } catch { setError('Something went wrong. Please try again.'); }
    finally { setLoading(false); }
  };

  if (submitted) return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4">
      <div className="text-center">
        <div className="text-6xl mb-6">✅</div>
        <h1 className="text-3xl font-bold text-white mb-4">Request Submitted!</h1>
        <p className="text-gray-400 mb-8">We'll review your request and reach out shortly.</p>
        <Link href="/" className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold py-3 px-8 rounded-lg transition">Back to Home</Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="mb-8">
          <Link href="/" className="text-yellow-500 hover:text-yellow-400 text-sm">← Back to Home</Link>
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">Request a Dumpsite</h1>
        <p className="text-gray-400 mb-10">Don't see a dumpsite listed? Submit a request and we'll find one for you.</p>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Full Name *</label>
              <input name="name" required value={form.name} onChange={handleChange} placeholder="John Smith"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Phone Number *</label>
              <input name="phone" required value={form.phone} onChange={handleChange} placeholder="(817) 555-0000" type="tel"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Street Address *</label>
            <input name="address" required value={form.address} onChange={handleChange} placeholder="1234 Main St"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">City *</label>
            <input name="city" required value={form.city} onChange={handleChange} placeholder="Fort Worth, TX"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Material Type *</label>
              <select name="material" required value={form.material} onChange={handleChange}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-yellow-500">
                <option value="">Select material...</option>
                <option value="dirt">Fill Dirt</option>
                <option value="topsoil">Topsoil</option>
                <option value="clay">Clay</option>
                <option value="gravel">Gravel</option>
                <option value="mixed">Mixed</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Amount Needed (yards) *</label>
              <input name="yards" required value={form.yards} onChange={handleChange} placeholder="e.g. 50" type="number" min="1"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Additional Notes</label>
            <textarea name="notes" value={form.notes} onChange={handleChange} rows={4}
              placeholder="Any specific requirements, access instructions, or other details..."
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 resize-none" />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-black font-bold py-4 rounded-lg text-lg transition">
            {loading ? 'Submitting...' : 'Submit Dumpsite Request'}
          </button>
        </form>
      </div>
    </div>
  );
}
