// WP10: Stripe Integration Stub

export const stripeService = {
  createCheckoutSession(tier: string, userId: string, isPrimerica: boolean = false) {
    if (isPrimerica) {
      return { url: null, error: 'Primerica users get free access — no checkout needed' };
    }
    return {
      url: `https://checkout.stripe.com/pay/harvest-${tier.toLowerCase()}-${userId}`,
      sessionId: `cs_${userId}_${Date.now()}`,
    };
  },

  handleWebhook(event: any) {
    const eventType = event?.type || 'unknown';
    console.log(`[Stripe Stub] Received event: ${eventType}`);
    return { received: true, eventType };
  },
};
