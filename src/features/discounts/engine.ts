export type DiscountType = 'percentage' | 'fixed_amount' | 'free_shipping';

export interface Coupon {
  code: string;
  type: DiscountType;
  /** Percentage off (e.g. 15 for 15% off) or minor units (cents) for fixed_amount. Ignored for free_shipping. */
  value: number;
  /** Optional minimum basket subtotal (in minor units / cents) required to use this coupon. */
  minSubtotalCents?: number;
  /** Optional maximum discount amount in cents (for percentage discounts). */
  maxDiscountCents?: number;
  /** Max lifetime redemptions across all orders (null/undefined = unlimited). */
  usageLimit?: number | null;
  /** Total times already redeemed. */
  usedCount?: number;
  /** ISO date string or epoch ms for when coupon starts. */
  startsAt?: string | null;
  /** ISO date string or epoch ms for when coupon expires. */
  expiresAt?: string | null;
  /** Whether the coupon is enabled. */
  active?: boolean;
  description?: string;
}

export type CouponValidationReason =
  | 'not_found'
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'min_subtotal_not_met'
  | 'usage_limit_reached';

export interface CouponValidationResult {
  valid: boolean;
  reason?: CouponValidationReason;
  coupon?: Coupon;
}

export interface DiscountCalculationOptions {
  coupon: Coupon;
  subtotalCents: number;
  shippingFeeCents?: number;
}

export interface DiscountResult {
  discountSubtotalCents: number;
  discountShippingCents: number;
  totalDiscountCents: number;
  finalSubtotalCents: number;
  finalShippingCents: number;
  finalTotalCents: number;
}

/** Standardise coupon code string for case-insensitive lookup. */
export function normalizeCouponCode(code: string): string {
  return (code || '').trim().toUpperCase();
}

/**
 * Validate a coupon candidate against business rules and cart subtotal.
 * Pure logic — no external database dependencies.
 */
export function validateCoupon(
  coupon: Coupon | null | undefined,
  options: {
    subtotalCents?: number;
    now?: Date | number;
  } = {},
): CouponValidationResult {
  if (!coupon) {
    return { valid: false, reason: 'not_found' };
  }

  if (coupon.active === false) {
    return { valid: false, reason: 'inactive', coupon };
  }

  const currentTs = options.now
    ? typeof options.now === 'number'
      ? options.now
      : options.now.getTime()
    : Date.now();

  if (coupon.startsAt) {
    const starts = new Date(coupon.startsAt).getTime();
    if (Number.isFinite(starts) && currentTs < starts) {
      return { valid: false, reason: 'not_started', coupon };
    }
  }

  if (coupon.expiresAt) {
    const expires = new Date(coupon.expiresAt).getTime();
    if (Number.isFinite(expires) && currentTs > expires) {
      return { valid: false, reason: 'expired', coupon };
    }
  }

  if (
    coupon.usageLimit != null &&
    coupon.usageLimit > 0 &&
    (coupon.usedCount ?? 0) >= coupon.usageLimit
  ) {
    return { valid: false, reason: 'usage_limit_reached', coupon };
  }

  if (
    options.subtotalCents != null &&
    coupon.minSubtotalCents != null &&
    coupon.minSubtotalCents > 0 &&
    options.subtotalCents < coupon.minSubtotalCents
  ) {
    return { valid: false, reason: 'min_subtotal_not_met', coupon };
  }

  return { valid: true, coupon };
}

/**
 * Calculate the exact discount amounts in minor units (cents).
 * Money is integer minor units end to end, never fractional, never negative.
 */
export function calculateDiscount({
  coupon,
  subtotalCents,
  shippingFeeCents = 0,
}: DiscountCalculationOptions): DiscountResult {
  const safeSubtotal = Math.max(0, Math.floor(subtotalCents));
  const safeShipping = Math.max(0, Math.floor(shippingFeeCents));

  let discountSubtotalCents = 0;
  let discountShippingCents = 0;

  switch (coupon.type) {
    case 'free_shipping': {
      discountShippingCents = safeShipping;
      discountSubtotalCents = 0;
      break;
    }
    case 'percentage': {
      const pct = Math.max(0, Math.min(100, Math.floor(coupon.value)));
      let rawDiscount = Math.round((safeSubtotal * pct) / 100);
      if (
        coupon.maxDiscountCents != null &&
        coupon.maxDiscountCents > 0 &&
        rawDiscount > coupon.maxDiscountCents
      ) {
        rawDiscount = coupon.maxDiscountCents;
      }
      discountSubtotalCents = Math.min(safeSubtotal, rawDiscount);
      discountShippingCents = 0;
      break;
    }
    case 'fixed_amount': {
      const fixedAmount = Math.max(0, Math.floor(coupon.value));
      discountSubtotalCents = Math.min(safeSubtotal, fixedAmount);
      discountShippingCents = 0;
      break;
    }
  }

  const totalDiscountCents = discountSubtotalCents + discountShippingCents;
  const finalSubtotalCents = Math.max(0, safeSubtotal - discountSubtotalCents);
  const finalShippingCents = Math.max(0, safeShipping - discountShippingCents);
  const finalTotalCents = finalSubtotalCents + finalShippingCents;

  return {
    discountSubtotalCents,
    discountShippingCents,
    totalDiscountCents,
    finalSubtotalCents,
    finalShippingCents,
    finalTotalCents,
  };
}

/** In-memory sample promo codes for demonstration or local configuration */
export const SAMPLE_PROMO_CODES: Coupon[] = [
  {
    code: 'WELCOME10',
    type: 'percentage',
    value: 10,
    minSubtotalCents: 1000,
    description: '10% off orders over $10.00',
    active: true,
  },
  {
    code: 'FREESHIP',
    type: 'free_shipping',
    value: 0,
    minSubtotalCents: 2000,
    description: 'Free shipping on orders over $20.00',
    active: true,
  },
  {
    code: 'SAVE5',
    type: 'fixed_amount',
    value: 500,
    minSubtotalCents: 1500,
    description: '$5.00 off orders over $15.00',
    active: true,
  },
];

/** Lookup a coupon by code from a list or the default sample catalog. */
export function findCouponByCode(
  code: string,
  catalog: Coupon[] = SAMPLE_PROMO_CODES,
): Coupon | null {
  const norm = normalizeCouponCode(code);
  if (!norm) return null;
  return catalog.find((c) => normalizeCouponCode(c.code) === norm) ?? null;
}
