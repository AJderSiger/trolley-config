(function(){
  "use strict";

  /* ---------------- constants ---------------- */
  var SLOT_COUNT = 14;                 // total capacity in "Feldern" (SDU)
  var ROW_H = 25;                      // recomputed from the rendered rails-frame height (see updateRowH)
  var SIZE_LEN = { small:1, medium:2, large:3 };
  var WOOD_LEN = 1;
  var SIZE_NAMES = { small:'Klein', medium:'Mittel', large:'Gross' };

  var BASE_PRICE = 890;
  var SIZE_PRICE = { small:45, medium:65, large:95 };
  var WOOD_PRICE = 55;
  var ENGRAVE_PRICE = 35;

  var BLOCKLIST = [
    'hurensohn','fotze','wichser','nazi','hitler','neger','arsch','schlampe',
    'fuck','shit','bitch','nigger','cunt','whore','rape','kill'
  ];

  /* ---------------- state ---------------- */
  var drawers = {};          // id -> {id, kind:'metal'|'wood', size, start, len}
  var nextId = 1;
  var metalColor = null;     // 'bordeaux' | 'white' | 'black'
  var engraveText = '';
  var configId = generateConfigId();

  var drag = null;           // active pointer-drag payload
  var currentView = 'open';  // 'open' | 'closed'

  /* ---------------- dom refs ---------------- */
  var railsFrame = document.getElementById('railsFrame');
  var engravePreview = document.getElementById('engravePreview');
  var engravePreviewClosed = document.getElementById('engravePreviewClosed');
  var engraveInput = document.getElementById('engraveInput');
  var engraveWarn = document.getElementById('engraveWarn');
  var charCount = document.getElementById('charCount');
  var capFill = document.getElementById('capFill');
  var capUsedText = document.getElementById('capUsedText');
  var capPct = document.getElementById('capPct');
  var colorHint = document.getElementById('colorHint');
  var metalTilesWrap = document.getElementById('metalTiles');
  var woodTilesWrap = document.getElementById('woodTiles');
  var toast = document.getElementById('toast');
  var trashHint = document.getElementById('trashHint');
  var summaryRows = document.getElementById('summaryRows');
  var totalPriceEl = document.getElementById('totalPrice');
  var viewerSerial = document.getElementById('viewerSerial');
  var trolleyEl = document.getElementById('trolley');
  var trolleyPhoto = document.getElementById('trolleyPhoto');
  var trolleyPhotoWrap = document.getElementById('trolleyPhotoWrap');
  var toggleOpenBtn = document.getElementById('toggleOpenBtn');
  var toggleClosedBtn = document.getElementById('toggleClosedBtn');
  var viewerFootnote = document.getElementById('viewerFootnote');

  var VIEW_PHOTOS = {
    open:   { src:'assets/trolley-open.png',   ratio:'290 / 955', alt:'Original SWISS Trolley mit geöffneter Fronttür',
              footnote:'Echtfoto eines original SWISS Bordtrolleys bei geöffneter Fronttür. Abweichungen zwischen Darstellung und Endprodukt sind aus fertigungstechnischen Gründen möglich.' },
    closed: { src:'assets/trolley-closed.png', ratio:'277 / 949', alt:'Original SWISS Trolley mit geschlossener Fronttür und Gravurplakette',
              footnote:'Echtfoto eines original SWISS Bordtrolleys bei geschlossener Fronttür. Auf der Plakette erscheint deine Gravur.' }
  };

  function setView(view){
    currentView = view;
    trolleyEl.setAttribute('data-view', view);
    toggleOpenBtn.classList.toggle('active', view === 'open');
    toggleClosedBtn.classList.toggle('active', view === 'closed');
    var cfg = VIEW_PHOTOS[view];
    trolleyPhoto.src = cfg.src;
    trolleyPhoto.alt = cfg.alt;
    trolleyPhotoWrap.style.aspectRatio = cfg.ratio;
    viewerFootnote.textContent = cfg.footnote;
    if (view === 'open') renderDrawers();
  }

  toggleOpenBtn.addEventListener('click', function(){ setView('open'); });
  toggleClosedBtn.addEventListener('click', function(){ setView('closed'); });

  /* ---------------- helpers: occupancy ---------------- */
  function occupancyArray(excludeId){
    var arr = new Array(SLOT_COUNT).fill(false);
    Object.keys(drawers).forEach(function(id){
      if (id === String(excludeId)) return;
      var d = drawers[id];
      for (var i=d.start; i<d.start+d.len; i++) arr[i] = true;
    });
    return arr;
  }

  function usedSDU(){
    var s = 0;
    Object.keys(drawers).forEach(function(id){ s += drawers[id].len; });
    return s;
  }

  function runFits(occ, start, len){
    if (start < 0 || start+len > SLOT_COUNT) return false;
    for (var i=start; i<start+len; i++) if (occ[i]) return false;
    return true;
  }

  function findFirstFit(len){
    var occ = occupancyArray(null);
    for (var s=0; s<=SLOT_COUNT-len; s++){
      if (runFits(occ, s, len)) return s;
    }
    return -1;
  }

  function findNearestFit(len, preferredStart, excludeId){
    var occ = occupancyArray(excludeId);
    if (runFits(occ, preferredStart, len)) return preferredStart;
    for (var radius=1; radius<SLOT_COUNT; radius++){
      var down = preferredStart - radius;
      var up = preferredStart + radius;
      if (runFits(occ, down, len)) return down;
      if (runFits(occ, up, len)) return up;
    }
    return -1;
  }

  function generateConfigId(){
    return 'SW-' + Math.random().toString(36).slice(2,7).toUpperCase();
  }

  /* ---------------- toast ---------------- */
  var toastTimer = null;
  function showToast(title, body){
    document.getElementById('toastTitle').textContent = title;
    document.getElementById('toastBody').textContent = body;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toast.classList.remove('show'); }, 3200);
  }

  /* ---------------- color ---------------- */
  document.getElementById('colorRow').addEventListener('click', function(e){
    var sw = e.target.closest('.swatch');
    if (!sw) return;
    metalColor = sw.getAttribute('data-color');
    renderColorRow();
    renderMetalTiles();
    renderDrawers();
    renderSummary();
  });

  function renderColorRow(){
    document.querySelectorAll('#colorRow .swatch').forEach(function(sw){
      sw.classList.toggle('active', sw.getAttribute('data-color') === metalColor);
    });
    colorHint.style.display = metalColor ? 'none' : 'block';
  }

  function colorClass(color){
    return 'mat-metal-' + color;
  }

  var COLOR_NAMES = { bordeaux:'Bordeaux', white:'Weiss', black:'Schwarz' };

  /* ---------------- tiles (metal + wood) ---------------- */
  function renderMetalTiles(){
    metalTilesWrap.innerHTML = '';
    ['small','medium','large'].forEach(function(size){
      var count = countBy('metal', size);
      var disabled = !metalColor;
      var tile = document.createElement('div');
      tile.className = 'tile' + (disabled ? ' disabled' : '');
      tile.setAttribute('data-kind', 'metal');
      tile.setAttribute('data-size', size);
      tile.innerHTML =
        '<div class="swatch-chip ' + (metalColor ? colorClass(metalColor) : '') + '" style="' + (metalColor ? '' : 'background:repeating-linear-gradient(45deg,#ddd,#ddd 4px,#eee 4px,#eee 8px);') + '"></div>' +
        '<div class="info"><div class="name">' + SIZE_NAMES[size] + '</div><div class="sub">' + SIZE_LEN[size] + (SIZE_LEN[size]===1?' Feld':' Felder') + '</div><div class="price">+ CHF ' + SIZE_PRICE[size] + '.– / Stk.</div></div>' +
        '<div class="stepper">' +
          '<button class="minus" ' + (count===0?'disabled':'') + '>–</button>' +
          '<span class="count">' + count + '</span>' +
          '<button class="plus" ' + (disabled?'disabled':'') + '>+</button>' +
        '</div>';
      metalTilesWrap.appendChild(tile);

      tile.querySelector('.plus').addEventListener('click', function(ev){
        ev.stopPropagation();
        if (!metalColor){ showToast('Farbe fehlt','Bitte wähle zuerst eine Farbe für die Metallschubladen.'); return; }
        quickAdd('metal', size);
      });
      tile.querySelector('.minus').addEventListener('click', function(ev){
        ev.stopPropagation();
        quickRemove('metal', size);
      });

      if (!disabled){
        tile.addEventListener('pointerdown', function(ev){
          if (ev.target.closest('.stepper')) return;
          startDragFromPalette(ev, 'metal', size);
        });
      }
    });
  }

  function renderWoodTiles(){
    woodTilesWrap.innerHTML = '';
    var count = countBy('wood', null);
    var tile = document.createElement('div');
    tile.className = 'tile';
    tile.setAttribute('data-kind', 'wood');
    tile.innerHTML =
      '<div class="swatch-chip mat-wood"></div>' +
      '<div class="info"><div class="name">Holzplatte</div><div class="sub">' + WOOD_LEN + ' Felder</div><div class="price">+ CHF ' + WOOD_PRICE + '.– / Stk.</div></div>' +
      '<div class="stepper">' +
        '<button class="minus" ' + (count===0?'disabled':'') + '>–</button>' +
        '<span class="count">' + count + '</span>' +
        '<button class="plus">+</button>' +
      '</div>';
    woodTilesWrap.appendChild(tile);

    tile.querySelector('.plus').addEventListener('click', function(ev){
      ev.stopPropagation();
      quickAdd('wood', null);
    });
    tile.querySelector('.minus').addEventListener('click', function(ev){
      ev.stopPropagation();
      quickRemove('wood', null);
    });
    tile.addEventListener('pointerdown', function(ev){
      if (ev.target.closest('.stepper')) return;
      startDragFromPalette(ev, 'wood', null);
    });
  }

  function countBy(kind, size){
    var c = 0;
    Object.keys(drawers).forEach(function(id){
      var d = drawers[id];
      if (d.kind === kind && (size === null || d.size === size)) c++;
    });
    return c;
  }

  /* ---------------- add / remove ---------------- */
  function lenFor(kind, size){
    return kind === 'wood' ? WOOD_LEN : SIZE_LEN[size];
  }

  function quickAdd(kind, size){
    var len = lenFor(kind, size);
    var start = findFirstFit(len);
    if (start === -1){
      showToast('Trolley maximal ausgelastet', 'Für diese Schublade ist nicht mehr genügend Platz im Trolley vorhanden.');
      return;
    }
    createDrawer(kind, size, start, len);
  }

  function quickRemove(kind, size){
    var candidates = Object.keys(drawers).filter(function(id){
      var d = drawers[id];
      return d.kind === kind && (size === null || d.size === size);
    });
    if (!candidates.length) return;
    candidates.sort(function(a,b){ return Number(b) - Number(a); });
    delete drawers[candidates[0]];
    renderAll();
  }

  function createDrawer(kind, size, start, len){
    var id = nextId++;
    drawers[id] = { id:id, kind:kind, size:size, start:start, len:len };
    renderAll();
    return id;
  }

  /* ---------------- render trolley drawers ---------------- */
  function updateRowH(){
    var h = railsFrame.clientHeight;
    if (h > 0) ROW_H = h / SLOT_COUNT;
  }

  function ensureGuides(){
    if (railsFrame.querySelector('#dropPreview')) return;
    var preview = document.createElement('div');
    preview.className = 'drop-preview';
    preview.id = 'dropPreview';
    railsFrame.appendChild(preview);
  }

  function renderDrawers(){
    ensureGuides();
    updateRowH();
    // remove old drawer elements
    railsFrame.querySelectorAll('.drawer').forEach(function(el){ el.remove(); });

    Object.keys(drawers).forEach(function(id){
      var d = drawers[id];
      var el = document.createElement('div');
      el.className = 'drawer ' + materialClass(d);
      el.style.top = (d.start * ROW_H) + 'px';
      el.style.height = (d.len * ROW_H - 3) + 'px';
      el.setAttribute('data-id', d.id);
      el.innerHTML =
        '<div class="grip"><span></span><span></span><span></span></div>' +
        '<div class="label">' + labelFor(d) + '</div>' +
        '<button class="remove-btn" title="Entfernen">✕</button>';
      railsFrame.appendChild(el);

      el.querySelector('.remove-btn').addEventListener('click', function(ev){
        ev.stopPropagation();
        delete drawers[d.id];
        renderAll();
      });

      el.addEventListener('pointerdown', function(ev){
        if (ev.target.closest('.remove-btn')) return;
        startDragFromPlaced(ev, d.id);
      });
    });
  }

  function materialClass(d){
    if (d.kind === 'wood') return 'mat-wood';
    return colorClass(metalColor || 'bordeaux');
  }

  function labelFor(d){
    if (d.kind === 'wood') return 'Holz';
    return SIZE_NAMES[d.size];
  }

  /* ---------------- capacity ---------------- */
  function renderCapacity(){
    var used = usedSDU();
    var pct = Math.round((used / SLOT_COUNT) * 100);
    capFill.style.width = pct + '%';
    capFill.classList.remove('mid','full');
    if (pct >= 100) capFill.classList.add('full');
    else if (pct >= 65) capFill.classList.add('mid');
    capUsedText.textContent = used + ' von ' + SLOT_COUNT + ' Feldern belegt';
    capPct.textContent = pct + ' %';
  }

  /* ---------------- engraving ---------------- */
  function normalize(text){
    return text.toLowerCase()
      .replace(/0/g,'o').replace(/1/g,'i').replace(/3/g,'e')
      .replace(/4/g,'a').replace(/5/g,'s').replace(/7/g,'t')
      .replace(/[^a-zäöüß]/g,'');
  }

  function isBlocked(text){
    var n = normalize(text);
    if (!n) return false;
    return BLOCKLIST.some(function(word){ return n.indexOf(word) !== -1; });
  }

  engraveInput.addEventListener('input', function(){
    var raw = engraveInput.value;
    charCount.textContent = raw.length;
    if (isBlocked(raw)){
      engraveWarn.classList.add('show');
      return; // keep last valid engraveText, do not update preview
    }
    engraveWarn.classList.remove('show');
    engraveText = raw;
    renderEngrave();
    renderSummary();
  });

  function renderEngrave(){
    var isEmpty = engraveText.trim().length === 0;
    var text = isEmpty ? 'Deine Gravur' : engraveText;
    [engravePreview, engravePreviewClosed].forEach(function(el){
      el.textContent = text;
      el.classList.toggle('placeholder', isEmpty);
    });
  }

  /* ---------------- price & summary ---------------- */
  function computePrice(){
    var total = BASE_PRICE;
    Object.keys(drawers).forEach(function(id){
      var d = drawers[id];
      total += d.kind === 'wood' ? WOOD_PRICE : SIZE_PRICE[d.size];
    });
    if (engraveText.trim().length > 0) total += ENGRAVE_PRICE;
    return total;
  }

  function renderSummary(){
    var rows = [];
    rows.push(['Grundpreis Trolley', 'CHF ' + BASE_PRICE + '.–']);
    rows.push(['Farbe', metalColor ? COLOR_NAMES[metalColor] : '— nicht gewählt']);

    var metalCount = countBy('metal', 'small') + countBy('metal', 'medium') + countBy('metal', 'large');
    rows.push(['Metallschubladen', metalCount + ' Stk.']);

    var woodCount = countBy('wood', null);
    rows.push(['Holzplatten', woodCount + ' Stk.']);

    rows.push(['Gravur', engraveText.trim().length > 0 ? '"' + engraveText.trim() + '"' : '— keine']);
    rows.push(['Belegung', usedSDU() + ' / ' + SLOT_COUNT + ' Feldern']);

    summaryRows.innerHTML = rows.map(function(r){
      return '<div class="summary-row"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>';
    }).join('');

    totalPriceEl.textContent = computePrice() + '.–';
    viewerSerial.textContent = 'CONFIG-ID ' + configId;
  }

  document.getElementById('ctaBtn').addEventListener('click', function(){
    if (!metalColor && countBy('metal','small')+countBy('metal','medium')+countBy('metal','large') === 0 && countBy('wood',null) === 0){
      showToast('Fast geschafft', 'Wähle mindestens eine Farbe oder füge eine Schublade hinzu, bevor du anfragst.');
      return;
    }
    showToast('Anfrage vorbereitet', 'Konfiguration ' + configId + ' zu CHF ' + computePrice() + '.– — ein Verkaufsberater meldet sich in Kürze bei dir.');
  });

  /* ---------------- pointer drag: palette -> new drawer ---------------- */
  function startDragFromPalette(ev, kind, size){
    ev.preventDefault();
    var len = lenFor(kind, size);
    var colorCls = kind === 'wood' ? 'mat-wood' : colorClass(metalColor);
    var ghost = document.createElement('div');
    ghost.className = 'ghost-drawer ' + colorCls;
    ghost.style.width = '220px';
    ghost.style.height = (len*ROW_H - 3) + 'px';
    ghost.innerHTML = '<div class="label">' + (kind==='wood'?'Holz':SIZE_NAMES[size]) + '</div>';
    document.body.appendChild(ghost);

    drag = { source:'palette', kind:kind, size:size, len:len, ghost:ghost, drawerId:null };
    positionGhost(ev.clientX, ev.clientY);
    attachMoveHandlers();
  }

  /* ---------------- pointer drag: existing drawer -> reposition/remove ---------------- */
  function startDragFromPlaced(ev, id){
    ev.preventDefault();
    var d = drawers[id];
    if (!d) return;
    var srcEl = railsFrame.querySelector('.drawer[data-id="' + id + '"]');
    if (srcEl) srcEl.classList.add('dragging-source');

    var colorCls = materialClass(d);
    var ghost = document.createElement('div');
    ghost.className = 'ghost-drawer ' + colorCls;
    ghost.style.width = '220px';
    ghost.style.height = (d.len*ROW_H - 3) + 'px';
    ghost.innerHTML = '<div class="label">' + labelFor(d) + '</div>';
    document.body.appendChild(ghost);

    drag = { source:'placed', kind:d.kind, size:d.size, len:d.len, ghost:ghost, drawerId:id, srcEl:srcEl };
    positionGhost(ev.clientX, ev.clientY);
    attachMoveHandlers();
  }

  function positionGhost(x,y){
    if (!drag) return;
    drag.ghost.style.left = (x + 14) + 'px';
    drag.ghost.style.top = (y - drag.ghost.offsetHeight/2) + 'px';
  }

  function attachMoveHandlers(){
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
  }
  function detachMoveHandlers(){
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
  }

  function onDragMove(ev){
    if (!drag) return;
    positionGhost(ev.clientX, ev.clientY);

    var railsRect = railsFrame.getBoundingClientRect();
    var overRails = ev.clientX >= railsRect.left && ev.clientX <= railsRect.right &&
                     ev.clientY >= railsRect.top && ev.clientY <= railsRect.bottom;

    var preview = document.getElementById('dropPreview');

    if (overRails){
      trashHint.classList.remove('show');
      var relY = ev.clientY - railsRect.top;
      var idx = Math.round(relY / ROW_H - drag.len/2);
      idx = Math.max(0, Math.min(SLOT_COUNT - drag.len, idx));
      drag.hoverIdx = idx;

      var occ = occupancyArray(drag.drawerId);
      var valid = runFits(occ, idx, drag.len);
      preview.style.display = 'block';
      preview.style.top = (idx * ROW_H) + 'px';
      preview.style.height = (drag.len * ROW_H - 3) + 'px';
      preview.classList.toggle('valid', valid);
      preview.classList.toggle('invalid', !valid);
    } else {
      preview.style.display = 'none';
      drag.hoverIdx = null;
      if (drag.source === 'placed'){
        trashHint.classList.add('show', 'armed');
      }
    }
  }

  function onDragEnd(ev){
    if (!drag) return;
    var railsRect = railsFrame.getBoundingClientRect();
    var overRails = ev.clientX >= railsRect.left && ev.clientX <= railsRect.right &&
                     ev.clientY >= railsRect.top && ev.clientY <= railsRect.bottom;

    var preview = document.getElementById('dropPreview');
    preview.style.display = 'none';
    trashHint.classList.remove('show','armed');

    if (overRails && drag.hoverIdx !== null && drag.hoverIdx !== undefined){
      var fit = findNearestFit(drag.len, drag.hoverIdx, drag.drawerId);
      if (fit === -1){
        showToast('Trolley maximal ausgelastet', 'Für diese Schublade ist nicht mehr genügend Platz im Trolley vorhanden.');
      } else {
        if (drag.source === 'placed'){
          drawers[drag.drawerId].start = fit;
        } else {
          if (drag.kind === 'metal' && !metalColor){
            showToast('Farbe fehlt', 'Bitte wähle zuerst eine Farbe für die Metallschubladen.');
          } else {
            createDrawer(drag.kind, drag.size, fit, drag.len);
          }
        }
      }
    } else {
      // dropped outside trolley
      if (drag.source === 'placed'){
        delete drawers[drag.drawerId];
      }
      // palette drag dropped outside -> simply cancelled
    }

    if (drag.srcEl) drag.srcEl.classList.remove('dragging-source');
    drag.ghost.remove();
    drag = null;
    detachMoveHandlers();
    renderAll();
  }

  /* ---------------- reset ---------------- */
  document.getElementById('resetBtn').addEventListener('click', function(){
    drawers = {};
    metalColor = null;
    engraveText = '';
    engraveInput.value = '';
    charCount.textContent = '0';
    engraveWarn.classList.remove('show');
    configId = generateConfigId();
    renderAll();
  });

  /* ---------------- master render ---------------- */
  function renderAll(){
    renderColorRow();
    renderMetalTiles();
    renderWoodTiles();
    renderDrawers();
    renderCapacity();
    renderEngrave();
    renderSummary();
  }

  var resizeTimer = null;
  window.addEventListener('resize', function(){
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderDrawers, 120);
  });

  setView('open');
  renderAll();
})();
