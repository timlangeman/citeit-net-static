/*global $, console, jQuery, urlParser, forge_sha256*/
/*global Set, URL, URLSearchParams*/
/*global unescape, escape*/

/**
 * Quote-Context JS Library
 * https://github.com/CiteIt/citeit-jquery
 *
 * Copyright 2015-2026, Tim Langeman
 * http://www.openpolitics.com/tim
 *
 * Licensed under the MIT license:
 * http://www.opensource.org/licenses/MIT
 */

const citeItDebug = false;
const popupLibrary = "jQuery";
const hiddenContainer = "citeit_container";
const webserviceVersionNum = "0.4";
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
const currentPageUrl = (
    window.location.href.split("#")[0]
);

function clog(msg) {
    if (citeItDebug) {
        console.log(msg);
    }
}

//*********** Trim Regex ************
function trimRegex(str) {
    return str.replace(/^[ ]+|[ ]+$/g, "");
}

//*********** URL without Protocol ************
function urlWithoutProtocol(url) {
    const urlWithoutTrailingSlash = (
        url.replace(/\/$/, "")
    );
    const urlWithoutProtocolResult = (
        urlWithoutTrailingSlash
        .replace(/^https?:\/\//i, "")
    );
    return urlWithoutProtocolResult;
}

//******* Normalize Text *********
function normalizeText(str, escapeCodePoints) {
    const result = [];
    Array.from(str).forEach(function(chr) {
        const code = chr.codePointAt(0);
        if (!escapeCodePoints.has(code)) {
            result.push(chr);
        }
    });
    return result.join("");
}

//******** Escape URL *************
function escapeUrl(str) {
    return normalizeText(str, urlEscapeCodePoints);
}

//********* Escape Quote ************
function escapeQuote(str) {
    str = str.replaceAll("\"", "");
    return normalizeText(str, textEscapeCodePoints);
}

//******** Quote Hash Key **********
function quoteHashKey(citingQuote, citingUrl, citedUrl) {
    const quoteHashResult = (
        escapeQuote(citingQuote) + "|" +
        urlWithoutProtocol(escapeUrl(citingUrl)) +
        "|" +
        urlWithoutProtocol(escapeUrl(citedUrl))
    );
    return quoteHashResult;
}

//******** Quote Hash **************
function quoteHash(citingQuote, citingUrl, citedUrl) {
    const urlQuoteText = quoteHashKey(citingQuote, citingUrl, citedUrl);
    const quoteHashResult = forge_sha256(urlQuoteText);
    return quoteHashResult;
}

//****** Extract Domain from URL ******
function extractDomain(url) {
    var domain;
    if (url.indexOf("://") > -1) {
        domain = url.split("/")[2];
    } else {
        domain = url.split("/")[0];
    }
    domain = domain.split(":")[0];
    return domain;
}

//******** Test if Integer *********
function isInt(data) {
    return Number.isInteger(parseInt(data, 10));
}

//****** Test if Hexadecimal *******
function isHexadecimal(str) {
    const regexp = /^[0-9a-fA-F]+$/;
    return regexp.test(str);
}

//****** String to Array ***********
function stringToArray(s) {
    return Array.from(s);
}

//****** Get Nth index position ****
function nthIndex(str, pat, n) {
    const length = str.length;
    var i = -1;
    var count = n;
    while (count > 0 && i < length) {
        count -= 1;
        i += 1;
        i = str.indexOf(pat, i);
        if (i < 0) {
            break;
        }
    }
    return i;
}

function trimDefault(str) {
    return str ? str : "";
}

//******** Toggle Quote ************
function toggleQuote(section, id) {
    const sha = id.split("_")[2];
    const parentDivId = section + "_" + sha;
    jQuery("#" + parentDivId).toggleClass("rotated180");
    jQuery("#" + id).fadeToggle();
}

// Set jQuery.curCSS shim once at load time
jQuery(function() {
    jQuery.curCSS = jQuery.css;
});

//******** Expand Popup ************
function expandPopup(tag, hiddenPopupId, popupWidth = 375) {
    var $popup;
    var windowOrTag;

    clog("Popup width: " + popupWidth);

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
        width: 380
    }).addClass("dialogue_box")
    .dialog("open").blur();

    return false;
}

//******** Close Popup *************
function closePopup(hiddenPopupId) {
    jQuery(hiddenPopupId).dialog("close");
}

