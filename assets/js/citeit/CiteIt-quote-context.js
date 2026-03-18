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

var popup_library = "jQuery";

// div in footer than holds injected json data, requires css class to hide
var hidden_container = "citeit_container";
var webservice_version_num = "0.4";
var embed_ui = "";
var embed_url = "";
var embed_icon = "";
var embed_html = "";

// Remove anchor from URL
var current_page_url = window.location.href.split("#")[0];

jQuery.fn.quoteContext2 = function() {
    "use strict";
    // Add "before" and "after" sections to quote excerpts
    // Designed to work for "blockquote" and "q" tags

    // Setup hidden div to store all quote metadata
    jQuery(this).each(function() {
        // Loop through all the submitted tags (blockquote or q tags) to
        // see if any have a "cite" attribute
        let blockcite = jQuery(this);

        // Skip if already processed to prevent duplicate icons
        if (blockcite.data('citeit-processed')) {
            return;
        }

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
                // Mark as processed before making the request to prevent duplicates
                blockcite.data('citeit-processed', true);

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

        let cited_context_before_full =  'BEGIN CONTEXT: ';  // lookup full context before
        let cited_context_after_full = '';  // lookup full context after


        let is_video = '';
        let media_type = 'text';

        // Detect YouTube via urlParser (handles youtube.com, youtu.be, m.youtube.com, etc.)
        const _url_parsed_check = urlParser.parse(cited_url);
        const _youtube_patterns = [
            /^https?:\/\/(www\.|m\.)?youtube\.com\//,
            /^https?:\/\/youtu\.be\//
        ];
        if (_url_parsed_check && _url_parsed_check.provider === 'youtube') {
            media_type = 'video';
        } else if (_youtube_patterns.some(function(p) { return p.test(cited_url); })) {
            media_type = 'video';
        } else if (cited_url && cited_url.toLowerCase().split('?')[0].endsWith('.pdf')) {
            media_type = 'pdf';
        } else {
            is_video = "not_video";
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

            if (embed_ui.start_time) {0
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
                heading = "<b>Text Citation</b>: <img src='https://www.citeit.net/assets/images/text-icon-small.png' class='text-icon' width='50' height='50' alt='Text icon' /> (no video)";
            }
            
            const js_popup = `javascript:closePopup('${json.sha256}');`;
            console.log("Quote: ________________________________________");

            const display_domain = cited_url
            .replace("mirror.citeit.net/", "")
            .replace(/^(?:https?:\/\/)?(?:www\.)?/i, "") // Remove protocol and www.
            .split('/')[0];

            // Add content to a hidden div, so that the popup can later grab it
            const popup_container = jQuery(`#${hidden_container}`).append(
                `<div id='${q_id}' class='highslide-maincontent'>${heading}
                <div class='subscribe'>Buy/Subscribe</div>

                ${media_type === 'video' ? `<div class='video-container${is_video}'><div id='${player_json}'></div></div>` : ''}
                ${media_type === 'videox' ? `<div class='button' onClick='pauseVideo(${embed_ui.json.sha256})'>Pause Video</div>` : ''}
                ${media_type === 'videox' ? `<div class='button' onClick='stopVideo()'>Stop Video</div><br />` : ''}
                ${title}
                ${description}
                ${start_playing_at}
                ${transcript_found}
                ${context_found}
                <div class='context'> 
                ${context_not_found}
                <!-- Before (Full) -->
                <span id="before_full_${embed_ui.json.sha256})'>">${cited_context_before_full.replace('â','').replace(' ','').replace('â','')}</span> .. 
                <span class='quote_context'>${(json.cited_context_before.slice(-get_device_size('context_length')))} </span>
                <!-- Quote -->
                <span class='q-tag-highlight quote_text'><strong>${json.citing_quote}</strong></span>
                ${context_not_found}
                <span class='quote_context'>${json.cited_context_after.substring(0, get_device_size('context_length'))} ..
                <span id="after_full_${embed_ui.json.sha256})'>">${cited_context_after_full}</span>
                </span></p></div>

            <div class="actions-bar">
                <!--Like-->
                <!--svg viewBox="0 0 20 20" width="18" height="18" class="heart-LkT9Ql"><path d="M5.00002 2.54822C8.00003 2.09722 9.58337 4.93428 10 5.87387C10.4167 4.93428 12 2.09722 15 2.54822C18 2.99923 18.75 5.66154 18.75 7.05826C18.75 9.28572 18.1249 10.9821 16.2499 13.244C14.3749 15.506 10 18.3333 10 18.3333C10 18.3333 5.62498 15.506 3.74999 13.244C1.875 10.9821 1.25 9.28572 1.25 7.05826C1.25 5.66154 2 2.99923 5.00002 2.54822Z"></path></svg--> 
                    Like | 
                <!--svg role="img" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke-width="1.5" stroke="var(--color-fg-primary)" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" style="height: 18px; width: 18px;"><g><title></title><path d="M18.7502 11V7.50097C18.7502 4.73917 16.5131 2.50033 13.7513 2.50042L6.25021 2.50044C3.48848 2.5004 1.25017 4.73875 1.2502 7.50048L1.25021 10.9971C1.2502 13.749 3.47395 15.9836 6.22586 15.9971L6.82888 16V19.0182L12.1067 16H13.7502C16.5116 16 18.7502 13.7614 18.7502 11Z"></path></g></svg-->
                    Comment:14 | 
                <!--svg role="img" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke-width="1.5" stroke="var(--color-fg-primary)" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" class="restackIcon-XKvm2P" style="height: 18px; width: 18px;"><g><title></title><path d="M2.53001 7.81595C3.49179 4.73911 6.43281 2.5 9.91173 2.5C13.1684 2.5 15.9537 4.46214 17.0852 7.23684L17.6179 8.67647M17.6179 8.67647L18.5002 4.26471M17.6179 8.67647L13.6473 6.91176M17.4995 12.1841C16.5378 15.2609 13.5967 17.5 10.1178 17.5C6.86118 17.5 4.07589 15.5379 2.94432 12.7632L2.41165 11.3235M2.41165 11.3235L1.5293 15.7353M2.41165 11.3235L6.38224 13.0882"></path></g></svg-->
                    Save for Later |
                <!--svg role="img" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke-width="1.5" stroke="var(--color-fg-primary)" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" style="height: 18px; width: 18px;"><g><title></title><path d="M10.2171 2.2793L10.2171 12.9745M10.2171 2.2793L13.333 4.99984M10.2171 2.2793L7.08301 4.99984M2.49967 10.9925L2.49967 14.1592C2.49967 16.011 4.00084 17.5121 5.85261 17.5121L14.9801 17.5121C16.8318 17.5121 18.333 16.011 18.333 14.1592L18.333 10.9925"></path></g></svg-->
                    Share | 
                    Buy/Subscribe 

            </div>
            
            <p><a class='close' href=${js_popup}>Close</a> <div class='source_url'><a target='_blank' class='source_label' href='${json.cited_url}'><b>Original Source:</b> <a target='_blank' class='source_domain' href='${json.cited_url}'>${display_domain}</a> &nbsp; (<a href='#'>Archive</a>)</p></div>`
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

            // Get the link we just created within this specific blockcite element
            const linkElement = blockcite.find('a.q-tag');

            if (media_type === 'video') {
                const youtube_icon = `<img class='youtube-icon' src='/assets/wordpress/plugins/CiteIt.net/img/youtube_logo_mini.png' width='40' height='27' alt='video context' title='View Context: Video @ ${seconds_to_minutes(embed_ui.start_time)}' />`;
                linkElement.append(youtube_icon);
            } else if (media_type === 'pdf') {
                const pdf_icon = `<img src='https://www.citeit.net/assets/images/text-icon-small.png' class='text-icon' width='50' height='50' alt='PDF context' title='View Context: PDF' />`;
                linkElement.append(pdf_icon);
            } else if (media_type === 'text') {
                const text_icon = `<img src='https://www.citeit.net/assets/images/text-icon-small.png' class='text-icon' width='50' height='50' alt='text context' title='View Context: Text (no video)' />`;
                linkElement.append(text_icon);
            }

            // Prevent Video from Scrolling out of Sight
            // popup_container.scrollTop();
        }

        // Expanding Blockquote: Show Context
        else if (tag_type === "blockquote") {

            // lookup html for video ui and icon
            embed_ui = embedUi(cited_url, json);

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
                const youtube_icon = `<a href='#context_up_${json.sha256}' onclick='toggleBlockquote("quote_arrow_up", "quote_before_${json.sha256}");'><img class='youtube-icon' src='/assets/wordpress/plugins/CiteIt.net/img/youtube_logo_mini.png' width='40' height='27' /></a>`;
                const view_label = `<a href='#context_up_${json.sha256}' onclick='toggleBlockquote("quote_arrow_up", "quote_before_${json.sha256}");'> View Context: Video @ ${seconds_to_minutes(embed_ui.start_time)}</a>`;
                const youtube_label = `${youtube_icon} <span class='highlight'>&larr;${view_label} </span><br />`;

                blockcite.append(youtube_label);

            } else if (media_type === 'pdf') {
                const pdf_icon = `<a href='#context_up_${json.sha256}' onclick='toggleBlockquote("quote_arrow_up", "quote_before_${json.sha256}");'><img src='https://www.citeit.net/assets/images/text-icon-small.png' class='text-icon' width='50' height='50' alt='PDF icon' /></a>`;
                const view_label = `<a href='#context_up_${json.sha256}' onclick='toggleBlockquote("quote_arrow_up", "quote_before_${json.sha256}");'> Expand to View Context: 500 characters before & after</a>`;
                const pdf_label = `${pdf_icon} <span class='highlight'>&larr;${view_label} </span><br />`;

                blockcite.append(pdf_label);

            } else if (media_type === 'text') {
                const text_icon = `<a href='#context_up_${json.sha256}' onclick='toggleBlockquote("quote_arrow_up", "quote_before_${json.sha256}");'><img src='https://www.citeit.net/assets/images/text-icon-small.png' class='text-icon' height='40' alt='Text icon' /></a>`;
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
                    expand_label = `<br /><a id='quote_arrow_up_${json.sha256}' href="javascript:toggleBlockquote('quote_arrow_up', 'quote_before_${json.sha256}');"><br />Expand to View Context</a>`;
                }

                context_before.before(`<div class='quote_arrows' id='context_up_${json.sha256}'> 
                <a id='quote_arrow_up_${json.sha256}' href="javascript:toggleBlockquote('quote_arrow_up', 'quote_before_${json.sha256}');">&#9650;</a>${expand_label}${trimDefault(embed_ui.icon)}
                </div><br />`
                );
            }
            if (json.cited_context_after.length > 0) {
                context_after.after(`<div class='quote_arrows' id='context_down_${json.sha256}'>  
                <a id='quote_arrow_down_${json.sha256}' href="javascript:toggleBlockquote('quote_arrow_down', 'quote_after_${json.sha256}');">&#9660;</a></div><br />`);
            }

        } // elseif (tag_type === 'blockquote')

    } // end: addQuoteToDom(tag_type, json, cited_url) {

}

