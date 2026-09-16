# DREAMCABS
## Phase 2 — Client Scope Overview

For Uzair Hameed Zargar | Prepared by Taha Mubashir Masoodi

**For review and approval.** This overview explains the proposed features and approach. It supports the Phase 2 Agreement and does not replace it. Modules 1, 2, 3 and 5 are included; the complete app redesign is excluded.

### Module 1 — Ride Operations and Tracking | Included

**Purpose and delivery:** Improve ride handling through the existing apps and Admin Dashboard: driver alerts, accept/reject and unanswered-request handling; passenger names and booked seats; driver cancellation before boarding and ride-status updates; admin cancellation, boarding, verification-code and ride-status controls.

Add admin-managed vehicle symbols, direction and availability/status on the live map. Recorded location history will support route playback and time filtering, with stop, idle and distance details where available. Check existing SMS/verification compatibility.

**Booking order:** Select ride/seat → Driver accepts → Payment → Booking confirmed.

**Limits:** History depends on recorded data. The history period and detailed ride rules need confirmation; extra workflows require agreement.

### Module 2 — Company Travel Accounts | Included

**Purpose and delivery:** Give companies one place to manage employee travel. Add company activation/status, access permissions, credit limits, employee linking and spending/ride controls. A company dashboard will show rides, credit usage and monthly expenditure.

Support Private, Shuttle, Fixed and Scheduled company bookings. Record rides against company credit and provide monthly PDF invoices/statements, employee trip details, payment status and required tax fields.

**Limits:** Payroll/accounting software connections and additional approval workflows are excluded. DreamCabs must confirm company permissions, credit and billing rules.

### Module 3 — AI Voice Booking | Included

**Purpose and delivery:** Understand spoken English or Hindi requests, extract pickup/destination and ask for missing details. Connect speech and AI services to existing routes, fares and vehicle choices. Show a summary and require customer confirmation. The proposed technical approach is on the next page.

**Limits:** No telephone booking agent, continuous spoken conversation, custom AI training or additional languages. Accuracy varies with accents, noise and connectivity.

### Module 4 — Complete App Redesign | Excluded

**Future idea:** Refresh Passenger and Driver screens, navigation and overall appearance through a separately approved redesign. Current work includes the screens needed for included features; it does not include a complete visual overhaul.

### Module 5 — Testing and Release Support | Included

**Purpose and delivery:** Test included features across the apps, Admin and company dashboards; check booking, payments, SMS/verification and AI; test Android/iOS where applicable; review relevant performance and security. Support client testing, fixes, production deployment, store submission and handover.

**Limits:** Redesign testing and new features are excluded. Apple and Google decide store approval.

**Existing foundation:** Continue existing branding, app icons, splash screens and in-app legal pages. New branding and unrelated promotional artwork are excluded.

<!-- pagebreak -->

## AI Approach and Supporting Services

### How the AI will be implemented

**Short voice recording → Speech converted to text → AI extracts journey details → DreamCabs checks locations and booking rules → Existing booking system.**

The app will record audio; the existing Laravel backend—the system behind the apps—will manage speech and AI processing. Separate, replaceable connections will let providers change without redesigning the booking feature. Provider changes still need integration checks and testing.

AI will return organised journey details. DreamCabs will verify them and supply actual fares, seats and availability. Missing or unclear information will prompt clarification. Customer confirmation, driver acceptance and payment rules remain in place. Standard booking stays available if voice processing fails.

### Proposed tools and services

- **Recording:** [capacitor-voice-recorder](https://github.com/tchvu3/capacitor-voice-recorder), subject to checks with the app's Android/iOS versions. It captures microphone audio with customer permission. Use short, compressed recordings; formats vary by device and will be converted on the server when required.
- **Speech to text:** [OpenAI Whisper API (whisper-1)](https://developers.openai.com/api/docs/guides/speech-to-text) to transcribe requests. English, Hindi, mixed phrasing and local place names will be tested before release.
- **Understanding the request:** [OpenAI GPT-4o-mini](https://developers.openai.com/api/docs/models/gpt-4o-mini) to extract pickup, destination and other stated details in a consistent format. DreamCabs will check the content before using it.
- **Finding places:** Match against DreamCabs' supported places and common spelling variations first. Use [Google Places](https://developers.google.com/maps/documentation/places/web-service/text-search) where broader address lookup is needed and approved. Meilisearch may be considered if the internal place list needs more advanced search; it is not a required extra service.
- **Existing services:** Continue the current maps/tracking, payment, SMS/verification, notifications, hosting and storage setup where suitable. Use Google Play and the Apple App Store where applicable.

These are proposed selections, not a commitment to integrate every alternative. Deepgram is a possible speech alternative; a supported Claude model is a possible AI alternative. Final choices depend on compatibility and testing with DreamCabs requests.

### Flexibility and future service changes

The technical approach is a rough proposal. Service choices and processing details may differ slightly after review and testing while preserving the agreed features. Short recordings, limited retries and usage controls will keep processing efficient; service credentials will remain on the server.

Provider replacements will be reviewed separately from module changes. DreamCabs will approve relevant accounts, access and any replacement affecting its services or data. Additional integrations or material scope changes require separate agreement. External services may change or stop; maintenance may still be needed.

### Items for DreamCabs to confirm

- Location-history period: four hours, six hours or another agreed period.
- Ride-request, cancellation and boarding rules; company permissions, credit and invoice details.
- Proposed service selections and required account access.

**Approval confirms the feature scope described here. The Phase 2 Agreement remains the governing document.**