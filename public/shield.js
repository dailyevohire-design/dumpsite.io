/**
 * DumpSite.io — Client-Side Security Shield
 * 
 * Drop this in /public/shield.js and add <script src="/shield.js" defer></script>
 * to your layout. It silently collects:
 * 
 * 1. Browser fingerprint (screen, GPU, fonts, canvas, audio)
 * 2. Behavioral signals (mouse, scroll, clicks, typing)
 * 3. Honeypot field detection (catches scrapers)
 * 
 * All data is sent to /api/security/collect — your backend processes it.
 * Users see NOTHING. No cookies, no popups, no consent needed (this is
 * security monitoring, not advertising tracking).
 */

(function() {
  'use strict';

  // Session ID — persists for this tab session
  var SESSION_ID = sessionStorage.getItem('_ds_sid');
  if (!SESSION_ID) {
    SESSION_ID = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    sessionStorage.setItem('_ds_sid', SESSION_ID);
  }

  // =========================================
  // 1. BROWSER FINGERPRINT
  // =========================================
  function collectFingerprint() {
    var fp = {};

    // Screen
    fp.screenWidth = screen.width;
    fp.screenHeight = screen.height;
    fp.colorDepth = screen.colorDepth;
    fp.pixelRatio = window.devicePixelRatio || 1;

    // System
    fp.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    fp.language = navigator.language;
    fp.languages = (navigator.languages || []).join(',');
    fp.platform = navigator.platform;
    fp.hardwareConcurrency = navigator.hardwareConcurrency || 0;
    fp.maxTouchPoints = navigator.maxTouchPoints || 0;
    fp.touchSupport = 'ontouchstart' in window;

    // WebGL
    try {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        var debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          fp.webglVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
          fp.webglRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        }
      }
    } catch (e) {
      fp.webglVendor = 'blocked';
      fp.webglRenderer = 'blocked';
    }

    // Canvas fingerprint
    try {
      var c = document.createElement('canvas');
      c.width = 200; c.height = 50;
      var ctx = c.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(20, 0, 100, 30);
      ctx.fillStyle = '#069';
      ctx.fillText('DumpSite.io', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('Security', 4, 35);
      fp.canvasHash = simpleHash(c.toDataURL());
    } catch (e) {
      fp.canvasHash = 'blocked';
    }

    // Audio fingerprint
    try {
      var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var oscillator = audioCtx.createOscillator();
      var analyser = audioCtx.createAnalyser();
      var gain = audioCtx.createGain();
      var processor = audioCtx.createScriptProcessor(4096, 1, 1);
      
      gain.gain.value = 0; // Silent
      oscillator.type = 'triangle';
      oscillator.connect(analyser);
      analyser.connect(processor);
      processor.connect(gain);
      gain.connect(audioCtx.destination);
      oscillator.start(0);
      
      var data = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(data);
      fp.audioHash = simpleHash(data.slice(0, 30).join(','));
      
      oscillator.stop();
      audioCtx.close();
    } catch (e) {
      fp.audioHash = 'blocked';
    }

    // Font detection (count available fonts from a test set)
    var testFonts = [
      'Arial', 'Verdana', 'Times New Roman', 'Courier New', 'Georgia',
      'Palatino', 'Garamond', 'Comic Sans MS', 'Impact', 'Lucida Console',
      'Tahoma', 'Trebuchet MS', 'Arial Black', 'Bookman Old Style',
      'Symbol', 'Webdings', 'Wingdings', 'MS Serif', 'MS Sans Serif',
      'Calibri', 'Cambria', 'Consolas', 'Segoe UI', 'Candara'
    ];
    var detectedFonts = 0;
    var testSpan = document.createElement('span');
    testSpan.style.position = 'absolute';
    testSpan.style.left = '-9999px';
    testSpan.style.fontSize = '72px';
    testSpan.textContent = 'mmmmmmmmmmlli';
    document.body.appendChild(testSpan);
    
    testSpan.style.fontFamily = 'monospace';
    var baseWidth = testSpan.offsetWidth;
    
    testFonts.forEach(function(font) {
      testSpan.style.fontFamily = '"' + font + '", monospace';
      if (testSpan.offsetWidth !== baseWidth) detectedFonts++;
    });
    document.body.removeChild(testSpan);
    fp.fontCount = detectedFonts;

    return fp;
  }

  function simpleHash(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      var char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  // =========================================
  // 2. BEHAVIORAL TRACKING
  // =========================================
  var behavior = {
    mouseMovements: [],
    scrollEvents: [],
    clicks: [],
    keyTimings: [],
    pageLoadTime: Date.now(),
    firstInteractionTime: null,
    pagesVisited: [window.location.pathname]
  };

  var moveCount = 0;
  document.addEventListener('mousemove', function(e) {
    moveCount++;
    // Sample every 10th movement to keep data small
    if (moveCount % 10 === 0 && behavior.mouseMovements.length < 50) {
      behavior.mouseMovements.push({
        x: e.clientX,
        y: e.clientY,
        t: Date.now() - behavior.pageLoadTime
      });
    }
    if (!behavior.firstInteractionTime) behavior.firstInteractionTime = Date.now();
  });

  document.addEventListener('scroll', function() {
    if (behavior.scrollEvents.length < 30) {
      behavior.scrollEvents.push({
        y: window.scrollY,
        t: Date.now() - behavior.pageLoadTime
      });
    }
    if (!behavior.firstInteractionTime) behavior.firstInteractionTime = Date.now();
  });

  document.addEventListener('click', function(e) {
    if (behavior.clicks.length < 30) {
      behavior.clicks.push({
        x: e.clientX,
        y: e.clientY,
        t: Date.now() - behavior.pageLoadTime,
        tag: e.target.tagName
      });
    }
    if (!behavior.firstInteractionTime) behavior.firstInteractionTime = Date.now();
  });

  document.addEventListener('keydown', function() {
    if (behavior.keyTimings.length < 30) {
      behavior.keyTimings.push(Date.now() - behavior.pageLoadTime);
    }
    if (!behavior.firstInteractionTime) behavior.firstInteractionTime = Date.now();
  });

  // =========================================
  // 3. HONEYPOT FIELD DETECTION
  // =========================================
  // Inject hidden fields that only scrapers/bots will fill
  function injectHoneypots() {
    var forms = document.querySelectorAll('form');
    forms.forEach(function(form) {
      // Hidden field — invisible to humans, visible to bots reading HTML
      var hp = document.createElement('input');
      hp.type = 'text';
      hp.name = 'company_website_url';
      hp.tabIndex = -1;
      hp.autocomplete = 'off';
      hp.style.cssText = 'position:absolute;left:-9999px;height:0;width:0;overflow:hidden;opacity:0;';
      form.insertBefore(hp, form.firstChild);

      // If this gets filled, it's a bot
      form.addEventListener('submit', function() {
        if (hp.value && hp.value.length > 0) {
          // BOT DETECTED — log it
          sendToServer('honeypot_form', { field: 'company_website_url', value: hp.value });
        }
      });
    });
  }

  // =========================================
  // 4. SEND DATA TO SERVER
  // =========================================
  function sendToServer(eventType, extraData) {
    var payload = {
      sessionId: SESSION_ID,
      eventType: eventType,
      url: window.location.href,
      timestamp: new Date().toISOString()
    };

    if (eventType === 'fingerprint') {
      payload.fingerprint = extraData;
    } else if (eventType === 'behavior') {
      payload.behavior = extraData;
    } else if (eventType === 'honeypot_form') {
      payload.honeypot = extraData;
    } else if (eventType === 'csp_violation') {
      payload.csp = extraData;
    } else if (eventType === 'address_leak') {
      payload.leak = extraData;
    }

    // Use sendBeacon for reliability (survives page unload)
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/security/collect', JSON.stringify(payload));
    } else {
      fetch('/api/security/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function() {});
    }
  }

  // =========================================
  // 4. CSP VIOLATION REPORTER
  // =========================================
  var cspSent = {};
  document.addEventListener('securitypolicyviolation', function(e) {
    var key = e.violatedDirective + '|' + e.blockedURI;
    if (cspSent[key]) return;
    cspSent[key] = 1;
    sendToServer('csp_violation', {
      directive: e.violatedDirective,
      blocked: e.blockedURI,
      source: e.sourceFile,
      line: e.lineNumber,
      sample: e.sample,
      disposition: e.disposition
    });
  });

  // =========================================
  // 5. ADDRESS LEAK GUARD
  // =========================================
  // Driver UI must NEVER render dump site addresses. Scan visible DOM and
  // beacon if a street address pattern appears outside admin/account pages.
  var ADDR_RE = /\b\d{2,6}\s+([A-Z][a-z]+\s){1,4}(St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Way|Ct|Court|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Ter|Terrace|Pl|Place)\b\.?/;
  var leakSent = {};

  function isAdminPath() {
    return /^\/(admin|account)/.test(window.location.pathname);
  }

  function scanForAddresses() {
    if (isAdminPath()) return;
    try {
      var text = document.body ? document.body.innerText : '';
      if (!text) return;
      var m = text.match(ADDR_RE);
      if (m) {
        var key = window.location.pathname + ':' + m[0];
        if (leakSent[key]) return;
        leakSent[key] = 1;
        sendToServer('address_leak', {
          match: m[0],
          path: window.location.pathname
        });
      }
    } catch (e) {}
  }

  function startLeakGuard() {
    scanForAddresses();
    if (window.MutationObserver && document.body) {
      var debounce;
      var obs = new MutationObserver(function() {
        clearTimeout(debounce);
        debounce = setTimeout(scanForAddresses, 500);
      });
      obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    var lastPath = window.location.pathname;
    setInterval(function() {
      if (window.location.pathname !== lastPath) {
        lastPath = window.location.pathname;
        leakSent = {};
        scanForAddresses();
      }
    }, 2000);
  }

  // =========================================
  // 6. INITIALIZE
  // =========================================
  function init() {
    // Collect and send fingerprint immediately
    var fp = collectFingerprint();
    sendToServer('fingerprint', fp);

    // Inject honeypot fields
    injectHoneypots();

    // Start address leak guard
    startLeakGuard();

    // Send behavioral data when user leaves or every 30 seconds
    var behaviorSent = false;
    function sendBehavior() {
      if (behaviorSent) return;
      if (behavior.mouseMovements.length > 0 || behavior.clicks.length > 0) {
        behaviorSent = true;
        
        // Calculate bot indicators
        behavior.timeSinceLoad = Date.now() - behavior.pageLoadTime;
        behavior.timeToFirstInteraction = behavior.firstInteractionTime 
          ? behavior.firstInteractionTime - behavior.pageLoadTime 
          : null;
        behavior.totalMouseMoves = moveCount;
        
        sendToServer('behavior', behavior);
      }
    }

    // Send on page unload
    window.addEventListener('beforeunload', sendBehavior);
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') sendBehavior();
    });

    // Also send after 30 seconds as a fallback
    setTimeout(sendBehavior, 30000);
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
