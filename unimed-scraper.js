const puppeteer = require('puppeteer');
const fs = require('fs');

// Read and parse the product links from productsLink.json
const productLinksData = fs.readFileSync('product_links/product_data.json', 'utf-8');
const productLinks = JSON.parse(productLinksData); // Assumes an array of objects like [{ "product_link": "https://example.com" }, {...}]

const BATCH_SIZE = 50; // Restart browser every 50 scrapes
const RETRY_LIMIT = 3; // Number of retries per URL
const DELAY_MS = 2000; // Delay between requests (2 sec)

// Function to delay execution
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to launch a Puppeteer browser with stealth-like settings
async function launchBrowser() {
  return await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });
}

// Function to scrape a single product page
async function scrapeProduct(page, url) {
  let attempts = 0;
  while (attempts < RETRY_LIMIT) {
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 }); // 30 sec timeout
      await page.waitForSelector('.ProductMeta__Description', { timeout: 10000 });

      const productData = await page.evaluate(() => {
        const data = {
          product_name: '',
          part_number: '',
          images: [],
          oem_reference: {},
          compatibility: {},
          technical_specifications: {},
        };

        try {
          // Extract product name
          const productNameElement = document.querySelector('h1.ProductMeta__Title');
          if (productNameElement) {
            data.product_name = productNameElement.innerText.trim();
          }

          // Extract part number
          const partNumberElement = document.querySelector('span.ProductMeta__SkuNumber');
          if (partNumberElement) {
            data.part_number = partNumberElement.innerText.trim();
          }

          // Extract images
          const imageElements = document.querySelectorAll('.Product__Slideshow img[data-original-src]');
          imageElements.forEach((img) => {
            const imgSrc = img.getAttribute('data-original-src');
            if (imgSrc) {
              data.images.push(`https:${imgSrc}`);
            }
          });

          // Extract tables in the product description
          const tables = document.querySelectorAll('.ProductMeta__Description .TableWrapper table');

          tables.forEach((table) => {
            const rows = table.querySelectorAll('tr');
            let sectionName = '';

            // Determine section name from the first row
            if (rows.length > 0 && rows[0].querySelector('p strong')) {
              sectionName = rows[0].innerText.trim().replace(':', '').toLowerCase().replace(/ /g, '_');

              if (sectionName.includes('oem_part_number_cross_references')) {
                sectionName = 'oem_reference';
              } else if (sectionName.includes('compatibility')) {
                sectionName = 'compatibility';
              } else if (sectionName.includes('technical_specifications')) {
                sectionName = 'technical_specifications';
              }
            }

            // Extract table content
            for (let i = 1; i < rows.length; i++) {
              const cells = rows[i].querySelectorAll('td');
              if (cells.length === 2) {
                const key = cells[0].innerText.trim().toLowerCase().replace(/ /g, '_');
                const value = cells[1].innerText.trim();
                if (sectionName && data[sectionName]) {
                  data[sectionName][key] = value;
                }
              }
            }
          });

        } catch (error) {
          console.error(`Error extracting data from the page: ${error.message}`);
        }

        return data;
      });

      return productData;
    } catch (error) {
      console.error(`Error scraping ${url} (Attempt ${attempts + 1}/${RETRY_LIMIT}): ${error.message}`);
      attempts++;
      await delay(2000); // Wait 2 seconds before retrying
    }
  }
  
  return null; // Return null if all retries fail
}

// Main function to scrape all products and save to JSON
(async () => {
  let browser = await launchBrowser();
  let page = await browser.newPage();

  // Use a common user agent and disable Puppeteer detection
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const scrapedData = [];
  const failedLinks = [];

  const currentDate = new Date().toISOString().split('T')[0]; // Format date as YYYY-MM-DD

  for (let i = 0; i < productLinks.length; i++) {
    if (i % BATCH_SIZE === 0 && i !== 0) {
      console.log('Restarting browser to free memory...');
      await browser.close(); // Close old instance
      browser = await launchBrowser();
      page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });
    }

    const product = productLinks[i];
    const url = product.product_link;

    console.log(`Scraping (${i + 1}/${productLinks.length}): ${url}`);

    try {
      await delay(DELAY_MS); // Delay before scraping
      const data = await scrapeProduct(page, url);
      if (data) {
        scrapedData.push({ url, data });
      } else {
        console.log(`Scraping failed for ${url}`);
        failedLinks.push(url);
      }
    } catch (error) {
      console.error(`Failed to scrape ${url}: ${error.message}`);
      failedLinks.push(url);
    }
  }

  await browser.close();

  // Save all scraped data
  fs.writeFileSync(`results/products_${currentDate}.json`, JSON.stringify(scrapedData, null, 2), 'utf-8');
  console.log(`Scraped data saved to results/products_${currentDate}.json`);

  // Save failed links
  if (failedLinks.length > 0) {
    fs.writeFileSync(`failed/failed_links_${currentDate}.json`, JSON.stringify(failedLinks, null, 2), 'utf-8');
    console.log(`Failed links saved to failed/failed_links_${currentDate}.json`);
  } else {
    console.log('No failed links to save.');
  }
})();
