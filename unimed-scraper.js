const puppeteer = require('puppeteer');
const fs = require('fs');

// Read and parse the product links from productsLink.json
const productLinksData = fs.readFileSync('product_links/product_data.json', 'utf-8');
const productLinks = JSON.parse(productLinksData); // This assumes productsLink.json is an array of objects like [{ "product_link": "https://example.com" }, {...}]

// Function to scrape a single product page
async function scrapeProduct(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2' }); // Wait for the page to load

    // Wait for the main content to be available
    await page.waitForSelector('.ProductMeta__Description', { timeout: 10000 });

    // Extract data from the product page
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
            data.images.push(`https:${imgSrc}`); // Prepend "https:" to construct the full URL
          }
        });

        // Extract data from all tables within the product description section
        const tables = document.querySelectorAll('.ProductMeta__Description .TableWrapper table');

        tables.forEach((table) => {
          const rows = table.querySelectorAll('tr');
          let sectionName = '';

          // Determine the section name from the first row
          if (rows.length > 0 && rows[0].querySelector('p strong')) {
            sectionName = rows[0].innerText.trim().replace(':', '').toLowerCase().replace(/ /g, '_'); // Convert section name to lowercase and snake_case

            if (sectionName.includes('oem_part_number_cross_references')) {
              sectionName = 'oem_reference';
            } else if (sectionName.includes('compatibility')) {
              sectionName = 'compatibility';
            } else if (sectionName.includes('technical_specifications')) {
              sectionName = 'technical_specifications';
            }
          }

          // Extract table content and populate the corresponding data section
          for (let i = 1; i < rows.length; i++) {
            const cells = rows[i].querySelectorAll('td');
            if (cells.length === 2) { // Only consider rows with two cells
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
    console.error(`Error scraping ${url}: ${error.message}`);
    return null; // Return null if there's an error to indicate failure
  }
}

// Main function to scrape all products and save to JSON
(async () => {
  const browser = await puppeteer.launch({ headless: true }); // Set to false to see the browser in action
  const page = await browser.newPage();
  const scrapedData = [];
  const failedLinks = []; // Array to store failed links

  // Get the current date in YYYY-MM-DD format
  const currentDate = new Date().toISOString().split('T')[0]; // This formats the date as YYYY-MM-DD

  for (let product of productLinks) {
    const url = product.product_link;
    console.log(`Scraping: ${url}`);
    try {
      const data = await scrapeProduct(page, url);
      if (data) {
        scrapedData.push({ url, data });
      } else {
        console.log(`Scraping failed for ${url}`);
        failedLinks.push(url); // Log the failed URL
      }
    } catch (error) {
      console.error(`Failed to scrape ${url}: ${error.message}`);
      failedLinks.push(url); // Log the failed URL
    }
  }

  await browser.close();

  // Save all scraped data to a JSON file with the current date in the filename
  fs.writeFileSync(`results/products_${currentDate}.json`, JSON.stringify(scrapedData, null, 2), 'utf-8');
  console.log(`Scraped data saved to products_${currentDate}.json`);

  // Save all failed links to a separate JSON file with the current date in the filename
  if (failedLinks.length > 0) {
    fs.writeFileSync(`failed/failed_links_${currentDate}.json`, JSON.stringify(failedLinks, null, 2), 'utf-8');
    console.log(`Failed links saved to failed_links_${currentDate}.json`);
  } else {
    console.log('No failed links to save.');
  }
})();
