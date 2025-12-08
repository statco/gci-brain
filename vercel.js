{
  "rewrites": [
    // Rule 1: Preserve all /api/* routes (like /api/tires)
    {
      "source": "/api/(.*)",
      "destination": "/api/$1"
    },
    // Rule 2: Redirect all other traffic (including the root /) to an entry point.
    // Assuming your website is served by a single file (like index.html) or a dedicated API handler.
    {
      "source": "/(.*)",
      "destination": "/" 
      // If you have a file at the root, like index.html, use: "destination": "/index.html"
    }
  ]
}
