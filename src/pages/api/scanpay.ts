export const prerender = false;

import type { APIRoute } from 'astro';

// ── Client configs ──────────────────────────────────────────────────────────

type InstallmentCount = 2 | 3;

interface ClientConfig {
  packages: Record<string, number>; // cents
  installments: InstallmentCount;
  label: (pkg: string, installment: number) => string;
  orderPrefix: string;
  successUrl: string;
  skuPrefix: string;
}

const CLIENTS: Record<string, ClientConfig> = {
  'haor-beacon': {
    packages: { A: 950000, B: 650000 },
    installments: 3,
    label: (pkg, n) => `Ha'Or Beacon School Fundraising Video — ${THIRDS_LABELS[n]}`,
    orderPrefix: 'haor',
    successUrl: 'https://attentionearned.com/proposals/haor-beacon?paid=true',
    skuPrefix: 'pkg',
  },
  'yeshiva-orlando': {
    packages: { A: 600000, B: 800000 },
    installments: 2,
    label: (pkg, n) => `Yeshiva of Orlando — ${YESHIVA_PKG_LABELS[pkg]} — ${HALVES_LABELS[n]}`,
    orderPrefix: 'yeshiva-orlando',
    successUrl: 'https://attentionearned.com/proposals/yeshiva-orlando?paid=true',
    skuPrefix: 'yeshiva-orlando-pkg',
  },
};

const THIRDS_LABELS: Record<number, string> = {
  1: 'Deposit (1st of 3)',
  2: 'Production Day Payment (2nd of 3)',
  3: 'Final Delivery Payment (3rd of 3)',
};

const HALVES_LABELS: Record<number, string> = {
  1: 'Deposit (1 of 2)',
  2: 'Final Delivery (2 of 2)',
};

const YESHIVA_PKG_LABELS: Record<string, string> = {
  A: 'Recruiting Video',
  B: 'Recruiting Video + Fundraising Add-On',
};

// ── Installment math ────────────────────────────────────────────────────────

function installmentAmount(total: number, n: number, count: InstallmentCount): number {
  if (count === 2) {
    const half = Math.floor(total / 2);
    return n === 1 ? half : total - half;
  }
  // thirds — distribute rounding to first installments
  const base = Math.floor(total / 3);
  const remainder = total - base * 3;
  if (n === 3) return base + remainder;
  return base + (n === 1 ? (remainder > 0 ? 1 : 0) : remainder > 1 ? 1 : 0);
}

// ── Route ───────────────────────────────────────────────────────────────────

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.SCANPAY_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Payment not configured.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { client?: string; package: string; installment: number };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Default to haor-beacon for backwards compatibility
  const clientKey = body.client ?? 'haor-beacon';
  const config = CLIENTS[clientKey];
  if (!config) {
    return new Response(JSON.stringify({ error: 'Unknown client.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const pkg = body.package?.toUpperCase();
  const installment = Number(body.installment);
  const validInstallments = Array.from({ length: config.installments }, (_, i) => i + 1);

  if (!config.packages[pkg] || !validInstallments.includes(installment)) {
    return new Response(JSON.stringify({ error: 'Invalid package or installment.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const amountCents = installmentAmount(config.packages[pkg], installment, config.installments);
  const amountDollars = (amountCents / 100).toFixed(2);

  const payload = {
    orderid: `${config.orderPrefix}-${pkg.toLowerCase()}-${installment}-${Date.now()}`,
    successurl: config.successUrl,
    items: [
      {
        name: config.label(pkg, installment),
        quantity: 1,
        price: `${amountDollars} USD`,
        sku: `${config.skuPrefix}-${pkg.toLowerCase()}-install-${installment}`,
      },
    ],
  };

  const credentials = btoa(`${apiKey}:`);

  try {
    const res = await fetch('https://api.scanpay.dk/v1/new', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseText = await res.text();
    if (!res.ok) {
      console.error('ScanPay error:', res.status, responseText);
      return new Response(JSON.stringify({ error: `ScanPay ${res.status}: ${responseText}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = JSON.parse(responseText) as { url: string };
    return new Response(JSON.stringify({ url: data.url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('ScanPay fetch failed:', err);
    return new Response(JSON.stringify({ error: 'Could not reach payment provider.' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
