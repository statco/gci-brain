import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const C = {
  bg:      '#0b1120',
  surface: '#111827',
  border:  '#1f2937',
  text:    '#f9fafb',
  muted:   '#6b7280',
  green:   '#10b981',
  yellow:  '#f59e0b',
};

function ToolCard({ icon, title, description, route, url, badge }) {
  const inner = (
    <div
      style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
        padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start',
        cursor: 'pointer', transition: 'border-color 0.15s, transform 0.1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#374151'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border;  e.currentTarget.style.transform = 'none'; }}
    >
      <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{title}</span>
          {badge && (
            <span style={{
              background: badge === 'daily' ? '#064e3b' : '#1e3a5f',
              color: badge === 'daily' ? '#6ee7b7' : '#93c5fd',
              fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99,
              textTransform: 'uppercase', letterSpacing: '0.08em',
            }}>{badge}</span>
          )}
        </div>
        <span style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{description}</span>
      </div>
      <span style={{ color: C.muted, fontSize: 14, flexShrink: 0, marginTop: 2 }}>→</span>
    </div>
  );
  if (route) return <Link to={route} style={{ textDecoration: 'none' }}>{inner}</Link>;
  return <a href={url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>{inner}</a>;
}

function Section({ title, subtitle, cols = 1, children }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>{title}</h2>
        {subtitle && <p style={{ fontSize: 11, color: '#4b5563', marginTop: 2 }}>{subtitle}</p>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 10 }}>{children}</div>
    </div>
  );
}

function SyncStatus() {
  const [s, setS] = useState(null);
  useEffect(() => {
    fetch('/api/shopifySync?action=status').then(r => r.json()).then(setS).catch(() => {});
  }, []);
  if (!s) return null;
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: '10px 16px', display: 'flex', flexWrap: 'wrap', gap: 20,
      alignItems: 'center', marginBottom: 28, fontSize: 12,
    }}>
      <span style={{ color: C.muted, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>CT Sync</span>
      <span><strong style={{ color: C.text }}>{s.shopifyProductCount?.toLocaleString()}</strong><span style={{ color: C.muted }}> products</span></span>
      <span style={{ color: C.muted }}>Next cron: <strong style={{ color: C.text }}>{s.nextCron ?? '3:00 AM ET'}</strong></span>
      <span style={{ color: C.muted }}>Env: <strong style={{ color: s.ctEnvironment === 'PRODUCTION' ? C.green : C.yellow }}>{s.ctEnvironment ?? '—'}</strong></span>
    </div>
  );
}

export default function Dashboard() {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: "'Inter', system-ui, sans-serif", padding: '36px 24px' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <span style={{ fontSize: 26 }}>🧠</span>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>GCI Brain</h1>
            <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>Operations dashboard — gcitires.com</p>
          </div>
        </div>

        <SyncStatus />

        <Section title="🔄 Ongoing Operations" subtitle="Run after catalog changes, syncs, or GMC updates">
          <ToolCard icon="⚙️" title="Shopify Sync" description="CT→Shopify sync, dedup, fill load indexes, orphan management, inventory audit" route="/sync" badge="daily" />
          <ToolCard icon="🔍" title="Update SEO" description="Bulk-write English SEO titles and meta descriptions to all products — GMC compliant" route="/update-seo" badge="live" />
          <ToolCard icon="🔀" title="Fix Redirects" description="Create 301 redirects for duplicate handles — /products/ and /en-ca/products/ paths" route="/fix-redirects" />
        </Section>

        <Section title="📦 Catalog" subtitle="Seasonal and periodic maintenance">
          <ToolCard icon="🗂" title="Collection SEO" description="Update SEO titles and descriptions for all 21 Shopify collections" route="/collection-seo" />
          <ToolCard icon="🛞" title="Shopify Fix" description="Fix size formats, assign variant images, translate SEO — chunked with auto-continue" route="/fix" />
          <ToolCard icon="🏷️" title="Fix Titles" description="Bulk-fix product titles to match GCI naming convention" route="/fix-titles" />
          <ToolCard icon="📝" title="Fix Descriptions" description="Translate and rewrite product body_html descriptions" route="/fix-descriptions" />
          <ToolCard icon="🖼️" title="Fix Alt Tags" description="Assign SEO alt tags to all product images" route="/fix-alt-tags" />
        </Section>

        <Section title="🌐 Localisation" subtitle="French content and translation tools">
          <ToolCard icon="🇫🇷" title="Fix French Content" description="Fix menus, pages, metafields and theme strings for French locale" route="/fix-french" />
          <ToolCard icon="🎨" title="Fix Theme Content" description="Update theme metafields and content blocks" route="/fix-theme" />
          <ToolCard icon="🔤" title="Translate Content" description="Translate products, collections, pages and tags via Shopify Translate API" route="/translate" />
        </Section>

        <Section title="⭐ Reviews" subtitle="Customer review management">
          <ToolCard icon="💬" title="Reviews Moderation" description="Approve, reject and manage customer product reviews" route="/reviews" />
        </Section>

        <Section title="🔗 Quick Links" cols={2}>
          <ToolCard icon="🤖" title="AI Match" description="match.gcitires.com" url="https://match.gcitires.com" />
          <ToolCard icon="🏪" title="Shopify Admin" description="gcitires-ca.myshopify.com" url="https://gcitires-ca.myshopify.com/admin" />
          <ToolCard icon="📊" title="Google Merchant Center" description="Account 5729793911" url="https://merchants.google.com" />
          <ToolCard icon="🚀" title="Vercel" description="Deployments & logs" url="https://vercel.com/dashboard" />
          <ToolCard icon="📦" title="GitHub" description="statco/gci-brain" url="https://github.com/statco/gci-brain" />
          <ToolCard icon="🌐" title="GCI Tires" description="gcitires.com" url="https://gcitires.com" />
        </Section>

      </div>
    </div>
  );
}
