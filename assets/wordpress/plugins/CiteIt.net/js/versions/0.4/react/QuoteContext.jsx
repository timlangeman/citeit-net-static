/**
 * CiteIt Quote Context - React Component
 * https://github.com/CiteIt/citeit-jquery
 *
 * Displays contextual information for blockquote and q tags
 * by fetching data from the CiteIt.net web service.
 */

import React, { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { sha256 } from "js-sha256";
import {
    clog,
    quoteHashKey,
    extractDomain,
    isWordpressPreview,
    isValidUrl,
    getPopupWidth,
    buildReadUrl,
    getCurrentPageUrl
} from "./utils";
import QuotePopup from "./QuotePopup";

/**
 * Get YouTube embed info from a URL
 */
function getYouTubeEmbed(url, sha256Hash, tagType) {
    const youtubeRegex = /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(youtubeRegex);

    if (!match) {
        return { embedHtml: "", embedIcon: "" };
    }

    const videoId = match[1];
    const startMatch = url.match(/[?&]t=(\d+)/);
    const startTime = startMatch ? startMatch[1] : "";

    const embedUrl = `https://www.youtube.com/embed/${videoId}${
        startTime ? `?start=${startTime}` : ""
    }`;

    const width = tagType === "q" ? "426" : "560";
    const height = tagType === "q" ? "240" : "315";

    const embedHtml = (
        <iframe
            className="youtube"
            src={embedUrl}
            width={width}
            height={height}
            frameBorder="0"
            allowFullScreen
            title="YouTube video"
        />
    );

    const embedIcon = (
        <span className="view_on_youtube">
            <br />
            <button
                type="button"
                onClick={() => {
                    const el = document.getElementById(`quote_before_${sha256Hash}`);
                    if (el) {
                        el.classList.toggle("expanded");
                    }
                }}
            >
                Expand: Show Video Clip
            </button>
        </span>
    );

    return { embedHtml, embedIcon };
}

/**
 * QuoteContext component - wraps a quote element and fetches context
 */
function QuoteContext({
    citedUrl,
    citingQuote,
    citingUrl: propCitingUrl,
    tagType = "blockquote",
    children
}) {
    const [contextData, setContextData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isPopupOpen, setIsPopupOpen] = useState(false);
    const [isBeforeExpanded, setIsBeforeExpanded] = useState(false);
    const [isAfterExpanded, setIsAfterExpanded] = useState(false);

    // Determine citing URL
    let citingUrl = propCitingUrl;
    if (!isValidUrl(citingUrl)) {
        citingUrl = getCurrentPageUrl();
    }
    if (isWordpressPreview(citingUrl)) {
        citingUrl = citingUrl.substring(0, citingUrl.indexOf("?"));
    }

    // Fetch context data
    useEffect(() => {
        if (!citedUrl || citedUrl.length <= 3) {
            setIsLoading(false);
            return;
        }

        const fetchContext = async () => {
            try {
                const hashKey = quoteHashKey(citingQuote, citingUrl, citedUrl);
                const encodedHashKey = unescape(encodeURIComponent(hashKey));
                const hashValue = sha256(encodedHashKey);
                const readUrl = buildReadUrl(hashValue);

                clog(`Fetching: ${readUrl}`);

                const response = await fetch(readUrl);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const json = await response.json();
                setContextData(json);
                clog(`CiteIt Found: ${readUrl}`);
            } catch (err) {
                clog(`CiteIt Missed: ${err.message}`);
                setError(err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchContext();
    }, [citedUrl, citingQuote, citingUrl]);

    const handleOpenPopup = useCallback((e) => {
        e.preventDefault();
        setIsPopupOpen(true);
    }, []);

    const handleClosePopup = useCallback(() => {
        setIsPopupOpen(false);
    }, []);

    const toggleBefore = useCallback(() => {
        setIsBeforeExpanded((prev) => !prev);
    }, []);

    const toggleAfter = useCallback(() => {
        setIsAfterExpanded((prev) => !prev);
    }, []);

    // Render loading state
    if (isLoading) {
        return <>{children}</>;
    }

    // Render error or no-data state
    if (error || !contextData) {
        return <>{children}</>;
    }

    const { embedHtml, embedIcon } = getYouTubeEmbed(
        citedUrl,
        contextData.sha256,
        tagType
    );
    const popupWidth = getPopupWidth();
    const domain = extractDomain(contextData.cited_url);

    // Render inline quote (q tag)
    if (tagType === "q") {
        return (
            <>
                <a
                    className="popup_quote"
                    href={citedUrl}
                    onClick={handleOpenPopup}
                >
                    {children}
                </a>

                <QuotePopup
                    isOpen={isPopupOpen}
                    onClose={handleClosePopup}
                    width={popupWidth}
                    title="Quote Context by CiteIt.net"
                >
                    {embedHtml}
                    <br />
                    .. {contextData.cited_context_before}{" "}
                    <strong>{contextData.citing_quote}</strong>{" "}
                    {contextData.cited_context_after} ..
                    <p>
                        <a
                            href={contextData.cited_url}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Read more
                        </a>
                        {" | "}
                        <button type="button" onClick={handleClosePopup}>
                            Close
                        </button>
                        <span className="source_url">
                            source: {domain}
                        </span>
                    </p>
                </QuotePopup>
            </>
        );
    }

    // Render blockquote
    return (
        <>
            {/* Context Before */}
            {contextData.cited_context_before && (
                <div className="quote_arrows up-arrow">
                    <button
                        type="button"
                        id={`quote_arrow_up_${contextData.sha256}`}
                        className={isBeforeExpanded ? "rotated180" : ""}
                        onClick={toggleBefore}
                        aria-expanded={isBeforeExpanded}
                    >
                        &#9650;
                    </button>
                    {embedIcon}
                </div>
            )}

            {isBeforeExpanded && (
                <div
                    id={`quote_before_${contextData.sha256}`}
                    className="quote_context"
                >
                    <blockquote className="quote_context">
                        <span className="context_header">Context Before:</span>
                        <div className="tooltip">
                            <span className="tooltip_icon">?</span>
                            <span className="tooltiptext">
                                CiteIt.net displays the 500 characters of Context
                                immediately before and after the quote
                            </span>
                        </div>
                        <br />
                        {embedHtml}
                        .. {contextData.cited_context_before}
                    </blockquote>
                </div>
            )}

            {/* Original Quote */}
            <blockquote className="quote_text" cite={citedUrl}>
                {children}
            </blockquote>

            {/* Context After */}
            {isAfterExpanded && (
                <div
                    id={`quote_after_${contextData.sha256}`}
                    className="quote_context"
                >
                    <blockquote className="quote_context">
                        .. {contextData.cited_context_after} ..
                        <br />
                        <span className="context_header">Context After:</span>
                        <div className="tooltip">
                            <span className="tooltip_icon">?</span>
                            <span className="tooltiptext">
                                CiteIt.net displays the 500 characters immediately
                                before and after the quote
                            </span>
                        </div>
                    </blockquote>
                </div>
            )}

            {contextData.cited_context_after && (
                <div className="quote_arrows down-arrow">
                    <div className="citeit_source">
                        <span className="source">source: </span>
                        <a
                            className="citeit_source_domain"
                            href={contextData.cited_url}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {domain}
                        </a>
                    </div>
                    <button
                        type="button"
                        id={`quote_arrow_down_${contextData.sha256}`}
                        className={`down_arrow ${isAfterExpanded ? "rotated180" : ""}`}
                        onClick={toggleAfter}
                        aria-expanded={isAfterExpanded}
                    >
                        &#9660;
                    </button>
                </div>
            )}
        </>
    );
}

QuoteContext.propTypes = {
    citedUrl: PropTypes.string.isRequired,
    citingQuote: PropTypes.string.isRequired,
    citingUrl: PropTypes.string,
    tagType: PropTypes.oneOf(["blockquote", "q"]),
    children: PropTypes.node.isRequired
};

QuoteContext.defaultProps = {
    citingUrl: "",
    tagType: "blockquote"
};

export default QuoteContext;
