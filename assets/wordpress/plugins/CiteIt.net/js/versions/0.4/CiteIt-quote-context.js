/*jslint this*/
/*global console, document, jQuery, urlParser, forge_sha256,
  TextEncoder, URL, URLSearchParams, window, setTimeout */

/* Quote-Context JS Library
 * https://github.com/CiteIt/citeit-jquery
 *
 * Copyright 2015-2026, Tim Langeman
 * http://www.openpolitics.com/tim
 *
 * This is a jQuery function that locates all "blockquote" and "q" tags
 * within an html document and calls the CiteIt.net web service to
 * locate contextual info about the requested quote.
 *
 * The CiteIt.net web service returns a json dictionary and this script
 * injects the returned contextual data into hidden html elements to be
 * displayed when the user hovers over or clicks on the cited quote.
 *
 * Demo: https://www.CiteIt.net
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
const webserviceVersionNum = "0.4";
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
    // Basic check for valid HTTP/HTTPS URL format
    if (!string || typeof string !== "string") {
        return false;
    }
    try {
        const url = new URL(string);
        return (url.protocol === "http:" || url.protocol === "https:");
    } catch {
        return false;
    }
}

function sanitizeId(id) {
    // Remove any characters that are not allowed in HTML element IDs
    if (typeof id !== "string") {
        return "";
    }
    return id.replace(/[^\-a-zA-Z0-9_]/g, "");
}

function sanitizeUrl(url) {
    // Ensure URL is valid and escape it for safe HTML usage
    if (!isValidHttpUrl(url)) {
        return "#";
    }
    return escapeHtml(url);
}

// ============ Utility Functions ============

function clog(msg) {
    // console.log wrapper, toggle with citeItDebug variable
    if (citeItDebug) {
        console.log(msg);
    }
}

function getPopupWidth() {
    // Different popup widths for different screen sizes,
    // optimized for mobile devices
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
    // Cache jQuery object for hidden container div
    if ($hiddenContainer === null) {
        $hiddenContainer = jQuery("#" + hiddenContainer);
    }
    return $hiddenContainer;
}

function urlWithoutProtocol(url) {
    // Remove protocol and trailing slash for consistent caching and comparison
    return url.replace(REGEX.trailingSlash, "").replace(REGEX.protocol, "");
}

function normalizeText(str, escapeCodePoints) {
    // Remove characters with specified Unicode code points
    // for safer URLs and text
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
    // Escape characters that could cause issues in URLs or caching
    return normalizeText(str, urlEscapeCodePoints);
}

function escapeQuote(str) {
    // Escape characters that could cause issues in quotes
    return normalizeText(str.replaceAll("\"", ""), textEscapeCodePoints);
}

function quoteHashKey(citingQuote, citingUrl, citedUrl) {
    // Create a hash key by escaping and normalizing quote/URLs
    // and concatenating them with a delimiter
    const escapedQuote = escapeQuote(citingQuote);
    const escapedCitingUrl = urlWithoutProtocol(escapeUrl(citingUrl));
    const escapedCitedUrl = urlWithoutProtocol(escapeUrl(citedUrl));
    return escapedQuote + "|" + escapedCitingUrl + "|" + escapedCitedUrl;
}

function extractDomain(url) {
    // Extract domain from URL for display purposes

    // Remove prefix if present to show the actual cited domain
    url = url.replace("https:///", "");

    if (!isValidHttpUrl(url)) {
        return "";
    }
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch {
        return "";
    }
}

function isInt(data) {
    // Check if data is an integer, used for WordPress preview
    return Number.isInteger(parseInt(data, 10));
}

function isHexadecimal(str) {
    // Check if string is hexadecimal (for WP preview nonce)
    return REGEX.hexadecimal.test(str);
}

function trimDefault(str) {
    // Trim null or undefined strings to empty string
    return str || "";
}

// ============ UI Functions ============

function expandPopup(tag, hiddenPopupId, popupWidth) {
    // Expand a hidden popup dialog using jQuery UI

    const safeId = sanitizeId(hiddenPopupId);
    const $popup = jQuery("#" + safeId);

    // Highlight the quote link while the popup is open
    const sha256ForHighlight = safeId.replace(/^hidden_/, "");
    jQuery("a#link_" + sha256ForHighlight).addClass("active");
    const dialogWidth = popupWidth || 375;
    const windowOrTag = (
        window.screen.availWidth < 700
        ? window
        : tag
    );

    // CSP-compliant: use data attributes instead of inline event handlers
    $popup.dialog({
        autoOpen: false,
        beforeClose: function () {
            // Pause any playing YouTube video
            // when dialog is closed (X button, Escape, etc.)
            const popupId = jQuery(this).attr("id");
            if (popupId) {
                const closingSha256 = sanitizeId(
                    popupId.replace(/^hidden_/, "")
                );
                pauseVideo(closingSha256);
                setTimeout(function () {
                    jQuery("a#link_" + closingSha256).removeClass(
                        "active",
                        1000
                    );
                }, 1500);
            }
        },
        closeOnEscape: true,
        closeText: "hide",
        draggable: true,
        hide: {
            duration: 400,
            effect: "scale"
        },
        modal: false,
        open: function () {
            // Scroll dialog content to top so video embed is visible first
            const $content = jQuery(this);
            $content.scrollTop(0);
            setTimeout(function () {
                $content.scrollTop(0);
            }, 420); // after open animation completes
        },
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

function toggleBothSections(sha256) {
    // Toggle both cited_context_before and cited_context_after sections
    const safeSha = sanitizeId(sha256);
    pauseVideo(safeSha);
    jQuery("#quote_before_" + safeSha).fadeToggle("slow", "linear");
    jQuery("#quote_after_" + safeSha).fadeToggle("slow", "linear");
    setTimeout(function () {
        jQuery("#player_" + safeSha).attr("title", "");
    }, 350);
}

function pauseVideo(sha256) {
    // Send postMessage to YouTube iframe to pause video playback
    const safeSha = sanitizeId(sha256);
    const $player = jQuery("#player_" + safeSha);
    if ($player.is("iframe")) {
        $player[0].contentWindow.postMessage(
            `{"event":"command","func":"pauseVideo","args":""}`,
            "*"
        );
    }
}

function closePopup(hiddenPopupId) {
    // Pause any playing video, then close the popup dialog
    const sha256 = sanitizeId(String(hiddenPopupId).replace(/^#?hidden_/, ""));
    if (sha256) {
        pauseVideo(sha256);
    }
    jQuery(hiddenPopupId).dialog("close");

    /* Fade out yellow highlight after close */
    setTimeout(function () {
        jQuery("a#link_" + sha256).removeClass("active", 1000);
    }, 1500);
}

