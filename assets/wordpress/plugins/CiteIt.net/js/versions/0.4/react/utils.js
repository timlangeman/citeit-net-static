/**
 * CiteIt Quote Context - Utility Functions
 * https://github.com/CiteIt/citeit-jquery
 */

const CITEIT_DEBUG = false;
const WEBSERVICE_VERSION = "0.4";

const URL_ESCAPE_CODE_POINTS = new Set([10, 20, 160]);

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

export function clog(msg) {
    if (CITEIT_DEBUG) {
        console.log(msg);
    }
}

export function urlWithoutProtocol(url) {
    const urlNoSlash = url.replace(/\/$/, "");
    return urlNoSlash.replace(/^https?:\/\//i, "");
}

export function normalizeText(str, escapeCodePoints) {
    const result = [];
    Array.from(str).forEach((chr) => {
        const code = chr.codePointAt(0);
        if (!escapeCodePoints.has(code)) {
            result.push(chr);
        }
    });
    return result.join("");
}

export function escapeUrl(str) {
    return normalizeText(str, URL_ESCAPE_CODE_POINTS);
}

export function escapeQuote(str) {
    const noQuotes = str.replaceAll('"', "");
    return normalizeText(noQuotes, TEXT_ESCAPE_CODE_POINTS);
}

export function quoteHashKey(citingQuote, citingUrl, citedUrl) {
    return (
        escapeQuote(citingQuote) +
        "|" +
        urlWithoutProtocol(escapeUrl(citingUrl)) +
        "|" +
        urlWithoutProtocol(escapeUrl(citedUrl))
    );
}

export function extractDomain(url) {
    let domain;
    if (url.indexOf("://") > -1) {
        domain = url.split("/")[2];
    } else {
        domain = url.split("/")[0];
    }
    return domain.split(":")[0];
}

export function isInt(data) {
    return Number.isInteger(parseInt(data, 10));
}

export function isHexadecimal(str) {
    const regexp = /^[0-9a-fA-F]+$/;
    return regexp.test(str);
}

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

export function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

export function getPopupWidth() {
    const w = window.screen.availWidth;
    return w <= 480 ? 340 : 375;
}

export function buildReadUrl(hashValue) {
    const shard = hashValue.substring(0, 2);
    return (
        "https://read.citeit.net/quote/sha256/" +
        WEBSERVICE_VERSION +
        "/" +
        shard +
        "/" +
        hashValue +
        ".json"
    );
}

export function getCurrentPageUrl() {
    return window.location.href.split("#")[0];
}

export { CITEIT_DEBUG, WEBSERVICE_VERSION };
