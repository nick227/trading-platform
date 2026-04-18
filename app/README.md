# Lumantic

Trading-focused React dashboard built with Vite.  
The app currently runs on client-side mock data with a clean boundary for API client replacement later.

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![Status](https://img.shields.io/badge/Status-Mock%20API-orange)

## Tech Stack

- React 18
- Vite 5
- React Router
- Chart.js + `react-chartjs-2`
- Modular CSS files with shared design tokens

## Features

- Landing and navigation shell
- Portfolio and asset views
- Bot center and confirmations
- Orders and confirmations
- Profile management:
  - Change username
  - Reset password (mock flow)
  - Save and test Alpaca API key (mock client)
- Auth screen (mock login/register behavior)

## Getting Started

### Prerequisites

- Node.js 18+ (recommended)
- npm

### Install

```bash
npm install
```

### Run Development Server

```bash
npm run dev
```

By default, Vite prints the local dev URL in the terminal.

## Available Scripts

- `npm run dev` - Start the Vite development server

## Project Structure

```text
src/
  api/          client-side API modules (mock-backed)
  app/          app providers and routing shell
  components/   shared UI components
  features/     screen/page-level features
  mock/         mock data fixtures
  styles/       tokens and global feature styles
```

## Routing

Main routes are defined in `src/app/AppShell.jsx`:

- `/` landing
- `/portfolio`
- `/assets/:ticker`
- `/bots`
- `/orders`
- `/profile`
- `/auth` (`/login` and `/register` redirect into auth flow)

## Notes

- This project currently uses mock data and client-side API clients.
- The profile API logic is organized under `src/api/profileClient.js` for easy migration to real backend calls.

