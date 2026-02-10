/*jslint this*/
/*global console, document, jQuery, Map, urlParser, forge_sha256,
  Set, URL, URLSearchParams, unescape, window */

/* Quote-Context JS Library v0.5
 * https://github.com/CiteIt/citeit-jquery
 *
 * Copyright 2015-2026, Tim Langeman
 * http://www.openpolitics.com/tim
 *
 * v0.5 adds:
 *  - Clickable ellipsis gaps ("...") that expand to reveal hidden context
 *  - Duplicate quote disambiguation via anchor text
 *  - quote_segments rendering with nested gap support
 *
 * Dependencies:
 *  - jQuery: https://jquery.com/
 *  - Sha256: https://github.com/brillout/forge-sha256/
 *  - jsVideoUrlParser: https://www.npmjs.com/package/js-video-url-parser
 */

"use strict";

// ============ Constants ============
const citeItDebug = false;
const hiddenContainer = "citeit_container";
const webserviceVersionNum = "0.5";
const apiBaseUrl = "https://read.citeit.net/quote/sha256/";

// Precompiled regex patterns for better performance
const REGEX = {
    domainSplit: /[\/?#]/,
    hexadecimal: /^[0-9a-fA-F]+$/,
    protocol: /^https?:\/\//i,
    sha256: /^[0-9a-f]{64}$/i,
    trailingSlash: /\/$/
};

// HTML entities for XSS prevention
const HTML_ENTITIES = {
    "&": "&amp;",
    "'": "&#x27;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;"
};

// Unicode code points to escape
const urlEscapeCodePoints = new Set([10, 20, 160]);
const textEscapeCodePoints = new Set([
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

// ============ Cached Values ============
const currentPageUrl = window.location.href.split("#")[0];
var cachedPopupWidth = null;
var $hiddenContainer = null;
const pendingRequests = new Set();
const completedRequests = new Map();
var eventDelegationInitialized = false;

// ============ Security Functions ============

function escapeHtml(str) {
    if (typeof str !== "string") {
        return "";
    }
    return str.replace(/[&<>"']/g, function (char) {
        return HTML_ENTITIES[char];
    });
}

function isValidSha256(hash) {
// 64-digit hexadecimal string
    return typeof hash === "string" && REGEX.sha256.test(hash);
}

function isValidHttpUrl(string) {
    if (!string || typeof string !== "string") {
        return false;
    }
    try {
        const url = new URL(string);
        return (url.protocol === "http:" || url.protocol === "https:");
    } catch (ignore) {
        return false;
    }
}

function sanitizeId(id) {
    if (typeof id !== "string") {
        return "";
    }
    return id.replace(/[^\-a-zA-Z0-9_]/g, "");
}

function sanitizeUrl(url) {
    if (!isValidHttpUrl(url)) {
        return "#";
    }
    return escapeHtml(url);
}

// ============ Utility Functions ============

function clog(msg) {
    if (citeItDebug) {
        // eslint-disable-next-line no-console
        console.log(msg);
    }
}

function getPopupWidth() {
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

function getHiddenContainer() {
    if ($hiddenContainer === null) {
        $hiddenContainer = jQuery("#" + hiddenContainer);
    }
    return $hiddenContainer;
}

function urlWithoutProtocol(url) {
    return url.replace(REGEX.trailingSlash, "").replace(REGEX.protocol, "");
}

function normalizeText(str, escapeCodePoints) {
    var i = 0;
    var chr;
    var result = "";
    const len = str.length;
    while (i < len) {
        chr = str.charAt(i);
        if (!escapeCodePoints.has(chr.codePointAt(0))) {
            result += chr;
        }
        i += 1;
    }
    return result;
}

function escapeUrl(str) {
    return normalizeText(str, urlEscapeCodePoints);
}

function escapeQuote(str) {
    return normalizeText(str.replaceAll("\"", ""), textEscapeCodePoints);
}

function quoteHashKey(citingQuote, citingUrl, citedUrl) {
    const escapedQuote = escapeQuote(citingQuote);
    const escapedCitingUrl = urlWithoutProtocol(escapeUrl(citingUrl));
    const escapedCitedUrl = urlWithoutProtocol(escapeUrl(citedUrl));
    return escapedQuote + "|" + escapedCitingUrl + "|" + escapedCitedUrl;
}

function extractDomain(url) {
    if (!isValidHttpUrl(url)) {
        return "";
    }
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch (ignore) {
        return "";
    }
}

function isInt(data) {
    return Number.isInteger(parseInt(data, 10));
}

function isHexadecimal(str) {
    return REGEX.hexadecimal.test(str);
}

function trimDefault(str) {
    return str || "";
}

// ============ v0.5: Segmented Quote Rendering ============

function renderSegmentedQuote(json) {
    // Render quote_segments as HTML with clickable ellipsis gaps.
    // Falls back to plain escapeHtml if no segments are present.

    if (!json.quote_segments || !Array.isArray(json.quote_segments)) {
        return escapeHtml(json.citing_quote);
    }

    var parts = [];
    var gapIndex = 0;
    var safeSha = sanitizeId(json.sha256);

    for (var i = 0; i < json.quote_segments.length; i++) {
        var seg = json.quote_segments[i];

        if (seg.type === "text") {
            parts.push(escapeHtml(seg.text));

        } else if (seg.type === "gap") {
            var gapId = "gap_" + safeSha + "_" + gapIndex;
            gapIndex += 1;

            // Clickable ellipsis indicator
            parts.push([
                "<span class='citeit-gap' ",
                "id='ellipsis_", sanitizeId(gapId), "' ",
                "data-citeit-gap='", sanitizeId(gapId), "' ",
                "title='Click to reveal ", seg.char_count,
                " hidden characters'>",
                "&hellip;",
                "</span>"
            ].join(""));

            // Hidden gap content (revealed on click)
            parts.push([
                "<span class='citeit-gap-content' ",
                "id='content_", sanitizeId(gapId), "' ",
                "style='display:none;'>"
            ].join(""));

            if (seg.gap_segments && Array.isArray(seg.gap_segments)) {
                // Large gap with truncation
                for (var j = 0; j < seg.gap_segments.length; j++) {
                    var gseg = seg.gap_segments[j];
                    if (gseg.type === "text") {
                        parts.push(escapeHtml(gseg.text));
                    } else if (gseg.type === "truncated") {
                        parts.push([
                            "<span class='citeit-truncated'>",
                            " [&hellip;", gseg.char_count,
                            " more characters&hellip; ",
                            "<a href='",
                            sanitizeUrl(gseg.read_more_url),
                            "' target='_blank' ",
                            "rel='noopener noreferrer'>",
                            "read more</a>]</span>"
                        ].join(""));
                    }
                }
            } else if (seg.hidden_text) {
                // Small gap, full text available
                parts.push(escapeHtml(seg.hidden_text));
            }

            parts.push("</span>");
        }
    }

    return parts.join("");
}

// ============ UI Functions ============

function expandPopup(tag, hiddenPopupId, popupWidth) {
    const safeId = sanitizeId(hiddenPopupId);
    const $popup = jQuery("#" + safeId);
    const dialogWidth = popupWidth || 375;
    const windowOrTag = (
        window.screen.availWidth < 700
        ? window
        : tag
    );

    $popup.dialog({
        autoOpen: false,
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

    return false;
}

function closePopup(hiddenPopupId) {
    jQuery(hiddenPopupId).dialog("close");
}

// ============ Event Delegation (CSP Compliant) ============

function initEventDelegation() {
    if (eventDelegationInitialized) {
        return;
    }
    eventDelegationInitialized = true;

    // Handle toggle quote clicks (up/down arrows)
    jQuery(document).on(
        "click",
        "[data-citeit-toggle]",
        function handleToggle(e) {
            e.preventDefault();
            const $el = jQuery(this);
            const section = $el.attr("data-citeit-section");
            const targetId = $el.attr("data-citeit-target");

            if (!section || !targetId) {
                return;
            }

            const sha = sanitizeId(targetId.split("_")[2]);
            if (!sha) {
                return;
            }

            const parentDivId = sanitizeId(section + "_" + sha);
            jQuery("#" + parentDivId).toggleClass("rotated180");
            jQuery("#" + sanitizeId(targetId)).fadeToggle();
        }
    );

    // Handle popup open clicks (q tag quotes)
    jQuery(document).on(
        "click",
        "[data-citeit-popup]",
        function handlePopupOpen(e) {
            e.preventDefault();
            const $el = jQuery(this);
            const popupId = $el.attr("data-citeit-popup");
            const popupWidth = (
                parseInt($el.attr("data-citeit-width"), 10) || 375
            );

            if (!popupId) {
                return;
            }

            expandPopup($el[0], sanitizeId(popupId), popupWidth);
        }
    );

    // Handle popup close clicks
    jQuery(document).on(
        "click",
        "[data-citeit-close]",
        function handlePopupClose(e) {
            e.preventDefault();
            const popupId = jQuery(this).attr("data-citeit-close");
            if (popupId) {
                closePopup("#" + sanitizeId(popupId));
            }
        }
    );

    // v0.5: Handle ellipsis gap clicks (expand/collapse hidden text)
    jQuery(document).on(
        "click",
        "[data-citeit-gap]",
        function handleGapToggle(e) {
            e.preventDefault();
            const gapId = jQuery(this).attr("data-citeit-gap");
            if (!gapId) {
                return;
            }
            const safeGapId = sanitizeId(gapId);
            var $ellipsis = jQuery("#ellipsis_" + safeGapId);
            var $content = jQuery("#content_" + safeGapId);

            if ($content.is(":visible")) {
                $content.hide();
                $ellipsis.show();
            } else {
                $content.show();
                $ellipsis.hide();
            }
        }
    );
}

// ============ Video Embed Functions ============

function embedUi(sourceUrl, jsonData, tagType) {
    var embedIcon = "";
    var embedHtml = "";
    var startTime = "";

    if (!isValidSha256(jsonData.sha256)) {
        return {html: "", icon: ""};
    }

    const urlParsed = urlParser.parse(sourceUrl);
    const hasProvider = (
        urlParsed !== undefined &&
        Object.prototype.hasOwnProperty.call(urlParsed, "provider")
    );
    const urlProvider = (
        hasProvider
        ? urlParsed.provider
        : ""
    );

    if (urlProvider === "youtube") {
        const hasParams = (
            urlParsed !== undefined &&
            Object.prototype.hasOwnProperty.call(urlParsed, "params")
        );
        if (hasParams) {
            const hasStart = Object.prototype.hasOwnProperty.call(
                urlParsed.params,
                "start"
            );
            if (hasStart) {
                startTime = urlParsed.params.start;
            }
        }

        const embedUrl = urlParser.create({
            format: "embed",
            params: {start: startTime},
            videoInfo: {
                id: urlParsed.id,
                mediaType: "video",
                provider: urlProvider
            }
        });

        const safeSha = sanitizeId(jsonData.sha256);
        const isQTag = tagType === "q";
        const width = (
            isQTag
            ? "426"
            : "560"
        );
        const height = (
            isQTag
            ? "240"
            : "315"
        );

        embedIcon = [
            "<span class='view_on_youtube'><br />",
            "<a href='#' data-citeit-toggle='true' ",
            "data-citeit-section='quote_arrow_up' ",
            "data-citeit-target='quote_before_",
            safeSha,
            "'>Expand: Show Video Clip</a></span>"
        ].join("");

        embedHtml = [
            "<iframe class='youtube' src='",
            escapeHtml(embedUrl),
            "' width='",
            width,
            "' height='",
            height,
            "' frameborder='0' ",
            "sandbox='allow-scripts allow-same-origin' ",
            "allowfullscreen='allowfullscreen'></iframe>"
        ].join("");
    }

    return {
        html: embedHtml,
        icon: embedIcon
    };
}

function isWordpressPreview(citingUrl) {
    const queryIndex = citingUrl.indexOf("?");
    if (queryIndex === -1) {
        return false;
    }
    const queryString = citingUrl.substring(queryIndex + 1);
    const urlParams = new URLSearchParams(queryString);
    const pId = urlParams.get("preview_id");
    const pNonce = urlParams.get("preview_nonce");
    const isP = urlParams.get("preview");

    return Boolean(isP && isInt(pId) && isHexadecimal(pNonce));
}

function isValidUrl(string) {
    return isValidHttpUrl(string);
}

// ============ DOM Manipulation ============

function buildQTagHtml(qId, popupWidth, curUi, json, domain) {
    // Build HTML for q tag quote context popup (XSS-safe)
    // v0.5: Uses renderSegmentedQuote for the quote display

    const safeQId = sanitizeId(qId);
    const safeCitedUrl = sanitizeUrl(json.cited_url);

    return [
        "<div id='",
        safeQId,
        "' class='highslide-maincontent width_",
        popupWidth,
        "'>",
        curUi.html,
        "<br />.. ",
        escapeHtml(json.cited_context_before),
        " <span class='q-tag-highlight'><strong>",
        renderSegmentedQuote(json),
        "</strong></span> ",
        escapeHtml(json.cited_context_after),
        ".. </p><p><a href='",
        safeCitedUrl,
        "' target='_blank' rel='noopener noreferrer'>Read more</a> | ",
        "<a href='#' data-citeit-close='",
        safeQId,
        "'>Close</a> ",
        "<div class='source_url'>source: <a href='",
        safeCitedUrl,
        "' rel='noopener noreferrer'>",
        escapeHtml(domain),
        "</a> </p></div>"
    ].join("");
}

function buildBeforeHtml(sha256, curUi, contextBefore) {
    const safeSha = sanitizeId(sha256);
    return [
        "<div id='quote_before_",
        safeSha,
        "' class='quote_context'><blockquote class='quote_context'>",
        "<span class='context_header'>Context Before:</span>",
        "<div class='tooltip'><span class='tooltip_icon'>?</span>",
        "<span class='tooltiptext'>CiteIt.net displays Context</span>",
        "</div><br />",
        curUi.html,
        " .. ",
        escapeHtml(contextBefore),
        "</blockquote></div>"
    ].join("");
}

function buildAfterHtml(sha256, contextAfter) {
    const safeSha = sanitizeId(sha256);
    return [
        "<div id='quote_after_",
        safeSha,
        "' class='quote_context'>",
        "<blockquote class='quote_context'>.. ",
        escapeHtml(contextAfter),
        " ..<br /><span class='context_header'>",
        "Context After:</span><div class='tooltip'>",
        "<span class='tooltip_icon'>?</span>",
        "<span class='tooltiptext'>",
        "CiteIt.net displays Context</span>",
        "</div></blockquote></div>"
    ].join("");
}

function buildArrowUpHtml(sha256, embedIcon) {
    const safeSha = sanitizeId(sha256);
    return [
        "<div class='quote_arrows up-arrow' ",
        "id='context_up_",
        safeSha,
        "'> <a id='quote_arrow_up_",
        safeSha,
        "' href='#' data-citeit-toggle='true' ",
        "data-citeit-section='quote_arrow_up' ",
        "data-citeit-target='quote_before_",
        safeSha,
        "'>&#9650;</a> ",
        trimDefault(embedIcon),
        "</div>"
    ].join("");
}

function buildArrowDownHtml(sha256, citedUrl, domain) {
    const safeSha = sanitizeId(sha256);
    const safeCitedUrl = sanitizeUrl(citedUrl);
    return [
        "<div class='quote_arrows down-arrow' ",
        "id='context_down_",
        safeSha,
        "'> <div class='",
        "citeit_source'><span class='source'>source: </span> ",
        "<a class='citeit_source_domain' href='",
        safeCitedUrl,
        "' rel='noopener noreferrer'>",
        escapeHtml(domain),
        "</a></div> ",
        "<a class='down_arrow' id='quote_arrow_down_",
        safeSha,
        "' href='#' data-citeit-toggle='true' ",
        "data-citeit-section='quote_arrow_down' ",
        "data-citeit-target='quote_after_",
        safeSha,
        "'>&#9660;</a></div>"
    ].join("");
}

function addQuoteToDom(atTagType, json, atCitedUrl, blockcite) {
    // Validate SHA256 hash from API response
    if (!isValidSha256(json.sha256)) {
        clog("Invalid SHA256 hash in API response");
        return;
    }

    // Validate cited_url from API response
    if (!isValidHttpUrl(json.cited_url)) {
        clog("Invalid cited_url in API response");
        return;
    }

    const popupWidth = getPopupWidth();
    const curUi = embedUi(atCitedUrl, json, atTagType);
    const sha256 = sanitizeId(json.sha256);
    const citedUrl = json.cited_url;
    const domain = extractDomain(citedUrl);

    // Process based on tag type
    if (atTagType === "q") {
        const qId = "hidden_" + sha256;
        const qDomain = extractDomain(citedUrl);

        const html = buildQTagHtml(qId, popupWidth, curUi, json, qDomain);

        getHiddenContainer().append(html);

        blockcite.wrapInner([
            "<a class='popup_quote' href='",
            sanitizeUrl(blockcite.attr("cite")),
            "' data-citeit-popup='",
            sanitizeId(qId),
            "' data-citeit-width='",
            popupWidth,
            "' />"
        ].join(""));

    // For blockquotes, insert context and add toggle arrows
    } else if (atTagType === "blockquote") {
        // v0.5: If quote has segments with gaps, replace the blockquote
        // inner HTML with the segmented rendering
        if (json.quote_segments && json.quote_segments.length > 1) {
            blockcite.html(renderSegmentedQuote(json));
        }

        // Build context before and after HTML
        const beforeHtml = buildBeforeHtml(
            sha256,
            curUi,
            json.cited_context_before
        );
        const afterHtml = buildAfterHtml(sha256, json.cited_context_after);

        // Insert context and add toggle arrows
        blockcite.before(beforeHtml);
        blockcite.after(afterHtml);
        blockcite.addClass("quote_text");

        const $before = jQuery("#quote_before_" + sha256);
        const $after = jQuery("#quote_after_" + sha256);

        // Initially hide the context sections
        $before.hide();
        $after.hide();

        if (json.cited_context_before.length > 0) {
            const arrowUp = buildArrowUpHtml(sha256, curUi.icon);
            $before.before(arrowUp);
        }
        if (json.cited_context_after.length > 0) {
            const arrowDown = buildArrowDownHtml(sha256, citedUrl, domain);
            $after.after(arrowDown);
        }
    }
}

// ============ Main Plugin ============

function quoteContextPlugin(collection) {
    // Initialize event delegation once
    initEventDelegation();

    collection.each(function processQuote(ignore, element) {
        const blockcite = jQuery(element);
        const citedUrl = blockcite.attr("cite");

        if (!citedUrl || citedUrl.length <= 3) {
            return;
        }

        if (!isValidHttpUrl(citedUrl)) {
            clog("Invalid cite URL: " + citedUrl);
            return;
        }

        const citingQuote = blockcite.text();
        var citingUrl = blockcite.attr("data-citeit-citing-url");

        if (!isValidUrl(citingUrl)) {
            citingUrl = currentPageUrl;
        }
        if (isWordpressPreview(citingUrl)) {
            const queryIndex = citingUrl.indexOf("?");
            citingUrl = citingUrl.substring(0, queryIndex);
        }

        const tagType = element.tagName.toLowerCase();
        const hashKey = unescape(encodeURIComponent(
            quoteHashKey(citingQuote, citingUrl, citedUrl)
        ));
        const hashValue = forge_sha256(hashKey);

        if (!isValidSha256(hashValue)) {
            clog("Invalid computed hash");
            return;
        }

        // Check cache first
        if (completedRequests.has(hashValue)) {
            const cachedJson = completedRequests.get(hashValue);
            if (cachedJson) {
                addQuoteToDom(tagType, cachedJson, citedUrl, blockcite);
            }
            return;
        }

        // Skip if request is already pending
        if (pendingRequests.has(hashValue)) {
            return;
        }

        pendingRequests.add(hashValue);

        const shard = hashValue.substring(0, 2);
        const readUrl = (
            apiBaseUrl
            + webserviceVersionNum + "/" + shard + "/"
            + hashValue + ".json"
        );

        jQuery.ajax({
            dataType: "json",
            error: function handleError() {
                clog("CiteIt Missed: " + readUrl);
                pendingRequests.delete(hashValue);
                completedRequests.set(hashValue, null);
            },
            success: function handleSuccess(json) {
                if (json && isValidSha256(json.sha256)) {
                    addQuoteToDom(tagType, json, citedUrl, blockcite);
                    clog("CiteIt Found: " + readUrl);
                } else {
                    clog("Invalid API response");
                }
                pendingRequests.delete(hashValue);
                completedRequests.set(hashValue, json);
            },
            type: "GET",
            url: readUrl
        });
    });
}

jQuery.fn.quoteContext = function quoteContext() {
    quoteContextPlugin(this);
    return this;
};
