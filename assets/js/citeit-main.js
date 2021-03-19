function swap_citation_type(tag_id, tag_type){
    // Convert from <blockquote> to <q> tag and vice versa
    replace_tag(tag_id, tag_type);
    jQuery('#' + tag_id).quoteContext();
}

function replace_tag(tag_id, tag_type){
  /*
    Conversion depends upon dealing with differences between <blockquote> and <q> tags:
      *  <q> tag has text wrapped with an anchor
      *  get cite url and text to populate new tag
  */

  var div_id = 'sample-quote-container';
  var text = '';

  var url = jQuery('#' + tag_id).val('#' + tag_id).attr("cite");
  
  if (tag_type === 'blockquote') {
    // Get text from existing q tag, which has an anchor tag
    text = jQuery('#' + tag_id + ' > a').text();
  }
  else {
    text = jQuery('#' + tag_id).text();
  }
  
  // Build blockquote/q  element:
  var new_div = document.createElement(tag_type);
  new_div.setAttribute('id', tag_id);
  new_div.setAttribute('cite', url);
  new_div.textContent = text;

  // Build Replacement div:
  var replacement_div = document.createElement('div');
  replacement_div.setAttribute('id', div_id);
  replacement_div.appendChild(new_div);

  jQuery('div#' + div_id).replaceWith(function(){
    return replacement_div; 
  });

}

function append_element(id, element_message, sleep_ms){
  setTimeout(function(){
    var message = document.createElement('div');
    message.innerHTML = element_message;
    document.getElementById(id).appendChild(message);

  }, sleep_ms);
}

function reset_example_citation() {
    console.log("Resetting form ..");
    jQuery('#submission-progress').hide();
    jQuery('#submission-results').hide();
    jQuery("#cited_url").val('');
    jQuery("#citing_quote").val('');
    jQuery("#citing_quote").focus();
    console.log("Form is now reset.");
}

var message_cnt = 0;   
var webrequest_complete = false;
var process_complete = false;

