// Content script for Data Extractor

// State variables for Point-and-Click Selector (now Crop-Style Visual Range Selector)
let selectorActive = false;
let allVisualElements = [];
let croppedElements = [];
let cropBoxRect = { left: 0, top: 0, width: 0, height: 0 };
let initialBoxRect = { left: 0, top: 0, width: 0, height: 0 };
let startPoint = { x: 0, y: 0 };
let isDrawing = false;
let isResizing = false;
let isMoving = false;
let activeHandle = null;
let pointerDownTime = 0;
let pointerDownPosition = { x: 0, y: 0 };

// State variables for Visual Auto-Scraper
let autoScrapeActive = false;
let autoScrapeElements = [];
let autoScrapeIndex = 0;
let autoScrapeTimer = null;
let scrapedAccumulator = null;
let lastHighlightedElement = null;
let lastHighlightedStyles = {};

// Track elements revealed during scraping to restore them afterwards
let elementsRevealed = [];

// Helper: Normalize whitespace in string to prevent joining words without spaces
function normalizeWhitespace(text) {
  if (!text) return '';
  return text.trim().split(/\s+/).join(' ');
}

// Helper: Normalize URL to prevent duplicate visits of pagination pages
function getNormalizedUrl(urlString) {
  try {
    const url = new URL(urlString, window.location.href);
    url.hash = '';
    // Normalize page=1 to no page parameter
    const page = url.searchParams.get('page');
    if (page === '1') {
      url.searchParams.delete('page');
    }
    // Sort search parameters for uniform comparison
    const params = Array.from(url.searchParams.entries()).sort();
    url.search = '';
    params.forEach(([key, val]) => {
      url.searchParams.append(key, val);
    });
    // Strip trailing slash
    let path = url.pathname;
    if (path.endsWith('/') && path.length > 1) {
      path = path.slice(0, -1);
    }
    return url.origin + path + url.search;
  } catch (e) {
    return urlString;
  }
}

// Helper: check if webpage is YouTube video watch page
function isYouTubeWatchPage() {
  return window.location.hostname.includes('youtube.com') && window.location.pathname.includes('/watch');
}

// Scrape YouTube metadata immediately at start
function initYouTubeData() {
  const ytData = {
    title: normalizeWhitespace(document.title.replace(' - YouTube', '')),
    channel: '',
    views: '',
    likes: '',
    description: '',
    thumbnail: '',
    comments: []
  };

  const videoIdMatch = window.location.search.match(/[?&]v=([^&#]+)/);
  if (videoIdMatch && videoIdMatch[1]) {
    ytData.thumbnail = `https://img.youtube.com/vi/${videoIdMatch[1]}/maxresdefault.jpg`;
  }

  // Pre-load description snippet in case animation doesn't hit it
  const descEl = document.querySelector('ytd-text-inline-expander span.ytd-text-inline-expander, #description-inline-expander span, #description-text');
  if (descEl) ytData.description = normalizeWhitespace(descEl.innerText);

  return ytData;
}

// Collects all elements we want to highlight and scrape in order of DOM appearance
function collectScrapableElements(rootNode = document.body) {
  const elements = [];

  if (isYouTubeWatchPage()) {
    // 1. YouTube Video Title
    const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title yt-formatted-string, ytd-watch-metadata h1, h1.title');
    if (titleEl) elements.push({ element: titleEl, type: 'yt-title' });

    // 2. YouTube Channel
    const channelEl = document.querySelector('ytd-video-owner-renderer #channel-name a, #owner-name a, #upload-info #channel-name a');
    if (channelEl) elements.push({ element: channelEl, type: 'yt-channel' });

    // 3. YouTube Views / Date
    const metaEl = document.querySelector('ytd-watch-info-text, #info-container, #metadata-line, #info-text ytd-video-view-count-renderer');
    if (metaEl) elements.push({ element: metaEl, type: 'yt-meta' });

    // 4. YouTube Video Description
    const descEl = document.querySelector('ytd-text-inline-expander, #description-inline-expander, #description-text');
    if (descEl) elements.push({ element: descEl, type: 'yt-description' });

    // 5. YouTube Comments currently loaded in DOM
    const commentEls = document.querySelectorAll('ytd-comment-thread-renderer');
    commentEls.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        elements.push({ element: el, type: 'yt-comment' });
      }
    });
  } else {
    const activeContainers = [];

    // High-fidelity pre-order DOM tree traversal to map visual structure and container cards
    function traverse(node) {
      if (!node) return;
      
      const tagName = node.tagName ? node.tagName.toLowerCase() : '';
      
      // Filter out code runtime dependencies & styling utilities
      if (['script', 'style', 'noscript', 'iframe', 'svg', 'path', 'g', 'canvas'].includes(tagName)) {
        return;
      }
      
      // Exclude overlays, modals, cookie banners, comparison popups, etc.
      if (node.nodeType === Node.ELEMENT_NODE && isOverlayOrModal(node)) {
        return;
      }
      
      // Skip common page navigation, headers, footers, sidebar layout noise
      if (node.nodeType === Node.ELEMENT_NODE) {
        const className = node.getAttribute ? (node.getAttribute('class') || '') : '';
        const id = node.getAttribute ? (node.getAttribute('id') || '') : '';
        const classIdStr = (className + ' ' + id).toLowerCase();
        
        if (
          ['header', 'footer', 'nav', 'aside'].includes(tagName) ||
          /header|footer|nav|menu|sidebar|social|widget|announcement|newsletter|cart-drawer|chat/i.test(classIdStr)
        ) {
          return;
        }
      }
      
      let matchedType = '';
      let elementId = null;
      
      if (node.nodeType === Node.ELEMENT_NODE) {
        let isVisible = true;
        
        // If we are in the main active document, verify page layout metrics
        if (rootNode === document.body && node.ownerDocument === document) {
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          isVisible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        } else {
          // Offscreen document (parsed from fetch) - layout metrics don't exist.
          // We assume visible unless it has inline display: none or visibility: hidden
          const style = node.style || {};
          isVisible = style.display !== 'none' && style.visibility !== 'hidden';
        }
        
        if (isVisible) {
          const nodeText = normalizeWhitespace(node.innerText || node.textContent || '');
          
          if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
            if (nodeText) {
              matchedType = 'header';
            }
          } else if (tagName === 'p') {
            if (nodeText) {
              matchedType = 'paragraph';
            }
          } else if (tagName === 'img') {
            const src = node.src || node.getAttribute('data-src') || node.getAttribute('src') || '';
            const width = node.naturalWidth || node.clientWidth || 0;
            const height = node.naturalHeight || node.clientHeight || 0;
            const isPixel = (rootNode === document.body && (width < 25 || height < 25)) || src.includes('pixel') || src.includes('spacer') || src.includes('tracking');
            if (src && !isPixel) {
              matchedType = 'image';
            }
          } else if (tagName === 'table') {
            matchedType = 'table';
          } else if (tagName === 'ul' || tagName === 'ol') {
            const lis = node.querySelectorAll('li');
            if (lis.length > 0) {
              matchedType = 'list';
            }
          } else if (tagName === 'button' || (tagName === 'input' && ['button', 'submit', 'reset'].includes(node.type))) {
            const val = normalizeWhitespace(node.value || '');
            if (nodeText || val) {
              matchedType = 'button';
            }
          } else if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
            matchedType = 'input';
          } else if (tagName === 'a') {
            const href = node.getAttribute('href');
            let isButtonLike = false;
            if (rootNode === document.body && node.ownerDocument === document) {
              const style = window.getComputedStyle(node);
              isButtonLike = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.padding !== '0px' && style.padding !== '0';
            }
            if (nodeText && href && !href.startsWith('javascript:') && !href.startsWith('#')) {
              matchedType = isButtonLike ? 'button' : 'link';
            }
          } else if (['span', 'strong', 'b', 'em', 'i', 'code', 'small'].includes(tagName)) {
            if (nodeText && nodeText.length > 0 && nodeText.length < 80) {
              const parentTag = node.parentElement ? node.parentElement.tagName.toLowerCase() : '';
              if (!['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button', 'a', 'option', 'textarea', 'th', 'td', 'li'].includes(parentTag)) {
                const isPrice = /[\$\£\€\¥\₹]|\b(price|rs|usd|eur|gbp)\b/i.test(nodeText);
                const isRating = /[\★\☆]|\b(rating|stars|rate)\b/i.test(nodeText);
                const isNumeric = /^[0-9\.\,\-\+]+$/.test(nodeText.replace(/[\s\%]/g, ''));
                const isSpecialDetail = /in stock|out of stock|model|brand|sku|qty|quantity/i.test(nodeText);
                if (isPrice || isRating || isNumeric || isSpecialDetail || nodeText.length < 25) {
                  matchedType = 'inline-text';
                }
              }
            }
          } else if (tagName === 'div' || tagName === 'section' || tagName === 'article' || tagName === 'aside' || tagName === 'header' || tagName === 'footer') {
            const className = node.className || '';
            const idName = node.id || '';
            const isCard = /card|item|product|grid-item|tile|post|row|column|flex-item/i.test(className + ' ' + idName);
            if (isCard) {
              matchedType = 'container-card';
            }
          }

          if (matchedType) {
            const parentCardId = activeContainers.length > 0 ? activeContainers[activeContainers.length - 1] : null;
            elementId = elements.length + 1;

            elements.push({ 
              element: node, 
              type: matchedType,
              id: elementId,
              parentId: parentCardId
            });
            
            if (matchedType === 'container-card') {
              activeContainers.push(elementId);
            }
            
            // For card containers, tables, lists, we traverse child nodes to scrape detailed inner data too.
            // But for leaf content items, we halt deep traversal to avoid duplicate highlights on texts.
            if (['header', 'paragraph', 'image', 'button', 'link', 'input', 'inline-text'].includes(matchedType)) {
              return;
            }
          }
        }
      }

      let child = node.firstChild;
      while (child) {
        traverse(child);
        child = child.nextSibling;
      }
      
      if (matchedType === 'container-card' && elementId !== null) {
        activeContainers.pop();
      }
    }

    traverse(rootNode);
  }

  return elements;
}

