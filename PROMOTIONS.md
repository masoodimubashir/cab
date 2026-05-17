# Promotions — what each feature does (end-user view)

This doc explains the four promotion features in the admin panel — **City Wide
Promotions**, **Promo Codes**, **Coupons**, and **Referrals** — from the
perspective of someone using the app on their phone, not someone reading the
code.

> **Current status:** the admin panel can configure all four, but **none of
> them are wired into the customer experience yet** — the data is being saved
> but nobody sees the result. This doc describes what each *should* feel like
> once shipped.

---

## 1. City Wide Promotions — "Automatic discounts"

**Think of it like:** A "Sale" sticker on a shop window. You don't do anything
— the price is just lower.

### What you'd see as a customer

You open the app, set pickup and drop, and tap "See Fares."

**Without a promotion:**

> Sedan — ₹300

**With a promotion running:**

> Sedan — ~~₹300~~ **₹240**
> *🎉 20% off — Diwali Week Special*

You didn't enter anything. You didn't have a code. The app just gave you the
discount because you fit the rules the operator set up.

### Real use cases

**Use case 1 — Launching in a new city**
You open Mumbai. The operator wants buzz for the launch, so they create:
*"30% off all rides in Mumbai, max ₹150 off, first 2 weeks."* Every Mumbai
customer sees discounted fares for 14 days. No code needed.

**Use case 2 — Filling empty cars at the airport**
The operator notices airport pickups are dead at 3 AM. They create: *"₹100
off any ride starting from Delhi Airport."* Only customers whose pickup pin
lands inside the airport zone see the discount. Drive 2 km away and the
discount disappears.

**Use case 3 — Pushing a specific car type**
Too many Sedans are sitting idle. Operator creates: *"₹50 off Sedan rides in
Bengaluru this weekend."* Customer picks Hatchback → normal price. Picks
Sedan → discounted. Nudges customers to fill the empty cars.

**Use case 4 — QR posters at offices/malls**
A company partners with you. They put up a QR poster in their office lobby.
Employees scan it → it opens your app pre-set to "ride from this office" →
the QR ride gets a special discount nobody else gets.

**The customer never types anything.** They just see "you saved ₹60" and feel
good.

---

## 2. Promo Codes — "Type a code, get free money in your wallet"

**Think of it like:** A scratch card. You enter the code in your wallet and
money lands in your account. You can spend it on any future ride.

### What you'd see as a customer

You open the app → Wallet tab → "Have a promo code?"

You type **WELCOME100** and tap Apply.

> ✅ ₹100 added to your wallet. Valid until 14 June.
> Wallet balance: ₹100

Next time you book a ride, the app uses that ₹100 first, and you only pay the
rest from your card/UPI.

### Real use cases

**Use case 1 — Welcome bonus for new users**
Your marketing team puts "Use code WELCOME100 — get ₹100 free!" on Instagram.
A new user signs up, redeems it, and now has free money to spend. Their
first ride costs them very little out of pocket → they're hooked.

**Use case 2 — Influencer / YouTuber deals**
A travel YouTuber posts your code **TRAVELWITHRAJ**. First 500 viewers who
redeem it get ₹200. The operator caps it at 500 redemptions so the budget is
fixed. Lets you track exactly how many rides the partnership produced.

**Use case 3 — Support hands out apology credits**
A customer's driver was rude. They call support. Instead of a manual refund
(slow, painful), the agent gives them a code **SORRY50** that only that
customer can use. Done in 30 seconds.

**Use case 4 — Winning back inactive users**
A customer hasn't ridden in 60 days. The app emails them a personalised code:
*"We miss you — here's ₹150 to come back."* They redeem and ride.

**Key difference from a city-wide promo:** This is **cash in their wallet**,
not a discount on one trip. They can use it across many rides until it runs
out or expires.

---

## 3. Coupons — "A specific gift just for you, used at checkout"

**Think of it like:** A gift voucher someone handed you personally. You hold
it. When you're about to pay, you decide whether to use it.

### What you'd see as a customer

You open the app → **"My Coupons" tab**.

> 🎁 **20% off your next ride**
> *Up to ₹100 off — expires in 7 days*
>
> 🎁 **Flat ₹50 off**
> *Airport rides only — expires in 30 days*

You book a ride. On the payment screen:

> Fare: ₹300
> Apply coupon? [pick one]
> ✅ Selected: *20% off your next ride*
> **You pay: ₹240** (saved ₹60)

### Real use cases

**Use case 1 — First-ride gift**
Every new customer who signs up automatically receives one coupon: *"50% off
your first ride."* It sits in their "My Coupons" tab waiting. Big incentive
to actually take that first trip.

