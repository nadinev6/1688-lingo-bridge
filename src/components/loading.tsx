/**
 * Lingo Bridge Loader Controller
 * Handles the "UK Industrial Procurement" boot sequence with type safety.
 */
class BridgeLoader {
    private loaderOverlay: HTMLElement | null;
    private statusElements: {
        mainMsg: HTMLElement | null;
    };

    constructor() {
        // Selecting DOM elements with explicit type casting
        this.loaderOverlay = document.getElementById('loader-overlay');
        this.statusElements = {
            mainMsg: document.getElementById('main-loading-msg')
        };

        this.init();
    }

    private init(): void {
        // Wait for the window to fully load before starting the sequence
        window.addEventListener('load', () => this.startBootSequence());
    }

    private startBootSequence(): void {
        // Stage 1: Initialise System
        this.updateStatus(1000, {
            msg: "Syncing Vision Layer"
        });

        // Stage 2: Verification
        this.updateStatus(2500, {
            msg: "Applying International Guardrails"
        });

        // Stage 3: Reveal Dashboard
        this.terminateLoader(4000);
    }

    /**
     * Updates UI text safely checking for null elements
     */
    private updateStatus(delay: number, content: { msg?: string }): void {
        setTimeout(() => {
            if (content.msg && this.statusElements.mainMsg) {
                this.statusElements.mainMsg.innerText = content.msg;
            }
        }, delay);
    }

    private terminateLoader(delay: number): void {
        setTimeout(() => {
            if (this.loaderOverlay) {
                this.loaderOverlay.classList.add('loader-hidden');

                // Optional: Dispatch a custom event when loading is finished
                window.dispatchEvent(new CustomEvent('bridge-ready'));
            }
        }, delay);
    }
}

// Initialise the loader
new BridgeLoader();
