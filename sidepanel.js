// Sidepanel controller for Data Extractor

let currentTabId = null;
let currentTabUrl = "";
let currentTabTitle = "";
let lastScrapedData = null;
let optimizedMarkdown = "";

// Shopify state
let currentShopifyProducts = [];

// DOM Elements
const btnSettingsToggle = document.getElementById("btn-settings-toggle");
const settingsPanel = document.getElementById("settings-panel");
const webpageTitleEl = document.getElementById("webpage-title");
const webpageUrlEl = document.getElementById("webpage-url");
const btnAutoScrape = document.getElementById("btn-auto-scrape");
const btnVisualSelect = document.getElementById("btn-visual-select");
const selectorBanner = document.getElementById("selector-banner");
const btnCancelSelector = document.getElementById("btn-cancel-selector");
const scrapeBanner = document.getElementById("scrape-banner");
const scrapeProgressText = document.getElementById("scrape-progress-text");
const btnStopScrape = document.getElementById("btn-stop-scrape");
const selectSpeed = document.getElementById("select-speed");
const paginationPromptBanner = document.getElementById("pagination-prompt-banner");
const btnPaginationContinue = document.getElementById("btn-pagination-continue");
const btnPaginationStop = document.getElementById("btn-pagination-stop");


const tabPreview = document.getElementById("tab-preview");
const tabRaw = document.getElementById("tab-raw");
const previewPanel = document.getElementById("preview-panel");
const rawPanel = document.getElementById("raw-panel");

const previewEmpty = document.getElementById("preview-empty");
const previewDataView = document.getElementById("preview-data-view");
const ytDataView = document.getElementById("youtube-specific-data");
const generalDataView = document.getElementById("general-scraped-data");

const markdownEmpty = document.getElementById("markdown-empty");
const markdownContentView = document.getElementById("markdown-content-view");
const markdownTextCode = document.getElementById("markdown-text-code");

const btnDownload = document.getElementById("btn-download");
const downloadMenu = document.getElementById("download-menu");
const btnDownloadMd = document.getElementById("btn-download-md");
const btnDownloadJson = document.getElementById("btn-download-json");
const btnCopy = document.getElementById("btn-copy");
const copyToast = document.getElementById("copy-toast");
const toastMessage = document.getElementById("toast-message");

// Shopify DOM Elements
const shopifyCatalogView = document.getElementById("shopify-catalog-view");
const shopifySearchInput = document.getElementById("shopify-search-input");
const shopifySortSelect = document.getElementById("shopify-sort-select");
const shopifyOfflineBadge = document.getElementById("shopify-offline-badge");
const offlineBadgeText = document.getElementById("offline-badge-text");
const shopifyProductGrid = document.getElementById("shopify-product-grid");

// Initialize UI
document.addEventListener("DOMContentLoaded", async () => {
  await updateActiveTabInfo();
  setupEventListeners();
  await checkAndLoadShopifyCache();
});

// Update the current active tab info card
async function updateActiveTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    currentTabId = tab.id;
    currentTabUrl = tab.url || "";
    currentTabTitle = tab.title || "";

    // Update active tab card UI
    webpageTitleEl.textContent = currentTabTitle || "Untitled Tab";
    webpageUrlEl.textContent = currentTabUrl || "No URL address";

    // Disable scraper controls on browser system pages (chrome://, edge://, etc.)
    const isRestricted = currentTabUrl.startsWith("chrome://") || 
                         currentTabUrl.startsWith("chrome-extension://") || 
                         currentTabUrl.startsWith("edge://") ||
                         currentTabUrl.startsWith("about:");
                         
    if (isRestricted) {
      btnAutoScrape.disabled = true;
      btnVisualSelect.disabled = true;
      webpageTitleEl.textContent = "System Webpage";
      webpageUrlEl.textContent = "Scraping is restricted on system pages.";
    } else {
      btnAutoScrape.disabled = false;
      btnVisualSelect.disabled = false;
    }
  } catch (error) {
    console.error("Error updating tab info:", error);
  }
}

// Track active tab changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await updateActiveTabInfo();
  resetScraperState();
  await checkAndLoadShopifyCache();
});

// Track active tab URL updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId === currentTabId && changeInfo.status === "complete") {
    await updateActiveTabInfo();
    resetScraperState();
    await checkAndLoadShopifyCache();
  }
});

