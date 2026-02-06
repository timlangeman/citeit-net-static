/**
 * CiteIt Quote Context - Utility Functions
 * @file Utility functions for CiteIt React components
 * @see https://github.com/CiteIt/citeit-jquery
 */

/** @const {boolean} Enable debug logging */
const CITEIT_DEBUG = false;

/** @const {string} CiteIt.net API version */
const WEBSERVICE_VERSION = "0.4";

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

/**
 * Removes the protocol and trailing slash from a URL.
 * @param {string} url - The URL to process
 * @returns {string} URL without protocol or trailing slash
 */
export function urlWithoutProtocol(url) {
    const urlNoSlash = url.replace(/\/$/, "");
    return urlNoSlash.replace(/^https?:\/\//i, "");
}

/**
 * Removes characters with specified Unicode code points from a string.
 * @param {string} str - The string to normalize
 * @param {Set<number>} escapeCodePoints - Code points to remove
 * @returns {string} The normalized string
 */
export function normalizeText(str, escapeCodePoints) {
    const result = [];
    Array.from(str).forEach(function processChar(chr) {
        const code = chr.codePointAt(0);
        if (!escapeCodePoints.has(code)) {
            result.push(chr);
        }
    });
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
    let domain;
    if (url.indexOf("://") > -1) {
        domain = url.split("/")[2];
    } else {
        domain = url.split("/")[0];
    }
    return domain.split(":")[0];
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
    const regexp = /^[0-9a-fA-F]+$/;
    return regexp.test(str);
}

/**
 * Checks if a URL is a WordPress preview URL.
 * @param {string} citingUrl - The URL to check
 * @returns {boolean} True if the URL is a WordPress preview
 */
export function isWordpressPreview(citingUrl) {
    if (!citingUrl.split("?")[1]) {
        return false;
    }
    const urlParams = new URLSearchParams(citingUrl.split("?")[1]);
    const pId = urlParams.get("preview_id");
    const pNonce = urlParams.get("preview_nonce");
    const isP = urlParams.get("preview");

    return isP && isInt(pId) && isHexadecimal(pNonce);
}

/**
 * Validates that a string is a valid HTTP or HTTPS URL.
 * @param {string} string - The URL string to validate
 * @returns {boolean} True if valid HTTP/HTTPS URL
 */
export function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch (ignore) {
        return false;
    }
}

/**
 * Gets the appropriate popup width based on screen size.
 * @returns {number} The popup width in pixels
 */
export function getPopupWidth() {
    const w = window.screen.availWidth;
    return w <= 480 ? 340 : 375;
}

/**
 * Builds the API URL for fetching quote context.
 * @param {string} hashValue - The SHA256 hash of the quote
 * @returns {string} The complete API URL
 */
export function buildReadUrl(hashValue) {
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