// Helper to extract computed styling properties
function getElementStyleInfo(el) {
  try {
    const computed = window.getComputedStyle(el);
    return {
      color: computed.color,
      backgroundColor: computed.backgroundColor,
      borderColor: computed.borderColor,
      borderRadius: computed.borderRadius,
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      padding: computed.padding,
      margin: computed.margin,
      display: computed.display,
      position: computed.position,
      boxShadow: computed.boxShadow,
      width: el.offsetWidth + 'px',
      height: el.offsetHeight + 'px'
    };
  } catch (e) {
    return {};
  }
}

// Extract data from a single element and add to the accumulator
function scrapeSingleElementToAccumulator(elInfo) {
  const el = elInfo.element;
  const type = elInfo.type;

  if (isYouTubeWatchPage()) {
    const yt = scrapedAccumulator.youtube;
    if (type === 'yt-title') {
      yt.title = normalizeWhitespace(el.innerText);
    } else if (type === 'yt-channel') {
      yt.channel = normalizeWhitespace(el.innerText);
    } else if (type === 'yt-meta') {
      yt.views = normalizeWhitespace(el.innerText.replace(/\n/g, ' '));
      // Try to fetch likes inside meta too
      const likeButton = document.querySelector('#segmented-like-button yt-button-shape button[aria-label*="like"]');
      if (likeButton) {
        const match = (likeButton.getAttribute('aria-label') || '').match(/[\d,]+/);
        if (match) yt.likes = match[0];
      }
    } else if (type === 'yt-description') {
      yt.description = normalizeWhitespace(el.innerText);
    } else if (type === 'yt-comment') {
      const authorEl = el.querySelector('#author-text span');
      const contentEl = el.querySelector('#content-text');
      const likesEl = el.querySelector('#vote-count-middle');
      if (contentEl && contentEl.innerText.trim()) {
        const commentData = {
          author: authorEl ? normalizeWhitespace(authorEl.innerText) : 'Anonymous',
          content: normalizeWhitespace(contentEl.innerText),
          likes: likesEl ? normalizeWhitespace(likesEl.innerText) : '0'
        };
        // Avoid duplicate comment entries
        if (!yt.comments.some(c => c.content === commentData.content)) {
          yt.comments.push(commentData);
        }
      }
    }
  } else {
    // General webpage scraping
    const tagName = el.tagName.toLowerCase();
    const styleInfo = getElementStyleInfo(el);
    const text = normalizeWhitespace(el.innerText || el.textContent || '');
    const id = el.id || '';
    const className = el.className || '';

    const flowItem = {
      id: elInfo.id,
      parentId: elInfo.parentId,
      type: type,
      tag: tagName,
      elementIdAttr: id,
      className: className,
      text: text,
      styles: styleInfo,
      attributes: {}
    };

    if (type === 'header') {
      scrapedAccumulator.headers.push({
        tag: tagName,
        text: text,
        styles: styleInfo
      });
    } else if (type === 'paragraph') {
      if (!scrapedAccumulator.paragraphs.some(p => p.text === text)) {
        scrapedAccumulator.paragraphs.push({
          text: text,
          styles: styleInfo
        });
      }
    } else if (type === 'list') {
      const items = [];
      const itemEls = el.querySelectorAll('li');
      itemEls.forEach(li => {
        const t = normalizeWhitespace(li.innerText || li.textContent || '');
        if (t) items.push(t);
      });
      flowItem.attributes.items = items;
      if (items.length > 0) {
        scrapedAccumulator.lists.push({
          type: tagName,
          items: items,
          styles: styleInfo
        });
      }
    } else if (type === 'table') {
      const tableData = { headers: [], rows: [] };
      const ths = el.querySelectorAll('th');
      ths.forEach(th => tableData.headers.push(normalizeWhitespace(th.innerText || th.textContent || '')));
      
      const trs = el.querySelectorAll('tr');
      trs.forEach(tr => {
        const tds = tr.querySelectorAll('td');
        if (tds.length > 0) {
          const row = [];
          tds.forEach(td => row.push(normalizeWhitespace(td.innerText || td.textContent || '')));
          tableData.rows.push(row);
        }
      });
      flowItem.attributes.tableData = tableData;
      scrapedAccumulator.tables.push({
        tableData: tableData,
        styles: styleInfo
      });
    } else if (type === 'image') {
      const src = el.src || el.getAttribute('data-src') || el.getAttribute('src');
      const alt = normalizeWhitespace(el.alt || el.title || 'Webpage Image');
      if (src) {
        try {
          const fullUrl = new URL(src, window.location.href).href;
          flowItem.attributes.src = fullUrl;
          flowItem.attributes.alt = alt;
          if (!scrapedAccumulator.images.some(img => img.url === fullUrl)) {
            scrapedAccumulator.images.push({
              url: fullUrl,
              alt: alt,
              styles: styleInfo
            });
          }
        } catch (e) {}
      }
    } else if (type === 'button') {
      if (tagName === 'a') {
        const href = el.getAttribute('href') || '';
        try {
          flowItem.attributes.href = new URL(href, window.location.href).href;
        } catch (e) {}
      }
      scrapedAccumulator.buttons.push({
        text: text,
        tag: tagName,
        attributes: flowItem.attributes,
        styles: styleInfo
      });
    } else if (type === 'input') {
      flowItem.attributes.inputType = el.type || '';
      flowItem.attributes.placeholder = normalizeWhitespace(el.placeholder || '');
      flowItem.attributes.value = normalizeWhitespace(el.value || '');
      
      // PROBLEM 4 — Capture Filter Labels and Counts
      if (el.classList.contains('plp-revamp-filter-items')) {
        let nextSpan = el.nextElementSibling;
        while (nextSpan && nextSpan.tagName.toLowerCase() !== 'span') {
          nextSpan = nextSpan.nextElementSibling;
        }
        if (nextSpan) {
          flowItem.attributes.labelText = normalizeWhitespace(nextSpan.innerText || nextSpan.textContent);
        }
      }
      
      scrapedAccumulator.inputs.push({
        tag: tagName,
        attributes: flowItem.attributes,
        styles: styleInfo
      });
    } else if (type === 'container-card') {
      // PROBLEM 2 — Extract Product Page Link inside or wrapping the card
      let productUrl = '';
      const anchor = el.closest('a') || el.querySelector('a.card-wrapper, a.product-card-wrapper, a');
      if (anchor) {
        const href = anchor.getAttribute('href');
        if (href) {
          try {
            productUrl = new URL(href, window.location.href).href;
          } catch (e) {}
        }
      }
      flowItem.attributes.productUrl = productUrl;
      
      scrapedAccumulator.cards.push({
        tag: tagName,
        id: id,
        className: className,
        productUrl: productUrl,
        styles: styleInfo
      });
    } else if (type === 'inline-text') {
      scrapedAccumulator.inlineTexts.push({
        text: text,
        tag: tagName,
        styles: styleInfo
      });
    } else if (type === 'link') {
      const href = el.getAttribute('href') || '';
      try {
        const fullUrl = new URL(href, window.location.href).href;
        flowItem.attributes.href = fullUrl;
        if (!scrapedAccumulator.links.some(l => l.url === fullUrl)) {
          scrapedAccumulator.links.push({
            text: text,
            url: fullUrl,
            styles: styleInfo
          });
        }
      } catch (e) {}
    }

    scrapedAccumulator.flow.push(flowItem);
  }
}

