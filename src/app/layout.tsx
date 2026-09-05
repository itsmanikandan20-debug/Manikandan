import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import { Sidebar } from "@/components/Sidebar";
import "./globals.css";

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Design Similarity Finder",
  description:
    "Upload a Figma screenshot and discover live websites with a similar layout, colour palette, typography, and visual style.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} font-body`}>
        <Sidebar />
        <div className="lg:pl-64">{children}</div>
      </body>
    </html>
  );
}
