# دعوات (Da'awat) — Digital Invitations Platform

## Overview
An Arabic (RTL) e-invitations platform where users create and manage digital
invitations for weddings, engagements, birthdays, graduations, meetings, and
general events. Two roles: regular users (create/manage their own
invitations) and admins (platform oversight). Visual identity is a luxury
black (#121212) + gold (#D4AF37) theme with the Cairo font.

## Architecture
- **`artifacts/invites`** (previewPath `/`) — the single React + Vite web app
  hosting the entire product: marketing home, auth, dashboard, event
  (invitation) CRUD wizard, guest/RSVP management, public invitation pages,
  subscription page, and admin dashboard.
- **No backend server** — the frontend talks directly to Supabase
  (Auth + Postgres/RLS + Storage). The former Express `api-server` artifact
  and `lib/*` codegen packages were removed during the Supabase migration
  (July 2026).
- **`artifacts/mockup-sandbox`** — Canvas component preview server (not part
  of the product itself).
- **Auth**: Supabase Auth (email/password). `src/lib/auth.tsx` provides
  AuthProvider/useAuth; auth pages live in `src/pages/auth/`. A DB trigger
  auto-creates a `profiles` row on signup (role `user`, free plan, 3-event
  limit); admins are promoted via SQL.
- **DB**: Supabase Postgres. Schema + RLS + triggers + RPCs live in
  `supabase/schema.sql` (run in the Supabase SQL Editor). Tables: `profiles`,
  `templates`, `events`, `guests`; view `events_with_counts`. Public
  invitation view + RSVP go through security-definer RPCs
  (`get_public_invitation`, `submit_rsvp`). Notifications/dashboard summary
  are computed client-side in `src/lib/api.ts` (which preserves the old
  generated-client hook names/signatures).
- **Storage**: Supabase Storage buckets `event-images`, `event-audios`
  (users upload into their own `auth.uid()/` folder; public read so
  unauthenticated guests can view invitation media) and `template-images`
  (admin-only writes). `useUpload` returns the full public URL as
  `objectPath`.
- **Public invitation pages** are addressed by an unguessable `share_slug`
  (generated client-side) at `/invite/{slug}`.
- **Subscriptions** are data-model-only for the MVP (free plan = 3-event
  limit, paid plan = unlimited) — no real payment gateway integrated.

## User preferences
None recorded yet beyond the initial spec (Arabic RTL, black/gold luxury
aesthetic, Cairo font).