//****** Calculate Video UI ********
function embedUi(sourceUrl, jsonData, tagType = "blockquote") {
    var embedIcon = "";
    var embedHtml = "";
    var embedUrl;
    var height;
    var startTime;
    var urlParsed;
    var urlProvider = "";
    var width;

    urlParsed = urlParser.parse(sourceUrl);
    if (urlParsed !== undefined) {
        if (Object.prototype.hasOwnProperty.call(urlParsed, "provider")) {
            urlProvider = urlParsed.provider;
        }
    }

    if (urlProvider === "youtube") {
        startTime = "";
        if (urlParsed !== undefined && Object.prototype.hasOwnProperty.call(urlParsed, "params")) {
            if (Object.prototype.hasOwnProperty.call(urlParsed.params, "start")) {
                startTime = urlParsed.params.start;
            }
        }

        embedUrl = urlParser.create({
            format: "embed",
            params: { start: startTime },
            videoInfo: {
                id: urlParsed.id,
                mediaType: "video",
                provider: urlProvider
            }
        });

        embedIcon = (
            "<span class='view_on_youtube'>" +
            "<br /><a href=\"" +
            "javascript:toggleQuote(" +
            "'quote_arrow_up', " +
            "'quote_before_" +
            jsonData.sha256 + "'); \">" +
            "Expand: Show Video Clip" +
            "</a></span>"
        );

        if (tagType === "q") {
            width = "426";
            height = "240";
        } else {
            width = "560";
            height = "315";
        }

        embedHtml = (
            "<iframe class='youtube'" +
            " src='" + embedUrl + "'" +
            " width='" + width + "'" +
            " height='" + height + "'" +
            " frameborder='0'" +
            " allowfullscreen=" +
            "'allowfullscreen'></iframe>"
        );

    } else if (urlProvider === "vimeo") {
        embedUrl = "https://player.vimeo.com/video/" + urlParsed.id;
        embedIcon = (
            "<span class='view_on_youtube'>" +
            "<br />Expand: " +
            "Show Video Clip</span>"
        );
        embedHtml = (
            "<iframe class='youtube'" +
            " src='" + embedUrl + "'" +
            " width='640' height='360'" +
            " frameborder='0'" +
            " allowfullscreen=" +
            "'allowfullscreen'></iframe>"
        );
    } else if (urlProvider === "soundcloud") {
        $.getJSON(
            "http://soundcloud.com/oembed?callback=?", {
                format: "js",
                iframe: true,
                url: sourceUrl
            },
            function(data) {
                embedHtml = data.html;
            }
        );

        embedIcon = (
            "<span class='view_on_youtube'>" +
            "<br ><a href=\" \">" +
            "Expand: Show SoundCloud Clip" +
            "</a></span>"
        );
    }

    return {
        html: embedHtml,
        icon: embedIcon,
        json: jsonData,
        url: sourceUrl
    };
}

//****** Is Wordpress Preview ******
function isWordpressPreview(citingUrl) {
    var isWordpressPreviewResult = false;
    var queryString;
    var urlParams;
    var previewId;
    var previewNonce;
    var isPreview;

    if (citingUrl.split("?")[1]) {
        queryString = citingUrl.split("?")[1];
        urlParams = new URLSearchParams(queryString);
        previewId = urlParams.get("preview_id");
        previewNonce = urlParams.get("preview_nonce");
        isPreview = urlParams.get("preview");

        if (isPreview && isInt(previewId) && isHexadecimal(previewNonce)) {
            isWordpressPreviewResult = true;
        }
    }
    return isWordpressPreviewResult;
}

//****** Convert string to UTF-8 ***
function encodeUtf8(s) {
    return unescape(encodeURIComponent(s));
}

function decodeUtf8(s) {
    return decodeURIComponent(escape(s));
}

//****** Is Valid URL ***************
function isValidUrl(string) {
    var url;
    try {
        url = new URL(string);
    } catch (ignore) {
        return false;
    }
    return (
        url.protocol === "http:" ||
        url.protocol === "https:"
    );
}

//************ MAIN ****************

