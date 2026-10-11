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

/** Audio uploads are saved as a plain link; the viewer turns them into a player. */
export const AUDIO_NAME_RE = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)$/i;

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
 * speed chip, and a dusk placeholder when the file can't load (offline).
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
  return `${selector} .zf-media { position: relative; margin: 8px 0 12px; border: 1px solid ${edge}; border-radius: 20px; background: ${fill}; overflow: hidden; -webkit-tap-highlight-color: transparent; } ${selector} .zf-media audio, ${selector} .zf-media video { display: block; } ${selector} .zf-media.zf-audio { display: flex; align-items: center; gap: 12px; padding: 12px 14px; } ${selector} .zf-media.zf-audio audio { display: none; } ${selector} .zf-play { flex: none; width: 46px; height: 46px; border: 0; border-radius: 50%; background: ${link}; color: ${ink}; display: flex; align-items: center; justify-content: center; padding: 0; box-shadow: 0 0 0 5px ${edge}; } ${selector} .zf-play svg { width: 20px; height: 20px; fill: currentColor; } ${selector} .zf-play .zf-pause, ${selector} .zf-media.zf-on .zf-play .zf-go-play { display: none; } ${selector} .zf-media.zf-on .zf-play .zf-pause { display: block; } ${selector} .zf-mid { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; } ${selector} .zf-wave { display: flex; align-items: center; gap: 2px; height: 30px; touch-action: none; } ${selector} .zf-wave i { flex: 1; min-width: 2px; border-radius: 2px; background: ${bar}; } ${selector} .zf-wave i.zf-hit { background: ${link}; } ${selector} .zf-meta { display: flex; justify-content: space-between; font-size: 12px; color: ${muted}; font-variant-numeric: tabular-nums; } ${selector} .zf-speed { flex: none; width: 54px; text-align: center; box-sizing: border-box; border: 1px solid ${edge}; border-radius: 999px; background: transparent; color: ${fg}; font: inherit; font-size: 12px; font-weight: 600; padding: 4px 0; font-variant-numeric: tabular-nums; } ${selector} .zf-media.zf-video { background: #1c1917; border-color: transparent; } ${selector} .zf-media.zf-video video { width: 100%; max-height: 320px; border-radius: 0; background: #1c1917; } ${selector} .zf-vplay { position: absolute; left: 50%; top: 50%; margin: -29px 0 0 -29px; width: 58px; height: 58px; } ${selector} .zf-media.zf-on .zf-vplay { opacity: 0; } ${selector} .zf-vbar { display: flex; align-items: center; gap: 10px; padding: 8px 12px 10px; color: #fff; font-size: 12px; font-variant-numeric: tabular-nums; background: linear-gradient(0deg, rgba(0,0,0,0.65), rgba(0,0,0,0)); position: absolute; left: 0; right: 0; bottom: 0; } ${selector} .zf-track { flex: 1; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.3); touch-action: none; } ${selector} .zf-track b { display: block; height: 100%; width: 0; border-radius: 3px; background: ${link}; } ${selector} .zf-expand { border: 0; background: transparent; color: #fff; padding: 2px; display: flex; } ${selector} .zf-expand svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; } ${selector} .zf-off { display: flex; align-items: center; gap: 12px; margin: 8px 0 12px; padding: 14px; border: 1px dashed ${edge}; border-radius: 20px; background: ${fill}; color: ${muted}; } ${selector} .zf-off svg { flex: none; width: 34px; height: 34px; fill: none; stroke: ${link}; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; } ${selector} .zf-off b { display: block; color: ${fg}; font-size: 14px; } ${selector} .zf-off span { font-size: 13px; }`;
}

/**
 * Injected into the read-only viewer. `offline` swaps audio/video for the dusk
 * placeholder up front; any media (images too) that fails to load gets it, and
 * tapping it retries. Images and videos report a tap so RN can open a zoomable
 * viewer.
 */
