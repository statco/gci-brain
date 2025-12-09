// vercel.json

{
  "functions": {
    "tires.js": {
      "runtime": "nodejs20.x",
      "memory": 256,
      "maxDuration": 30
    }
  },
  "rewrites": [
    // Route 1: Maps the base domain (/) to your tires function
    {
      "source": "/",
      "destination": "/tires" 
    },
    // Route 2: Maps any other path (like /anything) to your tires function
    {
      "source": "/(.*)",
      "destination": "/tires" 
    }
  ]
}
