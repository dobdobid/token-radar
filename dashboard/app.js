// Token Radar's dashboard, radar-2. It reads window.RADAR, which main.ts writes beside this
// folder as data.js, and renders the ranked board, the filters, the live-token tab, the model
// panel and a detail drawer with the model's inputs and the farm plan. No network: every byte
// it shows comes from data.js, and the page recomputes each row's implied value from the same
// snapshot figures so the numbers it shows are the numbers board.json carries.
//
// State lives in one object: the search text, the category filter, the pre-token/live tab, the
// sort key and direction, and the selected protocol. The hash carries the same state, so a link
// opens the board, a filtered view or a detail drawer directly.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  /** Dollars, shortened: $2.75B, $543.6M, $27K, or the full figure below a thousand. */
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }

  /** A per-cent figure with its sign, two decimals, or n/a when the snapshot reports none. */
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var sign = n > 0 ? '+' : '';
    return sign + n.toFixed(2) + '%';
  }

  /** An age in days as 45d, or in years once it passes a year; unknown stays unknown. */
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  /** Clamp a number into a range. */
  function clamp(n, lo, hi) {
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  /**
   * The model, as the page computes it: base from TVL, growth clamped and weighted, maturity from
   * age capped at three years, breadth from extra chains capped at ten. Radar-2's breadth term is
   * the one addition over the starter: a protocol on more chains reaches more wallets, so it earns
   * up to 15% extra. The detail drawer compares this number with board.json's, in plain sight.
   */
  function impliedOf(row, model) {
    var change = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growth = clamp(change, model.growth_floor, model.growth_cap);
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (clamp(age, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = row.chains ? row.chains.length : 1;
    var breadth = 1 + clamp(chains - 1, 0, model.breadth_cap) * model.breadth_step;
    var value = Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * breadth);
    return Math.max(1, value);
  }

  /** Set one attribute on a node: class, text, html, an on* handler, or a plain attribute. */
  function setAttr(node, key, value) {
    if (value === null || value === undefined) return;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }

  /** Append one child: a string becomes text, an array appends each member, else the node itself. */
  function appendChild(node, child) {
    if (child === null || child === undefined) return;
    if (Array.isArray(child)) {
      for (var i = 0; i < child.length; i++) appendChild(node, child[i]);
    } else if (typeof child === 'string') {
      node.appendChild(document.createTextNode(child));
    } else {
      node.appendChild(child);
    }
  }

  /** A small element builder: tag, attributes, then any number of children. */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      var keys = Object.keys(attrs);
      for (var k = 0; k < keys.length; k++) setAttr(node, keys[k], attrs[keys[k]]);
    }
    for (var i = 2; i < arguments.length; i++) appendChild(node, arguments[i]);
    return node;
  }

  // The farm plan is the same derivation main.ts writes into board.json: category, chains, TVL
  // and age decide the action, the capital, the hold and every cost and time. No name is
  // special-cased, and the strings below are the same ones lib/model.ts builds, step for step.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }

  /** Capital steps: [TVL floor, capital]. The first floor the TVL clears wins. */
  var CAPITAL_STEPS = [[5e9, 250], [1e9, 150], [1e8, 100], [0, 50]];

  /** Capital for one position, stepped from the protocol's TVL. */
  function capitalFor(p) {
    for (var i = 0; i < CAPITAL_STEPS.length; i++) {
      if (p.tvl_usd >= CAPITAL_STEPS[i][0]) return CAPITAL_STEPS[i][1];
    }
    return 50;
  }

  /** Hold steps: [age ceiling in days, hold in days]. The first ceiling the age fits wins. */
  var HOLD_STEPS = [[180, 60], [365, 45], [Infinity, 30]];

  /** Hold length from age: the younger the protocol, the longer the qualifying window. */
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    for (var i = 0; i < HOLD_STEPS.length; i++) {
      if (age < HOLD_STEPS[i][0]) return HOLD_STEPS[i][1];
    }
    return 30;
  }

  /**
   * The category actions, as a table: each row names the category words it answers and the
   * sentence it builds. The first row whose words appear in the category wins; the fallback at
   * the end serves every protocol the table does not name.
   */
  var ACTION_TABLE = [
    { words: ['lend', 'cdp', 'collateral'], make: function (name, capital, chain) { return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.'; } },
    { words: ['dex', 'yield', 'leveraged farm'], make: function (name, capital, chain) { return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.'; } },
    { words: ['bridge'], make: function (name, capital, chain) { return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.'; } },
    { words: ['staking', 'restak'], make: function (name, capital, chain) { return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.'; } },
    { words: ['perpetual', 'derivative'], make: function (name, capital, chain) { return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.'; } },
    { words: ['prediction'], make: function (name, capital, chain) { return 'Fund $' + capital + ' and place one market position on ' + name + '.'; } },
    { words: ['curator', 'allocator'], make: function (name, capital, chain) { return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.'; } },
    { words: ['stable'], make: function (name, capital, chain) { return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.'; } },
    { words: ['rwa'], make: function (name, capital, chain) { return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.'; } },
    { words: ['insurance'], make: function (name, capital, chain) { return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.'; } }
  ];

  /** The category's one action, in words a farmer can follow with no extra research. */
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < ACTION_TABLE.length; i++) {
      var row = ACTION_TABLE[i];
      for (var j = 0; j < row.words.length; j++) {
        if (c.indexOf(row.words[j]) >= 0) return row.make(p.name, capital, chain);
      }
    }
    return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
  }

  /** Flatten one step into a single string: action, then cost and time. */
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) return s.slice(0, 596) + '...';
    if (s.length < 20) return s + " Hold the position and check the protocol's own page.";
    return s;
  }

  /**
   * Seven steps for one row. Step five spreads the farm onto a second chain where the protocol
   * runs on one, so the position is counted in more than one place; step six is the claim check
   * and step seven the log.
   */
  function farmSteps(p) {
    var chain = chainOf(p);
    var second = p.chains && p.chains.length > 1 ? p.chains[1] : null;
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var half = Math.round(capital / 2);
    var gas = capital >= 150 ? 8 : 4;
    var secondAction = second === null
      ? 'Open a second, smaller position of $' + half + ' in the same market so one failed transaction does not end the farm.'
      : 'Repeat the main action with $' + half + ' on ' + second + ' so the farm is counted on two chains.';
    var steps = [];
    steps.push({ text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' });
    steps.push({ text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' });
    steps.push({ text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' });
    steps.push({ text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' });
    steps.push({ text: secondAction, cost: '$' + half + ' of capital and about $3 of gas', time: '15 minutes' });
    steps.push({ text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' });
    steps.push({ text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' });
    var out = [];
    for (var i = 0; i < steps.length; i++) out.push(stepText(steps[i]));
    return out;
  }

  /** Read the hash back into state: q for the search, p for the open detail, category. */
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    var q = params.get('q');
    var p = params.get('p');
    var category = params.get('category');
    if (q) state.q = q;
    if (p) state.selected = p;
    if (category) state.category = category;
  }

  /** Write state back to the hash, so a view can be linked to. */
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  /** The rows the current filters leave: category first, then the search text. */
  function rows() {
    var q = state.q.trim().toLowerCase();
    var kept = [];
    for (var i = 0; i < DATA.rows.length; i++) {
      var r = DATA.rows[i];
      if (state.category !== 'all' && r.category !== state.category) continue;
      if (!q) { kept.push(r); continue; }
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      if (hay.indexOf(q) >= 0) kept.push(r);
    }
    return kept;
  }

  /** One sort key's value for a row; growth and age put the unknowns last in either direction. */
  var SORT_KEYS = {
    name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    growth: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
    age: function (r) { return r.age_days === null ? Infinity : r.age_days; },
    implied: function (r) { return r.implied_value_usd; }
  };

  /** Sort a list by the current key and direction; ties break on slug, so the order is stable. */
  function sortedRows(list) {
    var keyFn = SORT_KEYS[state.sort] || SORT_KEYS.implied;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av = keyFn(a);
      var bv = keyFn(b);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      if (a.slug < b.slug) return -1;
      if (a.slug > b.slug) return 1;
      return 0;
    });
  }

  /** The top bar: brand on the left, snapshot date and model on the right. */
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  /** The headline and the four facts: coverage, rows scored, early rows, live rows set aside. */
  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, every rankable one the snapshot holds. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  /** Search, category filter, pre-token/live tabs, and the row count. */
  function controls() {
    var seen = {};
    var categories = [];
    for (var i = 0; i < DATA.rows.length; i++) {
      var c = DATA.rows[i].category || 'Other';
      if (!seen[c]) { seen[c] = true; categories.push(c); }
    }
    categories.sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var options = [el('option', { value: 'all', text: 'All categories' })];
    for (var j = 0; j < categories.length; j++) {
      options.push(el('option', { value: categories[j], text: categories[j], selected: categories[j] === state.category ? 'selected' : null }));
    }
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' }, options);
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  /** A sortable column header: click to sort, click again to reverse. */
  function sortHeader(key, label) {
    var arrow = state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null;
    var button = el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } }, label, arrow);
    return el('th', { scope: 'col' }, button);
  }

  /** One board row: rank, protocol, TVL, growth, age, implied value with its bar, token status. */
  function boardRow(r, maxImplied) {
    var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
    var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    var width = Math.max(3, Math.round((r.implied_value_usd / maxImplied) * 100));
    var chains = r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain';
    return el('tr', {
      'data-selected': state.selected === r.slug ? 'true' : 'false',
      tabindex: '0',
      onclick: function () { openDetail(r.slug); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
    },
      el('td', { class: 'num', text: String(r.rank) }),
      el('td', null, el('div', { class: 'name' },
        el('b', { text: r.name }),
        el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chains })
      )),
      el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      el('td', { class: 'num ' + growthClass, text: growth }),
      el('td', { class: 'num', text: fmtAge(r.age_days) }),
      el('td', null, el('div', { class: 'implied' },
        el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + width + '%' })),
        el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
      )),
      el('td', null, el('span', { class: 'status', text: 'no token' }))
    );
  }

  /** The board table, or the empty state when no row matches the filters. */
  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    for (var i = 0; i < list.length; i++) tbody.appendChild(boardRow(list[i], max));
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  /** One live-token row: status, protocol, TVL, growth, market cap, already trades. */
  function liveRow(r) {
    var chains = r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain';
    var growthClass = r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg';
    return el('tr', null,
      el('td', { class: 'num', text: 'live' }),
      el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chains }))),
      el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
      el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
      el('td', null, el('span', { class: 'status', text: 'already trades' }))
    );
  }

  /** The live-token tab: market caps as facts, never mixed into the ranking. */
  function liveTable() {
    var tbody = el('tbody');
    for (var i = 0; i < DATA.live.length; i++) tbody.appendChild(liveRow(DATA.live[i]));
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  /** The model panel: the formula in full, then what each factor favours, in plain words. */
  function modelPanel() {
    var m = DATA.model;
    var formula = 'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + min(chains - 1, ' + m.breadth_cap + ') x ' + m.breadth_step + ') )';
    var points = [
      'Size first: a quarter of TVL is the base, so the biggest protocols lead.',
      'Growth next: seven-day TVL change, clamped, moves the base by at most half.',
      'Patience next: the longer a protocol has run with no token, the closer to full maturity, up to three years.',
      'Reach last: each extra chain adds 1.5% of breadth, at most 15%, because more chains mean more wallets and more snapshots.'
    ];
    var items = [];
    for (var i = 0; i < points.length; i++) items.push(el('li', { text: points[i] }));
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' }, formula),
      el('ul', null, items),
      el('p', { class: 'sub', text: 'TVL, seven-day growth and chains come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every rankable pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  /** One equation line in the detail drawer: a muted label, a number on the right. */
  function equationLine(label, value) {
    return el('div', null, el('span', { text: label }), el('b', { class: 'num', text: value }));
  }

  /** Open the detail drawer for one protocol: its inputs, its multipliers, its farm plan. */
  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].slug === slug) { row = DATA.rows[i]; break; }
    }
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    var recomputed = impliedOf(row, DATA.model);
    var matchNote = recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.';
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        equationLine('TVL', fmtUsd(row.tvl_usd)),
        equationLine('Seven-day growth', fmtPct(row.change_7d)),
        equationLine('Age with no token', fmtAge(row.age_days)),
        equationLine('Chains', String(row.chains ? row.chains.length : 1)),
        equationLine('Growth multiplier', String(row.growth_multiplier)),
        equationLine('Maturity multiplier', String(row.maturity_multiplier)),
        equationLine('Breadth multiplier', String(row.breadth_multiplier)),
        equationLine('Implied value', fmtUsd(row.implied_value_usd))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + matchNote + ' This is an estimate, not a price.' })
    ));
    var items = [];
    for (var j = 0; j < steps.length; j++) {
      var s = steps[j];
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      items.push(el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail })));
    }
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, items)
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  /** Render the whole page from state, then open the detail drawer when the hash names one. */
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
