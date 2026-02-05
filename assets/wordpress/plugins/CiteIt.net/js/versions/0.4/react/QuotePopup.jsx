/**
 * CiteIt Quote Popup - React Component
 * A modal dialog for displaying quote context
 */

import React, { useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";

function QuotePopup({
    isOpen,
    onClose,
    width = 375,
    title = "Quote Context by CiteIt.net",
    children
}) {
    const dialogRef = useRef(null);
    const contentRef = useRef(null);

    // Handle escape key
    const handleKeyDown = useCallback(
        (e) => {
            if (e.key === "Escape") {
                onClose();
            }
        },
        [onClose]
    );

    // Handle click outside
    const handleBackdropClick = useCallback(
        (e) => {
            if (contentRef.current && !contentRef.current.contains(e.target)) {
                onClose();
            }
        },
        [onClose]
    );

    // Focus management and event listeners
    useEffect(() => {
        if (isOpen) {
            document.addEventListener("keydown", handleKeyDown);
            document.body.style.overflow = "hidden";

            // Focus the dialog
            if (dialogRef.current) {
                dialogRef.current.focus();
            }
        }

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.body.style.overflow = "";
        };
    }, [isOpen, handleKeyDown]);

    if (!isOpen) {
        return null;
    }

    return (
        <div
            className="citeit-popup-backdrop"
            onClick={handleBackdropClick}
            role="presentation"
        >
            <div
                ref={dialogRef}
                className="citeit-popup-dialog dialogue_box"
                role="dialog"
                aria-modal="true"
                aria-labelledby="citeit-popup-title"
                tabIndex={-1}
                style={{ width: `${width}px` }}
            >
                <div className="citeit-popup-header">
                    <h2 id="citeit-popup-title" className="citeit-popup-title">
                        {title}
                    </h2>
                    <button
                        type="button"
                        className="citeit-popup-close"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        &times;
                    </button>
                </div>
                <div ref={contentRef} className="citeit-popup-content highslide-maincontent">
                    {children}
                </div>
            </div>

            <style>{`
                .citeit-popup-backdrop {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background-color: rgba(0, 0, 0, 0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 9999;
                    animation: fadeIn 0.2s ease-out;
                }

                .citeit-popup-dialog {
                    background: white;
                    border-radius: 8px;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                    max-width: 90vw;
                    max-height: 80vh;
                    overflow: auto;
                    animation: scaleIn 0.3s ease-out;
                }

                .citeit-popup-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px 16px;
                    border-bottom: 1px solid #e0e0e0;
                    background: #f5f5f5;
                    border-radius: 8px 8px 0 0;
                }

                .citeit-popup-title {
                    margin: 0;
                    font-size: 16px;
                    font-weight: 600;
                    color: #333;
                }

                .citeit-popup-close {
                    background: none;
                    border: none;
                    font-size: 24px;
                    cursor: pointer;
                    color: #666;
                    padding: 0 4px;
                    line-height: 1;
                }

                .citeit-popup-close:hover {
                    color: #333;
                }

                .citeit-popup-content {
                    padding: 16px;
                }

                @keyframes fadeIn {
                    from {
                        opacity: 0;
                    }
                    to {
                        opacity: 1;
                    }
                }

                @keyframes scaleIn {
                    from {
                        transform: scale(0.9);
                        opacity: 0;
                    }
                    to {
                        transform: scale(1);
                        opacity: 1;
                    }
                }
            `}</style>
        </div>
    );
}

QuotePopup.propTypes = {
    isOpen: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
    width: PropTypes.number,
    title: PropTypes.string,
    children: PropTypes.node
};

QuotePopup.defaultProps = {
    width: 375,
    title: "Quote Context by CiteIt.net",
    children: null
};

export default QuotePopup;
