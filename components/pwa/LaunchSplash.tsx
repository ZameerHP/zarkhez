import React from 'react';

/**
 * Inline, pre-hydration script (runs before React):
 *  - Marks standalone launches (data-zk-standalone) for safe-area styling.
 *  - Shows the branded launch splash once per app session in standalone mode.
 *  - Captures `beforeinstallprompt` early so the custom Install button never
 *    misses it (the event can fire before the React tree hydrates).
 * Kept tiny and dependency-free; wrapped in try/catch so it can never break rendering.
 */
export const PWA_HEAD_SCRIPT = `(function(){try{
var d=document.documentElement,m=function(q){return window.matchMedia&&window.matchMedia(q).matches};
var s=m('(display-mode: standalone)')||m('(display-mode: fullscreen)')||m('(display-mode: minimal-ui)')||window.navigator.standalone===true;
if(s){d.setAttribute('data-zk-standalone','1');
try{if(!sessionStorage.getItem('zk_splash_seen')){sessionStorage.setItem('zk_splash_seen','1');d.setAttribute('data-zk-splash','show');}}catch(e){}}
window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__zkInstallPrompt=e;window.dispatchEvent(new Event('zk:installprompt'));});
window.addEventListener('appinstalled',function(){window.__zkInstallPrompt=null;try{localStorage.setItem('zarkhez_pwa_installed','1')}catch(e){}window.dispatchEvent(new Event('zk:appinstalled'));});
}catch(e){}})();`;

/**
 * Branded launch splash. Hidden by default via CSS (see globals.css); only
 * becomes visible when the head script sets data-zk-splash="show". A pure-CSS
 * failsafe animation hides it after a few seconds even if JavaScript fails.
 */
export function LaunchSplash({ tagline }: { tagline: string }) {
  return (
    <div id="zk-splash" aria-hidden="true">
      <div className="zk-splash-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" width={112} height={112} />
      </div>
      <div className="zk-splash-brand" dir="ltr">
        ZARKHEZ
      </div>
      <div className="zk-splash-urdu">زرخیز</div>
      <div className="zk-splash-tagline">{tagline}</div>
      <div className="zk-splash-bar" dir="ltr">
        <span />
      </div>
    </div>
  );
}
