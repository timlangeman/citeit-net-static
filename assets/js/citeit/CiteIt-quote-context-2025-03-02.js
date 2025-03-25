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
 * Demo: http://www.CiteIt.net
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

jQuery.fn.quoteContext = function() {
    // Add "before" and "after" sections to quote excerpts
    // Designed to work for "blockquote" and "q" tags

    //Setup hidden div to store all quote metadata
    jQuery(this).each(function() {
        // Loop through all the submitted tags (blockquote or q tags) to
        // see if any have a "cite" attribute
        if (jQuery(this).attr("cite")) {
            var blockcite = jQuery(this);
            var cited_url = blockcite.attr("cite");
            var citing_quote = blockcite.text();

		    // If Permalink isn't supplied, default to current page
            var citing_url = blockcite.attr("data-citeit-citing-url");
		    if (!isValidUrl(citing_url)){
			  citing_url = current_page_url;
			}

            // Remove Querystring if WordPress Preview
            if (isWordpressPreview(citing_url)) {
                citing_url = citing_url.substring(0, citing_url.indexOf("?")); // get citing_url before '?'
            }

            // If they have a cite tag, check to see if its hash is already saved
            if (cited_url.length > 3) {
                var tag_type = jQuery(this)[0].tagName.toLowerCase();
                var hash_key = quoteHashKey(citing_quote, citing_url, cited_url);

                // Javascript uses utf-16.  Convert to utf-8
                hash_key = encode_utf8(hash_key);
                console.log(hash_key);
                var hash_value = forge_sha256(hash_key);
                console.log(hash_value);

                var shard = hash_value.substring(0, 2);
                var read_base = "https://read.citeit.net/quote/";
                var read_url = read_base.concat("sha256/", webservice_version_num, "/",
                    shard, "/", hash_value, ".json");
                var json = null;

                //See if a json summary of this quote was already created
                // and uploaded to the content delivery network: read.citeit.net
                jQuery.ajax({
                    type: "GET",
                    url: read_url,
                    dataType: "json",
                    success: function(json) {
                        addQuoteToDom(tag_type, json, cited_url);

                        console.log("CiteIt Found: " + read_url);
                        console.log("       Quote: " + citing_quote);
                    },
                    error: function() {
                        console.log("CiteIt Missed: " + read_url);
                        console.log("       Quote: " + citing_quote);
                    }
                });

                // Add Hidden div with context to DOM
                function addQuoteToDom(tag_type, json, cited_url) {
                    console.log("_________________ BEGIN: AddQuoteToDom: " + cited_url + "___________________");

                    // media_type: text or vido ?
                    var media_type = 'text';
                    url = cited_url;

                    var url_parsed = urlParser.parse(cited_url);
                    if (typeof(url_parsed) !== "undefined") {
                        if (url_parsed.hasOwnProperty("provider")) {
                            url_provider = url_parsed.provider;
                        }
                    }
                    else {
                        url_provider = '';
                        media_type = 'text';
                        url_parsed = '';
                        media_type = 'text';
                    }
                    
                    if (url_provider == "youtube") {
                        media_type = 'video';
                    }
                    console.log('cited_url: ' + cited_url +  ' url_parsed: ' + url_parsed +  ' url_provider: ' + url_provider );
                    
                    console.log("_________________ END: AddQuoteToDom___________________");

                    // Set a different popup width for Phones vs Desktop
                    if (window.screen.availWidth <= 320){
                        popup_width = 300;
                    }
                    else if (window.screen.availWidth <= 480) {
                        popup_width = 340;
                    }
                    else if (window.screen.availWidth <= 640) {
                        popup_width = 640;
                    }
                    else if (window.screen.availWidth <= 768) {
                        popup_width = 755;
                    }
                    else if (window.screen.availWidth <= 1024) {
                        popup_width = 375;
                    }
                    else if (window.screen.availWidth <= 1280) {
                        popup_width = 375;
                    }
                    else {
                        popup_width = 375;
                    }

                    // lookup html for video ui and icon
                    var embed_ui = embedUi(cited_url, json, tag_type);
                    var play_buttons = '';


                    var start_playing_at = '';
                    if (embed_ui.start_time) {
                        start_playing_at = play_buttons + "<div class='start_video'><!--a href='#play' onClick=" + play_video_onclick + "-->" +
                           "Video starts at <i>" + seconds_to_minutes(embed_ui.start_time) + "</i><!--/a--></div>";
                    }

                    if (tag_type === "q") {
                        var q_id = "hidden_" + json.sha256;
                        var url_cited_domain = json.cited_url.replace('http://','').replace('https://','').replace('www.','').split(/[/?#]/)[0];

                        //Add content to a hidden div, so that the popup can later grab it
                        jQuery("#" + hidden_container).append(
                            "<div id='" + q_id + "' class='highslide-maincontent width_" + popup_width + "'>" + 
                            embed_ui.html + " " + 
                            start_playing_at + 
                            "<div class='transcript_contents'>" + 
                            json.cited_context_before + " " + " <span class='q-tag-highlight'><strong>" +
                            json.citing_quote + "</strong></span> " +
                            json.cited_context_after + ".. </p>" +
                            "</div>" + 
                            "<div class='popup-footer'>" +
                            "<p><a href='" + json.cited_url +
                            "' target='_blank'>Read more</a> | " +
                            "<a href='javascript:closePopup(`" +
                            json.sha256 + "`);'>Close</a> <div class='source_url'>source: <a href='" + json.cited_url + "'>" + url_cited_domain + "</a> </p></div></div>"
                        );


                        /* ----------- Style link using tooltip & icon ----------*/
                        if (media_type == 'video'){
                            tooltip = "title='View Video @ " + seconds_to_minutes(embed_ui.start_time) + "'";
                         }
                         else if (media_type == 'text' ) {
                            tooltip = "title='View Quote Context: 500 characters before and after.'";
                         }
 
                         //Style quote as a link that calls the popup expander:
                         blockcite.wrapInner("<a id='link_" + json.sha256 + "' class='q-tag' href='" + blockcite.attr("cite") + "' " + tooltip +
                             " onclick='return expandPopup(this ,\"" + q_id + "\")' " +
                             " />");

                        console.log("---- MEDIA TYPE: ------");
                        console.log(media_type)     
 
                        if (media_type == 'video'){
 
                           youtube_icon = " <a title='View Context: Video @ " + seconds_to_minutes(embed_ui.start_time) + "'><img class='youtube-icon' " +
                                "onclick='return expandPopup(this ,\"" + q_id + "\")' " +
                                "src='https://pages.citeit.net/wp-content/plugins/CiteIt.net/img/youtube_logo_mini.png' width='40' height='27' " +
                                " /></a>";
 
                           jQuery("a#link_" + json.sha256).append(youtube_icon);
                        }

                        if (media_type == 'text'){
   
                            text_icon = " <a title='View Context: Text (no video)' " + 
                                " onclick='return expandPopup(this ,\"" + q_id + "\")' >" +
                                "<img src='https://www.citeit.net/assets/images/text-icon-small.png' " + 
                                "class='text-icon' width='27' height='27' alt='text context' title='View Context: Text (no video)' />"
 
                           jQuery("a#link_" + json.sha256).append(text_icon);
                         }


                        //Style quote as a link that calls the popup expander:
                        /*
                        blockcite.wrapInner("<a class='popup_quote' href='" + blockcite.attr("cite") + "' class='q-tag' " +
                            "onclick='return expandPopup(this ,\"" + q_id + "\", " + popup_width + ")' " +
                            " />");
                           
                        */    
                    } else if (tag_type === "blockquote") {

                        //Fill 'before' and 'after' divs and then quickly hide them
                        blockcite.before("<div id='quote_before_" + json.sha256 + "' class='quote_context'>"
                          + "<blockquote class='quote_context'>"
                              + "<span class='context_header'>Context Before:</span>"
                              + "<div class='tooltip'><span class='tooltip_icon'>?</span><span class='tooltiptext'>CiteIt.net displays the 500 characters of Context immediately before and after the quote</span></div><br />" 
                              + embed_ui.html + " .. " + json.cited_context_before  
                          + "</blockquote></div>"
					   );

                        blockcite.after("<div id='quote_after_" + json.sha256 + "' class='quote_context'>"
                           + "<blockquote class='quote_context'>"
                              + ".. " + json.cited_context_after + " .."
                              + "<br /><span class='context_header'>Context After:</span>" 
	                          + "<div class='tooltip'><span class='tooltip_icon'>?</span><span class='tooltiptext'>CiteIt.net displays the 500 characters immediately before and after the quote</span></div>" 
                          + "</blockquote></div>" 
                        );

                        var context_before = jQuery("#quote_before_" + json.sha256);
                        var context_after = jQuery("#quote_after_" + json.sha256);

					   /* Main Class */
					   blockcite.addClass('quote_text');

                        context_before.hide();
                        context_after.hide();

                        if (json.cited_context_before.length > 0) {
                            context_before.before("<div class='quote_arrows up-arrow' id='context_up_" + json.sha256 + "'> \
                            <a id='quote_arrow_up_" + json.sha256 + "' \
                                href=\"javascript:toggleQuote('quote_arrow_up', 'quote_before_" + json.sha256 + "');\">&#9650;</a> " + trimDefault(embed_ui.icon) +
                                "</div>"
                            );
                        }
                        if (json.cited_context_after.length > 0) {
                            context_after.after("<div class='quote_arrows down-arrow' id='context_down_" + json.sha256 + "'> \
                            <div class='citeit_source'><span class='source'>source: </span> \
                            <a class='citeit_source_domain' href='" + json.cited_url + "'>" + extractDomain(json.cited_url) + "</a></div> \
                            <a class='down_arrow' id='quote_arrow_down_" + json.sha256 + "' \
                            href=\"javascript:toggleQuote('quote_arrow_down', 'quote_after_" + json.sha256 + "');\">&#9660;</a></div>");
                        }

                    } // elseif (tag_type === 'blockquote')
                } // end: function add_quote_to_dom




                
            } // if url.length is not blank
        } // if "this" has a "cite" attribute
    }); //   jQuery(this).each(function() { : blockquote, or q tag

};

//********************** Get Nth index position ***************************/
// Credit: // https://stackoverflow.com/users/80860/kennebec
// Source: https://stackoverflow.com/questions/14480345/how-to-get-the-nth-occurrence-in-a-string

function nthIndex(str, pat, n) {
    var L = str.length,
        i = -1;
    while (n-- && i++ < L) {
        i = str.indexOf(pat, i);
        if (i < 0) break;
    }
    return i;
}

function trimDefault(str) {
    if (str) {
        return str;
    } else {
        return '';
    }
}

//*********** Toggle Quote ************
function toggleQuote(section, id) {
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

// *********** Expand Popup *************

function expandPopup(tag, hidden_popup_id, popup_width=375) {

    // Configure jQuery Popup Library
    jQuery.curCSS = jQuery.css;
    sha256 = hidden_popup_id.replace('hidden_', '');
    jQuery('a#link_' + sha256).addClass('active');

    var iframe_id = "";

	console.log("sha256 h:");
	console.log(sha256);

    // Setup Initial Dialog box
    jQuery("#" + hidden_popup_id).dialog({
        autoOpen: false,
        closeOnEscape: true,
        closeText: "hide",
        draggableType: true,
        resizable: true,
        width: 380,
        modal: false,
        create: function (event) { jQuery(event.target).parent().css('position', 'fixed');},
        title: "Quote Context by CiteIt.net",
        hide: {
            effect: "size",
            duration: 400
        },
        show: {
            effect: "scale",
            duration: 400
        },
        close : function(){
            closePopup(sha256);
        },

    }).addClass("dialogue_box");

    // Set Popup Window Relative to Tag or Window
    if (window.screen.availWidth < 700) {
        var window_or_tag = window;
    }
    else {
        var window_or_tag = tag;
    }

    // Add centering and other settings
    jQuery("#" + hidden_popup_id).dialog("option",
        "position", {
            at: "center center-200",
            of: window_or_tag,
            collision: "fit"
        }
    ).dialog("option", "hide", {
        effect: "size",
        duration: 400
    }).dialog("option", "show", {
        effect: "scale",
        duration: 400
    }).dialog({
        "title": "Quote Context by CiteIt.net"
    }).dialog("open").blur();

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

function onPlayerError(e) {
    console.log('An error occurred: ' + e.data);
   }
   
   //************* Pause Video ****************
   
   function pauseVideo(sha256) {
   

       var hidden_popup_id = 'hidden_' + sha256;
       var player_popup_id = 'iframe#player_' + sha256;

       console.log("player_popup_id  pause xx:");
       console.log(player_popup_id);    

       var div_id = hidden_popup_id;
       var div = document.getElementById(div_id);
   
       if (jQuery(player_popup_id).is("iframe")) {
           jQuery(player_popup_id)[0].contentWindow.postMessage(
               '{"event":"command","func":"' + 'pauseVideo' + '","args":""}', '*'
           );
       }
   }

function CloseButton(sha256) {
    console.log("1 Close Button");
    console.log(sha256);

    pauseVideo(sha256);    
}

//*********** Close Popup ************
function closePopup(sha256) {
  
    var hidden_popup_id = 'hidden_' + sha256;

    console.log("Close Pause");
    pauseVideo(sha256);

    // assumes jQuery library
    jQuery('#' + hidden_popup_id).fadeTo('slow', function() {  
        //jQuery('#' + hidden_popup_id).dialog("close");
    });

    /* Remove highlight: active */
    setTimeout(function() { 
        jQuery('a#link_' + sha256).removeClass('active',1000);
    }, 1500);

    /* Hide tooltip 	*/
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
    var seconds = 0;
    if (player) {
        seconds += sec;
        player.seekTo(seconds, true);
    }
}









//*********** Trim Regex ************
function trimRegex(str) {
    // Purpose: Backwards-compatible string trim (may not be necessary)
    // Credit: Jhankar Mahbub:  (used for backward compatibility.
    // GitHub Profile: https://github.com/khan4019/jhankarMahbub.com
    // Homepage: http://www.jhankarmahbub.com/
    // Source: http://stackoverflow.com/questions/10032024/how-to-remove-leading-and-trailing-white-spaces-from-a-given-html-string
    return str.replace(/^[ ]+|[ ]+$/g, "");
}

//*********** URL without Protocol ************
function urlWithoutProtocol(url) {
    // Remove http(s):// and trailing slash
    // Before: https://www.example.com/blog/first-post/
    // After:  www.example.com/blog/first-post

    var url_without_trailing_slash = url.replace(/\/$/, "");
    var url_without_protocol = url_without_trailing_slash.replace(/^https?\:\/\//i, "");

    return url_without_protocol;
}

//******** Escape URL *************
function escapeUrl(str) {
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
    // This is a list of Unicode character points that should be filtered out from the quote hash
    // This list should match the webservice settings:
    // * https://github.com/CiteIt/citeit-webservice/blob/master/app/settings-default.py
    //   - TEXT_ESCAPE_CODE_POINTS

    str = str.replaceAll(`"`, ``);  // Fix: double quotes are not caught by the following unicode replace_char code points

    var replace_chars = new Set([
        2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 34, 39, 96, 160, 173, 699, 700, 701, 702, 703, 712, 713, 714, 715, 716, 717, 718, 719, 732, 733, 750, 757, 8211, 8212, 8213, 8216, 8217, 8219, 8220, 8221, 8222, 8223, 8226, 8229, 8203, 8204, 8205, 65279, 8232, 8233, 133 , 5760, 6158, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8239, 8287, 8288, 12288
    ]);

    return normalizeText(str, replace_chars);
}

//******************* Normalize Text **********************
function normalizeText(str, escape_code_points) {
    /* This javascript function performs the same functionality as the
       python method: citeit_quote_context.text_convert.escape()
         - https://github.com/CiteIt/citeit-webservice/blob/master/app/lib/citeit_quote_context/text_convert.py

       It removes an array of symbols from the input str
    */

    var str_return = ''; //default: empty string
    var input_code_point = -1;
    var str_array = stringToArray(str); // convert string to array

    str_return = str_return.replaceAll(`"`, ``);      // fix: missed double quotation mark

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
    
    return str_return;
}

//****************** Quote Hash Key ********************I**
function quoteHashKey(citing_quote, citing_url, cited_url) {
    var quote_hash = escapeQuote(citing_quote) + "|" +
        urlWithoutProtocol(escapeUrl(citing_url)) + "|" +
        urlWithoutProtocol(escapeUrl(cited_url));

    return quote_hash;
}

//****************** Quote Hash **************************
function quoteHash(citing_quote, citing_url, cited_url) {
    var url_quote_text = quoteHashKey(citing_quote, citing_url, cited_url);
    var quote_hash = forge_sha256(url_quote_text); // https://github.com/brillout/forge-sha256
    return quote_hash;
}

//*************** Extract Domain from URL ****************
function extractDomain(url) {
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
    if (data === parseInt(data, 10)) {
        return false;
    } else {
        return true;
    }
}

//******************* Convert Seconds to Minutes ****************
// Credit: https://www.tutorialspoint.com/How-to-convert-JavaScript-seconds-to-minutes-and-seconds
function seconds_to_minutes(seconds) {
    let minutes = Math.floor(seconds / 60);
    let extraSeconds = seconds % 60;
    minutes = minutes < 10 ? "0" + minutes : minutes;
    extraSeconds = extraSeconds< 10 ? "0" + extraSeconds : extraSeconds;
    return  minutes + " min " + extraSeconds + " sec";
}


//****************** Text if Hexadecimal format *************
function isHexadecimal(str) {
    // Credit: https://www.w3resource.com/javascript-exercises/javascript-regexp-exercise-16.php
    regexp = /^[0-9a-fA-F]+$/;

    if (regexp.test(str)) {
        return true;
    } else {
        return false;
    }
}

//****************** String to Array ********************
function stringToArray(s) {
    // Credit: https://medium.com/@giltayar/iterating-over-emoji-characters-the-es6-way-f06e4589516
    // convert string to Array

    const retVal = [];

    for (const ch of s) {
        retVal.push(ch);
    }
    return retVal;
}

// **************** Begin: Calculate Video UI ******************
function embedUi(url, json, tag_type = 'q') {

    var media_providers = ["youtube", "vimeo", "soundcloud"];
    var url_provider = "";
    var embed_icon = "";
    var embed_html = "";
    var mediaType = "text";

    // Convert YouTube Livestream to Regular Watch Syntax
    url = url.replace("live/", "watch?v=");
    console.log("URL: " + url);

    var url_parsed = urlParser.parse(url);
    if (typeof(url_parsed) !== "undefined") {
        if (url_parsed.hasOwnProperty("provider")) {
            url_provider = url_parsed.provider;
        }
    }
    if (url_provider == "youtube") {
        media_type = 'video';
		
        var start_time = '';
        if (typeof(url_parsed) !== "undefined") {
          if (url_parsed.hasOwnProperty('params')){
            if (url_parsed.params.hasOwnProperty('start')){
              start_time = url_parsed.params.start;
            }
		  }
        }			
        // Generate YouTube Embed URL
        var embed_url = urlParser.create({
            videoInfo: {
                provider: url_provider,
                id: url_parsed.id,
                mediaType: "video"
            },
            format: "embed",
            params: {
                start: start_time
            }
        });

        // Create Embed iframe
        embed_icon = "<span class='view_on_youtube'>" +
            "<br /><a href=\"javascript:toggleQuote('quote_arrow_up', 'quote_before_" + json.sha256 + "'); \">Expand: Show Video Clip</a></span>";

		if (tag_type == 'q'){
			width = '350'; // '426';
			height = '197';  //'240';
		}
		else {
			width = '560';
			height = '315';
		}

        embed_html = "<iframe class='youtube' src='" + embed_url +
            "' width='" + width + "' height='" + height + "' " +
            "frameborder='0' allowfullscreen='allowfullscreen' id='youtube-iframe'>" +
            "</iframe>";

        // Add transcript lines with start and duration
        embed_html += "<div id='transcript'>";
        if (json.transcription && Array.isArray(json.transcription)) {
            json.transcription.forEach(line => {
                embed_html += `<div class='transcript-line' data-start='${line.start}' data-duration='${line.dur}'>${line.subtitle}</div>`;
            });
        }
        embed_html += "</div>";

        // Add script to load YouTube IFrame API
        embed_html += `
            <script src="https://www.youtube.com/iframe_api"></script>
            <script>
                function onYouTubeIframeAPIReady() {
                    var iframe = document.getElementById('youtube-iframe');
                    var player = new YT.Player(iframe, {
                        events: {
                            'onStateChange': onPlayerStateChange
                        }
                    });
                }

                function onPlayerStateChange(event) {
                    if (event.data == YT.PlayerState.PLAYING) {
                        setInterval(highlightActiveLine, 100);
                    }
                }

                function highlightActiveLine() {
                    var currentTime = player.getCurrentTime();
                    document.querySelectorAll('.transcript-line').forEach(line => {
                        var start = parseFloat(line.getAttribute('data-start'));
                        var duration = parseFloat(line.getAttribute('data-duration'));
                        if (currentTime >= start && currentTime <= start + duration) {
                            line.classList.add('highlight');
                        } else {
                            line.classList.remove('highlight');
                        }
                    });
                }
            </script>
        `;

    } else if (url_provider == "vimeo") {
        // Create Canonical Embed URL:
        embed_url = "https://player.vimeo.com/video/" + url_parsed.id;
        embed_icon = "<span class='view_on_youtube'>" +
            "<br />Expand: Show Video Clip</span>";
        embed_html = "<iframe class='youtube' src='" + embed_url +
            "' width='640' height='360' " +
            "frameborder='0' allowfullscreen='allowfullscreen'>" +
            "</iframe>";
    } else if (url_provider == "soundcloud") {
        // Webservice Query: Get Embed Code
        $.getJSON("http://soundcloud.com/oembed?callback=?", {
                format: "js",
                url: cited_url,
                iframe: true
            },
            function(data) {
                var embed_html = data.html;
            });

        embed_icon = "<span class='view_on_youtube'>" +
            "<br ><a href=\" \">Expand: Show SoundCloud Clip</a></span>";
    }

    var embed_ui = {};
    embed_ui.url = url;
    embed_ui.json = json;
    embed_ui.icon = embed_icon;
    embed_ui.html = embed_html;
    embed_ui.start_time = start_time;

    return embed_ui;
}

// ******************** Is Wordpress Preview ***********************
function isWordpressPreview(citing_url) {
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
    return unescape(encodeURIComponent(s));
}

function decode_utf8(s) {
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

function load_popup_iframes() {

}

function play_video_onclick() {

}