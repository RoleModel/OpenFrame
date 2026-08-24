import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStripeFeatureEnabled } from '@/lib/feature-flags';

/*
 * The default is the point of these. Defaulting the Stripe *feature* on meant a
 * self-hosted instance with no keys enforced the trial's one-workspace limit and
 * offered an upgrade that could not be completed.
 */
describe('isStripeFeatureEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off when unset and there is no Stripe config — the self-hosted case', () => {
    vi.stubEnv('OPENFRAME_ENABLE_STRIPE', '');
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    vi.stubEnv('STRIPE_PRICE_ID', '');
    expect(isStripeFeatureEnabled()).toBe(false);
  });

  it('is on when unset but Stripe is configured — the hosted case', () => {
    vi.stubEnv('OPENFRAME_ENABLE_STRIPE', '');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
    vi.stubEnv('STRIPE_PRICE_ID', 'price_x');
    expect(isStripeFeatureEnabled()).toBe(true);
  });

  it('an explicit true wins over missing config', () => {
    vi.stubEnv('OPENFRAME_ENABLE_STRIPE', 'true');
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    vi.stubEnv('STRIPE_PRICE_ID', '');
    expect(isStripeFeatureEnabled()).toBe(true);
  });

  it('an explicit false wins over present config', () => {
    vi.stubEnv('OPENFRAME_ENABLE_STRIPE', 'false');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
    vi.stubEnv('STRIPE_PRICE_ID', 'price_x');
    expect(isStripeFeatureEnabled()).toBe(false);
  });

  it('a half-configured Stripe does not count as configured', () => {
    vi.stubEnv('OPENFRAME_ENABLE_STRIPE', '');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
    vi.stubEnv('STRIPE_PRICE_ID', '');
    expect(isStripeFeatureEnabled()).toBe(false);
  });
});
