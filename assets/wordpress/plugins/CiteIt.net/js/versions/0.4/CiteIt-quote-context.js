/*jslint this*/
/*global $, console, document, jQuery, urlParser, forge_sha256,
  Set, URL, URLSearchParams, unescape, window */

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

const citeItDebug = false;
const hiddenContainer = "citeit_container";
const webserviceVersionNum = "0.4";
const urlEscapeCodePoints = new Set([10, 20, 160]);

// Unicode Code points used in normalizeeText
// to escape from quote text
// to remove invisible or confusing characters
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
const currentPageUrl = window.location.href.split("#")[0];

function clog(msg) {
    if (citeItDebug) {
        console.log(msg);
    }
}

function urlWithoutProtocol(url) {
    const urlNoSlash = url.replace(/\/$/, "");
    return urlNoSlash.replace(/^https?:\/\//i, "");
}

function normalizeText(str, escapeCodePoints) {
    const result = [];
    Array.from(str).forEach(function (chr) {
        const code = chr.codePointAt(0);
        if (!escapeCodePoints.has(code)) {
            result.push(chr);
        }
    });
    return result.join("");
}

function escapeUrl(str) {
    return normalizeText(str, urlEscapeCodePoints);
}

function escapeQuote(str) {
    const noQuotes = str.replaceAll("\"", "");
    return normalizeText(noQuotes, textEscapeCodePoints);
}

function quoteHashKey(citingQuote, citingUrl, citedUrl) {
    return (
        escapeQuote(citingQuote) +
        "|" +
        urlWithoutProtocol(escapeUrl(citingUrl)) +
        "|" +
        urlWithoutProtocol(escapeUrl(citedUrl))
    );
}

function extractDomain(url) {
    const parts = (
        url.indexOf("://") > -1
        ? url.split("/")[2]
        : url.split("/")[0]
    );
    return parts.split(":")[0];
}

function isInt(data) {
    return Number.isInteger(parseInt(data, 10));
}

function isHexadecimal(str) {
    const regexp = /^[0-9a-fA-F]+$/;
    return regexp.test(str);
}

function trimDefault(str) {
    return str || "";
}

function toggleQuote(section, id) {
    const sha = id.split("_")[2];
    const parentDivId = section + "_" + sha;
    jQuery("#" + parentDivId).toggleClass("rotated180");
    jQuery("#" + id).fadeToggle();
}

function expandPopup(tag, hiddenPopupId, popupWidth) {
    const $popup = jQuery("#" + hiddenPopupId);
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

function embedUi(sourceUrl, jsonData, tagType = "blockquote") {
    var embedIcon = "";
    var embedHtml = "";
    var startTime = "";
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

        embedIcon = (
            "<span class='view_on_youtube'><br /><a href=\"javascript:" +
            "toggleQuote('quote_arrow_up', 'quote_before_" +
            jsonData.sha256 + "'); \">Expand: Show Video Clip</a></span>"
        );

        const width = (
            tagType === "q"
            ? "426"
            : "560"
        );
        const height = (
            tagType === "q"
            ? "240"
            : "315"
        );

        embedHtml = (
            "<iframe class='youtube' src='" + embedUrl + "' width='" +
            width + "' height='" + height + "' frameborder='0' " +
            "allowfullscreen='allowfullscreen'></iframe>"
        );
    }

    return {
        html: embedHtml,
        icon: embedIcon,
        json: jsonData,
        url: sourceUrl
    };
}

function isWordpressPreview(citingUrl) {
    if (!citingUrl.split("?")[1]) {
        return false;
    }
    const urlParams = new URLSearchParams(citingUrl.split("?")[1]);
    const pId = urlParams.get("preview_id");
    const pNonce = urlParams.get("preview_nonce");
    const isP = urlParams.get("preview");

    return (isP && isInt(pId) && isHexadecimal(pNonce));
}

function isValidUrl(string) {
    try {
        const url = new URL(string);
        return (url.protocol === "http:" || url.protocol === "https:");
    } catch (ignore) {
        return false;
    }
}

const addQuoteToDom = function (atTagType, json, atCitedUrl, blockcite) {
    var html = "";
    var popupWidth = 375;
    const w = window.screen.availWidth;

    if (w <= 320) {
        popupWidth = 300;
    } else if (w <= 480) {
        popupWidth = 340;
    } else if (w <= 640) {
        popupWidth = 640;
    } else if (w <= 768) {
        popupWidth = 755;
    }

    const curUi = embedUi(atCitedUrl, json, atTagType);

    if (atTagType === "q") {
        const qId = "hidden_" + json.sha256;
        var domain = json.cited_url;
        domain = domain.replace("http://", "");
        domain = domain.replace("https://", "");
        domain = domain.replace("www.", "");
        domain = domain.split(/[\/?#]/)[0];

        html = (
            "<div id='" + qId + "' class='highslide-maincontent width_"
            + popupWidth + "'>" + curUi.html + "<br />.. "
            + json.cited_context_before + " <span class='q-tag-highlight'>"
            + "<strong>" + json.citing_quote + "</strong></span> "
            + json.cited_context_after + ".. </p><p><a href='"
            + json.cited_url + "' target='_blank'>Read more</a> | "
            + "<a href='javascript:closePopup(" + qId + ");'>Close</a> "
            + "<div class='source_url'>source: <a href='" + json.cited_url
            + "'>" + domain + "</a> </p></div>"
        );

        jQuery("#" + hiddenContainer).append(html);
        blockcite.wrapInner(
            "<a class='popup_quote' href='" + blockcite.attr("cite") +
            "' onclick='return expandPopup(this, \"" + qId + "\", " +
            popupWidth + ")' />"
        );
    } else if (atTagType === "blockquote") {
        const beforeHtml = (
            "<div id='quote_before_" + json.sha256
            + "' class='quote_context'><blockquote class='quote_context'>"
            + "<span class='context_header'>Context Before:</span>"
            + "<div class='tooltip'><span class='tooltip_icon'>?</span>"
            + "<span class='tooltiptext'>CiteIt.net displays Context</span>"
            + "</div><br />" + curUi.html + " .. "
            + json.cited_context_before + "</blockquote></div>"
        );
        blockcite.before(beforeHtml);

        const afterHtml = (
            "<div id='quote_after_" + json.sha256
            + "' class='quote_context'>"
            + "<blockquote class='quote_context'>.. "
            + json.cited_context_after
            + " ..<br /><span class='context_header'>"
            + "Context After:</span><div class='tooltip'>"
            + "<span class='tooltip_icon'>?</span>"
            + "<span class='tooltiptext'>"
            + "CiteIt.net displays Context</span>"
            + "</div></blockquote></div>"
        );
        blockcite.after(afterHtml);

        blockcite.addClass("quote_text");
        jQuery("#quote_before_" + json.sha256).hide();
        jQuery("#quote_after_" + json.sha256).hide();

        if (json.cited_context_before.length > 0) {
            const arrowUp = (
                "<div class='quote_arrows up-arrow' "
                + "id='context_up_" + json.sha256 + "'> <a id='quote_arrow_up_"
                + json.sha256 + "' href=\"javascript:toggleQuote("
                + "'quote_arrow_up', 'quote_before_" + json.sha256
                + "');\">&#9650;</a> " + trimDefault(curUi.icon) + "</div>"
            );
            jQuery("#quote_before_" + json.sha256).before(arrowUp);
        }
        if (json.cited_context_after.length > 0) {
            const arrowDown = (
                "<div class='quote_arrows down-arrow' "
                + "id='context_down_" + json.sha256 + "'> <div class='"
                + "citeit_source'><span class='source'>source: </span> "
                + "<a class='citeit_source_domain' href='" + json.cited_url
                + "'>" + extractDomain(json.cited_url) + "</a></div> "
                + "<a class='down_arrow' id='quote_arrow_down_" + json.sha256
                + "' href=\"javascript:toggleQuote('quote_arrow_down', "
                + "'quote_after_" + json.sha256 + "');\">&#9660;</a></div>"
            );
            jQuery("#quote_after_" + json.sha256).after(arrowDown);
        }
    }
};

const quoteContextPlugin = function (collection) {
    collection.each(function (ignore, element) {
        const blockcite = jQuery(element);
        const citedUrl = blockcite.attr("cite");

        if (citedUrl) {
            const citingQuote = blockcite.text();
            var citingUrl = blockcite.attr("data-citeit-citing-url");

            if (!isValidUrl(citingUrl)) {
                citingUrl = currentPageUrl;
            }
            if (isWordpressPreview(citingUrl)) {
                citingUrl = citingUrl.substring(0, citingUrl.indexOf("?"));
            }

            if (citedUrl.length > 3) {
                const tagType = element.tagName.toLowerCase();
                const hashKey = unescape(encodeURIComponent(
                    quoteHashKey(citingQuote, citingUrl, citedUrl)
                ));
                const hashValue = forge_sha256(hashKey);
                const shard = hashValue.substring(0, 2);
                const readUrl = (
                    "https://read.citeit.net/quote/sha256/"
                    + webserviceVersionNum + "/" + shard + "/"
                    + hashValue + ".json"
                );

                jQuery.ajax({
                    dataType: "json",
                    error: function () {
                        clog("CiteIt Missed: " + readUrl);
                    },
                    success: function (json) {
                        addQuoteToDom(tagType, json, citedUrl, blockcite);
                        clog("CiteIt Found: " + readUrl);
                    },
                    type: "GET",
                    url: readUrl
                });
            }
        }
    });
};

jQuery.fn.quoteContext = function () {
    quoteContextPlugin(this);
    return this;
};