// ============ Event Delegation (CSP Compliant) ============

function initEventDelegation() {
    // Use event delegation to handle clicks on dynamic elements,
    // ensuring CSP compatibility via data attributes

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

            // Pause any playing YouTube video when a context section is toggled
            pauseVideo(sha);

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

    // Handle "View Context" clicks — toggle both before and after sections
    jQuery(document).on(
        "click",
        "[data-citeit-toggle-both]",
        function handleToggleBoth(e) {
            e.preventDefault();
            const sha = sanitizeId(
                jQuery(this).attr("data-citeit-toggle-both")
            );
            if (sha) {
                toggleBothSections(sha);
            }
        }
    );
}

// ============ Video Embed Functions ============

function secondsToMinutes(seconds) {
    // Convert seconds integer to "M min S sec" display string
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins + " min " + (
        secs < 10
        ? "0"
        : ""
    ) + secs + " sec";
}

function detectMediaType(url) {
    // Returns 'video', 'pdf', or 'text' based on the cited URL
    if (!url) {
        return "text";
    }
    try {
        const urlParsed = urlParser.parse(url);
        if (urlParsed && urlParsed.provider === "youtube") {
            return "video";
        }
    } catch (ignore) {}
    const youtubePatterns = [
        /^https?:\/\/(www\.|m\.)?youtube\.com\//,
        /^https?:\/\/youtu\.be\//
    ];
    if (youtubePatterns.some(function (p) {
        return p.test(url);
    })) {
        return "video";
    }
    if (url.toLowerCase().split("?")[0].endsWith(".pdf")) {
        return "pdf";
    }
    return "text";
}