//************* Pause Video ****************

function pauseVideo(sha256) {

    var hidden_popup_id = 'player_' + sha256;
    var player_popup_id = 'iframe#player_' + sha256;

    console.log("Pausing .. " + hidden_popup_id);


    var div = document.getElementById(hidden_popup_id);
    const firstIframe = jQuery(div).find('iframe').first();

    try {
        jQuery(firstIframe)[0].contentWindow.postMessage(
            '{"event":"command","func":"' + 'pauseVideo' + '","args":""}', '*'
        );
    }
    catch (TypeError) {
        console.log("No iFrame found to pause.");
    }    
    
    console.log("Paused .. ");
}

//*********** Close Popup ************
function closePopup(sha256) {

    var hidden_popup_id = 'hidden_' + sha256;
    console.log("Closing Popup ..");

    pauseVideo(sha256);
    console.log("Video paused .. ");

    // assumes jQuery library
    jQuery('#' + hidden_popup_id).fadeTo('slow', function () {
        jQuery('#' + hidden_popup_id).dialog("close");
    });
    console.log("Dialog fade to close ..");

    /* Remove highlight: active */
    setTimeout(function() {
        jQuery('a#link_' + sha256).removeClass('active', 1000);
    }, 1500);

    /* Hide tooltip */
    jQuery('a#link_' + sha256).tooltip({
        disabled: true
    });

    jQuery('#' + hidden_popup_id).dialog("close");

    console.log("Dialog closed.");

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

//************* FILTER BAD CHACTERS ************** */
function filterBadCharacters(str) {
    "use strict";
    // Remove characters that are found in archived files.
        str = str.replace(/[\u0000-\u00E2\u0041\u001F\u007F\u0080-\uFFFF]/g, '');
        str = str.replace(/[\u0000-\u001F\u007F\u0080-\uFFFF]/g, '');
        str = str.replace(' ','');
        return str;
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
        embed_ui.html = `<div class="video-placeholder" data-embed-url="${embed_url}" data-sha256="${json.sha256}">
                            <img src="https://img.youtube.com/vi/${url_parsed.id}/hqdefault.jpg" alt="Video Thumbnail" />
                            <!--button class="play-button">Play</button-->
                         </div>`;
    }

    embed_ui.url = url;
    if (!embed_ui.html) {
        embed_ui.html = '';
    }
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
    console.log("expandPopup called:", hidden_popup_id);
    try {
        // Check if jQuery UI dialog is available
        console.log("jQuery.fn.dialog check:", typeof jQuery.fn.dialog);
        if (typeof jQuery.fn.dialog === 'undefined') {
            console.log("jQuery UI not available, loading dynamically...");
            jQuery.getScript('https://code.jquery.com/ui/1.12.1/jquery-ui.min.js')
                .done(function() {
                    console.log("jQuery UI loaded successfully, retrying popup...");
                    console.log("jQuery.fn.dialog after load:", typeof jQuery.fn.dialog);
                    showPopupDialog(tag, hidden_popup_id, popup_width);
                })
                .fail(function(jqxhr, settings, exception) {
                    console.error("Failed to load jQuery UI:", exception);
                });
            return false;
        }

        console.log("jQuery UI already available, calling showPopupDialog");
        return showPopupDialog(tag, hidden_popup_id, popup_width);
    } catch (err) {
        console.error("Error in expandPopup:", err);
    }
    return false; // Don't follow link - always prevent navigation
}

