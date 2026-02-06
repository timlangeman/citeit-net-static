/**
 * CiteIt Quote Context - Utility Functions
 * @file Utility functions for CiteIt React components
 * @see https://github.com/CiteIt/citeit-jquery
 */

/** @const {boolean} Enable debug logging */
const CITEIT_DEBUG = false;

/** @const {string} CiteIt.net API version */
const WEBSERVICE_VERSION = "0.4";

/** @const {RegExp} SHA256 validation pattern */
const SHA256_REGEX = /^[0-9a-f]{64}$/i;

/** @const {RegExp} Safe ID pattern */
const SAFE_ID_REGEX = /[^\-a-zA-Z0-9_]/g;

/** @const {RegExp} Protocol pattern */
const PROTOCOL_REGEX = /^https?:\/\//i;

/** @const {RegExp} Trailing slash pattern */
const TRAILING_SLASH_REGEX = /\/$/;

/** @const {Set<number>} Unicode code points to escape from URLs */
const URL_ESCAPE_CODE_POINTS = new Set([10, 20, 160]);

/** @const {Set<number>} Unicode code points to escape from quote text */
const TEXT_ESCAPE_CODE_POINTS = new Set([
    2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    24, 25, 26, 27, 28, 29, 30, 31, 32, 34,
    39, 96, 160, 173, 699, 700, 701, 702, 703,
    712, 713, 714, 715, 716, 717, 718, 719,
    732, 733, 750, 757, 8211, 8212, 8213,
    8216, 8217, 8219, 8220, 8221, 8222, 8223,
    8226, 8229, 8203, 8204, 8205, 65279,
    8232, 8233, 133, 5760, 6158, 8192, 8193,
    8194, 8195, 8196, 8197, 8198, 8199, 8200,
    8201, 8202, 8239, 8287, 8288, 12288
]);

/** @const {Object} HTML entities for XSS prevention */
const HTML_ENTITIES = {
    "&": "&amp;",
    "'": "&#x27;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;"
};

// ============ Request Cache (Performance) ============

/** @type {Map<string, Object|null>} Cache for completed API requests */
const completedRequests = new Map();

/** @type {Set<string>} Set of pending request hashes */
const pendingRequests = new Set();

/** @type {Map<string, Array<Function>>} Callbacks waiting for pending requests */
const pendingCallbacks = new Map();

/** @const {number} Maximum cache size to prevent memory leaks */
const MAX_CACHE_SIZE = 500;

/** @type {number|null} Cached popup width */
let cachedPopupWidth = null;

/**
 * Checks if a request is cached.
 * @param {string} hashValue - The SHA256 hash
 * @returns {boolean} True if cached
 */
export function isCached(hashValue) {
    return completedRequests.has(hashValue);
}

/**
 * Gets cached data for a hash.
 * @param {string} hashValue - The SHA256 hash
 * @returns {Object|null} The cached data or null
 */
export function getCached(hashValue) {
    return completedRequests.get(hashValue) || null;
}

/**
 * Sets cached data for a hash.
 * @param {string} hashValue - The SHA256 hash
 * @param {Object|null} data - The data to cache
 */
export function setCached(hashValue, data) {
    // Prevent cache from growing too large
    if (completedRequests.size >= MAX_CACHE_SIZE) {
        const firstKey = completedRequests.keys().next().value;
        completedRequests.delete(firstKey);
    }
    completedRequests.set(hashValue, data);
}

/**
 * Checks if a request is pending.
 * @param {string} hashValue - The SHA256 hash
 * @returns {boolean} True if pending
 */
export function isPending(hashValue) {
    return pendingRequests.has(hashValue);
}

/**
 * Marks a request as pending.
 * @param {string} hashValue - The SHA256 hash
 */
export function setPending(hashValue) {
    pendingRequests.add(hashValue);
}

/**
 * Marks a request as complete and removes from pending.
 * @param {string} hashValue - The SHA256 hash
 */
export function setComplete(hashValue) {
    pendingRequests.delete(hashValue);
    // Notify any waiting callbacks
    const callbacks = pendingCallbacks.get(hashValue);
    if (callbacks) {
        const data = getCached(hashValue);
        callbacks.forEach(function notifyCallback(cb) {
            cb(data);
        });
        pendingCallbacks.delete(hashValue);
    }
}

