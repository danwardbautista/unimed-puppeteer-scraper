const puppeteer = require('puppeteer');
const fs = require('fs');

// Format the date as YYYY-MM-DD for consistent logging and filenames
const formattedDate = new Date().toISOString().slice(0, 10);

// Function to log errors to a file with timestamps
function logErrorToFile(url, errorMessage) {
  const logEntry = `${formattedDate} - URL: ${url} - Error: ${errorMessage}\n`;
  fs.appendFileSync(`logs/image_scraping_errors_${formattedDate}.log`, logEntry, 'utf8');
}

// Read and parse the product links from product_data.json
const productLinksData = fs.readFileSync('product_links/product_data.json', 'utf-8');
const productLinks = JSON.parse(productLinksData);

// Function to scrape a single product page
async function scrapeProduct(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2' });

    // Wait for the main content to be available
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
        const productNameElement = document.querySelector('h1.ProductMeta__Title');
        if (productNameElement) {
          data.product_name = productNameElement.innerText.trim();
        }

        const partNumberElement = document.querySelector('span.ProductMeta__SkuNumber');
        if (partNumberElement) {
          data.part_number = partNumberElement.innerText.trim();
        }

        const imageUrls = new Set();
        const addValidImageUrl = (imgSrc) => {
          if (imgSrc && !imgSrc.includes('{width}')) {
            const fullUrl = imgSrc.startsWith('http') ? imgSrc : `https:${imgSrc}`;
            const urlWithoutQuery = fullUrl.split('?')[0];
            imageUrls.add(urlWithoutQuery);
          }
        };

        const primaryImages = document.querySelectorAll('.Product__Slideshow img[data-original-src]');
        primaryImages.forEach(img => {
          const imgSrc = img.getAttribute('data-original-src');
          addValidImageUrl(imgSrc);
        });

        if (imageUrls.size === 0) {
          const fallbackImages = document.querySelectorAll('.ProductGallery__Carousel img[src]');
          fallbackImages.forEach(img => {
            const imgSrc = img.getAttribute('src');
            addValidImageUrl(imgSrc);
          });
        }

        const lazyImages = document.querySelectorAll('img[data-src]');
        lazyImages.forEach(img => {
          const imgSrc = img.getAttribute('data-src');
          addValidImageUrl(imgSrc);
        });

        data.images = Array.from(imageUrls);

        const tables = document.querySelectorAll('.ProductMeta__Description .TableWrapper table');
        tables.forEach((table) => {
          const rows = table.querySelectorAll('tr');
          let sectionName = '';

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

    if (productData && productData.images.length === 0) {
      logErrorToFile(url, 'No images found for this product');
    }

    productData.scrape_date = formattedDate; // Add timestamp for each product scrape in YYYY-MM-DD format
    return productData;
  } catch (error) {
    logErrorToFile(url, `Error scraping product: ${error.message}`);
    return null;
  }
}

// Main function to scrape all products and save to JSON
(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const scrapedData = [];
  const failedLinks = [];

  for (let product of productLinks) {
    const url = product.product_link;
    console.log(`Scraping: ${url}`);
    try {
      const data = await scrapeProduct(page, url);
      if (data) {
        scrapedData.push({ url, data });
      } else {
        console.log(`Scraping failed for ${url}`);
        failedLinks.push({ url, timestamp: formattedDate }); // Add timestamp for each failed URL in YYYY-MM-DD format
      }
    } catch (error) {
      console.error(`Failed to scrape ${url}: ${error.message}`);
      failedLinks.push({ url, timestamp: formattedDate });
    }
  }

  await browser.close();

  // Save all scraped data to a JSON file with a date-stamped filename in YYYY-MM-DD format
  const resultFilename = `results/scrapedProducts_${formattedDate}.json`;
  fs.writeFileSync(resultFilename, JSON.stringify(scrapedData, null, 2), 'utf-8');
  console.log(`Scraped data saved to ${resultFilename}`);

  // Save all failed links to a separate JSON file with a date-stamped filename in YYYY-MM-DD format
  if (failedLinks.length > 0) {
    const failedFilename = `failed/failedLinks_${formattedDate}.json`;
    fs.writeFileSync(failedFilename, JSON.stringify(failedLinks, null, 2), 'utf-8');
    console.log(`Failed links saved to ${failedFilename}`);
  } else {
    console.log('No failed links to save.');
  }
})();