jQuery.fn.quoteContext = function() {

    jQuery(this).each(function() {
        var addQuoteToDom;
        var blockcite;
        var citedUrl;
        var citingQuote;
        var citingUrl;
        var hashKey;
        var hashValue;
        var readBase;
        var readUrl;
        var shard;
        var tagType;

        if (jQuery(this).attr("cite")) {
            blockcite = jQuery(this);
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
                tagType = jQuery(this)[0].tagName.toLowerCase();
                hashKey = quoteHashKey(citingQuote, citingUrl, citedUrl);
                hashKey = encodeUtf8(hashKey);
                
                hashValue = forge_sha256(hashKey);
                shard = hashValue.substring(0, 2);
                readBase = "https://read.citeit.net/quote/";
                readUrl = readBase.concat(
                    "sha256/",
                    webserviceVersionNum,
                    "/", shard,
                    "/", hashValue, ".json"
                );

                addQuoteToDom = function(atTagType, json, atCitedUrl) {
                    var contextAfter;
                    var contextBefore;
                    var curEmbedUi;
                    var html;
                    var popupWidth;
                    var qId;
                    var urlCitedDomain;
                    const w = window.screen.availWidth;

                    if (w <= 320) {
                        popupWidth = 300;
                    } else if (w <= 480) {
                        popupWidth = 340;
                    } else if (w <= 640) {
                        popupWidth = 640;
                    } else if (w <= 768) {
                        popupWidth = 755;
                    } else {
                        popupWidth = 375;
                    }

                    curEmbedUi = embedUi(atCitedUrl, json, atTagType);

                    if (atTagType === "q") {
                        qId = "hidden_" + json.sha256;
                        urlCitedDomain = (
                            json.cited_url
                            .replace("http:\/\/", "")
                            .replace("https:\/\/", "")
                            .replace("www.", "")
                            .split(/[\/?#]/)[0]
                        );

                        html = `<div id='${qId}' class='highslide-maincontent width_${popupWidth}'>` +
                            curEmbedUi.html +
                            `<br />.. ` +
                            json.cited_context_before +
                            `  <span class='q-tag-highlight'><strong>` +
                            json.citing_quote +
                            `</strong></span> ` +
                            json.cited_context_after +
                            `.. </p><p><a href='${json.cited_url}' target='_blank'>Read more</a> | ` +
                            `<a href='javascript:closePopup(${qId});'>Close</a> ` +
                            `<div class='source_url'>source: <a href='${json.cited_url}'>` +
                            urlCitedDomain +
                            `</a> </p></div>`;
                        jQuery("#" + hiddenContainer).append(html);

                        blockcite.wrapInner(
                            `<a class='popup_quote' href='${blockcite.attr("cite")}' onclick='return expandPopup(this ,"${qId}", ${popupWidth})' />`
                        );
                    } else if (atTagType === "blockquote") {
                        html = `<div id='quote_before_${json.sha256}' class='quote_context'>` +
                            `<blockquote class='quote_context'>` +
                            `<span class='context_header'>Context Before:</span>` +
                            `<div class='tooltip'>` +
                            `<span class='tooltip_icon'>?</span>` +
                            `<span class='tooltiptext'>CiteIt.net displays the 500 characters of Context immediately before and after the quote</span></div>` +
                            `<br />` +
                            curEmbedUi.html +
                            ` .. ` +
                            json.cited_context_before +
                            `</blockquote></div>`;
                        blockcite.before(html);

                        html = `<div id='quote_after_${json.sha256}' class='quote_context'>` +
                            `<blockquote class='quote_context'>.. ` +
                            json.cited_context_after +
                            ` ..<br />` +
                            `<span class='context_header'>Context After:</span>` +
                            `<div class='tooltip'>` +
                            `<span class='tooltip_icon'>?</span>` +
                            `<span class='tooltiptext'>CiteIt.net displays the 500 characters immediately before and after the quote</span></div>` +
                            `</blockquote></div>`;
                        blockcite.after(html);

                        contextBefore = jQuery("#quote_before_" + json.sha256);
                        contextAfter = jQuery("#quote_after_" + json.sha256);

                        blockcite.addClass("quote_text");
                        contextBefore.hide();
                        contextAfter.hide();

                        if (json.cited_context_before.length > 0) {
                            html = `<div class='quote_arrows up-arrow' id='context_up_${json.sha256}'>` +
                                ` <a id='quote_arrow_up_${json.sha256}' href="javascript:toggleQuote('quote_arrow_up', 'quote_before_${json.sha256}');">&#9650;</a> ` +
                                trimDefault(curEmbedUi.icon) +
                                `</div>`;
                            contextBefore.before(html);
                        }
                        if (json.cited_context_after.length > 0) {
                            html = `<div class='quote_arrows down-arrow' id='context_down_${json.sha256}'>` +
                                ` <div class='citeit_source'><span class='source'>source: </span>` +
                                ` <a class='citeit_source_domain' href='${json.cited_url}'>` +
                                extractDomain(json.cited_url) +
                                `</a></div>` +
                                ` <a class='down_arrow' id='quote_arrow_down_${json.sha256}' ` +
                                `href="javascript:toggleQuote('quote_arrow_down', 'quote_after_${json.sha256}');">&#9660;</a>` +
                                `</div>`;
                            contextAfter.after(html);
                        }
                    }
                };

                jQuery.ajax({
                    dataType: "json",
                    error: function() {
                        clog("CiteIt Missed: " + readUrl);
                    },
                    success: function(json) {
                        addQuoteToDom(tagType, json, citedUrl);
                        clog("CiteIt Found: " + readUrl);
                    },
                    type: "GET",
                    url: readUrl
                });
            }
        }
    });
};