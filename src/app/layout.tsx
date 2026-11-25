import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0f52ba",
  colorScheme: "light dark",
};

export const metadata: Metadata = {
  title: "DeskMath | Quant Mental Math Studio",
  description:
    "Full-stack quant trader mental math trainer on Google Cloud with Visual and Voice modes, reaction-time telemetry, mistake diagnosis, and Gemini strategy coaching.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "DeskMath",
  },
  icons: {
    icon: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
};

const themeInitScript = `
try {
  var s = localStorage.getItem('color-scheme');
  if (s === 'light' || s === 'dark') {
    var m = document.querySelector('meta[name="color-scheme"]');
    if (m) m.setAttribute('content', s);
  }
} catch (e) {}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
