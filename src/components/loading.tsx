/**
 * Lingo Bridge Loader Controller
 * Handles the "UK Industrial Procurement" boot sequence with type safety.
 */
class BridgeLoader {
    private loaderOverlay: HTMLElement | null;
    private statusElements: {
        badge1: HTMLElement | null;
        badge2: HTMLElement | null;
        mainMsg: HTMLElement | null;
    };

    constructor() {
        // Selecting DOM elements with explicit type casting
        this.loaderOverlay = document.getElementById('loader-overlay');
        this.statusElements = {
            badge1: document.getElementById('load-status-1'),
            badge2: document.getElementById('load-status-2'),
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
            status1: "Bridges Operational",
            msg: "Syncing Vision Layer"
        });

        // Stage 2: Verification
        this.updateStatus(2500, {
            status2: "Vision Verified",
            msg: "Applying UK Guardrails"
        });

        // Stage 3: Reveal Dashboard
        this.terminateLoader(4000);
    }

    /**
     * Updates UI text safely checking for null elements
     */
    private updateStatus(delay: number, content: { status1?: string; status2?: string; msg?: string }): void {
        setTimeout(() => {
            if (content.status1 && this.statusElements.badge1) {
                this.statusElements.badge1.innerText = content.status1;
            }
            if (content.status2 && this.statusElements.badge2) {
                this.statusElements.badge2.innerText = content.status2;
            }
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
