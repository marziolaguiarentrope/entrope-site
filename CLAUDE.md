# axel-one-admin

Operator dashboard for Axel. Next.js 16, Tailwind 4, dark theme (Linear-inspired).

## Stack
- Next.js 16.1.1 with App Router
- NextAuth for Google OAuth (@helloaxel.com only)
- Proxies to staging-admin-gateway.onrender.com

## Running locally
```
npm run dev  # port 3001
```
Requires `.env.local` with: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXTAUTH_SECRET, NEXTAUTH_URL

## Deployed
- Vercel: https://axel-one-admin.vercel.app
- Repo: https://github.com/ascendtravel/axel-one-admin

## What works
- **Flight Reprice** - claim, complete with refund amount
- **Complete Booking** - dynamic form for missing fields (hotel_name, check_in_date, etc.)
- **Escalations** - list view (empty on staging)

## TODO (blocked by backend)
- **Pending Payment Hotels** - needs `GET /opportunities/hotels?payment_status=pending`
- **Pending Cancel Hotels** - needs `GET /opportunities/hotels?pending_cancellation=true`
- **Members search** - `/members/` returns 500 (users service connection)
- **Member detail** - `/members/{id}` returns 500
- **hotel_name, booking_provider** - should be dropdowns, not free text (needs reference data endpoints)

## Key files
- `app/api/proxy/[...path]/route.ts` - proxies to staging gateway
- `app/api/auth/[...nextauth]/route.ts` - Google OAuth config
- `components/task-detail.tsx` - FlightRepriceDetail, CompleteBookingDetail
- `app/(dashboard)/tasks/page.tsx` - tabs for task types
- `contexts/auth-context.tsx` - useAuth hook wrapping NextAuth
