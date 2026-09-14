export const prerender = false;

import type { APIRoute } from 'astro';

const PACKAGE_TOTALS: Record<string, number> = {
  A: 600000, // $6,000 — Recruiting Video
  B: 800000, // $8,000 — Recruiting + Fundraising
};

function installmentAmount(total: number, installment: 1 | 2): number {
  const half = Math.floor(total / 2);
  return installment === 1 ? half : total - half;
}

const PACKAGE_LABELS: Record<string, string> = {
  A: 'Recruiting Video',
  B: 'Recruiting Video + Fundraising Add-On',
};

const INSTALLMENT_LABELS: Record<number, string> = {
  1: 'Deposit (1 of 2)',
  2: 'Final Delivery (2 of 2)',
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
  const installment = Number(body.installment) as 1 | 2;

  if (!PACKAGE_TOTALS[pkg] || ![1, 2].includes(installment)) {
    return new Response(JSON.stringify({ error: 'Invalid package or installment.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const amountCents = installmentAmount(PACKAGE_TOTALS[pkg], installment);
  const amountDollars = (amountCents / 100).toFixed(2);
  const label = `Yeshiva of Orlando — ${PACKAGE_LABELS[pkg]} — ${INSTALLMENT_LABELS[installment]}`;

  const payload = {
    orderid: `yeshiva-orlando-${pkg.toLowerCase()}-${installment}-${Date.now()}`,
    successurl: 'https://attentionearned.com/proposals/yeshiva-orlando?paid=true',
    items: [
      {
        name: label,
        quantity: 1,
        price: `${amountDollars} USD`,
        sku: `yeshiva-orlando-pkg-${pkg.toLowerCase()}-install-${installment}`,
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
