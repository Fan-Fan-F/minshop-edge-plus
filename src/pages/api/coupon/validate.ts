import type { APIRoute } from 'astro';
import {
  findCouponByCode,
  validateCoupon,
  calculateDiscount,
} from '../../../features/discounts/engine';

export const prerender = false;

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS_HEADERS,
    },
  });

export const OPTIONS: APIRoute = () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

/**
 * GET /api/coupon/validate?code=...&subtotal=...&shipping=...
 * Validates a coupon code and calculates potential discounts.
 */
export const GET: APIRoute = async ({ url }) => {
  const code = url.searchParams.get('code') ?? '';
  const subtotalCents = Math.max(0, parseInt(url.searchParams.get('subtotal') ?? '0', 10) || 0);
  const shippingFeeCents = Math.max(0, parseInt(url.searchParams.get('shipping') ?? '0', 10) || 0);

  if (!code.trim()) {
    return jsonResponse({ valid: false, error: 'Coupon code is required.' }, 400);
  }

  const coupon = findCouponByCode(code);
  const validation = validateCoupon(coupon, { subtotalCents });

  if (!validation.valid || !validation.coupon) {
    return jsonResponse({
      valid: false,
      reason: validation.reason,
      code,
    });
  }

  const discount = calculateDiscount({
    coupon: validation.coupon,
    subtotalCents,
    shippingFeeCents,
  });

  return jsonResponse({
    valid: true,
    code: validation.coupon.code,
    description: validation.coupon.description,
    type: validation.coupon.type,
    discount,
  });
};

/**
 * POST /api/coupon/validate
 * Accepts { code, subtotal_cents, shipping_cents } in JSON body.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ valid: false, error: 'Invalid JSON body.' }, 400);
  }

  const code = typeof body.code === 'string' ? body.code : '';
  const subtotalCents =
    typeof body.subtotal_cents === 'number'
      ? Math.max(0, Math.floor(body.subtotal_cents))
      : 0;
  const shippingFeeCents =
    typeof body.shipping_cents === 'number'
      ? Math.max(0, Math.floor(body.shipping_cents))
      : 0;

  if (!code.trim()) {
    return jsonResponse({ valid: false, error: 'Coupon code is required.' }, 400);
  }

  const coupon = findCouponByCode(code);
  const validation = validateCoupon(coupon, { subtotalCents });

  if (!validation.valid || !validation.coupon) {
    return jsonResponse({
      valid: false,
      reason: validation.reason,
      code,
    });
  }

  const discount = calculateDiscount({
    coupon: validation.coupon,
    subtotalCents,
    shippingFeeCents,
  });

  return jsonResponse({
    valid: true,
    code: validation.coupon.code,
    description: validation.coupon.description,
    type: validation.coupon.type,
    discount,
  });
};
