# Billing & entitlements

## Approved paid pricing

- **Plus — $8/month**
- **Pro — $12/month**

These are the only paid tiers currently implemented. Premium is not implemented and
must not be inferred or added without an explicit product decision.

## Existing allowances

The current capability limits remain the source of truth:

- Plus: 100 AI sessions, 25 document analyses, 20 advanced tutoring sessions
- Pro: 300 AI sessions, 100 document analyses, 80 advanced tutoring sessions
- Trial: 7 days, 10 AI sessions, 3 document analyses, 1 advanced tutoring session

## Billing architecture

Stripe Checkout creates subscriptions using pre-created Stripe Price IDs supplied
through server-only environment variables. Flux retrieves and validates each configured
Price before Checkout:

- active
- USD
- exact approved monthly amount
- recurring monthly interval

Flux does **not** create Stripe prices dynamically.

Subscription access is synchronized from Stripe webhook events. Webhook signatures are
verified with the Stripe signing secret, and event IDs are recorded for idempotent
processing.

The Billing Portal is used for changing/canceling an existing paid subscription.
Promotion codes are disabled by default.

## Live activation boundary

Repository billing code can be tested in Stripe test mode. Adding the code, dependency,
database migration, or test-mode configuration does not create a customer charge.

Live activation requires an intentionally configured Stripe account, Price IDs, webhook
signing secret, production environment variables, and a production deployment.

## Account ownership requirement

Stripe states that people under 18 can create an account, but a legal guardian must
be the account owner before the account can accept charges and before funds can be
transferred to a bank account.

## Economic invariant

Do not change the approved $8/$12 prices or current included allowances during billing
implementation without explicit approval. Any new AI-consuming feature must be evaluated
against the 60% minimum variable gross-margin floor before being assigned to a paid plan.
