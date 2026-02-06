/**
 * CiteIt Quote Context - React Component
 * https://github.com/CiteIt/citeit-jquery
 *
 * Displays contextual information for blockquote and q tags
 * by fetching data from the CiteIt.net web service.
 */

import React, { useState, useEffect, useCallback, useMemo, memo } from "react";
import PropTypes from "prop-types";
import { sha256 } from "js-sha256";
import {
    clog,
    quoteHashKey,
    extractDomain,
    isWordpressPreview,
    isValidUrl,
    isValidSha256,
    isValidApiResponse,
    sanitizeId,
    sanitizeUrl,
    getPopupWidth,
    buildReadUrl,
    getCurrentPageUrl,
    isCached,
    getCached,
    setCached,
    isPending,
    setPending,
    setComplete,
    onPendingComplete
} from "./utils";
import QuotePopup from "./QuotePopup";

/** @const {RegExp} YouTube URL pattern */
const YOUTUBE_REGEX = /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

/** @const {RegExp} YouTube start time pattern */
const YOUTUBE_START_REGEX = /[?&]t=(\d+)/;

/**
 * Memoized YouTube embed component
 */
const YouTubeEmbed = memo(function YouTubeEmbed({ embedUrl, width, height }) {
    return (
        <iframe
            className="youtube"
            src={embedUrl}
            width={width}
            height={height}
            frameBorder="0"
            sandbox="allow-scripts allow-same-origin"
            allowFullScreen
            loading="lazy"
            title="YouTube video"
        />
    );
});

YouTubeEmbed.propTypes = {
    embedUrl: PropTypes.string.isRequired,
    width: PropTypes.string.isRequired,
    height: PropTypes.string.isRequired
};

/**
 * Context display component for before/after text
 */
const ContextBlock = memo(function ContextBlock({
    id,
    headerText,
    contextText,
    embedHtml,
    showEmbedFirst
}) {
    return (
        <div id={id} className="quote_context">
            <blockquote className="quote_context">
                {!showEmbedFirst && (
                    <>
                        <span className="context_header">{headerText}</span>
                        <div className="tooltip">
                            <span className="tooltip_icon">?</span>
                            <span className="tooltiptext">
                                CiteIt.net displays Context
                            </span>
                        </div>
                        <br />
                    </>
                )}
                {showEmbedFirst && embedHtml}
                {showEmbedFirst ? `.. ${contextText}` : `.. ${contextText} ..`}
                {!showEmbedFirst && (
                    <>
                        <br />
                        <span className="context_header">{headerText}</span>
                        <div className="tooltip">
                            <span className="tooltip_icon">?</span>
                            <span className="tooltiptext">
                                CiteIt.net displays Context
                            </span>
                        </div>
                    </>
                )}
            </blockquote>
        </div>
    );
});

ContextBlock.propTypes = {
    id: PropTypes.string.isRequired,
    headerText: PropTypes.string.isRequired,
    contextText: PropTypes.string.isRequired,
    embedHtml: PropTypes.node,
    showEmbedFirst: PropTypes.bool
};

ContextBlock.defaultProps = {
    embedHtml: null,
    showEmbedFirst: false
};

/**
 * Arrow toggle button component
 */
const ArrowToggle = memo(function ArrowToggle({
    id,
    direction,
    isExpanded,
    onClick,
    children
}) {
    const arrowChar = direction === "up" ? "\u25B2" : "\u25BC";
    const className = direction === "up"
        ? (isExpanded ? "rotated180" : "")
        : `down_arrow ${isExpanded ? "rotated180" : ""}`;

    return (
        <button
            type="button"
            id={id}
            className={className}
            onClick={onClick}
            aria-expanded={isExpanded}
        >
            {arrowChar}
        </button>
    );
});

ArrowToggle.propTypes = {
    id: PropTypes.string.isRequired,
    direction: PropTypes.oneOf(["up", "down"]).isRequired,
    isExpanded: PropTypes.bool.isRequired,
    onClick: PropTypes.func.isRequired,
    children: PropTypes.node
};

