// The DOM HUD: health, ammo, money, timer, score, bomb status, kill feed, buy menu
// and the overlay panels. It never touches the simulation; main.js pushes numbers
// in and reads the play and buy callbacks out.
const COPY = {
  start: {
    title: 'EMBERLINE',
    copy: 'Cinder Yard. Five on five, first to 5 rounds. Plant the bomb at A or B, or clear the Ash team. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'EMBERLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  roundEnd: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammoBox = $('ammo');
  const weaponName = $('weapon-name');
  const grenadeBox = $('grenades');
  const healthNum = $('health-num');
  const healthFill = $('health-fill');
  const armorNum = $('armor-num');
  const moneyValue = $('money');
  const timerValue = $('timer-value');
  const scoreValue = $('score-value');
  const roundLabel = $('round-label');
  const bombStatus = $('bomb-status');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyPanel = $('buy');
  const buyList = $('buy-list');
  const buyMoney = $('buy-money');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const damageOverlay = $('damage-overlay');
  const flashOverlay = $('flash-overlay');
  const plantBar = $('plant-bar');
  const plantFill = $('plant-fill');
  const siteMarkers = $('site-markers');
  const markerA = $('marker-a');
  const markerB = $('marker-b');
  const markerBomb = $('marker-bomb');
  let hitTimer = 0;
  let bannerTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastHealth = -1;
  let lastArmor = -1;
  let lastMoney = -1;
  let lastTimer = -1;
  let lastScore = '';
  let lastWeapon = '';
  let lastGrenades = '';
  let lastBomb = '';

  return {
    setHealth(hp, armor) {
      if (hp === lastHealth && armor === lastArmor) return;
      lastHealth = hp;
      lastArmor = armor;
      healthNum.textContent = String(Math.max(0, Math.ceil(hp)));
      healthFill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
      healthFill.classList.toggle('low', hp <= 30);
      armorNum.textContent = armor > 0 ? `+${Math.ceil(armor)}` : '';
    },
    setAmmo(mag, reserve, weapon, grenades) {
      const g = `${grenades.flash}F ${grenades.frag}G`;
      if (mag === lastMag && reserve === lastReserve && weapon === lastWeapon && g === lastGrenades) return;
      lastMag = mag;
      lastReserve = reserve;
      lastWeapon = weapon;
      lastGrenades = g;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammoBox.classList.toggle('empty', mag === 0);
      weaponName.textContent = weapon;
      grenadeBox.textContent = g;
    },
    setMoney(money) {
      if (money === lastMoney) return;
      lastMoney = money;
      moneyValue.textContent = `$${money}`;
      buyMoney.textContent = `$${money}`;
    },
    setTimer(seconds, phase) {
      const shown = Math.max(0, Math.ceil(seconds));
      const key = `${shown}:${phase}`;
      if (key === lastTimer) return;
      lastTimer = key;
      timerValue.textContent = phase === 'freeze' ? `BUY ${shown}` : `${Math.floor(shown / 60)}:${String(shown % 60).padStart(2, '0')}`;
      timerValue.classList.toggle('freeze', phase === 'freeze');
    },
    setScore(ember, ash, round) {
      const key = `${ember}-${ash}-${round}`;
      if (key === lastScore) return;
      lastScore = key;
      scoreValue.innerHTML = `<b class="ember">${ember}</b> — <b class="ash">${ash}</b>`;
      roundLabel.textContent = `ROUND ${round}`;
    },
    setBomb(text) {
      if (text === lastBomb) return;
      lastBomb = text;
      bombStatus.textContent = text;
      bombStatus.classList.toggle('planted', text.startsWith('PLANTED'));
      bombStatus.hidden = text === '';
    },
    killFeed(killer, victim, isHead, killerTeam) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.innerHTML = `<span class="${killerTeam}">${killer}</span> ${isHead ? '☠' : '✕'} <span>${victim}</span>`;
      killfeed.prepend(line);
      while (killfeed.children.length > 4) killfeed.lastChild.remove();
      setTimeout(() => line.remove(), 6000);
    },
    banner(text, sub, holdMs = 2600) {
      bannerTitle.textContent = text;
      bannerSub.textContent = sub;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        banner.hidden = true;
      }, holdMs);
    },
    hideBanner() {
      banner.hidden = true;
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.25)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    damageFlash() {
      damageOverlay.classList.add('on');
      setTimeout(() => damageOverlay.classList.remove('on'), 180);
    },
    flashScreen(strength) {
      flashOverlay.style.opacity = String(Math.min(1, strength));
      if (strength <= 0) return;
      setTimeout(() => {
        flashOverlay.style.opacity = '0';
      }, 120);
    },
    setCrosshair(spreadPx) {
      crosshair.style.setProperty('--gap', `${Math.round(spreadPx)}px`);
    },
    setPlantProgress(frac) {
      if (frac == null) {
        plantBar.hidden = true;
        return;
      }
      plantBar.hidden = false;
      plantFill.style.width = `${Math.round(frac * 100)}%`;
    },
    setSiteMarker(which, x, y, visible, label) {
      const el = which === 'A' ? markerA : which === 'B' ? markerB : markerBomb;
      if (!visible) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.textContent = label;
    },
    showBuy(items, money) {
      buyPanel.hidden = false;
      buyMoney.textContent = `$${money}`;
      buyList.innerHTML = '';
      items.forEach((item, i) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.dataset.index = String(i);
        row.innerHTML = `<span class="buy-key">${i + 1}</span><span class="buy-name">${item.name}</span><span class="buy-price">$${item.price}</span>`;
        row.classList.toggle('poor', money < item.price);
        buyList.appendChild(row);
      });
      siteMarkers.hidden = true;
    },
    hideBuy() {
      buyPanel.hidden = true;
      siteMarkers.hidden = false;
    },
    onBuy(handler) {
      buyList.addEventListener('click', (event) => {
        const row = event.target.closest('.buy-row');
        if (row) handler(Number(row.dataset.index));
      });
    },
    showOverlay(mode, data) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'roundEnd' || mode === 'matchEnd' ? data : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
