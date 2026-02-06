/**
 * CiteIt Quote Context - Custom Hook
 * A hook for fetching quote context data with caching and deduplication
 */

import { useState, useEffect, useMemo } from "react";
import { sha256 } from "js-sha256";
import {
    clog,
    quoteHashKey,
    isWordpressPreview,
    isValidUrl,
    isValidSha256,
    isValidApiResponse,
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
 * Custom hook to fetch quote context from CiteIt.net
 * Includes caching and request deduplication for performance
 *
 * @param {string} citedUrl - The URL being cited
 * @param {string} citingQuote - The quote text
 * @param {string} propCitingUrl - The URL of the page containing the quote
 * @returns {Object} - { data, isLoading, error }
 */
function useQuoteContext(citedUrl, citingQuote, propCitingUrl) {
    const [data, setData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

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
                setData(cachedData);
            }
            setIsLoading(false);
            return;
        }

        // Check if request is already pending
        if (isPending(hashValue)) {
            onPendingComplete(hashValue, (completedData) => {
                if (completedData && isValidApiResponse(completedData)) {
                    setData(completedData);
                }
                setIsLoading(false);
            });
            return;
        }

        // Mark as pending and fetch
        setPending(hashValue);

        // Create abort controller for cleanup
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
                setData(json);
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

        // Cleanup function
        return () => {
            abortController.abort();
        };
    }, [hashInfo]);

    return { data, isLoading, error };
}

export default useQuoteContext;
