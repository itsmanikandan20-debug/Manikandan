import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import { Navbar } from "@/components/Navbar";
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
  title: "DesignCheck",
  description: "Compare your Figma design with the live website — automatically detect UI, content, and UX issues.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} font-body`}>
        <Navbar />
        {children}
      </body>
    </html>
  );
}
