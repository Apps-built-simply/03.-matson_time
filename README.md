# Matson Time

A private, mobile-first time-management application for Matson.

## Current starter

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
- Browser storage for development testing

## Deploy to Vercel

1. Import the GitHub repository into Vercel.
2. Add `GEMINI_API_KEY` in the Vercel Environment Variables settings.
3. Add `GEMINI_MODEL` in the Vercel Environment Variables settings.
4. Deploy.
5. The frontend calls `/api/assistant` automatically.
6. Never put the Gemini key in browser JavaScript or commit it to Git.

For local static previews, open the site with a simple static server. Deterministic Assistant questions work there; natural-language schedule requests require the deployed Vercel Function.

## Project rule

Keep the implementation focused. Add only agreed functionality, one working increment at a time.
