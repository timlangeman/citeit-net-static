/*jslint this*/
/*global $, console, jQuery, urlParser, forge_sha256,
  Set, URL, URLSearchParams, unescape, escape, window */

"use strict";

/**
 * Quote-Context JS Library
 * https://github.com/CiteIt/citeit-jquery
 */

const citeItDebug = false;
const hiddenContainer = "citeit_container";
const webserviceVersionNum = "0.4";
const urlEscapeCodePoints = new Set([10, 20, 160]);

// Unicode Code points to escape quote used in sha256 hash key
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
    var domain;
    if (url.indexOf("://") > -1) {
        domain = url.split("/")[2];
    } else {
        domain = url.split("/")[0];
    }
    return domain.split(":")[0];
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
    var $popup;
    var windowOrTag;
    var dialogWidth = popupWidth || 375;

    if (window.screen.availWidth < 700) {
        windowOrTag = window;
    } else {
        windowOrTag = tag;
    }

    $popup = jQuery("#" + hiddenPopupId);
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
    var urlParsed = urlParser.parse(sourceUrl);
    var hasProvider = (
        urlParsed !== undefined &&
        Object.prototype.hasOwnProperty.call(urlParsed, "provider")
    );
    var urlProvider = (
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

//****************** MAIN *******************

jQuery.fn.quoteContext = function () {
    return this.each(function (ignore, element) {
        var blockcite;
        var citedUrl;
        var citingQuote;
        var citingUrl;
        var hashKey;
        var hashValue;
        var readUrl;
        var shard;
        var tagType;

        if (jQuery(element).attr("cite")) {
            blockcite = jQuery(element);
            citedUrl = blockcite.attr("cite");
            citingQuote = blockcite.text();

            citingUrl = blockcite.attr("data-citeit-citing-url");
            if (!isValidUrl(citingUrl)) {
                citingUrl = currentPageUrl;
            }

            if (isWordpressPreview(citingUrl)) {
                citingUrl = citingUrl.substring(0, citingUrl.indexOf("?"));
            }

            if (citedUrl.length > 3) {
                tagType = element.tagName.toLowerCase();
                hashKey = quoteHashKey(citingQuote, citingUrl, citedUrl);
                hashKey = unescape(encodeURIComponent(hashKey));

                hashValue = forge_sha256(hashKey);
                shard = hashValue.substring(0, 2);
                readUrl = (
                    "https://read.citeit.net/quote/sha256/" +
                    webserviceVersionNum +
                    "/" +
                    shard +
                    "/" +
                    hashValue +
                    ".json"
                );

                jQuery.ajax({
                    dataType: "json",
                    error: function () {
                        clog("CiteIt Missed: " + readUrl);
                    },
                    success: function (json) {
                        const w = window.screen.availWidth;
                        const popupWidth = (
                            w <= 480
                            ? 340
                            : 375
                        );
                        const curUi = embedUi(citedUrl, json, tagType);

                        if (tagType === "q") {
                            const qId = "hidden_" + json.sha256;
                            const domain = extractDomain(json.cited_url);
                            const html = (
                                "<div id='" + qId + "' " +
                                "class='highslide-maincontent width_" +
                                popupWidth + "'>" + curUi.html +
                                "<br />.. " + json.cited_context_before +
                                " <strong>" + json.citing_quote +
                                "</strong> " + json.cited_context_after +
                                " .. <p><a href='" + json.cited_url +
                                "' target='_blank'>Read more</a>" +
                                " | <a href='javascript:closePopup(" +
                                qId + ");'>Close</a> " +
                                "<div class='source_url'>source: " +
                                domain + "</div></p></div>"
                            );

                            jQuery("#" + hiddenContainer).append(html);
                            blockcite.wrapInner(
                                "<a class='popup_quote' href='" +
                                citedUrl +
                                "' onclick='return expandPopup(this, \"" +
                                qId + "\", " + popupWidth + ")' />"
                            );
                        }
                    },
                    type: "GET",
                    url: readUrl
                });
            }
        }
    });
};