// Setup event handlers
function setupEventListeners() {
  // Scraping trigger
  btnAutoScrape.addEventListener("click", triggerAutoScrape);
  
  // Point-and-click Selector trigger
  btnVisualSelect.addEventListener("click", toggleVisualSelector);
  btnCancelSelector.addEventListener("click", cancelVisualSelector);
  
  // Stop Scraping trigger
  btnStopScrape.addEventListener("click", stopAutoScrape);

  // Pagination prompt trigger
  btnPaginationContinue.addEventListener("click", handlePaginationContinue);
  btnPaginationStop.addEventListener("click", handlePaginationStop);

  // Tab switching
  tabPreview.addEventListener("click", () => switchTab("preview"));
  tabRaw.addEventListener("click", () => switchTab("raw"));

  // Action buttons
  btnDownload.addEventListener("click", (e) => {
    if (btnDownload.classList.contains("disabled") || btnDownload.disabled) return;
    e.stopPropagation();
    downloadMenu.classList.toggle("hidden");
    btnDownload.classList.toggle("active");
  });

  if (btnDownloadMd) {
    btnDownloadMd.addEventListener("click", (e) => {
      e.stopPropagation();
      downloadMarkdownFile();
      downloadMenu.classList.add("hidden");
      btnDownload.classList.remove("active");
    });
  }

  if (btnDownloadJson) {
    btnDownloadJson.addEventListener("click", (e) => {
      e.stopPropagation();
      downloadJsonFile();
      downloadMenu.classList.add("hidden");
      btnDownload.classList.remove("active");
    });
  }

  btnCopy.addEventListener("click", copyToClipboard);

  // Settings toggle click
  if (btnSettingsToggle && settingsPanel) {
    btnSettingsToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      settingsPanel.classList.toggle("hidden");
      btnSettingsToggle.classList.toggle("active");
    });
  }

  // Shopify search and sort event listeners
  if (shopifySearchInput) {
    shopifySearchInput.addEventListener("input", renderShopifyCatalog);
  }
  if (shopifySortSelect) {
    shopifySortSelect.addEventListener("change", () => {
      if (currentTabUrl) {
        const sortVal = shopifySortSelect.value;
        chrome.storage.local.set({ [`sort_${currentTabUrl}`]: sortVal }).catch(err => console.error(err));
      }
      renderShopifyCatalog();
    });
  }

  // Global click outside to close menus
  document.addEventListener("click", (e) => {
    if (settingsPanel && btnSettingsToggle) {
      if (!settingsPanel.contains(e.target) && e.target !== btnSettingsToggle && !btnSettingsToggle.contains(e.target)) {
        settingsPanel.classList.add("hidden");
        btnSettingsToggle.classList.remove("active");
      }
    }
    if (downloadMenu && btnDownload) {
      if (!downloadMenu.contains(e.target) && e.target !== btnDownload && !btnDownload.contains(e.target)) {
        downloadMenu.classList.add("hidden");
        btnDownload.classList.remove("active");
      }
    }
  });
}

// Resets sidepanel scraping results state on page change
function resetScraperState() {
  lastScrapedData = null;
  optimizedMarkdown = "";
  
  // Hide data views and show empty states
  previewDataView.classList.add("hidden");
  previewEmpty.classList.remove("hidden");
  
  markdownContentView.classList.add("hidden");
  markdownEmpty.classList.remove("hidden");
  
  // Disable actions
  btnDownload.classList.add("disabled");
  btnDownload.classList.remove("active");
  btnDownload.disabled = true;
  if (downloadMenu) downloadMenu.classList.add("hidden");
  btnCopy.classList.add("disabled");
  btnCopy.disabled = true;

  // Deactivate selector banner if open
  selectorBanner.classList.add("hidden");
  btnVisualSelect.classList.remove("active");

  // Deactivate pagination banner if open
  paginationPromptBanner.classList.add("hidden");

  // Deactivate scrape banner if open
  scrapeBanner.classList.add("hidden");
  resetScrapeButton();

  // Deactivate Shopify Catalog View
  if (shopifyCatalogView) shopifyCatalogView.classList.add("hidden");
  if (shopifyOfflineBadge) shopifyOfflineBadge.classList.add("hidden");
  if (shopifySearchInput) shopifySearchInput.value = "";
  if (shopifySortSelect) shopifySortSelect.value = "default";
  if (shopifyProductGrid) shopifyProductGrid.innerHTML = "";
  currentShopifyProducts = [];
}

// Switch tabs inside sidepanel
function switchTab(target) {
  if (target === "preview") {
    tabPreview.classList.add("active");
    tabRaw.classList.remove("active");
    previewPanel.classList.add("active");
    rawPanel.classList.remove("active");
  } else {
    tabPreview.classList.remove("active");
    tabRaw.classList.add("active");
    previewPanel.classList.remove("active");
    rawPanel.classList.add("active");
  }
}

// Communicates with content script to scrape the page automatically
async function triggerAutoScrape() {
  if (btnAutoScrape.disabled) return;

  // Make sure visual selector is deactivated
  await cancelVisualSelector();

  btnAutoScrape.disabled = true;
  btnAutoScrape.textContent = "Scraping...";

  // Reset and show progress banner
  scrapeProgressText.textContent = "Initializing visual scrape walkthrough...";
  scrapeBanner.classList.remove("hidden");

  try {
    const delayVal = selectSpeed ? parseInt(selectSpeed.value, 10) : 600;
    const response = await chrome.tabs.sendMessage(currentTabId, { 
      action: "START_AUTO_SCRAPE_ANIMATION", 
      delay: delayVal 
    });
    
    if (response && response.success) {
      // The animation started successfully. We now wait for AUTO_SCRAPE_PROGRESS and AUTO_SCRAPE_COMPLETE messages.
      scrapeProgressText.textContent = `Scraping page: Found ${response.total || 0} elements.`;
    } else {
      scrapeBanner.classList.add("hidden");
      showScrapingError(response ? response.error : "Could not communicate with page script. Please reload the webpage.");
      resetScrapeButton();
    }
  } catch (error) {
    scrapeBanner.classList.add("hidden");
    showScrapingError("Please refresh the tab once to initialize the scraper plugin.");
    resetScrapeButton();
  }
}

// Reset the main scrape button UI
function resetScrapeButton() {
  btnAutoScrape.disabled = false;
  btnAutoScrape.innerHTML = `
    <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
    </svg>
    Auto Scrape Page
  `;
}

// Stop the ongoing scraping animation
async function stopAutoScrape() {
  try {
    await chrome.tabs.sendMessage(currentTabId, { action: "STOP_AUTO_SCRAPE" });
  } catch (error) {
    console.error("Error sending stop signal:", error);
  }
}

// Handle pagination decisions
async function handlePaginationContinue() {
  paginationPromptBanner.classList.add("hidden");
  scrapeProgressText.textContent = "Continuing pagination scrape...";
  scrapeBanner.classList.remove("hidden");
  try {
    await chrome.tabs.sendMessage(currentTabId, { action: "CONTINUE_PAGINATION" });
  } catch (error) {
    console.error("Error sending continue pagination signal:", error);
  }
}