// Collect metadata and generic elements that aren't dynamic page highlights
function scrapePageMetadataAndLinks() {
  // Description/Keywords Meta
  const descMeta = document.querySelector('meta[name="description"]') || 
                    document.querySelector('meta[property="og:description"]');
  if (descMeta) {
    scrapedAccumulator.metadata.description = normalizeWhitespace(descMeta.getAttribute('content'));
  }
  const keywordsMeta = document.querySelector('meta[name="keywords"]');
  if (keywordsMeta) {
    scrapedAccumulator.metadata.keywords = normalizeWhitespace(keywordsMeta.getAttribute('content'));
  }

  // General Anchor links (no visual highlight needed for massive links list)
  const links = document.querySelectorAll('a[href]');
  const seenUrls = new Set();
  links.forEach(a => {
    const text = normalizeWhitespace(a.innerText || a.textContent || '');
    const href = a.getAttribute('href');
    if (text && href && !href.startsWith('javascript:') && !href.startsWith('#')) {
      try {
        const fullUrl = new URL(href, window.location.href).href;
        if (!seenUrls.has(fullUrl)) {
          scrapedAccumulator.links.push({ text, url: fullUrl });
          seenUrls.add(fullUrl);
        }
      } catch (e) {}
    }
  });
}

// Highlight element visually
function highlightElement(el) {
  if (lastHighlightedElement) {
    clearLastHighlight();
  }

  lastHighlightedElement = el;
  lastHighlightedStyles = {
    outline: el.style.outline,
    outlineOffset: el.style.outlineOffset,
    backgroundColor: el.style.backgroundColor,
    transition: el.style.transition
  };

  el.style.outline = '3px solid #ec4899';
  el.style.outlineOffset = '-3px';
  el.style.backgroundColor = 'rgba(236, 72, 153, 0.18)';
  el.style.transition = 'outline 0.1s ease, background-color 0.1s ease';
}

// Clear visual highlight
function clearLastHighlight() {
  if (!lastHighlightedElement) return;
  
  const el = lastHighlightedElement;
  el.style.outline = lastHighlightedStyles.outline || '';
  el.style.outlineOffset = lastHighlightedStyles.outlineOffset || '';
  el.style.backgroundColor = lastHighlightedStyles.backgroundColor || '';
  el.style.transition = lastHighlightedStyles.transition || '';
  
  lastHighlightedElement = null;
  lastHighlightedStyles = {};
}