**Use case 2 — Referral reward** *(see #4 below — coupons are how referrals
pay out)*

**Use case 3 — "Sorry your driver cancelled" gesture**
A driver cancels last minute. The system auto-issues a coupon to the
affected customer: *"₹50 off your next ride — apologies."* Better than a
refund because it guarantees the customer comes back.

**Use case 4 — Loyalty milestone**
Customer completes their 10th ride → bang, a coupon lands in their app:
*"You've ridden 10 times — here's 25% off."* Makes loyal customers feel seen.

**Use case 5 — Targeted "we miss you"**
Customer hasn't ridden in 3 weeks → operator's CRM tool issues a coupon to
them: *"Come back — flat ₹75 off this week."*

**Difference from promo code:** They didn't *type* anything. The coupon was
*given* to them (by referral, by the system, by support). And it's a
discount on **one specific trip**, not wallet cash.

---

## 4. Referrals — "Invite friends, both of you win"

**Think of it like:** Uber's "Free rides — invite a friend." Your friends
sign up using your code; both of you get rewarded.

### What you'd see as a customer (the inviter)

You open the app → **"Invite & Earn"** tab.

> 💰 **Invite friends, both of you get ₹100 off!**
>
> Your code: **MUBASHIR-A4F2**
>
> [Share via WhatsApp] [Share via SMS] [Copy link]

You tap WhatsApp. Your friend gets:

> "Hey, try DreamCabs — get ₹100 off your first ride with my code
> MUBASHIR-A4F2 → [link]"

### What your friend sees (the invitee)

They tap the link. The app opens (or installs from Play Store). On the
signup screen, the referral code is **already filled in**.

After signup, they see:

> 🎁 You have a new coupon: **₹100 off your first ride** (from Mubashir)

### What happens next

Your friend takes their first ride. The moment that ride completes:

- **You** get a notification: *"Your friend Ahmed just took their first ride
  — here's ₹100 off your next ride 🎉"* A coupon lands in your "My Coupons"
  tab.
- **Ahmed** already used his ₹100-off coupon on that first ride.

Both sides won.

### Real use cases

**Use case 1 — Organic growth at near-zero marketing cost**
Most ride apps grow through referrals because the strongest signal is "my
friend uses it." You don't pay Google or Facebook — you pay your own users
to bring friends.

**Use case 2 — Per-city tuning**
In Mumbai (mature market) you reward ₹50 each. In Lucknow (new market) you
reward ₹150 each because acquiring a customer there costs more. That's
exactly why the referral settings are **per-city**, not global.

**Use case 3 — Different rewards on each side**
Maybe the new user (friend) gets a coupon *and* the inviter (you) gets a
coupon for a special carpool ride. The settings allow the two sides to
receive different things.

**Use case 4 — Anti-abuse**
Without a real referral system, people create fake accounts to abuse
welcome bonuses. A proper referral flow tracks who-referred-whom and can
block self-referrals or same-phone abuse.

---

## Quick comparison table

|                          | When does the customer see it?                  | What do they do?         | What do they get?                       |
| ------------------------ | ----------------------------------------------- | ------------------------ | --------------------------------------- |
| **City Wide Promotion**  | Automatically, on the fare screen               | Nothing                  | Cheaper ride right now                  |
| **Promo Code**           | They saw it on social media / got an email      | Type the code in Wallet  | Free money in wallet for future rides   |
| **Coupon**               | It just appears in "My Coupons" tab             | Pick it at checkout      | Discount on one specific ride           |
| **Referral**             | "Invite & Earn" tab + their friend's signup     | Share their code         | Both of them get a coupon               |

---

## Why ship all four (not just one)

They serve **different jobs**:

- **City Wide Promotion** = *market-wide growth lever* (launch a city, push a
  vehicle type, smooth out demand troughs).
- **Promo Code** = *marketing & support tool* (influencer deals, win-back,
  apologies).
- **Coupon** = *targeted customer experience* (loyalty, individual gifts,
  referral payouts).
- **Referral** = *cheapest acquisition channel* (existing users do the
  marketing).

The current admin panel can already set all of this up — but until the
consumer side is wired, the marketing team is configuring rules nobody ever
sees. That's the gap to close.

---

## Recommended ship order

1. **City Wide Promotions** — pure auto-discount, no per-user state, biggest
   visible impact, easiest to build.
2. **Promo Codes** — wallet credits are independent of the trip flow, so this
   doesn't depend on Phase 1.
3. **Coupons** — heaviest UX work; depends on Phase 1's discount-on-trip
   plumbing.
4. **Referrals** — built last, because the reward it pays out *is* a coupon
   from Phase 3.