// Internal function to show the popup dialog
function showPopupDialog(tag, hidden_popup_id, popup_width=340) {
    console.log("showPopupDialog called with:", hidden_popup_id);
    console.log("jQuery.fn.dialog available:", typeof jQuery.fn.dialog !== 'undefined');

    try {
        // Check if the popup element exists (it's only created when API returns data)
        const popupElement = jQuery("#" + hidden_popup_id);
        console.log("Looking for element:", hidden_popup_id, "Found:", popupElement.length);

        if (popupElement.length === 0) {
            console.log("Popup element not found: " + hidden_popup_id);
            return false; // Prevent link navigation
        }

        // Get cited URL and check if it's a video
        let cited_url = jQuery(tag).attr('href');
        console.log("cited_url:", cited_url);

        // Highlight existing quote
        let sha256 = hidden_popup_id.replace('hidden_', '');
        jQuery('a#link_' + sha256).addClass('active');

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
        tooltip: false,
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

            // Only embed video if player element exists (video citations only)
            if ($player.length) {
                embed_videoxx($player, cited_url);
            }

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
    }).dialog("option", "show", {
        effect: "scale",
        duration: 400
    }).dialog( "option", "maxHeight", 250
    ).dialog({
        "title": "Quote Context by CiteIt.net"
    }).dialog("open").blur();

    console.log("Dialog opened successfully for:", hidden_popup_id);

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

    } catch (err) {
        console.error("Error in expandPopup:", err);
    }
    return false; // Don't follow link - always prevent navigation
}

