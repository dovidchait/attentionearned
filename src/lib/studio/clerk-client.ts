// Loads Clerk's browser SDK on Studio pages only. The @clerk/astro integration would inject a
// Clerk loader into every page, including the public marketing site, so it is not used.
// The publishable key and script URL come from #studio-clerk-config (see ClerkConfig.astro).

export interface ClerkBrowser {
  user: unknown;
  load(): Promise<void>;
  mountSignIn(node: HTMLElement, props?: Record<string, unknown>): void;
  mountSignUp(node: HTMLElement, props?: Record<string, unknown>): void;
  signOut(options?: { redirectUrl?: string }): Promise<void>;
}

let pending: Promise<ClerkBrowser> | null = null;

export function loadClerk(): Promise<ClerkBrowser> {
  if (pending) return pending;

  pending = new Promise<ClerkBrowser>((resolve, reject) => {
    const config = document.getElementById('studio-clerk-config');
    const publishableKey = config?.dataset.publishableKey;
    const scriptUrl = config?.dataset.clerkJs;
    if (!publishableKey || !scriptUrl) {
      reject(new Error('Studio sign-in is not configured yet.'));
      return;
    }

    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.setAttribute('data-clerk-publishable-key', publishableKey);
    script.onload = () => {
      const clerk = (window as unknown as { Clerk?: ClerkBrowser }).Clerk;
      if (!clerk) {
        reject(new Error('Sign-in did not start. Refresh the page and try again.'));
        return;
      }
      clerk.load().then(() => resolve(clerk), reject);
    };
    script.onerror = () => reject(new Error('Sign-in could not load. Check your connection and refresh.'));
    document.head.append(script);
  });

  return pending;
}
