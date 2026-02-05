/**
 * CiteIt Quote Context - Custom Hook
 * A hook for fetching quote context data
 */

import { useState, useEffect } from "react";
import { sha256 } from "js-sha256";
import {
    clog,
    quoteHashKey,
    isWordpressPreview,
    isValidUrl,
    buildReadUrl,
    getCurrentPageUrl
} from "./utils";

/**
 * Custom hook to fetch quote context from CiteIt.net
 *
 * @param {string} citedUrl - The URL being cited
 * @param {string} citingQuote - The quote text
 * @param {string} citingUrl - The URL of the page containing the quote
 * @returns {Object} - { data, isLoading, error }
 */
function useQuoteContext(citedUrl, citingQuote, citingUrl) {
    const [data, setData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        // Validate inputs
        if (!citedUrl || citedUrl.length <= 3) {
            setIsLoading(false);
            return;
        }

        // Determine citing URL
        let effectiveCitingUrl = citingUrl;
        if (!isValidUrl(effectiveCitingUrl)) {
            effectiveCitingUrl = getCurrentPageUrl();
        }
        if (isWordpressPreview(effectiveCitingUrl)) {
            effectiveCitingUrl = effectiveCitingUrl.substring(
                0,
                effectiveCitingUrl.indexOf("?")
            );
        }

        // Create abort controller for cleanup
        const abortController = new AbortController();

        const fetchContext = async () => {
            try {
                setIsLoading(true);
                setError(null);

                const hashKey = quoteHashKey(
                    citingQuote,
                    effectiveCitingUrl,
                    citedUrl
                );
                const encodedHashKey = unescape(encodeURIComponent(hashKey));
                const hashValue = sha256(encodedHashKey);
                const readUrl = buildReadUrl(hashValue);

                clog(`Fetching: ${readUrl}`);

                const response = await fetch(readUrl, {
                    signal: abortController.signal
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const json = await response.json();
                setData(json);
                clog(`CiteIt Found: ${readUrl}`);
            } catch (err) {
                if (err.name !== "AbortError") {
                    clog(`CiteIt Missed: ${err.message}`);
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
    }, [citedUrl, citingQuote, citingUrl]);

    return { data, isLoading, error };
}

export default useQuoteContext;
