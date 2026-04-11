# Billing and Profitability Report

## Executive Summary

- The current codebase still prices the core SaaS plans at placeholder values: Basic at Rs 1/month, Growth at Rs 2/month, and Pro at Rs 3/month. Annual billing is likewise placeholder at Rs 10, Rs 20, and Rs 30.
- Using the operating-cost figures provided in chat, fixed infrastructure alone costs about Rs 3,727/month up to 10-15 gyms and about Rs 13,219/month after the Render and Copilot upgrades.
- At the current placeholder prices, even if MSG91 and Hello cost zero, the business needs thousands of monthly subscriptions or hundreds of annual cash collections just to break even.
- The repo and chat history did not contain numeric MSG91 outbound-message rates or Hello inbound-number pricing, so those costs are modeled as formulas below. Once any normal vendor rate is applied, the current core plan prices become even less viable.
- Conclusion: the catalog is still in test-pricing mode. Before commercial launch, the core plan prices need to be replaced with real revenue numbers.

## Current Billing Structure In Code

### Core Plans

| Plan | Monthly Price | Annual Price | Included Branches | Member Capacity | Staff Capacity | WhatsApp Capacity | Hello Capacity | Storage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Basic | Rs 1 | Rs 10 | 1 | 150 total | 2 total | 500/month | 0 | 5 GB |
| Growth | Rs 2 | Rs 20 | Up to 2 | Up to 800 total | Up to 10 total | Up to 2,000/month | Up to 2 numbers | 10 GB |
| Pro | Rs 3 | Rs 30 | Up to 3 | Up to 3,000 total | Up to 30 total | Up to 6,000/month | Up to 3 numbers | 20 GB |

### Branch-Scaled Logic

- Growth and Pro now scale members, staff, WhatsApp, and Hello with the active branch count.
- Growth base entitlement is 400 members, 5 staff users, 1,000 WhatsApp messages, and 1 Hello-enabled number per active branch, up to 2 active branches.
- Pro base entitlement is 1,000 members, 10 staff users, 2,000 WhatsApp messages, and 1 Hello-enabled number per active branch, up to 3 active branches.
- Example: a Growth gym with 1 active branch gets 400 members, 5 staff, 1,000 WhatsApp messages, and 1 Hello number. The same Growth gym with 2 active branches gets 800 members, 10 staff, 2,000 WhatsApp messages, and 2 Hello numbers.

### Add-Ons

| Add-On | Price | Included Increase |
| --- | ---: | --- |
| Extra 250 WhatsApp Messages | Rs 249 | +250 outbound messages/month |
| Extra Staff User | Rs 149 | +1 staff login |
| Extra 100 Members | Rs 299 | +100 members |
| Extra Branch | Rs 599 | +1 branch |
| Extra Hello Number | Rs 699 | +1 Hello-enabled number |

Observation: the add-ons already look like commercial prices, while the core plan prices still look like testing placeholders.

## Operating Cost Assumptions Recovered From Chat

### Stage 1: Up To 10-15 Gyms

- Render: $7/month
- Vercel: $7/year one time
- Zoho Mail: Rs 150/month
- Supabase: $25/month
- Copilot: $10/month

### Stage 2: After 15 Gyms

- Render: $85/month
- Vercel: same $7/year one time
- Zoho Mail: Rs 150/month
- Supabase: $25/month
- Copilot: $45/month

### Conversion And Normalization Assumptions

- USD/INR assumed at 84.
- The Vercel annual fee is amortized to a monthly comparison cost of Rs 49/month.
- If you want strict cash accounting for a non-renewal month, subtract Rs 49 from the monthly fixed-cost totals below.

### Monthly Fixed-Cost View In INR

| Cost Item | Stage 1 | Stage 2 |
| --- | ---: | ---: |
| Render | Rs 588 | Rs 7,140 |
| Vercel annual fee, amortized monthly | Rs 49 | Rs 49 |
| Zoho Mail | Rs 150 | Rs 150 |
| Supabase | Rs 2,100 | Rs 2,100 |
| Copilot | Rs 840 | Rs 3,780 |
| Total fixed monthly cost | Rs 3,727 | Rs 13,219 |

## Variable MSG91 And Hello Cost Formulas

The missing input is vendor pricing.

- Let `w` = effective cost per outbound WhatsApp message in rupees.
- Let `h` = effective monthly cost per Hello-enabled number in rupees.

Using the current included capacities at full branch usage, the monthly vendor-cost envelope per gym is:

- Basic: `500w`
- Growth: `2000w + 2h`
- Pro: `6000w + 3h`

So the monthly contribution margin per gym is:

