# Cam Studio account and pairing release verification

Validated 20 October 2026. Production: https://campoc.onrender.com.

| Requirement | Evidence |
| --- | --- |
| Google login/signup, all accounts | External/In production observed in Google; real Google login returned to Studio; first-login account persisted through Atlas. No email allowlist; integration test verifies a second Google subject. |
| Server gate and logout | Anonymous root/index/studio redirect tested; production root 303 to login; production logout and reopening root returned to login. |
| MongoDB Atlas instead of PostgreSQL | Native Mongo driver; unique user/code/media room indexes, TTL and explicit expiry checks. Render successfully created OAuth state, account/session and pairing records. |
| Ownership, collision protection, password | Mongo integration tests exercise two account identities, unique collision rejection, scrypt checks, encrypted owner password restoration, atomic receiver claim and owner locks. |
| No long media JWT in invitation | QR/invitation includes code/password/origin; revocable lease obtained via HTTPS; media JWT limited to 120 seconds and private media room. Existing signed tokens cannot reach newly created rooms. |
| Replace/cancel/connected lifecycle | Integration and UI race tests; production replace changed code; cancel unused room retained preview; real OPPO connected room survived modal close. |
| Preview independent of pairing | Production auto-preview with granted permission; button available before first grant; tests verify preview does not create/publish room. |
| USB without QR/modal | Production selecting USB opened source and published directly; CamPOC USB receiver observed 1080×1920. Old local relay was restarted with new API; switching to Cloud then succeeded. Relay restart recovery tested. |
| Requested UI removal | index.html has only source/device/quality/connection controls; no media library, crop/rotate/zoom/reset, revoke, permissions or component demos; Cloud code/password and compact copy actions retained. |
| Redis when useful | Implemented rate-limit accelerator and 1.5s presence cache with authoritative Mongo fallback; real local redis-server test covers outage. Production REDIS_URL not set; Redis is not claimed to run in cloud or increase FPS. |
| Android delivery | Both controller and Browser LSPatch APK installed successfully on OPPO CPH2025. Embedded module hash matches standalone; original Browser APK and signer preserved. Hook architecture unchanged. |
| Cloud clarity/smoothness improvement | Changed from multi-layer simulcast to single H.264 encoding and source-frame canvas callbacks. Prior Browser log showed 180×320 input; new log showed 1080×1920 input. Browser camera-check completed 881 callbacks/30.00 seconds = 29.36 callback/s, actual video 480×640 for its 640×480 Camera2 request. |
| USB Browser boundary | Same camera-check completed 447 callbacks/30.00 seconds = 14.90 callback/s. Source was 1080×1920. Web sending ~29.4 fps is not Browser output FPS. |
| Verification suite | 52 Node tests passed; 7 USB HTTP tests passed; Android two flavors/harness builds, unit tests and lint passed. |

## Limits

- Physical camera scanning of a QR was not tested; the invitation payload was dispatched through the Android deep link and connected on the real device. Room/password verification itself was exercised by server tests and this invitation flow. The separate manual-entry UI attempt was interrupted by device interaction.
- No aligned before/after raw frame comparison, PSNR or end-to-end latency measurement was performed. Resolution and callback counts do not prove zero delay, perceptual sharpness or a stable rate on all networks.
- Browser's earlier cold attempt timed out. Subsequent complete USB and Cloud measurements succeeded; no universal camera/profile compatibility claim is made.
- Production Google testing used one account; account isolation and arbitrary verified Google registration were tested using two identities against real local MongoDB.