function process_test_citation() {
    /*
        Display UI feedback that processsing is occurring
        Submit request to Webservice API
        Periodically loop through status display process every 1.5 seconds
        When webservice request is returned, update user interface
        If webservice does not submit results in time, display timeout
    */
    
    // Status messages
    var submission_steps = [
        "<b>Contacting CiteIt webservice ..</b>",
        "Looking up source from URL ..",
        "Locating quotation ..", 
        "Copying 500 characters before and after quotation.",
        "Saving context data in JSON format.",
        "Loading JSON data into current page using javascript."
    ];

  // Submit Quote the first time: Lookup JSON Context */
  if ((message_cnt == 0) || ( message_cnt == null))  {

    // Print status messages every 1.5 secons
    sleep_ms = 1500;   // 1500 ms = 1.5 secons
    max_cycles = 10;   // Timeout after n loops

    var post_url = "http://api.citeit.net/post_quote";    
    var citing_url =  'https://www.citeit.net/';
    var citing_quote = jQuery("#citing_quote").val();
    var cited_url = jQuery("#cited_url").val() ;

    // Local Development Server: Set/get form variables
    if (window.location.href == "http://localhost:8080/" ) {
        post_url = "http://localhost/post_quote";    
        citing_url =  'http://localhost:8080/';
        citing_quote = jQuery("#citing_quote").val();  
        cited_url = jQuery("#cited_url").val() ;
    }
    // Production Server: Set/get form variables

    // Display "Loading circle"
    jQuery('#loading').addClass('visible');
    jQuery('#circle6').removeClass('hidden');
    jQuery('#circle6').addClass('visible');

    var tag_type = 'q';  // default to contextual popup

    // Compute Hash Key
    var hash_key = quoteHashKeyDemo(citing_quote, citing_url, cited_url);

    // Javascript uses utf-16.  Convert to utf-8
    hash_key = encode_utf8(hash_key);
    console.log(hash_key);
    var hash_value = forge_sha256(hash_key);
    console.log(hash_value);

    console.log("Submitting JSON ..");
    console.log("Clearing out status progress list");

    // Clear out all previous status messages
    jQuery('ul#progress_list li').remove();

    // API Request: lookup quote
    jQuery.ajax({
        type: "GET",
        url: post_url,
        data: {
            citing_url: citing_url,
            citing_quote: citing_quote,
            cited_url: cited_url
        },
        dataType: "json",
        success: function(json) {
            addQuoteToDomDemo(tag_type, json, cited_url);
            webrequest_complete = true;

            console.log("CiteIt Found:  " + post_url);
            console.log("       Before: " + json.cited_context_before);
            console.log("       Quote:  " + citing_quote);
            console.log("       After:  " + json.cited_context_after);
        },
        error: function() {
            console.log("JSON NOT FOUND");
            webrequest_complete = true;

            console.log("CiteIt Missed: " + post_url);
            console.log("       Quote: " + citing_quote);
        }
    });  

 }

  // Print first message immediately: don't wait:
  if (message_cnt == 0) {
    var message = submission_steps[message_cnt];

    // Display Status message
    jQuery('ul#progress_list').append('<li>' + message + '</li>');  
    message_cnt++;
  }

  // Pause for 1.5 seconds before printing other messages
  setTimeout(function() {   

    // Display all Status messages sequentially
    if (message_cnt < submission_steps.length) {
        message = submission_steps[message_cnt];
    }
    // If the webservice returns results
    else if (webrequest_complete) {
        jQuery('#submission-results').removeClass('hidden');
        jQuery('#submission-results').addClass('visible');
        jQuery('#circle6').addClass('hidden'); 
        
        message = "<li><b>Submission Complete..</b> &nbsp;&nbsp;</li>";
        message_cnt = 0; // reset counter so proocess can be run again
        process_complete = true;
    }

    // Stop Process even if web service doesn't returns results after max_cycles timeout
    else if (message_cnt >= max_cycles){
        jQuery('#submission-results').removeClass('hidden');
        jQuery('#submission-results').addClass('visible');
        jQuery('#circle6').addClass('hidden'); 
        
        message = "<li><b>Submission Timed out.</b> &nbsp;&nbsp;</li>";
        message_cnt = 0; // reset counter so proocess can be run again
        process_complete = true;
    }

    console.log(message_cnt + " " + message);

    // Display progress status message to UI
    if (message !== undefined) {
        jQuery('ul#progress_list li:last').append('<li>' + message + '</li>');  
    }

    message_cnt++;

    // Re-run Process every 1.5 seconds, either until
    // Webservice returns JSON result or until it reaches the max number of cycles
    if (!process_complete){
        process_test_citation();
    }
  
  }, sleep_ms);

}