- Basic: `1 - 500w`
- Growth: `2 - (2000w + 2h)`
- Pro: `3 - (6000w + 3h)`

This immediately shows why the current prices are only placeholders:

- Basic stays contribution-positive only if `w < 0.002` rupees per message.
- Growth stays contribution-positive only if `2000w + 2h < 2`.
- Pro stays contribution-positive only if `6000w + 3h < 3`.

Even before fixed costs, the current catalog leaves almost no room for any real vendor bill.

## Fixed-Cost Profit Math With The Current Placeholder Catalog

The tables below intentionally ignore MSG91 and Hello vendor charges, because no numeric rates were present in repo or chat history. These counts are therefore best-case counts.

### Monthly Plan Sales Needed

#### Stage 1: Up To 10-15 Gyms

| Plan | Gyms Needed To Cover Fixed Cost | Gyms Needed For Rs 1,00,000 Profit In 30 Days |
| --- | ---: | ---: |
| Basic monthly at Rs 1 | 3,727 | 103,727 |
| Growth monthly at Rs 2 | 1,864 | 51,864 |
| Pro monthly at Rs 3 | 1,243 | 34,576 |

#### Stage 2: After 15 Gyms

| Plan | Gyms Needed To Cover Fixed Cost | Gyms Needed For Rs 1,00,000 Profit In 30 Days |
| --- | ---: | ---: |
| Basic monthly at Rs 1 | 13,219 | 113,219 |
| Growth monthly at Rs 2 | 6,610 | 56,610 |
| Pro monthly at Rs 3 | 4,407 | 37,740 |

### Annual Plan Sales Needed, Cash Basis

These counts treat the annual fee as cash collected inside the 30-day window. On a monthly accrual basis, the economics are much worse because annual revenue should be divided across 12 months.

#### Stage 1: Up To 10-15 Gyms

| Plan | Gyms Needed To Cover Fixed Cost | Gyms Needed For Rs 1,00,000 Profit In 30 Days |
| --- | ---: | ---: |
| Basic annual at Rs 10 | 373 | 10,373 |
| Growth annual at Rs 20 | 187 | 5,187 |
| Pro annual at Rs 30 | 125 | 3,458 |

#### Stage 2: After 15 Gyms

| Plan | Gyms Needed To Cover Fixed Cost | Gyms Needed For Rs 1,00,000 Profit In 30 Days |
| --- | ---: | ---: |
| Basic annual at Rs 10 | 1,322 | 11,322 |
| Growth annual at Rs 20 | 661 | 5,661 |
| Pro annual at Rs 30 | 441 | 3,774 |

## Revenue Floor Per Gym

Another way to view the problem is average revenue required per gym.

| Active Gyms | Cost Stage | Fixed Cost Per Gym | Revenue Per Gym Needed To Reach Rs 1,00,000 Monthly Profit |
| ---: | --- | ---: | ---: |
| 10 | Stage 1 | Rs 372.70 | Rs 10,372.70 |
| 15 | Stage 1 | Rs 248.47 | Rs 6,915.13 |
| 20 | Stage 2 | Rs 660.95 | Rs 5,660.95 |
| 30 | Stage 2 | Rs 440.63 | Rs 3,773.97 |
| 50 | Stage 2 | Rs 264.38 | Rs 2,264.38 |
| 100 | Stage 2 | Rs 132.19 | Rs 1,132.19 |

This table is the clearest signal for commercial pricing. Even at 100 gyms, the average revenue per gym needs to be above roughly Rs 1,132/month before MSG91, Hello, payment-gateway fees, support effort, and bad debt are counted.

## Practical Takeaways

1. The current core plans are still test prices, not market prices.
2. The branch-scaled entitlements are now clearer and operationally better, but they materially increase the value delivered on Growth and Pro, so the selling price has to rise as well.
3. Add-on prices are already much closer to commercial reality than the core plan prices.
4. To reach Rs 1 lakh profit in 30 days with a realistic number of gyms, the business needs a materially higher average revenue per gym than the current Rs 1/Rs 2/Rs 3 monthly catalog.
5. Exact gross-margin modeling still requires two missing live inputs: MSG91 effective per-message cost and Hello effective per-number monthly cost.

## Recommended Next Steps

1. Replace the placeholder core plan prices with commercial pricing before launch.
2. Decide whether WhatsApp and Hello should remain heavily bundled in the plan or move to a thinner included quota plus pay-as-you-grow add-ons.
3. Store the real MSG91 and Hello unit rates in the repo or platform settings so future billing reports can run exact gross-margin math.
4. Re-run this report once the commercial price book is finalized. At that point the same formulas can produce exact break-even and 30-day profit targets.