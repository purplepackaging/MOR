import "./globals.css";

export const metadata = {
  metadataBase: new URL("https://morsupply.com"),
  title: "Mor Supply",
  description:
    "Restaurant and hospitality supplies for metro Atlanta. Order online, by text or on WhatsApp. Launching soon.",
  openGraph: {
    title: "Mor Supply",
    description:
      "Restaurant and hospitality supplies for metro Atlanta. Order online, by text or on WhatsApp.",
    url: "https://morsupply.com",
    siteName: "Mor Supply",
    type: "website",
  },
};

export const viewport = {
  themeColor: "#4a1d7a",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
