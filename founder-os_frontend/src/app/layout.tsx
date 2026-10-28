import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import PwaRegister from "@/components/PwaRegister";
import { DEFAULT_THEME, LIGHT_THEME_IDS, THEME_IDS } from "@/theme/presets";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brindavan Udyog India",
  description: "Brindavan Udyog India — executive assistant: WhatsApp, Zoho estimates, CRM, dashboards and team chat.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
    shortcut: "/icons/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Brindavan Udyog India",
  },
  themeColor: "#f6f7f2",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const THEME_BOOTSTRAP = `(function(){try{
var ids=${JSON.stringify(THEME_IDS)};
var light=${JSON.stringify(LIGHT_THEME_IDS)};
var t=localStorage.getItem('app_theme_v2');
if(!t){var v1=localStorage.getItem('app_theme_v1');if(v1&&v1!=='classic')t=v1;}
if(!t&&localStorage.getItem('theme')==='light')t='light';
if(!t&&localStorage.getItem('theme')==='dark')t='classic';
if(ids.indexOf(t)<0)t=${JSON.stringify(DEFAULT_THEME)};
var d=document.documentElement;
d.setAttribute('data-app-theme',t);
d.classList.toggle('dark',light.indexOf(t)<0);
var a=localStorage.getItem('app_accent_v1');
if(a&&/^#[0-9a-fA-F]{6}$/.test(a))d.style.setProperty('--color-brand-indigo',a);
}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
