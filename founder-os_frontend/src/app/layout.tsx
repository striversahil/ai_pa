import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import PwaRegister from "@/components/PwaRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brindavan Udyog (India) - B2B Enquiry Tracker",
  description: "Industrial grain milling accessories and bag closing machine enquiry tracking panel.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
    shortcut: "/icons/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Founder OS",
  },
  themeColor: "#6366f1",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const THEME_BOOTSTRAP = `(function(){try{
var t=localStorage.getItem('app_theme_v1');
if(!t&&localStorage.getItem('theme')==='light')t='light';
if(t!=='classic'&&t!=='light'&&t!=='discord'&&t!=='amoled'&&t!=='nord')t='classic';
var d=document.documentElement;
d.setAttribute('data-app-theme',t);
d.classList.toggle('dark',t!=='light');
var a=localStorage.getItem('app_accent_v1');
if(a&&/^#[0-9a-fA-F]{6}$/.test(a)){
 var m=/^#?([a-f\\d]{2})([a-f\\d]{2})([a-f\\d]{2})$/i.exec(a);
 var r=parseInt(m[1],16)/255,g=parseInt(m[2],16)/255,b=parseInt(m[3],16)/255;
 var mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2,s=l>0.5?(mx-mn)/(2-mx-mn):(mx-mn)/(mx+mn),h=0;
 if(mx!==mn){var dd=mx-mn;h=mx===r?(((g-b)/dd+(g<b?6:0))/6):mx===g?(((b-r)/dd+2)/6):(((r-g)/dd+4)/6);}
 h=Math.round(h*360);s=Math.round(s*100);l=Math.round(l*100);
 var sat=Math.max(45,s)/100,lig=l/100,aa=sat*Math.min(lig,1-lig);
 var f=function(n){return lig-aa*Math.max(-1,Math.min((n+h/30)%12-3,Math.min(9-(n+h/30)%12,1)));};
 var to=function(x){return Math.round(255*x).toString(16).padStart(2,'0');};
 var sh=function(dl){var ll=Math.min(96,Math.max(6,l+dl))/100;var a2=sat*Math.min(ll,1-ll);var f2=function(n){var k=(n+h/30)%12;return ll-a2*Math.max(-1,Math.min(k-3,Math.min(9-k,1)));};return '#'+to(f2(0))+to(f2(8))+to(f2(4));};
 var st=d.style;
 st.setProperty('--color-brand-indigo',a);
 st.setProperty('--color-indigo-300',sh(24));
 st.setProperty('--color-indigo-400',sh(14));
 st.setProperty('--color-indigo-500',sh(6));
 st.setProperty('--color-indigo-600',a);
 st.setProperty('--color-indigo-650',sh(-6));
 st.setProperty('--color-indigo-700',sh(-12));
 st.setProperty('--ring-color','rgba('+Math.round(255*f(0))+','+Math.round(255*f(8))+','+Math.round(255*f(4))+', 0.45)');
}
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