async function handlePaginationStop() {
  paginationPromptBanner.classList.add("hidden");
  try {
    await chrome.tabs.sendMessage(currentTabId, { action: "STOP_PAGINATION" });
  } catch (error) {
    console.error("Error sending stop pagination signal:", error);
  }
}


// Visual Selector Mode Activators
async function toggleVisualSelector() {
  const isActivating = !btnVisualSelect.classList.contains("active");

  if (isActivating) {
    btnVisualSelect.classList.add("active");
    selectorBanner.classList.remove("hidden");
    try {
      await chrome.tabs.sendMessage(currentTabId, { action: "ACTIVATE_SELECTOR" });
    } catch (e) {
      showScrapingError("Please refresh the webpage to enable selector elements.");
      cancelVisualSelector();
    }
  } else {
    cancelVisualSelector();
  }
}

async function cancelVisualSelector() {
  btnVisualSelect.classList.remove("active");
  selectorBanner.classList.add("hidden");
  try {
    await chrome.tabs.sendMessage(currentTabId, { action: "DEACTIVATE_SELECTOR" });
  } catch (e) {}
}

// Receive visual selector and auto-scraper progress results from active webpage
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "SELECTOR_RESULT") {
    // Turn off selector mode indicators
    btnVisualSelect.classList.remove("active");
    selectorBanner.classList.add("hidden");

    // Display the single extracted element structure
    const elementData = message.data;
    displaySingleElement(elementData);
    sendResponse({ received: true });
  } else if (message.action === "AUTO_SCRAPE_PROGRESS") {
    // Show banner, update status
    scrapeBanner.classList.remove("hidden");
    const displayType = message.elementType ? message.elementType.toUpperCase() : 'ELEMENT';
    scrapeProgressText.textContent = `Scraping element ${message.current} of ${message.total}... (${displayType})`;
    sendResponse({ received: true });
  } else if (message.action === "AUTO_SCRAPE_COMPLETE") {
    // Hide banner, display scraped data, clean up styles
    scrapeBanner.classList.add("hidden");
    if (paginationPromptBanner) paginationPromptBanner.classList.add("hidden");
    displayScrapedData(message.data);
    resetScrapeButton();
    sendResponse({ received: true });
  } else if (message.action === "SHOW_PAGINATION_PROMPT") {
    // Hide scrape progress and show pagination choice
    scrapeBanner.classList.add("hidden");
    if (paginationPromptBanner) paginationPromptBanner.classList.remove("hidden");
    sendResponse({ received: true });
  } else if (message.action === "DEACTIVATE_SELECTOR_CONFIRMED") {
    btnVisualSelect.classList.remove("active");
    selectorBanner.classList.add("hidden");
    sendResponse({ received: true });
  }
  return true;
});

// Show error inside preview
function showScrapingError(msg) {
  previewEmpty.innerHTML = `
    <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="8" x2="12" y2="12"></line>
      <line x1="12" y1="16" x2="12.01" y2="16"></line>
    </svg>
    <p style="color: #f87171;">Scrape Operation Failed</p>
    <p class="subtitle">${msg}</p>
  `;
}

// Build clean, token-efficient Markdown and update UI views
async function displayScrapedData(data) {
  // If it's a Shopify Collection, handle caching and price comparison
  if (data.isShopifyCollection && data.products) {
    try {
      const cacheKey = `shopify_cache_${data.url}`;
      const cacheResult = await chrome.storage.local.get([cacheKey]);
      const prevCached = cacheResult[cacheKey];
      
      let updatedProducts = data.products;
      if (prevCached && prevCached.products) {
        updatedProducts = computePriceDrops(data.products, prevCached.products);
      }
      
      data.products = updatedProducts;
      
      if (!data.timestamp) {
        data.timestamp = Date.now();
        await chrome.storage.local.set({ [cacheKey]: data });
        if (shopifyOfflineBadge) {
          shopifyOfflineBadge.classList.add("hidden");
        }
      }
    } catch (e) {
      console.error("Error managing Shopify cache:", e);
    }
  }

  lastScrapedData = data;

  // Show data view and hide empty states
  previewEmpty.classList.add("hidden");
  previewDataView.classList.remove("hidden");
  
  markdownEmpty.classList.add("hidden");
  markdownContentView.classList.remove("hidden");

  // Construct UI Preview HTML
  buildUIPreview(data);

  // Construct Token-Optimized Markdown string
  buildOptimizedMarkdown(data);

  // Update Action Buttons States
  updateButtonStates(optimizedMarkdown);
}

// Process point-and-clicked single element
function displaySingleElement(element) {
  lastScrapedData = element;

  previewEmpty.classList.add("hidden");
  previewDataView.classList.remove("hidden");
  
  markdownEmpty.classList.add("hidden");
  markdownContentView.classList.remove("hidden");

  // Render HTML preview
  ytDataView.classList.add("hidden");
  generalDataView.classList.remove("hidden");

  generalDataView.innerHTML = `
    <div class="preview-card">
      <div class="preview-card-title">Extracted Element: &lt;${element.tagName}&gt;</div>
      <div class="preview-item">
        <span class="preview-item-label">Tag:</span>
        <span class="preview-item-value">&lt;${element.tagName}&gt;</span>
      </div>
      ${element.id ? `
      <div class="preview-item">
        <span class="preview-item-label">ID:</span>
        <span class="preview-item-value">#${element.id}</span>
      </div>` : ''}
      ${element.className ? `
      <div class="preview-item">
        <span class="preview-item-label">Classes:</span>
        <span class="preview-item-value">${element.className.replace(/\s+/g, ', ')}</span>
      </div>` : ''}
      <div class="preview-item" style="margin-top: 8px;">
        <span class="preview-item-label" style="display:block;margin-bottom:4px;">Text Content:</span>
        <div class="preview-item-value" style="background:rgba(0,0,0,0.15);padding:8px;border-radius:4px;white-space:pre-wrap;font-family:var(--font-mono);font-size:11px;">${element.text || '(empty)'}</div>
      </div>
    </div>
  `;

  // Build markdown representation
  let markdown = `# Scraped Element <${element.tagName}>\n`;
  markdown += `Source: ${currentTabUrl}\n`;
  if (element.id) markdown += `ID: #${element.id}\n`;
  if (element.className) markdown += `Classes: .${element.className.split(' ').join('.')}\n`;
  markdown += `\n## Content:\n${element.text || ''}\n`;
  
  optimizedMarkdown = markdown;
  markdownTextCode.textContent = optimizedMarkdown;

  updateButtonStates(optimizedMarkdown);
}

