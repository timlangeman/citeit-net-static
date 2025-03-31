/*jslint browser:true*/
/*global $, jQuery, console, alert*/
/*
 * Quote-Context JS Library
 * https://github.com/CiteIt/citeit-jquery
 *
 * Copyright 2015-2020, Tim Langeman
 * http://www.openpolitics.com/tim
 *
 * Licensed under the MIT license:
 * http://www.opensource.org/licenses/MIT
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
 *
 */

const popup_library = "jQuery";

// div in footer than holds injected json data, requires css class to hide
const hidden_container = "citeit_container";
const webservice_version_num = "0.4";
let embed_ui = "";
let embed_url = "";
let embed_icon = "";
let embed_html = "";

// Remove anchor from URL
const current_page_url = window.location.href.split("#")[0];

jQuery.fn.quoteContext2 = function() {
    "use strict";
    // Add "before" and "after" sections to quote excerpts
    // Designed to work for "blockquote" and "q" tags

    // Setup hidden div to store all quote metadata
    jQuery(this).each(function() {
        // Loop through all the submitted tags (blockquote or q tags) to
        // see if any have a "cite" attribute
        let blockcite = jQuery(this);

        if (jQuery(this).attr("cite")) {

            const cited_url = blockcite.attr("cite");
            const citing_quote = blockcite.text();

            console.log("*****************  cited_url   ******************");
            console.log(cited_url);


            // If Permalink isn't supplied, default to current page
            let citing_url = blockcite.attr("data-citeit-citing-url");
            if (!isValidUrl(citing_url)) {
                citing_url = current_page_url;
            }

            // Remove Querystring if WordPress Preview
            if (isWordpressPreview(citing_url)) {
                citing_url = citing_url.substring(0, citing_url.indexOf("?")); // get citing_url before '?'
            }

            // If they have a cite tag, check to see if its hash is already saved
            if (cited_url.length > 3) {
                const tag_type = jQuery(this)[0].tagName.toLowerCase();
                let hash_key = quoteHashKey(citing_quote, citing_url, cited_url);

                // Javascript uses utf-16. Convert to utf-8
                hash_key = encode_utf8(hash_key);
                console.log(hash_key);
                const hash_value = forge_sha256(hash_key);
                console.log(hash_value);

                const shard = hash_value.substring(0, 2);
                const read_base = "https://read.citeit.net/quote/";
                const read_url = `${read_base}sha256/${webservice_version_num}/${shard}/${hash_value}.json`;
                let json = null;

                // See if a json summary of this quote was already created
                // and uploaded to the content delivery network: read.citeit.net
                jQuery.ajax({
                    type: "GET",
                    url: read_url,
                    dataType: "json",
                    success: function(json) {
                        addQuoteToDom(tag_type, json, cited_url, blockcite);
                        console.log(`************ CiteIt Found: ************`);
                        console.log(citing_quote);
                        console.log("CITTED_URL: " + json.cited_url);
                        console.log(json.sha256);
                        console.log(` Quote: ${read_url}`);
                   },
                    error: function() {
                        console.log(`CiteIt Missed: ${read_url}`);
                        console.log(`       Quote: ${citing_quote}`);
                     }
                });

            } // if (cited_url.length > 3) {

        } // if (jQuery(this).attr("cite")) {

    }); // jQuery(this).each(function() { : blockquote, or q tag

}; // jQuery.fn.quoteContext2 = function()

