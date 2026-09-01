export const prerender = false;

import type { APIRoute } from 'astro';

const PACKAGE_TOTALS: Record<string, number> = {
  A: 950000,
  B: 650000,
};

function installmentAmount(total: number, n: number): number {
  const base = Math.floor(total / 3);
  const rem = total - base * 3;
  if (n === 3) return base + rem;
  return base + (n === 1 ? (rem > 0 ? 1 : 0) : rem > 1 ? 1 : 0);
}

const INSTALLMENT_LABELS: Record<number, string> = {
  1: 'Deposit (1st of 3)',
  2: 'Production Day Payment (2nd of 3)',
  3: 'Final Delivery Payment (3rd of 3)',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const apiKey = import.meta.env.SCANPAY_API_KEY;
    if (!apiKey) {
      return json({ error: 'SCANPAY_API_KEY is not set on the server.' }, 500);
    }

    let body: { package: string; installment: number };
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400);
    }

    const pkg = String(body.package ?? '').toUpperCase();
    const installment = Number(body.installment);

    if (!PACKAGE_TOTALS[pkg] || ![1, 2, 3].includes(installment)) {
      return json({ error: `Invalid package "${pkg}" or installment "${installment}".` }, 400);
    }

    const amountCents = installmentAmount(PACKAGE_TOTALS[pkg], installment);
    const amountDollars = (amountCents / 100).toFixed(2);
    const itemName = `Ha'Or Beacon School Fundraising Video — ${INSTALLMENT_LABELS[installment]}`;

    const payload = {
      orderid: `haor-${pkg.toLowerCase()}-${installment}-${Date.now()}`,
      successurl: 'https://attentionearned.com/proposals/haor-beacon?paid=true',
      items: [
        {
          name: itemName,
          quantity: 1,
          price: `${amountDollars} USD`,
          sku: `pkg-${pkg.toLowerCase()}-install-${installment}`,
        },
      ],
    };

    // ScanPay Basic auth: base64(apikey:)
    const credentials = btoa(`${apiKey}:`);

    let scanpayRes: Response;
    try {
      scanpayRes = await fetch('https://api.scanpay.dk/v1/new', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (fetchErr) {
      console.error('ScanPay fetch failed:', fetchErr);
      return json({ error: `Could not reach ScanPay: ${String(fetchErr)}` }, 502);
    }

    const responseText = await scanpayRes.text();
    console.log('ScanPay response:', scanpayRes.status, responseText);

    if (!scanpayRes.ok) {
      return json({ error: `ScanPay ${scanpayRes.status}: ${responseText}` }, 502);
    }

    let data: { url?: string };
    try {
      data = JSON.parse(responseText);
    } catch {
      return json({ error: `ScanPay returned non-JSON: ${responseText}` }, 502);
    }

    if (!data.url) {
      return json({ error: `ScanPay response missing url field: ${responseText}` }, 502);
    }

    return json({ url: data.url });

  } catch (err) {
    console.error('Unhandled error in /api/scanpay:', err);
    return json({ error: `Server error: ${String(err)}` }, 500);
  }
};
