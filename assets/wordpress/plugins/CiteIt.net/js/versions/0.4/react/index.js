/**
 * CiteIt Quote Context - React Components
 * https://github.com/CiteIt/citeit-jquery
 *
 * Usage:
 *
 * import { QuoteContext, QuotePopup } from './react';
 *
 * // For blockquotes:
 * <QuoteContext
 *     citedUrl="https://example.com/source"
 *     citingQuote="The quoted text here"
 *     tagType="blockquote"
 * >
 *     The quoted text here
 * </QuoteContext>
 *
 * // For inline quotes (q tags):
 * <QuoteContext
 *     citedUrl="https://example.com/source"
 *     citingQuote="inline quote"
 *     tagType="q"
 * >
 *     inline quote
 * </QuoteContext>
 */

export { default as QuoteContext } from "./QuoteContext";
export { default as QuotePopup } from "./QuotePopup";
export { default as useQuoteContext } from "./useQuoteContext";
export * from "./utils";
