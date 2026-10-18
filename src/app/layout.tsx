import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Lexend, Merriweather } from "next/font/google";
import { QueryProvider } from "@/components/QueryProvider";

export const metadata: Metadata = {
  title: "Prime Care — Product Progress Dashboard",
  description: "Prime Care product progress dashboard",
};

// Fonts load once, here, as CSS variables on <html> (portals render outside any page wrapper). The role tokens
// (--font-display / -heading / -body / -mono) are defined in src/app/v2/v2.css; v1 does not use them.
const display = Merriweather({ subsets: ["latin"], weight: ["700", "900"], variable: "--nf-display", display: "swap" });
const heading = Lexend({ subsets: ["latin"], weight: ["500", "600"], variable: "--nf-heading", display: "swap" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--nf-body", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--nf-mono", display: "swap" });
const FONT_VARS = [display, heading, body, mono].map((f) => f.variable).join(" ");

// Sets data-theme before first paint so a saved Light/Dark choice doesn't flash.
const THEME_SCRIPT = `try{var t=localStorage.getItem("primecare.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={FONT_VARS}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
