import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LabPilot Voice | Experiment workspace",
  description: "Turn scientific observations into structured, queryable experiment data.",
  openGraph: {
    title: "LabPilot Voice",
    description: "Speech-to-schema for the wet lab.",
    images: [{ url: "/og.png", width: 1732, height: 909, alt: "LabPilot Voice - Speech-to-schema for the wet lab" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "LabPilot Voice",
    description: "Speech-to-schema for the wet lab.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