export function mediaPlayerScript(opts: {
  offline: boolean;
  labels: { title: string; hint: string; retry: string };
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
      dusk: '<svg viewBox="0 0 24 24"><line x1="3" y1="18" x2="21" y2="18"/><path d="M7 18a5 5 0 0 1 10 0"/><line x1="5" y1="5" x2="19" y2="14"/></svg>'
    };
    function post(o) { window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
    function fmt(s) {
      if (!isFinite(s) || s < 0) s = 0;
      var m = Math.floor(s / 60), r = Math.floor(s % 60);
      return m + ':' + (r < 10 ? '0' : '') + r;
    }
    function place(el, node) { el.parentNode.insertBefore(node, el); }
    function placeholder(el, anchor) {
      anchor = anchor || el;
      var box = document.createElement('div');
      box.className = 'zf-off';
      box.innerHTML = ICON.dusk + '<div><b>' + L.title + '</b><span>' + (OFFLINE ? L.hint : L.retry) + '</span></div>';
      place(anchor, box);
      anchor.style.display = 'none';
      box.addEventListener('click', function() {
        if (OFFLINE) return;
        box.remove();
        anchor.style.display = '';
        el.addEventListener('error', function() { placeholder(el, anchor); }, { once: true });
        if (el.load) el.load(); else { var s = el.src; el.src = ''; el.src = s; }
      });
    }
    var current = null;
    function only(el) { if (current && current !== el) current.pause(); current = el; }
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
    // The editor stores an audio upload as a link to the file (like any document); play it here.
    var AUDIO_NAME = ${AUDIO_NAME_RE.toString()};
    document.querySelectorAll('#note p').forEach(function(p) {
      var links = p.querySelectorAll('a');
      if (links.length !== 1 || p.textContent.trim() !== links[0].textContent.trim()) return;
      var href = links[0].getAttribute('href') || '';
      if (!/\\/files\\/[^/?#]+\\?/.test(href) || !AUDIO_NAME.test(links[0].textContent.trim())) return;
      var el = document.createElement('audio');
      el.src = href;
      el.setAttribute('controls', '');
      p.parentNode.replaceChild(el, p);
    });
    document.querySelectorAll('#note audio').forEach(function(a) {
      if (OFFLINE) return placeholder(a);
      a.removeAttribute('controls');
      a.preload = 'metadata';
      var N = 38, bars = '';
      for (var i = 0; i < N; i++) bars += '<i style="height:' + Math.round(22 + 78 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6))) + '%"></i>';
      var box = document.createElement('div');
      box.className = 'zf-media zf-audio';
      box.innerHTML = '<button class="zf-play" aria-label="Play">' + ICON.play + '</button><div class="zf-mid"><div class="zf-wave">' + bars + '</div><div class="zf-meta"><span class="zf-cur">0:00</span><span class="zf-dur">--:--</span></div></div><button class="zf-speed">1x</button>';
      place(a, box);
      box.appendChild(a);
      var wave = box.querySelector('.zf-wave'), cur = box.querySelector('.zf-cur'), dur = box.querySelector('.zf-dur'), spd = box.querySelector('.zf-speed');
      var hits = wave.querySelectorAll('i');
      function paint() {
        var p = a.duration ? a.currentTime / a.duration : 0;
        for (var i = 0; i < hits.length; i++) hits[i].className = i < Math.round(p * hits.length) ? 'zf-hit' : '';
        cur.textContent = fmt(a.currentTime);
      }
      box.querySelector('.zf-play').addEventListener('click', function() { if (a.paused) { only(a); a.play(); } else a.pause(); });
      a.addEventListener('play', function() { box.classList.add('zf-on'); });
      a.addEventListener('pause', function() { box.classList.remove('zf-on'); });
      a.addEventListener('ended', function() { box.classList.remove('zf-on'); a.currentTime = 0; paint(); });
      a.addEventListener('timeupdate', paint);
      a.addEventListener('loadedmetadata', function() { dur.textContent = fmt(a.duration); });
      a.addEventListener('error', function() { placeholder(a, box); });
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
      function toggle() { if (v.paused) { only(v); v.play(); } else v.pause(); }
      box.querySelector('.zf-vplay').addEventListener('click', toggle);
      v.addEventListener('click', toggle);
      v.addEventListener('play', function() { box.classList.add('zf-on'); });
      v.addEventListener('pause', function() { box.classList.remove('zf-on'); });
      v.addEventListener('timeupdate', function() { cur.textContent = fmt(v.currentTime); fill.style.width = (v.duration ? v.currentTime / v.duration * 100 : 0) + '%'; });
      v.addEventListener('error', function() { placeholder(v, box); });
      box.querySelector('.zf-expand').addEventListener('click', function() { v.pause(); post({ type: ${JSON.stringify(MEDIA_OPEN_MESSAGE)}, kind: 'video', src: v.currentSrc || v.src }); });
      drag(track, v);
    });
    document.querySelectorAll('#note img').forEach(function(img) {
      // Injected after load, so a failure may already have happened.
      if (img.complete && img.naturalWidth === 0) return placeholder(img);
      img.addEventListener('error', function() { placeholder(img); });
      img.addEventListener('click', function() { post({ type: ${JSON.stringify(MEDIA_OPEN_MESSAGE)}, kind: 'image', src: img.currentSrc || img.src }); });
    });
  })();
`;
}
