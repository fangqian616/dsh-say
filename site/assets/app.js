/* dsh-voice — site behaviour
   Three small things, no dependencies: the waveform that carries the page's
   idea, copy-to-clipboard for the commands, and a one-shot reveal on scroll. */

(function () {
  'use strict'

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /* ── the waveform ───────────────────────────────────────────────
     A signal, not decoration: several partials summed, with a playhead
     sweeping it and the amplitude swelling near the cursor. The point is that
     a voice project should show its subject rather than describe it. */

  function startWave() {
    var canvas = document.getElementById('wave')
    if (!canvas || !canvas.getContext) return

    var ctx = canvas.getContext('2d')
    var w = 0
    var h = 0
    var dpr = Math.min(window.devicePixelRatio || 1, 2)
    var pointer = { x: -1, y: -1, inside: false }
    var phase = 0
    var playhead = 0

    function resize() {
      var rect = canvas.getBoundingClientRect()
      w = rect.width
      h = rect.height
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    function amplitudeAt(x) {
      var base = 0.42
      if (!pointer.inside) return base
      // Swell around the cursor, and only a little: the page stays calm.
      var d = Math.abs(x - pointer.x) / (w * 0.16)
      return base + 0.5 * Math.exp(-d * d)
    }

    function draw() {
      ctx.clearRect(0, 0, w, h)
      var mid = h / 2

      // The envelope: a quiet guide showing where the loudness is.
      ctx.beginPath()
      for (var x = 0; x <= w; x += 3) {
        var a = amplitudeAt(x)
        var env = (h * 0.46) * a
        ctx.lineTo(x, mid - env)
      }
      for (var x2 = w; x2 >= 0; x2 -= 3) {
        ctx.lineTo(x2, mid + (h * 0.46) * amplitudeAt(x2))
      }
      ctx.closePath()
      ctx.fillStyle = 'rgba(37, 99, 235, 0.055)'
      ctx.fill()

      // The signal itself: three partials so it reads as a waveform, not a sine.
      ctx.beginPath()
      for (var px = 0; px <= w; px += 2) {
        var t = px / w
        var amp = amplitudeAt(px) * (h * 0.34)
        var y =
          mid +
          amp *
            (Math.sin(t * 26 + phase) * 0.55 +
              Math.sin(t * 61 + phase * 1.7) * 0.28 +
              Math.sin(t * 131 + phase * 2.3) * 0.17)
        if (px === 0) ctx.moveTo(px, y)
        else ctx.lineTo(px, y)
      }
      var gradient = ctx.createLinearGradient(0, 0, w, 0)
      gradient.addColorStop(0, 'rgba(37, 99, 235, 0.15)')
      gradient.addColorStop(0.5, 'rgba(27, 63, 143, 0.9)')
      gradient.addColorStop(1, 'rgba(37, 99, 235, 0.15)')
      ctx.strokeStyle = gradient
      ctx.lineWidth = 1.6
      ctx.lineJoin = 'round'
      ctx.stroke()

      // The playhead, mute while the pointer is elsewhere.
      var headX = playhead * w
      ctx.beginPath()
      ctx.moveTo(headX, mid - h * 0.5)
      ctx.lineTo(headX, mid + h * 0.5)
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.28)'
      ctx.lineWidth = 1
      ctx.stroke()

      var headY =
        mid +
        amplitudeAt(headX) *
          (h * 0.34) *
          (Math.sin((headX / w) * 26 + phase) * 0.55 +
            Math.sin((headX / w) * 61 + phase * 1.7) * 0.28 +
            Math.sin((headX / w) * 131 + phase * 2.3) * 0.17)
      ctx.beginPath()
      ctx.arc(headX, headY, 3.4, 0, Math.PI * 2)
      ctx.fillStyle = '#2563eb'
      ctx.fill()

      phase += 0.026
      playhead += 0.0016
      if (playhead > 1.04) playhead = -0.04
    }

    function loop() {
      draw()
      requestAnimationFrame(loop)
    }

    canvas.addEventListener('pointermove', function (event) {
      var rect = canvas.getBoundingClientRect()
      pointer.x = event.clientX - rect.left
      pointer.y = event.clientY - rect.top
      pointer.inside = true
    })
    canvas.addEventListener('pointerleave', function () {
      pointer.inside = false
    })

    window.addEventListener('resize', resize)
    resize()

    if (reduced) {
      // One static frame: the idea still reads, the motion does not demand attention.
      pointer.inside = false
      draw()
      return
    }
    loop()
  }

  /* ── copy a command ───────────────────────────────────────────── */

  function startCopy() {
    document.querySelectorAll('.cmd[data-copy]').forEach(function (block) {
      var button = block.querySelector('.copy')
      if (!button) return
      var label = button.querySelector('.zh')
      var original = label ? label.textContent : ''

      button.addEventListener('click', function () {
        var text = block.getAttribute('data-copy')
        var done = function () {
          button.setAttribute('data-done', '')
          if (label) label.textContent = '已复制'
          window.setTimeout(function () {
            button.removeAttribute('data-done')
            if (label) label.textContent = original
          }, 1600)
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, done)
          return
        }
        var scratch = document.createElement('textarea')
        scratch.value = text
        scratch.setAttribute('readonly', '')
        scratch.style.position = 'fixed'
        scratch.style.opacity = '0'
        document.body.appendChild(scratch)
        scratch.select()
        try { document.execCommand('copy') } catch (error) { /* nothing to do */ }
        document.body.removeChild(scratch)
        done()
      })
    })
  }

  /* ── reveal once, on scroll ───────────────────────────────────── */

  function startReveal() {
    var targets = document.querySelectorAll('.section, .wave-band')
    if (!targets.length) return

    if (reduced || !('IntersectionObserver' in window)) {
      targets.forEach(function (node) { node.classList.add('in') })
      return
    }

    targets.forEach(function (node) { node.classList.add('reveal') })
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return
          entry.target.classList.add('in')
          observer.unobserve(entry.target)
        })
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    )
    targets.forEach(function (node) { observer.observe(node) })
  }

  function boot() {
    startWave()
    startCopy()
    startReveal()
    // Stagger the entrance rather than animating everything at once.
    document.querySelectorAll('.hero-copy > *').forEach(function (node, index) {
      node.classList.add('rise')
      node.style.setProperty('--d', String(90 * index) + 'ms')
    })
    window.requestAnimationFrame(function () {
      document.body.classList.add('ready')
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