/**
 * Adds a callback to be notified when a pending request completes.
 * @param {string} hashValue - The SHA256 hash
 * @param {Function} callback - The callback function
 */
export function onPendingComplete(hashValue, callback) {
    if (!pendingCallbacks.has(hashValue)) {
        pendingCallbacks.set(hashValue, []);
    }
    pendingCallbacks.get(hashValue).push(callback);
}

/**
 * Clears the entire cache (useful for testing).
 */
export function clearCache() {
    completedRequests.clear();
    pendingRequests.clear();
    pendingCallbacks.clear();
}

// ============ Logging ============

/**
 * Logs a message to the console if debug mode is enabled.
 * @param {string} msg - The message to log
 * @returns {void}
 */
export function clog(msg) {
    if (CITEIT_DEBUG) {
        // eslint-disable-next-line no-console
        console.log(msg);
    }
}

// ============ Security Functions ============

/**
 * Escapes HTML entities to prevent XSS attacks.
 * @param {string} str - The string to escape
 * @returns {string} The escaped string
 */
export function escapeHtml(str) {
    if (typeof str !== "string") {
        return "";
    }
    return str.replace(/[&<>"']/g, function replaceEntity(char) {
        return HTML_ENTITIES[char];
    });
}

/**
 * Validates a SHA256 hash string.
 * @param {string} hash - The hash to validate
 * @returns {boolean} True if valid 64-digit hexadecimal string
 */
export function isValidSha256(hash) {
    return typeof hash === "string" && SHA256_REGEX.test(hash);
}

/**
 * Validates that a string is a valid HTTP or HTTPS URL.
 * @param {string} string - The URL string to validate
 * @returns {boolean} True if valid HTTP/HTTPS URL
 */