// Add Hidden div with context to DOM
function addQuoteToDom(tag_type, json, cited_url, blockcite) {
    if (json.cited_url) {

        const player_json = `player_${json.sha256}`;
        const player_id = `player_${json.sha256}`;
        const $player = jQuery(`#${player_id}`);
        console.log("Player IDD: ", player_id);


        let is_video = '';
        const url_cited_domain = json.cited_url.replace('http://','').replace('https://','').replace('www.','').split(/[/?#]/)[0];
        let media_type = 'text';
        if (url_cited_domain !== 'youtube.com' && url_cited_domain !== 'youtu.be') {
            is_video = "not_video";
        } else {
            media_type = 'video';
        }

        // lookup html for video ui and icon
        let embed_ui = embedUi(cited_url, json, tag_type);
        

        // Popup Window: Show Context
        if (tag_type === "q") {
            embed_ui = embedUi(cited_url, json);
            const q_id = `hidden_${json.sha256}`;

            let play_buttons = '';

            let start_playing_at = '';
            let heading = '';
            let tooltip = '';

            let title = '';
            if (media_type === 'videox') {
                title = `<div id='title_${json.sha256}' class='title'>Loading video ..</div>`;
            }

            let description = '';  // and date published

            let transcript_found = '';
            const play_video_onclick = `playVideo('${json.sha256}', embed_ui.start_time)`;

            if (media_type === 'video' && json.cited_context_before.length < 3 && json.cited_context_after.length < 3) {
                transcript_found = "<h3 class='no-context-found'>&uarr; You can view the Video .. &uarr; </h3><h4 class='without_transcript'>(but there is no transcript)</h4>";
            }

            if (embed_ui.start_time) {
                start_playing_at = `${play_buttons}<div class='start_video'>Video starts at <i>${seconds_to_minutes(embed_ui.start_time)}</i></div>`;
            }

            let context_found = '';
            let context_not_found = '';
            if (json.cited_context_before.length > 3 && json.cited_context_after.length > 3) {
                // context_found = '<h3 class="context_found">Context Found</h3>';
            }
            if (json.cited_context_before.length < 3 && json.cited_context_after.length < 3) {
                context_found = '<span class="video_without_context">View (without context)</span></h3>';
                context_not_found = "<br /><br />";
            }

            if (media_type === 'text') {
                heading = "<b>Text Citation</b>: <img src='https://www.citeit.net/assets/images/text-icon-small.png' class='text-icon' width='27' height='27' alt='Text icon' /> (no video)";
            }
            
            const js_popup = `javascript:closePopup('${json.sha256}');`;
            console.log("Quote: ________________________________________");

            // Add content to a hidden div, so that the popup can later grab it
            const popup_container = jQuery(`#${hidden_container}`).append(
                `<div id='${q_id}' class='highslide-maincontent'>${heading}
                ${media_type === 'video' ? `<div class='video-container${is_video}'><div id='${player_json}'></div></div>` : ''}
                ${media_type === 'videox' ? `<div class='button' onClick='pauseVideo(${embed_ui.json.sha256})'>Pause Video</div>` : ''}
                ${media_type === 'videox' ? `<div class='button' onClick='stopVideo()'>Stop Video</div><br />` : ''}
                ${title} 
                ${description} 
                ${start_playing_at}
                ${transcript_found}
                ${context_found}
                <div class='context'>.. 
                ${context_not_found}
                <span class='quote_context'>${json.cited_context_before.slice(-get_device_size('context_length'))} </span>
                <span class='q-tag-highlight quote_text'><strong>${json.citing_quote}</strong></span> 
                ${context_not_found}
                <span class='quote_context'>${json.cited_context_after.substring(0, get_device_size('context_length'))} .. </span></p></div>
                <p><a class='close' href=${js_popup}>Close</a> <div class='source_url'><a target='_blank' class='source_label' href='${json.cited_url}'><b>View Original Source:</b><a target='_blank' class='source_domain' href='${json.cited_url}'>${url_cited_domain}</a> </p></div>`
            );

            console.log(`Length: 
                _______________________________________________________________
                Before: ${json.cited_context_before}, 
                _______________________________________________________________
                Quote: ${json.citing_quote}, 
                _______________________________________________________________
                After: ${json.cited_context_after}
                _______________________________________________________________
            `);
            
            console.log(`Length: 
                _______________________________________________________________
                Before: ${json.cited_context_before}, 
                _______________________________________________________________
                Quote: ${json.citing_quote}, 
                _______________________________________________________________
                After: ${json.cited_context_after}
                _______________________________________________________________
            `);

            if (media_type === 'video') {
                tooltip = `title='View Video @ ${seconds_to_minutes(embed_ui.start_time)}'`;
            } else if (media_type === 'text') {
                tooltip = "title='View Quote Context: 500 characters before and after.'";
            }

            // Style quote as a link that calls the popup expander:
            blockcite.wrapInner(`<a id='link_${json.sha256}' class='q-tag' href='${blockcite.attr("cite")}' ${tooltip} onclick='return expandPopup(this, "${q_id}")' />`);

            if (media_type === 'video') {
                const youtube_icon = `<a title='View Context: Video @ ${seconds_to_minutes(embed_ui.start_time)}'><img class='youtube-icon' onclick='return expandPopup(this, "${q_id}")' src='https://pages.citeit.net/wp-content/plugins/CiteIt.net/img/youtube_logo_mini.png' width='40' height='27' /></a>`;
                jQuery(`a#link_${json.sha256}`).append(youtube_icon);
            }

            if (media_type === 'text') {
                const text_icon = `<a title='View Context: Text (no video)' onclick='return expandPopup(this, "${q_id}")'><img src='https://www.citeit.net/assets/images/text-icon-small.png' class='text-icon' width='27' height='27' alt='text context' title='View Context: Text (no video)' /></a>`;
                jQuery(`a#link_${json.sha256}`).append(text_icon);
            }

            // Prevent Video from Scrolling out of Sight
            // popup_container.scrollTop();
        }

        // Expanding Blockquote: Show Context
        else if (tag_type === "blockquote") {

            // lookup html for video ui and icon
            embed_ui = embedUi(cited_url, json);

            let title = '';
            if (media_type === 'videox') {
                title = `<div id='title_${json.sha256}' class='title'>Loading video ..</div>`;
            }

            const play_video_onclick = `playVideo('${json.sha256}', embed_ui.start_time)`;
            let start_playing_at = '';

            if (embed_ui.start_time) {
                start_playing_at = `<div class='start_playing'>Video Starts at <i>${seconds_to_minutes(embed_ui.start_time)}</i></div>`;
            }

            html = embed_ui.html ?? '';

            
            // Fill 'before' and 'after' divs and then quickly hide them
            blockcite.before(`<div id='quote_before_${json.sha256}' class='quote_context'>
                <blockquote class='quote_context'>
                    <span class='context_header'>Context Before:</span> 
                    <div class='tooltip'><span class='tooltip_icon'>?</span>
                        <span class='tooltiptext'>CiteIt.net displays the 500 characters of Context immediately before and after the quote</span>
                    </div><br />
                    ${media_type === 'video' ? 
                        `<div class='video-container${is_video}'>
                            <div id='${player_json}'>
                                <iframe
                                    src='${getYoutubeEmbedUrl(cited_url)}'
                                    width='100%'
                                    height='185px'
                                    frameborder='0'
                                    allowfullscreen
                                    allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
                                    title='YouTube video player'
                                ></iframe>
                            </div>
                        </div>` : 
                        ''
                    }
                    ${start_playing_at}
                    <div class='context_block'> .. ${json.cited_context_before}</div>
                </blockquote>
            </div>`);

            blockcite.after(`<div id='quote_after_${json.sha256}' class='quote_context'>
                <blockquote class='quote_context'>
                    .. ${json.cited_context_after} ..
                    <br /><span class='context_header'>Context After:</span>
                    <div class='tooltip'><span class='tooltip_icon'>?</span><span class='tooltiptext'>CiteIt.net displays the 500 characters immediately before and after the quote</span></div>
                </blockquote></div>
                <div class='citeit_source'><span class='citeit_source_label'>source: </span>
                <a class='citeit_source_domain' href='${json.cited_url}'>${extractDomain(json.cited_url)}</a></div>`
            );

            if (media_type === 'video') {
                const youtube_icon = `<a href='#context_up_${json.sha256}' onclick='toggleBlockquote("quote_arrow_up", "quote_before_${json.sha256}");'><img class='youtube-icon' src='https://pages.citeit.net/wp-content/plugins/CiteIt.net/img/youtube_logo_mini.png' width='40' height='27' /></a>`;
                const view_label = `<a href='#context_up_${json.sha256}' onclick='toggleBlockquote("quote_arrow_up", "quote_before_${json.sha256}");'> View Context: Video @ ${seconds_to_minutes(embed_ui.start_time)}</a>`;
                const youtube_label = `${youtube_icon} <span class='highlight'>&larr;${view_label} </span><br />`;

                blockcite.append(youtube_label);

            } else if (media_type === 'text') {
                const text_icon = `<a href='#context_up_${json.sha256}' onclick='toggleBlockquote("quote_arrow_up", "quote_before_${json.sha256}");'><img src='https://www.citeit.net/assets/images/text-icon-small.png' class='text-icon' width='27' height='27' alt='Text icon' /></a>`;
                const view_label = `<a href='#context_up_${json.sha256}' onclick='toggleBlockquote("quote_arrow_up", "quote_before_${json.sha256}");'> Expand to View Context: 500 characters before & after</a>`;
                const text_label = `${text_icon} <span class='highlight'>&larr;${view_label} </span><br />`;

                blockcite.append(text_label);
            }

            const context_before = jQuery(`#quote_before_${json.sha256}`);
            const context_after = jQuery(`#quote_after_${json.sha256}`);

            /* Main Class */
            blockcite.addClass('quote_text');

            context_before.hide();
            context_after.hide();

            if (json.cited_context_before.length > 0) {
                let expand_label = '';
                if (media_type === 'text') {
                    expand_label = `<br /><a id='quote_arrow_up_${json.sha256}' href="javascript:toggleBlockquote('quote_arrow_up', 'quote_before_${json.sha256}');">Expand to View Context</a>`;
                }

                context_before.before(`<div class='quote_arrows' id='context_up_${json.sha256}'> 
                <a id='quote_arrow_up_${json.sha256}' href="javascript:toggleBlockquote('quote_arrow_up', 'quote_before_${json.sha256}');">&#9650;</a>${expand_label}${trimDefault(embed_ui.icon)}
                </div>`
                );
            }
            if (json.cited_context_after.length > 0) {
                context_after.after(`<div class='quote_arrows' id='context_down_${json.sha256}'>  
                <a id='quote_arrow_down_${json.sha256}' href="javascript:toggleBlockquote('quote_arrow_down', 'quote_after_${json.sha256}');">&#9660;</a></div>`);
            }

        } // elseif (tag_type === 'blockquote')

    } // end: addQuoteToDom(tag_type, json, cited_url) {

}

//************* Pause Video ****************

function pauseVideo(sha256) {
    "use strict";
    var hidden_popup_id = 'hidden_' + sha256;
    var player_popup_id = 'iframe#player_' + sha256;

    console.log("player_popup_id:");
    console.log(player_popup_id);

    var div_id = hidden_popup_id;
    var div = document.getElementById(div_id);

    if (jQuery(player_popup_id).is("iframe")) {
        jQuery(player_popup_id)[0].contentWindow.postMessage(
            '{"event":"command","func":"' + 'pauseVideo' + '","args":""}', '*'
        );
    }
}

//*********** Close Popup ************
function closePopup(sha256) {
    "use strict";
    var hidden_popup_id = 'hidden_' + sha256;
    pauseVideo(sha256);

    // assumes jQuery library
    jQuery('#' + hidden_popup_id).fadeTo('slow', function () {
        jQuery('#' + hidden_popup_id).dialog("close");
    });

    /* Remove highlight: active */
    setTimeout(function() {
        jQuery('a#link_' + sha256).removeClass('active', 1000);
    }, 1500);

    /* Hide tooltip */
    jQuery('a#link_' + sha256).tooltip({
        disabled: true
    });

    jQuery('#' + hidden_popup_id).dialog("close");

    /* Re-enable tooltip
    setTimeout(function() { 
        jQuery('a#link_' + sha256).tooltip({  
        disabled: false
    }, 500);
    */

}

function load_popup_iframes() {
    console.log("load popup iframes");
}

//************ Seek Video ***************
function seek(sec) {
    "use strict";
    var seconds = 0;
    if (player) {
        seconds += sec;
        player.seekTo(seconds, true);
    }
}

//*********** Trim Regex ************
function trimRegex(str) {
    "use strict";
    // Purpose: Backwards-compatible string trim (may not be necessary)
    // Credit: Jhankar Mahbub:  (used for backward compatibility.
    // GitHub Profile: https://github.com/khan4019/jhankarMahbub.com
    // Homepage: http://www.jhankarmahbub.com/
    // Source: http://stackoverflow.com/questions/10032024/how-to-remove-leading-and-trailing-white-spaces-from-a-given-html-string
    return str.replace(/^[ ]+|[ ]+$/g, "");
}

//*********** URL without Protocol ************
function urlWithoutProtocol(url) {
    "use strict";
    // Remove http(s):// and trailing slash
    // Before: https://www.example.com/blog/first-post/
    // After:  www.example.com/blog/first-post

    var url_without_trailing_slash = url.replace(/\/$/, "");
    var url_without_protocol = url_without_trailing_slash.replace(/^https?\:\/\//i, "");

    return url_without_protocol;
}

//****************** String to Array ********************
function stringToArray(s) {
    "use strict";
    // Credit: https://medium.com/@giltayar/iterating-over-emoji-characters-the-es6-way-f06e4589516
    // convert string to Array

    var retVal = [];
    var ch;

    for (ch of s) {
        retVal.push(ch);
    }
    return retVal;
}

//******************* Normalize Text **********************
function normalizeText(str, escape_code_points) {
    "use strict";
    /* This javascript function performs the same functionality as the
    python method: citeit_quote_context.text_convert.escape()
    - https://github.com/CiteIt/citeit-webservice/blob/master/app/lib/citeit_quote_context/text_convert.py

    It removes an array of symbols from the input str
    */

    var idx, chr, chr_code;
    var str_return = ''; //default: empty string
    var input_code_point = -1;
    var str_array = stringToArray(str); // convert string to array

    if (str_array.length > 0) {
        for (idx in str_array) {
            // Get Unicode Code Point of Current Character
            chr = str_array[idx];
            chr_code = chr.codePointAt(0);
            input_code_point = chr.codePointAt(0);

            // Only Include this character if it is not in the
            // supplied set of escape_code_points
            if (!(escape_code_points.has(input_code_point))) {
                str_return += chr; // Add this character
            }
        }
    }
    return str_return;
}

//******** Escape URL *************
function escapeUrl(str) {
    "use strict";
    // This is a list of Unicode character points that should be filtered out from the quote hash
    // This list should match the webservice settings:
    // * https://github.com/CiteIt/citeit-webservice/blob/master/app/settings-default.py
    //   - URL_ESCAPE_CODE_POINTS

    var replace_chars = new Set([
        10, 20, 160
    ]);

    // str = trimRegex(str);   // remove whitespace at beginning and end
    return normalizeText(str, replace_chars);
}

//********* Escape Quote ************
function escapeQuote(str) {
    "use strict";
    // This is a list of Unicode character points that should be filtered out from the quote hash
    // This list should match the webservice settings:
    // * https://github.com/CiteIt/citeit-webservice/blob/master/app/settings-default.py
    //   - TEXT_ESCAPE_CODE_POINTS

    str = str.replaceAll(`"`, ``);  // Fix: double quotes are not caught by the following unicode replace_char code points

    var replace_chars = new Set([
        2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 39, 96, 160, 173, 699, 700, 701, 702, 703, 712, 713, 714, 715, 716, 717, 718, 719, 732, 733, 750, 757, 8211, 2013, 2014, 8212, 8213, 8216, 8217, 8219, 8220, 8221, 8226, 8203, 8204, 8205, 65279, 8232, 8233, 133, 5760, 6158, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8239, 8287, 8288, 12288
    ]);

    return normalizeText(str, replace_chars);
}

//****************** Quote Hash Key ********************I**
function quoteHashKey(citing_quote, citing_url, cited_url) {
    "use strict";
    var quote_hash = escapeQuote(citing_quote) + "|" +
        urlWithoutProtocol(escapeUrl(citing_url)) + "|" +
        urlWithoutProtocol(escapeUrl(cited_url));

    return quote_hash;
}

//****************** Quote Hash **************************
function quoteHash(citing_quote, citing_url, cited_url) {
    "use strict";
    var url_quote_text = quoteHashKey(citing_quote, citing_url, cited_url);
    var quote_hash = forge_sha256(url_quote_text); // https://github.com/brillout/forge-sha256
    return quote_hash;
}

//*************** Extract Domain from URL ****************
function extractDomain(url) {
    "use strict";
    var domain;
    //find & remove protocol (http, ftp, etc.) and get domain
    if (url.indexOf("://") > -1) {
        domain = url.split("/")[2];
    } else {
        domain = url.split("/")[0];
    }

    //find & remove port number
    domain = domain.split(":")[0];
    return domain;
}

//******************** Test if Integer *******************
function isInt(data) {
    "use strict";
    if (data === parseInt(data, 10)) {
        return false;
    } else {
        return true;
    }
}

//******************* Convert Seconds to Minutes ****************
// Credit: https://www.tutorialspoint.com/How-to-convert-JavaScript-seconds-to-minutes-and-seconds
function seconds_to_minutes(seconds) {
    "use strict";
    let minutes = Math.floor(seconds / 60);
    let extraSeconds = seconds % 60;
    minutes = minutes < 10 ? "0" + minutes : minutes;
    extraSeconds = extraSeconds< 10 ? "0" + extraSeconds : extraSeconds;
    return  minutes + " min " + extraSeconds + " sec";
}

//****************** Text if Hexadecimal format *************
function isHexadecimal(str) {
    "use strict";
    // Credit: https://www.w3resource.com/javascript-exercises/javascript-regexp-exercise-16.php
    regexp = /^[0-9a-fA-F]+$/;

    if (regexp.test(str)) {
        return true;
    } else {
        return false;
    }
}

//******************** Play Video ****************************

function playVideo(sha256, event, start_sec=0) {
    var player_sha256 = '#player_' + sha256;

    // Set Start Time:
    if (start_sec > 0) {
        videoAction(sha256, 'seek', [start_sec, true]);
    } else {
        // Play Video
        videoAction(sha256, 'playVideo', []);
        //toggleVideo(sha256, event)
    }
}

function toggleVideo(sha256, event) {
    "use strict";
    var that = this;
    var player_sha256 = '#player_' + sha256;

    console.log(event);

    if (event.data == YT.PlayerState.PLAYING){
        videoAction(sha256, 'pauseVideo', []);
    }
    else if (event.data == YT.PlayerState.PAUSED) {
        // TODO: alert("else if paused ..");
        videoAction(sha256, 'playVideo', []);
    } else {
        // TODO: alert('else');
    }
}

function videoAction(sha256, func, args = []) {
    // var sha256 = 'a5ce68c1922369ecabf3623df28e9da293bb0e4a202d55baaa1277a8b9431f28';
    var player_sha256 = '#player_' + sha256;

    var data = {event: 'command', func: func, args: args};
    var message = JSON.stringify(data);
    jQuery(player_sha256)[0].contentWindow.postMessage(message, '*');
}

function clearVideoTitle(sha256){
    // Clear video title so tooltips don't get in the way

    setTimeout(function() {
        jQuery('a#link_' + sha256).tooltip({
        disabled: false  // true
        });

        jQuery('#player_' + sha256).attr("title", '');
    }, 400);

    /* Hide tooltip & Clear Title	*/
    setTimeout(function() {
        jQuery('a#link_' + sha256).tooltip({
        disabled: false  // true
        });

        jQuery('#player_' + sha256).attr("title", '');
    }, 1000);
}

function onYouTubePlayerAPIReady() {
    console.log("API Ready");
    // alert("API Ready");
}

function onPlayerReady(event) {
    "use strict";               
    var that = this;

    // var iframe_title = jQuery('#player_' + json.sha256).attr("title");
    iframe_title_time = "View Video Context @ " + seconds_to_minutes(embed_ui.start_time) + ' : ' + iframe_title;

    // Set Link & heading title:
    jQuery('#link_' + json.sha256).attr("title", iframe_title_time);
    jQuery('#title_' + json.sha256).text(iframe_title);

    clearVideoTitle(json.sha256);
}

function onPlayerStateChange(event) {
    "use strict";
    // clearVideoTitle(json.sha256);   /* test */

    //toggleVideo(sha256, event);
console.log("** toggle video **");
}

// **************** Begin: Calculate Video UI ******************
function embedUi(url, json, tag_type) {
    "use strict";

    const media_providers = ["youtube", "vimeo", "soundcloud"];
    let url_provider = "";
    let media_type = "text";
    let embed_ui = {};
    embed_ui.read_more_text = "Read More";
    embed_ui.start_time = "";


    // Parse the URL to determine the provider
    const url_parsed = urlParser.parse(url);
    if (url_parsed && url_parsed.provider) {
        url_provider = url_parsed.provider;
    }

    if (url_provider === "youtube") {
        media_type = "video";

        // Generate YouTube embed URL
        const embed_url = urlParser.create({
            videoInfo: {
                provider: url_provider,
                id: url_parsed.id,
                mediaType: "video"
            },
            format: "embed",
            params: {
                start: url_parsed.params?.start || 0
            }
        });

        // Add sha256 hash if not present
        if (!json.sha256 && url) {
            const citing_url = current_page_url;
            const cited_url = url;
            const citing_quote = json.citing_quote || '';
            
            // Generate SHA256 hash using the same method as in quoteHashKey
            const hash_key = quoteHashKey(citing_quote, citing_url, cited_url);
            json.sha256 = forge_sha256(encode_utf8(hash_key));

            console.log("Generated SHA256:", {
                citing_quote: citing_quote,
                citing_url: citing_url,
                cited_url: cited_url,
                hash_key: hash_key,
            });
        }

        // Return a placeholder instead of the iframe
        embed_ui.html = `zzzz<div class="video-placeholder" data-embed-url="${embed_url}" data-sha256="${json.sha256}">
                            <img src="https://img.youtube.com/vi/${url_parsed.id}/hqdefault.jpg" alt="Video Thumbnail" />
                            <!--button class="play-button">Play</button-->
                         </div>`;
    }

    embed_ui.url = url;
    embed_ui.html = '<b>Strong</b>';
    embed_ui.json = json;
    return embed_ui;
}

// ******************** Is Wordpress Preview ***********************
function isWordpressPreview(citing_url) {
    "use strict";
    var is_wordpress_preview = false;

    // Remove Querystring if it exists and matches 3 criteria
    if (citing_url.split('?')[1]) {

        var querystring = citing_url.split('?')[1]; // text after the "?"
        var url_params = new URLSearchParams(querystring);

        var preview_id = url_params.get('preview_id'); // integer: 209
        var preview_nonce = url_params.get('preview_nonce'); // hex: d73deaada1
        var is_preview = url_params.get('preview'); // boolean: true

        // Only Assume is_wordpress_preview if url matches all three parameters
        if (is_preview && isInt(preview_id) && isHexadecimal(preview_nonce)) {
            is_wordpress_preview = true;
        }
    }

    return is_wordpress_preview;
}

// *************** Convert string to UTF-8 *******************

function encode_utf8(s) {
    "use strict";
    return unescape(encodeURIComponent(s));
}

function decode_utf8(s) {
    "use strict";       
    return decodeURIComponent(escape(s));
}

//****************** Is Valid URL ***********************
// Credit: https://stackoverflow.com/questions/5717093/check-if-a-javascript-string-is-a-url
// Pavlo: https://stackoverflow.com/users/1092711/pavlo

function isValidUrl(string) {
    let url;

    try {
    url = new URL(string);
    } catch (_) {
    return false;
    }

    return url.protocol === "http:" || url.protocol === "https:";
}

//********************** Get Nth index position ***************************/
// Credit: // https://stackoverflow.com/users/80860/kennebec
// Source: https://stackoverflow.com/questions/14480345/how-to-get-the-nth-occurrence-in-a-string

function nthIndex(str, pat, n) {
    "use strict";
    var L = str.length,
        i = -1;
    while (n-- && i++ < L) {
        i = str.indexOf(pat, i);
        if (i < 0) break;
    }
    return i;
}

function trimDefault(str) {
    "use strict";
    if (str) {
        return str;
    } else {
        return '';
    }
}

//*********** Toggle Quote ************
function toggleQuote(section, id) {
    "use strict";
    /* Example:
        <a href=\"javascript:toggleQuote('after', 'quote_after_" + json['sha256'] +"');\">&#9660;</a></div>");

        section: quote_arrow_down
        id: quote_after_655df86dfb52b7471d842575e72f5223c8d38898ddbf064a22932a5d3f6f23f8
    */

    //rotate arrow icons on click
    let sha = id.split("_")[2]; // 655df86dfb52b7471d842575e72f5223c8d38898ddbf064a22932a5d3f6f23f8
    let parent_div_id = section + "_" + sha; // context_down_655df86dfb52b7471d842575e72f5223c8d38898ddbf064a22932a5d3f6f23f8

    jQuery("#" + parent_div_id).toggleClass("rotated180"); // rotate arrows: flip up or down
    jQuery("#" + id).fadeToggle();
}

function toggleBlockquote(section1, id) {
    /* Toggle both the "before" and "after" sections at the same time */

    const sections = ['quote_before', 'quote_after' ];
    let sha256 = id.split("_")[2];

    console.log("toggleBlockquote");
    pauseVideo(sha256);

    for ( let section_id in sections ){

        let sha256 = id.split("_")[2]; // 655df86dfb52b7471d842575e72f5223c8d38898ddbf064a22932a5d3f6f23f8
        let parent_div_id = sections[section_id] + "_" + sha256; // context_down_655df86dfb52b7471d842575e72f5223c8d38898ddbf064a22932a5d3f6f23f8

        jQuery("#" + parent_div_id).toggleClass("rotated180");
        jQuery("#" + parent_div_id).fadeToggle('slow','linear');

        // Clear video title so tooltips don't get in the way
        setTimeout(function() {
            jQuery('#player_' + sha256).attr("title", '');
        }, 350);

    }
}

// *********** Expand Popup2 *************
function expandPopup2(tag, hidden_popup_id, popup_width=340) {
    // alert(hidden_popup_id);

    return false; // Don't follow link
}

// *********** Expand Popup *************
function expandPopup(tag, hidden_popup_id, popup_width=340) {

    // Get cited URL and check if it's a video
    let cited_url = jQuery(tag).attr('href');    
    
    // Exit early if not a video URL
    if (!is_video(cited_url)) {
        console.log("Not a video URL, exiting expandPopup");
        // return false;
    }

    // Highlight existing quote
    let sha256 = hidden_popup_id.replace('hidden_', '');
    jQuery('a#link_' + sha256).addClass('active');

    console.log("cited_url: " + cited_url);

    // Configure jQuery Popup Library
    jQuery.curCSS = jQuery.css;

    // Scale Popup Window Width based on Window Height:
    if ( (window.innerWidth * 0.95) >= 400) {
        popup_width = 400;   // max width;
    }
    else {
        popup_width = (window.innerWidth * 0.95);
    }

    // Scale Window Height based in Window Height
    var maxHeight = window.innerHeight * 0.97;

	if (maxHeight < 800){
		window_height = maxHeight;
	}
	else if (maxHeight < 1000){
		window_height = window.innerHeight * 0.92;
	}
	else if (maxHeight < 1200){
		window_height = window.innerHeight * 0.89;
	}
	else if (maxHeight < 1600){
		window_height = 1000;
	}
	else if (maxHeight < 2000){
		window_height = 1000;
	}
	else if (maxHeight < 2500){
		window_height = 1000;
	}
	else {
		window_height = window.innerHeight * 0.65;	
	}

    console.log('hHeight: ' + window_height);

    // Configure jQuery Popup Library
    jQuery.curCSS = jQuery.css;

    jQuery("#" + hidden_popup_id).dialog({
        autoOpen: false,
        closeOnEscape: true,
        closeText: "hide",
        draggable: true,
        resizable: true,
        autoResize:true,
        width: popup_width,  /* different for Phones */
        modal: false,
        height: window_height, /******** window_height, **********/ 
        scrollbars: true,
        position: [0,20],
        create: function (event) { jQuery(event.target).parent().css('position', 'fixed');},
        title: "Quote Context by CiteIt.net",
        close : function(){
            sha256 = hidden_popup_id.replace('hidden_', '');
            closePopup(sha256);
        },
        hide: {
            effect: "size",
            duration: 400
        },
        show: {
            effect: "scale",
            duration: 400
        },
        // In the dialog open function, update the call:
        open: function() {
            const $popup = jQuery(this);
            const player_id = `player_${hidden_popup_id.replace('hidden_', '')}`;
            const $player = jQuery(`#${player_id}`);
            console.log("Player ID: ", player_id);
            
            // Pass both required parameters
            embed_videoxx($player, cited_url);
            
            // Scroll popup to top
            $popup.scrollTop(0);
        }
    });
    
    // Add centering and other settings
    jQuery("#" + hidden_popup_id).dialog("option",
        "position", {
            at: "center center",
            of: window,
        }
    ).dialog("option", "hide", {
        effect: "size",
        duration: 400
    }).dialog( "option", { resizable: true 
    }).dialog( "option", { draggable: true
    }).dialog("option", "show", {
        effect: "scale",
        duration: 400
    }).dialog( "option", "maxHeight", 250
    ).dialog({
        "title": "Quote Context by CiteIt.net"
    }).dialog("open").blur();

    // Pause Popup Video on Close event
    jQuery("#" + hidden_popup_id).on('dialogclose', function(event, hidden_popup_id) {
        // sha256 = hidden_popup_id.replace('hidden_', '');
        /// closePopup(sha256);
        // console.log("____________CLOSE___________" + sha256);
    });

    // Close popup when you click outside of it
    jQuery(document).mouseup(function(e) {
        var popupbox = jQuery(".ui-widget-overlay");
        if (popupbox.has(e.target).length === 0) {
            // Uncomment line below to close popup when user clicks outside it
            //$("#" + hidden_popup_id).dialog("close");
        }
    });

    return false; // Don't follow link
}

function getYoutubeEmbedUrl(cited_url) {
    "use strict";
    
    try {
        // Parse URL using existing urlParser
        const url_parsed = urlParser.parse(cited_url);
        
        if (url_parsed && url_parsed.id) {
            // Create embed URL with required parameters
            return `https://www.youtube.com/embed/${url_parsed.id}?enablejsapi=1&origin=${window.location.origin}`;
        }
    } catch (e) {
        console.error("Error converting YouTube URL:", e);
    }

    return null;
}

function embed_videoxx($player, cited_url) {
    console.log("******************** EMBED VIDEO *******************");
    
    // Validate parameters
    if (!$player || !cited_url) {
        console.error("Missing required parameters:", { player: $player, cited_url: cited_url });
        return;
    }

    // Check if player element exists
    if (!$player.length) {
        console.error("Player element not found");
        return;
    }

    // Check if already initialized
    if ($player.hasClass('initialized')) {
        console.log("Player already initialized");
        return;
    }

    // Get embed URL
    const embed_url = getYoutubeEmbedUrl(cited_url);
    if (!embed_url) {
        console.error("Could not generate embed URL");
        return;
    }

    console.log('>> ' + embed_url);


    // Create and add iframe
    const $iframe = jQuery('<iframe>', {
        src: embed_url,
        width: '100%',
        height: '185px',
        frameborder: '0',
        allowfullscreen: true,
        allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
    });

    //alert('>>> ' + embed_url);

    console.log("IFRAME Populated.");
    $player.html($iframe);
    $player.addClass('initialized');
    
    // Initialize YouTube API
    if (typeof YT !== 'undefined' && YT.Player) {
        new YT.Player($player[0], {
            events: {
                onReady: onPlayerReady,
                onStateChange: onPlayerStateChange
            }
        });
    }

    console.log("Embed video: end");
}


function embed_video(player, iframe){

    // Embed Video
    if ($player.length && !$player.hasClass('initialized')) {
        const embed_url = $player.data('embed-url');
        const $iframe = jQuery('<iframe>', {
            src: getYoutubeEmbedUrl(cited_url),
            width: '100%',
            height: '185px',
            frameborder: '0',
            allowfullscreen: true
        });

        console.log("IFRAME Populated.");
        $player.html($iframe);
        $player.addClass('initialized');
        
        // Initialize YouTube API
        if (typeof YT !== 'undefined' && YT.Player) {
            new YT.Player($player[0], {
                events: {
                    onReady: onPlayerReady,
                    onStateChange: onPlayerStateChange
                }
            });
        }
    }
    console.log("Embed video: end");
}

function get_device_size(metric) {
    // TODO: Galaxy Fold: move window_width to embed_ui
    // widen: Nest Hub window
    "use strict";
    
    let context_length = 500;
    let window_width = 400;
    let window_height = 500;

    console.log("Height: " + window.innerHeight);

    // Scale Window Height based in Window Height
    if ((window.screen.availHeight <= 500) && (window.screen.availHeight <= 700)) {
        console.log("500-700");
        window_width = 400;
        window_height = 390;
        context_length = 300;
    } else if ((window.screen.availHeight <= 600) && (window.screen.availHeight <= 700)) {
        console.log("600-700");
        window_width = 400;
        window_height = 490;
        context_length = 300;
    } else if ((window.screen.availHeight <= 700) && (window.screen.availHeight <= 800)) {
        console.log("700-800");
        window_height = 630;
        if (window.screen.availWidth <= 320) {
            window_width = 275;
        }
        else {
            window_width = 400;
        }
        context_length = 340;
    } else if ((window.screen.availHeight <= 800) && (window.screen.availHeight <= 1000)) {
        console.log("800-1000");
        window_width = 400;
        window_height = 690;
        context_length = 400;
    } else if ((window.screen.availHeight <= 1000) && (window.screen.availHeight <= 1200)) {
        console.log("1000-1200xx");
        window_width = 430;
        window_height = 830;
        context_length = 450;
    } else if ((window.screen.availHeight <= 1200) && (window.screen.availHeight <= 5200)) {
        console.log("1200-5200");
        window_width = 400;
        window_height = 1000;
        context_length = 500;
    } else if ((window.screen.availHeight <= 1200) && (window.screen.availHeight <= 5200)) {
        console.log("1200-5200");
        window_width = 400;
        window_height = 1010;
        context_length = 500;
    } else {
        window_width = 400;
        window_height = 950;
        context_length = 430;
    }

    let metrics = {
        'context_length': context_length,
        'window_width': window_width,
        'window_height': window_height,
    }

    return metrics[metric] || 500;
}

function onPlayerError(e) {
    "use strict";
    console.log('An error occurred: ' + e.data);
}

function is_video(url) {
    "use strict";
    
    // Early return if no URL
    if (!url) return false;

    try {
        // Parse URL using existing urlParser
        const url_parsed = urlParser.parse(url);
        
        // Check if provider is YouTube and has valid video ID
        if (url_parsed && 
            url_parsed.provider && 
            (url_parsed.provider === 'youtube' || url_parsed.provider === 'youtu.be') && 
            url_parsed.id) {
            return true;
        }

        // Alternative check: match YouTube URL patterns
        const youtube_patterns = [
            /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]{11}/,
            /^https?:\/\/(www\.)?youtube\.com\/embed\/[\w-]{11}/,
            /^https?:\/\/(www\.)?youtu\.be\/[\w-]{11}/
        ];

        return youtube_patterns.some(pattern => pattern.test(url));

    } catch (e) {
        console.error("Error checking video URL:", e);
        return false;
    }
}

jQuery.fn.quoteContext = jQuery.fn.quoteContext2;  // Alias