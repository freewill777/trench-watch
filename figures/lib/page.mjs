export function wrapFigure({ k, plate, backHref, styleNote }) {
  return `<script>if (location.search.indexOf("sim=1") >= 0) document.documentElement.classList.add("sim");</script>
  <style>
    .back { margin: 0 0 18px; }
    .back a { color: inherit; }
    .joint-note { margin: 18px 0 0; max-width: 68ch; }
    html.sim, html.sim body { margin: 0; height: 100%; background: #070806; overflow: hidden; }
    html.sim .iso-page { width: 100%; max-width: none; height: 100%; margin: 0; }
    html.sim .back, html.sim .joint-note, html.sim .iso-legend, html.sim .iso-plate-corners { display: none; }
    html.sim .iso-figure, html.sim .iso-plate, html.sim .iso-stage { height: 100%; margin: 0; }
    html.sim .iso-plate { padding: 0; background: transparent; box-shadow: none; }
    html.sim .iso-svg { display: block; width: 100%; height: 100%; }
  </style>
  <p class="back"><a href="${backHref}">All structures</a></p>
  ${plate}
  <p class="joint-note" data-reason>${styleNote || ""}</p>`;
}
