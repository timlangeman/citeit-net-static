/*jslint this*/
/*global $, console, document, jQuery, urlParser, forge_sha256,
  Set, URL, URLSearchParams, unescape, window */

"use strict";

/**
 * Quote-Context JS Library
 * https://github.com/CiteIt/citeit-jquery
 *
 * Robust, performance-optimized version
 */

// ============ CONSTANTS ============
var CITEIT_DEBUG = false;
var HIDDEN_CONTAINER = "citeit_container";
var WEBSERVICE_VERSION = "0.4";
var API_BASE_URL = "https://read.citeit.net/quote/sha256/";
var AJAX_TIMEOUT = 10000; // 10 second timeout

// Pre-compiled regex patterns (avoid recreation on each call)
var REGEX_TRAILING_SLASH = /\/$/;
var REGEX_PROTOCOL = /^https?:\/\//i;
var REGEX_HEX = /^[0-9a-fA-F]+$/;
var REGEX_SHA256 = /^[0-9a-fA-F]{64}$/;
var REGEX_UNSAFE_HTML = /[<>"'&]/g;
var REGEX_SAFE_ID = /^[a-zA-Z0-9_\-]+$/;

// HTML entity map for escaping (ASCII order: " & ' < >)
var HTML_ENTITIES = {
    "&": "&amp;",
    "'": "&#39;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;"
};

// Unicode Code point sets for text normalization
var URL_ESCAPE_CODE_POINTS = new Set([10, 20, 160]);
var TEXT_ESCAPE_CODE_POINTS = new Set([
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

// Cache current page URL (computed once, with fallback)
var CURRENT_PAGE_URL = (function () {
    try {
        return window.location.href.split("#")[0];
    } catch (ignore) {
        return "";
    }
}());

// Cache for jQuery container reference
var $hiddenContainer = null;

// ============ UTILITY FUNCTIONS ============

function clog(msg) {
    if (CITEIT_DEBUG && console !== undefined && console.log) {
        console.log(msg);
    }
}

/**
 * Escape HTML to prevent XSS attacks
 */
function escapeHtml(str) {
    if (!str) {
        return "";
    }
    return String(str).replace(REGEX_UNSAFE_HTML, function (char) {
        return HTML_ENTITIES[char] || char;
    });
}

/**
 * Escape a string for use in HTML attributes
 */
function escapeAttr(str) {
    if (!str) {
        return "";
    }
    return escapeHtml(str).replace(/'/g, "&#39;");
}

function urlWithoutProtocol(url) {
    if (!url || typeof url !== "string") {
        return "";
    }
    return url.replace(REGEX_TRAILING_SLASH, "").replace(REGEX_PROTOCOL, "");
}

// Optimized: Use string building instead of array for small strings
function normalizeText(str, escapeCodePoints) {
    var code;
    var i = 0;
    var len;
    var result = "";

    if (!str || typeof str !== "string") {
        return "";
    }

    len = str.length;

    while (i < len) {
        code = str.codePointAt(i);
        if (code !== undefined && !escapeCodePoints.has(code)) {
            result += str.charAt(i);
        }
        // Handle surrogate pairs for code points > 0xFFFF
        i += (
            code > 0xFFFF
            ? 2
            : 1
        );
    }
    return result;
}

function escapeUrl(str) {
    return normalizeText(str, URL_ESCAPE_CODE_POINTS);
}

function escapeQuote(str) {
    if (!str || typeof str !== "string") {
        return "";
    }
    return normalizeText(str.replace(/"/g, ""), TEXT_ESCAPE_CODE_POINTS);
}

function quoteHashKey(citingQuote, citingUrl, citedUrl) {
    return (
        escapeQuote(citingQuote || "") +
        "|" +
        urlWithoutProtocol(escapeUrl(citingUrl || "")) +
        "|" +
        urlWithoutProtocol(escapeUrl(citedUrl || ""))
    );
}

/**
 * Extract domain from URL with robust error handling
 */
function extractDomain(url) {
    var afterProtocol;
    var colonPos;
    var domain;
    var firstSlash;
    var parsedUrl;
    var slashIndex;
    var slashPos;

    if (!url || typeof url !== "string") {
        return "";
    }

    try {
        // Try using URL API first (most reliable)
        parsedUrl = new URL(url);
        return parsedUrl.hostname || "";
    } catch (ignore) {
        // Fallback to manual parsing
        slashIndex = url.indexOf("://");

        if (slashIndex > -1) {
            afterProtocol = url.substring(slashIndex + 3);
            slashPos = afterProtocol.indexOf("/");
            domain = (
                slashPos > -1
                ? afterProtocol.substring(0, slashPos)
                : afterProtocol
            );
        } else {
            firstSlash = url.indexOf("/");
            domain = (
                firstSlash > -1
                ? url.substring(0, firstSlash)
                : url
            );
        }

        // Remove port if present
        colonPos = domain.indexOf(":");
        if (colonPos > -1) {
            domain = domain.substring(0, colonPos);
        }

        return domain || "";
    }
}

function isInt(data) {
    var parsed;

    if (data === null || data === undefined) {
        return false;
    }
    parsed = parseInt(data, 10);
    return !Number.isNaN(parsed) && Number.isInteger(parsed);
}

function isHexadecimal(str) {
    if (!str || typeof str !== "string") {
        return false;
    }
    return REGEX_HEX.test(str);
}

function isWordpressPreview(citingUrl) {
    var isP;
    var pId;
    var pNonce;
    var qIndex;
    var urlParams;

    if (!citingUrl || typeof citingUrl !== "string") {
        return false;
    }

    qIndex = citingUrl.indexOf("?");
    if (qIndex === -1) {
        return false;
    }

    try {
        urlParams = new URLSearchParams(citingUrl.substring(qIndex + 1));
        pId = urlParams.get("preview_id");
        pNonce = urlParams.get("preview_nonce");
        isP = urlParams.get("preview");

        return Boolean(isP && isInt(pId) && isHexadecimal(pNonce));
    } catch (ignore) {
        return false;
    }
}

function isValidUrl(string) {
    var url;

    if (!string || typeof string !== "string") {
        return false;
    }
    try {
        url = new URL(string);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch (ignore) {
        return false;
    }
}

/**
 * Validate SHA256 hash format (exactly 64 hex characters)
 */
function isValidSha256(hash) {
    if (!hash || typeof hash !== "string") {
        return false;
    }
    return REGEX_SHA256.test(hash);
}

/**
 * Sanitize ID for safe use in jQuery selectors
 * Prevents selector injection attacks
 */
function sanitizeId(id) {
    if (!id || typeof id !== "string") {
        return "";
    }
    // Only allow alphanumeric, underscore, and hyphen
    if (!REGEX_SAFE_ID.test(id)) {
        return "";
    }
    return id;
}

function getPopupWidth() {
    try {
        return (
            window.screen.availWidth <= 480
            ? 340
            : 375
        );
    } catch (ignore) {
        return 375;
    }
}

/**
 * Check if required dependencies are available
 */
function checkDependencies() {
    var missing = [];

    if (jQuery === undefined) {
        missing.push("jQuery");
    }
    if (forge_sha256 === undefined) {
        missing.push("forge_sha256");
    }
    if (urlParser === undefined) {
        missing.push("urlParser");
    }

    if (missing.length > 0) {
        clog("CiteIt: Missing dependencies: " + missing.join(", "));
        return false;
    }
    return true;
}

// ============ UI FUNCTIONS ============

function toggleQuote(section, id) {
    var $parent;
    var $target;
    var parentDivId;
    var parts;
    var safeId;
    var safeSection;
    var sha;

    if (!section || !id) {
        return;
    }

    // Sanitize inputs to prevent selector injection
    safeSection = sanitizeId(section);
    safeId = sanitizeId(id);

    if (!safeSection || !safeId) {
        clog("CiteIt: Invalid section or id in toggleQuote");
        return;
    }

    parts = safeId.split("_");
    if (parts.length < 3) {
        return;
    }

    sha = parts[2];

    // Validate SHA256 format
    if (!isValidSha256(sha)) {
        clog("CiteIt: Invalid SHA256 in toggleQuote");
        return;
    }

    parentDivId = safeSection + "_" + sha;
    $parent = jQuery("#" + parentDivId);
    $target = jQuery("#" + safeId);

    if ($parent.length) {
        $parent.toggleClass("rotated180");
    }
    if ($target.length) {
        $target.fadeToggle();
    }
}

function expandPopup(tag, hiddenPopupId, popupWidth) {
    var $popup;
    var dialogWidth;
    var safePopupId;
    var windowOrTag;

    if (!hiddenPopupId) {
        return false;
    }

    // Sanitize popup ID to prevent selector injection
    safePopupId = sanitizeId(hiddenPopupId);
    if (!safePopupId) {
        clog("CiteIt: Invalid popup ID in expandPopup");
        return false;
    }

    dialogWidth = popupWidth || 375;

    try {
        windowOrTag = (
            window.screen.availWidth < 700
            ? window
            : tag
        );
    } catch (ignore) {
        windowOrTag = window;
    }

    $popup = jQuery("#" + safePopupId);

    if (!$popup.length) {
        clog("CiteIt: Popup element not found: " + hiddenPopupId);
        return false;
    }

    // Destroy existing dialog instance to prevent memory leak
    try {
        if ($popup.hasClass("ui-dialog-content")) {
            $popup.dialog("destroy");
        }
    } catch (ignore) {
        // Dialog may not exist yet
    }

    try {
        $popup.dialog({
            autoOpen: false,
            close: function () {
                // Clean up on close to free memory
                try {
                    jQuery(this).dialog("destroy");
                } catch (ignore) {
                    // Ignore cleanup errors
                }
            },
            closeOnEscape: true,
            closeText: "hide",
            draggable: true,
            hide: {
                duration: 400,
                effect: "size"
            },
            modal: false,
            position: {
                at: "center center-200",
                collision: "fit",
                of: windowOrTag
            },
            resizable: true,
            show: {
                duration: 400,
                effect: "scale"
            },
            title: "Quote Context by CiteIt.net",
            width: dialogWidth
        }).addClass("dialogue_box").dialog("open").blur();
    } catch (err) {
        clog("CiteIt: Error opening dialog: " + err.message);
    }

    return false;
}

function closePopup(hiddenPopupId) {
    var $popup;
    var cleanId;
    var safeId;

    if (!hiddenPopupId) {
        return;
    }

    // Remove # prefix if present, then sanitize
    cleanId = (
        hiddenPopupId.charAt(0) === "#"
        ? hiddenPopupId.substring(1)
        : hiddenPopupId
    );

    safeId = sanitizeId(cleanId);
    if (!safeId) {
        clog("CiteIt: Invalid popup ID in closePopup");
        return;
    }

    $popup = jQuery("#" + safeId);

    if (!$popup.length) {
        return;
    }

    try {
        if ($popup.hasClass("ui-dialog-content")) {
            $popup.dialog("close");
        }
    } catch (err) {
        clog("CiteIt: Error closing dialog: " + err.message);
    }
}

// ============ EMBED FUNCTIONS ============

function embedUi(sourceUrl, jsonData, tagType) {
    var embedHtml = "";
    var embedIcon = "";
    var embedUrl;
    var height;
    var sha256Hash;
    var startTime;
    var urlParsed;
    var width;

    if (!sourceUrl || urlParser === undefined) {
        return {
            html: embedHtml,
            icon: embedIcon
        };
    }

    try {
        urlParsed = urlParser.parse(sourceUrl);
    } catch (err) {
        clog("CiteIt: Error parsing URL: " + err.message);
        return {
            html: embedHtml,
            icon: embedIcon
        };
    }

    if (!urlParsed || !urlParsed.provider) {
        return {
            html: embedHtml,
            icon: embedIcon
        };
    }

    if (urlParsed.provider === "youtube") {
        startTime = (
            (urlParsed.params && urlParsed.params.start)
            ? urlParsed.params.start
            : ""
        );

        try {
            embedUrl = urlParser.create({
                format: "embed",
                params: {start: startTime},
                videoInfo: {
                    id: urlParsed.id,
                    mediaType: "video",
                    provider: "youtube"
                }
            });
        } catch (err) {
            clog("CiteIt: Error creating embed URL: " + err.message);
            return {
                html: embedHtml,
                icon: embedIcon
            };
        }

        sha256Hash = (
            (jsonData && jsonData.sha256 && isValidSha256(jsonData.sha256))
            ? escapeAttr(jsonData.sha256)
            : ""
        );

        // CSP-compliant: Use data attributes instead of javascript: URL
        embedIcon = (
            "<span class=\"view_on_youtube\"><br />" +
            "<button type=\"button\" class=\"citeit-toggle-video\" " +
            "data-section=\"quote_arrow_up\" " +
            "data-target=\"quote_before_" + sha256Hash + "\">" +
            "Expand: Show Video Clip</button></span>"
        );

        width = (
            tagType === "q"
            ? "426"
            : "560"
        );
        height = (
            tagType === "q"
            ? "240"
            : "315"
        );

        // Add sandbox attribute for security (allow scripts and same-origin
        // for YouTube functionality)
        embedHtml = (
            "<iframe class=\"youtube\" src=\"" + escapeAttr(embedUrl) +
            "\" width=\"" + width + "\" height=\"" + height +
            "\" frameborder=\"0\" allowfullscreen=\"allowfullscreen\" " +
            "sandbox=\"allow-scripts allow-same-origin allow-presentation\" " +
            "referrerpolicy=\"strict-origin-when-cross-origin\"></iframe>"
        );
    }

    return {
        html: embedHtml,
        icon: embedIcon
    };
}

// ============ HTML BUILDERS ============

function buildQuoteHtml(qId, popupWidth, curUi, json, domain) {
    var safeContextAfter = escapeHtml(json.cited_context_after || "");
    var safeContextBefore = escapeHtml(json.cited_context_before || "");
    var safeCitedUrl = escapeAttr(json.cited_url || "");
    var safeDomain = escapeHtml(domain || "");
    var safeQId = escapeAttr(qId);
    var safeQuote = escapeHtml(json.citing_quote || "");

    // CSP-compliant: Use button with data attribute instead of javascript: URL
    return (
        "<div id=\"" + safeQId + "\" class=\"highslide-maincontent width_" +
        popupWidth + "\">" +
        (curUi.html || "") +
        "<br />.. " + safeContextBefore +
        " <strong>" + safeQuote + "</strong> " +
        safeContextAfter +
        " .. <p><a href=\"" + safeCitedUrl +
        "\" target=\"_blank\" rel=\"noopener noreferrer\">Read more</a> | " +
        "<button type=\"button\" class=\"citeit-close-popup\" " +
        "data-popup-id=\"" + safeQId + "\">Close</button> " +
        "<div class=\"source_url\">source: " + safeDomain + "</div></p></div>"
    );
}

function buildWrapperHtml(citedUrl, qId, popupWidth) {
    var safeCitedUrl = escapeAttr(citedUrl);
    var safeQId = escapeAttr(qId);

    // CSP-compliant: Use data attributes instead of inline onclick
    return (
        "<a class=\"popup_quote citeit-expand-popup\" href=\"" + safeCitedUrl +
        "\" data-popup-id=\"" + safeQId +
        "\" data-popup-width=\"" + popupWidth + "\" />"
    );
}

// ============ MAIN PLUGIN ============

jQuery.fn.quoteContext = function () {
    // Check dependencies first
    if (!checkDependencies()) {
        return this;
    }

    // Cache container reference once
    if (!$hiddenContainer) {
        $hiddenContainer = jQuery("#" + HIDDEN_CONTAINER);
        if (!$hiddenContainer.length) {
            clog("CiteIt: Hidden container not found: " + HIDDEN_CONTAINER);
        }
    }

    return this.each(function (ignore, element) {
        var $element = jQuery(element);
        var blockcite;
        var citedUrl = $element.attr("cite");
        var citingQuote;
        var citingUrl;
        var encodedKey;
        var hashKey;
        var hashValue;
        var qIndex;
        var readUrl;
        var shard;
        var tagType;

        // Early exit if no cite attribute or too short
        if (!citedUrl || citedUrl.length <= 3) {
            return;
        }

        // Validate cited URL format for security
        if (!isValidUrl(citedUrl)) {
            clog("CiteIt: Invalid cited URL: " + citedUrl);
            return;
        }

        citingQuote = $element.text();

        // Skip if quote is empty
        if (!citingQuote || !citingQuote.trim()) {
            return;
        }

        citingUrl = $element.attr("data-citeit-citing-url");

        if (!isValidUrl(citingUrl)) {
            citingUrl = CURRENT_PAGE_URL;
        }

        if (isWordpressPreview(citingUrl)) {
            qIndex = citingUrl.indexOf("?");
            if (qIndex > -1) {
                citingUrl = citingUrl.substring(0, qIndex);
            }
        }

        tagType = element.tagName.toLowerCase();
        hashKey = quoteHashKey(citingQuote, citingUrl, citedUrl);

        try {
            encodedKey = unescape(encodeURIComponent(hashKey));
        } catch (err) {
            clog("CiteIt: Error encoding hash key: " + err.message);
            return;
        }

        try {
            hashValue = forge_sha256(encodedKey);
        } catch (err) {
            clog("CiteIt: Error computing SHA256: " + err.message);
            return;
        }

        if (!hashValue || hashValue.length < 2) {
            clog("CiteIt: Invalid hash value");
            return;
        }

        shard = hashValue.substring(0, 2);
        readUrl = (
            API_BASE_URL + WEBSERVICE_VERSION + "/"
            + shard + "/" + hashValue + ".json"
        );

        // Store references for closure
        blockcite = $element;

        jQuery.ajax({
            dataType: "json",
            error: function (ignore, textStatus, errorThrown) {
                clog(
                    "CiteIt Missed: " + readUrl
                    + " (" + textStatus + ": " + errorThrown + ")"
                );
            },
            success: function (json) {
                var curUi;
                var domain;
                var html;
                var popupWidth;
                var qId;

                // Validate response
                if (!json || typeof json !== "object") {
                    clog("CiteIt: Invalid JSON response");
                    return;
                }

                if (!json.sha256) {
                    clog("CiteIt: Missing sha256 in response");
                    return;
                }

                // Validate SHA256 hash format for security
                if (!isValidSha256(json.sha256)) {
                    clog("CiteIt: Invalid sha256 format in response");
                    return;
                }

                // Validate cited_url in response if present
                if (json.cited_url && !isValidUrl(json.cited_url)) {
                    clog("CiteIt: Invalid cited_url in response");
                    return;
                }

                if (tagType !== "q") {
                    return;
                }

                popupWidth = getPopupWidth();
                curUi = embedUi(citedUrl, json, tagType);
                qId = "hidden_" + json.sha256;
                domain = extractDomain(json.cited_url);

                html = buildQuoteHtml(
                    qId,
                    popupWidth,
                    curUi,
                    json,
                    domain
                );

                if ($hiddenContainer.length) {
                    $hiddenContainer.append(html);
                    blockcite.wrapInner(
                        buildWrapperHtml(citedUrl, qId, popupWidth)
                    );
                }
            },
            timeout: AJAX_TIMEOUT,
            type: "GET",
            url: readUrl
        });
    });
};

// Expose functions globally (for backwards compatibility)
window.toggleQuote = toggleQuote;
window.expandPopup = expandPopup;
window.closePopup = closePopup;

// ============ CSP-COMPLIANT EVENT DELEGATION ============
// Set up event handlers using delegation for security (no inline JS)

jQuery(document).ready(function () {
    var $doc = jQuery(document);

    // Handle expand popup clicks (quote links)
    $doc.on("click", ".citeit-expand-popup", function (e) {
        var $this = jQuery(this);
        var popupId = $this.data("popup-id");
        var popupWidth = $this.data("popup-width") || 375;

        e.preventDefault();

        if (popupId) {
            expandPopup(this, String(popupId), Number(popupWidth));
        }
        return false;
    });

    // Handle close popup clicks
    $doc.on("click", ".citeit-close-popup", function (e) {
        var popupId = jQuery(this).data("popup-id");

        e.preventDefault();

        if (popupId) {
            closePopup(String(popupId));
        }
    });

    // Handle toggle video clicks
    $doc.on("click", ".citeit-toggle-video", function (e) {
        var $this = jQuery(this);
        var section = $this.data("section");
        var target = $this.data("target");

        e.preventDefault();

        if (section && target) {
            toggleQuote(String(section), String(target));
        }
    });
});
