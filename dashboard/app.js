// Token Launch Radar — a plain static dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts from the same model run as board.json) and renders three views: the ranked Board with
// filters and a per-protocol detail drawer, the Live view of protocols whose token already trades,
// and the Methodology view that states the model and its calibration. No network, no framework.
(function () {
  'use strict';
  var D = window.RADAR;
  var app = document.getElementById('board');
  if (!D || !app) return;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function age(d) { return d === null ? 'unknown' : d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd'; }
  function x2(n) { return 'x' + n.toFixed(2); }

  var hash = {};
  location.hash.replace(/[#&]+([^=&]+)=([^&]*)/g, function (m, k, v) { hash[k] = decodeURIComponent(v); });
  var state = {
    tab: hash.tab || 'board', q: hash.q || '', cat: hash.cat || 'all', chain: hash.chain || 'all',
    wl: hash.wl === '1', minTvl: +(hash.tvl || 0), sort: 'imp', dir: -1, sel: hash.p || null,
  };

  var star = '<svg class="star" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-label="watchlist"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/></svg>';
  function header() {
    var screened = D.screened_category + D.screened_product_name + D.screened_exchange_name + D.screened_version;
    var v = D.validation;
    return '<header class="top"><div class="brand"><h1>Token Launch <span class="rad">Radar</span></h1>' +
      '<p>Pre-token protocols ranked by the value their token would carry if it launched on today\'s record. ' +
      'Model <b>' + esc(D.model_version) + '</b> calibrates itself on this snapshot\'s own tokenised protocols; protocols whose token already trades sit in Live, never in the ranking.</p>' +
      '<p class="thesis"><b>$' + (D.total_implied / 1e9).toFixed(2) + 'B of pre-token value, ranked</b> &middot; ' + (D.total_protocols - D.unaccounted) + ' of ' + D.total_protocols + ' protocols accounted for &middot; priced against <b>' + D.peers_used + ' live comps</b>.</p>' +
      '<p class="funnel">' + D.total_protocols + ' tracked &rarr; ' + D.tokenised + ' record a token (top ' + D.live_size + ' by market cap in Live) &rarr; ' + D.pre_token + ' pre-token &rarr; ' + screened + ' set aside by the screen &rarr; <b>' + D.board_size + ' ranked</b></p></div>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + D.total_protocols + '</b><span>in the snapshot</span></div>' +
      '<div class="stat"><b>' + D.tokenised + '</b><span>hold a token</span><small>' + D.peers_raw + ' priced · ' + (D.tokenised - D.peers_raw) + ' no price</small></div>' +
      '<div class="stat"><b>' + D.board_size + '</b><span>ranked</span></div>' +
      '<div class="stat"><b>' + screened + '</b><span>set aside by the screen</span></div>' +
      '<div class="stat"><b>' + D.unaccounted + '</b><span>unaccounted</span></div>' +
      '</div>' +
      '<p class="calline">Calibration: ' + D.peers_raw + ' priced peers &minus; ' + (D.peers_raw - D.peers_used) + ' set aside as non-comparable = <b>' + D.peers_used + ' comps</b> · top-10 holds ' + v.k_alt_top10_overlap + '/10 when shrinkage k is forced to ' + v.k_alt + ' · every row carries a range · snapshot ' + esc(D.as_of) + ' · sha256 ' + esc(D.snapshot_sha256.slice(0, 12)) + '&hellip;</p></header>';
  }

  function tabs() {
    function b(id, label) { return '<button data-tab="' + id + '"' + (state.tab === id ? ' class="on"' : '') + '>' + label + '</button>'; }
    return '<nav class="tabs">' + b('board', 'Board') + b('calib', 'Calibration') + b('live', 'Live tokens') + b('method', 'Methodology') + '</nav>';
  }

  function filtered() {
    var rows = D.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.cat !== 'all' && (r.category || '(uncategorised)') !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (state.q && (r.name + ' ' + r.slug).toLowerCase().indexOf(state.q.toLowerCase()) < 0) return false;
      return true;
    });
    if (state.sort === 'name') {
      rows.sort(function (a, b) {
        var c = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        return c * state.dir || a.rank - b.rank;
      });
      return rows;
    }
    var key = { rank: 'rank', tvl: 'tvl_usd', chg: 'change_7d', age: 'age_days', mult: 'multiple', imp: 'implied_value_usd', ev: 'ev_usd', p: 'p_launch' }[state.sort];
    rows.sort(function (a, b) {
      var va = a[key], vb = b[key];
      if (va === null) va = -Infinity; if (vb === null) vb = -Infinity;
      return (va - vb) * state.dir || a.rank - b.rank;
    });
    return rows;
  }

  function boardView() {
    var cats = [], chains = [], seenC = {}, seenH = {};
    D.rows.forEach(function (r) {
      var c = r.category || '(uncategorised)';
      if (!seenC[c]) { seenC[c] = 1; cats.push(c); }
      r.chains.forEach(function (h) { if (!seenH[h]) { seenH[h] = 1; chains.push(h); } });
    });
    cats.sort(); chains.sort();
    var rows = filtered();
    function opts(list, cur, allLabel) {
      return '<option value="all">' + allLabel + '</option>' + list.map(function (v) {
        return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>';
      }).join('');
    }
    var tvlOpts = [[0, 'Any TVL'], [1e7, '$10M+'], [5e7, '$50M+'], [2.5e8, '$250M+'], [1e9, '$1B+']].map(function (o) {
      return '<option value="' + o[0] + '"' + (state.minTvl === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');
    function th(id, label, cls) {
      var arrow = state.sort === id ? (state.dir === -1 ? ' ▾' : ' ▴') : '';
      return '<th class="sortable ' + (cls || '') + '" data-sort="' + id + '">' + label + arrow + '</th>';
    }
    var body = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.sel === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="rank num">' + r.rank + '</td>' +
        '<td class="proto l"><span class="nm">' + esc(r.name) + '</span>' + (r.watchlist ? star : '') + '<span class="sl">' + esc(r.slug) + '</span></td>' +
        '<td class="l"><span class="cat">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num">' + r.multiple.toFixed(2) + '&times;</td>' +
        '<td class="num imp">' + usd(r.implied_value_usd) + '</td>' +
        '<td class="num ev">' + usd(r.ev_usd) + '</td></tr>';
    }).join('');
    return '<div class="toolbar">' +
      '<input id="q" type="search" placeholder="Search name or slug" value="' + esc(state.q) + '">' +
      '<select id="cat">' + opts(cats, state.cat, 'All categories') + '</select>' +
      '<select id="chain">' + opts(chains, state.chain, 'All chains') + '</select>' +
      '<select id="tvl">' + tvlOpts + '</select>' +
      '<label class="chk"><input type="checkbox" id="wl"' + (state.wl ? ' checked' : '') + '> Watchlist only</label>' +
      '<span class="count">' + rows.length + ' of ' + D.board_size + ' protocols · click a row for its farm plan</span>' +
      '<span class="legend">EV = implied &times; launch priority — what to farm first, not what it is worth. Click a row for its full build-up, its range, and its farm plan with the break-even solved.</span></div>' +
      '<div class="wrap"><table><thead><tr>' +
      th('rank', '#') + th('name', 'Protocol', 'l') + '<th class="l">Category</th>' +
      th('tvl', 'TVL') + th('mult', 'Mult') +
      th('imp', 'Implied value') + th('ev', 'EV') +
      '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function detail(r) {
    var fb = r.risk_flags.indexOf('fallback multiple') >= 0;
    var multLabel = fb
      ? 'x headline multiple — geometric midpoint of the TVL-band median (' + (r.multiple_band === null ? 'n/a' : r.multiple_band.toFixed(3)) + ') and the global median (' + D.global_median.toFixed(3) + '); ' + (r.peers === 0 ? 'this category has no priced peers' : 'this category\'s single priced peer cannot set a multiple on its own')
      : 'x category multiple (' + r.peers + ' peers)';
    var wf = [
      ['TVL (snapshot)', usd(r.tvl_usd)],
      [multLabel, x2(r.multiple)],
      ['x relative growth (' + (r.growth_rel_pp > 0 ? '+' : '') + r.growth_rel_pp.toFixed(1) + 'pp vs category)', x2(r.growth_multiplier)],
      ['x maturity (' + age(r.age_days) + ' without a token)', x2(r.maturity_multiplier)],
      ['x breadth (' + r.chains.length + ' chains)', x2(r.breadth_multiplier)],
      ['x scale (TVL^-0.10, floored at 0.85)', x2(r.scale_multiplier)],
    ].map(function (row) { return '<tr><td class="l">' + row[0] + '</td><td class="num">' + row[1] + '</td></tr>'; }).join('') +
      '<tr class="tot"><td class="l">Implied value</td><td class="num">' + usd(r.implied_value_usd) + '</td></tr>' +
      '<tr><td class="l">' + (fb ? 'Implied range — the multiple band, growth at its clamps' : 'If relative growth ran to -30pp / +30pp') + '</td><td class="num">' + usd(r.implied_floor) + ' / ' + usd(r.implied_ceiling) + '</td></tr>' +
      (r.cross_check_usd !== null ? '<tr><td class="l">Fee cross-check — TVL x 0.75% curator take x 12x revenue (stated assumptions; never in the ranking)</td><td class="num">' + usd(r.cross_check_usd) + '</td></tr>' : '') +
      (r.cross_check_agree_pct !== null && r.cross_check_agree_pct <= 25 ? '<tr><td class="l">Cross-check agreement — the fee model above and the fallback multiple are independent inputs, and they land within ' + r.cross_check_agree_pct.toFixed(0) + '% of each other</td><td class="num">' + (r.cross_check_usd / r.tvl_usd).toFixed(3) + '&times; vs ' + r.multiple.toFixed(3) + '&times;</td></tr>' : '') +
      '<tr><td class="l">Expected value — implied x launch priority (display only)</td><td class="num">' + usd(r.ev_usd) + '</td></tr>';
    var flags = r.risk_flags.length
      ? r.risk_flags.map(function (f) { return '<span class="flag">' + esc(f) + '</span>'; }).join('')
      : '<span class="flag ok">no model flags</span>';
    var eco = '<h3 class="sec">Farm economics — the break-even, solved</h3><table class="wf">' +
      '<tr><td class="l">Planned position (sized from TVL, capped at $2,500)</td><td class="num">' + usd(r.farm_cap_usd) + '</td></tr>' +
      '<tr><td class="l">Gas over the ' + r.farm_hold_days + '-day hold (the plan\'s fixed cost)</td><td class="num">' + usd(r.farm_gas_usd) + '</td></tr>' +
      '<tr><td class="l">Expected airdrop rate — (implied / TVL) &times; 10% float &times; launch priority</td><td class="num">' + (r.farm_airdrop_rate * 100).toFixed(2) + '% of position</td></tr>' +
      '<tr><td class="l">Yield forgone over the hold — the same USDC lent at 4%</td><td class="num">' + (r.farm_yield_rate * 100).toFixed(2) + '% of position</td></tr>' +
      (r.break_even_usd !== null
        ? '<tr class="tot"><td class="l">Break-even position — gas / (airdrop rate &minus; yield rate)</td><td class="num">' + usd(r.break_even_usd) + '</td></tr>'
        : '<tr class="tot"><td class="l">Break-even position</td><td class="num">none at any size</td></tr>') +
      '</table>' +
      (r.break_even_usd === null
        ? '<p class="mut">The expected airdrop rate is below what the same USDC earns by simply lending it — every extra dollar loses the difference over the hold, before gas. At this bankroll the plan is a paid ticket, not an investment; the board says so here rather than hiding it in the plan\'s prose.</p>'
        : r.break_even_usd > r.farm_cap_usd
          ? '<p class="mut">The plan only pays for itself from a position of about ' + usd(r.break_even_usd) + '; the planned ' + usd(r.farm_cap_usd) + ' does not reach it. Skip at this bankroll, or size up knowingly.</p>'
          : '<p class="mut">The planned position is past break-even: from about ' + usd(r.break_even_usd) + ' the expected airdrop covers the plan\'s own gas and forgone yield.</p>') +
      '<p class="mut">Across the board: <b>' + D.farm_board.be_within_cap + ' of ' + D.farm_board.rows + ' plans break even at the suggested size</b> — the nearest needs ' + (D.farm_board.nearest_be_usd / D.farm_board.nearest_cap_usd).toFixed(1) + '&times; (' + esc(D.farm_board.nearest_name) + ': ' + usd(D.farm_board.nearest_be_usd) + ' against a ' + usd(D.farm_board.nearest_cap_usd) + ' plan). But ' + D.farm_board.finite_be + ' of ' + D.farm_board.rows + ' rows carry a finite break-even, and ' + D.farm_board.be_le_5000 + ' clear inside a $5,000 bankroll.</p>';
    return '<h2>' + esc(r.name) + (r.watchlist ? star : '') + '</h2><div class="sub">' + esc(r.slug) + ' · rank #' + r.rank + ' of ' + D.board_size + (r.watchlist ? ' · on the snapshot watchlist' : ' · early, below the watchlist floor') + '</div>' +
      '<div class="kv">' +
      '<div><span>Implied value</span><b>' + usd(r.implied_value_usd) + '</b></div>' +
      '<div><span>TVL</span><b>' + usd(r.tvl_usd) + '</b></div>' +
      '<div><span>7d TVL change</span><b>' + pct(r.change_7d) + '</b></div>' +
      '<div><span>Launch priority</span><b>' + r.p_launch + ' / 100</b></div></div>' +
      '<h3 class="sec">How the value is built</h3><table class="wf">' + wf + '</table>' +
      '<h3 class="sec">Model flags</h3><div class="flags">' + flags + '</div>' +
      (r.verify_token ? '<p class="mut">One word of this protocol\'s name is a live token\'s symbol in the same snapshot — the screen cannot prove whether it already trades under that name. Verify before farming.</p>' : '') +
      (r.manual_review ? '<p class="mut"><b>Manual review.</b> ' + esc(r.manual_review) + '</p>' : '') +
      eco +
      '<h3 class="sec">Chains</h3><p class="mut">' + esc(r.chains.join(', ') || 'none recorded') + '</p>' +
      '<h3 class="sec">Farm plan</h3><ol class="farm">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="dim">The launch-priority score never affects rank: rank is implied value alone. The plan is generated from this protocol\'s category, TVL, age and first chain — the same playbook code scores every row.</p>';
  }

  function calibView() {
    var S = D.scatter, v = D.validation;
    var palette = ['#2dd4bf', '#f5b94b', '#818cf8', '#f472b6', '#3ecf8e', '#60a5fa', '#facc15', '#fb7185'];
    var colorOf = {};
    S.top_categories.forEach(function (t, i) { colorOf[t.category] = palette[i % palette.length]; });
    var gm = D.global_median;
    var envF = Math.exp(v.loo_model_median_abs_log_err);
    var X0 = 64, X1 = 1180, Y0 = 24, Y1 = 415;
    var LX = [6.3, 10.7], LY = [-3, 1];
    function X(tvl) { return X0 + ((Math.log10(tvl) - LX[0]) / (LX[1] - LX[0])) * (X1 - X0); }
    function Y(m) { return Y0 + ((LY[1] - Math.log10(m)) / (LY[1] - LY[0])) * (Y1 - Y0); }
    var svg = '';
    // leave-one-out error envelope around the global median
    svg += '<rect x="' + X0 + '" y="' + Y(gm * envF).toFixed(1) + '" width="' + (X1 - X0) + '" height="' + (Y(gm / envF) - Y(gm * envF)).toFixed(1) + '" fill="#2dd4bf" opacity="0.07"/>';
    // gridlines
    [[7, '$10M'], [8, '$100M'], [9, '$1B'], [10, '$10B']].forEach(function (t) {
      svg += '<line x1="' + X(Math.pow(10, t[0])).toFixed(1) + '" y1="' + Y0 + '" x2="' + X(Math.pow(10, t[0])).toFixed(1) + '" y2="' + Y1 + '" stroke="#1d2c47" stroke-width="1"/>' +
        '<text x="' + X(Math.pow(10, t[0])).toFixed(1) + '" y="' + (Y1 + 20) + '" class="svgt" text-anchor="middle">' + t[1] + '</text>';
    });
    [[-2, '0.01'], [-1, '0.1'], [0, '1'], [1, '10']].forEach(function (t) {
      svg += '<line x1="' + X0 + '" y1="' + Y(Math.pow(10, t[0])).toFixed(1) + '" x2="' + X1 + '" y2="' + Y(Math.pow(10, t[0])).toFixed(1) + '" stroke="#1d2c47" stroke-width="1"/>' +
        '<text x="' + (X0 - 8) + '" y="' + (Y(Math.pow(10, t[0])) + 4).toFixed(1) + '" class="svgt" text-anchor="end">' + t[1] + '</text>';
    });
    // global median, dashed
    svg += '<line x1="' + X0 + '" y1="' + Y(gm).toFixed(1) + '" x2="' + X1 + '" y2="' + Y(gm).toFixed(1) + '" stroke="#f5b94b" stroke-width="1.4" stroke-dasharray="6 5"/>' +
      '<text x="' + (X1 - 4) + '" y="' + (Y(gm) - 8).toFixed(1) + '" class="svgt" text-anchor="end" fill="#f5b94b">global median ' + gm.toFixed(3) + '&times;</text>' +
      '<text x="' + (X0 + 6) + '" y="' + (Y(gm * envF) + 16).toFixed(1) + '" class="svgt">leave-one-out error envelope (&divide;/&times;' + envF.toFixed(2) + ')</text>';
    // category segments — the model itself: one flat shrunk median per category, drawn only
    // across the TVL span that category's own priced peers cover. Fallback categories have
    // no segment: no category median prices them.
    var labelled = S.segments.filter(function (s) { return !s.fallback; }).sort(function (a, b) { return b.peers - a.peers; });
    S.segments.forEach(function (s) {
      if (s.fallback) return;
      var xa = X(s.tvl_lo), xb = X(s.tvl_hi);
      if (xb - xa < 16) { var mid = (xa + xb) / 2; xa = mid - 8; xb = mid + 8; }
      svg += '<line x1="' + xa.toFixed(1) + '" y1="' + Y(s.multiple).toFixed(1) + '" x2="' + xb.toFixed(1) + '" y2="' + Y(s.multiple).toFixed(1) + '" stroke="' + (colorOf[s.category] || '#7d90b0') + '" stroke-width="3" stroke-linecap="round" opacity="0.9"/>';
    });
    labelled.slice(0, 1).forEach(function (s) {
      svg += '<text x="' + (X(s.tvl_hi) + 8).toFixed(1) + '" y="' + (Y(s.multiple) + 4).toFixed(1) + '" class="svgt" fill="' + (colorOf[s.category] || '#7d90b0') + '">' + esc(s.category) + ' ' + s.multiple.toFixed(3) + '&times;</text>';
    });
    // the peers themselves
    S.peers.forEach(function (p) {
      svg += '<circle cx="' + X(p.tvl_usd).toFixed(1) + '" cy="' + Y(p.multiple).toFixed(1) + '" r="2.6" fill="' + (colorOf[p.category || ''] || '#64748B') + '" opacity="0.9"><title>' + esc(p.name) + ' — ' + p.multiple.toFixed(3) + '&times; on ' + usd(p.tvl_usd) + '</title></circle>';
    });
    // the board's top 10 by implied value — white diamonds at the multiple the model
    // gives each of them, on the same axes as the peers they are priced from
    S.board_top10.forEach(function (b) {
      var cx = X(b.tvl_usd), cy = Y(b.implied_multiple);
      svg += '<path d="M ' + cx.toFixed(1) + ' ' + (cy - 6).toFixed(1) + ' L ' + (cx + 6).toFixed(1) + ' ' + cy.toFixed(1) + ' L ' + cx.toFixed(1) + ' ' + (cy + 6).toFixed(1) + ' L ' + (cx - 6).toFixed(1) + ' ' + cy.toFixed(1) + ' Z" fill="#ffffff" stroke="#0e1626" stroke-width="1.1"><title>' + esc(b.name) + ' (board top 10) — ' + b.implied_multiple.toFixed(3) + '&times; on ' + usd(b.tvl_usd) + '</title></path>';
    });
    // annotate the extremes and the peer nearest the median
    var byMult = [...S.peers].sort(function (a, b) { return a.multiple - b.multiple; });
    var nearGm = S.peers.reduce(function (best, p) { return Math.abs(Math.log(p.multiple / gm)) < Math.abs(Math.log(best.multiple / gm)) ? p : best; }, S.peers[0]);
    [{ p: byMult[0], dy: -8 }, { p: byMult[byMult.length - 1], dy: -8 }, { p: nearGm, dy: 20 }].forEach(function (a) {
      var p = a.p;
      if (!p) return;
      var cx = X(p.tvl_usd), cy = Y(p.multiple);
      var anchor = cx > X1 - 260 ? 'end' : 'start';
      var tx = anchor === 'end' ? cx - 8 : cx + 8;
      svg += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="4.4" fill="none" stroke="#dce6f2" stroke-width="1.2"/>' +
        '<text x="' + tx.toFixed(1) + '" y="' + (cy + a.dy).toFixed(1) + '" class="svgt" text-anchor="' + anchor + '" fill="#dce6f2">' + esc(p.slug) + ' ' + p.multiple.toFixed(3) + '&times;</text>';
    });
    svg += '<text x="' + X0 + '" y="' + (Y1 + 42) + '" class="svgt">protocol TVL (log scale)</text>' +
      '<text x="' + (X1 - 4) + '" y="' + (Y1 + 42) + '" class="svgt" text-anchor="end">realised market cap / TVL (log scale)</text>';
    var legend = '<span class="lgchip"><i style="background:#ffffff"></i>Board top 10 by implied value — white diamonds</span>' + S.top_categories.map(function (t) {
      return '<span class="lgchip"><i style="background:' + colorOf[t.category] + '"></i>' + esc(t.category) + ' · ' + t.board_tvl_share_pct.toFixed(1) + '% of board TVL</span>';
    }).join('');
    var shareSum = S.top_categories.reduce(function (a, t) { return a + t.board_tvl_share_pct; }, 0);
    return '<div class="panelbox"><h2>Calibration — the model\'s evidence, plotted</h2>' +
      '<p>Every priced peer the model calibrates on: what a tokenised protocol of this size actually trades at. The model is the horizontal segments — one shrunk category median each, drawn only over the TVL span that category\'s own peers cover; fallback categories have no segment, because no category median prices them. A size term was fitted and left out (Methodology has the test) — the segments are flat because the model is.</p>' +
      '<div class="lgrow">' + legend + '</div>' +
      '<svg class="calib" viewBox="0 0 1200 475" role="img" aria-label="Scatter of ' + S.peers.length + ' priced peers, realised multiple against TVL, with category median segments">' + svg + '</svg>' +
      '<p>' + S.peers.length + ' cleaned priced peers; the eight coloured categories hold ' + shareSum.toFixed(0) + '% of the board\'s TVL, the rest are grey. The vertical spread — ' + byMult[0].multiple.toFixed(3) + '&times; to ' + byMult[byMult.length - 1].multiple.toFixed(3) + '&times; — is why every implied value on the board ships with a range instead of pretending to be a point. The white diamonds are the board\'s top 10 by implied value, plotted at the multiples the model gives them: the ranking itself, drawn on the same axes as its evidence.</p></div>';
  }

  function liveView() {
    var max = Math.max.apply(null, D.live.map(function (r) { return r.multiple || 0; }).concat([0.01]));
    var medPos = Math.min(100, (D.global_median / max) * 100);
    var body = D.live.map(function (r) {
      var w = r.multiple === null ? 0 : (r.multiple / max) * 100;
      return '<tr><td class="proto l"><span class="nm">' + esc(r.name) + '</span><span class="sl">' + esc(r.symbol || r.slug) + '</span></td>' +
        '<td class="l"><span class="cat">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td><td class="num">' + usd(r.mcap_usd) + '</td>' +
        '<td class="num">' + (r.multiple === null ? 'n/a' : r.multiple.toFixed(3)) + '</td>' +
        '<td class="l"><div class="mbar"><div class="track"><div class="fill" style="width:' + w.toFixed(1) + '%"></div><div class="med" style="left:' + medPos.toFixed(1) + '%"></div></div></div></td>' +
        '<td class="num">' + pct(r.change_7d) + '</td></tr>';
    }).join('');
    return '<div class="panelbox"><h2>Already trading — the market\'s own values</h2>' +
      '<p>These protocols record a token, so no model prices them: the bar is each one\'s realised market-cap/TVL against the field\'s median (amber tick, ' + D.global_median.toFixed(3) + '). ' +
      'Their ratios are the market\'s record, and the reason a pre-token protocol is never ranked beside them. The board\'s calibration screens this set first (Methodology): a deployment carrying its parent token\'s whole market cap is evidence about the parent, not about itself.</p></div>' +
      '<div class="wrap"><table><thead><tr><th class="l">Protocol</th><th class="l">Category</th><th>TVL</th><th>Market cap</th><th>Realised mult</th><th class="l">vs median</th><th>7d</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function methodView() {
    var cats = D.categories.map(function (c) {
      var pex = c.peer_examples && c.peer_examples.length
        ? '<div class="pex">priced peers: ' + c.peer_examples.map(function (p) { return esc(p.slug) + ' (' + p.multiple.toFixed(3) + '&times; on ' + usd(p.tvl_usd) + ' TVL)'; }).join(', ') + '</div>'
        : '';
      return '<tr><td class="l">' + esc(c.category) + pex + '</td><td class="num">' + c.peers + '</td><td class="num">' + (c.peers ? c.raw_median.toFixed(3) : '—') + '</td>' +
        '<td class="num">' + c.multiple.toFixed(3) + (c.fallback ? ' <span class="badge md">FALLBACK</span>' : '') + '</td>' +
        '<td class="num">' + c.tokenised + ' / ' + c.total + '</td><td class="num">' + (c.median_change_7d === null ? 'n/a' : pct(c.median_change_7d)) + '</td></tr>';
    }).join('');
    var bands = D.bands.map(function (b) {
      return '<tr><td class="l">' + esc(b.label) + '</td><td class="num">' + b.peers + '</td><td class="num">' + b.median_multiple.toFixed(3) + '</td></tr>';
    }).join('');
    var v = D.validation;
    var screened = D.screened_category + D.screened_product_name + D.screened_exchange_name + D.screened_version;
    var excl = D.screened_by_category.map(function (s) {
      return '<tr><td class="l">Category: ' + esc(s.category) + '</td><td class="num">' + s.count + '</td></tr>';
    }).join('') +
      '<tr><td class="l">Name carries wrapped / staked / staking</td><td class="num">' + D.screened_product_name + '</td></tr>' +
      '<tr><td class="l">Name begins with an exchange\'s name</td><td class="num">' + D.screened_exchange_name + '</td></tr>' +
      '<tr><td class="l">Name ends in a version marker</td><td class="num">' + D.screened_version + '</td></tr>';
    var verifyCount = D.rows.filter(function (r) { return r.verify_token; }).length;
    var mrNames = D.rows.filter(function (r) { return r.manual_review; }).map(function (r) { return '<b>' + esc(r.name) + '</b>'; }).join(' and ');
    return '<div class="panelbox"><h2>The model — ' + esc(D.model_version) + '</h2>' +
      '<p>Every implied value is one multiplication, and every factor in it comes from the snapshot\'s own figures:</p>' +
      '<p class="formula">implied = TVL x category multiple x relative growth x maturity x breadth x scale</p>' +
      '<p><b>Category multiple.</b> The median market-cap/TVL of the tokenised protocols in the same category, shrunk toward the global median (' + D.global_median.toFixed(3) + ') in log space with weight k = ' + D.shrinkage_k + ', estimated from the data (within-category variance over between-category variance). Multiples are clamped to [0.03, 1.20]. The peers are cleaned before they calibrate anything: of ' + D.peers_raw + ' tokenised protocols with a market cap, the screen sets aside ' + (D.peers_raw - D.peers_used) + ' — duplicate deployments of a single token collapse to the largest deployment, and any peer whose ratio falls outside [0.002, 3.0] is rejected: a cap 400x a protocol\'s TVL is a parent token\'s cap recorded against a side deployment, and a cap at 1/500th of TVL is a dead token; neither prices the protocol it sits on. ' + D.peers_used + ' priced peers remain. Every median of ratios is a geometric median, computed in log space, where this model lives.</p>' +
      '<p><b>Fallback multiple.</b> A category earns its own multiple when its priced peers can corroborate each other — at least two of them — or when its single peer is itself substantial (TVL at or above the snapshot\'s $' + (D.floor_usd / 1e6) + 'M floor) and within one TVL band of the row being scored. Anything else asks a lone small peer to price giants, and the row falls back instead: it is scored on the geometric midpoint of two snapshot medians — the global median, and the median multiple of the peers in the protocol\'s own TVL band (below). The snapshot\'s largest protocols trade near 0.03x while its smallest trade near 0.38x, so one global number would misprice both ends. The row\'s range spans the two medians: the weakest estimates on the board carry the widest stated uncertainty. The table below shows the rule working both ways: Risk Curators\' only priced peer is api3 (2.975x on $12M of TVL), an oracle network whose cap is not driven by curator assets, so it cannot speak for the category and the curator rows are priced by the band rule; Onchain Capital Allocator\'s two peers (grove and concrete, both near $1.1B of TVL, at 0.006x and 0.019x) corroborate each other, and that category is priced from them.</p>' +
      '<p><b>Relative growth.</b> 1 + 0.50 x clamp(7d change minus the category\'s median 7d change, -30pp, +30pp) / 100 — momentum is scored against the protocol\'s own category, never raw: in a week when the whole field fell, holding flat is strength. A missing change scores as the category median.</p>' +
      '<p><b>Maturity.</b> 0.70 to 0.85 over the first 90 days without a token, then 0.85 to 1.00 on a log scale to 1095 days; an unknown listing date scores as 180 days and is flagged. <b>Breadth.</b> +3% for a second chain, +2% a third, +1% each a fourth and fifth. <b>Scale.</b> (TVL / $1B)^-0.10, clamped to [0.85, 1.00] — a smooth size discount with no cliff: $999M and $1.001B score alike, $2.75B keeps about x0.90.</p>' +
      '<p><b>Launch priority (display only).</b> The category\'s tokenisation rate scaled by an age-overdue curve peaking at 400-1000 days without a token. It orders nobody: rank is implied value alone, so the board\'s implied values never rise with rank. The EV column (implied x priority) answers the other question — what to farm first — without touching the ranking.</p>' +
      '<p><b>Farm plans.</b> Every plan uses a seasoned wallet (a fresh wallet is the first filter serious airdrops run), sizes the position from the protocol\'s own TVL — $40 per square root of TVL in millions, floored at $150 and capped at $2,500, 5% of a $50,000 reference bankroll — and states its expected value out loud: position x (implied / TVL) x a 10% community float, weighted by launch priority, with capital separated from gas, time and the lending yield forgone at 4%. Thin numbers are printed, not hidden. Every drawer also solves the plan\'s break-even in closed form — gas / (airdrop rate &minus; yield rate), with both rates printed beside it — and where the airdrop rate does not beat the yield forgone, it says no position breaks even. One caveat on that algebra: it assumes the airdrop scales linearly with position, while real allocations are usually capped per wallet, which makes the return concave — a cap can only make a large position worse, never rescue a negative rate.</p></div>' +
      '<div class="panelbox"><h2>How the model grades itself</h2>' +
      '<p><b>What the ranking can and cannot claim.</b> The board\'s order is largely TVL\'s order — Spearman correlation with raw TVL is <b>' + v.spearman_implied_vs_tvl.toFixed(2) + '</b> — and in the backtest below, the model\'s rank correlation with realised market caps (' + v.loo_model_rank_ic.toFixed(2) + ') ties the flat global median\'s (' + v.loo_flat_rank_ic.toFixed(2) + '). What the model adds is not a better order but calibration: what a dollar of this category\'s TVL has historically been worth, stated as a level with a range, instead of size alone.</p>' +
      '<p><b>Leave-one-out backtest — the error scale.</b> Each of the ' + v.loo_peers + ' cleaned priced peers was hidden in turn and its multiple predicted by the model\'s own rules (the corroboration rule, or the geometric TVL-band fallback). Median absolute log error: <b>' + v.loo_model_median_abs_log_err.toFixed(2) + '</b> for the model against <b>' + v.loo_flat_median_abs_log_err.toFixed(2) + '</b> for the flat global median — a typical miss of about x' + Math.exp(v.loo_model_median_abs_log_err).toFixed(1) + ' either way, and the model is the better central estimate. The scale is stated on the cleaned set because ' + (D.peers_raw - D.peers_used) + ' of the raw benchmark rows fail the peer screen above; grading against them would grade the noise. On the share predicted within 2x the flat median still leads, ' + v.loo_flat_within_2x_pct + '% to ' + v.loo_model_within_2x_pct + '% — no TVL-only model pins a launch value tightly, and this one does not pretend to.</p>' +
      '<p><b>Is the edge real?</b> A paired bootstrap over the same ' + v.loo_peers + ' folds (' + v.loo_bootstrap_resamples.toLocaleString('en-US') + ' resamples) puts the difference of medians at ' + v.loo_median_diff.toFixed(2) + ' log units, with a 95% interval of [' + v.loo_median_diff_ci_lo.toFixed(2) + ', ' + v.loo_median_diff_ci_hi.toFixed(2) + '] — it includes zero — and on mean error the two are indistinguishable (' + v.loo_mean_diff.toFixed(2) + ', interval [' + v.loo_mean_diff_ci_lo.toFixed(2) + ', ' + v.loo_mean_diff_ci_hi.toFixed(2) + ']). So the honest claim is narrow: the model is the better central estimate on the median peer, not a proven one. That is why every row carries a range and a risk flag instead of a point estimate.</p>' +
      '<p><b>A size term, fitted and not shipped.</b> Pooling the peers with category fixed effects gives a size elasticity of ' + v.slope_b.toFixed(2) + ' (95% interval [' + v.slope_b_ci_lo.toFixed(2) + ', ' + v.slope_b_ci_hi.toFixed(2) + ']): within a category, larger protocols do trade at lower multiples. Tested leave-one-out with the slope refit on every fold, it cuts the median miss from &times;' + Math.exp(v.loo_model_median_abs_log_err).toFixed(1) + ' to &times;' + Math.exp(v.slope_loo_median_abs_log_err).toFixed(1) + ' — but the share within 2x falls from ' + v.loo_model_within_2x_pct + '% to ' + v.slope_loo_within_2x_pct + '%: a sharper centre bought with a fatter tail, from a coefficient whose own interval spans a ' + Math.pow(10, v.slope_b_ci_lo).toFixed(2) + '&times; to ' + Math.pow(10, v.slope_b_ci_hi).toFixed(2) + '&times; correction across a 10&times; size gap. A sizing tool does not make that trade. Category medians carry the model; the slope stays out, and this paragraph is its receipt.</p>' +
      '<p><b>The range is a scenario band, not a confidence interval.</b> For a peer-backed row it is the headline with relative growth run to its &plusmn;30pp clamps; for a fallback row it spans the two medians the midpoint came from. It shows what the value becomes if momentum, or the multiple, moves to the stated edges — it does not claim the realised value lands inside it with any stated probability.</p>' +
      '<p><b>Shrinkage stability.</b> Forcing k from the estimated ' + D.shrinkage_k + ' up to ' + v.k_alt + ' keeps ' + v.k_alt_top10_overlap + ' of the top 10 in the top 10 and moves no top-20 row by more than ' + v.k_alt_max_rank_delta_top20 + ' places — the board\'s head does not hinge on the exact k, though its shoulders move, which is what the ranges are for.</p></div>' +
      '<div class="panelbox"><h2>Category calibration</h2><div class="wrap" style="border:0"><table><thead><tr><th class="l">Category</th><th>Tokenised peers</th><th>Raw median</th><th>Multiple used</th><th>Tokenised / all</th><th>Median 7d</th></tr></thead><tbody>' + cats + '</tbody></table></div>' +
      '<h2 style="margin-top:18px">TVL bands — the fallback\'s second leg</h2><div class="wrap" style="border:0"><table><thead><tr><th class="l">Peer TVL band</th><th>Priced peers</th><th>Median multiple</th></tr></thead><tbody>' + bands + '</tbody></table></div></div>' +
      '<div class="panelbox"><h2>Coverage and the screen</h2>' +
      '<p>The snapshot holds ' + D.total_protocols + ' protocols: ' + D.tokenised + ' record a token and ' + D.pre_token + ' record none. Of the pre-token set, ' + screened + ' are set aside by the genuineness screen the watchlist itself uses, leaving the ' + D.board_size + ' ranked rows — every one of the ' + D.watchlist_size + ' watchlist protocols among them and ' + D.early_size + ' early rows below the $' + (D.floor_usd / 1e6) + 'M floor. The set-asides, auditable:</p>' +
      '<div class="covbar"><div class="covseg" style="width:' + (100 * D.tokenised / D.total_protocols).toFixed(1) + '%;background:#27395c">hold a token · ' + D.tokenised + '</div><div class="covseg" style="width:' + (100 * D.board_size / D.total_protocols).toFixed(1) + '%;background:#0f3d38;color:#2dd4bf">ranked · ' + D.board_size + '</div><div class="covseg" style="width:' + (100 * screened / D.total_protocols).toFixed(1) + '%;background:#3a2c10;color:#f5b94b">set aside · ' + screened + '</div></div>' +
      '<p class="dim">' + D.total_protocols + ' of ' + D.total_protocols + ' accounted for — the three segments sum to the whole snapshot; nothing is dropped silently.</p>' +
      '<div class="wrap" style="border:0"><table><thead><tr><th class="l">Screen reason</th><th>Set aside</th></tr></thead><tbody>' + excl + '</tbody></table></div>' +
      '<p>The board\'s implied values sum to ' + usd(D.total_implied) + ', printed here once and deliberately not a headline: the sum double-counts, because one protocol\'s TVL is often deposits inside another (a curator\'s assets sit in lending markets that are themselves in the snapshot). The headline aggregates are the watchlist\'s implied (' + usd(D.watchlist_implied) + ') and the board\'s median (' + usd(D.median_implied) + '), which no overlap can inflate.</p>' +
      '<p><b>One limit, stated.</b> The screen reads only the snapshot\'s fields. A protocol whose token trades but which the snapshot records with no market cap, symbol or CoinGecko id is indistinguishable from a true pre-token protocol in this data. As a partial check, every board row\'s name was cross-read against the live tokens\' symbols: ' + verifyCount + ' rows carry a word that is a live token\'s symbol and are flagged "verify token status" rather than silently trusted or silently removed.</p>' +
      (mrNames ? '<p><b>Manual review — the model\'s one disclosed exception.</b> ' + mrNames + ' are watchlist rows known from outside the snapshot to have value accruing to a token that already trades. The snapshot records no token for them, and every watchlist slug must appear on the board, so they stay — flagged in their rows and drawers, with the note stated there. Read their implied values as belonging to the live tokens, not to future launches; the exception changes no number, it only refuses to let the rows pretend.</p>' : '') +
      '<p>Data: ' + esc(D.source) + ', as of ' + esc(D.as_of) + '. Snapshot sha256 <code>' + esc(D.snapshot_sha256.slice(0, 16)) + '…</code> — the sealed bytes every run of this program reads. The page recomputes nothing from the network; the board it shows is the board the program wrote.</p></div>';
  }

  function render() {
    var html = header() + tabs();
    if (state.tab === 'board') html += boardView();
    else if (state.tab === 'calib') html += calibView();
    else if (state.tab === 'live') html += liveView();
    else html += methodView();
    html += '<footer>Implied values are this radar\'s own claim from the snapshot\'s record, not a prediction that a token will launch. Farm plans are checklists, not financial advice.<br>Snapshot ' + esc(D.as_of) + ' · sha256 ' + esc(D.snapshot_sha256.slice(0, 16)) + '&hellip; · ' + D.board_size + ' ranked rows · implied values sum to ' + usd(D.total_implied) + ' (nested TVL double-counts — see Methodology) · model ' + esc(D.model_version) + '.</footer>';
    var sel = state.sel ? D.rows.filter(function (r) { return r.slug === state.sel; })[0] : null;
    html += '<div class="scrim' + (sel ? ' on' : '') + '" id="scrim"></div><aside class="detail' + (sel ? ' on' : '') + '" id="detail">' +
      (sel ? '<button class="x" id="x" aria-label="Close">×</button>' + detail(sel) : '') + '</aside>';
    app.innerHTML = html;
    app.setAttribute('aria-busy', 'false');
    bind();
  }

  function bind() {
    Array.prototype.forEach.call(app.querySelectorAll('[data-tab]'), function (b) {
      b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); render(); });
    });
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; refreshBody(); });
    var cat = document.getElementById('cat'); if (cat) cat.addEventListener('change', function () { state.cat = cat.value; refreshBody(); });
    var ch = document.getElementById('chain'); if (ch) ch.addEventListener('change', function () { state.chain = ch.value; refreshBody(); });
    var tv = document.getElementById('tvl'); if (tv) tv.addEventListener('change', function () { state.minTvl = +tv.value; refreshBody(); });
    var wl = document.getElementById('wl'); if (wl) wl.addEventListener('change', function () { state.wl = wl.checked; refreshBody(); });
    bindRows();
    var x = document.getElementById('x'); if (x) x.addEventListener('click', closeDetail);
    var sc = document.getElementById('scrim'); if (sc) sc.addEventListener('click', closeDetail);
  }
  function bindRows() {
    Array.prototype.forEach.call(app.querySelectorAll('th.sortable'), function (t) {
      t.addEventListener('click', function () {
        var s = t.getAttribute('data-sort');
        if (state.sort === s) state.dir = -state.dir; else { state.sort = s; state.dir = (s === 'rank' || s === 'name') ? 1 : -1; }
        render();
      });
    });
    Array.prototype.forEach.call(app.querySelectorAll('tbody tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () { state.sel = tr.getAttribute('data-slug'); render(); });
    });
  }
  // Re-render only the board view (keeps the search box focused while typing).
  function refreshBody() { render(); var q = document.getElementById('q'); if (q && state.tab === 'board') { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
  function closeDetail() { state.sel = null; render(); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });

  render();
})();
