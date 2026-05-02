# Image Map — How to Add Tire Images

`scripts/image-map.csv` is the source of truth for product images.
`backfillImages.ts` reads it and attaches images to Shopify products that have none.

## CSV format

```
brand,model,imageUrl
Cooper,CS5 Ultra Touring,https://example.com/cs5-ultra-touring.jpg
```

| Column     | Description                                         |
|------------|-----------------------------------------------------|
| `brand`    | Brand name as it appears in Shopify product titles  |
| `model`    | Model name substring (partial match is fine)        |
| `imageUrl` | Direct URL to a publicly accessible image file      |

The script does a **case-insensitive substring match** on the Shopify product title.
A product matches a row if its title contains both `brand` AND `model`.
The first matching row wins, so put more specific models before generic ones.

## How to find image URLs

1. Go to the manufacturer's website and navigate to the product page.
2. Right-click the main product/hero image → **Copy image address**.
3. Paste the URL into a new browser tab — confirm the image loads directly.
4. Add a row to `image-map.csv`.

### Manufacturer sites

| Brand      | Product pages                                |
|------------|----------------------------------------------|
| Cooper     | https://www.cooper-tires.com/tires           |
| Nexen      | https://www.nexentire.com/en/products        |
| Vredestein | https://www.vredestein.com/en-us/tyres       |
| Maxtrek    | https://www.maxtrekinternational.com         |
| Minerva    | https://www.minervatires.com/tyres           |
| Ovation    | https://www.ovationtire.com/products         |
| Starfire   | https://www.starfiretires.com/tires          |
| Kenda      | https://www.kendatire.com/en/passenger-tires |

## Verifying URLs

Before committing, confirm each URL returns a real image:

```bash
curl -I "https://your-url-here.jpg"
# Look for: Content-Type: image/jpeg  and  HTTP/2 200
```

The script also probes every URL with a HEAD request and skips any that fail.

## Running the script

```bash
# See which products would be matched (no changes made)
npx tsx scripts/backfillImages.ts

# Attach images to matched products
npx tsx scripts/backfillImages.ts --confirm

# Test with only the first 10 products
npx tsx scripts/backfillImages.ts --limit=10
```

After a dry run, check `scripts/image-backfill-results.json` — the
"Unmatched sample" printed at the end shows which product titles have no CSV row yet.
Use those titles to guide which models to add next.

## Workflow — adding a new brand

1. Run a dry run to see all unmatched titles for that brand.
2. Visit the manufacturer site and find direct image URLs for each model.
3. Add rows to `image-map.csv` (one row per model).
4. Verify URLs with `curl -I`.
5. Commit `image-map.csv`.
6. Run `npx tsx scripts/backfillImages.ts --confirm`.
