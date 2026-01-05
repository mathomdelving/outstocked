const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'dist', 'index.html');

const metaTags = `
    <!-- Open Graph / Facebook / iMessage -->
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://outstocked.vercel.app/" />
    <meta property="og:title" content="Outstocked" />
    <meta property="og:description" content="Inventory management made simple" />
    <meta property="og:image" content="https://outstocked.vercel.app/og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:site_name" content="Outstocked" />

    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:url" content="https://outstocked.vercel.app/" />
    <meta name="twitter:title" content="Outstocked" />
    <meta name="twitter:description" content="Inventory management made simple" />
    <meta name="twitter:image" content="https://outstocked.vercel.app/og-image.png" />

    <meta name="description" content="Inventory management made simple" />
`;

try {
  let html = fs.readFileSync(indexPath, 'utf8');

  // Inject meta tags after the <title> tag
  html = html.replace(
    /<title>([^<]*)<\/title>/,
    `<title>$1</title>${metaTags}`
  );

  fs.writeFileSync(indexPath, html);
  console.log('Meta tags injected successfully!');
} catch (error) {
  console.error('Error injecting meta tags:', error);
  process.exit(1);
}
