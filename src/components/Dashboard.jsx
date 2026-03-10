import { Link } from 'react-router-dom';

const catalogTools = [
  {
    icon: '🔧',
    title: 'Shopify Fix',
    route: '/shopify-fix',
    description: 'Fix size format, variants, image assignment & SEO translation',
  },
  {
    icon: '📝',
    title: 'Fix Descriptions',
    route: '/fix-descriptions',
    description: 'Translate French product descriptions to English',
  },
  {
    icon: '🖼',
    title: 'Fix Alt Tags',
    route: '/fix-alt-tags',
    description: 'Translate French image alt tags across all products',
  },
  {
    icon: '🔍',
    title: 'Fix French Content',
    route: '/fix-french',
    description: 'Audit & fix French in pages, collections, policies',
  },
  {
    icon: '🗂',
    title: 'Collection SEO',
    route: '/collection-seo',
    description: 'Update SEO titles & descriptions for all 11 collections',
  },
  {
    icon: '🎨',
    title: 'Fix Theme Content',
    route: '/fix-theme',
    description: 'Fix footer legal line and menu labels',
  },
];

const storeTools = [
  {
    icon: '🤖',
    title: 'GCI AI Match 2.0',
    url: 'https://match.gcitires.com',
    description: 'AI-powered tire fitment engine',
  },
  {
    icon: '💬',
    title: 'TireBot',
    url: 'https://gcitires.com',
    description: 'Bilingual AI chat assistant',
  },
  {
    icon: '🏪',
    title: 'Shopify Admin',
    url: 'https://gcitires.myshopify.com/admin',
    description: 'Store backend',
  },
  {
    icon: '📊',
    title: 'Vercel Dashboard',
    url: 'https://vercel.com/dashboard',
    description: 'Deployments & logs',
  },
  {
    icon: '📦',
    title: 'GitHub Repo',
    url: 'https://github.com/statco/gci-brain',
    description: 'Source code',
  },
];

