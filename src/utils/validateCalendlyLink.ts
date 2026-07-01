import React from 'react';

export async function isCalendlyLinkValid(url: string): Promise<boolean> {
  if (!url || !url.includes('calendly.com')) return false;
  try {
    await fetch(url, { method: 'HEAD', mode: 'no-cors' });
    return true; // no-cors won't give status but won't throw if reachable
  } catch {
    return false;
  }
}

export function CalendlyButton({
  url,
  label = 'Book Installation'
}: {
  url?: string;
  label?: string;
}) {
  const [valid, setValid] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (!url) { setValid(false); return; }
    isCalendlyLinkValid(url).then(setValid);
  }, [url]);
  if (valid === null) return (
    React.createElement('button', { disabled: true, style: { opacity: 0.5 } }, 'Checking availability...')
  );
  if (!valid) return (
    React.createElement('p', { style: { color: '#ef4444', fontSize: '0.875rem' } },
      'Booking unavailable — installer calendar not configured.')
  );
  return (
    React.createElement('a', { href: url, target: '_blank', rel: 'noopener noreferrer' },
      React.createElement('button', null, label))
  );
}
