import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "@/ui/styles.css";
import "./globals.css";
import { TIER_SCRIPT } from "@/lib/text-tier";
import { LENS_SCRIPT, LensDefs } from "@/components/lens";

// Bricolage Grotesque, variable: weight 200–800 plus the optical-size and width axes.
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  axes: ["opsz", "wdth"],
  display: "swap",
});
const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Alice Home", template: "%s · Alice" },
  description: "Alice: a calm, plain-spoken home for your smart home.",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
};

// Dev only (`./setup.sh --virtual-passkey`): a software passkey stored in this browser, for machines whose browser
// cannot reach a real authenticator. Never loaded in a production build.
const VIRTUAL_PASSKEY = process.env.NEXT_PUBLIC_VIRTUAL_PASSKEY === "1" && process.env.NODE_ENV !== "production";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${bricolage.variable} ${instrument.variable} ${jetbrains.variable}`}>
      <head>{VIRTUAL_PASSKEY && <script src="/dev/virtual-passkey.js" />}<script dangerouslySetInnerHTML={{ __html: TIER_SCRIPT }} /><script dangerouslySetInnerHTML={{ __html: LENS_SCRIPT }} /></head>
      <body>
        <LensDefs />
        <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