export function isValidUrl(string) {
    if (!string || typeof string !== "string") {
        return false;
    }
    // Basic length check to prevent ReDoS
    if (string.length > 2048) {
        return false;
    }
    try {
        const url = new URL(string);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch (ignore) {
        return false;
    }
}

/**
 * Sanitizes an ID string for safe use in HTML element IDs.
 * @param {string} id - The ID to sanitize
 * @returns {string} The sanitized ID
 */
export function sanitizeId(id) {
    if (typeof id !== "string") {
        return "";
    }
    // Limit length to prevent abuse
    const truncated = id.slice(0, 128);
    return truncated.replace(SAFE_ID_REGEX, "");
}

/**
 * Sanitizes a URL for safe HTML usage.
 * @param {string} url - The URL to sanitize
 * @returns {string} The sanitized URL or "#" if invalid
 */
export function sanitizeUrl(url) {
    if (!isValidUrl(url)) {
        return "#";
    }
    return escapeHtml(url);
}

/**
 * Validates API response structure.
 * @param {Object} json - The API response
 * @returns {boolean} True if response is valid
 */
export function isValidApiResponse(json) {
    if (!json || typeof json !== "object") {
        return false;
    }
    if (!isValidSha256(json.sha256)) {
        return false;
    }
    if (!isValidUrl(json.cited_url)) {
        return false;
    }
    // Validate text fields exist and are strings
    if (typeof json.citing_quote !== "string") {
        return false;
    }
    if (typeof json.cited_context_before !== "string") {
        return false;
    }
    if (typeof json.cited_context_after !== "string") {
        return false;
    }
    return true;
}

// ============ Text Processing ============

/**
 * Removes the protocol and trailing slash from a URL.
 * @param {string} url - The URL to process
 * @returns {string} URL without protocol or trailing slash
 */
export function urlWithoutProtocol(url) {
    if (typeof url !== "string") {
        return "";
    }
    const urlNoSlash = url.replace(TRAILING_SLASH_REGEX, "");
    return urlNoSlash.replace(PROTOCOL_REGEX, "");
}

/**
 * Removes characters with specified Unicode code points from a string.
 * @param {string} str - The string to normalize
 * @param {Set<number>} escapeCodePoints - Code points to remove
 * @returns {string} The normalized string
 */
export function normalizeText(str, escapeCodePoints) {
    if (typeof str !== "string") {
        return "";
    }
    const result = [];
    const chars = Array.from(str);
    const len = chars.length;
    for (let i = 0; i < len; i += 1) {
        const chr = chars[i];
        const code = chr.codePointAt(0);
        if (!escapeCodePoints.has(code)) {
            result.push(chr);
        }
    }
    return result.join("");
}

/**
 * Escapes problematic characters from a URL string.
 * @param {string} str - The URL string to escape
 * @returns {string} The escaped URL string
 */
export function escapeUrl(str) {
    return normalizeText(str, URL_ESCAPE_CODE_POINTS);
}

/**
 * Escapes problematic characters from a quote string.
 * @param {string} str - The quote string to escape
 * @returns {string} The escaped quote string
 */
export function escapeQuote(str) {
    if (typeof str !== "string") {
        return "";
    }
    const noQuotes = str.replaceAll('"', "");
    return normalizeText(noQuotes, TEXT_ESCAPE_CODE_POINTS);
}

/**
 * Creates a consistent hash key from quote and URL components.
 * @param {string} citingQuote - The quote text
 * @param {string} citingUrl - The URL of the page containing the quote
 * @param {string} citedUrl - The URL being cited
 * @returns {string} A pipe-delimited hash key string
 */
export function quoteHashKey(citingQuote, citingUrl, citedUrl) {
    return (
        escapeQuote(citingQuote) +
        "|" +
        urlWithoutProtocol(escapeUrl(citingUrl)) +
        "|" +
        urlWithoutProtocol(escapeUrl(citedUrl))
    );
}

/**
 * Extracts the domain/hostname from a URL.
 * @param {string} url - The URL to extract domain from
 * @returns {string} The domain name
 */
export function extractDomain(url) {
    if (!isValidUrl(url)) {
        return "";
    }
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch (ignore) {
        return "";
    }
}

/**
 * Checks if a value can be parsed as an integer.
 * @param {*} data - The value to check
 * @returns {boolean} True if the value is a valid integer
 */
export function isInt(data) {
    return Number.isInteger(parseInt(data, 10));
}

/**
 * Checks if a string contains only hexadecimal characters.
 * @param {string} str - The string to check
 * @returns {boolean} True if string is hexadecimal
 */
export function isHexadecimal(str) {
    if (typeof str !== "string" || str.length === 0) {
        return false;
    }
    const regexp = /^[0-9a-fA-F]+$/;
    return regexp.test(str);
}

/**
 * Checks if a URL is a WordPress preview URL.
 * @param {string} citingUrl - The URL to check
 * @returns {boolean} True if the URL is a WordPress preview
 */
export function isWordpressPreview(citingUrl) {
    if (!citingUrl || typeof citingUrl !== "string") {
        return false;
    }
    const queryIndex = citingUrl.indexOf("?");
    if (queryIndex === -1) {
        return false;
    }
    try {
        const urlParams = new URLSearchParams(citingUrl.slice(queryIndex + 1));
        const pId = urlParams.get("preview_id");
        const pNonce = urlParams.get("preview_nonce");
        const isP = urlParams.get("preview");
        return Boolean(isP && isInt(pId) && isHexadecimal(pNonce));
    } catch (ignore) {
        return false;
    }
}

/**
 * Gets the appropriate popup width based on screen size.
 * @returns {number} The popup width in pixels
 */
export function getPopupWidth() {
    // Return cached value if available
    if (cachedPopupWidth !== null) {
        return cachedPopupWidth;
    }
    const w = window.screen.availWidth;
    if (w <= 320) {
        cachedPopupWidth = 300;
    } else if (w <= 480) {
        cachedPopupWidth = 340;
    } else if (w <= 640) {
        cachedPopupWidth = 640;
    } else if (w <= 768) {
        cachedPopupWidth = 755;
    } else {
        cachedPopupWidth = 375;
    }
    return cachedPopupWidth;
}

/**
 * Builds the API URL for fetching quote context.
 * @param {string} hashValue - The SHA256 hash of the quote
 * @returns {string} The complete API URL
 */
export function buildReadUrl(hashValue) {
    if (!isValidSha256(hashValue)) {
        return "";
    }
    const shard = hashValue.substring(0, 2);
    const baseUrl = "https://read.citeit.net/quote/sha256/";
    return (
        baseUrl +
        WEBSERVICE_VERSION +
        "/" +
        shard +
        "/" +
        hashValue +
        ".json"
    );
}

/**
 * Gets the current page URL without the hash fragment.
 * @returns {string} The current page URL
 */
export function getCurrentPageUrl() {
    return window.location.href.split("#")[0];
}

export { CITEIT_DEBUG, WEBSERVICE_VERSION };
