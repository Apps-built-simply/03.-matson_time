# Matson Time

A private, mobile-first time-management application for Matson.

## Firebase setup

Matson Time uses the existing Firebase project `matson-time` with Email/Password sign-in and the default Cloud Firestore database. The published Firestore security rules must restrict each signed-in user to `users/{matchingUserId}/...`. Authorize the production Vercel domain and `localhost` in Firebase Authentication.

The browser initializes only Firebase App, Authentication, and Firestore through the modular Web SDK. `js/firebase-config.js` contains the Firebase web app configuration. That configuration is public client configuration; it is not an authentication secret. The Gemini API key remains only in Vercel environment variables and must never be placed in browser code. Never commit Matson’s password or Gemini secrets.

Firestore is the source of truth for schedule items, categories, Assistant state, conversations, and memories. On first sign-in, a user-specific migration marker triggers a one-time import of any existing local schedule and Assistant history. Local data is retained temporarily as recovery data and is no longer used as the active schedule database.

User data is stored beneath `users/{userId}` in `scheduleItems`, `categories`, `conversations` (with nested `messages`), `memories`, and `assistantState/current`. Conversation summaries and keywords support compact recall; only matching summaries, a few relevant messages, and active memories are sent to the Vercel Assistant Function. Memories can be created and searched through the Firebase data module; the app does not automatically extract memories from messages.

## Current application

This first working build includes:

- The agreed color system as reusable CSS variables
- A mobile app shell
- Today view
- Current/next item emphasis
- Daily progress summary
- Scheduled activities and untimed tasks
- A working Add Item form
- Working status update and quick postponement actions
- Simple schedule conflict warnings
- Firebase Authentication and Cloud Firestore persistence

## Deploy to Vercel

1. Import the GitHub repository into Vercel.
2. Add `GEMINI_API_KEY` in the Vercel Environment Variables settings.
3. Add `GEMINI_MODEL` in the Vercel Environment Variables settings.
4. Deploy.
5. The frontend calls `/api/assistant` automatically.
6. Never put the Gemini key in browser JavaScript or commit it to Git.

Serve the app from localhost or the authorized Vercel domain so browser module imports and Firebase Authentication work. Natural-language schedule requests use the deployed Vercel Function.

## Project rule

Keep the implementation focused. Add only agreed functionality, one working increment at a time.