// **************** Begin: Calculate Video UI ******************
function embedUiDemo(url, json, tag_type = 'blockquote') {

    var url_provider = "";
    var embed_icon = "";
    var embed_html = "";
    var embed_url = "";
    var width = 0;
    var height = 0;

    // Lookup whether URL belongs to YouTube, Vimeo, SoundCloud, etc
    var url_parsed = urlParser.parse(url);
    if (typeof(url_parsed) !== "undefined") {
        if (url_parsed.hasOwnProperty("provider")) {
            url_provider = url_parsed.provider;
        }
    }
    if (url_provider == "youtube") {
		
        var start_time = '';
        if (typeof(url_parsed) !== "undefined") {
          if (url_parsed.hasOwnProperty('params')){
            if (url_parsed.params.hasOwnProperty('start')){
              start_time = url_parsed.params.start;
            }
		  }
        }			
        // Generate YouTube Embed URL
        embed_url = urlParser.create({
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
			width = '426';
			height = '240';
		}
		else {
			width = '560';
			height = '315';
		}

        embed_html = "<iframe class='youtube' src='" + embed_url +
            "' width='" + width + "' height='" + height + "' " +
            "frameborder='0' allowfullscreen='allowfullscreen'>" +
            "</iframe>";

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
       jQuery.getJSON("http://soundcloud.com/oembed?callback=?", {
                format: "js",
                url: cited_url,
                iframe: true
            },
            function(data) {
                embed_html = data.html;
            });

        embed_icon = "<span class='view_on_youtube'>" +
            "<br ><a href=\" \">Expand: Show SoundCloud Clip</a></span>";
    }

    var embed_ui = {};
    embed_ui.url = url;
    embed_ui.json = json;
    embed_ui.icon = embed_icon;
    embed_ui.html = embed_html;

    return embed_ui;
}


// *************** Convert string to UTF-8 *******************

function encode_utf8Demo(s) {
    return unescape(encodeURIComponent(s));
}

function decode_utf8(s) {
    return decodeURIComponent(escape(s));
}

// Add Hidden div with context to DOM
function addQuoteToDomDemo(tag_type, json, cited_url) {

    // lookup html for video ui and icon
    var embed_ui = embedUiDemo(cited_url, json, tag_type);
    var blockcite = jQuery('#sample-quote');
    var hidden_container = '';

    // Reset the quoted text
    blockcite.text(json.citing_quote);

    if (tag_type === "q") {
        var q_id = "hidden_" + json.sha256;
        var url_cited_domain = json.cited_url.replace('http://','').replace('https://','').replace('www.','').split(/[/?#]/)[0];

        //Add content to a hidden div container, so that the popup can later grab it
        jQuery("#" + hidden_container).append(
            "<div id='" + q_id + "' class='highslide-maincontent'>" + 
            embed_ui.html + "<br />.. " + 
            json.cited_context_before + " " + " <span class='q-tag-highlight'><strong>" +
            json.citing_quote + "</strong></span> " +
            json.cited_context_after + ".. </p>" +
            "<p><a href='" + json.cited_url +
            "' target='_blank'>Read more</a> | " +
            "<a href='javascript:closePopup(" +
            q_id + ");'>Close</a> <div class='source_url'>source: <a href='" + json.cited_url + "'>" + url_cited_domain + "</a> </p></div>"
        );

        //Style quote as a link that calls the popup expander:
        blockcite.wrapInner("<a class='popup_quote' href='" + blockcite.attr("cite") + "' " +
            "onclick='expandPopup(this ,\"" + q_id + "\"); return false;' " +
            " />");

    } else if (tag_type === "blockquote") {

        //Fill 'before' and 'after' divs and then quickly hide them
        blockcite.before("<div id='quote_before_" + json.sha256 + "' class='quote_context'>" +
            "<blockquote class='quote_context'>" +
                "<span class='context_header'>Context Before:</span>" + 
                "<div class='tooltip'><span class='tooltip_icon'>?</span><span class='tooltiptext'>CiteIt.net displays the 500 characters of Context immediately before and after the quote</span></div><br />" +
                embed_ui.html + " .. " + json.cited_context_before +
            "</blockquote></div>"
        );

        blockcite.after("<div id='quote_after_" + json.sha256 + "' class='quote_context'>" +
            "<blockquote class='quote_context'>" +
                ".. " + json.cited_context_after + " .." +
                "<br /><span class='context_header'>Context After:</span>" +
                "<div class='tooltip'><span class='tooltip_icon'>?</span><span class='tooltiptext'>CiteIt.net displays the 500 characters immediately before and after the quote</span></div>" +
            "</blockquote></div>" 
        );

        var context_before = jQuery("#quote_before_" + json.sha256);
        var context_after = jQuery("#quote_after_" + json.sha256);

        /* Main Class */
        blockcite.addClass('quote_text');

        // Hide the surrounding context until the user clicks the arrow above or below the quote
        context_before.hide();
        context_after.hide();

        // If the context before is found, set if
        if (!!json.cited_context_before) {
            context_before.before("<div class='quote_arrows up-arrow' id='context_up_" + json.sha256 + "'>" +
            "<a id='quote_arrow_up_" + json.sha256 + "' " +
            "href=\"javascript:toggleQuote('quote_arrow_up', 'quote_before_" + json.sha256 + "');\">&#9650;</a> " + trimDefault(embed_ui.icon) +
            "</div>"
            );
        }
        // If the context after is found, set if
        if (!!json.cited_context_after) {
            context_after.after("<div class='quote_arrows down-arrow' id='context_down_" + json.sha256 + "'>" +
            "<div class='citeit_source'><span class='source'>source: </span>" +
            "<a class='citeit_source_domain' href='" + json.cited_url + "'>" + extractDomain(json.cited_url) + "</a></div> " +
            "<a class='down_arrow' id='quote_arrow_down_" + json.sha256 + "' " +
            "href=\"javascript:toggleQuote('quote_arrow_down', 'quote_after_" + json.sha256 + "');\">&#9660;</a>" +
            "</div>");
        }

    } // elseif (tag_type === 'blockquote')
} // end: function add_quote_to_dom


//****************** String to Array ********************
function stringToArrayDemo(s) {
    // Credit: https://medium.com/@giltayar/iterating-over-emoji-characters-the-es6-way-f06e4589516
    // convert string to Array

    const retVal = [];

    for (const ch of s) {
        retVal.push(ch);
    }

    return retVal;
}
//****************** Quote Hash Key ********************I**
function quoteHashKeyDemo(citing_quote, citing_url, cited_url) {

    var quote_hash = escapeQuoteDemo(citing_quote) + "|" +
        urlWithoutProtocolDemo(escapeUrlDemo(citing_url)) + "|" +
        urlWithoutProtocolDemo(escapeUrlDemo(cited_url));

    return quote_hash;
}

//*********** URL without Protocol ************
function urlWithoutProtocolDemo(url) {
    // Remove http(s):// and trailing slash
    // Before: https://www.example.com/blog/first-post/
    // After:  www.example.com/blog/first-post

    var url_without_trailing_slash = url.replace(/\/$/, "");
    var url_without_protocol = url_without_trailing_slash.replace(/^https?\:\/\//i, "");

    return url_without_protocol;
}

//******** Escape URL *************
function escapeUrlDemo(str) {
    // This is a list of Unicode character points that should be filtered out from the quote hash
    // This list should match the webservice settings:
    // * https://github.com/CiteIt/citeit-webservice/blob/master/app/settings-default.py
    //   - URL_ESCAPE_CODE_POINTS

    //alert("escappeURLDemo");
    var replace_chars = new Set([
        10, 20, 160
    ]);

    // str = trimRegex(str);   // remove whitespace at beginning and end
    return normalizeTextDemo(str, replace_chars);
}

//********* Escape Quote ************
function escapeQuoteDemo(str) {
    // This is a list of Unicode character points that should be filtered out from the quote hash
    // This list should match the webservice settings:
    // * https://github.com/CiteIt/citeit-webservice/blob/master/app/settings-default.py
    //   - TEXT_ESCAPE_CODE_POINTS

    var replace_chars = new Set([
        2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 39, 96, 160, 173, 699, 700, 701, 702, 703, 712, 713, 714, 715, 716, 717, 718, 719, 732, 733, 750, 757, 8211, 8212, 8213, 8216, 8217, 8219, 8220, 8221, 8226, 8203, 8204, 8205, 65279, 8232, 8233, 133 , 5760, 6158, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8239, 8287, 8288, 12288
    ]);

    return normalizeTextDemo(str, replace_chars);
}

//******************* Normalize Text **********************
function normalizeTextDemo(str, escape_code_points) {
    /* This javascript function performs the same functionality as the
       python method: citeit_quote_context.text_convert.escape()
         - https://github.com/CiteIt/citeit-webservice/blob/master/app/lib/citeit_quote_context/text_convert.py

       It removes an array of symbols from the input str
    */

    var str_return = ''; //default: empty string
    var input_code_point = -1;

    var str_array = stringToArrayDemo(str); // convert string to array

    if (str_array){

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
