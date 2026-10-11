// Pure (no React Native imports) so it runs under the unit-test config.

export const MEDIA_OPEN_MESSAGE = "zenflow-open-media";

export interface OpenMedia {
  kind: "image" | "video";
  src: string;
}

/** Signed file links from `/files/:id?sig=…`: embeds, not web pages to unfurl. */
export function isFileUrl(url: string): boolean {
  return /\/files\/[^/?#]+\?/.test(url);
}

/** Audio and video uploads are saved as a plain link; the viewer turns them into a player. */
export const AUDIO_NAME_RE = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)$/i;
export const VIDEO_NAME_RE = /\.(mp4|m4v|mov|webm|ogv|3gp)$/i;

/** A media tap posted by `mediaPlayerScript`; null for any other message. */
export function parseOpenMediaMessage(raw: string): OpenMedia | null {
  try {
    const d = JSON.parse(raw) as { type?: string; kind?: string; src?: string };
    if (
      d.type === MEDIA_OPEN_MESSAGE &&
      (d.kind === "image" || d.kind === "video") &&
      typeof d.src === "string"
    ) {
      return { kind: d.kind, src: d.src };
    }
  } catch {
    // not ours
  }
  return null;
}

/**
 * Read-only view: audio and video get a Zenflow player instead of the browser's
 * default controls: a sunrise-orange play disc, a waveform you can scrub, a
 * speed chip, and a per-type placeholder when the file can't load (offline): a grey
 * image box, a disabled player with its waveform, a dark video box with a disabled play button.
 */
export function noteMediaCss(
  selector: string,
  isDark: boolean,
  { fg, muted, link }: { fg: string; muted: string; link: string },
) {
  const fill = isDark ? "rgba(255,255,255,0.05)" : "rgba(255,142,62,0.07)";
  const edge = isDark ? "rgba(255,150,80,0.30)" : "rgba(255,142,62,0.32)";
  const bar = isDark ? "rgba(255,255,255,0.22)" : "rgba(28,25,23,0.18)";
  const ink = isDark ? "rgb(29 26 23)" : "#fff";
  return `${selector} .zf-media { position: relative; margin: 8px 0 12px; border: 1px solid ${edge}; border-radius: 20px; background: ${fill}; overflow: hidden; -webkit-tap-highlight-color: transparent; } ${selector} .zf-media audio, ${selector} .zf-media video { display: block; } ${selector} .zf-media.zf-audio { display: flex; align-items: center; gap: 12px; padding: 12px 14px; } ${selector} .zf-media.zf-audio audio { display: none; } ${selector} .zf-play { flex: none; width: 52px; height: 52px; border: 0; border-radius: 50%; background: ${link}; color: ${ink}; display: flex; align-items: center; justify-content: center; padding: 0; box-shadow: 0 0 0 5px ${edge}; } ${selector} .zf-play svg { width: 28px; height: 28px; fill: currentColor; } ${selector} .zf-play .zf-pause, ${selector} .zf-media.zf-on .zf-play .zf-go-play { display: none; } ${selector} .zf-media.zf-on .zf-play .zf-pause { display: block; } ${selector} .zf-mid { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; } ${selector} .zf-wave { display: flex; align-items: center; height: 16px; touch-action: none; } ${selector} .zf-ptrack { flex: 1; height: 6px; border-radius: 3px; background: ${bar}; overflow: hidden; } ${selector} .zf-ptrack b { display: block; height: 100%; width: 0; border-radius: 3px; background: ${link}; } ${selector} .zf-meta { display: flex; justify-content: space-between; font-size: 12px; color: ${muted}; font-variant-numeric: tabular-nums; } ${selector} .zf-speed { flex: none; width: 54px; text-align: center; box-sizing: border-box; border: 1px solid ${edge}; border-radius: 999px; background: transparent; color: ${fg}; font: inherit; font-size: 12px; font-weight: 600; padding: 4px 0; font-variant-numeric: tabular-nums; } ${selector} .zf-media.zf-video { background: #1c1917; border-color: transparent; } ${selector} .zf-media.zf-video video { width: 100%; max-height: 320px; border-radius: 0; background: #1c1917; } ${selector} .zf-vplay { position: absolute; left: 50%; top: 50%; margin: -29px 0 0 -29px; width: 58px; height: 58px; } ${selector} .zf-media.zf-on .zf-vplay { opacity: 0; } ${selector} .zf-vbar { display: flex; align-items: center; gap: 10px; padding: 8px 12px 10px; color: #fff; font-size: 12px; font-variant-numeric: tabular-nums; background: linear-gradient(0deg, rgba(0,0,0,0.65), rgba(0,0,0,0)); position: absolute; left: 0; right: 0; bottom: 0; } ${selector} .zf-track { flex: 1; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.3); touch-action: none; } ${selector} .zf-track b { display: block; height: 100%; width: 0; border-radius: 3px; background: ${link}; } ${selector} .zf-expand { border: 0; background: transparent; color: #fff; padding: 2px; display: flex; } ${selector} .zf-expand svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; } ${selector} .zf-ph { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; box-sizing: border-box; width: 100%; height: 170px; margin: 8px 0 12px; border-radius: 12px; background: rgba(128,128,128,0.18); color: ${muted}; } ${selector} .zf-ph > svg { width: 40px; height: 40px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; } ${selector} .zf-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: ${muted}; } ${selector} .zf-tag svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; } ${selector} .zf-dead button { opacity: 0.45; } ${selector} .zf-dead.zf-audio { padding-top: 28px; } ${selector} .zf-dead.zf-audio .zf-tag { position: absolute; top: 8px; right: 14px; } ${selector} .zf-poster { display: flex; align-items: center; justify-content: center; height: 190px; color: rgba(255,255,255,0.3); } ${selector} .zf-dead.zf-video .zf-tag { position: absolute; left: 12px; bottom: 10px; color: #fff; } ${selector} .zf-docwrap { margin: 8px 0 12px; } ${selector} a.zf-doc { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid ${edge}; border-radius: 16px; background: ${fill}; color: ${fg}; text-decoration: none; } ${selector} a.zf-doc.zf-dead { opacity: 0.6; } ${selector} .zf-ft { position: relative; flex: none; width: 40px; height: 48px; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 9px; box-sizing: border-box; } ${selector} .zf-ft svg { position: absolute; inset: 0; width: 40px; height: 48px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; } ${selector} .zf-ft b { position: relative; font-size: 10px; font-weight: 800; letter-spacing: 0.3px; } ${selector} .zf-dn { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; } ${selector} .zf-dname { font-weight: 600; font-size: 15px; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; } ${selector} .zf-dsub { font-size: 12px; color: ${muted}; } ${selector} .zf-dgo { flex: none; color: ${muted}; display: flex; } ${selector} .zf-dgo svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; } ${selector} .zf-off { display: flex; align-items: center; gap: 12px; margin: 8px 0 12px; padding: 14px; border: 1px dashed ${edge}; border-radius: 20px; background: ${fill}; color: ${muted}; } ${selector} .zf-off svg { flex: none; width: 34px; height: 34px; fill: none; stroke: ${link}; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; } ${selector} .zf-off b { display: block; color: ${fg}; font-size: 14px; } ${selector} .zf-off span { font-size: 13px; }`;
}