ArrowToggle.defaultProps = {
    children: null
};

/**
 * Get YouTube embed info from a URL
 * @param {string} url - The video URL
 * @param {string} sha256Hash - The SHA256 hash for element IDs
 * @param {string} tagType - Either "q" or "blockquote"
 * @returns {Object} Object with embedHtml and embedIcon components
 */
function getYouTubeEmbed(url, sha256Hash, tagType) {
    const match = url.match(YOUTUBE_REGEX);

    if (!match) {
        return { embedHtml: null, embedIcon: null };
    }

    const safeSha = sanitizeId(sha256Hash);
    if (!safeSha) {
        return { embedHtml: null, embedIcon: null };
    }

    const videoId = match[1];
    const startMatch = url.match(YOUTUBE_START_REGEX);
    const startTime = startMatch ? startMatch[1] : "";

    const embedUrl = `https://www.youtube.com/embed/${videoId}${
        startTime ? `?start=${startTime}` : ""
    }`;

    const width = tagType === "q" ? "426" : "560";
    const height = tagType === "q" ? "240" : "315";

    const embedHtml = (
        <YouTubeEmbed embedUrl={embedUrl} width={width} height={height} />
    );

    const embedIcon = (
        <span className="view_on_youtube">
            <br />
            <button
                type="button"
                data-target={`quote_before_${safeSha}`}
                onClick={(e) => {
                    const targetId = e.currentTarget.getAttribute("data-target");
                    const el = document.getElementById(targetId);
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
 * Computes the effective citing URL
 * @param {string} propCitingUrl - The prop value
 * @returns {string} The effective URL
 */
function getEffectiveCitingUrl(propCitingUrl) {
    let citingUrl = propCitingUrl;
    if (!isValidUrl(citingUrl)) {
        citingUrl = getCurrentPageUrl();
    }
    if (isWordpressPreview(citingUrl)) {
        const queryIndex = citingUrl.indexOf("?");
        if (queryIndex > -1) {
            citingUrl = citingUrl.substring(0, queryIndex);
        }
    }
    return citingUrl;
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

    // Memoize citing URL computation
    const citingUrl = useMemo(
        () => getEffectiveCitingUrl(propCitingUrl),
        [propCitingUrl]
    );

    // Memoize hash computation
    const hashInfo = useMemo(() => {
        if (!citedUrl || citedUrl.length <= 3 || !isValidUrl(citedUrl)) {
            return null;
        }
        const hashKey = quoteHashKey(citingQuote, citingUrl, citedUrl);
        const encodedHashKey = unescape(encodeURIComponent(hashKey));
        const hashValue = sha256(encodedHashKey);
        if (!isValidSha256(hashValue)) {
            return null;
        }
        return { hashKey, hashValue };
    }, [citedUrl, citingQuote, citingUrl]);

    // Fetch context data with caching and deduplication
    useEffect(() => {
        if (!hashInfo) {
            setIsLoading(false);
            return;
        }

        const { hashValue } = hashInfo;

        // Check cache first
        if (isCached(hashValue)) {
            const cachedData = getCached(hashValue);
            if (cachedData && isValidApiResponse(cachedData)) {
                setContextData(cachedData);
            }
            setIsLoading(false);
            return;
        }

        // Check if request is already pending
        if (isPending(hashValue)) {
            onPendingComplete(hashValue, (data) => {
                if (data && isValidApiResponse(data)) {
                    setContextData(data);
                }
                setIsLoading(false);
            });
            return;
        }

        // Mark as pending and fetch
        setPending(hashValue);

        const abortController = new AbortController();

        const fetchContext = async () => {
            try {
                const readUrl = buildReadUrl(hashValue);
                if (!readUrl) {
                    throw new Error("Invalid hash value");
                }

                clog(`Fetching: ${readUrl}`);

                const response = await fetch(readUrl, {
                    signal: abortController.signal
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const json = await response.json();

                // Validate API response
                if (!isValidApiResponse(json)) {
                    clog("Invalid API response structure");
                    setCached(hashValue, null);
                    setComplete(hashValue);
                    setError(new Error("Invalid API response"));
                    return;
                }

                // Cache and set data
                setCached(hashValue, json);
                setComplete(hashValue);
                setContextData(json);
                clog(`CiteIt Found: ${readUrl}`);
            } catch (err) {
                if (err.name !== "AbortError") {
                    clog(`CiteIt Missed: ${err.message}`);
                    setCached(hashValue, null);
                    setComplete(hashValue);
                    setError(err);
                }
            } finally {
                setIsLoading(false);
            }
        };

        fetchContext();

        return () => {
            abortController.abort();
        };
    }, [hashInfo]);

    // Memoized event handlers
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

    // Memoize derived values
    const derivedValues = useMemo(() => {
        if (!contextData) {
            return null;
        }
        const safeSha = sanitizeId(contextData.sha256);
        const domain = extractDomain(contextData.cited_url);
        const safeCitedUrl = sanitizeUrl(contextData.cited_url);
        const popupWidth = getPopupWidth();
        const youtubeEmbed = getYouTubeEmbed(citedUrl, safeSha, tagType);

        return {
            safeSha,
            domain,
            safeCitedUrl,
            popupWidth,
            embedHtml: youtubeEmbed.embedHtml,
            embedIcon: youtubeEmbed.embedIcon
        };
    }, [contextData, citedUrl, tagType]);

    // Render loading or error state
    if (isLoading || error || !contextData || !derivedValues) {
        return <>{children}</>;
    }

    const {
        safeSha,
        domain,
        safeCitedUrl,
        popupWidth,
        embedHtml,
        embedIcon
    } = derivedValues;

    // Render inline quote (q tag)
    if (tagType === "q") {
        return (
            <>
                <a
                    className="popup_quote"
                    href={safeCitedUrl}
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
                    <span className="q-tag-highlight">
                        <strong>{contextData.citing_quote}</strong>
                    </span>{" "}
                    {contextData.cited_context_after} ..
                    <p>
                        <a
                            href={safeCitedUrl}
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
            {/* Context Before Arrow */}
            {contextData.cited_context_before && (
                <div
                    className="quote_arrows up-arrow"
                    id={`context_up_${safeSha}`}
                >
                    <ArrowToggle
                        id={`quote_arrow_up_${safeSha}`}
                        direction="up"
                        isExpanded={isBeforeExpanded}
                        onClick={toggleBefore}
                    />
                    {embedIcon}
                </div>
            )}

            {/* Context Before Content */}
            {isBeforeExpanded && contextData.cited_context_before && (
                <ContextBlock
                    id={`quote_before_${safeSha}`}
                    headerText="Context Before:"
                    contextText={contextData.cited_context_before}
                    embedHtml={embedHtml}
                    showEmbedFirst
                />
            )}

            {/* Original Quote */}
            <blockquote className="quote_text" cite={safeCitedUrl}>
                {children}
            </blockquote>

            {/* Context After Content */}
            {isAfterExpanded && contextData.cited_context_after && (
                <ContextBlock
                    id={`quote_after_${safeSha}`}
                    headerText="Context After:"
                    contextText={contextData.cited_context_after}
                />
            )}

            {/* Context After Arrow */}
            {contextData.cited_context_after && (
                <div
                    className="quote_arrows down-arrow"
                    id={`context_down_${safeSha}`}
                >
                    <div className="citeit_source">
                        <span className="source">source: </span>
                        <a
                            className="citeit_source_domain"
                            href={safeCitedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {domain}
                        </a>
                    </div>
                    <ArrowToggle
                        id={`quote_arrow_down_${safeSha}`}
                        direction="down"
                        isExpanded={isAfterExpanded}
                        onClick={toggleAfter}
                    />
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

export default memo(QuoteContext);
