// Consent-first Google Analytics 4.
//
// GA is not requested at all until a visitor explicitly accepts analytics.
// The choice is stored locally so it persists across pages and can be changed
// at any time with the "Cookie settings" footer button.

const MEASUREMENT_ID = 'G-L5QT4DVVS0';
const CONSENT_KEY = 'mario-seijo-analytics-consent';
let loaded = false;

function getConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

function saveConsent(value) {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // A blocked localStorage should not prevent the visitor from using the site.
  }
}

function loadGoogleAnalytics() {
  if (loaded) return;
  loaded = true;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID, {
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false
  });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.append(script);
}

function track(eventName, parameters = {}) {
  if (getConsent() !== 'granted' || typeof window.gtag !== 'function') return;
  window.gtag('event', eventName, parameters);
}

function bindInteractionEvents() {
  document.addEventListener('click', (event) => {
    const target = event.target.closest('a,button');
    if (!target) return;

    if (target.id === 'saveBack') {
      track('contact_download', { method: 'vcard' });
      return;
    }
    if (target.id === 'flip') {
      track('card_flip');
      return;
    }

    const href = target.getAttribute('href') || '';
    if (href.startsWith('mailto:')) track('contact_click', { method: 'email' });
    else if (href.startsWith('sms:') || href.startsWith('tel:')) {
      track('contact_click', { method: 'phone_or_sms' });
    } else if (href.includes('linkedin.com')) {
      track('outbound_click', { destination: 'linkedin' });
    } else if (href.includes('instagram.com')) {
      track('outbound_click', { destination: 'instagram' });
    } else if (href.includes('minimostudio.io/book-a-call')) {
      track('outbound_click', { destination: 'book_a_call' });
    }
  });
}

function createConsentUI() {
  const banner = document.createElement('section');
  banner.className = 'consent';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-modal', 'false');
  banner.setAttribute('aria-labelledby', 'consent-title');
  banner.hidden = true;
  banner.innerHTML = `
    <div class="consent__copy">
      <strong id="consent-title">A small choice about analytics</strong>
      <p>I use Google Analytics to understand how people use this site. It only loads if you accept. <a href="/privacy">Privacy details</a></p>
    </div>
    <div class="consent__actions">
      <button class="consent__button consent__button--quiet" type="button" data-consent="denied">No thanks</button>
      <button class="consent__button consent__button--accept" type="button" data-consent="granted">Accept analytics</button>
    </div>`;
  document.body.append(banner);

  const settings = document.createElement('button');
  settings.className = 'cookie-settings';
  settings.type = 'button';
  settings.textContent = 'Cookie settings';
  const footer = document.querySelector('.sitefooter');
  if (footer) {
    const separator = document.createElement('span');
    separator.className = 'sep';
    separator.setAttribute('aria-hidden', 'true');
    separator.textContent = '·';
    footer.append(separator, settings);
  }

  function openBanner() {
    banner.hidden = false;
    banner.querySelector('[data-consent="granted"]')?.focus();
  }

  banner.addEventListener('click', (event) => {
    const button = event.target.closest('[data-consent]');
    if (!button) return;
    const choice = button.dataset.consent;
    saveConsent(choice);
    banner.hidden = true;
    if (choice === 'granted') loadGoogleAnalytics();
  });
  settings.addEventListener('click', openBanner);

  return { openBanner };
}

export function initAnalytics() {
  const ui = createConsentUI();
  bindInteractionEvents();

  const consent = getConsent();
  if (consent === 'granted') loadGoogleAnalytics();
  else if (consent !== 'denied') ui.openBanner();
}