// PROBLEM 1 — Scroll the page incrementally after load to trigger lazy images
async function scrollPageToBottomAndBack() {
  return new Promise((resolve) => {
    let lastScrollY = window.scrollY;
    const distance = 300;
    const delay = 300;
    let scrollCount = 0;
    const maxScrolls = 50; // Safety limit: max 50 steps (~15,000px)

    // Send initial scrolling status message
    chrome.runtime.sendMessage({
      action: "AUTO_SCRAPE_PROGRESS",
      current: 0,
      total: 0,
      elementType: "Scrolling to load lazy images..."
    });

    function scrollStep() {
      if (!autoScrapeActive) {
        resolve();
        return;
      }

      scrollCount++;
      if (scrollCount >= maxScrolls) {
        chrome.runtime.sendMessage({
          action: "AUTO_SCRAPE_PROGRESS",
          current: 0,
          total: 0,
          elementType: "Reached safety scroll limit, returning to top..."
        });
        setTimeout(() => {
          if (!autoScrapeActive) {
            resolve();
            return;
          }
          window.scrollTo(0, 0);
          resolve();
        }, 1000);
        return;
      }

      window.scrollBy(0, distance);

      setTimeout(() => {
        const currentScrollY = window.scrollY;
        const scrollHeight = document.documentElement.scrollHeight;
        const clientHeight = document.documentElement.clientHeight;

        if (currentScrollY === lastScrollY || currentScrollY + clientHeight >= scrollHeight - 10) {
          // Reached the bottom, pause 2 seconds
          chrome.runtime.sendMessage({
            action: "AUTO_SCRAPE_PROGRESS",
            current: 0,
            total: 0,
            elementType: "Waiting 2s for lazy images..."
          });

          setTimeout(() => {
            if (!autoScrapeActive) {
              resolve();
              return;
            }
            window.scrollTo(0, 0); // Return to top for visual walkthrough
            resolve();
          }, 2000);
        } else {
          lastScrollY = currentScrollY;
          scrollStep();
        }
      }, delay);
    }

    scrollStep();
  });
}