// Formats preview DOM elements
// Render Shopify Products Grid
function renderShopifyCatalog() {
  if (!shopifyProductGrid || !currentShopifyProducts) return;
  
  const searchQuery = shopifySearchInput ? shopifySearchInput.value.toLowerCase().trim() : "";
  const sortOption = shopifySortSelect ? shopifySortSelect.value : "default";
  
  // 1. Filter
  let filtered = currentShopifyProducts.filter(p => {
    return p.title.toLowerCase().includes(searchQuery) || p.vendor.toLowerCase().includes(searchQuery);
  });
  
  // 2. Sort
  if (sortOption === "price-low") {
    filtered.sort((a, b) => a.price - b.price);
  } else if (sortOption === "price-high") {
    filtered.sort((a, b) => b.price - a.price);
  } else if (sortOption === "alphabetical") {
    filtered.sort((a, b) => a.title.localeCompare(b.title));
  }
  
  // 3. Render Grid
  if (filtered.length === 0) {
    shopifyProductGrid.innerHTML = `
      <div style="grid-column: 1/-1; padding: 40px 20px; text-align: center; color: var(--text-muted);">
        No products match your search.
      </div>
    `;
    return;
  }
  
  shopifyProductGrid.innerHTML = filtered.map((p, index) => {
    let badgesHTML = "";
    if (p.priceDropped && p.oldPrice) {
      const dropDiff = Math.round(p.oldPrice - p.price);
      badgesHTML += `<span class="price-drop-badge" title="Was Rs. ${p.oldPrice}">↓ Rs. ${dropDiff} Drop</span>`;
    }
    
    if (p.compareAtPrice && p.compareAtPrice > p.price) {
      const pct = Math.round(((p.compareAtPrice - p.price) / p.compareAtPrice) * 100);
      badgesHTML += `<span class="discount-badge">${pct}% OFF</span>`;
    }
    
    const comparePriceHTML = p.compareAtPrice ? `<span class="product-compare-price">Rs. ${Math.round(p.compareAtPrice)}</span>` : "";
    
    return `
      <div class="product-card" tabindex="0" data-url="${p.productUrl}" data-index="${index}" role="listitem">
        ${badgesHTML ? `<div class="product-badges">${badgesHTML}</div>` : ""}
        <div class="product-image-container">
          <img src="${p.imageUrl || 'https://via.placeholder.com/150'}" class="product-image" alt="${p.title}" loading="lazy">
        </div>
        <div class="product-info">
          <span class="product-vendor">${p.vendor}</span>
          <span class="product-title" title="${p.title}">${p.title}</span>
          <div class="product-price-row">
            <span class="product-price">Rs. ${Math.round(p.price)}</span>
            ${comparePriceHTML}
          </div>
        </div>
      </div>
    `;
  }).join("");
  
  setupGridKeyboardNavigation();
}

// Compute price changes and flags
function computePriceDrops(freshProducts, cachedProducts) {
  if (!cachedProducts || cachedProducts.length === 0) return freshProducts;
  
  const cachedMap = new Map(cachedProducts.map(p => [p.id, p]));
  let dropCount = 0;
  
  const updatedProducts = freshProducts.map(p => {
    const oldP = cachedMap.get(p.id);
    if (oldP) {
      if (p.price < oldP.price) {
        dropCount++;
        return {
          ...p,
          priceDropped: true,
          oldPrice: oldP.price
        };
      } else if (oldP.priceDropped && p.price === oldP.price) {
        return {
          ...p,
          priceDropped: true,
          oldPrice: oldP.oldPrice
        };
      }
    }
    return p;
  });
  
  if (dropCount > 0) {
    showToast(`${dropCount} product${dropCount === 1 ? '' : 's'} dropped in price!`);
  }
  
  return updatedProducts;
}

// Load cached products and run a background scrape
async function checkAndLoadShopifyCache() {
  if (!currentTabUrl || !currentTabUrl.includes("/collections/")) {
    return;
  }
  
  try {
    const cacheKey = `shopify_cache_${currentTabUrl}`;
    const result = await chrome.storage.local.get([cacheKey, `sort_${currentTabUrl}`]);
    const cachedData = result[cacheKey];
    const savedSort = result[`sort_${currentTabUrl}`];
    
    if (cachedData && cachedData.products && cachedData.products.length > 0) {
      if (shopifyOfflineBadge) {
        shopifyOfflineBadge.classList.remove("hidden");
        const formattedDate = new Date(cachedData.timestamp).toLocaleTimeString();
        offlineBadgeText.textContent = `Viewing cached version (Scraped: ${formattedDate})`;
      }
      
      if (savedSort && shopifySortSelect) {
        shopifySortSelect.value = savedSort;
      }
      
      await displayScrapedData(cachedData);
      
      btnAutoScrape.disabled = true;
      btnAutoScrape.textContent = "Updating...";
      chrome.tabs.sendMessage(currentTabId, { 
        action: "START_AUTO_SCRAPE_ANIMATION", 
        delay: 0
      }).catch(err => {
        console.warn("Silent background update failed:", err);
        resetScrapeButton();
      });
    }
  } catch (error) {
    console.error("Error loading shopify cache:", error);
  }
}