function mediaIcon(mediaType, startTime) {
    // Returns an <img> icon for the given media type
    if (mediaType === "video") {
        const timeLabel = (
            startTime
            ? " @ " + startTime
            : ""
        );
        return [
            "<img class='youtube-icon'",
            " src='/assets/wordpress/plugins/CiteIt.net/img/",
            "youtube_logo_mini.png'",
            " width='40' height='27'",
            " alt='video context'",
            " title='View Context: Video" + escapeHtml(timeLabel) + "' />"
        ].join("");
    }
    if (mediaType === "pdf") {
        return [
            "<img src='https://www.citeit.net/assets/images/",
            "text-icon-small.png'",
            " class='text-icon' width='50' height='50'",
            " alt='PDF context' title='View Context: PDF' />"
        ].join("");
    }
    return [
        "<img src='/assets/images/text-icon-small.png'",
        " class='text-icon' width='40' height='40'",
        " alt='text context'",
        " title='View Context: Text (no video)' />"
    ].join("");
}

function embedUi(sourceUrl, jsonData, tagType) {
    // Currently only supports YouTube, can be extended
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
            params: {enablejsapi: 1, start: startTime},
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

        // CSP-compliant: use data attributes instead of javascript: URL
        embedIcon = mediaIcon("video", startTime);

        embedHtml = [
            "<iframe id='player_",
            safeSha,
            "' class='youtube' src='",
            escapeHtml(embedUrl),
            "' width='",
            width,
            "' height='",
            height,
            "' frameborder='0' ",
            "allow='accelerometer; autoplay; clipboard-write; ",
            "encrypted-media; gyroscope; picture-in-picture; ",
            "web-share; presentation' ",
            "allowfullscreen></iframe>"
        ].join("");
    }

    // If no YouTube icon was set, use text or PDF icon
    if (!embedIcon) {
        embedIcon = mediaIcon(detectMediaType(sourceUrl), "");
    }

    return {
        html: embedHtml,
        icon: embedIcon,
        startTime: (startTime || "")
    };
}

function isWordpressPreview(citingUrl) {
    // Check if citing URL is a WordPress preview URL

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
        escapeHtml(json.citing_quote),
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
    // Build HTML for context before a blockquote (XSS-safe)

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
    // Build HTML for context after a blockquote (XSS-safe)

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

function buildArrowUpHtml(sha256, mediaType) {
    // Build HTML for up arrow to toggle context (XSS-safe)

    const safeSha = sanitizeId(sha256);

    var upLabelText = "View Context";
    if (mediaType === "video") {
        upLabelText = "View Context: Video";
    } else if (mediaType === "pdf") {
        upLabelText = "View Context: PDF";
    }

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
        "'>&#9650;</a><br /> ",
        "<a href='#' data-citeit-toggle='true' ",
        "data-citeit-section='quote_arrow_up' ",
        "data-citeit-target='quote_before_",
        safeSha,
        "'>",
        escapeHtml(upLabelText),
        "</a>",
        "</div>"
    ].join("");
}

