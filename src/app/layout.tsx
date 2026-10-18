import type { Metadata } from "next";
import { QueryProvider } from "@/components/QueryProvider";

export const metadata: Metadata = {
  title: "Prime Care — Product Progress Dashboard",
  description: "Prime Care product progress dashboard",
};

// Sets data-theme before first paint so a saved Light/Dark choice doesn't flash.
const THEME_SCRIPT = `try{var t=localStorage.getItem("primecare.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
