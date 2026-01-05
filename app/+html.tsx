import { ScrollViewStyleReset } from 'expo-router/html';

// This file is web-only and used to configure the root HTML for every
// web page during static rendering.
// The contents of this function only run in Node.js environments and
// do not have access to the DOM or browser APIs.
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        {/* Open Graph / iMessage preview */}
        <meta property="og:title" content="Outstocked" />
        <meta property="og:description" content="Inventory management made simple" />
        <meta property="og:image" content="https://outstocked.vercel.app/og-image.png" />
        <meta property="og:image:width" content="2816" />
        <meta property="og:image:height" content="1536" />
        <meta property="og:type" content="website" />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Outstocked" />
        <meta name="twitter:description" content="Inventory management made simple" />
        <meta name="twitter:image" content="https://outstocked.vercel.app/og-image.png" />

        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