// Keyboard arrow key grid navigation
function setupGridKeyboardNavigation() {
  const cards = shopifyProductGrid.querySelectorAll(".product-card");
  
  cards.forEach(card => {
    card.addEventListener("click", () => {
      const url = card.dataset.url;
      if (url) {
        window.open(url, "_blank");
      }
    });
    
    card.addEventListener("keydown", (e) => {
      const index = parseInt(card.dataset.index, 10);
      
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const url = card.dataset.url;
        if (url) {
          window.open(url, "_blank");
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const next = shopifyProductGrid.querySelector(`.product-card[data-index="${index + 1}"]`);
        if (next) next.focus();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const prev = shopifyProductGrid.querySelector(`.product-card[data-index="${index - 1}"]`);
        if (prev) prev.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (cards.length > 0) {
          const gridWidth = shopifyProductGrid.clientWidth;
          const cardWidth = cards[0].clientWidth;
          const itemsPerRow = Math.max(1, Math.floor(gridWidth / (cardWidth || 120)));
          const target = shopifyProductGrid.querySelector(`.product-card[data-index="${index + itemsPerRow}"]`);
          if (target) {
            target.focus();
          } else {
            const last = shopifyProductGrid.querySelector(`.product-card[data-index="${cards.length - 1}"]`);
            if (last) last.focus();
          }
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (cards.length > 0) {
          const gridWidth = shopifyProductGrid.clientWidth;
          const cardWidth = cards[0].clientWidth;
          const itemsPerRow = Math.max(1, Math.floor(gridWidth / (cardWidth || 120)));
          const target = shopifyProductGrid.querySelector(`.product-card[data-index="${index - itemsPerRow}"]`);
          if (target) {
            target.focus();
          } else {
            const first = shopifyProductGrid.querySelector(`.product-card[data-index="0"]`);
            if (first) first.focus();
          }
        }
      }
    });
  });
}

function buildUIPreview(data) {
  // Hide all specific previews initially
  ytDataView.classList.add("hidden");
  generalDataView.classList.add("hidden");
  if (shopifyCatalogView) shopifyCatalogView.classList.add("hidden");

  // If it's Shopify Collection, show catalog grid
  if (data.isShopifyCollection && data.products) {
    if (shopifyCatalogView) {
      shopifyCatalogView.classList.remove("hidden");
      currentShopifyProducts = data.products;
      renderShopifyCatalog();
    }
  } else if (data.isYouTube && data.youtube) {
    ytDataView.classList.remove("hidden");
    generalDataView.classList.add("hidden");
    
    const yt = data.youtube;
    
    // Build Comments List
    let commentsHTML = '';
    if (yt.comments && yt.comments.length > 0) {
      commentsHTML = yt.comments.map(c => `
        <li class="preview-list-item">
          <strong>@${c.author}</strong> <span style="color:var(--text-muted);font-size:10px;">(👍 ${c.likes})</span>
          <p style="margin-top:2px;color:var(--text-primary);">${c.content}</p>
        </li>
      `).join('');
    } else {
      commentsHTML = '<li class="preview-list-item" style="color:var(--text-muted);">No comments loaded.</li>';
    }

    ytDataView.innerHTML = `
      <div class="preview-card">
        <div class="preview-card-title">YouTube Video Details</div>
        
        ${yt.thumbnail ? `
        <div style="margin-bottom: 12px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border-color);">
          <img src="${yt.thumbnail}" style="width: 100%; height: auto; display: block;" alt="Video Thumbnail">
        </div>
        ` : ''}

        <div class="preview-item">
          <span class="preview-item-label">Title:</span>
          <span class="preview-item-value">${yt.title || 'N/A'}</span>
        </div>
        <div class="preview-item">
          <span class="preview-item-label">Channel:</span>
          <span class="preview-item-value">${yt.channel || 'N/A'}</span>
        </div>
        <div class="preview-item">
          <span class="preview-item-label">Views:</span>
          <span class="preview-item-value">${yt.views || 'N/A'}</span>
        </div>
        <div class="preview-item">
          <span class="preview-item-label">Likes:</span>
          <span class="preview-item-value">${yt.likes || 'N/A'}</span>
        </div>
        <div class="preview-item" style="margin-top:8px;">
          <span class="preview-item-label" style="display:block;margin-bottom:4px;">Description:</span>
          <div style="background:rgba(0,0,0,0.15);padding:8px;border-radius:4px;max-height:120px;overflow-y:auto;font-size:11px;color:var(--text-secondary);white-space:pre-wrap;">${yt.description || 'No description found.'}</div>
        </div>
      </div>

      <div class="preview-card">
        <div class="preview-card-title">Comments Scraped (${yt.comments.length})</div>
        <ul class="preview-list" style="max-height: 200px; overflow-y: auto;">
          ${commentsHTML}
        </ul>
      </div>
    `;
  } else {
    // Show general web view
    ytDataView.classList.add("hidden");
    generalDataView.classList.remove("hidden");

    let metadataHTML = '';
    if (data.metadata.description) {
      metadataHTML += `
        <div class="preview-item">
          <span class="preview-item-label">Description:</span>
          <span class="preview-item-value">${data.metadata.description}</span>
        </div>
      `;
    }
    if (data.metadata.keywords) {
      metadataHTML += `
        <div class="preview-item">
          <span class="preview-item-label">Keywords:</span>
          <span class="preview-item-value">${data.metadata.keywords}</span>
        </div>
      `;
    }
    if (!metadataHTML) {
      metadataHTML = '<div style="color:var(--text-muted);font-size:12px;">No meta tags found.</div>';
    }

    // Build Tables Preview
    let tablesHTML = '';
    if (data.tables && data.tables.length > 0) {
      tablesHTML = data.tables.map((table, tIndex) => {
        let headersRow = '';
        if (table.headers.length > 0) {
          headersRow = `<tr>${table.headers.map(h => `<th>${h}</th>`).join('')}</tr>`;
        }
        const rowsHTML = table.rows.map(row => `
          <tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>
        `).join('');

        return `
          <div class="preview-table-container" style="margin-bottom: 10px;">
            <table class="preview-table">
              <thead>${headersRow}</thead>
              <tbody>${rowsHTML}</tbody>
            </table>
          </div>
        `;
      }).join('');
    }

    // Build Image Gallery Preview
    let imagesHTML = '';
    if (data.images && data.images.length > 0) {
      imagesHTML = `
        <div class="preview-card">
          <div class="preview-card-title">Images Scraped (${data.images.length})</div>
          <div style="display: flex; gap: 8px; overflow-x: auto; padding-bottom: 8px; max-width: 100%;">
            ${data.images.map(img => `
              <div style="flex-shrink: 0; width: 75px; height: 75px; border-radius: 4px; border: 1px solid var(--border-color); overflow: hidden; position: relative;" title="${img.alt}">
                <img src="${img.url}" style="width: 100%; height: 100%; object-fit: cover;" alt="${img.alt}">
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    generalDataView.innerHTML = `
      <div class="preview-card">
        <div class="preview-card-title">Page Metadata</div>
        ${metadataHTML}
      </div>

      <div class="preview-card">
        <div class="preview-card-title">Elements Scraped</div>
        <div class="preview-item">
          <span class="preview-item-label">Headings:</span>
          <span class="preview-item-value">${data.headers.length} tags</span>
        </div>
        <div class="preview-item">
          <span class="preview-item-label">Paragraphs:</span>
          <span class="preview-item-value">${data.paragraphs.length} blocks</span>
        </div>
        <div class="preview-item">
          <span class="preview-item-label">Lists:</span>
          <span class="preview-item-value">${data.lists.length} lists</span>
        </div>
        <div class="preview-item">
          <span class="preview-item-label">Tables:</span>
          <span class="preview-item-value">${data.tables.length} tables</span>
        </div>
        <div class="preview-item">
          <span class="preview-item-label">Links:</span>
          <span class="preview-item-value">${data.links.length} anchors</span>
        </div>
      </div>

      ${imagesHTML}

      ${tablesHTML ? `
      <div class="preview-card">
        <div class="preview-card-title">Data Tables</div>
        ${tablesHTML}
      </div>
      ` : ''}
    `;
  }
}

// Helper to extract global design tokens (colors, button shapes, fonts)
function extractGlobalTokens(data) {
  const bgColors = {};
  const textColors = {};
  const fonts = {};
  let buttonRadius = "N/A";
  let buttonBg = "N/A";
  let cardRadius = "N/A";
  let cardBg = "N/A";
  let cardShadow = "N/A";

  const flowItems = data.flow || [];

  flowItems.forEach(item => {
    const styles = item.styles || {};
    if (styles.backgroundColor && styles.backgroundColor !== 'rgba(0, 0, 0, 0)' && styles.backgroundColor !== 'transparent') {
      bgColors[styles.backgroundColor] = (bgColors[styles.backgroundColor] || 0) + 1;
    }
    if (styles.color) {
      textColors[styles.color] = (textColors[styles.color] || 0) + 1;
    }
    if (styles.fontFamily) {
      const font = styles.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      fonts[font] = (fonts[font] || 0) + 1;
    }

    if (item.type === 'button' && styles.borderRadius) {
      buttonRadius = styles.borderRadius;
      buttonBg = styles.backgroundColor;
    }

    if (item.type === 'container-card' && styles.borderRadius) {
      cardRadius = styles.borderRadius;
      cardBg = styles.backgroundColor;
      cardShadow = styles.boxShadow;
    }
  });

  const sortedBgs = Object.entries(bgColors).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
  const sortedText = Object.entries(textColors).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
  const sortedFonts = Object.entries(fonts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);

  return {
    backgrounds: sortedBgs.length ? sortedBgs : ['N/A'],
    textColors: sortedText.length ? sortedText : ['N/A'],
    fonts: sortedFonts.length ? sortedFonts : ['N/A'],
    buttonRadius,
    buttonBg,
    cardRadius,
    cardBg,
    cardShadow
  };
}

// Builds the final clean, token-efficient Markdown structure
function buildOptimizedMarkdown(data) {
  let md = "";
  
  // Header Meta
  md += `# Webpage Reconstruction Blueprint: ${data.title}\n`;
  md += `Source URL: ${data.url}\n\n`;

  if (data.metadata && (data.metadata.description || data.metadata.keywords)) {
    md += `## Metadata\n`;
    if (data.metadata.description) md += `- Description: ${data.metadata.description}\n`;
    if (data.metadata.keywords) md += `- Keywords: ${data.metadata.keywords}\n`;
    md += `\n`;
  }

  // Shopify Collection Table layout
  if (data.isShopifyCollection && data.products) {
    md += `## Shopify Products List (${data.products.length} products)\n\n`;
    md += `| Title | Vendor | Price | Compare At Price | Image URL | Product URL |\n`;
    md += `|---|---|---|---|---|---|\n`;
    data.products.forEach(p => {
      const comparePriceStr = p.compareAtPrice ? `Rs. ${p.compareAtPrice}` : "-";
      md += `| ${p.title} | ${p.vendor} | Rs. ${p.price} | ${comparePriceStr} | [Image](${p.imageUrl}) | [Link](${p.productUrl}) |\n`;
    });
    md += `\n`;
  } else if (data.isYouTube && data.youtube) {
    // YouTube structured layout
    const yt = data.youtube;
    md += `## YouTube Video Details\n`;
    md += `- Uploader Channel: ${yt.channel || 'N/A'}\n`;
    md += `- Views & Date: ${yt.views || 'N/A'}\n`;
    md += `- Likes: ${yt.likes || 'N/A'}\n\n`;
    
    if (yt.thumbnail) {
      md += `### Video Thumbnail\n![Thumbnail](${yt.thumbnail})\n\n`;
    }

    if (yt.description) {
      md += `### Description\n${yt.description}\n\n`;
    }
    
    if (yt.comments && yt.comments.length > 0) {
      md += `### Video Comments\n`;
      yt.comments.forEach(c => {
        md += `- @${c.author} (likes: ${c.likes}): ${c.content}\n`;
      });
      md += `\n`;
    }
  } else {
    // Extract global design tokens
    const tokens = extractGlobalTokens(data);
    
    md += `## Global Design Tokens\n`;
    md += `### Color Palette\n`;
    md += `- Primary Background Colors: ${tokens.backgrounds.join(', ')}\n`;
    md += `- Primary Text Colors: ${tokens.textColors.join(', ')}\n\n`;
    
    md += `### Typography\n`;
    md += `- Preferred Font Families: ${tokens.fonts.join(', ')}\n\n`;
    
    md += `### Button Design Guidelines\n`;
    md += `- Background Color: ${tokens.buttonBg}\n`;
    md += `- Border Radius: ${tokens.buttonRadius}\n\n`;
    
    md += `### Container Card Design Guidelines\n`;
    md += `- Background Color: ${tokens.cardBg}\n`;
    md += `- Border Radius: ${tokens.cardRadius}\n`;
    md += `- Shadow Style: ${tokens.cardShadow}\n\n`;
    
    // Page Elements Summary
    md += `## Scraped Elements Summary\n`;
    md += `- Container Cards: ${data.cards ? data.cards.length : 0}\n`;
    md += `- Headers: ${data.headers ? data.headers.length : 0}\n`;
    md += `- Paragraphs: ${data.paragraphs ? data.paragraphs.length : 0}\n`;
    md += `- Inline Text Snippets: ${data.inlineTexts ? data.inlineTexts.length : 0}\n`;
    md += `- Buttons/Controls: ${data.buttons ? data.buttons.length : 0}\n`;
    md += `- Form Inputs: ${data.inputs ? data.inputs.length : 0}\n`;
    md += `- Images: ${data.images ? data.images.length : 0}\n`;
    md += `- Lists: ${data.lists ? data.lists.length : 0}\n`;
    md += `- Tables: ${data.tables ? data.tables.length : 0}\n`;
    md += `- Anchors/Links: ${data.links ? data.links.length : 0}\n\n`;
    
    // Filter Sidebar Section
    const filterInputs = (data.inputs || []).filter(inp => inp.attributes && inp.attributes.labelText);
    if (filterInputs.length > 0) {
      md += `## Filter Sidebar\n`;
      filterInputs.forEach(inp => {
        md += `- [ ] ${inp.attributes.labelText}\n`;
      });
      md += `\n`;
    }
    
    // Wireframe layout
    md += `## Wireframe Layout Blueprint\n`;
    md += `Below is a nested structural wireframe representing the layout hierarchy of the scraped webpage. Use the tags, styling details, class selectors, and nested structures to recreate the user interface components.\n\n`;
    
    // Build tree
    const itemsById = {};
    const rootItems = [];
    
    const flowItems = data.flow || [];
    flowItems.forEach(item => {
      itemsById[item.id] = {
        ...item,
        children: []
      };
    });
    
    flowItems.forEach(item => {
      const wrapper = itemsById[item.id];
      if (item.parentId && itemsById[item.parentId]) {
        itemsById[item.parentId].children.push(wrapper);
      } else {
        rootItems.push(wrapper);
      }
    });

    function formatNode(node, depth) {
      const indent = "  ".repeat(depth);
      let output = "";
      
      const tagStr = node.tag ? `<${node.tag}>` : "";
      const idStr = node.elementIdAttr ? ` id="${node.elementIdAttr}"` : "";
      const classStr = node.className ? ` class="${node.className.trim().replace(/\s+/g, '.')}"` : "";
      const styles = node.styles || {};
      
      const styleSummary = [];
      if (styles.color) styleSummary.push(`color: ${styles.color}`);
      if (styles.backgroundColor && styles.backgroundColor !== 'rgba(0, 0, 0, 0)' && styles.backgroundColor !== 'transparent') styleSummary.push(`bg: ${styles.backgroundColor}`);
      if (styles.fontSize) styleSummary.push(`font-size: ${styles.fontSize}`);
      if (styles.fontWeight && styles.fontWeight !== '400' && styles.fontWeight !== 'normal') styleSummary.push(`font-weight: ${styles.fontWeight}`);
      if (styles.borderRadius && styles.borderRadius !== '0px') styleSummary.push(`radius: ${styles.borderRadius}`);
      if (styles.padding && styles.padding !== '0px') styleSummary.push(`padding: ${styles.padding}`);
      if (styles.margin && styles.margin !== '0px') styleSummary.push(`margin: ${styles.margin}`);
      if (styles.display && styles.display !== 'inline' && styles.display !== 'block') styleSummary.push(`display: ${styles.display}`);
      
      const styleStr = styleSummary.length ? ` { ${styleSummary.join('; ')} }` : "";
      
      if (node.type === 'container-card') {
        const urlAttr = (node.attributes && node.attributes.productUrl) ? ` url="${node.attributes.productUrl}"` : "";
        output += `${indent}- 📦 CONTAINER ${tagStr}${idStr}${classStr}${styleStr}${urlAttr}\n`;
        if (node.children && node.children.length > 0) {
          node.children.forEach(child => {
            output += formatNode(child, depth + 1);
          });
        }
      } else if (node.type === 'header') {
        output += `${indent}- 🔤 HEADER ${tagStr}${idStr}${classStr}${styleStr}: "${node.text}"\n`;
      } else if (node.type === 'paragraph') {
        output += `${indent}- 📝 PARAGRAPH ${tagStr}${styleStr}: "${node.text}"\n`;
      } else if (node.type === 'image') {
        const src = node.attributes.src || '';
        const alt = node.attributes.alt || '';
        output += `${indent}- 🖼️ IMAGE ${tagStr}${idStr}${classStr}${styleStr} [src: "${src}", alt: "${alt}"]\n`;
      } else if (node.type === 'button') {
        const href = node.attributes.href ? ` href="${node.attributes.href}"` : "";
        output += `${indent}- 🔘 BUTTON ${tagStr}${idStr}${classStr}${styleStr}${href}: "${node.text}"\n`;
      } else if (node.type === 'input') {
        const typeAttr = node.attributes.inputType ? ` type="${node.attributes.inputType}"` : "";
        const placeholder = node.attributes.placeholder ? ` placeholder="${node.attributes.placeholder}"` : "";
        const value = node.attributes.value ? ` value="${node.attributes.value}"` : "";
        const labelAttr = node.attributes.labelText ? ` label="${node.attributes.labelText}"` : "";
        output += `${indent}- 📥 INPUT ${tagStr}${idStr}${classStr}${styleStr}${typeAttr}${placeholder}${value}${labelAttr}\n`;
      } else if (node.type === 'inline-text') {
        output += `${indent}- 🔸 INLINE TEXT ${tagStr}${styleStr}: "${node.text}"\n`;
      } else if (node.type === 'link') {
        const href = node.attributes.href ? ` href="${node.attributes.href}"` : "";
        output += `${indent}- 🔗 LINK ${tagStr}${idStr}${classStr}${styleStr}${href}: "${node.text}"\n`;
      } else if (node.type === 'list') {
        output += `${indent}- 📋 LIST ${tagStr}${styleStr}\n`;
        if (node.attributes.items && node.attributes.items.length > 0) {
          node.attributes.items.forEach(item => {
            output += `${indent}  * "${item}"\n`;
          });
        }
      } else if (node.type === 'table') {
        output += `${indent}- 📊 TABLE ${tagStr}${styleStr}\n`;
        const td = node.attributes.tableData;
        if (td) {
          if (td.headers.length > 0) {
            output += `${indent}  * Headers: [ ${td.headers.join(' | ')} ]\n`;
          }
          if (td.rows.length > 0) {
            td.rows.forEach((row, rIdx) => {
              output += `${indent}  * Row ${rIdx+1}: [ ${row.join(' | ')} ]\n`;
            });
          }
        }
      } else {
        output += `${indent}- 🔹 ELEMENT <${node.tag}>${styleStr}: "${node.text}"\n`;
      }
      
      return output;
    }

    rootItems.forEach(root => {
      md += formatNode(root, 0);
    });
    
    md += `\n`;
  }

  // Save the result
  optimizedMarkdown = md.trim();
  markdownTextCode.textContent = optimizedMarkdown;
}

// Enable/Disable Action Buttons
function updateButtonStates(text) {
  if (!text) {
    btnDownload.classList.add("disabled");
    btnDownload.disabled = true;
    btnCopy.classList.add("disabled");
    btnCopy.disabled = true;
    return;
  }
  
  btnDownload.classList.remove("disabled");
  btnDownload.disabled = false;
  btnCopy.classList.remove("disabled");
  btnCopy.disabled = false;
}

// Trigger Local Download of Markdown (.md) File
function downloadMarkdownFile() {
  if (!optimizedMarkdown) return;

  try {
    const blob = new Blob([optimizedMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    // Create temporary link element to trigger browser download
    const link = document.createElement("a");
    link.href = url;
    
    // Sanitize current page title for filename
    const sanitizedTitle = currentTabTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .substring(0, 50)
      .replace(/^_+|_+$/g, "");
      
    link.download = `${sanitizedTitle || "scraped_data"}.md`;
    
    // Trigger download click
    document.body.appendChild(link);
    link.click();
    
    // Cleanup
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    // Show success toast
    showToast("Downloaded Markdown File!");
  } catch (error) {
    console.error("Failed to download file:", error);
    alert("Could not download file. Please use the Copy button instead.");
  }
}

// Trigger Local Download of JSON (.json) File
function downloadJsonFile() {
  if (!lastScrapedData) return;

  try {
    const jsonString = JSON.stringify(lastScrapedData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    // Create temporary link element to trigger browser download
    const link = document.createElement("a");
    link.href = url;
    
    // Sanitize current page title for filename
    const sanitizedTitle = currentTabTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .substring(0, 50)
      .replace(/^_+|_+$/g, "");
      
    link.download = `${sanitizedTitle || "scraped_data"}.json`;
    
    // Trigger download click
    document.body.appendChild(link);
    link.click();
    
    // Cleanup
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    // Show success toast
    showToast("Downloaded JSON File!");
  } catch (error) {
    console.error("Failed to download JSON:", error);
    alert("Could not download JSON file.");
  }
}


// Copy to clipboard with success toast animation
async function copyToClipboard() {
  if (!optimizedMarkdown) return;

  try {
    await navigator.clipboard.writeText(optimizedMarkdown);
    showToast("Copied to Clipboard!");
    
    // Scale button micro-animation
    btnCopy.style.transform = "scale(0.95)";
    setTimeout(() => {
      btnCopy.style.transform = "none";
    }, 150);
  } catch (error) {
    console.error("Failed to copy text:", error);
    alert("Could not copy data to clipboard. Please copy it manually.");
  }
}

// Helper to show success toast notifications
function showToast(msg) {
  toastMessage.textContent = msg;
  copyToast.classList.remove("hidden");
  
  setTimeout(() => {
    copyToast.classList.add("hidden");
  }, 2500);
}