// Helper: Detect if an element is part of a page-level popup, dialog, cookie banner, newsletter, or comparison drawer
function isOverlayOrModal(el) {
  let current = el;
  while (current && current !== document.body) {
    const className = current.getAttribute ? (current.getAttribute('class') || '') : '';
    const id = current.getAttribute ? (current.getAttribute('id') || '') : '';
    const tagName = current.tagName ? current.tagName.toLowerCase() : '';
    const classIdStr = (className + ' ' + id).toLowerCase();

    if (
      /cookie|consent|privacy|onetrust|ot-|compare|modal|popup|popupp|dialog|overlay|drawer|newsletter|banner|menu-drawer|freebie/i.test(classIdStr) ||
      tagName === 'dialog'
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

// Helper: Determine if we should temporarily reveal a hidden element for scraping
function shouldRevealElement(el, root) {
  const tagName = el.tagName.toLowerCase();
  
  // Never reveal scripts, styles, iframes, templates, etc.
  if (['script', 'style', 'noscript', 'iframe', 'template', 'meta', 'link', 'dialog'].includes(tagName)) {
    return false;
  }

  // Walk up parents to check if it's inside a product card or content element
  let current = el;
  let hasCardParent = false;
  let hasFilterParent = false;

  while (current && current !== root && current !== document.body) {
    const parentTagName = current.tagName ? current.tagName.toLowerCase() : '';
    // Exclude header, footer, navigation, and sidebar menus
    if (['header', 'footer', 'nav', 'aside'].includes(parentTagName)) {
      return false;
    }

    const className = current.getAttribute ? (current.getAttribute('class') || '') : '';
    const id = current.getAttribute ? (current.getAttribute('id') || '') : '';
    const name = current.getAttribute ? (current.getAttribute('name') || '') : '';
    const classIdStr = (className + ' ' + id + ' ' + name).toLowerCase();

    // Skip overlays/modals immediately
    if (
      /cookie|consent|privacy|onetrust|ot-|compare|modal|popup|popupp|dialog|overlay|drawer|newsletter|banner|menu-drawer|freebie/i.test(classIdStr)
    ) {
      return false;
    }

    // Detect if inside product card
    if (/card|item|product|grid-item|tile/i.test(classIdStr)) {
      hasCardParent = true;
    }

    // Detect if inside filter
    if (/filter|facet/i.test(classIdStr)) {
      hasFilterParent = true;
    }

    current = current.parentElement;
  }

  // Always reveal if it is part of a product card
  if (hasCardParent) {
    return true;
  }

  // For filter sections, only reveal inputs/labels/spans that might represent selectable options
  if (hasFilterParent && ['input', 'select', 'textarea', 'label', 'span'].includes(tagName)) {
    return true;
  }

  return false;
}

// PROBLEM 6 — Reveal hidden hover-state elements
function revealHiddenElements(root = document.body) {
  const allElements = root.querySelectorAll('*');
  const elementsToReveal = [];

  // Phase 1: Read only (No writes to prevent layout thrashing)
  allElements.forEach(el => {
    try {
      let isNone = false;
      let isHidden = false;

      // Offscreen documents don't have rendered metrics, check style properties directly
      if (root.ownerDocument === document) {
        const style = window.getComputedStyle(el);
        isNone = style.display === 'none';
        isHidden = style.visibility === 'hidden';
      } else {
        const style = el.style || {};
        isNone = style.display === 'none';
        isHidden = style.visibility === 'hidden';
      }

      if (isNone || isHidden) {
        if (shouldRevealElement(el, root)) {
          elementsToReveal.push({ element: el, isNone, isHidden });
        }
      }
    } catch (e) {}
  });

  // Phase 2: Write only (No writes to prevent layout thrashing)
  elementsToReveal.forEach(item => {
    try {
      const el = item.element;
      const tagName = el.tagName.toLowerCase();

      if (root.ownerDocument === document) {
        const originalDisplay = el.style.getPropertyValue('display');
        const originalDisplayPriority = el.style.getPropertyPriority('display');
        const originalVisibility = el.style.getPropertyValue('visibility');
        const originalVisibilityPriority = el.style.getPropertyPriority('visibility');

        elementsRevealed.push({
          element: el,
          originalDisplay,
          originalDisplayPriority,
          originalVisibility,
          originalVisibilityPriority
        });
      }

      if (item.isNone) {
        let defaultDisplay = 'block';
        if (['span', 'a', 'strong', 'em', 'b', 'i', 'img', 'small', 'label', 'input', 'button'].includes(tagName)) {
          defaultDisplay = 'inline-block';
        }
        el.style.setProperty('display', defaultDisplay, 'important');
      }
      if (item.isHidden) {
        el.style.setProperty('visibility', 'visible', 'important');
      }
    } catch (e) {}
  });
}

// PROBLEM 6 — Restore original display / visibility rules
function restoreHiddenElements() {
  elementsRevealed.forEach(item => {
    try {
      if (item.originalDisplay) {
        item.element.style.setProperty('display', item.originalDisplay, item.originalDisplayPriority);
      } else {
        item.element.style.removeProperty('display');
      }

      if (item.originalVisibility) {
        item.element.style.setProperty('visibility', item.originalVisibility, item.originalVisibilityPriority);
      } else {
        item.element.style.removeProperty('visibility');
      }
    } catch (e) {}
  });
  elementsRevealed = [];
}

// PROBLEM 3 — Handle infinite scroll paginated pages asynchronously
async function scrapeSubsequentPages() {
  let currentPageDoc = document;
  let hasNextPage = true;
  let pageCount = 1;
  const maxPages = 15; // safety limit to prevent rate limiting or infinite loop
  const visitedUrls = new Set();

  // Initialize visitedUrls with current and normalized window URL
  const currentNormalized = getNormalizedUrl(window.location.href);
  visitedUrls.add(currentNormalized);
  try {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.search = '';
    visitedUrls.add(cleanUrl.href);
  } catch (e) {}

  while (hasNextPage && autoScrapeActive) {
    if (pageCount >= maxPages) {
      console.log("Reached safety page count limit:", maxPages);
      break;
    }

    // Query all pagination links on current page
    const paginationLinks = currentPageDoc.querySelectorAll('.link-infinity');
    let nextLinkEl = null;
    let nextUrl = null;

    for (const linkEl of paginationLinks) {
      let href = linkEl.getAttribute('href');
      if (!href && linkEl.tagName.toLowerCase() !== 'a') {
        const anchor = linkEl.querySelector('a');
        if (anchor) href = anchor.getAttribute('href');
      }

      if (href) {
        try {
          const absoluteUrl = new URL(href, window.location.href).href;
          const normalizedUrl = getNormalizedUrl(absoluteUrl);
          
          if (!visitedUrls.has(normalizedUrl)) {
            nextLinkEl = linkEl;
            nextUrl = absoluteUrl;
            visitedUrls.add(normalizedUrl);
            break; // Found the next unvisited page link!
          }
        } catch (e) {}
      }
    }

    if (!nextUrl) {
      hasNextPage = false;
      break;
    }

    try {
      // Send progress notification
      chrome.runtime.sendMessage({
        action: "AUTO_SCRAPE_PROGRESS",
        current: autoScrapeElements.length,
        total: autoScrapeElements.length,
        elementType: `Loading page: ${normalizeWhitespace(nextLinkEl.innerText) || nextUrl}`
      });

      const response = await fetch(nextUrl);
      const htmlText = await response.text();
      const parser = new DOMParser();
      const nextDoc = parser.parseFromString(htmlText, 'text/html');

      // Reveal hidden items on offscreen document (for hover state content)
      revealHiddenElements(nextDoc.body);

      // Collect and scrape elements
      const elements = collectScrapableElements(nextDoc.body);
      elements.forEach(item => {
        scrapeSingleElementToAccumulator(item);
      });

      currentPageDoc = nextDoc;
      pageCount++;
      await new Promise(resolve => setTimeout(resolve, 500)); // Respect server request rate
    } catch (error) {
      console.error("Error loading subsequent page:", error);
      hasNextPage = false;
    }
  }
}

// Scrape Loop Driver
function runVisualScrapeStep(delay) {
  if (!autoScrapeActive) return;

  if (autoScrapeIndex >= autoScrapeElements.length) {
    runSubsequentPagesAndFinish();
    return;
  }

  const currentItem = autoScrapeElements[autoScrapeIndex];
  const el = currentItem.element;

  // Check if element is currently visible before animating it
  let isVisible = true;
  try {
    const style = window.getComputedStyle(el);
    isVisible = style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
  } catch (e) {
    isVisible = false;
  }

  if (isVisible) {
    // 1. Visually scroll and highlight
    try {
      const scrollBehavior = delay >= 300 ? 'smooth' : 'auto';
      el.scrollIntoView({ behavior: scrollBehavior, block: 'center' });
      highlightElement(el);
    } catch (e) {}

    // 2. Notify sidepanel of progress
    chrome.runtime.sendMessage({
      action: "AUTO_SCRAPE_PROGRESS",
      current: autoScrapeIndex + 1,
      total: autoScrapeElements.length,
      elementType: currentItem.type
    });

    // 3. Schedule next step
    autoScrapeIndex++;
    autoScrapeTimer = setTimeout(() => runVisualScrapeStep(delay), delay);
  } else {
    // Element is hidden. Skip visual animations and move to next element instantly.
    autoScrapeIndex++;
    autoScrapeTimer = setTimeout(() => runVisualScrapeStep(delay), 0);
  }
}

// Executes subsequent page parsing and finishes pipeline
async function runSubsequentPagesAndFinish() {
  const hasPagination = document.querySelector('.link-infinity') !== null;
  if (hasPagination && autoScrapeActive) {
    chrome.runtime.sendMessage({
      action: "SHOW_PAGINATION_PROMPT"
    });
  } else {
    finishVisualScrape();
  }
}

// Helper: check if webpage is a Shopify collection page
function isShopifyCollectionPage() {
  const isCollectionsUrl = window.location.pathname.includes('/collections/');
  const isProductUrl = window.location.pathname.includes('/products/');
  return isCollectionsUrl && !isProductUrl;
}

// Full pipeline execution block
async function runFullScrapingPipeline(delay) {
  autoScrapeActive = true;
  
  if (isShopifyCollectionPage()) {
    try {
      chrome.runtime.sendMessage({
        action: "AUTO_SCRAPE_PROGRESS",
        current: 1,
        total: 1,
        elementType: "Shopify JSON Catalog"
      });

      let cleanPath = window.location.pathname;
      if (cleanPath.endsWith('/')) {
        cleanPath = cleanPath.slice(0, -1);
      }
      const jsonUrl = `${window.location.origin}${cleanPath}.json?limit=250`;
      
      const response = await fetch(jsonUrl);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();

      if (data && data.products) {
        scrapedAccumulator = {
          url: window.location.href,
          title: document.title,
          isYouTube: false,
          isShopifyCollection: true,
          metadata: {
            description: document.querySelector('meta[name="description"]')?.getAttribute('content') || ""
          },
          products: data.products.map(p => {
            const featuredImage = p.images?.[0]?.src || p.featured_image?.src || "";
            const firstVariant = p.variants?.[0] || {};
            return {
              id: p.id,
              title: p.title,
              handle: p.handle,
              price: firstVariant.price ? parseFloat(firstVariant.price) : 0,
              compareAtPrice: firstVariant.compare_at_price ? parseFloat(firstVariant.compare_at_price) : null,
              imageUrl: featuredImage,
              vendor: p.vendor || "",
              productUrl: `${window.location.origin}/products/${p.handle}`
            };
          }),
          headers: [],
          lists: [],
          tables: [],
          links: [],
          images: [],
          paragraphs: [],
          buttons: [],
          inputs: [],
          cards: [],
          inlineTexts: [],
          flow: []
        };

        finishVisualScrape();
        return;
      }
    } catch (error) {
      console.warn("Failed to fetch Shopify collection JSON, falling back to DOM scraping:", error);
    }
  }

  // Initialize result format
  scrapedAccumulator = {
    url: window.location.href,
    title: document.title,
    isYouTube: isYouTubeWatchPage(),
    metadata: {},
    headers: [],
    lists: [],
    tables: [],
    links: [],
    images: [],
    paragraphs: [],
    buttons: [],
    inputs: [],
    cards: [],
    inlineTexts: [],
    flow: []
  };

  if (scrapedAccumulator.isYouTube) {
    scrapedAccumulator.youtube = initYouTubeData();
  }

  // Pre-scrape metadata and background anchors
  scrapePageMetadataAndLinks();

  // 1. Scroll dynamically to trigger all lazy-loaded products
  if (delay > 0) {
    await scrollPageToBottomAndBack();
  }

  if (!autoScrapeActive) return; // Terminated early

  // 2. Temporarily display CSS hidden products & add to cart controls
  revealHiddenElements(document.body);

  // 3. Gather scrapable tags from Page 1
  autoScrapeElements = collectScrapableElements(document.body);
  autoScrapeIndex = 0;

  // 4. Perform the DOM scraping instantly while elements are revealed!
  autoScrapeElements.forEach(item => {
    scrapeSingleElementToAccumulator(item);
  });

  // 5. Restore CSS styles immediately so the page looks normal again!
  restoreHiddenElements();

  const total = autoScrapeElements.length;
  if (total === 0 || delay === 0) {
    runSubsequentPagesAndFinish();
    return;
  }

  // 6. Run highlight walkthrough animation (only scrolls and highlights)
  runVisualScrapeStep(delay);
}

// Starts the visual auto-scraper walkthrough (Legacy entry point support)
function startVisualAutoScrape(customDelay) {
  const delay = customDelay ? parseInt(customDelay, 10) : 300;
  cleanupVisualSelector();
  runFullScrapingPipeline(delay);
  return 0;
}

// Finishes the visual scrape and sends results to sidepanel
function finishVisualScrape() {
  if (!autoScrapeActive) return;

  autoScrapeActive = false;
  clearLastHighlight();
  restoreHiddenElements();
  if (autoScrapeTimer) clearTimeout(autoScrapeTimer);

  chrome.runtime.sendMessage({
    action: "AUTO_SCRAPE_COMPLETE",
    data: scrapedAccumulator
  });
}

// Instantly stops the visual scraper loop and saves what has been scraped so far
function stopVisualScrapeEarly() {
  if (!autoScrapeActive) return;
  restoreHiddenElements();
  finishVisualScrape();
}

// --- Visual Crop Selector Actions (Click & Drag Crop Range Selector) ---

function injectCropStyles() {
  if (document.getElementById('scraper-crop-styles')) return;
  const style = document.createElement('style');
  style.id = 'scraper-crop-styles';
  style.textContent = `
    #scraper-crop-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background-color: rgba(11, 15, 25, 0.45);
      backdrop-filter: blur(1.5px);
      z-index: 99999999;
      cursor: crosshair;
      user-select: none;
      touch-action: none;
    }
    #scraper-crop-box {
      position: absolute;
      border: 2.5px dashed #ec4899;
      background-color: rgba(236, 72, 153, 0.05);
      box-shadow: 0 0 0 99999px rgba(11, 15, 25, 0.6);
      display: none;
      z-index: 100000000;
      box-sizing: border-box;
    }
    #scraper-crop-box-inside {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      cursor: move;
      z-index: 1;
    }
    .crop-handle {
      position: absolute;
      width: 12px;
      height: 12px;
      background-color: #ec4899;
      border: 2px solid #ffffff;
      border-radius: 50%;
      z-index: 10;
      box-sizing: border-box;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    }
    .crop-handle-tl { top: -6px; left: -6px; cursor: nwse-resize; }
    .crop-handle-tr { top: -6px; right: -6px; cursor: nesw-resize; }
    .crop-handle-bl { bottom: -6px; left: -6px; cursor: nesw-resize; }
    .crop-handle-br { bottom: -6px; right: -6px; cursor: nwse-resize; }
    
    #scraper-crop-controls {
      position: absolute;
      bottom: -60px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 10px;
      background: #131b2e;
      border: 1px solid rgba(236, 72, 153, 0.45);
      padding: 8px 16px;
      border-radius: 10px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5), 0 0 15px rgba(236, 72, 153, 0.15);
      pointer-events: auto;
      white-space: nowrap;
      z-index: 100000001;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }
    #scraper-crop-count {
      color: #f8fafc;
      font-size: 13px;
      font-weight: 500;
    }
    .scraper-crop-btn {
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 6px;
      border: 1px solid transparent;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.2s;
    }
    .scraper-crop-btn-primary {
      background: linear-gradient(135deg, #ec4899 0%, #db2777 100%);
      color: #ffffff;
      box-shadow: 0 2px 8px rgba(236, 72, 153, 0.25);
    }
    .scraper-crop-btn-primary:hover {
      background: #db2777;
      transform: translateY(-1px);
    }
    .scraper-crop-btn-secondary {
      background-color: #1e294b;
      border: 1px solid rgba(255,255,255,0.08);
      color: #94a3b8;
    }
    .scraper-crop-btn-secondary:hover {
      background-color: rgba(255,255,255,0.05);
      color: #f8fafc;
    }
    
    .crop-element-highlight {
      outline: 2px solid #ec4899 !important;
      outline-offset: -2px !important;
      background-color: rgba(236, 72, 153, 0.12) !important;
      transition: outline 0.1s ease, background-color 0.1s ease !important;
    }
  `;
  document.head.appendChild(style);
}

function setupCropOverlay() {
  injectCropStyles();
  
  if (document.getElementById('scraper-crop-overlay')) return;
  
  // Disable page scrolling
  document.body.style.overflow = 'hidden';
  
  // Gather visual elements once on load
  allVisualElements = collectScrapableElements(document.body);
  
  const overlay = document.createElement('div');
  overlay.id = 'scraper-crop-overlay';
  
  const cropBox = document.createElement('div');
  cropBox.id = 'scraper-crop-box';
  
  const inside = document.createElement('div');
  inside.id = 'scraper-crop-box-inside';
  cropBox.appendChild(inside);
  
  const handles = ['tl', 'tr', 'bl', 'br'];
  handles.forEach(h => {
    const handleEl = document.createElement('div');
    handleEl.className = `crop-handle crop-handle-${h}`;
    handleEl.dataset.handle = h;
    cropBox.appendChild(handleEl);
  });
  
  const controls = document.createElement('div');
  controls.id = 'scraper-crop-controls';
  controls.innerHTML = `
    <span id="scraper-crop-count">0 items selected</span>
    <button id="scraper-crop-btn-scrape" class="scraper-crop-btn scraper-crop-btn-primary">Scrape Area</button>
    <button id="scraper-crop-btn-cancel" class="scraper-crop-btn scraper-crop-btn-secondary">Cancel</button>
  `;
  controls.addEventListener('pointerdown', (e) => e.stopPropagation());
  cropBox.appendChild(controls);
  
  overlay.appendChild(cropBox);
  document.body.appendChild(overlay);
  
  overlay.addEventListener('pointerdown', handleCropPointerDown);
  overlay.addEventListener('pointermove', handleCropPointerMove);
  overlay.addEventListener('pointerup', handleCropPointerUp);
  
  document.getElementById('scraper-crop-btn-scrape').addEventListener('click', scrapeCroppedElements);
  document.getElementById('scraper-crop-btn-cancel').addEventListener('click', cleanupCropOverlay);
}

function handleCropPointerDown(e) {
  const target = e.target;
  const overlay = document.getElementById('scraper-crop-overlay');
  const cropBox = document.getElementById('scraper-crop-box');
  
  pointerDownTime = Date.now();
  pointerDownPosition = { x: e.clientX, y: e.clientY };
  
  const controls = document.getElementById('scraper-crop-controls');
  
  if (target.classList.contains('crop-handle')) {
    e.stopPropagation();
    isResizing = true;
    activeHandle = target.dataset.handle;
    startPoint = { x: e.clientX, y: e.clientY };
    initialBoxRect = { ...cropBoxRect };
    target.setPointerCapture(e.pointerId);
    if (controls) controls.style.display = 'none';
  } else if (target.id === 'scraper-crop-box-inside') {
    e.stopPropagation();
    isMoving = true;
    startPoint = { x: e.clientX, y: e.clientY };
    initialBoxRect = { ...cropBoxRect };
    target.setPointerCapture(e.pointerId);
    if (controls) controls.style.display = 'none';
  } else if (target.id === 'scraper-crop-overlay') {
    isDrawing = true;
    startPoint = { x: e.clientX, y: e.clientY };
    cropBoxRect = { left: startPoint.x, top: startPoint.y, width: 0, height: 0 };
    
    if (controls) controls.style.display = 'none';
    
    clearCropHighlights();
    
    cropBox.style.left = startPoint.x + 'px';
    cropBox.style.top = startPoint.y + 'px';
    cropBox.style.width = '0px';
    cropBox.style.height = '0px';
    cropBox.style.display = 'block';
    
    overlay.setPointerCapture(e.pointerId);
  }
}

function handleCropPointerMove(e) {
  if (isDrawing) {
    const x = e.clientX;
    const y = e.clientY;
    const left = Math.min(startPoint.x, x);
    const top = Math.min(startPoint.y, y);
    const width = Math.abs(startPoint.x - x);
    const height = Math.abs(startPoint.y - y);
    
    setCropBoxBounds(left, top, width, height);
    updateCroppedElementsHighlight();
  } else if (isResizing) {
    const dx = e.clientX - startPoint.x;
    const dy = e.clientY - startPoint.y;
    let left = initialBoxRect.left;
    let top = initialBoxRect.top;
    let width = initialBoxRect.width;
    let height = initialBoxRect.height;
    
    if (activeHandle === 'br') {
      width = Math.max(10, initialBoxRect.width + dx);
      height = Math.max(10, initialBoxRect.height + dy);
    } else if (activeHandle === 'tr') {
      width = Math.max(10, initialBoxRect.width + dx);
      height = Math.max(10, initialBoxRect.height - dy);
      top = initialBoxRect.top + (initialBoxRect.height - height);
    } else if (activeHandle === 'bl') {
      width = Math.max(10, initialBoxRect.width - dx);
      left = initialBoxRect.left + (initialBoxRect.width - width);
      height = Math.max(10, initialBoxRect.height + dy);
    } else if (activeHandle === 'tl') {
      width = Math.max(10, initialBoxRect.width - dx);
      left = initialBoxRect.left + (initialBoxRect.width - width);
      height = Math.max(10, initialBoxRect.height - dy);
      top = initialBoxRect.top + (initialBoxRect.height - height);
    }
    
    left = Math.max(0, left);
    top = Math.max(0, top);
    if (left + width > window.innerWidth) width = window.innerWidth - left;
    if (top + height > window.innerHeight) height = window.innerHeight - top;
    
    setCropBoxBounds(left, top, width, height);
    updateCroppedElementsHighlight();
  } else if (isMoving) {
    const dx = e.clientX - startPoint.x;
    const dy = e.clientY - startPoint.y;
    let left = initialBoxRect.left + dx;
    let top = initialBoxRect.top + dy;
    
    left = Math.max(0, Math.min(window.innerWidth - initialBoxRect.width, left));
    top = Math.max(0, Math.min(window.innerHeight - initialBoxRect.height, top));
    
    setCropBoxBounds(left, top, initialBoxRect.width, initialBoxRect.height);
    updateCroppedElementsHighlight();
  }
}

function handleCropPointerUp(e) {
  const overlay = document.getElementById('scraper-crop-overlay');
  const cropBox = document.getElementById('scraper-crop-box');
  
  if (isDrawing) {
    isDrawing = false;
    overlay.releasePointerCapture(e.pointerId);
  } else if (isResizing) {
    isResizing = false;
    activeHandle = null;
    if (e.target && typeof e.target.releasePointerCapture === 'function') {
      try { e.target.releasePointerCapture(e.pointerId); } catch (err) {}
    }
  } else if (isMoving) {
    isMoving = false;
    if (e.target && typeof e.target.releasePointerCapture === 'function') {
      try { e.target.releasePointerCapture(e.pointerId); } catch (err) {}
    }
  } else {
    return;
  }
  
  const clickDuration = Date.now() - pointerDownTime;
  const dragDistance = Math.hypot(e.clientX - pointerDownPosition.x, e.clientY - pointerDownPosition.y);
  
  if (clickDuration < 300 && dragDistance < 5) {
    const el = getElementAtPoint(e.clientX, e.clientY);
    if (el) {
      let targetElement = null;
      let current = el;
      const scrapableMap = new Map(allVisualElements.map(item => [item.element, item]));
      
      while (current && current !== document.body) {
        if (scrapableMap.has(current)) {
          targetElement = scrapableMap.get(current);
          break;
        }
        current = current.parentElement;
      }
      
      if (targetElement) {
        const rect = targetElement.element.getBoundingClientRect();
        setCropBoxBounds(rect.left, rect.top, rect.width, rect.height);
        updateCroppedElementsHighlight();
      } else {
        cropBox.style.display = 'none';
        clearCropHighlights();
        return;
      }
    } else {
      cropBox.style.display = 'none';
      clearCropHighlights();
      return;
    }
  }
  
  const controls = document.getElementById('scraper-crop-controls');
  if (controls) {
    controls.style.display = 'flex';
    // Dynamically adjust controls placement to prevent them going off-screen at the bottom of the viewport
    const boxBottom = cropBoxRect.top + cropBoxRect.height;
    if (boxBottom + 70 > window.innerHeight) {
      if (cropBoxRect.top > 70) {
        // Place above the crop box
        controls.style.bottom = 'auto';
        controls.style.top = '-60px';
      } else {
        // Close to both top and bottom, place inside the box near the bottom
        controls.style.bottom = '10px';
        controls.style.top = 'auto';
      }
    } else {
      // Default: place below the crop box
      controls.style.bottom = '-60px';
      controls.style.top = 'auto';
    }
  }
}

function getElementAtPoint(x, y) {
  const overlay = document.getElementById('scraper-crop-overlay');
  if (overlay) overlay.style.pointerEvents = 'none';
  
  const box = document.getElementById('scraper-crop-box');
  if (box) box.style.pointerEvents = 'none';
  
  let el = document.elementFromPoint(x, y);
  
  if (overlay) overlay.style.pointerEvents = 'auto';
  if (box) box.style.pointerEvents = 'auto';
  
  return el;
}

function setCropBoxBounds(left, top, width, height) {
  cropBoxRect = { left, top, width, height };
  const cropBox = document.getElementById('scraper-crop-box');
  if (cropBox) {
    cropBox.style.left = left + 'px';
    cropBox.style.top = top + 'px';
    cropBox.style.width = width + 'px';
    cropBox.style.height = height + 'px';
    cropBox.style.display = 'block';
  }
}

function updateCroppedElementsHighlight() {
  clearCropHighlights();
  
  croppedElements = [];
  
  const overlapping = allVisualElements.filter(item => {
    const rect = item.element.getBoundingClientRect();
    return (
      rect.left < cropBoxRect.left + cropBoxRect.width &&
      rect.left + rect.width > cropBoxRect.left &&
      rect.top < cropBoxRect.top + cropBoxRect.height &&
      rect.top + rect.height > cropBoxRect.top
    );
  });
  
  const selectedContainers = new Set(
    overlapping
      .filter(item => item.type === 'container-card')
      .map(item => item.id)
  );
  
  croppedElements = overlapping.filter(item => {
    if (item.parentId && selectedContainers.has(item.parentId)) {
      return false;
    }
    return true;
  });
  
  croppedElements.forEach(item => {
    item.element.classList.add('crop-element-highlight');
  });
  
  const countEl = document.getElementById('scraper-crop-count');
  if (countEl) {
    countEl.textContent = `${croppedElements.length} item${croppedElements.length === 1 ? '' : 's'} selected`;
  }
}

function clearCropHighlights() {
  const highlighted = document.querySelectorAll('.crop-element-highlight');
  highlighted.forEach(el => {
    el.classList.remove('crop-element-highlight');
  });
}

function cleanupCropOverlay() {
  document.body.style.overflow = '';
  clearCropHighlights();
  
  const overlay = document.getElementById('scraper-crop-overlay');
  if (overlay) {
    overlay.remove();
  }
  
  const styles = document.getElementById('scraper-crop-styles');
  if (styles) {
    styles.remove();
  }
  
  allVisualElements = [];
  croppedElements = [];
  cropBoxRect = { left: 0, top: 0, width: 0, height: 0 };
  
  chrome.runtime.sendMessage({
    action: "DEACTIVATE_SELECTOR_CONFIRMED"
  });
}

function scrapeCroppedElements() {
  if (croppedElements.length === 0) return;
  
  scrapedAccumulator = {
    url: window.location.href,
    title: document.title,
    isYouTube: isYouTubeWatchPage(),
    metadata: {},
    headers: [],
    lists: [],
    tables: [],
    links: [],
    images: [],
    paragraphs: [],
    buttons: [],
    inputs: [],
    cards: [],
    inlineTexts: [],
    flow: []
  };

  if (scrapedAccumulator.isYouTube) {
    scrapedAccumulator.youtube = initYouTubeData();
  }

  scrapePageMetadataAndLinks();
  
  const overlapping = allVisualElements.filter(item => {
    const rect = item.element.getBoundingClientRect();
    return (
      rect.left < cropBoxRect.left + cropBoxRect.width &&
      rect.left + rect.width > cropBoxRect.left &&
      rect.top < cropBoxRect.top + cropBoxRect.height &&
      rect.top + rect.height > cropBoxRect.top
    );
  });
  
  overlapping.forEach(item => {
    scrapeSingleElementToAccumulator(item);
  });
  
  selectorActive = false;
  cleanupCropOverlay();
  
  chrome.runtime.sendMessage({
    action: "AUTO_SCRAPE_COMPLETE",
    data: scrapedAccumulator
  });
}

function activateVisualSelector() {
  if (selectorActive) return;
  
  if (autoScrapeActive) {
    stopVisualScrapeEarly();
  }

  selectorActive = true;
  setupCropOverlay();
}

function cleanupVisualSelector() {
  if (!selectorActive) return;
  selectorActive = false;
  cleanupCropOverlay();
}

// Handle incoming messages from sidepanel.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "START_AUTO_SCRAPE_ANIMATION") {
    try {
      // Respond immediately to prevent chrome.runtime.sendMessage timeouts
      sendResponse({ success: true, total: 'Initializing...' });
      const delay = message.delay ? parseInt(message.delay, 10) : 300;
      cleanupVisualSelector();
      runFullScrapingPipeline(delay);
    } catch (err) {
      console.error(err);
    }
  } else if (message.action === "STOP_AUTO_SCRAPE") {
    stopVisualScrapeEarly();
    sendResponse({ success: true });
  } else if (message.action === "ACTIVATE_SELECTOR") {
    activateVisualSelector();
    sendResponse({ success: true });
  } else if (message.action === "DEACTIVATE_SELECTOR") {
    cleanupVisualSelector();
    sendResponse({ success: true });
  } else if (message.action === "CONTINUE_PAGINATION") {
    if (autoScrapeActive) {
      scrapeSubsequentPages().then(() => {
        finishVisualScrape();
      });
    }
    sendResponse({ success: true });
  } else if (message.action === "STOP_PAGINATION") {
    if (autoScrapeActive) {
      finishVisualScrape();
    }
    sendResponse({ success: true });
  }
  return true; // Keep channel open
});
