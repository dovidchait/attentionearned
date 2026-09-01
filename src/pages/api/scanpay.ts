export const prerender = false;

import type { APIRoute } from 'astro';

// Package totals in cents
const PACKAGE_TOTALS: Record<string, number> = {
  A: 950000, // $9,500.00
  B: 650000, // $6,500.00
};

// Installment fractions (third 1, third 2, third 3)
// Distribute rounding: first two get ceiling, last gets the remainder
function installmentAmount(total: number, installment: 1 | 2 | 3): number {
  const base = Math.floor(total / 3);
  const remainder = total - base * 3;
  if (installment === 3) return base + remainder;
  return base + (installment === 1 ? (remainder > 0 ? 1 : 0) : remainder > 1 ? 1 : 0);
}

const INSTALLMENT_LABELS: Record<number, string> = {
  1: 'Deposit (1st of 3)',
  2: 'Production Day Payment (2nd of 3)',
  3: 'Final Delivery Payment (3rd of 3)',
};

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.SCANPAY_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Payment not configured.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { package: string; installment: number };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const pkg = body.package?.toUpperCase();
  const installment = Number(body.installment) as 1 | 2 | 3;

  if (!PACKAGE_TOTALS[pkg] || ![1, 2, 3].includes(installment)) {
    return new Response(JSON.stringify({ error: 'Invalid package or installment.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const amountCents = installmentAmount(PACKAGE_TOTALS[pkg], installment);
  const amountDollars = (amountCents / 100).toFixed(2);
  const label = `Ha'Or Beacon School Fundraising Video — ${INSTALLMENT_LABELS[installment]}`;

  const payload = {
    orderid: `haor-${pkg.toLowerCase()}-${installment}-${Date.now()}`,
    successurl: 'https://attentionearned.com/proposals/haor-beacon?paid=true',
    items: [
      {
        name: label,
        quantity: 1,
        price: `${amountDollars} USD`,
        sku: `pkg-${pkg.toLowerCase()}-install-${installment}`,
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
