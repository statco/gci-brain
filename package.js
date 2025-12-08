{
  "name": "gci-brain",
  "version": "1.0.0",
  "description": "GCI Consensus Engine for Tire Recommendations and Fitment Verification.",
  "main": "api/tires.js",
  "scripts": {
    "start": "node api/tires.js",
    "deploy": "vercel deploy --prod"
  },
  "keywords": [
    "vercel",
    "serverless",
    "node",
    "fetch",
    "api"
  ],
  "author": "statco",
  "license": "ISC",
  "dependencies": {
    "node-fetch": "3.3.2"
  },
  "engines": {
    "node": "20.x"
  }
}
