# EaseMyOffice — React Website

A modern, enterprise-grade marketing website for EaseMyOffice built with **React + Vite + TypeScript + Tailwind CSS + Framer Motion**. This is a **standalone project**, separate from the existing WordPress site.

## Tech Stack

- React 18 + TypeScript
- Vite 5 (build tooling)
- Tailwind CSS 3 (styling)
- Framer Motion (animations)
- React Router (routing)
- React Hook Form (forms)
- Lucide React (icons)

## Getting Started

```bash
npm install      # install dependencies
npm run dev      # start dev server at http://localhost:3000
npm run build    # production build -> dist/
npm run preview  # preview the production build
```

## Project Structure

```
src/
├── main.tsx                  App bootstrap + router + toasts
├── App.tsx                   Routes + layout
├── index.css                 Tailwind layers + design system
├── components/
│   ├── Navbar.tsx            Sticky glass navbar w/ dropdowns
│   ├── HeroSection.tsx       Hero (default / virtual-office / coworking variants)
│   ├── ServicesSection.tsx   Services + "why choose us"
│   ├── TestimonialsSection.tsx  Testimonial carousel + stats
│   ├── ContactSection.tsx    Validated contact form
│   ├── Footer.tsx            Footer w/ links, newsletter, trust badges
│   ├── LoadingScreen.tsx     Branded loader
│   ├── ScrollToTop.tsx       Scroll reset on route change
│   └── PageWrapper.tsx       Page fade transitions
└── pages/
    ├── HomePage.tsx
    ├── VirtualOfficePage.tsx  (with pricing plans)
    ├── CoworkingPage.tsx
    ├── ServicesPage.tsx
    └── ContactPage.tsx
```

## Deploying to Cloudflare Pages

Create a **new** Pages project (separate from your existing site) and connect this branch:

- **Framework preset:** Vite
- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Node version:** 18+ (set `NODE_VERSION=18` env var if needed)

Cloudflare will give you a live preview URL (e.g. `your-project.pages.dev`).