/**
 * Injected into the read-only viewer. `offline` swaps audio/video for the dusk
 * placeholder up front; any media (images too) that fails to load gets it, and
 * tapping it retries. Images and videos report a tap so RN can open a zoomable
 * viewer.
 */
export function mediaPlayerScript(opts: {
  offline: boolean;
  labels: { offline: string; failed: string };
}) {
  return `
  (function() {
    if (window.__zenflowMediaBound) return;
    window.__zenflowMediaBound = true;
    var OFFLINE = ${JSON.stringify(opts.offline)};
    var L = ${JSON.stringify(opts.labels)};
    var ICON = {
      play: '<svg class="zf-go-play" viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg><svg class="zf-pause" viewBox="0 0 24 24"><rect x="6" y="5" width="4.5" height="14" rx="1.5"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.5"/></svg>',
      expand: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
      image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>',
      file: '<svg viewBox="0 0 40 48"><path d="M8 2h16l10 10v32a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3z"/><path d="M24 2v10h10"/></svg>',
      down: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>',
      cloud: '<svg viewBox="0 0 24 24"><path d="M7.5 18.5h9.2a4 4 0 0 0 1-7.9 6 6 0 0 0-10.9-1.1A4.5 4.5 0 0 0 7.5 18.5z"/><line x1="4" y1="4" x2="20" y2="20"/></svg>'
    };
    function post(o) { window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
    function fmt(s) {
      if (!isFinite(s) || s < 0) s = 0;
      var m = Math.floor(s / 60), r = Math.floor(s % 60);
      return m + ':' + (r < 10 ? '0' : '') + r;
    }
    var DOC_COLORS = { pdf: '#E5484D', doc: '#2F6FEB', docx: '#2F6FEB', rtf: '#2F6FEB', odt: '#2F6FEB', xls: '#17A34A', xlsx: '#17A34A', csv: '#17A34A', ods: '#17A34A', ppt: '#F76808', pptx: '#F76808', key: '#F76808', zip: '#8B6F47', rar: '#8B6F47', '7z': '#8B6F47', txt: '#6B7280', md: '#6B7280' };
    function esc(x) { return String(x).replace(/[&<>"]/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
    // A document is a card, not a bare link: a file-type tile, its name, a download glyph.
    function docCard(p, a, name) {
      var m = /\\.([A-Za-z0-9]{1,5})$/.exec(name);
      var ext = m ? m[1].toLowerCase() : '';
      var color = DOC_COLORS[ext] || '#8A8178';
      var wrap = document.createElement('div');
      wrap.className = 'zf-docwrap';
      a.className = 'zf-doc' + (OFFLINE ? ' zf-dead' : '');
      a.innerHTML = '<span class="zf-ft" style="color:' + color + '">' + ICON.file + '<b>' + esc((ext || 'file').toUpperCase().slice(0, 4)) + '</b></span><span class="zf-dn"><span class="zf-dname">' + esc(name) + '</span>' + (OFFLINE ? tag() : '') + '</span><span class="zf-dgo">' + ICON.down + '</span>';
      wrap.appendChild(a);
      p.parentNode.replaceChild(wrap, p);
    }
    function place(el, node) { el.parentNode.insertBefore(node, el); }
    function tag() { return '<span class="zf-tag">' + ICON.cloud + (OFFLINE ? L.offline : L.failed) + '</span>'; }
    // A progress bar rather than a waveform: the audio isn't analysed, so a wave would be made up.
    function audioHtml() {
      return '<button class="zf-play" aria-label="Play">' + ICON.play + '</button><div class="zf-mid"><div class="zf-wave"><div class="zf-ptrack"><b></b></div></div><div class="zf-meta"><span class="zf-cur">0:00</span><span class="zf-dur">--:--</span></div></div><button class="zf-speed">1x</button>';
    }
    // Same shape as the real thing, so the note doesn't jump when it loads: a grey
    // image box, the audio card with a dead play button, a video poster with a dead play button.
    function placeholder(el, anchor) {
      anchor = anchor || el;
      // One placeholder per media element: repeated error events must not stack them.
      if (anchor.__zfBox) return;
      var kind = el.tagName.toLowerCase();
      var box = document.createElement('div');
      if (kind === 'audio') {
        box.className = 'zf-media zf-audio zf-dead';
        box.innerHTML = audioHtml() + tag();
      } else if (kind === 'video') {
        box.className = 'zf-media zf-video zf-dead';
        box.innerHTML = '<div class="zf-poster"></div><button class="zf-play zf-vplay" aria-label="Play">' + ICON.play + '</button>' + tag();
      } else {
        box.className = 'zf-ph';
        box.innerHTML = ICON.image + tag();
      }
      box.querySelectorAll('button').forEach(function(b) { b.disabled = true; });
      place(anchor, box);
      anchor.__zfBox = box;
      anchor.style.display = 'none';
      box.addEventListener('click', function() {
        if (OFFLINE) return;
        box.remove();
        anchor.__zfBox = null;
        anchor.style.display = '';
        el.addEventListener('error', function() { placeholder(el, anchor); }, { once: true });
        if (el.load) el.load(); else { var s = el.src; el.src = ''; el.src = s; }
      });
    }
    var current = null;
    function only(el) { if (current && current !== el) current.pause(); current = el; }
    // play() rejects (not throws) when the file can't start; the error event shows the placeholder.
    function start(el) { only(el); var r = el.play(); if (r && r.catch) r.catch(function() {}); }
    function seekFrom(e, node, media) {
      var r = node.getBoundingClientRect();
      var p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      if (isFinite(media.duration)) media.currentTime = p * media.duration;
    }
    function drag(node, media) {
      var down = false;
      node.addEventListener('pointerdown', function(e) { down = true; seekFrom(e, node, media); });
      node.addEventListener('pointermove', function(e) { if (down) seekFrom(e, node, media); });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function(n) { node.addEventListener(n, function() { down = false; }); });
    }
    // The editor stores an audio/video upload as a link to the file (like any document); play it here.
    var AUDIO_NAME = ${AUDIO_NAME_RE.toString()};
    var VIDEO_NAME = ${VIDEO_NAME_RE.toString()};
    document.querySelectorAll('#note p').forEach(function(p) {
      var links = p.querySelectorAll('a');
      if (links.length !== 1 || p.textContent.trim() !== links[0].textContent.trim()) return;
      var href = links[0].getAttribute('href') || '';
      var name = links[0].textContent.trim();
      if (!/\\/files\\/[^/?#]+\\?/.test(href)) return;
      var kind = AUDIO_NAME.test(name) ? 'audio' : VIDEO_NAME.test(name) ? 'video' : '';
      if (!kind) return docCard(p, links[0], name);
      var el = document.createElement(kind);
      el.src = href;
      el.setAttribute('controls', '');
      p.parentNode.replaceChild(el, p);
    });
    document.querySelectorAll('#note audio').forEach(function(a) {
      if (OFFLINE) return placeholder(a);
      a.removeAttribute('controls');
      a.preload = 'metadata';
      var box = document.createElement('div');
      box.className = 'zf-media zf-audio';
      box.innerHTML = audioHtml();
      place(a, box);
      box.appendChild(a);
      var wave = box.querySelector('.zf-wave'), cur = box.querySelector('.zf-cur'), dur = box.querySelector('.zf-dur'), spd = box.querySelector('.zf-speed');
      var fill = wave.querySelector('b');
      function paint() {
        var p = a.duration ? a.currentTime / a.duration : 0;
        fill.style.width = (p * 100) + '%';
        cur.textContent = fmt(a.currentTime);
      }
      box.querySelector('.zf-play').addEventListener('click', function() { if (a.paused) start(a); else a.pause(); });
      a.addEventListener('play', function() { box.classList.add('zf-on'); });
      a.addEventListener('pause', function() { box.classList.remove('zf-on'); });
      a.addEventListener('ended', function() { box.classList.remove('zf-on'); a.currentTime = 0; paint(); });
      a.addEventListener('timeupdate', paint);
      a.addEventListener('loadedmetadata', function() { dur.textContent = fmt(a.duration); });
      a.addEventListener('error', function() { if (a.error) placeholder(a, box); });
      var rates = [1, 1.25, 1.5, 2], ri = 0;
      spd.addEventListener('click', function() { ri = (ri + 1) % rates.length; a.playbackRate = rates[ri]; spd.textContent = rates[ri] + 'x'; });
      drag(wave, a);
    });
    document.querySelectorAll('#note video').forEach(function(v) {
      if (OFFLINE) return placeholder(v);
      v.removeAttribute('controls');
      v.setAttribute('playsinline', '');
      v.preload = 'none';
      var box = document.createElement('div');
      box.className = 'zf-media zf-video';
      place(v, box);
      box.appendChild(v);
      box.insertAdjacentHTML('beforeend', '<button class="zf-play zf-vplay" aria-label="Play">' + ICON.play + '</button><div class="zf-vbar"><span class="zf-cur">0:00</span><div class="zf-track"><b></b></div><button class="zf-expand" aria-label="Expand">' + ICON.expand + '</button></div>');
      var cur = box.querySelector('.zf-cur'), fill = box.querySelector('.zf-track b'), track = box.querySelector('.zf-track');
      function toggle() { if (v.paused) start(v); else v.pause(); }
      box.querySelector('.zf-vplay').addEventListener('click', toggle);
      v.addEventListener('click', toggle);
      v.addEventListener('play', function() { box.classList.add('zf-on'); });
      v.addEventListener('pause', function() { box.classList.remove('zf-on'); });
      v.addEventListener('timeupdate', function() { cur.textContent = fmt(v.currentTime); fill.style.width = (v.duration ? v.currentTime / v.duration * 100 : 0) + '%'; });
      v.addEventListener('error', function() { if (v.error) placeholder(v, box); });
      box.querySelector('.zf-expand').addEventListener('click', function() { v.pause(); post({ type: ${JSON.stringify(MEDIA_OPEN_MESSAGE)}, kind: 'video', src: v.currentSrc || v.src }); });
      drag(track, v);
    });
    document.querySelectorAll('#note img').forEach(function(img) {
      // Offline an image may still be in the WebView's cache; show the placeholder anyway.
      if (OFFLINE) return placeholder(img);
      // Injected after load, so a failure may already have happened.
      if (img.complete && img.naturalWidth === 0) return placeholder(img);
      img.addEventListener('error', function() { placeholder(img); });
      img.addEventListener('click', function() { post({ type: ${JSON.stringify(MEDIA_OPEN_MESSAGE)}, kind: 'image', src: img.currentSrc || img.src }); });
    });
  })();
`;
}