function buildArrowDownHtml(sha256, citedUrl, domain) {
    // Build HTML for down arrow to toggle context (XSS-safe)

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
        "'>&#9660;</a></div><br />"
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

    // Validate that the cited_url matches the one in the blockquote/q tag
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

        // CSP-compliant: use data attributes instead of onclick
        blockcite.wrapInner([
            "<a id='link_",
            sha256,
            "' class='popup_quote' href='",
            sanitizeUrl(blockcite.attr("cite")),
            "' data-citeit-popup='",
            sanitizeId(qId),
            "' data-citeit-width='",
            popupWidth,
            "' />"
        ].join(""));

        // Append media icon (YouTube, PDF, or text) to the link
        if (curUi.icon) {
            blockcite.find("a.popup_quote").append(curUi.icon);
        }

    // For blockquotes, insert context and add toggle arrows
    } else if (atTagType === "blockquote") {
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

        // Initially hide the context sections and only show the toggle arrows
        $before.hide();
        $after.hide();

        if (json.cited_context_before.length > 0) {
            const arrowUp = buildArrowUpHtml(
                sha256,
                detectMediaType(atCitedUrl)
            );
            $before.before(arrowUp);
        }
        if (json.cited_context_after.length > 0) {
            const arrowDown = buildArrowDownHtml(sha256, citedUrl, domain);
            $after.after(arrowDown);
        }

        // Append bottom-left icon + label to the blockquote
        const mediaType = detectMediaType(atCitedUrl);
        const contextUpHref = "#context_up_" + sha256;
        const toggleAttr = "data-citeit-toggle-both='" + sha256 + "'";
        var bottomIcon = "";
        var bottomLabelText = "";

        if (mediaType === "video") {
            const timeLabel = (
                curUi.startTime
                ? " @ " + secondsToMinutes(curUi.startTime)
                : ""
            );
            bottomIcon = [
                "<img class='youtube-icon'",
                " src='/assets/wordpress/plugins/CiteIt.net/img/",
                "youtube_logo_mini.png'",
                " width='40' height='27' alt='video context' />"
            ].join("");
            bottomLabelText = (
                "\u2190 View Context: Video" + escapeHtml(timeLabel)
            );
        } else if (mediaType === "pdf") {
            bottomIcon = [
                "<img src='https://www.citeit.net/assets/images/",
                "text-icon-small.png'",
                " class='text-icon' width='50' height='50' alt='PDF icon' />"
            ].join("");
            bottomLabelText = "\u2190 View Context: PDF";
        } else {
            bottomIcon = [
                "<img src='https://www.citeit.net/assets/images/",
                "text-icon-small.png'",
                " class='text-icon' width='50' height='50' alt='Text icon' />"
            ].join("");
            bottomLabelText = "View Context";
        }

        const iconLink = [
            "<a href='", contextUpHref, "' ", toggleAttr, ">",
            bottomIcon,
            "</a>"
        ].join("");
        const viewLink = [
            "<a href='", contextUpHref, "' ", toggleAttr, ">",
            bottomLabelText,
            "</a>"
        ].join("");
        blockcite.append(
            iconLink
            + " <span class='highlight'>"
            + viewLink
            + "</span><br />"
        );
    }
}

// ============ Main Plugin ============

function quoteContextPlugin(collection) {
    // Main plugin function to process blockquote and q tags

    // Initialize event delegation once
    initEventDelegation();

    collection.each(function processQuote(ignore, element) {
        const blockcite = jQuery(element);
        const citedUrl = blockcite.attr("cite");

        if (!citedUrl || citedUrl.length <= 3) {
            return;
        }

        // Validate citedUrl
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
        const hashKey = Array.from(
            new TextEncoder().encode(
                quoteHashKey(citingQuote, citingUrl, citedUrl)
            ),
            function (b) {
                return String.fromCharCode(b);
            }
        ).join("");
        const hashValue = forge_sha256(hashKey);

        console.log("-----------------------------------------------------");
        console.log("citingQuote:", citingQuote);
        console.log("citingUrl:", citingUrl);
        console.log(
            "quoteHashKey:",
            quoteHashKey(citingQuote, citingUrl, citedUrl)
        );
        console.log("sha256:", hashValue);

        // Validate computed hash
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
                // Validate API response before processing
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

jQuery.fn.quoteContext2 = function quoteContext2() {
    // jQuery plugin entry point, processes each element in the collection
    quoteContextPlugin(this);
    return this;
};
jQuery.fn.quoteContext = jQuery.fn.quoteContext2;