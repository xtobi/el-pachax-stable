import { signInWithRedirect } from 'firebase/auth';
import { auth, googleProvider } from './firebase';

// Mobile browsers can intermittently fail Firebase signInWithPopup with
// auth/network-request-failed. Capture the Google button before React's
// popup handler and use the redirect flow, which is more reliable on phones.
function install() {
  document.addEventListener(
    'click',
    event => {
      const target = event.target instanceof Element ? event.target.closest('.googleButton') : null;
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      signInWithRedirect(auth, googleProvider).catch(error => {
        console.error('Google redirect sign-in failed:', error);
        window.dispatchEvent(new CustomEvent('el-pachax-auth-error', { detail: error?.code || 'auth/unknown-error' }));
      });
    },
    true
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
