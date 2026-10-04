/*
 * The scrub loop.
 *
 * Every hour's readout is already in the document; this script moves an index
 * and flips which one is visible. It formats nothing, fetches nothing and
 * judges nothing, which keeps it a view cursor and not a second copy of the
 * server's logic. It also copies the visible frame's text into the range
 * input's aria-valuetext so screen readers announce the same words.
 */
(function () {
  "use strict";

  document.querySelectorAll(".timeline").forEach(function (tl) {
    var frames = tl.querySelectorAll(".readout .ro-frame");
    var svg = tl.querySelector("svg.chart");
    var range = tl.querySelector(".scrubber");
    if (frames.length < 2 || !svg || !range) return;
    var head = svg.querySelector(".head");
    var n = frames.length;
    var cur = 0;
    var vbw = +svg.getAttribute("data-vbw");
    var x0 = +svg.getAttribute("data-x0");
    var x1 = +svg.getAttribute("data-x1");
    if (!(x1 > x0) || !vbw) return;

    function show(i) {
      i = i < 0 ? 0 : i > n - 1 ? n - 1 : i;
      if (i === cur) return;
      frames[cur].hidden = true;
      frames[i].hidden = false;
      cur = i;
      range.value = i;
      range.setAttribute(
        "aria-valuetext",
        (frames[i].textContent || "").replace(/\s+/g, " ").trim()
      );
      if (head) {
        head.setAttribute(
          "transform",
          "translate(" + ((x1 - x0) * (i / (n - 1))).toFixed(1) + " 0)"
        );
      }
    }

    function at(e) {
      var r = svg.getBoundingClientRect();
      if (!r.width) return;
      var vx = ((e.clientX - r.left) / r.width) * vbw;
      show(Math.round(((vx - x0) / (x1 - x0)) * (n - 1)));
    }

    // A vertical swipe that starts on the chart is a page scroll, and the
    // browser tells us so by cancelling the pointer. Waiting for real
    // horizontal movement before moving the readout keeps that scroll from
    // dragging the playhead along with it.
    var down = false;
    var moved = false;
    var startX = 0;
    svg.addEventListener("pointerdown", function (e) {
      down = true;
      moved = false;
      startX = e.clientX;
      try {
        svg.setPointerCapture(e.pointerId);
      } catch (err) {
        /* capture is best effort; the scrub still works without it */
      }
    });
    svg.addEventListener("pointermove", function (e) {
      if (!down) {
        if (e.pointerType === "mouse") at(e);
        return;
      }
      if (!moved && Math.abs(e.clientX - startX) < 3) return;
      moved = true;
      at(e);
    });
    svg.addEventListener("pointerup", function (e) {
      if (down && !moved) at(e);
      down = false;
    });
    svg.addEventListener("pointercancel", function () {
      down = false;
    });
    range.addEventListener("input", function () {
      show(+range.value);
    });
    tl.addEventListener("click", function (e) {
      if (e.target && e.target.classList && e.target.classList.contains("nowbtn")) show(0);
    });
  });
})();
