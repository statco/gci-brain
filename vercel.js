{
  "functions": {
    "api/tires.js": {
      "runtime": "nodejs20.x",
      "memory": 256,
      "maxDuration": 30 // Set to 30 seconds for complex API chain
    }
  },
  "rewrites": [
    // 1. Direct API access (http://gcitire.com/api/tires)
    {
      "source": "/api/tires",
      "destination": "/api/tires"
    },
    // 2. Catch-all: Redirects the confusing root path (/) and any other path to your API function
    {
      "source": "/(.*)",
      "destination": "/api/tires"
    }
  ]
}