function getYoutubeEmbedUrl(cited_url) {
    "use strict";
    
    try {
        // Parse URL using existing urlParser
        const url_parsed = urlParser.parse(cited_url);
        
        if (url_parsed && url_parsed.id) {
            var start = 0;
            if (url_parsed.params && url_parsed.params.start) {
                start = url_parsed.params.start;
            }
            return `https://www.youtube.com/embed/${url_parsed.id}?enablejsapi=1&start=${start}&origin=${window.location.origin}`;
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

// Video provider configurations
var VIDEO_PROVIDERS = {
    youtube: {
        patterns: [
            /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i
        ],
        createEmbed: (id, timeParams) => {
            const params = new URLSearchParams({
                enablejsapi: 1,
                origin: window.location.origin,
                rel: 0,
                showinfo: 0,
                modestbranding: 1,
                fs: 0,
                playsinline: 1
            });
    if (timeParams?.youtubeTime) {
        params.set('start', timeParams.youtubeTime);
    };
    },
    vimeo: {
        patterns: [
            /vimeo\.com\/(?:video\/)?(\d+)/i
        ],
        createEmbed: (id, timeParams) => {
            const params = new URLSearchParams({
                api: 1,
                background: 0,
                title: 0,
                byline: 0
            });
            const timeHash = timeParams?.vimeoTime ? `#t=${timeParams.vimeoTime}` : '';
            return `https://player.vimeo.com/video/${id}?${params.toString()}${timeHash}`;
        }
    },
    soundcloud: {
        patterns: [
            /soundcloud\.com\/([\w-]+\/[\w-]+)/i
        ],
        createEmbed: (url) => {
            const params = new URLSearchParams({
                url: `https://soundcloud.com/${url}`,
                color: '%23ff5500',
                auto_play: false,
                hide_related: true,
                show_comments: false
            });
            return `https://w.soundcloud.com/player/?${params.toString()}`;
        }
    },
    instagram: {
        patterns: [
            /instagram\.com\/(?:p|reel|tv)\/([a-zA-Z0-9_-]+)/i
        ],
        createEmbed: (id) => {
            return `https://www.instagram.com/p/${id}/embed/`;
        }
    },
    tiktok: {
        patterns: [
            /tiktok\.com\/@[\w.-]+\/video\/(\d+)/i,
            /vm\.tiktok\.com\/([a-zA-Z0-9]+)/i
        ],
        createEmbed: (id) => {
            return `https://www.tiktok.com/embed/v2/${id}`;
        }
    },
    twitter: {
        patterns: [
            /twitter\.com\/\w+\/status\/(\d+)/i,
            /x\.com\/\w+\/status\/(\d+)/i
        ],
        createEmbed: (id) => {
            const params = new URLSearchParams({
                id,
                hideThread: true,
                theme: 'light'
            });
            return `https://platform.twitter.com/embed/Tweet.html?${params.toString()}`;
        }
    }
}};

/**
 * Parse video URL to determine provider and ID
 */
function parseVideoUrl(url) {
    for (const [provider, config] of Object.entries(VIDEO_PROVIDERS)) {
        for (const pattern of config.patterns) {
            const match = url.match(pattern);
            if (match && match[1]) {
                return { provider, id: match[1] };
            }
        }
    }
    return null;
}

/**
 * Create embed iframe for video
 */
function createVideoEmbed(videoInfo, cited_url) {
    const provider = VIDEO_PROVIDERS[videoInfo.provider];
    if (!provider) return null;

    const timeParams = extractTimeParams(cited_url);
    const embedUrl = provider.createEmbed(videoInfo.id, timeParams);
    const playerId = `${videoInfo.provider}-player-${videoInfo.id}`;

    return `
        <iframe 
            id="${playerId}"
            src="${embedUrl}"
            width="100%"
            height="185"
            frameborder="0"
            allowfullscreen="false"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope">
        </iframe>
    `;
}

/**
 * Update embed_video function to use new provider system
 */
function embed_video($player, cited_url) {
    if (!$player || !cited_url) {
        console.error("Missing required parameters");
        return null;
    }

    try {
        const videoInfo = parseVideoUrl(cited_url);
        if (!videoInfo) {
            console.error("Could not parse video URL:", cited_url);
            return null;
        }

        const iframeHtml = createVideoEmbed(videoInfo, cited_url);
        if (!iframeHtml) {
            console.error("Could not create embed HTML");
            return null;
        }

        $player.html(iframeHtml);
        $player.addClass('initialized');

        return true;

    } catch (err) {
        console.error("Error embedding video:", err);
        return null;
    }
}