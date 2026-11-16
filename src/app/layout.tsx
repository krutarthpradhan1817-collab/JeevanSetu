import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "जीवनSetu · Intelligence that finds a way",
  description:
    "Emergency ambulance routing for Gujarat with live traffic, road disruptions, hospital suitability and dynamic re-routing.",
};

const NAV = [
  { href: "/patient", label: "Patient" },
  { href: "/driver", label: "Driver" },
  { href: "/admin", label: "Admin" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-red-600 text-sm font-black text-white">
                जी
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-bold tracking-wide text-slate-100">जीवनSetu</span>
                <span className="block text-[11px] italic tracking-wide text-sky-300">Intelligence that finds a way</span>
              </span>
            </Link>
            <nav className="ml-auto flex items-center gap-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-300 transition hover:bg-slate-800/70 hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
              <Link href="/patient" className="btn btn-primary btn-sm ml-1">
                Emergency
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-8 pt-4 text-[11px] leading-relaxed text-slate-500">
          जीवनSetu · Demonstration build for Gujarat. Hospitals, ambulances, drivers, road network and disruptions are
          clearly-labelled demo data — no live bed availability, government feed or real vehicle telemetry is used.
        </footer>
      </body>
    </html>
  );
}