export default function Dashboard() {
  return (
    <div style={styles.root}>
      {/* Grid texture overlay */}
      <div style={styles.gridOverlay} />

      {/* Header */}
      <header style={styles.header}>
        <span style={styles.logo}>⚙ GCI BRAIN</span>
        <a
          href="https://gcitires.com"
          target="_blank"
          rel="noopener noreferrer"
          style={styles.headerLink}
        >
          gcitires.com ↗
        </a>
      </header>

      {/* Main content */}
      <main style={styles.main}>
        {/* CATALOG TOOLS — 60% */}
        <section style={styles.catalogSection}>
          <h2 style={styles.sectionHeading}>CATALOG TOOLS</h2>
          <div style={styles.catalogGrid}>
            {catalogTools.map((tool) => (
              <div key={tool.route} style={styles.card} className="dash-card">
                <div style={styles.cardTop}>
                  <span style={styles.cardIcon}>{tool.icon}</span>
                  <span style={styles.liveIndicator}>
                    <span style={styles.greenDot}>●</span> LIVE
                  </span>
                </div>
                <h3 style={styles.cardTitle}>{tool.title}</h3>
                <p style={styles.cardDesc}>{tool.description}</p>
                <Link to={tool.route} style={styles.launchBtn} className="dash-launch-btn">
                  LAUNCH
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* STORE TOOLS — 40% */}
        <section style={styles.storeSection}>
          <h2 style={styles.sectionHeading}>STORE TOOLS</h2>
          <div style={styles.storeStack}>
            {storeTools.map((tool) => (
              <div key={tool.url} style={styles.storeCard} className="dash-store-card">
                <div style={styles.storeCardLeft}>
                  <span style={styles.cardIcon}>{tool.icon}</span>
                  <div>
                    <h3 style={styles.storeCardTitle}>{tool.title}</h3>
                    <p style={styles.storeCardDesc}>{tool.description}</p>
                  </div>
                </div>
                <div style={styles.storeCardRight}>
                  <span style={styles.externalBadge}>↗ EXTERNAL</span>
                  <a
                    href={tool.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={styles.externalBtn}
                    className="dash-external-btn"
                  >
                    OPEN
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer style={styles.footer}>
        GROUPE DE COMMERCE INTERCONTINENTAL INC. — NEQ: 1178796265 — info@gcitires.com
      </footer>

      <style>{`
        .dash-card {
          transition: box-shadow 200ms ease, border-color 200ms ease, transform 200ms ease;
        }
        .dash-card:hover {
          box-shadow: 0 0 20px rgba(255,60,0,0.15) !important;
          border-color: #ff3c00 !important;
          transform: translateY(-2px);
        }
        .dash-store-card {
          transition: box-shadow 200ms ease, border-color 200ms ease;
        }
        .dash-store-card:hover {
          box-shadow: 0 0 20px rgba(255,60,0,0.15) !important;
          border-color: #ff3c00 !important;
        }
        .dash-launch-btn {
          transition: background 200ms ease, color 200ms ease, border-color 200ms ease;
        }
        .dash-launch-btn:hover {
          background: #ff3c00 !important;
          color: #fff !important;
          border-color: #ff3c00 !important;
        }
        .dash-external-btn {
          transition: background 200ms ease, color 200ms ease, border-color 200ms ease;
        }
        .dash-external-btn:hover {
          background: #ff3c00 !important;
          color: #fff !important;
          border-color: #ff3c00 !important;
        }
      `}</style>
    </div>
  );
}

const styles = {
  root: {
    minHeight: '100vh',
    background: '#0a0a0f',
    color: '#e8e8e8',
    fontFamily: "'Courier New', monospace",
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    overflow: 'hidden',
  },
  gridOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundImage:
      'linear-gradient(rgba(255,60,0,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,60,0,0.03) 1px, transparent 1px)',
    backgroundSize: '40px 40px',
    pointerEvents: 'none',
    zIndex: 0,
  },
  header: {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 32px',
    borderBottom: '1px solid #2a2a3a',
    background: '#0a0a0f',
  },
  logo: {
    fontFamily: "'Courier New', monospace",
    fontSize: '18px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    color: '#ff3c00',
  },
  headerLink: {
    fontFamily: "'Courier New', monospace",
    fontSize: '13px',
    color: '#888',
    textDecoration: 'none',
    letterSpacing: '0.08em',
    transition: 'color 200ms ease',
  },
  main: {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    flex: 1,
    gap: '24px',
    padding: '32px',
    alignItems: 'flex-start',
  },
  catalogSection: {
    flex: '0 0 60%',
    maxWidth: '60%',
  },
  storeSection: {
    flex: '0 0 calc(40% - 24px)',
    maxWidth: 'calc(40% - 24px)',
  },
  sectionHeading: {
    fontFamily: 'Georgia, serif',
    fontSize: '13px',
    letterSpacing: '0.18em',
    color: '#ff3c00',
    marginBottom: '16px',
    marginTop: 0,
    borderBottom: '1px solid #2a2a3a',
    paddingBottom: '8px',
  },
  catalogGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '16px',
  },
  card: {
    background: '#12121a',
    border: '1px solid #2a2a3a',
    borderRadius: '4px',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    cursor: 'default',
  },
  cardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardIcon: {
    fontSize: '22px',
    lineHeight: 1,
  },
  liveIndicator: {
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    color: '#4ade80',
    letterSpacing: '0.1em',
  },
  greenDot: {
    color: '#4ade80',
  },
  externalBadge: {
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    color: '#888',
    letterSpacing: '0.1em',
  },
  cardTitle: {
    fontFamily: 'Georgia, serif',
    fontSize: '16px',
    fontWeight: 700,
    margin: 0,
    color: '#e8e8e8',
  },
  cardDesc: {
    fontFamily: "'Courier New', monospace",
    fontSize: '12px',
    color: '#888',
    margin: 0,
    lineHeight: 1.5,
    flex: 1,
  },
  launchBtn: {
    display: 'inline-block',
    fontFamily: "'Courier New', monospace",
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    padding: '8px 16px',
    background: 'transparent',
    border: '1px solid #ff3c00',
    color: '#ff3c00',
    borderRadius: '2px',
    textDecoration: 'none',
    textAlign: 'center',
    alignSelf: 'flex-start',
    cursor: 'pointer',
  },
  storeStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  storeCard: {
    background: '#12121a',
    border: '1px solid #2a2a3a',
    borderRadius: '4px',
    padding: '16px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
  },
  storeCardLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    flex: 1,
    minWidth: 0,
  },
  storeCardTitle: {
    fontFamily: 'Georgia, serif',
    fontSize: '14px',
    fontWeight: 700,
    margin: '0 0 2px 0',
    color: '#e8e8e8',
  },
  storeCardDesc: {
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    color: '#888',
    margin: 0,
  },
  storeCardRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '6px',
    flexShrink: 0,
  },
  externalBtn: {
    display: 'inline-block',
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    padding: '6px 12px',
    background: 'transparent',
    border: '1px solid #ff3c00',
    color: '#ff3c00',
    borderRadius: '2px',
    textDecoration: 'none',
    cursor: 'pointer',
  },
  footer: {
    position: 'relative',
    zIndex: 1,
    textAlign: 'center',
    padding: '14px 32px',
    borderTop: '1px solid #2a2a3a',
    fontFamily: "'Courier New', monospace",
    fontSize: '11px',
    color: '#555',
    letterSpacing: '0.06em',
  },
};
