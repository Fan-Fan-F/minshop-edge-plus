import { describe, it, expect } from 'vitest';
import {
  calculateDiscount,
  validateCoupon,
  normalizeCouponCode,
  findCouponByCode,
  type Coupon,
} from './engine';

describe('Discount Engine', () => {
  describe('normalizeCouponCode', () => {
    it('trims whitespace and converts to uppercase', () => {
      expect(normalizeCouponCode('  welcome10  ')).toBe('WELCOME10');
      expect(normalizeCouponCode('Save5')).toBe('SAVE5');
      expect(normalizeCouponCode('')).toBe('');
    });
  });

  describe('validateCoupon', () => {
    const baseCoupon: Coupon = {
      code: 'TEST10',
      type: 'percentage',
      value: 10,
      active: true,
      minSubtotalCents: 1000,
      usageLimit: 100,
      usedCount: 5,
      startsAt: '2026-01-01T00:00:00Z',
      expiresAt: '2026-12-31T23:59:59Z',
    };

    it('returns not_found when coupon is null or undefined', () => {
      expect(validateCoupon(null)).toEqual({ valid: false, reason: 'not_found' });
      expect(validateCoupon(undefined)).toEqual({ valid: false, reason: 'not_found' });
    });

    it('returns inactive when coupon.active is false', () => {
      const inactive = { ...baseCoupon, active: false };
      expect(validateCoupon(inactive)).toEqual({
        valid: false,
        reason: 'inactive',
        coupon: inactive,
      });
    });

    it('returns not_started when current time is before startsAt', () => {
      const future = { ...baseCoupon, startsAt: '2026-06-01T00:00:00Z' };
      const now = new Date('2026-05-01T00:00:00Z');
      expect(validateCoupon(future, { now })).toEqual({
        valid: false,
        reason: 'not_started',
        coupon: future,
      });
    });

    it('returns expired when current time is after expiresAt', () => {
      const expired = { ...baseCoupon, expiresAt: '2026-01-01T00:00:00Z' };
      const now = new Date('2026-02-01T00:00:00Z');
      expect(validateCoupon(expired, { now })).toEqual({
        valid: false,
        reason: 'expired',
        coupon: expired,
      });
    });

    it('returns usage_limit_reached when usedCount reaches usageLimit', () => {
      const maxed = { ...baseCoupon, usageLimit: 10, usedCount: 10 };
      expect(validateCoupon(maxed)).toEqual({
        valid: false,
        reason: 'usage_limit_reached',
        coupon: maxed,
      });
    });

    it('returns min_subtotal_not_met when subtotal is below minimum spend requirement', () => {
      const now = new Date('2026-06-01T00:00:00Z');
      expect(validateCoupon(baseCoupon, { subtotalCents: 800, now })).toEqual({
        valid: false,
        reason: 'min_subtotal_not_met',
        coupon: baseCoupon,
      });
    });

    it('returns valid when all criteria are satisfied', () => {
      const now = new Date('2026-06-01T00:00:00Z');
      expect(validateCoupon(baseCoupon, { subtotalCents: 2500, now })).toEqual({
        valid: true,
        coupon: baseCoupon,
      });
    });
  });

  describe('calculateDiscount', () => {
    it('calculates percentage discounts accurately with integer rounding', () => {
      const coupon: Coupon = {
        code: 'PERC15',
        type: 'percentage',
        value: 15,
      };
      // 15% of $19.99 (1999 cents) = 299.85 -> 300 cents
      const result = calculateDiscount({
        coupon,
        subtotalCents: 1999,
        shippingFeeCents: 500,
      });
      expect(result.discountSubtotalCents).toBe(300);
      expect(result.discountShippingCents).toBe(0);
      expect(result.totalDiscountCents).toBe(300);
      expect(result.finalSubtotalCents).toBe(1699);
      expect(result.finalShippingCents).toBe(500);
      expect(result.finalTotalCents).toBe(2199);
    });

    it('respects maxDiscountCents on percentage discounts', () => {
      const coupon: Coupon = {
        code: 'PERC50CAP',
        type: 'percentage',
        value: 50,
        maxDiscountCents: 1000, // max $10 off
      };
      // 50% of $100.00 (10000 cents) = 5000 cents -> capped at 1000 cents
      const result = calculateDiscount({
        coupon,
        subtotalCents: 10000,
        shippingFeeCents: 1000,
      });
      expect(result.discountSubtotalCents).toBe(1000);
      expect(result.finalSubtotalCents).toBe(9000);
      expect(result.finalTotalCents).toBe(10000);
    });

    it('calculates fixed amount discounts, clamping to subtotal so total is never negative', () => {
      const coupon: Coupon = {
        code: 'SAVE20',
        type: 'fixed_amount',
        value: 2000, // $20 off
      };
      // Basket has $15.00 subtotal -> discount clamped to $15.00
      const result = calculateDiscount({
        coupon,
        subtotalCents: 1500,
        shippingFeeCents: 500,
      });
      expect(result.discountSubtotalCents).toBe(1500);
      expect(result.discountShippingCents).toBe(0);
      expect(result.totalDiscountCents).toBe(1500);
      expect(result.finalSubtotalCents).toBe(0);
      expect(result.finalShippingCents).toBe(500);
      expect(result.finalTotalCents).toBe(500);
    });

    it('calculates free shipping discounts by discounting shipping fee completely', () => {
      const coupon: Coupon = {
        code: 'FREESHIP',
        type: 'free_shipping',
        value: 0,
      };
      const result = calculateDiscount({
        coupon,
        subtotalCents: 3500,
        shippingFeeCents: 850,
      });
      expect(result.discountSubtotalCents).toBe(0);
      expect(result.discountShippingCents).toBe(850);
      expect(result.totalDiscountCents).toBe(850);
      expect(result.finalSubtotalCents).toBe(3500);
      expect(result.finalShippingCents).toBe(0);
      expect(result.finalTotalCents).toBe(3500);
    });

    it('handles edge case zero subtotal and zero shipping gracefully', () => {
      const coupon: Coupon = {
        code: 'PERC20',
        type: 'percentage',
        value: 20,
      };
      const result = calculateDiscount({
        coupon,
        subtotalCents: 0,
        shippingFeeCents: 0,
      });
      expect(result.discountSubtotalCents).toBe(0);
      expect(result.discountShippingCents).toBe(0);
      expect(result.finalTotalCents).toBe(0);
    });
  });

  describe('findCouponByCode', () => {
    it('finds existing coupon case-insensitively', () => {
      const found = findCouponByCode('welcome10');
      expect(found).not.toBeNull();
      expect(found?.code).toBe('WELCOME10');
      expect(found?.type).toBe('percentage');
    });

    it('returns null for nonexistent coupon', () => {
      expect(findCouponByCode('NOT_REAL')).toBeNull();
      expect(findCouponByCode('')).toBeNull();
    });
  });
});
